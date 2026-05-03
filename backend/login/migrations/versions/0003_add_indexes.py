"""Add performance indexes for application_id and user_id columns."""

from alembic import op

revision = "0003_add_indexes"
down_revision = "0002_add_user_password"
branch_labels = None
depends_on = None

NEW_INDEXES = [
    ("idx_app_login_methods_app_id", "application_login_methods", ["application_id"]),
    ("idx_app_users_app_id", "application_users", ["application_id"]),
    ("idx_app_users_user_id", "application_users", ["user_id"]),
    ("idx_roles_app_id", "roles", ["application_id"]),
    ("idx_permissions_app_id", "permissions", ["application_id"]),
    ("idx_user_roles_app_id", "user_roles", ["application_id"]),
    ("idx_user_roles_user_id", "user_roles", ["user_id"]),
    ("idx_auth_codes_app_id", "oauth_authorization_codes", ["application_id"]),
    ("idx_auth_codes_user_id", "oauth_authorization_codes", ["user_id"]),
]


def upgrade() -> None:
    for idx_name, table, columns in NEW_INDEXES:
        op.create_index(idx_name, table, columns)


def downgrade() -> None:
    for idx_name, table, _ in NEW_INDEXES:
        op.drop_index(idx_name, table_name=table)
