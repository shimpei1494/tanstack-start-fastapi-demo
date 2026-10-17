import { Suspense } from "react";
import { QueryErrorResetBoundary, useSuspenseQuery } from "@tanstack/react-query";
import { CatchBoundary, Link, useHydrated } from "@tanstack/react-router";
import { BarChart3, Check, Clock3, ListTodo, LoaderCircle, RotateCcw } from "lucide-react";
import { Button, ErrorNotice } from "@demo/ui";
import type { ReportScenario } from "@demo/api-contract";
import { reportOptions } from "../../queries/reports";
import { Route } from "../../routes/reports";

export function ReportPage() {
  const { scenario } = Route.useSearch();
  return (
    <main className="mx-auto max-w-6xl px-5 pt-10 sm:px-8 sm:pt-14">
      <p className="eyebrow mb-3">A moment to reflect</p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        ここまでの作業を、ひと目で。
      </h1>
      <p className="mt-3 text-sm leading-7 text-stone-500">
        保存したTODOを集計し、次に取り組む作業をまとめます。
      </p>
      <div className="mt-9 grid items-start gap-6 lg:grid-cols-[1fr_280px]">
        <div>
          <QueryErrorResetBoundary key={scenario}>
            {({ reset }) => (
              <CatchBoundary
                getResetKey={() => scenario}
                errorComponent={({ error, reset: resetBoundary }) => (
                  <section className="panel space-y-5 p-6" aria-label="レポートのエラー">
                    <h2 className="font-semibold">レポートを作成できませんでした</h2>
                    <ErrorNotice error={error} />
                    <Button
                      onClick={() => {
                        reset();
                        resetBoundary();
                      }}
                    >
                      <RotateCcw size={16} />
                      もう一度試す
                    </Button>
                  </section>
                )}
              >
                <Suspense fallback={<ReportPending />}>
                  <ReportResult scenario={scenario} />
                </Suspense>
              </CatchBoundary>
            )}
          </QueryErrorResetBoundary>
        </div>
        <aside className="panel space-y-4 p-5" aria-labelledby="report-demo-heading">
          <h2 id="report-demo-heading" className="text-sm font-medium">
            デモの応答
          </h2>
          <nav aria-label="レポートの応答" className="flex flex-col gap-2">
            {(
              [
                ["slow", "3秒待って成功"],
                ["error", "3秒待って失敗"],
                ["normal", "待ち時間なし"],
              ] as const
            ).map(([value, label]) => (
              <Link
                key={value}
                to="/reports"
                search={{ scenario: value }}
                preload={false}
                aria-current={scenario === value ? "page" : undefined}
                className={`rounded-lg border px-3 py-2.5 text-sm ${scenario === value ? "border-teal-300 bg-teal-50 text-teal-800" : "border-stone-200 text-stone-600 hover:bg-stone-50"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <p className="text-xs leading-6 text-stone-500">
            集計中もページの操作や移動ができます。「再集計」では、前回の結果を表示したまま更新します。
          </p>
          <p className="text-xs leading-6 text-stone-400">
            デモ用の待ち時間をAPIに入れています。レポートを開いてもTODOは変更されません。
          </p>
        </aside>
      </div>
    </main>
  );
}
function ReportPending() {
  return (
    <section className="panel p-6" aria-label="レポートを集計中" aria-busy="true">
      <output className="flex items-center gap-2 text-sm text-teal-800">
        <LoaderCircle size={17} className="animate-spin" />
        作業レポートを集計しています…
      </output>
      <div className="mt-6 grid grid-cols-3 gap-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl bg-stone-100 motion-reduce:animate-none"
          />
        ))}
      </div>
      <p className="mt-5 text-xs text-stone-400">結果が届くと、この部分に表示します。</p>
    </section>
  );
}
function ReportResult({ scenario }: { scenario: ReportScenario }) {
  const hydrated = useHydrated();
  const { data, isFetching, error, refetch } = useSuspenseQuery(reportOptions(scenario));
  return (
    <section className="panel space-y-6 p-6" aria-label="作業レポート" aria-busy={isFetching}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <BarChart3 size={18} className="text-teal-700" />
          作業レポート
        </h2>
        <Button variant="outline" disabled={!hydrated || isFetching} onClick={() => void refetch()}>
          {isFetching ? (
            <LoaderCircle size={15} className="animate-spin" />
          ) : (
            <RotateCcw size={15} />
          )}
          再集計
        </Button>
      </div>
      <output className="flex items-center gap-2 text-xs text-stone-500">
        {isFetching
          ? "前回の結果を表示しながら再集計しています…"
          : error
            ? "再集計に失敗しました。前回の結果を表示しています。"
            : "最新の集計結果です。"}
      </output>
      <ErrorNotice error={error} />
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "すべて", value: data.total, Icon: ListTodo },
          { label: "完了", value: data.completed, Icon: Check },
          { label: "未完了", value: data.remaining, Icon: Clock3 },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="rounded-xl bg-stone-50 px-3 py-4 sm:px-5">
            <p className="flex items-center gap-1.5 text-xs text-stone-500">
              <Icon size={13} />
              {label}
            </p>
            <p className="mt-3 text-2xl font-semibold tabular-nums text-stone-800">
              {value}
              <span className="ml-1 text-xs font-normal text-stone-400">件</span>
            </p>
          </div>
        ))}
      </div>
      <p className="text-sm leading-7 text-stone-600">{data.summary}</p>
      <div className="border-t border-stone-100 pt-5">
        <h3 className="mb-3 text-xs font-medium text-stone-500">次に取り組む作業</h3>
        {data.next_todos.length > 0 ? (
          <ul className="space-y-3">
            {data.next_todos.map((todo) => (
              <li className="flex gap-2 text-sm leading-6" key={todo.id}>
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600" />
                {todo.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">未完了のTODOはありません。</p>
        )}
      </div>
      <Link
        to="/todos"
        search={{ filter: "all" }}
        className="inline-flex text-sm font-medium text-teal-800"
      >
        TODOを整理する →
      </Link>
    </section>
  );
}
