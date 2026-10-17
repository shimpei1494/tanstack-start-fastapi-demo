import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useHydrated } from "@tanstack/react-router";
import {
  Plus,
  Sparkles,
  ArrowUpRight,
  Check,
  Pencil,
  Trash2,
  X,
  ListTodo,
  LoaderCircle,
} from "lucide-react";
import { Button, ErrorNotice } from "@demo/ui";
import { titleSchema, suggestionInputSchema, type Todo } from "@demo/api-contract";
import { todoOptions } from "../../queries/todos";
import { createTodo, deleteTodo, updateTodo, suggestTodos } from "../../server/functions/todos";
import { Route } from "../../routes/todos";

export function TodoPage() {
  const hydrated = useHydrated();
  const { filter } = Route.useSearch();
  const { data: todos } = useSuspenseQuery(todoOptions(filter));
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["todos"] });
  const add = useMutation({
    mutationFn: (title: string) => createTodo({ data: { title } }),
    onSuccess: refresh,
  });
  const form = useForm({
    defaultValues: { title: "" },
    onSubmit: async ({ value, formApi }) => {
      try {
        await add.mutateAsync(value.title);
        formApi.reset();
      } catch {
        /* mutation displays error */
      }
    },
  });
  return (
    <main className="mx-auto max-w-6xl px-5 pt-10 sm:px-8 sm:pt-14">
      <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-3">A little clarity, every day</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            今日の作業を、ひとつずつ。
          </h1>
          <p className="mt-3 text-sm leading-7 text-stone-500">
            やることを整理して、次の一歩を見つけましょう。
          </p>
        </div>
        <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs text-teal-800">
          ● すべてローカルで動作
        </span>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_350px]">
        <section className="panel overflow-hidden" aria-labelledby="todo-heading">
          <div className="border-b border-stone-100 p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 id="todo-heading" className="flex items-center gap-2 font-semibold">
                <ListTodo size={18} className="text-teal-700" />
                マイTODO
              </h2>
              <span className="text-xs text-stone-400">{todos.length} 件</span>
            </div>
            <form
              method="post"
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit();
              }}
              className="flex items-start gap-2"
            >
              <form.Field name="title" validators={{ onChange: titleSchema }}>
                {(field) => (
                  <div className="min-w-0 flex-1">
                    <label htmlFor="todo-title" className="sr-only">
                      新しいTODO
                    </label>
                    <input
                      className="field"
                      id="todo-title"
                      disabled={!hydrated}
                      placeholder="次にやることを入力…"
                      value={field.state.value}
                      maxLength={200}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={field.state.meta.errors.length > 0}
                    />
                    {field.state.meta.errors.map((e, i) => (
                      <p className="mt-1 text-xs text-red-700" key={i}>
                        {e?.message}
                      </p>
                    ))}
                  </div>
                )}
              </form.Field>
              <Button type="submit" disabled={!hydrated || add.isPending} aria-label="TODOを追加">
                {add.isPending ? (
                  <LoaderCircle size={17} className="animate-spin" />
                ) : (
                  <Plus size={17} />
                )}
                追加
              </Button>
            </form>
            <div className="mt-3">
              <ErrorNotice error={add.error} />
            </div>
          </div>
          <div className="flex gap-1 border-b border-stone-100 px-5 pt-3" aria-label="絞り込み">
            {(
              [
                ["all", "すべて"],
                ["active", "未完了"],
                ["completed", "完了"],
              ] as const
            ).map(([value, label]) => (
              <Link
                key={value}
                to="/todos"
                search={{ filter: value }}
                className={`border-b-2 px-4 pb-3 pt-1 text-sm ${filter === value ? "border-teal-700 font-medium text-teal-800" : "border-transparent text-stone-400 hover:text-stone-700"}`}
              >
                {label}
              </Link>
            ))}
          </div>
          <ul className="divide-y divide-stone-100 px-5">
            {todos.map((todo) => (
              <TodoRow key={todo.id} todo={todo} refresh={refresh} />
            ))}
          </ul>
          {todos.length === 0 && (
            <div className="px-6 py-16 text-center">
              <ListTodo size={30} className="mx-auto mb-4 text-stone-300" />
              <p className="text-sm font-medium text-stone-600">
                {filter === "all" ? "まだTODOがありません" : "該当するTODOはありません"}
              </p>
              <p className="mt-2 text-xs text-stone-400">小さな作業から追加してみましょう。</p>
            </div>
          )}
          <div className="bg-stone-50/70 px-6 py-3 text-xs text-stone-400">
            変更は自動で保存され、再読み込み後も残ります。
          </div>
        </section>
        <aside className="space-y-5">
          <SuggestionPanel refresh={refresh} />
          <div className="rounded-xl border border-stone-200 p-5">
            <p className="text-sm font-medium text-stone-600">考えをもう少し広げたいときは</p>
            <p className="mt-2 text-xs leading-6 text-stone-500">
              チャットで相談して、返答が少しずつ届く様子を体験できます。
            </p>
            <Link
              to="/chat"
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-teal-800"
            >
              チャットを開く
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
function TodoRow({ todo, refresh }: { todo: Todo; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const [inputError, setInputError] = useState("");
  const update = useMutation({
    mutationFn: (body: { title?: string; completed?: boolean }) =>
      updateTodo({ data: { id: todo.id, ...body } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => deleteTodo({ data: todo.id }),
    onSuccess: refresh,
  });
  const busy = update.isPending || remove.isPending;
  async function save() {
    const parsed = titleSchema.safeParse(title);
    if (!parsed.success) {
      setInputError(parsed.error.issues[0]?.message ?? "入力を確認してください");
      return;
    }
    setInputError("");
    try {
      await update.mutateAsync({ title: parsed.data });
      setEditing(false);
    } catch {
      /* displayed below */
    }
  }
  return (
    <li className="py-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`${todo.title}を${todo.completed ? "未完了" : "完了"}にする`}
          aria-pressed={todo.completed}
          disabled={busy}
          onClick={() => update.mutate({ completed: !todo.completed })}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${todo.completed ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 hover:border-teal-700"}`}
        >
          {todo.completed && <Check size={14} />}
        </button>
        {editing ? (
          <form
            method="post"
            className="flex min-w-0 flex-1 gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label htmlFor={`edit-${todo.id}`} className="sr-only">
              タイトルを編集
            </label>
            <input
              id={`edit-${todo.id}`}
              className="field min-w-0"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
            <Button type="submit" variant="ghost" disabled={busy} aria-label="編集を保存">
              <Check size={16} />
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)} aria-label="編集をキャンセル">
              <X size={16} />
            </Button>
          </form>
        ) : (
          <>
            <span
              className={`min-w-0 flex-1 break-words text-sm leading-6 ${todo.completed ? "text-stone-400 line-through" : "text-stone-700"}`}
            >
              {todo.title}
            </span>
            <Button
              variant="ghost"
              disabled={busy}
              aria-label={`${todo.title}を編集`}
              onClick={() => {
                setTitle(todo.title);
                setInputError("");
                setEditing(true);
              }}
            >
              <Pencil size={15} />
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              aria-label={`${todo.title}を削除`}
              onClick={() => remove.mutate()}
            >
              <Trash2 size={15} />
            </Button>
          </>
        )}
      </div>
      {inputError && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {inputError}
        </p>
      )}
      <ErrorNotice error={update.error ?? remove.error} />
    </li>
  );
}
function SuggestionPanel({ refresh }: { refresh: () => Promise<void> }) {
  const hydrated = useHydrated();
  const [accepted, setAccepted] = useState<string[]>([]);
  const suggest = useMutation({
    mutationFn: (data: Parameters<typeof suggestTodos>[0]["data"]) => suggestTodos({ data }),
    onSuccess: () => setAccepted([]),
  });
  const adopt = useMutation({
    mutationFn: (title: string) => createTodo({ data: { title } }),
    onSuccess: async (_, title) => {
      setAccepted((prev) => [...prev, title]);
      await refresh();
    },
  });
  const form = useForm({
    defaultValues: { goal: "", scenario: "normal" as "normal" | "slow" | "error" },
    onSubmit: async ({ value }) => {
      try {
        await suggest.mutateAsync(value);
      } catch {
        /* displayed below */
      }
    },
  });
  return (
    <section className="panel overflow-hidden" aria-labelledby="ai-heading">
      <div className="bg-teal-50/60 p-6">
        <span className="mb-4 inline-flex rounded-lg bg-white p-2 text-teal-700 shadow-xs">
          <Sparkles size={20} />
        </span>
        <h2 id="ai-heading" className="text-lg font-semibold">
          最初の一歩を、AIと。
        </h2>
        <p className="mt-2 text-xs leading-6 text-stone-500">
          やりたいことを伝えると、取り組みやすいTODOを提案します。
        </p>
      </div>
      <div className="space-y-4 p-6">
        <form
          method="post"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="goal" validators={{ onChange: suggestionInputSchema.shape.goal }}>
            {(field) => (
              <div>
                <label htmlFor="goal" className="mb-2 block text-xs font-medium text-stone-600">
                  達成したいこと
                </label>
                <textarea
                  id="goal"
                  disabled={!hydrated}
                  rows={3}
                  className="field resize-y"
                  placeholder="例：チームの勉強会を開きたい"
                  value={field.state.value}
                  maxLength={1000}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((e, i) => (
                  <p key={i} className="mt-1 text-xs text-red-700">
                    {e?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
          <form.Field name="scenario">
            {(field) => (
              <div>
                <label htmlFor="suggestion-scenario" className="mb-2 block text-xs text-stone-500">
                  デモの応答
                </label>
                <select
                  id="suggestion-scenario"
                  className="field"
                  value={field.state.value}
                  onChange={(e) =>
                    field.handleChange(e.target.value as "normal" | "slow" | "error")
                  }
                >
                  <option value="normal">通常</option>
                  <option value="slow">遅い応答</option>
                  <option value="error">エラー</option>
                </select>
              </div>
            )}
          </form.Field>
          <Button type="submit" className="w-full" disabled={!hydrated || suggest.isPending}>
            {suggest.isPending ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}{" "}
            {suggest.isPending ? "候補を考えています…" : "TODOを提案する"}
          </Button>
        </form>
        <ErrorNotice error={suggest.error ?? adopt.error} />
        {suggest.data && (
          <div className="space-y-3 border-t border-stone-100 pt-4">
            <p className="text-xs text-stone-500">気に入った候補だけ追加できます</p>
            {suggest.data.suggestions.map((item, i) => (
              <div className="rounded-lg border border-stone-200 p-3" key={`${i}-${item.title}`}>
                <p className="mb-2 text-sm leading-6">{item.title}</p>
                <Button
                  variant="outline"
                  className="w-full text-xs"
                  disabled={accepted.includes(item.title) || adopt.isPending}
                  onClick={() => adopt.mutate(item.title)}
                >
                  {accepted.includes(item.title) ? (
                    <>
                      <Check size={14} />
                      追加済み
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      TODOに追加
                    </>
                  )}
                </Button>
              </div>
            ))}
            <p className="text-[10px] text-stone-400">
              {suggest.data.model_version} · 固定されたダミー応答
            </p>
          </div>
        )}
        <p className="text-[11px] leading-5 text-stone-400">
          候補は「TODOに追加」を押すまで保存されません。
        </p>
      </div>
    </section>
  );
}
