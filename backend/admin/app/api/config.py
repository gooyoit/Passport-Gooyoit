"""Public configuration and token-exchange endpoints."""

from fastapi import APIRouter, HTTPException, status

from app.config import settings
from app.schemas import PublicConfig, TokenExchangeRequest, TokenExchangeResponse
from app.services.passport import exchange_token

router = APIRouter(tags=["config"])


@router.get("/config", response_model=PublicConfig)
def get_public_config() -> PublicConfig:
    """Return the client_id and Passport base URL needed to initiate OAuth."""
    return PublicConfig(
        client_id=settings.admin_client_id,
        passport_base=settings.passport_base_url,
    )


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
