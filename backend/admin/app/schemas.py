"""Pydantic schemas for API requests and responses."""

from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, EmailStr, Field, HttpUrl

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int


# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------

class ApplicationCreate(BaseModel):
    """Create an application."""

    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    redirect_uris: list[HttpUrl]
    enable_public_users: bool = False
    enable_sso: bool = True


class ApplicationRead(BaseModel):
    """Application response."""

    id: int
    client_id: str
    name: str
    description: str | None
    redirect_uris: list[str]
    default_role_id: int | None
    enable_public_users: bool
    enable_sso: bool
    status: str

    model_config = {"from_attributes": True}


class ApplicationCreated(ApplicationRead):
    """Application response that includes the one-time client secret."""

    client_secret: str


class ApplicationUpdate(BaseModel):
    """Update an application."""

    name: str | None = None
    description: str | None = None
    redirect_uris: list[HttpUrl] | None = None
    enable_public_users: bool | None = None
    enable_sso: bool | None = None
    status: str | None = Field(None, pattern="^(active|disabled)$")


class ClientSecretResponse(BaseModel):
    """Newly generated client secret."""

    client_secret: str


class ClientSecretItem(BaseModel):
    """An existing client secret (no plaintext)."""

    id: int
    secret_prefix: str | None
    secret_suffix: str | None
    created_at: datetime


# ---------------------------------------------------------------------------
# Login methods
# ---------------------------------------------------------------------------

class LoginMethodRead(BaseModel):
    """Login method response."""

    id: int
    application_id: int
    method: str
    enabled: bool
    config: dict | None

    model_config = {"from_attributes": True}


class LoginMethodUpsert(BaseModel):
    """Enable or disable one login method."""

    method: str = Field(pattern="^(email_code|email_password|wechat|google|github|passkey)$")
    enabled: bool = True
    config: dict[str, str | bool | int | None] | None = None


# ---------------------------------------------------------------------------
# Roles & permissions
# ---------------------------------------------------------------------------

class RoleCreate(BaseModel):
    """Create a role."""

    code: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    is_default: bool = False


class RoleRead(BaseModel):
    """Role response."""

    id: int
    application_id: int
    code: str
    name: str
    description: str | None
    is_default: bool

    model_config = {"from_attributes": True}


class PermissionCreate(BaseModel):
    """Create a permission."""

    code: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class PermissionRead(BaseModel):
    """Permission response."""

    id: int
    application_id: int
    code: str
    name: str
    description: str | None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

class UserInfo(BaseModel):
    """User identity in an application."""

    id: int
    email: str
    display_name: str | None
    status: str


class UserRead(UserInfo):
    """User response."""

    avatar_url: str | None = None

    model_config = {"from_attributes": True}


class UserStatusUpdate(BaseModel):
    """Update global user status."""

    status: str = Field(pattern="^(active|disabled)$")


# ---------------------------------------------------------------------------
# Application users
# ---------------------------------------------------------------------------

class ApplicationUserRead(BaseModel):
    """Application user response."""

    id: int
    application_id: int
    user_id: int
    user_email: str
    user_display_name: str | None
    user_status: str
    status: str
    roles: list[str]
    permissions: list[str]


class ApplicationUserStatusUpdate(BaseModel):
    """Update application user status."""

    status: str = Field(pattern="^(active|disabled)$")


# ---------------------------------------------------------------------------
# Config & token exchange (admin-specific)
# ---------------------------------------------------------------------------

class TokenExchangeRequest(BaseModel):
    """Request body for exchanging an authorization code for tokens."""

    code: str
    redirect_uri: HttpUrl


class TokenExchangeResponse(BaseModel):
    """Response returned after a successful token exchange."""

    access_token: str
    token_type: str = "Bearer"
    refresh_token: str
    expires_in: int
    user: UserInfo
    roles: list[str]
    permissions: list[str]


class WebAuthnCredentialRead(BaseModel):
    id: int
    user_id: int
    user_email: str
    user_display_name: str | None
    credential_id: str
    sign_count: int
    transports: list[str] | None
    device_name: str | None
    aaguid: str | None
    created_at: datetime
