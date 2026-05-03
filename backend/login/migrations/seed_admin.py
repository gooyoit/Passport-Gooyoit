"""Seed admin roles and permissions into the Passport database.

Usage:
    cd backend/login
    python -m migrations.seed_admin

Requires ADMIN_CLIENT_ID env var or pass --client-id argument.
"""

import argparse
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.core.config import settings


def seed_admin_roles(db: Session, admin_client_id: str) -> None:
    """Create super_admin and admin roles with permissions for the Admin application."""

    # Find the application by client_id
    row = db.execute(
        text("SELECT id FROM applications WHERE client_id = :cid"),
        {"cid": admin_client_id},
    ).fetchone()
    if row is None:
        print(f"ERROR: Application with client_id '{admin_client_id}' not found.")
        print("Make sure the Admin application is registered in Passport first.")
        sys.exit(1)

    app_id = row[0]
    print(f"Found Admin application: id={app_id}, client_id={admin_client_id}")

    # Define permissions
    permissions = [
        {"code": "manage_applications", "name": "应用管理", "description": "创建、编辑、删除应用"},
        {"code": "manage_secrets", "name": "密钥管理", "description": "生成、删除客户端密钥"},
        {"code": "manage_users", "name": "用户管理", "description": "查看和管理全局用户"},
        {"code": "manage_roles", "name": "角色管理", "description": "创建和管理应用角色"},
        {"code": "view_audit_logs", "name": "审计日志", "description": "查看系统审计日志"},
    ]

    perm_ids_by_code: dict[str, int] = {}
    for p in permissions:
        existing = db.execute(
            text("SELECT id FROM permissions WHERE application_id = :aid AND code = :code"),
            {"aid": app_id, "code": p["code"]},
        ).fetchone()
        if existing:
            perm_ids_by_code[p["code"]] = existing[0]
            print(f"  Permission '{p['code']}' already exists (id={existing[0]})")
        else:
            result = db.execute(
                text(
                    "INSERT INTO permissions (application_id, code, name, description, created_at, updated_at) "
                    "VALUES (:aid, :code, :name, :desc, NOW(), NOW())"
                ),
                {"aid": app_id, "code": p["code"], "name": p["name"], "desc": p["description"]},
            )
            perm_ids_by_code[p["code"]] = result.lastrowid
            print(f"  Created permission '{p['code']}' (id={result.lastrowid})")

    # Define roles
    roles = [
        {
            "code": "super_admin",
            "name": "超级管理员",
            "description": "拥有所有管理权限",
            "is_default": False,
            "permissions": list(perm_ids_by_code.keys()),
        },
        {
            "code": "admin",
            "name": "管理员",
            "description": "普通管理员，可管理用户和角色",
            "is_default": False,
            "permissions": ["manage_users", "manage_roles", "view_audit_logs"],
        },
    ]

    for role in roles:
        existing = db.execute(
            text("SELECT id FROM roles WHERE application_id = :aid AND code = :code"),
            {"aid": app_id, "code": role["code"]},
        ).fetchone()
        if existing:
            role_id = existing[0]
            print(f"  Role '{role['code']}' already exists (id={role_id})")
        else:
            result = db.execute(
                text(
                    "INSERT INTO roles (application_id, code, name, description, is_default, created_at, updated_at) "
                    "VALUES (:aid, :code, :name, :desc, :is_default, NOW(), NOW())"
                ),
                {"aid": app_id, "code": role["code"], "name": role["name"], "desc": role["description"], "is_default": role["is_default"]},
            )
            role_id = result.lastrowid
            print(f"  Created role '{role['code']}' (id={role_id})")

        # Assign permissions to role
        for perm_code in role["permissions"]:
            perm_id = perm_ids_by_code.get(perm_code)
            if perm_id is None:
                continue
            existing_rp = db.execute(
                text(
                    "SELECT id FROM role_permissions WHERE role_id = :rid AND permission_id = :pid"
                ),
                {"rid": role_id, "pid": perm_id},
            ).fetchone()
            if existing_rp:
                pass  # already assigned
            else:
                db.execute(
                    text(
                        "INSERT INTO role_permissions (role_id, permission_id, created_at) "
                        "VALUES (:rid, :pid, NOW())"
                    ),
                    {"rid": role_id, "pid": perm_id},
                )

        print(f"    Assigned {len(role['permissions'])} permissions to '{role['code']}'")

    db.commit()
    print("\nSeed completed successfully!")


def main():
    parser = argparse.ArgumentParser(description="Seed admin roles and permissions")
    parser.add_argument("--client-id", default=None, help="Admin application client_id")
    args = parser.parse_args()

    admin_client_id = args.client_id
    if not admin_client_id:
        # Try to read from admin .env
        admin_env = Path(__file__).resolve().parents[2] / "admin" / ".env"
        if admin_env.exists():
            for line in admin_env.read_text().splitlines():
                line = line.strip()
                if line.startswith("ADMIN_CLIENT_ID="):
                    admin_client_id = line.split("=", 1)[1].strip().strip('"')
                    break

    if not admin_client_id:
        print("ERROR: Admin client_id not found. Pass --client-id or set ADMIN_CLIENT_ID in backend/admin/.env")
        sys.exit(1)

    print(f"Using Admin client_id: {admin_client_id}")

    engine = create_engine(settings.database_url)
    with Session(engine) as db:
        seed_admin_roles(db, admin_client_id)


if __name__ == "__main__":
    main()
