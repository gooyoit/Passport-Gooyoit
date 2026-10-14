"""Response models mirroring the Passport Gooyoit API schemas."""

from pydantic import BaseModel


class UserInfo(BaseModel):
    """User identity in an application."""

    id: int
    email: str
    display_name: str | None
    status: str


class TokenResponse(BaseModel):
    """OAuth token response (also returned by refresh)."""

    access_token: str
    token_type: str = "Bearer"
    refresh_token: str
    expires_in: int
    user: UserInfo
    roles: list[str]
    permissions: list[str]


class UserInfoResponse(BaseModel):
    """Response of GET /oauth/userinfo."""

    user: UserInfo
    roles: list[str]
    permissions: list[str]


class LogoutResponse(BaseModel):
    """Response of POST /oauth/logout."""

    refresh_token_revoked: bool
    sso_session_revoked: bool
