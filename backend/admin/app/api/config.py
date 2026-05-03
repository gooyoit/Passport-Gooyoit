"""Token-exchange endpoint."""

import logging

import httpx

from fastapi import APIRouter, HTTPException, status

from app.schemas import TokenExchangeRequest, TokenExchangeResponse
from app.services.passport import exchange_token

logger = logging.getLogger(__name__)

router = APIRouter(tags=["config"])


@router.post(
    "/token-exchange",
    response_model=TokenExchangeResponse,
    status_code=status.HTTP_200_OK,
)
async def token_exchange(payload: TokenExchangeRequest) -> TokenExchangeResponse:
    """Exchange an authorization code for access/refresh tokens."""
    try:
        return await exchange_token(
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
