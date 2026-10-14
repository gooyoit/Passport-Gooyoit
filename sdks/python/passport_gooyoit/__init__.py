"""Client SDK for Passport Gooyoit SSO (OAuth 2.0 authorization code flow)."""

from .cache import TTLCache
from .client import PassportAuthError, PassportClient, PassportError, PassportUnavailableError
from .types import LogoutResponse, TokenResponse, UserInfo, UserInfoResponse

__version__ = "0.1.0"

__all__ = [
    "LogoutResponse",
    "PassportAuthError",
    "PassportClient",
    "PassportError",
    "PassportUnavailableError",
    "TTLCache",
    "TokenResponse",
    "UserInfo",
    "UserInfoResponse",
]
