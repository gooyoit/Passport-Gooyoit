"""Global user management endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import require_admin
from app.models import User
from app.schemas import PaginatedResponse, UserRead, UserStatusUpdate

router = APIRouter(tags=["users"], dependencies=[Depends(require_admin)])


@router.get("/users", response_model=PaginatedResponse[UserRead])
def list_users(
    db: Session = Depends(get_db),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> PaginatedResponse[UserRead]:
    """List global users."""
    total = db.scalar(select(func.count()).select_from(User)) or 0
    items = list(
        db.scalars(
            select(User)
            .order_by(User.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return {"items": items, "total": total}


@router.patch("/users/{user_id}/status", response_model=UserRead)
def update_user_status(
    user_id: int,
    payload: UserStatusUpdate,
    db: Session = Depends(get_db),
) -> User:
    """Enable or disable a global user."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    user.status = payload.status
    db.commit()
    db.refresh(user)
    return user
