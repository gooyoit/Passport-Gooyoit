"""HTTP client for calling the Passport backend."""

import httpx

from app.config import settings
from app.schemas import TokenExchangeResponse

_http_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    """Return the module-level httpx.AsyncClient singleton."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=10,
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
        )
    return _http_client


async def close_http_client() -> None:
    """Close the shared httpx client (call on app shutdown)."""
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


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
    client = get_http_client()
    response = await client.post(url, json=payload)
    response.raise_for_status()
    data = response.json()
    return TokenExchangeResponse(**data)


async def refresh_admin_token(refresh_token: str) -> TokenExchangeResponse:
    """Refresh an admin access token via Passport.

    Calls ``POST {passport_base_url}/oauth/token/refresh`` with the admin
    client credentials and the HttpOnly cookie refresh token.
    """
    url = f"{settings.passport_api_url}/oauth/token/refresh"
    payload = {
        "client_id": settings.admin_client_id,
        "client_secret": settings.admin_client_secret,
        "refresh_token": refresh_token,
    }
    client = get_http_client()
    response = await client.post(url, json=payload)
    response.raise_for_status()
    data = response.json()
    return TokenExchangeResponse(**data)
