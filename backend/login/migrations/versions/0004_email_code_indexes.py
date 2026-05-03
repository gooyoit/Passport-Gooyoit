"""Add composite index on email_verification_codes and missing indexes."""

from alembic import op

revision = "0004_email_code_indexes"
down_revision = "0003_add_indexes"
branch_labels = None
depends_on = None

NEW_INDEXES = [
    ("idx_email_codes_email_purpose", "email_verification_codes", ["email", "purpose"]),
    ("idx_user_identities_user_id", "user_identities", ["user_id"]),
    ("idx_role_permissions_role_id", "role_permissions", ["role_id"]),
    ("idx_role_permissions_permission_id", "role_permissions", ["permission_id"]),
]


def upgrade() -> None:
    for idx_name, table, columns in NEW_INDEXES:
        op.create_index(idx_name, table, columns)


def downgrade() -> None:
    for idx_name, table, _ in NEW_INDEXES:
        op.drop_index(idx_name, table_name=table)
