"""Add phone login: users.phone columns and phone_verification_codes."""

from alembic import op
import sqlalchemy as sa


revision = "0007_phone_login"
down_revision = "0006_account_identifiers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(32), nullable=True))
    op.add_column(
        "users", sa.Column("phone_verified_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index("ix_users_phone", "users", ["phone"], unique=True)

    op.create_table(
        "phone_verification_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("phone", sa.String(length=32), nullable=False, index=True),
        sa.Column("code_hash", sa.String(length=255), nullable=False),
        sa.Column("purpose", sa.String(length=64), nullable=False, index=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("phone_verification_codes")
    op.drop_index("ix_users_phone", table_name="users")
    op.drop_column("users", "phone_verified_at")
    op.drop_column("users", "phone")
