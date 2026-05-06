"""Authentication API."""

import structlog
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

logger = structlog.get_logger(__name__)

from app.core.config import settings
from app.core.redis import get_redis_client
from app.db.session import get_db
from app.schemas import (
    CaptchaResponse,
    EmailCodeRequest,
    EmailCodeResponse,
    EmailLoginRequest,
    EmailLoginResponse,
    EmailPasswordLoginRequest,
    EmailRegisterRequest,
    WebAuthnBeginRequest,
    WebAuthnBeginResponse,
    WebAuthnVerifyRequest,
    WebAuthnRegisterBeginRequest,
    WebAuthnRegisterBeginResponse,
    WebAuthnRegisterFinishRequest,
)
from app.services.auth import complete_email_login, complete_email_register, complete_password_login, issue_email_code
from app.services.captcha import generate_captcha, verify_captcha
from app.services.rate_limit import (
    RateLimitExceeded,
    check_login_lockout,
    check_registration_rate_limit,
    check_request_code_rate_limit,
    clear_failed_login,
    get_client_ip,
    record_failed_login,
)
from app.services.webauthn_service import (
    begin_authentication,
    verify_authentication,
    begin_registration,
    finish_registration,
)
from redis import Redis

router = APIRouter()


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


def _check_registration_ip_rate_limit(request: Request) -> None:
    redis_client = get_redis_client()
    client_ip = get_client_ip(request)
    try:
        check_registration_rate_limit(redis_client, client_ip)
    except RateLimitExceeded as e:
        logger.warning("rate_limited", label="register_ip", client_ip=client_ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=e.detail,
            headers={"Retry-After": str(e.retry_after)},
        )


@router.get("/captcha", response_model=CaptchaResponse)
def get_captcha() -> CaptchaResponse:
    """Generate a captcha image."""
    redis_client = get_redis_client()
    data = generate_captcha(redis_client)
    return CaptchaResponse(**data)


@router.post("/email/request-code", response_model=EmailCodeResponse)
def request_email_code(
    payload: EmailCodeRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> EmailCodeResponse:
    """Request an email login code."""
    redis_client = _check_rate_limit(
        request, check_request_code_rate_limit, log_label="request_code", email=str(payload.email)
    )

    if not verify_captcha(redis_client, payload.captcha_key, payload.captcha_answer):
        logger.warning("captcha_verification_failed", email=payload.email)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired captcha",
        )

    code = issue_email_code(db, client_id=payload.client_id, email=str(payload.email), purpose=payload.purpose)
    return EmailCodeResponse(sent=True, debug_code=code if settings.debug else None)


@router.post("/email/login", response_model=EmailLoginResponse)
def email_login(
    payload: EmailLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> EmailLoginResponse:
    """Complete email login and return an authorization code."""
    redis_client = _check_rate_limit(
        request, check_login_lockout, log_label="email_login", email=str(payload.email)
    )

    try:
        auth_code = complete_email_login(
            db,
            response,
            client_id=payload.client_id,
            email=str(payload.email),
            code=payload.code,
            redirect_uri=str(payload.redirect_uri),
            state=payload.state,
        )
    except HTTPException as exc:
        if exc.status_code == 400 and redis_client:
            record_failed_login(redis_client, str(payload.email), get_client_ip(request))
        logger.warning("email_login_failed", email=payload.email, detail=exc.detail)
        raise

    if redis_client:
        clear_failed_login(redis_client, str(payload.email), get_client_ip(request))

    return EmailLoginResponse(
        code=auth_code.code,
        redirect_uri=f"{payload.redirect_uri}?{urlencode({'code': auth_code.code, **({'state': payload.state} if payload.state else {})})}",
        state=payload.state,
    )


@router.post("/email/login-password", response_model=EmailLoginResponse)
def email_password_login(
    payload: EmailPasswordLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> EmailLoginResponse:
    """Complete email + password login and return an authorization code."""
    redis_client = _check_rate_limit(
        request, check_login_lockout, log_label="password_login", email=str(payload.email)
    )

    try:
        auth_code = complete_password_login(
            db,
            response,
            client_id=payload.client_id,
            email=str(payload.email),
            password=payload.password,
            redirect_uri=str(payload.redirect_uri),
            state=payload.state,
        )
    except HTTPException as exc:
        if exc.status_code in (400, 401) and redis_client:
            record_failed_login(redis_client, str(payload.email), get_client_ip(request))
        logger.warning("password_login_failed", email=payload.email, detail=exc.detail)
        raise

    if redis_client:
        clear_failed_login(redis_client, str(payload.email), get_client_ip(request))

    logger.info("password_login_success", email=payload.email)
    return EmailLoginResponse(
        code=auth_code.code,
        redirect_uri=f"{payload.redirect_uri}?{urlencode({'code': auth_code.code, **({'state': payload.state} if payload.state else {})})}",
        state=payload.state,
    )


@router.post("/email/register", response_model=EmailLoginResponse)
def email_register(
    payload: EmailRegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> EmailLoginResponse:
    """Register a new user and return an authorization code."""
    _check_rate_limit(
        request, check_request_code_rate_limit, log_label="register", email=str(payload.email)
    )
    _check_registration_ip_rate_limit(request)

    try:
        auth_code = complete_email_register(
            db,
            response,
            client_id=payload.client_id,
            first_name=payload.first_name,
            last_name=payload.last_name,
            email=str(payload.email),
            code=payload.code,
            password=payload.password,
            redirect_uri=str(payload.redirect_uri),
            state=payload.state,
        )
    except HTTPException as exc:
        logger.warning("register_failed", email=payload.email, detail=exc.detail)
        raise

    logger.info("register_success", email=payload.email, client_id=payload.client_id)
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
