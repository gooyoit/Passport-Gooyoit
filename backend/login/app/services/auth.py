"""Authentication service."""

from datetime import timedelta

import structlog

from fastapi import HTTPException, Response, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import (
    hash_password,
    create_access_token,
    hash_secret,
    random_digits,
    random_token,
    utcnow,
    verify_password,
    verify_secret,
)
from app.models import (
    UserStatus,
    Application,
    ApplicationClientSecret,
    ApplicationUser,
    OAuthAuthorizationCode,
    OAuthToken,
    PhoneVerificationCode,
    SsoSession,
    User,
    UserIdentity,
)
from app.services.sms import send_sms_code
from app.services.applications import (
    get_active_application_by_client_id,
    is_login_method_enabled,
    validate_redirect_uri,
)
from app.services.permissions import get_user_roles_and_permissions
from app.services.sso import create_sso_session

logger = structlog.get_logger(__name__)

SSO_COOKIE_NAME = "passport_sso"


def set_sso_cookie(response: Response, token: str, *, remember: bool = True) -> None:
    """Write the SSO cookie, shared across subdomains when configured.

    Without ``remember`` the cookie has no ``Max-Age``/``Expires``, so the
    browser drops it when the session ends.
    """
    response.set_cookie(
        SSO_COOKIE_NAME,
        token,
        max_age=settings.sso_session_ttl_seconds if remember else None,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        domain=settings.sso_cookie_domain or None,
    )


def clear_sso_cookie(response: Response) -> None:
    response.delete_cookie(SSO_COOKIE_NAME, domain=settings.sso_cookie_domain or None)


def _set_sso_cookie_if_enabled(
    db: Session,
    response: Response,
    application: Application,
    user_id: int,
    *,
    remember: bool = True,
) -> None:
    if application.enable_sso:
        sso_token = create_sso_session(db, user_id=user_id)
        set_sso_cookie(response, sso_token, remember=remember)


def verify_client_secret(db: Session, application: Application, client_secret: str) -> bool:
    """Check if the client_secret matches any active secret for the application."""
    secrets = db.scalars(
        select(ApplicationClientSecret).where(
            ApplicationClientSecret.application_id == application.id
        )
    ).all()
    return any(verify_secret(client_secret, s.secret_hash) for s in secrets)



def issue_sms_code(db: Session, *, client_id: str | None, phone: str, purpose: str = "login") -> str:
    """Create an SMS verification code and send it.

    bind_phone skips application checks entirely: it is issued from the
    account center where merging into the phone's existing owner is the
    intended outcome, so neither the sms_code login method nor signup
    switches apply.
    """
    application = None
    if purpose != "bind_phone":
        application = get_active_application_by_client_id(db, client_id)
        if application is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
        if not is_login_method_enabled(db, application.id, "sms_code"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="SMS code login is disabled",
            )
    if purpose == "register" and not application.enable_public_users:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration is disabled",
        )
    if purpose == "register" and db.scalar(select(User).where(User.phone == phone)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Phone number is already registered",
        )
    if purpose == "reset_password" and db.scalar(select(User).where(User.phone == phone)) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number is not registered",
        )

    code = random_digits()
    if not send_sms_code(phone, code, purpose=purpose):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to send SMS",
        )
    db.add(
        PhoneVerificationCode(
            phone=phone,
            code_hash=hash_secret(code),
            purpose=purpose,
            expires_at=utcnow() + timedelta(seconds=settings.sms_code_ttl_seconds),
        )
    )
    db.commit()
    logger.info("sms_code_issued", phone=phone, purpose=purpose)
    return code


def get_or_create_phone_user(db: Session, *, phone: str, application: Application) -> User:
    """Return the user owning this phone, or auto-register one when allowed."""
    user = db.scalar(select(User).where(User.phone == phone))
    if user is not None:
        if user.phone_verified_at is None:
            user.phone_verified_at = utcnow()
        return user
    if not application.enable_public_users:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Phone number is not registered",
        )
    user = User(
        phone=phone,
        phone_verified_at=utcnow(),
        display_name=f"{phone[:3]}****{phone[-4:]}" if len(phone) >= 7 else phone,
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    db.flush()
    identity = db.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "phone",
            UserIdentity.provider_user_id == phone,
        )
    )
    if identity is None:
        db.add(
            UserIdentity(
                user_id=user.id,
                provider="phone",
                provider_user_id=phone,
                raw_profile={},
            )
        )
        db.flush()
    return user


def _consume_sms_code(db: Session, *, phone: str, code: str, purpose: str) -> None:
    """Mark the newest valid code for this phone+purpose as used; burn after 5 wrong tries."""
    now = utcnow()
    verification = db.scalar(
        select(PhoneVerificationCode)
        .where(
            PhoneVerificationCode.phone == phone,
            PhoneVerificationCode.purpose == purpose,
            PhoneVerificationCode.used_at.is_(None),
            PhoneVerificationCode.expires_at > now,
        )
        .order_by(PhoneVerificationCode.created_at.desc())
        .with_for_update()
    )
    if verification is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SMS code")
    if not verify_secret(code, verification.code_hash):
        verification.attempt_count += 1
        if verification.attempt_count >= 5:
            # Burn the code after repeated wrong guesses.
            verification.used_at = now
        db.commit()  # persist the attempt counter before raising
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SMS code")
    verification.used_at = now


def _issue_login_grant(
    db: Session,
    response: Response,
    *,
    application: Application,
    user: User,
    redirect_uri: str,
) -> OAuthAuthorizationCode:
    """Shared tail of SMS flows: membership, SSO cookie, authorization code."""
    now = utcnow()
    membership = ensure_application_user(db, application=application, user=user)
    membership.last_login_at = now
    _set_sso_cookie_if_enabled(db, response, application, user.id)
    auth_code = create_authorization_code(
        db,
        application=application,
        user=user,
        redirect_uri=redirect_uri,
    )
    db.commit()
    db.refresh(auth_code)
    return auth_code


def _sms_application_or_error(db: Session, client_id: str, redirect_uri: str) -> Application:
    application = get_active_application_by_client_id(db, client_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if not validate_redirect_uri(application, redirect_uri):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid redirect_uri")
    if not is_login_method_enabled(db, application.id, "sms_code"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="SMS code login is disabled",
        )
    return application


def complete_sms_login(
    db: Session,
    response: Response,
    *,
    client_id: str,
    phone: str,
    code: str,
    redirect_uri: str,
    state: str | None,
) -> OAuthAuthorizationCode:
    """Verify an SMS code and log the user in (auto-registering when allowed)."""
    application = _sms_application_or_error(db, client_id, redirect_uri)
    _consume_sms_code(db, phone=phone, code=code, purpose="login")

    user = get_or_create_phone_user(db, phone=phone, application=application)
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")
    logger.info("sms_login_success", phone=phone, user_id=user.id)
    return _issue_login_grant(db, response, application=application, user=user, redirect_uri=redirect_uri)


def complete_sms_register(
    db: Session,
    response: Response,
    *,
    client_id: str,
    phone: str,
    code: str,
    redirect_uri: str,
    state: str | None,
) -> OAuthAuthorizationCode:
    """Verify a register-purpose SMS code, create the account, and log the user in."""
    application = _sms_application_or_error(db, client_id, redirect_uri)
    if not application.enable_public_users:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is disabled",
        )
    _consume_sms_code(db, phone=phone, code=code, purpose="register")

    user = get_or_create_phone_user(db, phone=phone, application=application)
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")
    logger.info("sms_register_success", phone=phone, user_id=user.id)
    return _issue_login_grant(db, response, application=application, user=user, redirect_uri=redirect_uri)


def _revoke_user_sessions(db: Session, user_id: int) -> None:
    """Revoke all refresh tokens and SSO sessions (password-reset hygiene)."""
    now = utcnow()
    db.execute(
        update(OAuthToken)
        .where(OAuthToken.user_id == user_id, OAuthToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.execute(
        update(SsoSession)
        .where(SsoSession.user_id == user_id, SsoSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )


def complete_sms_password_reset(
    db: Session,
    response: Response,
    *,
    client_id: str,
    phone: str,
    code: str,
    new_password: str,
    redirect_uri: str,
    state: str | None,
) -> OAuthAuthorizationCode:
    """Verify a reset-purpose SMS code, set the new password, and log the user in."""
    application = _sms_application_or_error(db, client_id, redirect_uri)
    _consume_sms_code(db, phone=phone, code=code, purpose="reset_password")

    user = db.scalar(select(User).where(User.phone == phone))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number is not registered",
        )
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")
    user.hashed_password = hash_password(new_password)
    _revoke_user_sessions(db, user.id)
    logger.info("sms_password_reset_success", phone=phone, user_id=user.id)
    return _issue_login_grant(db, response, application=application, user=user, redirect_uri=redirect_uri)


def complete_password_login(
    db: Session,
    response: Response,
    *,
    client_id: str,
    identifier: str,
    password: str,
    redirect_uri: str,
    state: str | None,
    allow_registration: bool = False,
    remember: bool = True,
) -> OAuthAuthorizationCode:
    """Verify an email/password account or auto-register it when allowed."""
    application = get_active_application_by_client_id(db, client_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if not validate_redirect_uri(application, redirect_uri):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid redirect_uri")
    if not is_login_method_enabled(db, application.id, "email_password"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password login is disabled",
        )

    normalized_identifier = identifier.strip().lower()
    user = db.scalar(
        select(User).where(
            or_(
                func.lower(User.username) == normalized_identifier,
                func.lower(User.email) == normalized_identifier,
                func.lower(User.phone) == normalized_identifier,
            )
        )
    )
    if user is None:
        if not allow_registration:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )
        if not application.enable_public_users:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Email is not registered",
            )
        categories = sum(
            bool(check)
            for check in (
                any(c.isupper() for c in password),
                any(c.islower() for c in password),
                any(c.isdigit() for c in password),
                any(not c.isalnum() for c in password),
            )
        )
        if len(password) < 8 or categories < 3:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Password must be at least 8 characters and contain at least "
                    "3 of: uppercase, lowercase, digit, special character"
                ),
            )
        user = User(
            email=normalized_identifier,
            email_verified_at=None,
            display_name=normalized_identifier.split("@")[0],
            hashed_password=hash_password(password),
            status=UserStatus.ACTIVE,
        )
        db.add(user)
        db.flush()
        db.add(
            UserIdentity(
                user_id=user.id,
                provider="email",
                provider_user_id=normalized_identifier,
                provider_email=normalized_identifier,
                raw_profile={"verified": False},
            )
        )
        logger.info(
            "email_password_registration_success",
            email=normalized_identifier,
            user_id=user.id,
        )
    else:
        if not user.hashed_password or not verify_password(password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )
        if user.status != UserStatus.ACTIVE:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")

    logger.info("email_password_login_success", identifier=normalized_identifier, user_id=user.id)
    now = utcnow()
    membership = ensure_application_user(db, application=application, user=user)
    membership.last_login_at = now

    _set_sso_cookie_if_enabled(db, response, application, user.id, remember=remember)

    auth_code = create_authorization_code(
        db,
        application=application,
        user=user,
        redirect_uri=redirect_uri,
    )
    db.commit()
    db.refresh(auth_code)
    return auth_code


def create_authorization_code(
    db: Session,
    *,
    application: Application,
    user: User,
    redirect_uri: str,
    scope: str | None = None,
) -> OAuthAuthorizationCode:
    """Create an authorization code for a logged-in user."""
    auth_code = OAuthAuthorizationCode(
        code=random_token(32),
        application_id=application.id,
        user_id=user.id,
        redirect_uri=redirect_uri,
        scope=scope,
        expires_at=utcnow() + timedelta(seconds=settings.authorization_code_ttl_seconds),
    )
    db.add(auth_code)
    return auth_code


def get_or_create_email_user(db: Session, *, email: str) -> User:
    """Return an existing user or create one for an email identity."""
    normalized_email = email.lower()
    user = db.scalar(select(User).where(User.email == normalized_email))
    if user is None:
        user = User(
            email=normalized_email,
            email_verified_at=utcnow(),
            display_name=normalized_email.split("@")[0],
        )
        db.add(user)
        db.flush()
    elif user.email_verified_at is None:
        user.email_verified_at = utcnow()

    identity = db.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "email",
            UserIdentity.provider_user_id == normalized_email,
        )
    )
    if identity is None:
        db.add(
            UserIdentity(
                user_id=user.id,
                provider="email",
                provider_user_id=normalized_email,
                provider_email=normalized_email,
                raw_profile={},
            )
        )
        db.flush()
    return user


def get_or_create_oauth_user(
    db: Session,
    *,
    provider: str,
    provider_user_id: str,
    email: str | None,
    display_name: str | None,
    avatar_url: str | None,
    raw_profile: dict,
) -> User:
    """Return a user by OAuth identity or create/bind one."""
    identity = db.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == provider,
            UserIdentity.provider_user_id == provider_user_id,
        )
    )
    if identity is not None:
        user = db.get(User, identity.user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return user

    normalized_email = email.lower() if email else None
    user = (
        db.scalar(select(User).where(User.email == normalized_email))
        if normalized_email
        else None
    )
    if user is None:
        user = User(
            email=normalized_email,
            email_verified_at=utcnow() if normalized_email else None,
            display_name=display_name or (normalized_email.split("@")[0] if normalized_email else provider),
            avatar_url=avatar_url,
            status=UserStatus.ACTIVE,
        )
        db.add(user)
        db.flush()

    db.add(
        UserIdentity(
            user_id=user.id,
            provider=provider,
            provider_user_id=provider_user_id,
            provider_email=normalized_email,
            raw_profile=raw_profile,
        )
    )
    db.flush()
    return user


def ensure_application_user(
    db: Session,
    *,
    application: Application,
    user: User,
    require_public_users: bool = True,
) -> ApplicationUser:
    """Ensure a user may access an application and has membership row.

    Third-party identities verified through a provider login method the
    application enabled are trusted to join even when public signup is off.
    """
    membership = db.scalar(
        select(ApplicationUser).where(
            ApplicationUser.application_id == application.id,
            ApplicationUser.user_id == user.id,
        )
    )
    if membership is not None:
        if membership.status != UserStatus.ACTIVE:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Application user is disabled",
            )
        return membership

    if require_public_users and not application.enable_public_users:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not allowed to access this application",
        )

    membership = ApplicationUser(
        application_id=application.id,
        user_id=user.id,
        status=UserStatus.ACTIVE,
        joined_at=utcnow(),
    )
    db.add(membership)
    db.flush()
    return membership


def exchange_authorization_code(
    db: Session,
    *,
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
) -> tuple[str, str, int, User, list[str], list[str]]:
    """Exchange an authorization code for access and refresh tokens."""
    application = get_active_application_by_client_id(db, client_id)
    if application is None or not verify_client_secret(db, application, client_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid client")

    now = utcnow()
    auth_code = db.scalar(
        select(OAuthAuthorizationCode).where(
            OAuthAuthorizationCode.code == code,
            OAuthAuthorizationCode.application_id == application.id,
            OAuthAuthorizationCode.redirect_uri == redirect_uri,
        ).with_for_update()
    )
    if auth_code is None or auth_code.used_at is not None or auth_code.expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid authorization code",
        )
    auth_code.used_at = now

    user = db.get(User, auth_code.user_id)
    if user is None or user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")
    membership = ensure_application_user(db, application=application, user=user)
    if membership.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")

    access_token, roles, permissions = issue_access_token_for_user(
        db,
        application=application,
        user=user,
    )
    refresh_token = random_token(32)
    db.add(
        OAuthToken(
            application_id=application.id,
            user_id=user.id,
            refresh_token_hash=hash_secret(refresh_token),
            expires_at=now + timedelta(seconds=application.refresh_token_ttl_seconds),
        )
    )
    db.commit()
    return (
        access_token,
        refresh_token,
        application.access_token_ttl_seconds,
        user,
        roles,
        permissions,
    )


def issue_access_token_for_user(
    db: Session,
    *,
    application: Application,
    user: User,
) -> tuple[str, list[str], list[str]]:
    """Issue an access token and return effective roles and permissions."""
    roles, permissions = get_user_roles_and_permissions(db, application.id, user.id)
    role_codes = [role.code for role in roles]
    access_token = create_access_token(
        subject=str(user.id),
        application_id=application.id,
        expires_in=application.access_token_ttl_seconds,
        extra_claims={"roles": role_codes},
    )
    return access_token, role_codes, permissions


def refresh_access_token(
    db: Session,
    *,
    client_id: str,
    client_secret: str,
    refresh_token: str,
) -> tuple[str, int, User, list[str], list[str]]:
    """Refresh an access token using a valid refresh token."""
    application = get_active_application_by_client_id(db, client_id)
    if application is None or not verify_client_secret(db, application, client_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid client")

    now = utcnow()
    token = db.scalar(
        select(OAuthToken).where(
            OAuthToken.application_id == application.id,
            OAuthToken.refresh_token_hash == hash_secret(refresh_token),
            OAuthToken.revoked_at.is_(None),
            OAuthToken.expires_at > now,
        )
    )
    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = db.get(User, token.user_id)
    if user is None or user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")
    ensure_application_user(db, application=application, user=user)

    access_token, roles, permissions = issue_access_token_for_user(
        db,
        application=application,
        user=user,
    )
    return access_token, application.access_token_ttl_seconds, user, roles, permissions


def revoke_refresh_token(db: Session, *, refresh_token: str) -> bool:
    """Revoke a refresh token if it exists."""
    token = db.scalar(
        select(OAuthToken).where(
            OAuthToken.refresh_token_hash == hash_secret(refresh_token),
            OAuthToken.revoked_at.is_(None),
        )
    )
    if token is None:
        return False
    token.revoked_at = utcnow()
    db.commit()
    return True
