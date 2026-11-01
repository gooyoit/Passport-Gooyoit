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
    purpose: str = Field(default="login", pattern="^(login|register|bind)$")


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
    """Login with username or email and password."""

    client_id: str
    redirect_uri: HttpUrl
    identifier: str = Field(min_length=1, max_length=255)
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
    username: str | None = None
    email: str | None
    display_name: str | None
    status: str


class AccountSetupRead(BaseModel):
    """Pending third-party account setup context."""

    provider: str
    display_name: str | None
    avatar_url: str | None
    application_name: str
    client_id: str


def _validate_username_format(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{2,63}", value):
        raise ValueError("Username may contain lowercase letters, digits, underscores, and hyphens")
    return value


def _normalize_contact_phone(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    normalized = re.sub(r"[\s()-]", "", value)
    if not re.fullmatch(r"\+?[0-9]{7,20}", normalized):
        raise ValueError("Invalid contact phone")
    return normalized


class AccountSetupRequest(BaseModel):
    """Create a local account or link a provider to an existing account."""

    token: str = Field(min_length=32, max_length=256)
    mode: str = Field(pattern="^(new|link|skip)$")
    username: str | None = Field(default=None, min_length=3, max_length=64)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    email: EmailStr | None = None
    email_code: str | None = Field(default=None, min_length=4, max_length=12)
    contact_phone: str | None = Field(default=None, max_length=32)
    identifier: str | None = Field(default=None, max_length=255)
    existing_password: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str | None) -> str | None:
        return _validate_username_format(value)

    @field_validator("password")
    @classmethod
    def validate_optional_password(cls, value: str | None) -> str | None:
        return _password_complexity(value) if value else None

    @field_validator("contact_phone")
    @classmethod
    def validate_contact_phone(cls, value: str | None) -> str | None:
        return _normalize_contact_phone(value)


class AccountSetupResponse(BaseModel):
    """Final redirect after completing a third-party account setup."""

    redirect_uri: str


class AccountIdentityItem(BaseModel):
    """One login credential attached to a Passport account."""

    provider: str
    provider_email: str | None = None


class AccountProfileUser(BaseModel):
    """Passport account fields visible to the account owner."""

    id: int
    username: str | None = None
    email: str | None = None
    email_verified: bool = False
    contact_phone: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    status: str


class AccountProfileResponse(BaseModel):
    """Current binding state of a Passport account."""

    user: AccountProfileUser
    has_password: bool
    identities: list[AccountIdentityItem]


class AccountEmailCodeRequest(BaseModel):
    """Send a bind-purpose verification code to an email."""

    email: EmailStr
    captcha_key: str | None = None
    captcha_answer: str | None = Field(default=None, min_length=1, max_length=10)


class AccountEmailBindRequest(BaseModel):
    """Bind a verified email to the current account."""

    email: EmailStr
    code: str = Field(min_length=4, max_length=12)


class AccountCredentialsRequest(BaseModel):
    """Set or update username/password/contact phone for the current account."""

    username: str | None = Field(default=None, min_length=3, max_length=64)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    contact_phone: str | None = Field(default=None, max_length=32)
    current_password: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str | None) -> str | None:
        return _validate_username_format(value)

    @field_validator("password")
    @classmethod
    def validate_optional_password(cls, value: str | None) -> str | None:
        return _password_complexity(value) if value else None

    @field_validator("contact_phone")
    @classmethod
    def validate_contact_phone(cls, value: str | None) -> str | None:
        return _normalize_contact_phone(value)


class AccountLinkRequest(BaseModel):
    """Merge the current third-party-only account into an existing one."""

    identifier: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=128)


class AccountLinkResponse(BaseModel):
    """Result of merging into an existing account.

    Bearer callers get a fresh access token for the target account; the
    old one dies with the merged-away user.
    """

    profile: AccountProfileResponse
    access_token: str | None = None
    token_type: str = "Bearer"
    expires_in: int | None = None


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
    has_password: bool = False
    identities: list[AccountIdentityItem] = []


class OAuthProviderRead(BaseModel):
    """Third-party OAuth provider availability."""

    provider: str
    enabled: bool
    authorization_url: str | None = None


class LoginMethodsResponse(BaseModel):
    """Enabled login methods for an application."""

    login_methods: list[str]
    application_name: str
    allow_registration: bool = False


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
