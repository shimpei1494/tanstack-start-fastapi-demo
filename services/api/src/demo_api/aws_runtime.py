"""Opt-in ECS entry points; normal Compose startup remains unchanged."""

import argparse
import json
import os
import secrets
from pathlib import Path

import psycopg
from psycopg import sql


def credentials(value: str) -> dict[str, str]:
    data = json.loads(value)
    if not isinstance(data, dict) or any(
        not isinstance(data.get(key), str) or not data[key] for key in ("username", "password")
    ):
        raise ValueError("Credentials require a nonempty username and password")
    return {key: data[key] for key in ("username", "password")}


def app_credentials(client, secret_arn: str, username: str) -> dict[str, str]:
    try:
        data = credentials(client.get_secret_value(SecretId=secret_arn)["SecretString"])
    except client.exceptions.ResourceNotFoundException:
        # Terraform owns the secret metadata, but deliberately never its value.
        # An empty secret has no AWSCURRENT version yet. Other SDK errors propagate.
        data = {"username": username, "password": secrets.token_urlsafe(48)}
        client.put_secret_value(SecretId=secret_arn, SecretString=json.dumps(data))
    if data["username"] != username:
        raise ValueError("Application secret username does not match DB_USER")
    return data


def admin_connection(admin: dict[str, str]):
    return psycopg.connect(
        host=os.environ["DB_HOST"],
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.environ["DB_NAME"],
        user=admin["username"],
        password=admin["password"],
        sslmode=os.getenv("DB_SSLMODE", "verify-full"),
        sslrootcert=os.getenv("DB_SSLROOTCERT", "/opt/rds/global-bundle.pem"),
    )


def initialize() -> None:
    # Import the optional SDK only in the one-off initialization task.
    import boto3

    admin = credentials(os.environ["RDS_ADMIN_CREDENTIALS"])
    username = os.environ["DB_USER"]
    if username == admin["username"]:
        raise ValueError("The API login must differ from the RDS administrator")
    client = boto3.client("secretsmanager", region_name=os.environ["AWS_REGION"])
    with admin_connection(admin) as connection:
        with connection.cursor() as cursor:
            # Serialize retries before reading/creating the password version.
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"demo-api:{username}",))
            app = app_credentials(client, os.environ["APP_SECRET_ARN"], username)
            role = sql.Identifier(username)
            cursor.execute(
                "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls "
                "FROM pg_roles WHERE rolname = %s",
                (username,),
            )
            attributes = cursor.fetchone()
            if attributes is None:
                # PostgreSQL defaults are nonprivileged. RDS master is not a PG
                # superuser and cannot ALTER SUPERUSER/REPLICATION/BYPASSRLS flags.
                cursor.execute(sql.SQL("CREATE ROLE {} WITH LOGIN").format(role))
            elif any(attributes):
                raise ValueError("Existing application role has unexpected privileged attributes")
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM pg_auth_members m "
                "JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = %s)",
                (username,),
            )
            if cursor.fetchone()[0]:
                raise ValueError("Existing application role has unexpected role memberships")
            cursor.execute(
                sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {}").format(
                    role, sql.Literal(app["password"])
                )
            )
            cursor.execute(
                sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                    sql.Identifier(os.environ["DB_NAME"]), role
                )
            )
            cursor.execute(sql.SQL("REVOKE CREATE ON SCHEMA public FROM {}").format(role))
            cursor.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(role))
            cursor.execute(
                sql.SQL(
                    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {}"
                ).format(role)
            )
            cursor.execute(
                sql.SQL("GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO {}").format(role)
            )
            cursor.execute("SELECT to_regclass('public.alembic_version')")
            if cursor.fetchone()[0] is not None:
                cursor.execute(
                    sql.SQL("REVOKE ALL ON TABLE public.alembic_version FROM {}").format(role)
                )
            owner = sql.Identifier(admin["username"])
            cursor.execute(
                sql.SQL(
                    "ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public "
                    "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {}"
                ).format(owner, role)
            )
            cursor.execute(
                sql.SQL(
                    "ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public "
                    "GRANT USAGE ON SEQUENCES TO {}"
                ).format(owner, role)
            )


def migrate() -> None:
    from alembic.config import Config

    from alembic import command

    admin = credentials(os.environ.pop("RDS_ADMIN_CREDENTIALS"))
    application_role = sql.Identifier(os.environ["DB_USER"])
    # The migration task alone uses the administrator; service tasks receive only
    # DB_PASSWORD for the application login. Never construct a password-bearing URL.
    os.environ.pop("DATABASE_URL", None)
    os.environ["DB_USER"] = admin["username"]
    os.environ["DB_PASSWORD"] = admin["password"]
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    command.upgrade(config, "head")
    # Default privileges apply when Alembic first creates its metadata table.
    # Remove that access before any application services are started/updated.
    with admin_connection(admin) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                sql.SQL("REVOKE ALL ON TABLE public.alembic_version FROM {}").format(
                    application_role
                )
            )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("init", "migrate", "serve", "seed"))
    mode = parser.parse_args().mode
    try:
        if mode == "init":
            initialize()
        elif mode == "migrate":
            migrate()
        elif mode == "seed":
            from demo_api.seed import main as seed

            seed()
        else:
            os.execvp(
                "uvicorn",
                [
                    "uvicorn",
                    "demo_api.main:app",
                    "--host",
                    "0.0.0.0",
                    "--port",
                    "8000",
                    "--workers",
                    "1",
                    "--timeout-graceful-shutdown",
                    "90",
                ],
            )
    except Exception:
        # SDK/database exception messages can contain secret values or SQL text.
        # Preserve the failed ECS exit code without printing credentials.
        parser.exit(1, f"AWS runtime {mode} failed; check configuration and task permissions.\n")


if __name__ == "__main__":
    main()
