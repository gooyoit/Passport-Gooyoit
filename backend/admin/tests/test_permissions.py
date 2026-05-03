"""Admin RBAC permission tests."""

import pytest
from unittest.mock import MagicMock


class TestGetEffectiveRoles:
    def test_returns_empty_for_missing_application(self):
        from app.services.permissions import get_effective_roles

        db = MagicMock()
        db.get.return_value = None
        assert get_effective_roles(db, application_id=9999, user_id=1) == []

    def test_returns_empty_for_inactive_application(self):
        from app.services.permissions import get_effective_roles

        db = MagicMock()
        app = MagicMock()
        app.status = "inactive"
        db.get.return_value = app
        assert get_effective_roles(db, application_id=1, user_id=1) == []

    def test_returns_empty_for_missing_membership(self):
        from app.services.permissions import get_effective_roles

        db = MagicMock()
        app = MagicMock()
        app.status = "active"
        app.default_role_id = None
        db.get.return_value = app
        db.scalar.return_value = None
        assert get_effective_roles(db, application_id=1, user_id=1) == []

    def test_returns_empty_for_disabled_membership(self):
        from app.services.permissions import get_effective_roles

        db = MagicMock()
        app = MagicMock()
        app.status = "active"
        app.default_role_id = None
        db.get.return_value = app
        membership = MagicMock()
        membership.status = "disabled"
        db.scalar.return_value = membership
        assert get_effective_roles(db, application_id=1, user_id=1) == []

    def test_returns_default_role(self):
        from app.services.permissions import get_effective_roles

        db = MagicMock()
        app = MagicMock()
        app.status = "active"
        app.default_role_id = 10
        default_role = MagicMock(id=10, code="member", name="Member")
        db.get.side_effect = lambda model, pk: app if pk == 1 else default_role
        membership = MagicMock()
        membership.status = "active"
        db.scalar.return_value = membership
        result_scalars = MagicMock()
        result_scalars.all.return_value = []
        db.scalars.return_value = result_scalars
        roles = get_effective_roles(db, application_id=1, user_id=1)
        assert len(roles) == 1
        assert roles[0].code == "member"

    def test_does_not_duplicate_default_and_explicit_role(self):
        from app.services.permissions import get_effective_roles

        db = MagicMock()
        app = MagicMock()
        app.status = "active"
        app.default_role_id = 10
        shared_role = MagicMock(id=10, code="member", name="Member")
        db.get.side_effect = lambda model, pk: app if pk == 1 else shared_role
        membership = MagicMock()
        membership.status = "active"
        db.scalar.return_value = membership
        result_scalars = MagicMock()
        result_scalars.all.return_value = [shared_role]
        db.scalars.return_value = result_scalars
        roles = get_effective_roles(db, application_id=1, user_id=1)
        assert len(roles) == 1

    def test_returns_default_and_explicit_roles(self):
        from app.services.permissions import get_effective_roles

        db = MagicMock()
        app = MagicMock()
        app.status = "active"
        app.default_role_id = 10
        default_role = MagicMock(id=10, code="member", name="Member")
        admin_role = MagicMock(id=20, code="admin", name="Admin")
        db.get.side_effect = lambda model, pk: {1: app, 10: default_role}.get(pk)
        membership = MagicMock()
        membership.status = "active"
        db.scalar.return_value = membership
        result_scalars = MagicMock()
        result_scalars.all.return_value = [admin_role]
        db.scalars.return_value = result_scalars
        roles = get_effective_roles(db, application_id=1, user_id=1)
        assert len(roles) == 2
        codes = {r.code for r in roles}
        assert codes == {"member", "admin"}


class TestGetEffectivePermissions:
    def test_returns_empty_for_missing_application(self):
        from app.services.permissions import get_effective_permissions

        db = MagicMock()
        db.get.return_value = None
        assert get_effective_permissions(db, application_id=9999, user_id=1) == []

    def test_returns_empty_for_inactive_application(self):
        from app.services.permissions import get_effective_permissions

        db = MagicMock()
        app = MagicMock()
        app.status = "inactive"
        db.get.return_value = app
        assert get_effective_permissions(db, application_id=1, user_id=1) == []

    def test_returns_empty_for_missing_membership(self):
        from app.services.permissions import get_effective_permissions

        db = MagicMock()
        app = MagicMock()
        app.status = "active"
        app.default_role_id = None
        db.get.return_value = app
        db.scalar.return_value = None
        assert get_effective_permissions(db, application_id=1, user_id=1) == []

    def test_returns_sorted_permissions(self):
        from app.services.permissions import get_effective_permissions

        db = MagicMock()
        app = MagicMock()
        app.status = "active"
        app.default_role_id = 10
        role = MagicMock(id=10, code="admin")
        db.get.side_effect = lambda model, pk: {1: app, 10: role}.get(pk)
        membership = MagicMock()
        membership.status = "active"
        db.scalar.return_value = membership
        result_scalars = MagicMock()
        result_scalars.all.return_value = [role]
        db.scalars.return_value = result_scalars
        db.execute.return_value.all.return_value = [("zebra",), ("apple",)]
        perms = get_effective_permissions(db, application_id=1, user_id=1)
        assert perms == ["apple", "zebra"]


class TestGetEffectivePermissionsForUsers:
    def test_returns_empty_dict_for_empty_user_ids(self):
        from app.services.permissions import get_effective_permissions_for_users

        db = MagicMock()
        assert get_effective_permissions_for_users(db, 1, []) == {}

    def test_returns_empty_list_for_each_user_when_app_missing(self):
        from app.services.permissions import get_effective_permissions_for_users

        db = MagicMock()
        db.get.return_value = None
        result = get_effective_permissions_for_users(db, 9999, [1, 2])
        assert result == {1: [], 2: []}

    def test_returns_empty_list_for_each_user_when_app_inactive(self):
        from app.services.permissions import get_effective_permissions_for_users

        db = MagicMock()
        app = MagicMock()
        app.status = "inactive"
        db.get.return_value = app
        result = get_effective_permissions_for_users(db, 1, [1, 2])
        assert result == {1: [], 2: []}

    def test_returns_empty_when_no_roles(self):
        from app.services.permissions import get_effective_permissions_for_users

        db = MagicMock()
        app = MagicMock()
        app.status = "active"
        app.default_role_id = None
        db.get.return_value = app
        result_scalars = MagicMock()
        result_scalars.all.return_value = []
        db.scalars.return_value = result_scalars
        result = get_effective_permissions_for_users(db, 1, [10, 20])
        assert result == {10: [], 20: []}
