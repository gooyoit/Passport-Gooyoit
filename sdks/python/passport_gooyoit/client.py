"""Passport Gooyoit HTTP client."""

import secrets
from urllib.parse import urlencode

import httpx

from .types import LogoutResponse, TokenResponse, UserInfoResponse


class PassportError(Exception):
    """Passport request failed."""


class PassportAuthError(PassportError):
    """Passport rejected the request (400/401/403)."""

    def __init__(self, detail: str, status_code: int) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class PassportUnavailableError(PassportError):
    """Passport could not be reached (network error / timeout)."""


class PassportClient:
    """Client for the OAuth 2.0 authorization code flow of Passport Gooyoit.

    ``api_base_url`` points at the Passport API (e.g. https://api.gooyoit.com:8443),
    ``login_url`` at the hosted login page users are redirected to
    (e.g. https://passport.gooyoit.com).
    """

    def __init__(
        self,
        *,
        api_base_url: str,
        login_url: str,
        client_id: str,
        client_secret: str,
        timeout: float = 10.0,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._api_base = api_base_url.rstrip("/")
        self._login_url = login_url.rstrip("/")
        self._client_id = client_id
        self._client_secret = client_secret
        self._client = http_client if http_client is not None else httpx.Client(timeout=timeout)
        self._owns_client = http_client is None

    # -- authorization ------------------------------------------------------

    def authorization_url(
        self,
        redirect_uri: str,
        state: str | None = None,
        application_name: str | None = None,
    ) -> tuple[str, str]:
        """Build the login-page URL and a fresh state if none was given."""
        state = state if state is not None else secrets.token_urlsafe(32)
        params = {
            "client_id": self._client_id,
            "redirect_uri": redirect_uri,
            "state": state,
        }
        if application_name is not None:
            params["application_name"] = application_name
        return f"{self._login_url}/?{urlencode(params)}", state

    @staticmethod
    def verify_state(expected: str, received: str | None) -> bool:
        """Constant-time comparison of the CSRF state."""
        return secrets.compare_digest(expected, received or "")

    # -- token lifecycle ----------------------------------------------------

    def exchange_code(self, code: str, redirect_uri: str) -> TokenResponse:
        """Exchange an authorization code for tokens (POST /oauth/token)."""
        payload = self._request(
            "POST",
            "/oauth/token",
            json={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
        return TokenResponse.model_validate(payload)

    def refresh(self, refresh_token: str) -> TokenResponse:
        """Refresh an access token (POST /oauth/token/refresh)."""
        payload = self._request(
            "POST",
            "/oauth/token/refresh",
            json={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "refresh_token": refresh_token,
            },
        )
        return TokenResponse.model_validate(payload)

    def get_userinfo(self, access_token: str) -> UserInfoResponse:
        """Fetch the live user + roles + permissions (GET /oauth/userinfo)."""
        payload = self._request("GET", "/oauth/userinfo", bearer=access_token)
        return UserInfoResponse.model_validate(payload)

    def logout(self, refresh_token: str | None = None) -> LogoutResponse:
        """Revoke a refresh token (POST /oauth/logout).

        Revoking the Passport SSO session ("global logout") requires the
        browser-side SSO cookie on the Passport domain, so it cannot be done
        from a server-side call; direct the user's browser to the Passport
        logout page instead.
        """
        payload = self._request(
            "POST",
            "/oauth/logout",
            json={"refresh_token": refresh_token},
        )
        return LogoutResponse.model_validate(payload)

    # -- internals ----------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict | None = None,
        bearer: str | None = None,
    ) -> dict:
        headers = {"Authorization": f"Bearer {bearer}"} if bearer else None
        try:
            response = self._client.request(
                method,
                f"{self._api_base}{path}",
                json=json,
                headers=headers,
            )
        except httpx.TransportError as exc:
            raise PassportUnavailableError(f"Cannot reach Passport: {exc}") from exc
        if response.status_code >= 400:
            detail = self._error_detail(response)
            if response.status_code in (400, 401, 403):
                raise PassportAuthError(detail, response.status_code)
            raise PassportError(f"Passport request failed: {response.status_code} {detail}")
        return response.json()

    @staticmethod
    def _error_detail(response: httpx.Response) -> str:
        try:
            data = response.json()
        except ValueError:
            return response.text
        if isinstance(data, dict):
            return str(data.get("detail", response.text))
        return response.text

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "PassportClient":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()
