"""Account center endpoints for managing the current user's credentials."""

import time

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis import get_redis_client
from app.core.security import create_access_token
from app.db.session import get_db
from app.deps import get_account_user
from app.models import Application, ApplicationLoginMethod, User, UserIdentity, UserStatus
from app.schemas import (
    AccountCredentialsRequest,
    AccountEmailBindRequest,
    AccountLinkRequest,
    AccountLinkResponse,
    AccountPhoneBindRequest,
    AccountPhoneCodeRequest,
    AccountProfileResponse,
    EmailCodeResponse,
)
from app.services.account import (
    bind_email_to_current_user,
    bind_phone_to_current_user,
    get_account_profile,
    link_current_user_to_existing,
    set_account_credentials,
)
from app.services.aliyun_captcha import verify_captcha
from app.services.auth import SSO_COOKIE_NAME, issue_sms_code, set_sso_cookie
from app.services.oauth_providers import build_oauth_client, fetch_provider_profile
from app.services.rate_limit import (
    RateLimitExceeded,
    check_login_lockout,
    check_sms_rate_limit,
    clear_failed_login,
    get_client_ip,
    record_failed_login,
)
from app.services.sso import create_sso_session, revoke_sso_session

logger = structlog.get_logger(__name__)

router = APIRouter()

_WECHAT_BIND_SESSION_KEY = "wechat_bind"
_WECHAT_BIND_TTL_SECONDS = 600
_SETTINGS_PAGE = "/account/settings"


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


@router.post("/phone/request-code", response_model=EmailCodeResponse)
def request_phone_bind_code(
    payload: AccountPhoneCodeRequest,
    request: Request,
    account: tuple[User, int | None] = Depends(get_account_user),
    db: Session = Depends(get_db),
) -> EmailCodeResponse:
    """Send an SMS code to bind a phone credential to the current account.

    Bearer callers (application-forwarded) skip the captcha because the
    token itself is fresh proof of identity; the cookie path reachable from
    the anonymous-facing account center page must pass the captcha.
    """
    user, application_id = account
    if application_id is None and not verify_captcha(payload.captcha_verify_param):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Captcha verification failed",
        )
    try:
        check_sms_rate_limit(
            get_redis_client(), payload.phone, get_client_ip(request)
        )
    except RateLimitExceeded as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=e.detail,
            headers={"Retry-After": str(e.retry_after)},
        )
    code = issue_sms_code(
        db, client_id=None, phone=payload.phone, purpose="bind_phone"
    )
    logger.info(
        "account_phone_code_requested", user_id=user.id, via=_via(application_id)
    )
    return EmailCodeResponse(
        sent=True,
        debug_code=code if settings.debug else None,
    )


@router.post("/phone/bind", response_model=AccountLinkResponse)
def bind_phone(
    payload: AccountPhoneBindRequest,
    request: Request,
    response: Response,
    account: tuple[User, int | None] = Depends(get_account_user),
    db: Session = Depends(get_db),
) -> AccountLinkResponse:
    """Verify the SMS code and attach the phone, merging if it is owned.

    access_token is populated only when a merge happened (the caller's old
    token dies with the merged-away account).
    """
    user, application_id = account
    old_sso_token = request.cookies.get(SSO_COOKIE_NAME)
    # Wrong or expired codes get the same brute-force lockout as logins.
    redis_client = get_redis_client()
    client_ip = get_client_ip(request)
    try:
        check_login_lockout(redis_client, f"bind:{user.id}", client_ip)
    except RateLimitExceeded as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=e.detail,
            headers={"Retry-After": str(e.retry_after)},
        )
    try:
        target = bind_phone_to_current_user(
            db, user=user, phone=payload.phone, code=payload.code
        )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_400_BAD_REQUEST:
            record_failed_login(redis_client, f"bind:{user.id}", client_ip)
        raise
    clear_failed_login(redis_client, f"bind:{user.id}", client_ip)
    db.commit()

    result_user = target if target is not None else user
    result = AccountLinkResponse(profile=get_account_profile(db, user=result_user))
    if target is not None and application_id is not None:
        result.access_token = create_access_token(
            subject=str(target.id),
            application_id=application_id,
            expires_in=settings.access_token_ttl_seconds,
        )
        result.expires_in = settings.access_token_ttl_seconds
    elif target is not None and old_sso_token:
        revoke_sso_session(db, token=old_sso_token)
        sso_token = create_sso_session(db, user_id=target.id)
        db.commit()
        set_sso_cookie(response, sso_token)
    logger.info(
        "account_phone_bound",
        user_id=result_user.id,
        merged=target is not None,
        via=_via(application_id),
    )
    return result


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


@router.get("/wechat/bind/start")
async def start_wechat_bind(
    request: Request,
    account: tuple[User, int | None] = Depends(get_account_user),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Send the browser to WeChat's authorize page to bind the SSO account.

    Application-scoped callers cannot carry a browser redirect flow, so the
    bind is only offered on the Passport account center page itself.
    """
    user, application_id = account
    if application_id is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="WeChat binding is only available in the Passport account center",
        )
    method = db.scalar(
        select(ApplicationLoginMethod)
        .join(Application, ApplicationLoginMethod.application_id == Application.id)
        .where(
            ApplicationLoginMethod.method == "wechat",
            ApplicationLoginMethod.enabled.is_(True),
            Application.status == "active",
        )
        .order_by(Application.id)
        .limit(1)
    )
    if method is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="WeChat login is not configured",
        )
    request.session[_WECHAT_BIND_SESSION_KEY] = {
        "user_id": user.id,
        "method_id": method.id,
        "ts": time.time(),
    }
    client = build_oauth_client("wechat", method.config)
    callback_uri = str(request.url_for("wechat_bind_callback"))
    return await client.authorize_redirect(request, callback_uri)


@router.get("/wechat/bind/callback", name="wechat_bind_callback")
async def wechat_bind_callback(
    request: Request,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Complete the bind started at /wechat/bind/start.

    The session intent (created behind authentication at start) is the only
    authority for which account receives the identity; a wechat identity
    owned by someone else is reported, never stolen.
    """
    intent = request.session.pop(_WECHAT_BIND_SESSION_KEY, None)
    if (
        not isinstance(intent, dict)
        or time.time() - intent.get("ts", 0) > _WECHAT_BIND_TTL_SECONDS
    ):
        return RedirectResponse(f"{_SETTINGS_PAGE}?bind=error")
    user = db.get(User, intent.get("user_id"))
    method = db.get(ApplicationLoginMethod, intent.get("method_id"))
    if (
        user is None
        or user.status != UserStatus.ACTIVE
        or method is None
        or not method.enabled
    ):
        return RedirectResponse(f"{_SETTINGS_PAGE}?bind=error")
    try:
        client = build_oauth_client("wechat", method.config)
        profile = await fetch_provider_profile("wechat", client, request)
    except HTTPException:
        return RedirectResponse(f"{_SETTINGS_PAGE}?bind=error")
    identity = db.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "wechat",
            UserIdentity.provider_user_id == profile["id"],
        )
    )
    if identity is not None and identity.user_id != user.id:
        logger.info(
            "account_wechat_bind_conflict",
            user_id=user.id,
            owner_user_id=identity.user_id,
        )
        return RedirectResponse(f"{_SETTINGS_PAGE}?bind=conflict")
    if identity is None:
        db.add(
            UserIdentity(
                user_id=user.id,
                provider="wechat",
                provider_user_id=profile["id"],
                raw_profile=profile.get("raw") or {},
            )
        )
        db.commit()
    logger.info("account_wechat_bound", user_id=user.id)
    return RedirectResponse(f"{_SETTINGS_PAGE}?bind=ok")
