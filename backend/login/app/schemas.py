"""Pydantic schemas for API requests and responses."""

import re

from pydantic import BaseModel, EmailStr, Field, HttpUrl, field_validator, model_validator


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


class EmailCodeResponse(BaseModel):
    """Email verification code response."""

    sent: bool
    debug_code: str | None = None


class EmailPasswordLoginRequest(BaseModel):
    """Login or register with email; identifier remains for legacy clients."""

    client_id: str
    redirect_uri: HttpUrl
    email: EmailStr | None = None
    identifier: str | None = Field(default=None, min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=128)
    state: str | None = None
    # Default keeps the previous behaviour for clients that never send it.
    remember_me: bool = True

    @model_validator(mode="after")
    def require_email_or_identifier(self):
        if self.email is None and not self.identifier:
            raise ValueError("Email is required")
        return self


def _normalize_phone(value: str) -> str:
    """Canonicalize CN mobile numbers to one bucket per handset: strip separators and the +86 prefix."""
    digits = re.sub(r"[\s()-]", "", value)
    if digits.startswith("+86"):
        digits = digits[3:]
    elif digits.startswith("86") and len(digits) == 13:
        digits = digits[2:]
    if not re.fullmatch(r"1[3-9]\d{9}", digits):
        raise ValueError("Invalid phone number")
    return digits


class SmsCodeRequest(BaseModel):
    """Request an SMS verification code."""

    client_id: str
    phone: str
    captcha_verify_param: str = Field(min_length=1, max_length=8192)
    purpose: str = Field(default="login", pattern="^(login|register|reset_password|bind_phone)$")

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return _normalize_phone(value)


class SmsLoginRequest(BaseModel):
    """Complete SMS code login."""

    client_id: str
    redirect_uri: HttpUrl
    phone: str
    code: str = Field(min_length=4, max_length=12)
    state: str | None = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return _normalize_phone(value)


class SmsRegisterRequest(BaseModel):
    """Register a new user with an SMS code (no password; set it later)."""

    client_id: str
    redirect_uri: HttpUrl
    phone: str
    code: str = Field(min_length=4, max_length=12)
    state: str | None = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return _normalize_phone(value)


class SmsResetPasswordRequest(BaseModel):
    """Reset a forgotten password with an SMS code."""

    client_id: str
    redirect_uri: HttpUrl
    phone: str
    code: str = Field(min_length=4, max_length=12)
    new_password: str = Field(min_length=8, max_length=128)
    state: str | None = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return _normalize_phone(value)

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        return _password_complexity(v)


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
    # NOTE: `email` is not proof of ownership. It is attached by the email
    # sign-in, email binding and OAuth flows without an address round-trip.
    # Do not publish an `email_verified` claim until a verification flow
    # writes `User.email_verified_at` on a proof-backed path.
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
    # Lets the binding page link back to the originating application's login
    # page even when the URL it was opened with carries only a token.
    redirect_uri: str
    state: str | None


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
    mode: str = Field(pattern="^(new|link)$")
    username: str | None = Field(default=None, min_length=3, max_length=64)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    code: str | None = Field(default=None, min_length=4, max_length=12)
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

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        return _normalize_phone(value) if value else None

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


class AccountEmailBindRequest(BaseModel):
    """Bind an email to the current account (format-checked only)."""

    email: EmailStr


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


class AccountPhoneCodeRequest(BaseModel):
    """Request an SMS code to bind a phone as a login credential.

    captcha_verify_param is optional because Bearer callers skip the captcha;
    the cookie path still fails closed when it is missing (empty string never
    verifies).
    """

    phone: str
    captcha_verify_param: str = Field(default="", max_length=8192)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return _normalize_phone(value)


class AccountPhoneBindRequest(BaseModel):
    """Verify the SMS code and attach the phone to the current account."""

    phone: str
    code: str = Field(min_length=4, max_length=12)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return _normalize_phone(value)


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
