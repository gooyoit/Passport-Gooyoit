"""Application configuration."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven application settings."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Gooyoit Passport"
    debug: bool = False
    database_url: str
    redis_url: str = "redis://127.0.0.1:6379/0"
    secret_key: str = Field(min_length=32)
    session_secret_key: str = ""
    jwt_issuer: str = "gooyoit-passport"
    cookie_secure: bool = True
    frontend_origins: list[str] = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
    ]

    access_token_ttl_seconds: int = 7200
    refresh_token_ttl_seconds: int = 2_592_000
    authorization_code_ttl_seconds: int = 300
    email_code_ttl_seconds: int = 600
    resend_api_key: str = ""
    captcha_ttl_seconds: int = 300
    captcha_length: int = 4
    rate_limit_email_per_minute: int = 1
    rate_limit_ip_per_hour: int = 10
    rate_limit_failed_attempts: int = 5
    rate_limit_lockout_seconds: int = 900
    sso_session_ttl_seconds: int = 604_800
    log_file: str = "logs/login.log"
    webauthn_rp_id: str = "localhost"
    webauthn_rp_name: str = "Gooyoit Passport"
    webauthn_rp_origin: str = "http://localhost:5173"


@lru_cache
def get_settings() -> Settings:
    """Return cached settings."""
    return Settings()


settings = get_settings()
