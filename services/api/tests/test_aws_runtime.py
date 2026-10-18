import json
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url

from demo_api import aws_runtime, db
from demo_api.main import create_app


@pytest.fixture
def aws_environment(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    for key, value in {
        "DB_HOST": "database.example",
        "DB_PORT": "5432",
        "DB_NAME": "demo",
        "DB_USER": "demo_app",
        "DB_PASSWORD": "a:p@ss/word?#%",
        "DB_SSLMODE": "verify-full",
        "DB_SSLROOTCERT": "/opt/rds/global-bundle.pem",
        "DB_POOL_SIZE": "2",
        "DB_MAX_OVERFLOW": "1",
        "AWS_REGION": "ap-northeast-1",
        "APP_SECRET_ARN": "arn:aws:secretsmanager:ap-northeast-1:123:secret:app",
        "RDS_ADMIN_CREDENTIALS": json.dumps({"username": "admin", "password": "secret-admin"}),
    }.items():
        monkeypatch.setenv(key, value)


def test_database_environment_preserves_password_and_tls(aws_environment):
    url = make_url(db.database_url())
    assert url.password == "a:p@ss/word?#%"
    assert make_url(url.render_as_string(hide_password=False)).password == url.password
    assert url.query == {"sslmode": "verify-full", "sslrootcert": "/opt/rds/global-bundle.pem"}
    engine = db.make_engine(url)
    try:
        assert engine.pool.size() == 2
        assert engine.pool._max_overflow == 1
    finally:
        engine.dispose()


def test_database_url_still_overrides_environment_and_sqlite_ignores_pool(
    aws_environment, monkeypatch
):
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    assert db.database_url() == "sqlite://"
    engine = db.make_engine(db.database_url())
    try:
        assert isinstance(engine.pool, db.StaticPool)
    finally:
        engine.dispose()


@pytest.mark.parametrize(("name", "value"), [("DB_POOL_SIZE", "0"), ("DB_MAX_OVERFLOW", "-1")])
def test_reject_unbounded_or_zero_pool_settings(aws_environment, monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=name):
        db.make_engine(db.database_url())


def test_live_has_no_database_dependency(monkeypatch):
    app = create_app("sqlite://")
    monkeypatch.setattr(
        app.state.engine, "connect", MagicMock(side_effect=AssertionError("DB used"))
    )
    with TestClient(app) as client:
        assert client.get("/live").json() == {"status": "ok"}
        assert "/live" not in app.openapi()["paths"]


class MissingVersion(Exception):
    pass


class FakeSecrets:
    exceptions = SimpleNamespace(ResourceNotFoundException=MissingVersion)

    def __init__(self):
        self.value = None
        self.writes = 0

    def get_secret_value(self, **kwargs):
        if self.value is None:
            raise MissingVersion
        return {"SecretString": self.value}

    def put_secret_value(self, **kwargs):
        self.value = kwargs["SecretString"]
        self.writes += 1


def test_init_reuses_secret_and_grants_only_application_permissions(aws_environment, monkeypatch):
    client = FakeSecrets()
    boto_client = MagicMock(return_value=client)
    monkeypatch.setitem(sys.modules, "boto3", SimpleNamespace(client=boto_client))
    connection = MagicMock()
    connection.__enter__.return_value = connection
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.side_effect = [
        None,
        (False,),
        (None,),
        (False,) * 5,
        (False,),
        ("alembic_version",),
    ]
    connect = MagicMock(return_value=connection)
    monkeypatch.setattr(aws_runtime.psycopg, "connect", connect)
    aws_runtime.initialize()
    first_password = json.loads(client.value)["password"]
    aws_runtime.initialize()
    assert json.loads(client.value)["password"] == first_password
    assert client.writes == 1
    assert connect.call_args.kwargs["user"] == "admin"
    assert connect.call_args.kwargs["sslmode"] == "verify-full"
    statements = [
        call.args[0] if isinstance(call.args[0], str) else call.args[0].as_string()
        for call in cursor.execute.call_args_list
    ]
    assert sum(statement.startswith("CREATE ROLE") for statement in statements) == 1
    assert any("WITH LOGIN PASSWORD" in statement for statement in statements)
    assert not any("NOSUPERUSER" in statement for statement in statements)
    assert not any("NOREPLICATION" in statement for statement in statements)
    assert not any("NOBYPASSRLS" in statement for statement in statements)
    assert any("REVOKE CREATE ON SCHEMA" in statement for statement in statements)
    assert any("GRANT SELECT, INSERT, UPDATE, DELETE" in statement for statement in statements)
    assert any("ALTER DEFAULT PRIVILEGES" in statement for statement in statements)
    assert any(
        "REVOKE ALL ON TABLE public.alembic_version" in statement for statement in statements
    )
    assert not any("GRANT ALL" in statement for statement in statements)


@pytest.mark.parametrize(
    "attributes,membership", [((True, False, False, False, False), False), ((False,) * 5, True)]
)
def test_init_rejects_existing_privileged_role(
    aws_environment, monkeypatch, attributes, membership
):
    monkeypatch.setitem(
        sys.modules, "boto3", SimpleNamespace(client=MagicMock(return_value=FakeSecrets()))
    )
    connection = MagicMock()
    connection.__enter__.return_value = connection
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.side_effect = [attributes, (membership,)]
    monkeypatch.setattr(aws_runtime.psycopg, "connect", MagicMock(return_value=connection))
    with pytest.raises(ValueError, match="unexpected"):
        aws_runtime.initialize()
    assert not any("ALTER ROLE" in str(call.args[0]) for call in cursor.execute.call_args_list)


def test_secret_rejects_wrong_user_and_does_not_swallow_sdk_errors():
    client = FakeSecrets()
    client.value = json.dumps({"username": "other", "password": "secret"})
    with pytest.raises(ValueError, match="DB_USER"):
        aws_runtime.app_credentials(client, "arn", "demo_app")
    client.get_secret_value = MagicMock(side_effect=PermissionError("Access denied"))
    with pytest.raises(PermissionError):
        aws_runtime.app_credentials(client, "arn", "demo_app")
    assert client.writes == 0


def test_serve_replaces_process_without_migration(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["aws_runtime", "serve"])
    execute = MagicMock()
    monkeypatch.setattr(aws_runtime.os, "execvp", execute)
    monkeypatch.setattr(aws_runtime, "migrate", MagicMock(side_effect=AssertionError("migration")))
    aws_runtime.main()
    assert execute.call_args.args[0] == "uvicorn"
    assert execute.call_args.args[1][-2:] == ["--timeout-graceful-shutdown", "90"]


def test_migration_uses_admin_only_in_its_process(aws_environment, monkeypatch):
    from alembic import command

    monkeypatch.setenv("DATABASE_URL", "postgresql://do-not-use")
    upgrade = MagicMock()
    monkeypatch.setattr(command, "upgrade", upgrade)
    connection = MagicMock()
    connection.__enter__.return_value = connection
    cursor = connection.cursor.return_value.__enter__.return_value
    monkeypatch.setattr(aws_runtime.psycopg, "connect", MagicMock(return_value=connection))
    aws_runtime.migrate()
    url = make_url(db.database_url())
    assert url.username == "admin"
    assert url.password == "secret-admin"
    assert url.query["sslmode"] == "verify-full"
    assert upgrade.call_args.args[1] == "head"
    assert upgrade.call_args.args[0].config_file_name.endswith("/services/api/alembic.ini")
    assert cursor.execute.call_args.args[0].as_string() == (
        'REVOKE ALL ON TABLE public.alembic_version FROM "demo_app"'
    )


def test_runtime_does_not_log_credentials_on_failure(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["aws_runtime", "init"])
    monkeypatch.setattr(
        aws_runtime, "initialize", MagicMock(side_effect=RuntimeError("secret-admin"))
    )
    with pytest.raises(SystemExit) as result:
        aws_runtime.main()
    assert result.value.code == 1
    assert "secret-admin" not in capsys.readouterr().err
