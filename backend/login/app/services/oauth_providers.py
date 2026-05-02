"""Third-party OAuth provider integration using Authlib."""

from typing import Any

from authlib.integrations.starlette_client import OAuth
from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.models import Application, ApplicationLoginMethod
from app.services.applications import validate_redirect_uri

SUPPORTED_PROVIDERS = {"wechat", "google", "github"}


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
    """Build an Authlib OAuth client from application login method config."""
    provider_config = config or {}
    client_id = provider_config.get("client_id")
    client_secret = provider_config.get("client_secret")
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
            client_kwargs={"scope": provider_config.get("scope", "snsapi_login")},
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
    token = await client.authorize_access_token(request)
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

    profile_response = await client.get("sns/userinfo", token=token)
    profile = profile_response.json()
    return {
        "id": str(profile["openid"]),
        "email": profile.get("email") or f"{profile['openid']}@wechat.oauth.local",
        "name": profile.get("nickname"),
        "avatar_url": profile.get("headimgurl"),
        "raw": profile,
    }
