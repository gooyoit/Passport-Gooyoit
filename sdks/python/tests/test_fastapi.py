"""Tests for the FastAPI integration layer."""

import pytest
import respx
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from httpx import Response

from passport_gooyoit import PassportClient
from passport_gooyoit.fastapi import PassportAuth
from passport_gooyoit.types import UserInfoResponse

API = "https://api.test"

USERINFO_PAYLOAD = {
    "user": {"id": 1, "email": "u@example.com", "display_name": "U", "status": "active"},
    "roles": ["member"],
    "permissions": ["user.read", "user.write"],
}


def build_client() -> PassportClient:
    return PassportClient(
        api_base_url=API,
        login_url="https://login.test",
        client_id="cid",
        client_secret="secret",
    )


def build_app(client: PassportClient) -> FastAPI:
    auth = PassportAuth(client)
    app = FastAPI()

    @app.get("/me")
    def me(user: UserInfoResponse = Depends(auth.current_user)):
        return user

    @app.get("/articles")
    def articles(user=Depends(auth.require_permission("user.read"))):
        return {"ok": True}

    @app.delete("/articles/{article_id}")
    def delete_article(
        article_id: int, user=Depends(auth.require_permission("user.read", "user.write"))
    ):
        return {"deleted": article_id}

    @app.get("/admin")
    def admin(user=Depends(auth.require_role("admin"))):
        return {"ok": True}

    return app


@pytest.fixture
def api() -> TestClient:
    return TestClient(build_app(build_client()))


class TestCurrentUser:
    def test_missing_bearer_returns_401(self, api: TestClient):
        response = api.get("/me")
        assert response.status_code == 401
        assert response.json()["detail"] == "Missing bearer token"

    @respx.mock
    def test_resolves_user(self, api: TestClient):
        respx.get(f"{API}/oauth/userinfo").mock(
            return_value=Response(200, json=USERINFO_PAYLOAD)
        )
        response = api.get("/me", headers={"Authorization": "Bearer at-123"})
        assert response.status_code == 200
        body = response.json()
        assert body["user"]["email"] == "u@example.com"
        assert body["permissions"] == ["user.read", "user.write"]

    @respx.mock
    def test_invalid_token_maps_to_401(self, api: TestClient):
        respx.get(f"{API}/oauth/userinfo").mock(
            return_value=Response(401, json={"detail": "Invalid token"})
        )
        response = api.get("/me", headers={"Authorization": "Bearer bad"})
        assert response.status_code == 401


class TestRequirePermission:
    @respx.mock
    def test_granted(self, api: TestClient):
        respx.get(f"{API}/oauth/userinfo").mock(
            return_value=Response(200, json=USERINFO_PAYLOAD)
        )
        response = api.get("/articles", headers={"Authorization": "Bearer at-123"})
        assert response.status_code == 200

    @respx.mock
    def test_missing_returns_403(self, api: TestClient):
        limited = {
            **USERINFO_PAYLOAD,
            "permissions": ["user.read"],  # has user.read, lacks user.write
        }
        respx.get(f"{API}/oauth/userinfo").mock(
            return_value=Response(200, json=limited)
        )
        response = api.delete("/articles/1", headers={"Authorization": "Bearer at-123"})
        assert response.status_code == 403
        assert "user.write" in response.json()["detail"]


class TestRequireRole:
    @respx.mock
    def test_missing_role_returns_403(self, api: TestClient):
        respx.get(f"{API}/oauth/userinfo").mock(
            return_value=Response(200, json=USERINFO_PAYLOAD)
        )
        response = api.get("/admin", headers={"Authorization": "Bearer at-123"})
        assert response.status_code == 403
        assert "admin" in response.json()["detail"]


class TestCache:
    @respx.mock
    def test_userinfo_cached_per_token(self):
        route = respx.get(f"{API}/oauth/userinfo").mock(
            return_value=Response(200, json=USERINFO_PAYLOAD)
        )
        api = TestClient(build_app(build_client()))

        first = api.get("/me", headers={"Authorization": "Bearer at-123"})
        second = api.get("/me", headers={"Authorization": "Bearer at-123"})

        assert first.status_code == 200
        assert second.status_code == 200
        assert route.call_count == 1  # second hit served from cache
