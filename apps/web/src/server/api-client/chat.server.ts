import "@tanstack/react-start/server-only";
import {
  ChatStreamError,
  readChatEvents,
  runAgentInputSchema,
  type RunAgentInput,
  type ChatEvent,
} from "@demo/chat-adapter";

/** Open headers before creating the downstream SSE response, preserving pre-stream HTTP failures. */
export async function openChatStream(
  input: RunAgentInput,
  signal: AbortSignal,
): Promise<AsyncIterable<ChatEvent>> {
  const checked = runAgentInputSchema.parse(input);
  let response: Response;
  try {
    response = await fetch(
      new URL("/chat/stream", process.env.API_BASE_URL ?? "http://127.0.0.1:8000"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(checked),
        signal,
      },
    );
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ChatStreamError(
      "チャットAPIへ接続できません。FastAPIの起動を確認してください。",
      "API_UNAVAILABLE",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ChatStreamError(
      `チャットAPIが配信前に失敗しました（HTTP ${response.status}）。`,
      "API_HTTP_ERROR",
    );
  }
  if (
    !response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream") ||
    !response.body
  ) {
    await response.body?.cancel();
    throw new ChatStreamError("チャットAPIの応答形式が不正です。");
  }
  return readChatEvents(response.body, checked, signal);
}
