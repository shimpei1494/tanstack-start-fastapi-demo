import asyncio
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from demo_api.db import Todo


def test_summary_reflects_crud_without_changing_todos(client):
    empty = client.get("/reports/summary?scenario=normal")
    assert empty.status_code == 200
    assert empty.json() == {
        "total": 0,
        "completed": 0,
        "remaining": 0,
        "next_todos": [],
        "summary": "TODOはまだありません。最初の作業を追加してみましょう。",
    }
    first = client.post("/todos", json={"title": "最初の作業"}).json()
    second = client.post("/todos", json={"title": "次の作業"}).json()
    client.patch(f"/todos/{first['id']}", json={"completed": True})
    client.patch(f"/todos/{second['id']}", json={"title": "更新した作業"})
    deleted = client.post("/todos", json={"title": "削除する作業"}).json()
    client.delete(f"/todos/{deleted['id']}")
    before = client.get("/todos").json()
    report = client.get("/reports/summary?scenario=normal").json()
    assert report == {
        "total": 2,
        "completed": 1,
        "remaining": 1,
        "next_todos": [{"id": second["id"], "title": "更新した作業"}],
        "summary": "TODOは全2件。完了1件、未完了1件です。",
    }
    assert client.get("/todos").json() == before


def test_next_todos_are_oldest_incomplete_first_and_limited(client, app):
    start = datetime(2026, 1, 1, tzinfo=UTC)
    with Session(app.state.engine) as session:
        session.add_all(
            Todo(
                id=f"00000000-0000-0000-0000-{number:012d}",
                title=f"作業{number}",
                completed=number == 1,
                created_at=start + timedelta(days=number // 2),
            )
            for number in reversed(range(6))
        )
        session.commit()
    report = client.get("/reports/summary?scenario=normal").json()
    assert (report["total"], report["completed"], report["remaining"]) == (6, 1, 5)
    assert [todo["title"] for todo in report["next_todos"]] == ["作業0", "作業2", "作業3"]


@pytest.mark.parametrize("scenario", [None, "slow", "error"])
def test_delayed_report_waits_before_acquiring_a_connection(client, app, monkeypatch, scenario):
    checkouts = []

    def on_checkout(*_):
        checkouts.append(True)

    async def wait_without_connection(_):
        assert checkouts == []

    sleep = AsyncMock(side_effect=wait_without_connection)
    monkeypatch.setattr("demo_api.main.asyncio", SimpleNamespace(sleep=sleep))
    event.listen(app.state.engine, "checkout", on_checkout)
    try:
        query = f"?scenario={scenario}" if scenario else ""
        response = client.get(f"/reports/summary{query}")
        sleep.assert_awaited_once_with(3.0)
        if scenario == "error":
            assert checkouts == []
            assert response.status_code == 503
            assert response.json() == {
                "detail": {
                    "code": "REPORT_UNAVAILABLE",
                    "message": "作業レポートを作成できませんでした。もう一度お試しください。",
                }
            }
        else:
            assert response.status_code == 200
            assert checkouts
    finally:
        event.remove(app.state.engine, "checkout", on_checkout)


def test_summary_scenario_is_bounded(client):
    assert client.get("/reports/summary?scenario=arbitrary").status_code == 422


def test_slow_report_does_not_block_other_requests(app):
    async def concurrent_requests():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            started = time.monotonic()
            slow_report = asyncio.create_task(client.get("/reports/summary?scenario=slow"))
            try:
                await asyncio.sleep(0.1)
                todos = await asyncio.wait_for(client.get("/todos"), timeout=1.5)
                assert todos.status_code == 200
                assert not slow_report.done()
                report = await asyncio.wait_for(slow_report, timeout=5)
                assert report.status_code == 200
                assert time.monotonic() - started >= 2.9
            finally:
                if not slow_report.done():
                    slow_report.cancel()
                    await asyncio.gather(slow_report, return_exceptions=True)

    asyncio.run(concurrent_requests())
