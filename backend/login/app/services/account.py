"""Shared account-binding primitives for the account center APIs."""

import structlog
from fastapi import HTTPException, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.core.redis import get_redis_client
from app.core.security import hash_password, utcnow, verify_password
from app.models import (
    ApplicationUser,
    OAuthAuthorizationCode,
    OAuthToken,
    SsoSession,
    User,
    UserIdentity,
    UserStatus,
)
from app.schemas import AccountIdentityItem, AccountProfileResponse, AccountProfileUser
from app.services.auth import _consume_sms_code
from app.services.rate_limit import check_login_lockout, clear_failed_login, record_failed_login

logger = structlog.get_logger(__name__)

_LOCKOUT_SCOPE = "account"


def find_local_user(db: Session, *, identifier: str) -> User | None:
    """Return the user whose username, email, or phone matches the identifier."""
    normalized = identifier.strip().lower()
    return db.scalar(
        select(User).where(
            or_(
                func.lower(User.username) == normalized,
                func.lower(User.email) == normalized,
                func.lower(User.phone) == normalized,
            )
        )
    )


def find_user_by_email(db: Session, *, email: str) -> User | None:
    return db.scalar(select(User).where(func.lower(User.email) == email.lower()))


def username_taken(db: Session, *, username: str, exclude_user_id: int | None = None) -> bool:
    statement = select(User.id).where(func.lower(User.username) == username.lower())
    if exclude_user_id is not None:
        statement = statement.where(User.id != exclude_user_id)
    return db.scalar(statement) is not None


def get_email_identity(db: Session, *, email: str) -> UserIdentity | None:
    return db.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "email",
            UserIdentity.provider_user_id == email.lower(),
        )
    )


def bind_email_to_current_user(db: Session, *, user: User, email: str) -> None:
    """Attach an email to the authenticated account without proving ownership.

    Binding is a deliberate user action; only the format and the
    not-taken-by-someone-else checks apply. email_verified_at stays NULL so
    the profile/userinfo flags honestly report the unproven ownership.
    """
    normalized = email.lower()

    other = find_user_by_email(db, email=normalized)
    if other is not None and other.id != user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already bound to another account",
        )
    identity = get_email_identity(db, email=normalized)
    if identity is not None and identity.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email identity belongs to another account",
        )
    if user.email and user.email.lower() != normalized:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already bound to this account",
        )

    user.email = normalized
    if identity is None:
        db.add(
            UserIdentity(
                user_id=user.id,
                provider="email",
                provider_user_id=normalized,
                provider_email=normalized,
                raw_profile={},
            )
        )


def find_user_by_phone(db: Session, *, phone: str) -> User | None:
    """Return the user owning this phone as a verified credential, if any."""
    identity = db.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "phone",
            UserIdentity.provider_user_id == phone,
        )
    )
    if identity is not None:
        return db.get(User, identity.user_id)
    return db.scalar(select(User).where(User.phone == phone))


def bind_phone_to_current_user(db: Session, *, user: User, phone: str, code: str) -> User | None:
    """Attach a verified phone credential to the current account.

    Consumes the bind_phone SMS code. When the phone already belongs to
    another account the SMS code serves as ownership proof and the current
    account is merged into that one; the merge target is returned in that
    case (None means the phone was attached to the caller's own account).
    """
    _consume_sms_code(db, phone=phone, code=code, purpose="bind_phone")

    owner = find_user_by_phone(db, phone=phone)
    if owner is not None and owner.id == user.id:
        user.phone = phone
        user.phone_verified_at = user.phone_verified_at or utcnow()
        return None
    if owner is not None:
        return merge_user_into_target(db, source=user, target=owner)

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
    user.phone = phone
    user.phone_verified_at = utcnow()
    return None


def set_account_credentials(
    db: Session,
    *,
    user: User,
    username: str | None = None,
    password: str | None = None,
    contact_phone: str | None = None,
    current_password: str | None = None,
) -> None:
    """Set or update username/password/contact phone for the account owner.

    Overwriting an existing password requires proving knowledge of the
    current one; setting a first password does not.
    """
    if username is not None and username != (user.username or "").lower():
        if username_taken(db, username=username, exclude_user_id=user.id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username is already in use",
            )
        user.username = username

    if password:
        if user.hashed_password:
            redis_client = get_redis_client()
            check_login_lockout(redis_client, f"pwd:{user.id}", _LOCKOUT_SCOPE)
            if not current_password or not verify_password(current_password, user.hashed_password):
                record_failed_login(redis_client, f"pwd:{user.id}", _LOCKOUT_SCOPE)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid current password",
                )
            clear_failed_login(redis_client, f"pwd:{user.id}", _LOCKOUT_SCOPE)
        user.hashed_password = hash_password(password)

    if contact_phone is not None:
        user.contact_phone = contact_phone


def _merge_field_or_conflict(target_value: str | None, source_value: str | None, field: str) -> str | None:
    """Fill an empty target field from source; disagreeing non-empty values conflict."""
    if source_value is None or source_value == target_value:
        return target_value
    if target_value is None:
        return source_value
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"Merge conflict on {field}",
    )


def merge_user_into_target(db: Session, *, source: User, target: User) -> User:
    """Move source's identities and memberships onto target, then delete source.

    Target fields keep their values; empty ones are filled from source, and
    two different non-empty values for email/username/contact_phone conflict.
    Sessions and tokens issued to the source die with it. Callers must have
    proven ownership of both sides before invoking this.
    """
    if source.id == target.id:
        return target

    if target.phone and source.phone and source.phone != target.phone:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Merge conflict on phone",
        )

    target.email = _merge_field_or_conflict(target.email, source.email, "email")
    target.username = _merge_field_or_conflict(target.username, source.username, "username")
    target.contact_phone = _merge_field_or_conflict(
        target.contact_phone, source.contact_phone, "contact_phone"
    )
    if not target.hashed_password and source.hashed_password:
        target.hashed_password = source.hashed_password
    if target.phone_verified_at is None and source.phone_verified_at is not None:
        target.phone_verified_at = source.phone_verified_at

    identities = db.scalars(
        select(UserIdentity).where(UserIdentity.user_id == source.id)
    ).all()
    for identity in identities:
        clash = db.scalar(
            select(UserIdentity).where(
                UserIdentity.user_id == target.id,
                UserIdentity.provider == identity.provider,
            )
        )
        if clash is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Target account already has a {identity.provider} identity",
            )
        # Assign through the relationship so the parent's identity collection
        # stays in sync; a raw user_id write would be nullified on delete.
        identity.user = target

    memberships = db.scalars(
        select(ApplicationUser).where(ApplicationUser.user_id == source.id)
    ).all()
    for membership in memberships:
        existing = db.scalar(
            select(ApplicationUser).where(
                ApplicationUser.application_id == membership.application_id,
                ApplicationUser.user_id == target.id,
            )
        )
        if existing is not None:
            db.delete(membership)
        else:
            membership.user_id = target.id

    # Sessions and tokens issued to the source account die with it.
    # Flush first so pending rows (e.g. the SSO session being used right
    # now) exist in the DB for the bulk deletes below to remove.
    db.flush()
    db.execute(
        delete(SsoSession).where(SsoSession.user_id == source.id)
    )
    db.execute(delete(OAuthToken).where(OAuthToken.user_id == source.id))
    db.execute(
        delete(OAuthAuthorizationCode).where(OAuthAuthorizationCode.user_id == source.id)
    )

    db.delete(source)
    db.flush()
    logger.info(
        "accounts_merged",
        removed_user_id=source.id,
        target_user_id=target.id,
    )
    return target


def link_current_user_to_existing(
    db: Session, *, current_user: User, identifier: str, password: str
) -> User:
    """Merge a bare third-party-only account into an existing local account.

    The caller proves ownership of both sides: the access token/SSO cookie
    for the current account and the target's password here. Only accounts
    without password and email may be merged this way.
    """
    normalized = identifier.strip().lower()
    target = find_local_user(db, identifier=identifier)
    if target is None or not target.hashed_password or not verify_password(
        password, target.hashed_password
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username/email or password",
        )
    if target.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")
    if target.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Accounts are already linked",
        )

    if current_user.hashed_password or current_user.email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account has its own credentials and cannot be merged",
        )

    return merge_user_into_target(db, source=current_user, target=target)


def get_account_profile(db: Session, *, user: User) -> AccountProfileResponse:
    """Aggregate the account's binding state for profile responses."""
    identities = db.scalars(
        select(UserIdentity).where(UserIdentity.user_id == user.id)
    ).all()
    return AccountProfileResponse(
        user=AccountProfileUser(
            id=user.id,
            username=user.username,
            email=user.email,
            email_verified=user.email_verified_at is not None,
            contact_phone=user.contact_phone,
            display_name=user.display_name,
            avatar_url=user.avatar_url,
            status=user.status,
        ),
        has_password=user.hashed_password is not None,
        identities=[
            AccountIdentityItem(
                provider=identity.provider,
                provider_email=identity.provider_email,
            )
            for identity in identities
        ],
    )
