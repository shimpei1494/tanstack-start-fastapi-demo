import pytest
from fastapi.testclient import TestClient

from demo_api.db import Base
from demo_api.main import create_app


@pytest.fixture
def app():
    application = create_app("sqlite://")
    Base.metadata.create_all(application.state.engine)
    return application


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def run_input():
    return {
        "threadId": "thread-test",
        "runId": "run-test",
        "state": {},
        "messages": [{"id": "user-1", "role": "user", "content": "勉強会を準備したい"}],
        "tools": [],
        "context": [],
        "forwardedProps": {},
    }
