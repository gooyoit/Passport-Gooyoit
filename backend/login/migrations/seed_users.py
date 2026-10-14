"""Seed test users into an application.

Usage:
    cd backend/login
    uv run python -m migrations.seed_users --client-id app_xxx [--count 3]

Idempotent: existing users are kept (password untouched) and only their
application membership is ensured. Passwords for newly created users are
printed once at the end.
"""

import argparse
import secrets
import sys
from datetime import UTC, datetime
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.models import Application, ApplicationUser, User, UserStatus


def seed_users(db: Session, client_id: str, count: int, prefix: str, email_domain: str) -> None:
    application = db.scalar(select(Application).where(Application.client_id == client_id))
    if application is None:
        print(f"ERROR: Application with client_id '{client_id}' not found.")
        sys.exit(1)
    print(f"Found application: id={application.id} client_id={client_id}")

    created: list[tuple[str, str]] = []
    for i in range(1, count + 1):
        email = f"{prefix}{i:02d}@{email_domain}"
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            password = secrets.token_urlsafe(12)
            user = User(
                email=email,
                display_name=f"{prefix}{i:02d}",
                hashed_password=hash_password(password),
                status=UserStatus.ACTIVE,
            )
            db.add(user)
            db.flush()
            created.append((email, password))
            print(f"  + created user {email} (id={user.id})")
        else:
            print(f"  = user {email} already exists (id={user.id}), password untouched")

        member = db.scalar(
            select(ApplicationUser).where(
                ApplicationUser.application_id == application.id,
                ApplicationUser.user_id == user.id,
            )
        )
        if member is None:
            db.add(
                ApplicationUser(
                    application_id=application.id,
                    user_id=user.id,
                    status="active",
                    joined_at=datetime.now(UTC),
                )
            )
            print(f"    + linked to application")
        else:
            print(f"    = already linked (status={member.status})")

    db.commit()

    if created:
        print("\nNew accounts (passwords shown ONCE, save them now):")
        for email, password in created:
            print(f"  {email}  {password}")
    else:
        print("\nNo new users created; memberships ensured.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed test users for an application")
    parser.add_argument("--client-id", required=True, help="Application client_id")
    parser.add_argument("--count", type=int, default=3, help="Number of users (default 3)")
    parser.add_argument("--prefix", default="test", help="Email local-part prefix (default test)")
    parser.add_argument("--email-domain", default="gooyoit.com", help="Email domain")
    args = parser.parse_args()

    engine = create_engine(settings.database_url)
    with Session(engine) as db:
        seed_users(db, args.client_id, args.count, args.prefix, args.email_domain)


if __name__ == "__main__":
    main()
