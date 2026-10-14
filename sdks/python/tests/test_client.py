"""Unit tests for PassportClient (all HTTP calls mocked with respx)."""

import httpx
import pytest
import respx
from httpx import Response

from passport_gooyoit import (
    PassportAuthError,
    PassportClient,
    PassportError,
    PassportUnavailableError,
)

API = "https://api.test"
LOGIN = "https://login.test"

TOKEN_PAYLOAD = {
    "access_token": "at-123",
    "refresh_token": "rt-456",
    "token_type": "Bearer",
    "expires_in": 7200,
    "user": {"id": 1, "email": "u@example.com", "display_name": "U", "status": "active"},
    "roles": ["member"],
    "permissions": ["user.read"],
}

USERINFO_PAYLOAD = {
    "user": {"id": 1, "email": "u@example.com", "display_name": "U", "status": "active"},
    "roles": ["member"],
    "permissions": ["user.read"],
}


@pytest.fixture
def client() -> PassportClient:
    return PassportClient(
        api_base_url=API,
        login_url=LOGIN,
        client_id="cid",
        client_secret="secret",
    )


class TestAuthorizationUrl:
    def test_builds_url_and_generates_state(self, client: PassportClient):
        url, state = client.authorization_url("https://app.test/callback")
        assert url.startswith(LOGIN + "/?")
        assert f"client_id=cid" in url
        assert "redirect_uri=https%3A%2F%2Fapp.test%2Fcallback" in url
        assert f"state={state}" in url
        assert len(state) >= 32

    def test_custom_state_and_application_name(self, client: PassportClient):
        url, state = client.authorization_url(
            "https://app.test/callback",
            state="my-state",
            application_name="My App",
        )
        assert state == "my-state"
        assert "application_name=My+App" in url

    def test_verify_state(self, client: PassportClient):
        assert client.verify_state("abc", "abc") is True
        assert client.verify_state("abc", "xyz") is False
        assert client.verify_state("abc", None) is False


class TestExchangeCode:
    @respx.mock
    def test_success(self, client: PassportClient):
        route = respx.post(f"{API}/oauth/token").mock(
            return_value=Response(200, json=TOKEN_PAYLOAD)
        )
        result = client.exchange_code("auth-code", "https://app.test/callback")

        assert result.access_token == "at-123"
        assert result.refresh_token == "rt-456"
        assert result.user.email == "u@example.com"
        assert result.permissions == ["user.read"]

        sent = route.calls.last.request.read()
        assert '"code":"auth-code"' in sent.decode()
        assert '"client_id":"cid"' in sent.decode()
        assert '"client_secret":"secret"' in sent.decode()

    @respx.mock
    def test_invalid_code_raises_auth_error(self, client: PassportClient):
        respx.post(f"{API}/oauth/token").mock(
            return_value=Response(401, json={"detail": "Invalid authorization code"})
        )
        with pytest.raises(PassportAuthError) as exc_info:
            client.exchange_code("bad", "https://app.test/callback")
        assert exc_info.value.status_code == 401
        assert "Invalid authorization code" in str(exc_info.value)


class TestRefresh:
    @respx.mock
    def test_success(self, client: PassportClient):
        route = respx.post(f"{API}/oauth/token/refresh").mock(
            return_value=Response(200, json=TOKEN_PAYLOAD)
        )
        result = client.refresh("rt-456")
        assert result.access_token == "at-123"
        assert '"refresh_token":"rt-456"' in route.calls.last.request.read().decode()


class TestUserinfo:
    @respx.mock
    def test_sends_bearer_token(self, client: PassportClient):
        route = respx.get(f"{API}/oauth/userinfo").mock(
            return_value=Response(200, json=USERINFO_PAYLOAD)
        )
        result = client.get_userinfo("at-123")

        assert result.roles == ["member"]
        assert route.calls.last.request.headers["Authorization"] == "Bearer at-123"

    @respx.mock
    def test_invalid_token_raises_auth_error(self, client: PassportClient):
        respx.get(f"{API}/oauth/userinfo").mock(
            return_value=Response(401, json={"detail": "Invalid token"})
        )
        with pytest.raises(PassportAuthError):
            client.get_userinfo("bad-token")


class TestLogout:
    @respx.mock
    def test_revoke(self, client: PassportClient):
        route = respx.post(f"{API}/oauth/logout").mock(
            return_value=Response(200, json={"refresh_token_revoked": True, "sso_session_revoked": False})
        )
        result = client.logout("rt-456")
        assert result.refresh_token_revoked is True
        body = route.calls.last.request.read().decode()
        assert '"refresh_token":"rt-456"' in body
        assert "global_logout" not in body


class TestUnexpectedErrors:
    @respx.mock
    def test_server_error_raises_passport_error(self, client: PassportClient):
        respx.get(f"{API}/oauth/userinfo").mock(return_value=Response(500, text="boom"))
        with pytest.raises(PassportError):
            client.get_userinfo("at-123")

    @respx.mock
    def test_non_dict_json_error_body(self, client: PassportClient):
        respx.get(f"{API}/oauth/userinfo").mock(
            return_value=Response(502, json=["bad", "gateway"])
        )
        with pytest.raises(PassportError):
            client.get_userinfo("at-123")

    @respx.mock
    def test_network_error_raises_unavailable(self, client: PassportClient):
        respx.get(f"{API}/oauth/userinfo").mock(
            side_effect=httpx.ConnectError("connection refused")
        )
        with pytest.raises(PassportUnavailableError):
            client.get_userinfo("at-123")
