"""Account center endpoints for managing the current user's credentials."""

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis import get_redis_client
from app.core.security import create_access_token
from app.db.session import get_db
from app.deps import get_account_user
from app.models import User
from app.schemas import (
    AccountCredentialsRequest,
    AccountEmailBindRequest,
    AccountLinkRequest,
    AccountLinkResponse,
    AccountProfileResponse,
)
from app.services.account import (
    bind_email_to_current_user,
    get_account_profile,
    link_current_user_to_existing,
    set_account_credentials,
)
from app.services.auth import SSO_COOKIE_NAME, set_sso_cookie
from app.services.rate_limit import (
    RateLimitExceeded,
    check_login_lockout,
    clear_failed_login,
    get_client_ip,
    record_failed_login,
)
from app.services.sso import create_sso_session, revoke_sso_session

logger = structlog.get_logger(__name__)

router = APIRouter()


def _via(application_id: int | None) -> str:
    return "bearer" if application_id is not None else "sso"


@router.get("/profile", response_model=AccountProfileResponse)
def read_profile(
    account: tuple[User, int | None] = Depends(get_account_user),
    db: Session = Depends(get_db),
) -> AccountProfileResponse:
    """Return the caller's account and binding state."""
    user, _ = account
    return get_account_profile(db, user=user)


@router.post("/email/bind", response_model=AccountProfileResponse)
def bind_email(
    payload: AccountEmailBindRequest,
    account: tuple[User, int | None] = Depends(get_account_user),
    db: Session = Depends(get_db),
) -> AccountProfileResponse:
    """Bind an email to the current account (format-checked, ownership unverified)."""
    user, application_id = account
    bind_email_to_current_user(db, user=user, email=str(payload.email))
    db.commit()
    logger.info("account_email_bound", user_id=user.id, via=_via(application_id))
    return get_account_profile(db, user=user)


@router.post("/credentials", response_model=AccountProfileResponse)
def update_credentials(
    payload: AccountCredentialsRequest,
    account: tuple[User, int | None] = Depends(get_account_user),
    db: Session = Depends(get_db),
) -> AccountProfileResponse:
    """Set or update username/password/contact phone for the current account."""
    user, application_id = account
    if (
        payload.username is None
        and payload.password is None
        and payload.contact_phone is None
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nothing to update",
        )
    if payload.password is not None and application_id is not None:
        # An application access token speaks for one app's session, not for
        # global account control; setting the first password with it would
        # hand that app the account's keys. Route password changes through
        # the Passport account center (SSO session) instead.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password changes are only available in the Passport account center",
        )
    try:
        set_account_credentials(
            db,
            user=user,
            username=payload.username,
            password=payload.password,
            contact_phone=payload.contact_phone,
            current_password=payload.current_password,
        )
    except RateLimitExceeded as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=e.detail,
            headers={"Retry-After": str(e.retry_after)},
        )
    db.commit()
    logger.info("account_credentials_updated", user_id=user.id, via=_via(application_id))
    return get_account_profile(db, user=user)


@router.post("/link-existing", response_model=AccountLinkResponse)
def link_existing_account(
    payload: AccountLinkRequest,
    request: Request,
    response: Response,
    account: tuple[User, int | None] = Depends(get_account_user),
    db: Session = Depends(get_db),
) -> AccountLinkResponse:
    """Merge the current third-party-only account into an existing one.

    Bearer callers receive a fresh access token for the target account;
    cookie callers get their SSO session rotated onto it.
    """
    user, application_id = account
    # This endpoint verifies an existing account's password: apply the same
    # lockout the login path uses so a valid token cannot brute-force it.
    identifier = payload.identifier.strip().lower()
    redis_client = get_redis_client()
    client_ip = get_client_ip(request)
    try:
        check_login_lockout(redis_client, identifier, client_ip)
    except RateLimitExceeded as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=e.detail,
            headers={"Retry-After": str(e.retry_after)},
        )
    old_sso_token = request.cookies.get(SSO_COOKIE_NAME)
    try:
        target = link_current_user_to_existing(
            db, current_user=user, identifier=payload.identifier, password=payload.password
        )
    except HTTPException as exc:
        if exc.status_code in (400, 401):
            record_failed_login(redis_client, identifier, client_ip)
        raise
    clear_failed_login(redis_client, identifier, client_ip)
    db.commit()

    result = AccountLinkResponse(profile=get_account_profile(db, user=target))
    if application_id is not None:
        result.access_token = create_access_token(
            subject=str(target.id),
            application_id=application_id,
            expires_in=settings.access_token_ttl_seconds,
        )
        result.expires_in = settings.access_token_ttl_seconds
    elif old_sso_token:
        revoke_sso_session(db, token=old_sso_token)
        sso_token = create_sso_session(db, user_id=target.id)
        db.commit()
        set_sso_cookie(response, sso_token)
    logger.info("account_linked_existing", user_id=target.id, via=_via(application_id))
    return result
