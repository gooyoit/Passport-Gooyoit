"""FastAPI application factory."""

import hashlib

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.api import auth, health, oauth
from app.core.config import settings
from app.core.logging import setup_logging


def create_app() -> FastAPI:
    """Create the FastAPI application."""
    setup_logging(debug=settings.debug)
    app = FastAPI(title=settings.app_name, debug=settings.debug)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.frontend_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )
    session_key = settings.session_secret_key or hashlib.sha256(
        b"session:" + settings.secret_key.encode()
    ).hexdigest()
    app.add_middleware(
        SessionMiddleware,
        secret_key=session_key,
        same_site="lax",
        https_only=settings.cookie_secure,
    )
    app.include_router(health.router)
    app.include_router(auth.router, prefix="/auth", tags=["auth"])
    app.include_router(oauth.router, prefix="/oauth", tags=["oauth"])
    return app


app = create_app()
