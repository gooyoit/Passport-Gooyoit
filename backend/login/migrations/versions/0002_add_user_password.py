"""Add hashed_password to users table."""

from alembic import op
import sqlalchemy as sa

revision = "0002_add_user_password"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("hashed_password", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "hashed_password")
