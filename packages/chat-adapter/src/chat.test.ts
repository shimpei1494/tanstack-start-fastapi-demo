import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { toServerSentEventsResponse, type UIMessage } from "@tanstack/ai";
import { chatInputSchema, runAgentInputSchema } from "./input";
import { ChatEventValidator } from "./events";
import { readChatEvents, readSseJson, relayChatEvents } from "./sse";

const ids = { threadId: "thread-1", runId: "run-1" };
const started = { type: "RUN_STARTED", ...ids };
const startText = { type: "TEXT_MESSAGE_START", messageId: "answer-1", role: "assistant" };
const content = { type: "TEXT_MESSAGE_CONTENT", messageId: "answer-1", delta: "こんにちは🌱" };
const endText = { type: "TEXT_MESSAGE_END", messageId: "answer-1" };
const finished = { type: "RUN_FINISHED", ...ids };
const normal = [
  started,
  { type: "STEP_STARTED", stepName: "generate" },
  startText,
  content,
  endText,
  { type: "STEP_FINISHED", stepName: "generate" },
  finished,
];
function encode(events: unknown[], newline = "\n") {
  return new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}${newline}${newline}`).join(""),
  );
}
function bytesBody(bytes: Uint8Array, size = bytes.length) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset = Math.min(offset + size, bytes.length);
    },
  });
}
const collect = async <T>(stream: AsyncIterable<T>) => {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
};

describe("restricted AG-UI input", () => {
  const input = {
    ...ids,
    messages: [
      {
        id: "user-1",
        role: "user",
        parts: [
          { type: "text", content: "最初" },
          { type: "text", content: "の質問" },
        ],
        metadata: { presentation: "only" },
      },
    ],
  };
  it("joins UI text and drops presentation metadata", () => {
    const result = chatInputSchema.parse(input);
    expect(result).toEqual({
      ...ids,
      messages: [{ id: "user-1", role: "user", content: "最初の質問" }],
      state: {},
      tools: [],
      context: [],
      forwardedProps: { scenario: "normal" },
    });
  });
  it.each([
    { ...input, model: "injected" },
    { ...input, scenario: "other" },
    {
      ...input,
      messages: [{ id: "user-1", role: "system", parts: [{ type: "text", content: "injected" }] }],
    },
    { ...input, messages: [{ id: "user-1", role: "user", parts: [{ type: "image", url: "x" }] }] },
    {
      ...input,
      messages: [{ id: "user-1", role: "user", parts: [{ type: "text", content: "" }] }],
    },
    { ...input, messages: [input.messages[0], input.messages[0]] },
  ])("rejects unsupported or invalid browser data %#", (value) => {
    expect(chatInputSchema.safeParse(value).success).toBe(false);
  });
  it("rejects unagreed standard extensions at the Python boundary", () => {
    const input = chatInputSchema.parse({
      ...ids,
      messages: [{ id: "u", role: "user", parts: [{ type: "text", content: "hello" }] }],
    } satisfies { threadId: string; runId: string; messages: UIMessage[] });
    expect(runAgentInputSchema.safeParse({ ...input, state: { secret: "x" } }).success).toBe(false);
    expect(
      runAgentInputSchema.safeParse({ ...input, forwardedProps: { prompt: "x" } }).success,
    ).toBe(false);
  });
});

describe("SSE and AG-UI streaming contract", () => {
  it.each(["normal", "error", "disconnect"])(
    "reads the Python EventEncoder %s fixture with split network chunks",
    async (scenario) => {
      const fixture = readFileSync(
        new URL(`../../../services/api/tests/fixtures/${scenario}.sse`, import.meta.url),
      );
      const expected = { threadId: "fixture-thread", runId: `fixture-run-${scenario}` };
      const events = readChatEvents(bytesBody(fixture, 3), expected);
      if (scenario === "disconnect") {
        await expect(collect(events)).rejects.toMatchObject({ code: "STREAM_DISCONNECTED" });
      } else {
        const received = await collect(events);
        expect(received.at(-1)?.type).toBe(scenario === "normal" ? "RUN_FINISHED" : "RUN_ERROR");
        expect(
          received.filter((event) => event.type === "TEXT_MESSAGE_CONTENT").length,
        ).toBeGreaterThan(0);
        if (scenario === "error")
          expect(received.some((event) => event.type === "RUN_FINISHED")).toBe(false);
      }
    },
  );
  it.each(["\n", "\r\n", "\r"])(
    "decodes UTF-8 and event boundaries split at every byte (%j)",
    async (newline) => {
      expect(await collect(readChatEvents(bytesBody(encode(normal, newline), 1), ids))).toEqual(
        normal,
      );
    },
  );
  it("handles keepalive and multi-line data without confusing frame boundaries", async () => {
    const body = bytesBody(
      new TextEncoder().encode(
        ': keep-alive\r\nid: 1\r\nevent: message\r\ndata: {"type":\r\ndata: "RUN_STARTED","threadId":"thread-1","runId":"run-1"}\r\n\r\n',
      ),
    );
    expect(await collect(readSseJson(body))).toEqual([started]);
  });
  it("forwards the first event while the producer is still running", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const events = readChatEvents(stream, ids);
    const first = events.next();
    controller.enqueue(encode([started]));
    expect(await first).toEqual({ done: false, value: started });
    controller.enqueue(encode([finished]));
    controller.close();
    expect(await events.next()).toEqual({ done: false, value: finished });
    await events.return(undefined);
  });
  it("accepts a mid-stream RUN_ERROR without marking the partial answer complete", async () => {
    const failed = [
      started,
      startText,
      content,
      { type: "RUN_ERROR", message: "生成に失敗しました。", code: "GENERATION_FAILED" },
    ];
    expect(await collect(readChatEvents(bytesBody(encode(failed)), ids))).toEqual(failed);
  });
  it.each([
    [startText],
    [started, started],
    [{ ...started, runId: "wrong" }],
    [started, content],
    [started, startText, { ...content, messageId: "wrong" }],
    [started, startText, finished],
    [started, { type: "STEP_FINISHED", stepName: "generate" }],
    [started, { type: "STEP_STARTED", stepName: "generate" }, finished],
    [started, { ...finished, threadId: "wrong" }],
    [started, finished, finished],
    [started, finished, { type: "RUN_ERROR", message: "late" }],
    [started, { type: "CUSTOM", name: "unknown", value: {} }],
  ])("rejects invalid order, IDs, terminals, and unsupported events %#", async (...events) => {
    await expect(collect(readChatEvents(bytesBody(encode(events)), ids))).rejects.toThrow();
  });
  it("treats EOF after TEXT_MESSAGE_END as disconnect, never success", async () => {
    await expect(
      collect(readChatEvents(bytesBody(encode([started, startText, content, endText])), ids)),
    ).rejects.toMatchObject({ code: "STREAM_DISCONNECTED" });
  });
  it("rejects incomplete frames, invalid JSON, UTF-8 and oversized frames", async () => {
    for (const bytes of [
      new TextEncoder().encode('data: {"type":'),
      new TextEncoder().encode("data: broken\n\n"),
      new Uint8Array([255]),
      new TextEncoder().encode(`data: ${"x".repeat(70_000)}`),
    ]) {
      await expect(collect(readSseJson(bytesBody(bytes)))).rejects.toThrow();
    }
  });
  it("cancels the underlying reader when aborted during an idle read", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const abort = new AbortController();
    const pending = collect(readChatEvents(body, ids, abort.signal));
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it("applies an idle timeout and closes the source", async () => {
    const cancelled = vi.fn();
    await expect(
      collect(readSseJson(new ReadableStream({ cancel: cancelled }), undefined, 5)),
    ).rejects.toMatchObject({ code: "STREAM_TIMEOUT" });
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it("cancels upstream when the SDK response reader is cancelled", async () => {
    const abort = new AbortController();
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode([started]));
      },
      cancel: cancelled,
    });
    const response = toServerSentEventsResponse(
      relayChatEvents(readChatEvents(body, ids, abort.signal), abort.signal),
      { abortController: abort },
    );
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(abort.signal.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it("validates a terminal even when it is the first event", () => {
    expect(() => new ChatEventValidator(ids).accept(finished)).toThrow();
  });
});
