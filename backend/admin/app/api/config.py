"""Token-exchange endpoint."""

from fastapi import APIRouter, HTTPException, status

from app.schemas import TokenExchangeRequest, TokenExchangeResponse
from app.services.passport import exchange_token

router = APIRouter(tags=["config"])


@router.post(
    "/token-exchange",
    response_model=TokenExchangeResponse,
    status_code=status.HTTP_200_OK,
)
async def token_exchange(payload: TokenExchangeRequest) -> TokenExchangeResponse:
    """Exchange an authorization code for access/refresh tokens.

    Calls Passport's ``POST /oauth/token`` with the admin client credentials.
    """
    try:
        return await exchange_token(
            code=payload.code,
            redirect_uri=str(payload.redirect_uri),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Token exchange failed: {exc}",
        ) from exc
