import asyncio
import logging
from collections.abc import AsyncIterator
from uuid import uuid4

from ag_ui.core import (
    BaseEvent,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StepFinishedEvent,
    StepStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)

from demo_api.fixtures import CHAT_DELTAS, STREAM_ERROR_MESSAGE
from demo_api.schemas import DemoRunAgentInput

logger = logging.getLogger("uvicorn.error")


async def stream_events(input_data: DemoRunAgentInput) -> AsyncIterator[BaseEvent]:
    """Cooperative generator: disconnect cancellation stops work at the next await.

    The final log is also an integration-test observation point. No chat history
    or response content is logged or persisted.
    """
    scenario = input_data.forwarded_props.scenario
    delay = 0.65 if scenario == "slow" else 0.12
    outcome = "cancelled"
    content_chunks = 0
    message_id = str(uuid4())
    try:
        yield RunStartedEvent(thread_id=input_data.thread_id, run_id=input_data.run_id)
        yield StepStartedEvent(step_name="retrieve")
        await asyncio.sleep(delay)
        yield StepFinishedEvent(step_name="retrieve")
        yield StepStartedEvent(step_name="generate")
        yield TextMessageStartEvent(message_id=message_id, role="assistant")
        for index, delta in enumerate(CHAT_DELTAS):
            await asyncio.sleep(delay)
            content_chunks += 1
            yield TextMessageContentEvent(message_id=message_id, delta=delta)
            if index == 1 and scenario == "error":
                outcome = "error"
                yield RunErrorEvent(code="MOCK_STREAM_ERROR", message=STREAM_ERROR_MESSAGE)
                return
            if index == 1 and scenario == "disconnect":
                outcome = "disconnected"
                return
        yield TextMessageEndEvent(message_id=message_id)
        yield StepFinishedEvent(step_name="generate")
        yield StepStartedEvent(step_name="validate")
        await asyncio.sleep(delay)
        yield StepFinishedEvent(step_name="validate")
        outcome = "finished"
        yield RunFinishedEvent(thread_id=input_data.thread_id, run_id=input_data.run_id)
    finally:
        logger.info(
            "chat run ended run_id=%s outcome=%s content_chunks=%d",
            input_data.run_id,
            outcome,
            content_chunks,
        )
