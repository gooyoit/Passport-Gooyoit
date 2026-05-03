"""OAuth-style endpoints."""

import structlog
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import ApplicationLoginMethod, User, UserStatus
from app.schemas import (
    LoginMethodsResponse,
    LogoutRequest,
    OAuthProviderRead,
    RefreshTokenRequest,
    TokenRequest,
    TokenResponse,
    UserInfo,
    UserInfoResponse,
)
from app.services.applications import get_active_application_by_client_id, validate_redirect_uri
from app.services.auth import (
    SSO_COOKIE_NAME,
    ensure_application_user,
    exchange_authorization_code,
    create_authorization_code,
    get_or_create_oauth_user,
    refresh_access_token,
    revoke_refresh_token,
)
from app.services.oauth_providers import (
    authorize_redirect,
    build_oauth_client,
    fetch_provider_profile,
    get_enabled_provider_method,
)
from app.services.permissions import get_effective_permissions, get_effective_roles
from app.services.sso import create_sso_session, resolve_sso_user_id, revoke_sso_session

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/login-methods", response_model=LoginMethodsResponse)
def login_methods(
    client_id: str,
    db: Session = Depends(get_db),
) -> LoginMethodsResponse:
    """Return enabled login methods for an application (JSON only, never redirects)."""
    application = get_active_application_by_client_id(db, client_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    methods = db.scalars(
        select(ApplicationLoginMethod).where(
            ApplicationLoginMethod.application_id == application.id,
            ApplicationLoginMethod.enabled.is_(True),
        )
    ).all()
    return LoginMethodsResponse(login_methods=[m.method for m in methods])


@router.get("/authorize")
def authorize(
    request: Request,
    client_id: str,
    redirect_uri: str,
    response_type: str = Query(default="code"),
    state: str | None = None,
    db: Session = Depends(get_db),
):
    """Start an Authorization Code flow.

    If a valid Passport SSO session exists, this endpoint can issue a code
    directly. Otherwise it returns the enabled login methods for the client.
    """
    if response_type != "code":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported response_type")

    application = get_active_application_by_client_id(db, client_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if not validate_redirect_uri(application, redirect_uri):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid redirect_uri")

    user_id = resolve_sso_user_id(db, token=request.cookies.get(SSO_COOKIE_NAME))
    if application.enable_sso and user_id:
        user = db.get(User, user_id)
        if user is not None:
            ensure_application_user(db, application=application, user=user)
            auth_code = create_authorization_code(
                db,
                application=application,
                user=user,
                redirect_uri=redirect_uri,
            )
            db.commit()
            params = {"code": auth_code.code}
            if state:
                params["state"] = state
            return RedirectResponse(f"{redirect_uri}?{urlencode(params)}")

    methods = db.scalars(
        select(ApplicationLoginMethod).where(
            ApplicationLoginMethod.application_id == application.id,
            ApplicationLoginMethod.enabled.is_(True),
        )
    ).all()
    return {
        "login_required": True,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "login_methods": [method.method for method in methods],
    }


@router.get("/providers/{provider}", response_model=OAuthProviderRead)
def oauth_provider_status(
    provider: str,
    client_id: str,
    db: Session = Depends(get_db),
) -> OAuthProviderRead:
    """Return third-party OAuth provider availability for an application."""
    if provider not in {"wechat", "google", "github"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown provider")

    application = get_active_application_by_client_id(db, client_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    method = db.scalar(
        select(ApplicationLoginMethod).where(
            ApplicationLoginMethod.application_id == application.id,
            ApplicationLoginMethod.method == provider,
        )
    )
    enabled = bool(method and method.enabled)
    return OAuthProviderRead(provider=provider, enabled=enabled, authorization_url=None)


@router.get("/providers/{provider}/authorize")
async def oauth_provider_authorize(
    request: Request,
    provider: str,
    client_id: str,
    redirect_uri: str,
    state: str | None = None,
    db: Session = Depends(get_db),
):
    """Start third-party OAuth login through Authlib."""
    application = get_active_application_by_client_id(db, client_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return await authorize_redirect(
        request=request,
        db=db,
        application=application,
        provider=provider,
        redirect_uri=redirect_uri,
        state=state,
    )


@router.get("/providers/{provider}/callback", name="oauth_provider_callback")
async def oauth_provider_callback(
    request: Request,
    provider: str,
    db: Session = Depends(get_db),
):
    """Complete third-party OAuth login through Authlib."""
    context = request.session.pop("passport_oauth_context", None)
    if not context or context.get("provider") != provider:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing OAuth context")

    application = get_active_application_by_client_id(db, context["client_id"])
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    method = get_enabled_provider_method(db, application=application, provider=provider)
    client = build_oauth_client(provider, method.config)
    profile = await fetch_provider_profile(provider, client, request)

    user = get_or_create_oauth_user(
        db,
        provider=provider,
        provider_user_id=profile["id"],
        email=profile["email"],
        display_name=profile.get("name"),
        avatar_url=profile.get("avatar_url"),
        raw_profile=profile["raw"],
    )
    ensure_application_user(db, application=application, user=user)
    auth_code = create_authorization_code(
        db,
        application=application,
        user=user,
        redirect_uri=context["redirect_uri"],
    )
    db.commit()
    params = {"code": auth_code.code}
    if context.get("state"):
        params["state"] = context["state"]
    location = f"{context['redirect_uri']}?{urlencode(params)}"

    response = RedirectResponse(location)
    if application.enable_sso:
        sso_token = create_sso_session(db, user_id=user.id)
        response.set_cookie(
            SSO_COOKIE_NAME,
            sso_token,
            max_age=settings.sso_session_ttl_seconds,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
        )
    return response


@router.post("/token", response_model=TokenResponse)
def token(
    payload: TokenRequest,
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Exchange an authorization code for tokens."""
    logger.info("token_exchange_attempt", client_id=payload.client_id)
    access_token, refresh_token, expires_in, user, roles, permissions = exchange_authorization_code(
        db,
        client_id=payload.client_id,
        client_secret=payload.client_secret,
        code=payload.code,
        redirect_uri=str(payload.redirect_uri),
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=expires_in,
        user=UserInfo(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            status=user.status,
        ),
        roles=roles,
        permissions=permissions,
    )


@router.post("/token/refresh", response_model=TokenResponse)
def refresh_token(
    payload: RefreshTokenRequest,
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Refresh an access token using a valid refresh token."""
    logger.info("token_refresh_attempt", client_id=payload.client_id)
    access_token, expires_in, user, roles, permissions = refresh_access_token(
        db,
        client_id=payload.client_id,
        client_secret=payload.client_secret,
        refresh_token=payload.refresh_token,
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=payload.refresh_token,
        expires_in=expires_in,
        user=UserInfo(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            status=user.status,
        ),
        roles=roles,
        permissions=permissions,
    )


@router.post("/logout")
def logout(
    payload: LogoutRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """Revoke refresh token and optionally revoke Passport SSO session."""
    refresh_revoked = False
    if payload.refresh_token:
        refresh_revoked = revoke_refresh_token(db, refresh_token=payload.refresh_token)

    sso_revoked = False
    if payload.global_logout:
        sso_revoked = revoke_sso_session(db, token=request.cookies.get(SSO_COOKIE_NAME))
        response.delete_cookie(SSO_COOKIE_NAME)

    return {"refresh_token_revoked": refresh_revoked, "sso_session_revoked": sso_revoked}


@router.get("/userinfo", response_model=UserInfoResponse)
def userinfo(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserInfoResponse:
    """Return the current user's application-local roles and permissions."""
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    try:
        claims = decode_access_token(authorization.removeprefix("Bearer ").strip())
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    user = db.get(User, int(claims["sub"]))
    if user is None or user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")

    application_id = int(claims["application_id"])
    roles = [role.code for role in get_effective_roles(db, application_id, user.id)]
    permissions = get_effective_permissions(db, application_id, user.id)
    return UserInfoResponse(
        user=UserInfo(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            status=user.status,
        ),
        roles=roles,
        permissions=permissions,
    )
