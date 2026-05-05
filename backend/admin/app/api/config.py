"""Token-exchange endpoint."""

import logging

import httpx
from fastapi import APIRouter, Cookie, HTTPException, Response, status

from app.schemas import TokenExchangeRequest, TokenExchangeResponse
from app.services.passport import exchange_token, refresh_admin_token

logger = logging.getLogger(__name__)

router = APIRouter(tags=["config"])

ADMIN_REFRESH_TOKEN_COOKIE = "admin_refresh_token"


@router.post(
    "/token-exchange",
    response_model=TokenExchangeResponse,
    response_model_exclude={"refresh_token"},
    status_code=status.HTTP_200_OK,
)
async def token_exchange(payload: TokenExchangeRequest, response: Response) -> TokenExchangeResponse:
    """Exchange an authorization code for access/refresh tokens."""
    try:
        result = await exchange_token(
            code=payload.code,
            redirect_uri=str(payload.redirect_uri),
        )
    except httpx.HTTPStatusError as exc:
        logger.error("token_exchange_failed", status=exc.response.status_code)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Token exchange failed",
        ) from exc
    except Exception:
        logger.exception("token_exchange_error")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Token exchange failed",
        )

    response.set_cookie(
        ADMIN_REFRESH_TOKEN_COOKIE,
        result.refresh_token,
        max_age=30 * 24 * 3600,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )
    return result


@router.post("/token-refresh", response_model=TokenExchangeResponse)
async def token_refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None, alias=ADMIN_REFRESH_TOKEN_COOKIE),
) -> TokenExchangeResponse:
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")
    try:
        result = await refresh_admin_token(refresh_token)
    except httpx.HTTPStatusError as exc:
        response.delete_cookie(ADMIN_REFRESH_TOKEN_COOKIE, path="/")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired",
        ) from exc
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Token refresh failed",
        )
    response.set_cookie(
        ADMIN_REFRESH_TOKEN_COOKIE,
        result.refresh_token,
        max_age=30 * 24 * 3600,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )
    return result


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response):
    response.delete_cookie(ADMIN_REFRESH_TOKEN_COOKIE, path="/")
