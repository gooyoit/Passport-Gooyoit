"""Unit tests for OAuth provider client credential resolution."""
import pytest
from fastapi import HTTPException

from app.services.oauth_providers import build_oauth_client


def test_build_client_uses_plaintext_secret_from_config(monkeypatch):
    client = build_oauth_client(
        "wechat",
        {"client_id": "wx-app", "client_secret": "plain-secret", "client_secret_env": "SHOULD_NOT_BE_USED"},
    )
    assert client.client_id == "wx-app"
    assert client.client_secret == "plain-secret"


def test_build_client_falls_back_to_env_secret(monkeypatch):
    monkeypatch.setenv("PASSPORT_WECHAT_CLIENT_SECRET", "env-secret")
    client = build_oauth_client(
        "wechat",
        {"client_id": "wx-app", "client_secret_env": "PASSPORT_WECHAT_CLIENT_SECRET"},
    )
    assert client.client_secret == "env-secret"


def test_build_client_missing_env_value_is_rejected(monkeypatch):
    monkeypatch.delenv("PASSPORT_WECHAT_CLIENT_SECRET", raising=False)
    with pytest.raises(HTTPException) as exc_info:
        build_oauth_client(
            "wechat",
            {"client_id": "wx-app", "client_secret_env": "PASSPORT_WECHAT_CLIENT_SECRET"},
        )
    assert exc_info.value.status_code == 400


def test_build_client_without_any_secret_is_rejected():
    with pytest.raises(HTTPException) as exc_info:
        build_oauth_client("wechat", {"client_id": "wx-app"})
    assert exc_info.value.status_code == 400
