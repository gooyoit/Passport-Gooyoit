"""Authentication API."""

import structlog
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

logger = structlog.get_logger(__name__)

from app.core.config import settings
from app.core.redis import get_redis_client
from app.db.session import get_db
from app.schemas import (
    AccountSetupRead,
    AccountSetupRequest,
    AccountSetupResponse,
    EmailCodeResponse,
    EmailLoginResponse,
    EmailPasswordLoginRequest,
    SmsCodeRequest,
    SmsLoginRequest,
    SmsRegisterRequest,
    SmsResetPasswordRequest,
    WebAuthnBeginRequest,
    WebAuthnBeginResponse,
    WebAuthnVerifyRequest,
    WebAuthnRegisterBeginRequest,
    WebAuthnRegisterBeginResponse,
    WebAuthnRegisterFinishRequest,
)
from app.services.account_setup import complete_account_setup, get_pending_account_setup
from app.services.applications import (
    get_active_application_by_client_id,
    is_allowed_logout_redirect,
)
from app.services.auth import (
    SSO_COOKIE_NAME,
    clear_sso_cookie,
    complete_password_login,
    complete_sms_login,
    complete_sms_register,
    complete_sms_password_reset,
    issue_sms_code,
)
from app.services.aliyun_captcha import verify_captcha
from app.services.rate_limit import (
    RateLimitExceeded,
    check_captcha_attempt_limit,
    check_login_lockout,
    check_sms_rate_limit,
    clear_failed_login,
    get_client_ip,
    record_failed_login,
)
from app.services.sso import revoke_sso_session
from app.services.webauthn_service import (
    begin_authentication,
    verify_authentication,
    begin_registration,
    finish_registration,
)
from redis import Redis

router = APIRouter()


@router.get("/account-setup", response_model=AccountSetupRead)
def account_setup_context(
    token: str,
    db: Session = Depends(get_db),
) -> AccountSetupRead:
    """Return safe display data for a pending third-party account setup."""
    pending = get_pending_account_setup(token)
    application = get_active_application_by_client_id(db, pending["client_id"])
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return AccountSetupRead(
        provider=pending["provider"],
        display_name=pending.get("display_name"),
        avatar_url=pending.get("avatar_url"),
        application_name=application.name,
        client_id=application.client_id,
    )


@router.get("/logout")
def browser_logout(
    request: Request,
    response: Response,
    client_id: str,
    post_logout_redirect_uri: str | None = None,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Top-level logout for relying parties (RP-initiated logout).

    Business apps on other origins cannot clear this domain's SSO cookie
    via fetch; they should navigate the browser here instead. The
    post-logout redirect must share an origin with client_id's own
    registered redirect URIs.
    """
    token = request.cookies.get(SSO_COOKIE_NAME)
    if token:
        revoke_sso_session(db, token=token)
        db.commit()
    clear_sso_cookie(response)
    target = "/"
    if post_logout_redirect_uri and is_allowed_logout_redirect(
        db, post_logout_redirect_uri, client_id
    ):
        target = post_logout_redirect_uri
    return RedirectResponse(target, status_code=status.HTTP_302_FOUND)


@router.post("/account-setup", response_model=AccountSetupResponse)
def finish_account_setup(
    payload: AccountSetupRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AccountSetupResponse:
    """Create or link a local account and resume the original OAuth request."""
    # Link mode verifies an existing account's password; without a lockout
    # here, a valid setup token becomes a free password oracle.
    identifier = (payload.identifier or "").strip().lower()
    redis_client = None
    if payload.mode == "link" and identifier:
        redis_client = _check_rate_limit(
            request,
            check_login_lockout,
            log_label="account_setup_link",
            email=identifier,
        )

    try:
        redirect_uri = complete_account_setup(db, response, payload)
    except HTTPException as exc:
        if exc.status_code in (400, 401) and redis_client:
            record_failed_login(redis_client, identifier, get_client_ip(request))
        raise

    if redis_client:
        clear_failed_login(redis_client, identifier, get_client_ip(request))
    return AccountSetupResponse(redirect_uri=redirect_uri)


def _check_rate_limit(request: Request, check_fn, *, log_label: str, email: str | None = None) -> Redis:
    redis_client = get_redis_client()
    client_ip = get_client_ip(request)
    try:
        check_fn(redis_client, email, client_ip)
    except RateLimitExceeded as e:
        logger.warning("rate_limited", label=log_label, email=email, client_ip=client_ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=e.detail,
            headers={"Retry-After": str(e.retry_after)},
        )
    return redis_client


@router.post("/email/login-password", response_model=EmailLoginResponse)
def email_password_login(
    payload: EmailPasswordLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> EmailLoginResponse:
    """Complete username/email + password login and return an authorization code."""
    # Normalize before keying the lockout so identifier variants cannot
    # shard the failure counter.
    normalized_identifier = payload.identifier.strip().lower()
    redis_client = _check_rate_limit(
        request,
        check_login_lockout,
        log_label="password_login",
        email=normalized_identifier,
    )

    try:
        auth_code = complete_password_login(
            db,
            response,
            client_id=payload.client_id,
            identifier=payload.identifier,
            password=payload.password,
            redirect_uri=str(payload.redirect_uri),
            state=payload.state,
        )
    except HTTPException as exc:
        if exc.status_code in (400, 401) and redis_client:
            record_failed_login(
                redis_client, normalized_identifier, get_client_ip(request)
            )
        logger.warning("password_login_failed", identifier=normalized_identifier, detail=exc.detail)
        raise

    if redis_client:
        clear_failed_login(redis_client, normalized_identifier, get_client_ip(request))

    logger.info("password_login_success", identifier=payload.identifier)
    return EmailLoginResponse(
        code=auth_code.code,
        redirect_uri=f"{payload.redirect_uri}?{urlencode({'code': auth_code.code, **({'state': payload.state} if payload.state else {})})}",
        state=payload.state,
    )


@router.post("/sms/request-code", response_model=EmailCodeResponse)
def request_sms_code(
    payload: SmsCodeRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> EmailCodeResponse:
    """Request an SMS login code (captcha-gated, throttled)."""
    redis_client = get_redis_client()
    client_ip = get_client_ip(request)
    try:
        check_captcha_attempt_limit(redis_client, client_ip)
    except RateLimitExceeded as e:
        logger.warning(
            "captcha_gate_limited", label="sms_code", phone=payload.phone, client_ip=client_ip
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=e.detail,
            headers={"Retry-After": str(e.retry_after)},
        )
    if not verify_captcha(payload.captcha_verify_param):
        logger.warning("captcha_verification_failed", phone=payload.phone)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Captcha verification failed",
        )
    try:
        check_sms_rate_limit(redis_client, payload.phone, client_ip)
    except RateLimitExceeded as e:
        logger.warning("rate_limited", label="sms_code", phone=payload.phone, client_ip=client_ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=e.detail,
            headers={"Retry-After": str(e.retry_after)},
        )

    code = issue_sms_code(
        db,
        client_id=payload.client_id,
        phone=payload.phone,
        purpose=payload.purpose,
    )
    return EmailCodeResponse(sent=True, debug_code=code if settings.debug else None)


@router.post("/sms/login", response_model=EmailLoginResponse)
def sms_login(
    payload: SmsLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> EmailLoginResponse:
    """Complete SMS code login and return an authorization code."""
    redis_client = _check_rate_limit(
        request, check_login_lockout, log_label="sms_login", email=payload.phone
    )
    try:
        auth_code = complete_sms_login(
            db,
            response,
            client_id=payload.client_id,
            phone=payload.phone,
            code=payload.code,
            redirect_uri=str(payload.redirect_uri),
            state=payload.state,
        )
    except HTTPException as exc:
        if exc.status_code == 400 and redis_client:
            record_failed_login(redis_client, payload.phone, get_client_ip(request))
        logger.warning("sms_login_failed", phone=payload.phone, detail=exc.detail)
        raise
    if redis_client:
        clear_failed_login(redis_client, payload.phone, get_client_ip(request))
    return EmailLoginResponse(
        code=auth_code.code,
        redirect_uri=f"{payload.redirect_uri}?{urlencode({'code': auth_code.code, **({'state': payload.state} if payload.state else {})})}",
        state=payload.state,
    )


@router.post("/sms/register", response_model=EmailLoginResponse)
def sms_register(
    payload: SmsRegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> EmailLoginResponse:
    """Register a new account with an SMS code and return an authorization code."""
    redis_client = _check_rate_limit(
        request, check_login_lockout, log_label="sms_register", email=payload.phone
    )
    try:
        auth_code = complete_sms_register(
            db,
            response,
            client_id=payload.client_id,
            phone=payload.phone,
            code=payload.code,
            redirect_uri=str(payload.redirect_uri),
            state=payload.state,
        )
    except HTTPException as exc:
        if exc.status_code == 400 and redis_client:
            record_failed_login(redis_client, payload.phone, get_client_ip(request))
        logger.warning("sms_register_failed", phone=payload.phone, detail=exc.detail)
        raise
    if redis_client:
        clear_failed_login(redis_client, payload.phone, get_client_ip(request))
    return EmailLoginResponse(
        code=auth_code.code,
        redirect_uri=f"{payload.redirect_uri}?{urlencode({'code': auth_code.code, **({'state': payload.state} if payload.state else {})})}",
        state=payload.state,
    )


@router.post("/sms/reset-password", response_model=EmailLoginResponse)
def sms_reset_password(
    payload: SmsResetPasswordRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> EmailLoginResponse:
    """Reset a forgotten password with an SMS code; revokes old sessions and logs in."""
    redis_client = _check_rate_limit(
        request, check_login_lockout, log_label="sms_reset", email=payload.phone
    )
    try:
        auth_code = complete_sms_password_reset(
            db,
            response,
            client_id=payload.client_id,
            phone=payload.phone,
            code=payload.code,
            new_password=payload.new_password,
            redirect_uri=str(payload.redirect_uri),
            state=payload.state,
        )
    except HTTPException as exc:
        if exc.status_code == 400 and redis_client:
            record_failed_login(redis_client, payload.phone, get_client_ip(request))
        logger.warning("sms_reset_failed", phone=payload.phone, detail=exc.detail)
        raise
    if redis_client:
        clear_failed_login(redis_client, payload.phone, get_client_ip(request))
    return EmailLoginResponse(
        code=auth_code.code,
        redirect_uri=f"{payload.redirect_uri}?{urlencode({'code': auth_code.code, **({'state': payload.state} if payload.state else {})})}",
        state=payload.state,
    )


# ─── WebAuthn / Passkey endpoints ─────────────────────────────────────────────


@router.post("/webauthn/login/begin", response_model=WebAuthnBeginResponse)
def webauthn_login_begin(
    payload: WebAuthnBeginRequest,
    db: Session = Depends(get_db),
) -> WebAuthnBeginResponse:
    """Start a Passkey login by returning a challenge."""
    options, challenge_id = begin_authentication(db, client_id=payload.client_id)
    return WebAuthnBeginResponse(options=options, challenge_id=challenge_id)


@router.post("/webauthn/login/verify", response_model=EmailLoginResponse)
def webauthn_login_verify(
    payload: WebAuthnVerifyRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> EmailLoginResponse:
    """Verify a Passkey authentication assertion and return an authorization code."""
    code, state = verify_authentication(
        db,
        response,
        client_id=payload.client_id,
        redirect_uri=str(payload.redirect_uri),
        state=payload.state,
        credential=payload.credential,
        challenge_id=payload.challenge_id,
    )
    return EmailLoginResponse(
        code=code,
        redirect_uri=f"{payload.redirect_uri}?{urlencode({'code': code, **({'state': state} if state else {})})}",
        state=state,
    )


@router.post("/webauthn/register/begin", response_model=WebAuthnRegisterBeginResponse)
def webauthn_register_begin(
    payload: WebAuthnRegisterBeginRequest,
    db: Session = Depends(get_db),
) -> WebAuthnRegisterBeginResponse:
    """Start Passkey registration for an existing user."""
    options, challenge_id = begin_registration(
        db,
        client_id=payload.client_id,
        email=str(payload.email),
        display_name=payload.display_name,
    )
    return WebAuthnRegisterBeginResponse(options=options, challenge_id=challenge_id)


@router.post("/webauthn/register/finish", response_model=EmailLoginResponse)
def webauthn_register_finish(
    payload: WebAuthnRegisterFinishRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> EmailLoginResponse:
    """Complete Passkey registration, save the credential, and return an authorization code."""
    code, state = finish_registration(
        db,
        response,
        client_id=payload.client_id,
        redirect_uri=str(payload.redirect_uri),
        state=payload.state,
        email=str(payload.email),
        display_name=payload.display_name,
        credential=payload.credential,
        challenge_id=payload.challenge_id,
    )
    return EmailLoginResponse(
        code=code,
        redirect_uri=f"{payload.redirect_uri}?{urlencode({'code': code, **({'state': state} if state else {})})}",
        state=state,
    )
