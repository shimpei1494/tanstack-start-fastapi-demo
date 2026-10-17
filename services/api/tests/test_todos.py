from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from demo_api.db import Todo
from demo_api.seed import seed


def test_crud_filter_and_persistence(client, app):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/todos").json() == []
    response = client.post("/todos", json={"title": "  説明資料を作る  "})
    assert response.status_code == 201
    todo = response.json()
    assert todo["title"] == "説明資料を作る"
    assert not todo["completed"]
    assert UUID(todo["id"])
    assert datetime.fromisoformat(todo["created_at"]).tzinfo is not None
    path = f"/todos/{todo['id']}"
    response = client.patch(path, json={"title": "資料を共有する", "completed": True})
    assert response.status_code == 200
    assert response.json()["completed"]
    assert response.json()["updated_at"] >= todo["updated_at"]
    assert len(client.get("/todos?completed=true").json()) == 1
    assert client.get("/todos?completed=false").json() == []
    # A fresh session reads committed data, rather than API-local cached state.
    with Session(app.state.engine) as session:
        assert session.get(Todo, todo["id"]).title == "資料を共有する"
    assert client.delete(path).status_code == 204
    assert client.get("/todos").json() == []
    assert client.delete(path).status_code == 404


@pytest.mark.parametrize("title", ["", "   ", "a" * 201, None, 42])
def test_create_validation(client, title):
    assert client.post("/todos", json={"title": title}).status_code == 422


@pytest.mark.parametrize("data", [{}, {"title": None}, {"completed": None}, {"extra": True}])
def test_patch_validation(client, data):
    assert client.patch(f"/todos/{uuid4()}", json=data).status_code == 422


def test_not_found_and_invalid_id(client):
    assert client.patch(f"/todos/{uuid4()}", json={"completed": True}).status_code == 404
    assert client.delete("/todos/not-an-id").status_code == 422
    assert client.get("/todos?completed=unknown").status_code == 422


def test_seed_idempotent(client, app):
    with Session(app.state.engine) as session:
        assert seed(session) == 3
        assert seed(session) == 0
    assert len(client.get("/todos").json()) == 3


def test_health_requires_migration():
    from fastapi.testclient import TestClient

    from demo_api.main import create_app

    with TestClient(create_app("sqlite://")) as client:
        response = client.get("/health")
        assert response.status_code == 503
        assert response.json() == {"detail": "Database is not ready"}


def test_suggestions_are_preview_only(client, monkeypatch):
    sleep = AsyncMock()
    monkeypatch.setattr("demo_api.main.asyncio", SimpleNamespace(sleep=sleep))
    response = client.post("/ai/suggestions", json={"goal": "社内勉強会を準備したい"})
    assert response.status_code == 200
    assert response.json() == {
        "suggestions": [
            {"title": "テーマを決める"},
            {"title": "資料を作る"},
            {"title": "参加者に案内する"},
        ],
        "model_version": "mock-v1",
    }
    assert client.get("/todos").json() == []
    sleep.assert_not_awaited()
    slow = client.post("/ai/suggestions", json={"goal": "準備", "scenario": "slow"})
    assert slow.json() == response.json()
    sleep.assert_awaited_once_with(3.0)
    sleep.reset_mock()
    error = client.post("/ai/suggestions", json={"goal": "準備", "scenario": "error"})
    sleep.assert_awaited_once_with(3.0)
    assert error.status_code == 503
    assert error.json()["detail"]["code"] == "MOCK_UNAVAILABLE"
    assert client.post("/ai/suggestions", json={"goal": "  "}).status_code == 422
