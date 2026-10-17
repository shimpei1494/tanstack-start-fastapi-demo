import asyncio
import json
import logging
import socket
import threading
import time

import httpx
import pytest
import uvicorn
from ag_ui.core import EventType
from pydantic import TypeAdapter

from demo_api.chat import stream_events
from demo_api.fixtures import CHAT_DELTAS
from demo_api.schemas import DemoRunAgentInput


def decode_sse(body):
    return [json.loads(line[6:]) for line in body.splitlines() if line.startswith("data: ")]


def test_successful_event_order_and_ids(client, run_input):
    response = client.post("/chat/stream", json=run_input)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["x-accel-buffering"] == "no"
    events = decode_sse(response.text)
    types = [event["type"] for event in events]
    for event_type in types:
        TypeAdapter(EventType).validate_python(event_type)
    assert types[:5] == [
        "RUN_STARTED",
        "STEP_STARTED",
        "STEP_FINISHED",
        "STEP_STARTED",
        "TEXT_MESSAGE_START",
    ]
    assert types[-5:] == [
        "TEXT_MESSAGE_END",
        "STEP_FINISHED",
        "STEP_STARTED",
        "STEP_FINISHED",
        "RUN_FINISHED",
    ]
    assert events[0]["runId"] == events[-1]["runId"] == run_input["runId"]
    assert events[0]["threadId"] == events[-1]["threadId"] == run_input["threadId"]
    text_events = [event for event in events if event["type"].startswith("TEXT_MESSAGE_")]
    assert len({event["messageId"] for event in text_events}) == 1
    assert "".join(event.get("delta", "") for event in text_events) == "".join(CHAT_DELTAS)
    assert types.count("RUN_FINISHED") == 1


@pytest.mark.parametrize("scenario", ["error", "disconnect", "before-error"])
def test_distinct_failure_modes(client, run_input, scenario):
    run_input["forwardedProps"] = {"scenario": scenario}
    response = client.post("/chat/stream", json=run_input)
    if scenario == "before-error":
        assert response.status_code == 503
        assert response.headers["content-type"] == "application/json"
        return
    events = decode_sse(response.text)
    assert events[0]["type"] == "RUN_STARTED"
    types = [event["type"] for event in events]
    assert "TEXT_MESSAGE_CONTENT" in types
    assert "RUN_FINISHED" not in types
    assert "TEXT_MESSAGE_END" not in types
    if scenario == "error":
        assert events[-1]["type"] == "RUN_ERROR"
        assert events[-1]["code"] == "MOCK_STREAM_ERROR"
    else:
        assert "RUN_ERROR" not in types


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("tools", [{"name": "x", "description": "x", "parameters": {}}]),
        ("context", [{"description": "x", "value": "x"}]),
        ("state", {"hidden": 1}),
        ("forwardedProps", {"model": "external"}),
        ("forwardedProps", {"scenario": "unsupported"}),
        ("parentRunId", "parent"),
        ("resume", []),
        ("messages", []),
        ("messages", [{"id": "x", "role": "system", "content": "x"}]),
        ("messages", [{"id": "x", "role": "user", "content": [{"type": "text"}]}]),
        ("messages", [{"id": "x", "role": "assistant", "content": "x"}]),
        ("threadId", ""),
    ],
)
def test_rejects_unsupported_input(client, run_input, field, value):
    run_input[field] = value
    assert client.post("/chat/stream", json=run_input).status_code == 422


def test_generator_cancel_stops_work(run_input, caplog):
    caplog.set_level(logging.INFO, logger="uvicorn.error")
    run_input["forwardedProps"] = {"scenario": "slow"}

    async def cancel_mid_generation():
        events = stream_events(DemoRunAgentInput.model_validate(run_input))
        assert (await anext(events)).type == EventType.RUN_STARTED
        assert (await anext(events)).type == EventType.STEP_STARTED
        waiting = asyncio.create_task(anext(events))
        await asyncio.sleep(0.02)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        with pytest.raises(StopAsyncIteration):
            await anext(events)

    asyncio.run(cancel_mid_generation())
    assert "outcome=cancelled content_chunks=0" in caplog.text


def test_real_http_partial_arrival_and_disconnect_cleanup(app, run_input, caplog):
    """ASGI test clients buffer, so use a live socket to prove streaming/cancel."""
    caplog.set_level(logging.INFO, logger="uvicorn.error")
    run_input["runId"] = "real-http-cancel"
    run_input["forwardedProps"] = {"scenario": "slow"}
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    port = listener.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None, loop="asyncio")
    )
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 5
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started
        started = time.monotonic()
        with httpx.Client(base_url=f"http://127.0.0.1:{port}") as client:
            with client.stream("POST", "/chat/stream", json=run_input) as response:
                lines = response.iter_lines()
                first = next(line for line in lines if line.startswith("data: "))
                assert json.loads(first[6:])["type"] == "RUN_STARTED"
                # The full slow fixture takes > 5 seconds; first bytes are immediate.
                assert time.monotonic() - started < 1
                for line in lines:
                    if line.startswith("data: "):
                        event = json.loads(line[6:])
                        if event["type"] == "TEXT_MESSAGE_CONTENT":
                            assert event["delta"] == CHAT_DELTAS[0]
                            break
            deadline = time.monotonic() + 2
            marker = "run_id=real-http-cancel outcome=cancelled content_chunks=1"
            while marker not in caplog.text and time.monotonic() < deadline:
                time.sleep(0.02)
            assert marker in caplog.text
            assert client.post("/todos", json={"title": "停止後も保存できる"}).status_code == 201
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        listener.close()
    assert not thread.is_alive()
