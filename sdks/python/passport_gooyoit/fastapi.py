"""FastAPI integration: dependencies for auth and RBAC checks.

Import path: ``from passport_gooyoit.fastapi import PassportAuth``.
Requires the ``fastapi`` extra: ``pip install passport-gooyoit[fastapi]``.
"""

from fastapi import Depends, HTTPException, Request

from .cache import TTLCache
from .client import PassportAuthError, PassportClient
from .types import UserInfoResponse


class PassportAuth:
    """Expose Passport identity and RBAC as FastAPI dependencies."""

    def __init__(self, client: PassportClient, *, cache_ttl: float = 60.0) -> None:
        self.client = client
        self._cache = TTLCache(cache_ttl)

    def current_user(self, request: Request) -> UserInfoResponse:
        """Dependency: resolve the bearer token to user + roles + permissions.

        Defined as a sync callable on purpose: Starlette runs it in a
        threadpool, so the userinfo HTTP call never blocks the event loop.
        """
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing bearer token")
        token = header.removeprefix("Bearer ").strip()

        cached = self._cache.get(token)
        if cached is not None:
            return cached
        try:
            info = self.client.get_userinfo(token)
        except PassportAuthError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        self._cache.set(token, info)
        return info

    def require_permission(self, *codes: str):
        """Dependency factory: require ALL listed permission codes (AND)."""

        def checker(user: UserInfoResponse = Depends(self.current_user)) -> UserInfoResponse:
            missing = [code for code in codes if code not in user.permissions]
            if missing:
                raise HTTPException(
                    status_code=403,
                    detail=f"Missing permission: {', '.join(missing)}",
                )
            return user

        return checker

    def require_role(self, *codes: str):
        """Dependency factory: require ALL listed role codes (AND)."""

        def checker(user: UserInfoResponse = Depends(self.current_user)) -> UserInfoResponse:
            missing = [code for code in codes if code not in user.roles]
            if missing:
                raise HTTPException(
                    status_code=403,
                    detail=f"Missing role: {', '.join(missing)}",
                )
            return user

        return checker
