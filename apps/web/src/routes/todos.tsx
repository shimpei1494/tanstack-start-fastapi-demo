import { createFileRoute } from "@tanstack/react-router";
import { filterSchema } from "@demo/api-contract";
import { todoOptions } from "../queries/todos";
import { TodoPage } from "../features/todos/todo-page";
export const Route = createFileRoute("/todos")({
  validateSearch: (search: Record<string, unknown>) => ({
    filter: filterSchema.catch("all").parse(search.filter),
  }),
  loaderDeps: ({ search }) => ({ filter: search.filter }),
  loader: ({ context, deps }) =>
    context.queryClient.query({ ...todoOptions(deps.filter), staleTime: "static" }),
  // フィルタ切り替え時は前の一覧を残して薄く表示するため、ローディング画面への切り替えを遅らせる
  pendingMs: 3000,
  pendingComponent: () => (
    <main className="mx-auto max-w-6xl p-8">
      <output>TODOを読み込み中…</output>
    </main>
  ),
  errorComponent: ({ error, reset }) => (
    <main className="mx-auto max-w-6xl space-y-4 p-8">
      <h1 className="text-xl font-bold">TODOを読み込めませんでした</h1>
      <p role="alert">{error instanceof Error ? error.message : "APIへ接続できません"}</p>
      <button onClick={reset}>再試行</button>
    </main>
  ),
  component: TodoPage,
});
