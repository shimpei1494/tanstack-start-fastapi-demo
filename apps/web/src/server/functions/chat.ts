import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { toServerSentEventsResponse } from "@tanstack/ai";
import { chatInputSchema, relayChatEvents } from "@demo/chat-adapter";
import { openChatStream } from "../api-client/chat.server";

export const chatFn = createServerFn({ method: "POST" })
  .validator(chatInputSchema)
  .handler(async ({ data }) => {
    const cancellation = new AbortController();
    // Both inbound disconnect and downstream response cancellation stop upstream fetch.
    const signal = AbortSignal.any([
      getRequest().signal,
      cancellation.signal,
      AbortSignal.timeout(60_000),
    ]);
    const stream = await openChatStream(data, signal);
    return toServerSentEventsResponse(relayChatEvents(stream, signal), {
      abortController: cancellation,
      headers: { "X-Accel-Buffering": "no" },
    });
  });
