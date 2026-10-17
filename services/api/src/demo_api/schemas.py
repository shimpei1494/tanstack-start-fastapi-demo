from datetime import UTC, datetime
from typing import Annotated, Any, Literal, Self

from ag_ui.core import RunAgentInput
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Goal = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
Scenario = Literal["normal", "slow", "error", "disconnect", "before-error"]
ReportScenario = Literal["normal", "slow", "error"]
Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TodoCreate(StrictModel):
    title: Title


class TodoUpdate(StrictModel):
    title: Title | None = None
    completed: bool | None = None

    @model_validator(mode="after")
    def validate_patch(self) -> Self:
        if not self.model_fields_set or any(
            getattr(self, name) is None for name in self.model_fields_set
        ):
            raise ValueError("Provide a title or completed value; null is not supported")
        return self


class TodoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    completed: bool
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def utc_dates(cls, value: datetime) -> datetime:
        # SQLite tests do not preserve timezone metadata; API always emits UTC.
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class NextTodo(StrictModel):
    id: str
    title: str


class SummaryReport(StrictModel):
    total: int
    completed: int
    remaining: int
    next_todos: list[NextTodo]
    summary: str


class SuggestionRequest(StrictModel):
    goal: Goal
    scenario: Literal["normal", "slow", "error"] = "normal"


class Suggestion(StrictModel):
    title: Title


class SuggestionResponse(StrictModel):
    suggestions: list[Suggestion]
    model_version: Literal["mock-v1"] = "mock-v1"


class DemoMessage(StrictModel):
    id: Identifier
    role: Literal["user", "assistant"]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class ForwardedProps(StrictModel):
    scenario: Scenario = "normal"


class DemoRunAgentInput(RunAgentInput):
    """The supported text-only subset of AG-UI's SDK input, on both boundaries."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    thread_id: Identifier
    run_id: Identifier
    protocol_version: Literal["1.0"] | None = None
    parent_run_id: None = None
    resume: None = None
    state: dict[str, Any] = Field(max_length=0)
    messages: list[DemoMessage] = Field(min_length=1, max_length=40)
    tools: list[Any] = Field(max_length=0)
    context: list[Any] = Field(max_length=0)
    forwarded_props: ForwardedProps

    @model_validator(mode="after")
    def supported_subset(self) -> Self:
        if self.messages[-1].role != "user":
            raise ValueError("The final message must have the user role")
        if len({message.id for message in self.messages}) != len(self.messages):
            raise ValueError("Message ids must be unique")
        if sum(len(message.content) for message in self.messages) > 20000:
            raise ValueError("Conversation is too long")
        return self
