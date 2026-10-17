import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import UUID

from ag_ui.encoder import EventEncoder
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from demo_api.chat import stream_events
from demo_api.db import Todo, database_url, get_session, make_engine, utc_now
from demo_api.fixtures import SUGGESTIONS, UNAVAILABLE_MESSAGE
from demo_api.schemas import (
    DemoRunAgentInput,
    SuggestionRequest,
    SuggestionResponse,
    TodoCreate,
    TodoRead,
    TodoUpdate,
)

Database = Annotated[Session, Depends(get_session)]


def unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={"code": "MOCK_UNAVAILABLE", "message": UNAVAILABLE_MESSAGE},
    )


def create_app(url: str | None = None) -> FastAPI:
    engine = make_engine(url or database_url())

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        engine.dispose()

    app = FastAPI(
        title="TanStack Start demo API",
        version="0.1.0",
        description="Local single-user demo. Deterministic AI; no external models.",
        lifespan=lifespan,
    )
    app.state.engine = engine

    @app.get("/health", operation_id="health")
    def health(session: Database) -> dict[str, str]:
        try:
            session.execute(text("SELECT 1"))
            session.execute(select(Todo.id).limit(1))
        except SQLAlchemyError as error:
            raise HTTPException(status_code=503, detail="Database is not ready") from error
        return {"status": "ok"}

    @app.get("/todos", response_model=list[TodoRead], operation_id="listTodos")
    def list_todos(session: Database, completed: bool | None = None):
        query = select(Todo).order_by(Todo.created_at.desc(), Todo.id)
        if completed is not None:
            query = query.where(Todo.completed == completed)
        return session.scalars(query).all()

    @app.post("/todos", response_model=TodoRead, status_code=201, operation_id="createTodo")
    def create_todo(data: TodoCreate, session: Database):
        todo = Todo(title=data.title)
        session.add(todo)
        session.commit()
        session.refresh(todo)
        return todo

    def find_todo(todo_id: UUID, session: Session) -> Todo:
        todo = session.get(Todo, str(todo_id))
        if todo is None:
            raise HTTPException(status_code=404, detail="TODOが見つかりません。")
        return todo

    @app.patch("/todos/{todo_id}", response_model=TodoRead, operation_id="updateTodo")
    def update_todo(todo_id: UUID, data: TodoUpdate, session: Database):
        todo = find_todo(todo_id, session)
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(todo, key, value)
        todo.updated_at = utc_now()
        session.commit()
        session.refresh(todo)
        return todo

    @app.delete("/todos/{todo_id}", status_code=204, operation_id="deleteTodo")
    def delete_todo(todo_id: UUID, session: Database):
        session.delete(find_todo(todo_id, session))
        session.commit()
        return Response(status_code=204)

    @app.post("/ai/suggestions", response_model=SuggestionResponse, operation_id="suggestTodos")
    async def suggestions(data: SuggestionRequest):
        if data.scenario == "slow":
            await asyncio.sleep(1.25)
        if data.scenario == "error":
            raise unavailable()
        return {"suggestions": [{"title": title} for title in SUGGESTIONS]}

    @app.post(
        "/chat/stream",
        operation_id="streamChat",
        response_class=StreamingResponse,
        responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
    )
    async def chat(data: DemoRunAgentInput):
        if data.forwarded_props.scenario == "before-error":
            raise unavailable()
        encoder = EventEncoder()

        async def encoded_events() -> AsyncIterator[str]:
            # Explicitly close the inner generator when StreamingResponse cancels
            # this one, so its finally block and later real-model cleanup execute.
            events = stream_events(data)
            try:
                async for event in events:
                    yield encoder.encode(event)
            finally:
                await events.aclose()

        return StreamingResponse(
            encoded_events(),
            media_type=encoder.get_content_type(),
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )

    return app


app = create_app()
