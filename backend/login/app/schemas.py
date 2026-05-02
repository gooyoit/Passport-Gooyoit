"""Pydantic schemas for API requests and responses."""

from pydantic import BaseModel, EmailStr, Field, HttpUrl


class EmailCodeRequest(BaseModel):
    """Request an email verification code."""

    client_id: str
    email: EmailStr
    captcha_key: str
    captcha_answer: str = Field(min_length=1, max_length=10)


class EmailCodeResponse(BaseModel):
    """Email verification code response."""

    sent: bool
    debug_code: str | None = None


class CaptchaResponse(BaseModel):
    """Captcha image response."""

    captcha_key: str
    captcha_image: str
    captcha_answer: str | None = None


class EmailLoginRequest(BaseModel):
    """Complete email code login."""

    client_id: str
    redirect_uri: HttpUrl
    email: EmailStr
    code: str = Field(min_length=4, max_length=12)
    state: str | None = None


class EmailLoginResponse(BaseModel):
    """Login completion response."""

    code: str
    redirect_uri: str
    state: str | None = None


class TokenRequest(BaseModel):
    """Authorization code token exchange."""

    client_id: str
    client_secret: str
    code: str
    redirect_uri: HttpUrl


class RefreshTokenRequest(BaseModel):
    """Refresh access token request."""

    client_id: str
    client_secret: str
    refresh_token: str


class LogoutRequest(BaseModel):
    """Logout request."""

    refresh_token: str | None = None
    global_logout: bool = False


class UserInfo(BaseModel):
    """User identity in an application."""

    id: int
    email: str
    display_name: str | None
    status: str


class TokenResponse(BaseModel):
    """OAuth token response."""

    access_token: str
    token_type: str = "Bearer"
    refresh_token: str
    expires_in: int
    user: UserInfo
    roles: list[str]
    permissions: list[str]


class UserInfoResponse(BaseModel):
    """Userinfo response."""

    user: UserInfo
    roles: list[str]
    permissions: list[str]


class OAuthProviderRead(BaseModel):
    """Third-party OAuth provider availability."""

    provider: str
    enabled: bool
    authorization_url: str | None = None
