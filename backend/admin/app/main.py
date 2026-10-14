"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.app_detail import router as app_detail_router
from app.api.applications import router as applications_router
from app.api.auth import router as auth_router
from app.api.config import router as config_router
from app.api.users import router as users_router
from app.config import settings
from app.services.passport import close_http_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_http_client()


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    app = FastAPI(
        title=settings.app_name,
        docs_url="/docs" if settings.debug else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

    app.include_router(config_router)
    app.include_router(auth_router)
    app.include_router(applications_router)
    app.include_router(users_router)
    app.include_router(app_detail_router)

    return app


app = create_app()
