"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.app_detail import router as app_detail_router
from app.api.applications import router as applications_router
from app.api.auth import router as auth_router
from app.api.config import router as config_router
from app.api.users import router as users_router
from app.config import settings


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    app = FastAPI(
        title=settings.app_name,
        docs_url="/docs" if settings.debug else None,
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    app.include_router(config_router)
    app.include_router(auth_router)
    app.include_router(applications_router)
    app.include_router(users_router)
    app.include_router(app_detail_router)

    return app


app = create_app()
