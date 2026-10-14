"""Logic tests for the replace-style role assignment endpoint (sqlite in-memory)."""

from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.api.app_detail import set_user_roles
from app.models import Application, ApplicationUser, Base, Role, User, UserRole
from app.schemas import RoleAssignRequest


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(Application(client_id="app_test", name="Test App", redirect_uris=[]))
        session.add(User(email="u@test.com", display_name="U"))
        session.flush()
        session.add_all(
            [
                Role(id=1, application_id=1, code="member", name="Member"),
                Role(id=2, application_id=1, code="editor", name="Editor"),
                Role(id=3, application_id=1, code="super_admin", name="Super"),
                Role(id=9, application_id=2, code="other-app", name="Other"),
            ]
        )
        session.add(ApplicationUser(application_id=1, user_id=1, status="active", joined_at=datetime(2026, 1, 1)))
        session.commit()
        yield session


def assign(db: Session, role_ids: list[int]):
    set_user_roles(
        application_id=1,
        user_id=1,
        payload=RoleAssignRequest(role_ids=role_ids),
        _admin_user_id=99,
        db=db,
    )


def current_role_ids(db: Session) -> set[int]:
    return set(db.scalars(select(UserRole.role_id).where(UserRole.application_id == 1)).all())


def test_assign_from_scratch(db: Session):
    assign(db, [1, 2])
    assert current_role_ids(db) == {1, 2}


def test_replace_removes_unselected_roles(db: Session):
    assign(db, [1, 2])
    assign(db, [2])  # unselect member
    assert current_role_ids(db) == {2}


def test_super_admin_assignment_is_preserved_and_rejected(db: Session):
    db.add(UserRole(application_id=1, user_id=1, role_id=3))  # pre-existing super_admin
    db.commit()

    assign(db, [1])  # replacement must not strip the pre-existing super_admin row
    assert current_role_ids(db) == {1, 3}

    with pytest.raises(HTTPException) as exc_info:
        assign(db, [1, 3])  # targeting super_admin explicitly is rejected
    assert exc_info.value.status_code == 403
    assert current_role_ids(db) == {1, 3}


def test_role_from_other_application_rejected(db: Session):
    with pytest.raises(HTTPException) as exc_info:
        assign(db, [9])
    assert exc_info.value.status_code == 404


def test_unknown_member_rejected(db: Session):
    with pytest.raises(HTTPException) as exc_info:
        set_user_roles(
            application_id=1,
            user_id=42,
            payload=RoleAssignRequest(role_ids=[1]),
            _admin_user_id=99,
            db=db,
        )
    assert exc_info.value.status_code == 404
