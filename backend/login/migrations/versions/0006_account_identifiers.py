"""Add optional username, verified email, and contact phone fields."""

from alembic import op
import sqlalchemy as sa


revision = "0006_account_identifiers"
down_revision = "0005_webauthn_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(64), nullable=True))
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("contact_phone", sa.String(32), nullable=True))
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    # Widen email to nullable before nulling legacy wechat placeholders.
    op.alter_column(
        "users",
        "email",
        existing_type=sa.String(255),
        nullable=True,
    )
    op.execute(
        "UPDATE users SET email = NULL "
        "WHERE email LIKE '%@wechat.oauth.local'"
    )
    op.execute(
        "UPDATE users SET email_verified_at = COALESCE(created_at, CURRENT_TIMESTAMP) "
        "WHERE email IS NOT NULL"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE users SET email = CONCAT('legacy-', id, '@passport.invalid') "
        "WHERE email IS NULL"
    )
    op.alter_column(
        "users",
        "email",
        existing_type=sa.String(255),
        nullable=False,
    )
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "contact_phone")
    op.drop_column("users", "email_verified_at")
    op.drop_column("users", "username")
