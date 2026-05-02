"""Application configuration."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven application settings."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "Gooyoit Passport Admin"
    debug: bool = False
    database_url: str
    secret_key: str = Field(
        default="dev-secret-change-me-with-32-bytes", min_length=32
    )
    jwt_issuer: str = "gooyoit-passport"
    passport_base_url: str = "http://127.0.0.1:5173"
    admin_client_id: str
    admin_client_secret: str
    cors_origins: list[str] = [
        "http://127.0.0.1:5174",
        "http://localhost:5174",
    ]


@lru_cache
def get_settings() -> Settings:
    """Return cached settings."""
    return Settings()


settings = get_settings()
