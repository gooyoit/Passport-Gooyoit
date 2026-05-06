"""Pydantic schemas for API requests and responses."""

import re

from pydantic import BaseModel, EmailStr, Field, HttpUrl, field_validator


def _password_complexity(password: str) -> str:
    categories = 0
    if re.search(r"[A-Z]", password):
        categories += 1
    if re.search(r"[a-z]", password):
        categories += 1
    if re.search(r"\d", password):
        categories += 1
    if re.search(r"[^A-Za-z0-9]", password):
        categories += 1
    if categories < 3:
        raise ValueError("Password must contain at least 3 of: uppercase, lowercase, digit, special character")
    return password


class EmailCodeRequest(BaseModel):
    """Request an email verification code."""

    client_id: str
    email: EmailStr
    captcha_key: str
    captcha_answer: str = Field(min_length=1, max_length=10)
    purpose: str = "login"


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


class EmailRegisterRequest(BaseModel):
    """Register a new user with email code."""

    client_id: str
    redirect_uri: HttpUrl
    state: str | None = None
    first_name: str = Field(min_length=1, max_length=64)
    last_name: str = Field(min_length=1, max_length=64)
    email: EmailStr
    code: str = Field(min_length=4, max_length=12)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        return _password_complexity(v)


class EmailPasswordLoginRequest(BaseModel):
    """Login with email and password."""

    client_id: str
    redirect_uri: HttpUrl
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
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


class LoginMethodsResponse(BaseModel):
    """Enabled login methods for an application."""

    login_methods: list[str]


class WebAuthnBeginRequest(BaseModel):
    client_id: str


class WebAuthnBeginResponse(BaseModel):
    options: dict
    challenge_id: str


class WebAuthnVerifyRequest(BaseModel):
    client_id: str
    redirect_uri: HttpUrl
    state: str | None = None
    credential: dict
    challenge_id: str


class WebAuthnRegisterBeginRequest(BaseModel):
    client_id: str
    email: EmailStr
    display_name: str | None = None


class WebAuthnRegisterBeginResponse(BaseModel):
    options: dict
    challenge_id: str


class WebAuthnRegisterFinishRequest(BaseModel):
    client_id: str
    redirect_uri: HttpUrl
    state: str | None = None
    email: EmailStr
    display_name: str | None = None
    credential: dict
    challenge_id: str
