"""Authentication service."""

from datetime import timedelta

import structlog

from fastapi import HTTPException, Response, status
from sqlalchemy import select
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
    EmailVerificationCode,
    OAuthAuthorizationCode,
    OAuthToken,
    User,
    UserIdentity,
)
from app.services.email import send_verification_code
from app.services.applications import (
    get_active_application_by_client_id,
    is_login_method_enabled,
    validate_redirect_uri,
)
from app.services.permissions import get_user_roles_and_permissions
from app.services.sso import create_sso_session

logger = structlog.get_logger(__name__)

SSO_COOKIE_NAME = "passport_sso"


def _set_sso_cookie_if_enabled(
    db: Session, response: Response, application: Application, user_id: int
) -> None:
    if application.enable_sso:
        sso_token = create_sso_session(db, user_id=user_id)
        response.set_cookie(
            SSO_COOKIE_NAME,
            sso_token,
            max_age=settings.sso_session_ttl_seconds,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
        )


def verify_client_secret(db: Session, application: Application, client_secret: str) -> bool:
    """Check if the client_secret matches any active secret for the application."""
    secrets = db.scalars(
        select(ApplicationClientSecret).where(
            ApplicationClientSecret.application_id == application.id
        )
    ).all()
    return any(verify_secret(client_secret, s.secret_hash) for s in secrets)


def issue_email_code(db: Session, *, client_id: str, email: str, purpose: str = "login") -> str:
    """Create an email verification code."""
    application = get_active_application_by_client_id(db, client_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if not is_login_method_enabled(db, application.id, "email_code"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email code login is disabled",
        )

    code = random_digits()
    sent = send_verification_code(email, code)
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to send verification email",
        )
    verification = EmailVerificationCode(
        email=email.lower(),
        code_hash=hash_secret(code),
        purpose=purpose,
        expires_at=utcnow() + timedelta(seconds=settings.email_code_ttl_seconds),
    )
    db.add(verification)
    db.commit()
    logger.info("email_code_issued", email=email, purpose=purpose, sent=sent)
    return code


def complete_email_login(
    db: Session,
    response: Response,
    *,
    client_id: str,
    email: str,
    code: str,
    redirect_uri: str,
    state: str | None,
) -> OAuthAuthorizationCode:
    """Verify an email code and create an authorization code."""
    application = get_active_application_by_client_id(db, client_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if not validate_redirect_uri(application, redirect_uri):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid redirect_uri")
    if not is_login_method_enabled(db, application.id, "email_code"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email code login is disabled",
        )

    now = utcnow()
    verification = db.scalar(
        select(EmailVerificationCode)
        .where(
            EmailVerificationCode.email == email.lower(),
            EmailVerificationCode.purpose == "login",
            EmailVerificationCode.used_at.is_(None),
            EmailVerificationCode.expires_at > now,
        )
        .order_by(EmailVerificationCode.created_at.desc())
        .with_for_update()
    )
    if verification is None or not verify_secret(code, verification.code_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email code")
    verification.used_at = now

    user = get_or_create_email_user(db, email=email)
    logger.info("email_login_success", email=email, user_id=user.id)
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


def complete_password_login(
    db: Session,
    response: Response,
    *,
    client_id: str,
    email: str,
    password: str,
    redirect_uri: str,
    state: str | None,
) -> OAuthAuthorizationCode:
    """Verify email + password and create an authorization code."""
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

    normalized_email = email.lower()
    user = db.scalar(select(User).where(User.email == normalized_email))
    if user is None or not user.hashed_password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    logger.info("password_login_success", email=normalized_email, user_id=user.id)
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


def complete_email_register(
    db: Session,
    response: Response,
    *,
    client_id: str,
    first_name: str,
    last_name: str,
    email: str,
    code: str,
    password: str,
    redirect_uri: str,
    state: str | None,
) -> OAuthAuthorizationCode:
    """Verify email code, create user with password, and issue authorization code."""
    application = get_active_application_by_client_id(db, client_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if not validate_redirect_uri(application, redirect_uri):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid redirect_uri")
    if not is_login_method_enabled(db, application.id, "email_code"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email code login is disabled",
        )

    normalized_email = email.lower()
    existing = db.scalar(select(User).where(User.email == normalized_email))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    existing_identity = db.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "email",
            UserIdentity.provider_user_id == normalized_email,
        )
    )
    if existing_identity is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    now = utcnow()
    verification = db.scalar(
        select(EmailVerificationCode)
        .where(
            EmailVerificationCode.email == normalized_email,
            EmailVerificationCode.purpose == "register",
            EmailVerificationCode.used_at.is_(None),
            EmailVerificationCode.expires_at > now,
        )
        .order_by(EmailVerificationCode.created_at.desc())
        .with_for_update()
    )
    if verification is None or not verify_secret(code, verification.code_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email code")
    verification.used_at = now

    user = User(
        email=normalized_email,
        display_name=f"{first_name} {last_name}",
        hashed_password=hash_password(password),
    )
    db.add(user)
    db.flush()
    logger.info("user_registered", email=normalized_email)

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
        user = User(email=normalized_email, display_name=normalized_email.split("@")[0])
        db.add(user)
        db.flush()

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
    email: str,
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

    normalized_email = email.lower()
    user = db.scalar(select(User).where(User.email == normalized_email))
    if user is None:
        user = User(
            email=normalized_email,
            display_name=display_name or normalized_email.split("@")[0],
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
) -> ApplicationUser:
    """Ensure a user may access an application and has membership row."""
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

    if not application.enable_public_users:
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
