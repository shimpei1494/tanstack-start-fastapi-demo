import { z } from "zod";

export const titleSchema = z
  .string()
  .trim()
  .min(1, "タイトルを入力してください")
  .max(200, "200文字以内で入力してください");
export const todoSchema = z.object({
  id: z.uuid(),
  title: titleSchema,
  completed: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type Todo = z.infer<typeof todoSchema>;
export const filterSchema = z.enum(["all", "active", "completed"]);
export type TodoFilter = z.infer<typeof filterSchema>;
export const createTodoSchema = z.object({ title: titleSchema });
export const updateTodoSchema = z
  .object({ id: z.uuid(), title: titleSchema.optional(), completed: z.boolean().optional() })
  .refine((v) => v.title !== undefined || v.completed !== undefined, "更新内容が必要です");
export const suggestionInputSchema = z.object({
  goal: z
    .string()
    .trim()
    .min(1, "目的を入力してください")
    .max(1000, "1000文字以内で入力してください"),
  scenario: z.enum(["normal", "slow", "error"]).default("normal"),
});
export const suggestionsSchema = z.object({
  suggestions: z.array(z.object({ title: titleSchema })).max(10),
  model_version: z.string(),
});

export const reportScenarioSchema = z.enum(["normal", "slow", "error"]);
export type ReportScenario = z.infer<typeof reportScenarioSchema>;
export const summaryReportSchema = z
  .object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    next_todos: z.array(z.object({ id: z.uuid(), title: titleSchema })).max(3),
    summary: z.string().min(1),
  })
  .refine(
    (report) => report.total === report.completed + report.remaining,
    "集計の件数が一致しません",
  );
