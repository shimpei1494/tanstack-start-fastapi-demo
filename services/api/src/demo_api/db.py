import os
from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import Request
from sqlalchemy import Boolean, DateTime, String, create_engine
from sqlalchemy.engine import URL, Engine, make_url
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import StaticPool


def utc_now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class Todo(Base):
    __tablename__ = "todos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


def database_url() -> str | URL:
    if url := os.getenv("DATABASE_URL"):
        return url
    if os.getenv("DB_HOST"):
        query = {
            name: os.environ[variable]
            for name, variable in {"sslmode": "DB_SSLMODE", "sslrootcert": "DB_SSLROOTCERT"}.items()
            if os.getenv(variable)
        }
        return URL.create(
            "postgresql+psycopg",
            username=os.environ["DB_USER"],
            password=os.environ["DB_PASSWORD"],
            host=os.environ["DB_HOST"],
            port=int(os.getenv("DB_PORT", "5432")),
            database=os.environ["DB_NAME"],
            query=query,
        )
    return "postgresql+psycopg://demo:demo@localhost:5432/demo"


def make_engine(url: str | URL) -> Engine:
    options = {"pool_pre_ping": True}
    parsed = make_url(url)
    if parsed.get_backend_name() == "sqlite":
        options["connect_args"] = {"check_same_thread": False}
        if parsed.database in {None, "", ":memory:"}:
            options["poolclass"] = StaticPool
    else:
        for name in ("pool_size", "max_overflow"):
            if value := os.getenv(f"DB_{name.upper()}"):
                minimum = 1 if name == "pool_size" else 0
                if int(value) < minimum:
                    raise ValueError(f"DB_{name.upper()} must be at least {minimum}")
                options[name] = int(value)
    return create_engine(url, **options)


def get_session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.engine) as session:
        yield session
