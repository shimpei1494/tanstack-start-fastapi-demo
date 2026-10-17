import { EventType } from "@ag-ui/core";
import { ChatEventValidator, ChatStreamError, type ChatEvent } from "./events";

const MAX_FRAME_LENGTH = 64 * 1024;

/** Incremental UTF-8 decoding; network chunks are unrelated to SSE event boundaries. */
export async function* readSseJson(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  idleTimeoutMs = 30_000,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let data: string[] = [];
  let frameLength = 0;
  const cancel = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new ChatStreamError("配信が一定時間応答しませんでした。", "STREAM_TIMEOUT"));
          void reader.cancel().catch(() => {});
        }, idleTimeoutMs);
      });
      const result = await Promise.race([reader.read(), timeout]).finally(() =>
        clearTimeout(timer),
      );
      signal?.throwIfAborted();
      buffer += result.done ? decoder.decode() : decoder.decode(result.value, { stream: true });
      while (true) {
        const match = /\r\n|\r|\n/.exec(buffer);
        if (!match || (!result.done && match[0] === "\r" && match.index === buffer.length - 1))
          break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        frameLength += line.length;
        if (frameLength > MAX_FRAME_LENGTH)
          throw new ChatStreamError("配信イベントのサイズが上限を超えています。");
        if (line === "") {
          if (data.length) {
            let value: unknown;
            try {
              value = JSON.parse(data.join("\n"));
            } catch {
              throw new ChatStreamError("配信イベントのJSONが不正です。");
            }
            data = [];
            frameLength = 0;
            yield value;
          } else frameLength = 0;
        } else if (line === "data") data.push("");
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        // Comments, event, id, retry, and unknown SSE fields do not change JSON data.
      }
      if (buffer.length + frameLength > MAX_FRAME_LENGTH)
        throw new ChatStreamError("配信イベントのサイズが上限を超えています。");
      if (result.done) {
        if (buffer.length || data.length)
          throw new ChatStreamError(
            "配信イベントの途中で接続が切れました。",
            "STREAM_DISCONNECTED",
          );
        return;
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function* readChatEvents(
  body: ReadableStream<Uint8Array>,
  expected: { threadId: string; runId: string },
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const validator = new ChatEventValidator(expected);
  let terminal: ChatEvent | undefined;
  for await (const value of readSseJson(body, signal)) {
    const event = validator.accept(value);
    // Hold only the terminal until EOF so duplicate terminals never mark a malformed run successful.
    if (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR)
      terminal = event;
    else yield event;
  }
  validator.finish();
  if (terminal) yield terminal;
}

/** Sanitize relay failures while keeping cancellation distinct from a failed run. */
export async function* relayChatEvents(
  stream: AsyncIterable<ChatEvent>,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  try {
    yield* stream;
  } catch (error) {
    if (signal.aborted) {
      if (signal.reason instanceof DOMException && signal.reason.name === "TimeoutError") {
        yield {
          type: EventType.RUN_ERROR,
          code: "STREAM_TIMEOUT",
          message: "配信が制限時間を超えました。",
        };
      }
      return;
    }
    yield {
      type: EventType.RUN_ERROR,
      code: error instanceof ChatStreamError ? error.code : "STREAM_FAILED",
      message:
        error instanceof ChatStreamError
          ? error.message
          : "配信が途中で失敗しました。再度お試しください。",
    };
  }
}
