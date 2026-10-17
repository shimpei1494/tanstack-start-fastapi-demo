import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import type { UIMessage } from "@tanstack/ai";
import { z } from "zod";

export const chatScenarios = ["normal", "slow", "error", "disconnect", "before-error"] as const;
export const chatScenarioSchema = z.enum(chatScenarios);
export type ChatScenario = z.infer<typeof chatScenarioSchema>;
const id = z.string().trim().min(1).max(128);
const text = z.string().min(1).max(20_000);
const messageSchema = z.strictObject({ id, role: z.enum(["user", "assistant"]), content: text });

/** Explicit subset: tools, attachments, state, and arbitrary forwarded props are unsupported. */
export const runAgentInputSchema = z
  .strictObject({
    threadId: id,
    runId: id,
    messages: z.array(messageSchema).min(1).max(100),
    state: z.strictObject({}),
    tools: z.array(z.never()).length(0),
    context: z.array(z.never()).length(0),
    forwardedProps: z.strictObject({ scenario: chatScenarioSchema.optional() }),
  })
  .superRefine((input, ctx) => {
    if (new Set(input.messages.map((message) => message.id)).size !== input.messages.length) {
      ctx.addIssue({
        code: "custom",
        message: "メッセージIDが重複しています。",
        path: ["messages"],
      });
    }
    if (input.messages.at(-1)?.role !== "user") {
      ctx.addIssue({
        code: "custom",
        message: "最後のメッセージはuserにしてください。",
        path: ["messages"],
      });
    }
  })
  .transform((input) => {
    RunAgentInputSchema.parse(input);
    return input;
  });
export type RunAgentInput = z.output<typeof runAgentInputSchema>;

// UIMessage's presentation metadata is accepted but never forwarded to Python.
const uiMessageSchema = z.strictObject({
  id,
  role: z.enum(["user", "assistant"]),
  parts: z
    .array(
      z.strictObject({
        type: z.literal("text"),
        content: z.string().max(20_000),
        metadata: z.unknown().optional(),
      }),
    )
    .min(1),
  createdAt: z.date().optional(),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export const chatInputSchema = z
  .strictObject({
    messages: z.custom<UIMessage[]>().transform((value, ctx) => {
      const parsed = z.array(uiMessageSchema).min(1).max(100).safeParse(value);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: "userとassistantのテキストメッセージだけを送信できます。",
        });
        return z.NEVER;
      }
      return parsed.data;
    }),
    threadId: id,
    runId: id,
    scenario: chatScenarioSchema.default("normal"),
  })
  .transform(({ messages, threadId, runId, scenario }): z.input<typeof runAgentInputSchema> => ({
    threadId,
    runId,
    messages: messages.map(({ id: messageId, role, parts }) => ({
      id: messageId,
      role,
      content: parts.map((part) => part.content).join(""),
    })),
    state: {},
    tools: [],
    context: [],
    forwardedProps: { scenario },
  }))
  .pipe(runAgentInputSchema);
