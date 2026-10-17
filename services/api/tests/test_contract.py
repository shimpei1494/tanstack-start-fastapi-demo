import json
from pathlib import Path

from demo_api.main import app


def test_openapi_snapshot_is_current():
    snapshot = Path(__file__).parents[1] / "openapi.json"
    assert json.loads(snapshot.read_text()) == app.openapi()


def test_migration_and_seed(tmp_path, monkeypatch):
    from alembic.config import Config
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from alembic import command
    from demo_api.main import create_app
    from demo_api.seed import seed

    url = f"sqlite:///{tmp_path / 'persisted.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    first_app = create_app(url)
    with Session(first_app.state.engine) as session:
        assert seed(session) == 3
    with TestClient(first_app) as client:
        created = client.post("/todos", json={"title": "再起動後も残る"}).json()
    with TestClient(create_app(url)) as client:
        assert len(client.get("/todos").json()) == 4
        assert created["id"] in {todo["id"] for todo in client.get("/todos").json()}
    command.downgrade(config, "base")
