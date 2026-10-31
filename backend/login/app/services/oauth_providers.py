"""Third-party OAuth provider integration using Authlib."""

import os
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from authlib.common.urls import add_params_to_qs, add_params_to_uri
from authlib.integrations.starlette_client import OAuth
from authlib.integrations.starlette_client import StarletteOAuth2App
from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.models import Application, ApplicationLoginMethod
from app.services.applications import validate_redirect_uri

SUPPORTED_PROVIDERS = {"wechat", "google", "github"}


def _wechat_client_auth(client, method, uri, headers, body):
    """Use WeChat's appid/secret token endpoint parameter names."""
    credentials = [
        ("appid", client.client_id),
        ("secret", client.client_secret or ""),
    ]
    if method.upper() == "GET":
        uri = add_params_to_uri(uri, credentials)
    else:
        body = add_params_to_qs(body or "", credentials)
        if "Content-Length" in headers:
            headers["Content-Length"] = str(len(body))
    return uri, headers, body


class WeChatOAuth2App(StarletteOAuth2App):
    """Authlib adapter for WeChat's non-standard OAuth parameter names."""

    async def create_authorization_url(self, redirect_uri=None, **kwargs):
        result = await super().create_authorization_url(redirect_uri, **kwargs)
        parsed = urlsplit(result["url"])
        query = [
            ("appid" if key == "client_id" else key, value)
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        ]
        result["url"] = urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path, urlencode(query), "wechat_redirect")
        )
        return result


def get_enabled_provider_method(
    db: Session,
    *,
    application: Application,
    provider: str,
) -> ApplicationLoginMethod:
    """Return enabled provider login method or raise."""
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown provider")
    method = (
        db.query(ApplicationLoginMethod)
        .filter(
            ApplicationLoginMethod.application_id == application.id,
            ApplicationLoginMethod.method == provider,
            ApplicationLoginMethod.enabled.is_(True),
        )
        .one_or_none()
    )
    if method is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provider is disabled")
    return method


def build_oauth_client(provider: str, config: dict[str, Any] | None):
    """Build an Authlib OAuth client from application login method config.

    client_secret 优先取 config 明文（向后兼容）；否则读 config 里
    client_secret_env 指向的环境变量，让 secret 不落库。
    """
    provider_config = config or {}
    client_id = provider_config.get("client_id")
    client_secret = provider_config.get("client_secret")
    if not client_secret:
        secret_env_name = provider_config.get("client_secret_env")
        if secret_env_name:
            client_secret = os.environ.get(str(secret_env_name))
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provider OAuth client_id/client_secret is not configured",
        )

    oauth = OAuth()
    if provider == "google":
        oauth.register(
            name=provider,
            client_id=client_id,
            client_secret=client_secret,
            server_metadata_url=provider_config.get(
                "server_metadata_url",
                "https://accounts.google.com/.well-known/openid-configuration",
            ),
            client_kwargs={"scope": provider_config.get("scope", "openid email profile")},
        )
    elif provider == "github":
        oauth.register(
            name=provider,
            client_id=client_id,
            client_secret=client_secret,
            access_token_url=provider_config.get(
                "access_token_url",
                "https://github.com/login/oauth/access_token",
            ),
            authorize_url=provider_config.get(
                "authorize_url",
                "https://github.com/login/oauth/authorize",
            ),
            api_base_url=provider_config.get("api_base_url", "https://api.github.com/"),
            client_kwargs={"scope": provider_config.get("scope", "read:user user:email")},
        )
    else:
        oauth.register(
            name=provider,
            client_cls=WeChatOAuth2App,
            client_id=client_id,
            client_secret=client_secret,
            access_token_url=provider_config.get(
                "access_token_url",
                "https://api.weixin.qq.com/sns/oauth2/access_token",
            ),
            authorize_url=provider_config.get(
                "authorize_url",
                "https://open.weixin.qq.com/connect/qrconnect",
            ),
            api_base_url=provider_config.get("api_base_url", "https://api.weixin.qq.com/"),
            access_token_params={"method": "GET"},
            client_kwargs={
                "scope": provider_config.get("scope", "snsapi_login"),
                "token_endpoint_auth_method": _wechat_client_auth,
            },
        )
    return oauth.create_client(provider)


async def authorize_redirect(
    *,
    request: Request,
    db: Session,
    application: Application,
    provider: str,
    redirect_uri: str,
    state: str | None,
) -> Any:
    """Start a provider OAuth redirect through Authlib."""
    if not validate_redirect_uri(application, redirect_uri):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid redirect_uri")
    method = get_enabled_provider_method(db, application=application, provider=provider)
    request.session["passport_oauth_context"] = {
        "client_id": application.client_id,
        "provider": provider,
        "redirect_uri": redirect_uri,
        "state": state,
    }
    client = build_oauth_client(provider, method.config)
    callback_uri = str(request.url_for("oauth_provider_callback", provider=provider))
    return await client.authorize_redirect(request, callback_uri)


async def fetch_provider_profile(provider: str, client: Any, request: Request) -> dict[str, Any]:
    """Fetch normalized provider profile through Authlib."""
    try:
        token = await client.authorize_access_token(request)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="OAuth token exchange failed",
        ) from exc
    if provider == "google":
        profile = token.get("userinfo")
        if profile is None:
            profile = await client.parse_id_token(request, token)
        return {
            "id": str(profile["sub"]),
            "email": profile["email"],
            "name": profile.get("name"),
            "avatar_url": profile.get("picture"),
            "raw": dict(profile),
        }

    if provider == "github":
        user_response = await client.get("user", token=token)
        user_profile = user_response.json()
        email = user_profile.get("email")
        if not email:
            emails_response = await client.get("user/emails", token=token)
            emails = emails_response.json()
            primary = next((item for item in emails if item.get("primary")), emails[0])
            email = primary["email"]
        return {
            "id": str(user_profile["id"]),
            "email": email,
            "name": user_profile.get("name") or user_profile.get("login"),
            "avatar_url": user_profile.get("avatar_url"),
            "raw": user_profile,
        }

    profile_response = await client.get(
        "sns/userinfo",
        params={
            "access_token": token["access_token"],
            "openid": token["openid"],
            "lang": "zh_CN",
        },
        withhold_token=True,
    )
    profile = profile_response.json()
    return {
        "id": str(profile.get("unionid") or profile["openid"]),
        "email": None,
        "name": profile.get("nickname"),
        "avatar_url": profile.get("headimgurl"),
        "raw": profile,
    }
