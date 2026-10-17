import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  Outlet,
  Link,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { Layers3, ListTodo, MessagesSquare, ArrowUpRight } from "lucide-react";
import "../styles.css";
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Workroom — 作業アシスタント" },
    ],
  }),
  component: Root,
  notFoundComponent: () => (
    <main className="p-12">
      <h1>ページが見つかりません</h1>
      <Link to="/todos" search={{ filter: "all" }}>
        TODOへ戻る
      </Link>
    </main>
  ),
  errorComponent: ({ error, reset }) => (
    <main className="p-12">
      <h1>読み込みに失敗しました</h1>
      <p role="alert">{error instanceof Error ? error.message : "処理に失敗しました"}</p>
      <button onClick={reset}>再試行</button>
    </main>
  ),
});
function Root() {
  return (
    <html lang="ja">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="min-h-screen">
          <header className="border-b border-stone-200 bg-white/90">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
              <Link
                to="/todos"
                search={{ filter: "all" }}
                className="flex items-center gap-3 font-semibold tracking-tight text-stone-900"
              >
                <span className="rounded-xl bg-teal-800 p-2 text-white">
                  <Layers3 size={22} />
                </span>
                <span className="text-xl">
                  workroom<span className="ml-2 text-xs font-normal text-stone-400">DEMO</span>
                </span>
              </Link>
              <nav aria-label="メイン" className="flex gap-1">
                <Link
                  to="/todos"
                  search={{ filter: "all" }}
                  className="nav-link"
                  activeProps={{ className: "nav-link nav-active" }}
                >
                  <ListTodo size={16} />
                  TODO
                </Link>
                <Link
                  to="/chat"
                  className="nav-link"
                  activeProps={{ className: "nav-link nav-active" }}
                >
                  <MessagesSquare size={16} />
                  チャット
                </Link>
              </nav>
              <a
                className="hidden items-center gap-1 text-xs text-stone-500 sm:flex"
                href="https://github.com/shimpei1494/tanstack-start-fastapi-demo"
              >
                ソースコード
                <ArrowUpRight size={14} />
              </a>
            </div>
          </header>
          <Outlet />
          <footer className="mx-auto mt-14 flex max-w-6xl justify-between border-t border-stone-200 px-5 py-6 text-xs text-stone-500 sm:px-8">
            <span>TanStack Start × FastAPI</span>
            <span>ローカルデモ · AIは固定応答です</span>
          </footer>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
