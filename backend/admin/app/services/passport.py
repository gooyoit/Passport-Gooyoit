"""HTTP client for calling the Passport backend."""

import httpx

from app.config import settings
from app.schemas import TokenExchangeResponse


async def exchange_token(code: str, redirect_uri: str) -> TokenExchangeResponse:
    """Exchange an OAuth authorization code for tokens via Passport.

    Calls ``POST {passport_base_url}/oauth/token`` with the admin
    client credentials and the authorization code received from the
    browser redirect.
    """
    url = f"{settings.passport_api_url}/oauth/token"
    payload = {
        "client_id": settings.admin_client_id,
        "client_secret": settings.admin_client_secret,
        "code": code,
        "redirect_uri": redirect_uri,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()
    return TokenExchangeResponse(**data)
