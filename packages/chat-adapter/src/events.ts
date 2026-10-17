import { EventType } from "@ag-ui/core";
import { EventSchemas } from "@ag-ui/core/schemas";
import { z } from "zod";

const id = z.string().min(1).max(128);
const base = { timestamp: z.number().finite().optional() };
export const chatEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal(EventType.RUN_STARTED), threadId: id, runId: id }),
  z.strictObject({ ...base, type: z.literal(EventType.RUN_FINISHED), threadId: id, runId: id }),
  z.strictObject({
    ...base,
    type: z.literal(EventType.RUN_ERROR),
    message: z.string().min(1).max(1000),
    code: z.string().max(128).optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal(EventType.STEP_STARTED),
    stepName: z.enum(["retrieve", "generate", "validate"]),
  }),
  z.strictObject({
    ...base,
    type: z.literal(EventType.STEP_FINISHED),
    stepName: z.enum(["retrieve", "generate", "validate"]),
  }),
  z.strictObject({
    ...base,
    type: z.literal(EventType.TEXT_MESSAGE_START),
    messageId: id,
    role: z.literal("assistant"),
  }),
  z.strictObject({
    ...base,
    type: z.literal(EventType.TEXT_MESSAGE_CONTENT),
    messageId: id,
    delta: z.string().min(1).max(20_000),
  }),
  z.strictObject({ ...base, type: z.literal(EventType.TEXT_MESSAGE_END), messageId: id }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;

export class ChatStreamError extends Error {
  constructor(
    message: string,
    readonly code: string = "INVALID_STREAM",
  ) {
    super(message);
    this.name = "ChatStreamError";
  }
}

/** Stateful validation applies to a single run, never across connections. */
export class ChatEventValidator {
  private started = false;
  private terminal = false;
  private messageId: string | undefined;
  private messageSeen = false;
  private stepName: string | undefined;
  constructor(private readonly expected: { threadId: string; runId: string }) {}

  accept(value: unknown): ChatEvent {
    const parsed = chatEventSchema.safeParse(value);
    if (!parsed.success || !EventSchemas.safeParse(parsed.data).success)
      throw new ChatStreamError("APIから未対応の配信イベントを受信しました。");
    const event = parsed.data;
    if (this.terminal) throw new ChatStreamError("終了後に配信イベントを受信しました。");
    if (event.type === EventType.RUN_STARTED) {
      if (this.started) throw new ChatStreamError("実行開始イベントが重複しています。");
      this.checkIds(event);
      this.started = true;
      return event;
    }
    if (!this.started) throw new ChatStreamError("実行開始前に配信イベントを受信しました。");
    switch (event.type) {
      case EventType.STEP_STARTED:
        if (this.stepName) throw new ChatStreamError("工程の開始順序が不正です。");
        this.stepName = event.stepName;
        break;
      case EventType.STEP_FINISHED:
        if (event.stepName !== this.stepName)
          throw new ChatStreamError("工程の終了が開始と一致しません。");
        this.stepName = undefined;
        break;
      case EventType.TEXT_MESSAGE_START:
        if (this.messageSeen) throw new ChatStreamError("返答開始イベントが重複しています。");
        this.messageSeen = true;
        this.messageId = event.messageId;
        break;
      case EventType.TEXT_MESSAGE_CONTENT:
        if (event.messageId !== this.messageId)
          throw new ChatStreamError("返答のIDまたはイベント順序が不正です。");
        break;
      case EventType.TEXT_MESSAGE_END:
        if (event.messageId !== this.messageId)
          throw new ChatStreamError("返答の終了が開始と一致しません。");
        this.messageId = undefined;
        break;
      case EventType.RUN_FINISHED:
        this.checkIds(event);
        if (this.messageId || this.stepName)
          throw new ChatStreamError("返答または工程が未完了のまま実行が終了しました。");
        this.terminal = true;
        break;
      case EventType.RUN_ERROR:
        this.terminal = true;
        break;
    }
    return event;
  }

  finish() {
    if (!this.terminal)
      throw new ChatStreamError(
        "接続が途中で切れました。返答は完了していません。",
        "STREAM_DISCONNECTED",
      );
  }
  private checkIds(event: { threadId: string; runId: string }) {
    if (event.threadId !== this.expected.threadId || event.runId !== this.expected.runId)
      throw new ChatStreamError("応答の実行IDが要求と一致しません。");
  }
}
