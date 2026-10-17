import "@tanstack/react-start/server-only";
import createClient from "openapi-fetch";
import { z } from "zod";
import type { paths } from "@demo/api-contract/generated";

export function apiClient() {
  return createClient<paths>({
    baseUrl: process.env.API_BASE_URL ?? "http://127.0.0.1:8000",
    fetch: (request) => fetch(request, { signal: AbortSignal.timeout(10_000) }),
  });
}
export function checked<T>(schema: z.ZodType<T>, data: unknown, error: unknown): T {
  if (error) {
    const parsed = z.object({ detail: z.object({ message: z.string() }) }).safeParse(error);
    throw new Error(
      parsed.success
        ? parsed.data.detail.message
        : "APIの処理に失敗しました。時間をおいて再試行してください。",
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error("APIから予期しない形式の応答を受け取りました。");
  return parsed.data;
}
