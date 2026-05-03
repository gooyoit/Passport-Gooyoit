"""Authentication API."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis import get_redis_client
from app.db.session import get_db
from app.schemas import (
    CaptchaResponse,
    EmailCodeRequest,
    EmailCodeResponse,
    EmailLoginRequest,
    EmailLoginResponse,
    EmailRegisterRequest,
)
from app.services.auth import complete_email_login, complete_email_register, issue_email_code
from app.services.captcha import generate_captcha, verify_captcha
from app.services.rate_limit import (
    RateLimitExceeded,
    check_login_lockout,
    check_request_code_rate_limit,
    clear_failed_login,
    get_client_ip,
    record_failed_login,
)

router = APIRouter()


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
    redis_client = get_redis_client()
    client_ip = get_client_ip(request)

    try:
        check_request_code_rate_limit(redis_client, str(payload.email), client_ip)
    except RateLimitExceeded as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=e.detail,
            headers={"Retry-After": str(e.retry_after)},
        )

    if not verify_captcha(redis_client, payload.captcha_key, payload.captcha_answer):
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
    redis_client = get_redis_client()
    client_ip = get_client_ip(request)

    try:
        check_login_lockout(redis_client, str(payload.email), client_ip)
    except RateLimitExceeded as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=e.detail,
            headers={"Retry-After": str(e.retry_after)},
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
            record_failed_login(redis_client, str(payload.email), client_ip)
        raise

    if redis_client:
        clear_failed_login(redis_client, str(payload.email), client_ip)

    return EmailLoginResponse(
        code=auth_code.code,
        redirect_uri=f"{payload.redirect_uri}?code={auth_code.code}"
        + (f"&state={payload.state}" if payload.state else ""),
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
    redis_client = get_redis_client()
    client_ip = get_client_ip(request)

    try:
        check_request_code_rate_limit(redis_client, str(payload.email), client_ip)
    except RateLimitExceeded as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=e.detail,
            headers={"Retry-After": str(e.retry_after)},
        )

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
    except HTTPException:
        raise

    return EmailLoginResponse(
        code=auth_code.code,
        redirect_uri=f"{payload.redirect_uri}?code={auth_code.code}"
        + (f"&state={payload.state}" if payload.state else ""),
        state=payload.state,
    )
