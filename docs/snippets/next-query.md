# 同じQueryを使う条件で比べる

**概念例 / 未ビルド・未型チェック・未実行。** QueryProvider、HTTPのエラー部品、URLを変更するUIの実装は省略しています。Next.jsがインストールされている想定のJS/JSXです。

Server Componentで読むだけの構成と、ブラウザにQueryキャッシュを持つ構成では取得状態や更新の条件が違います。ここでは両方にQueryを使い、`['todos', filter]`、`staleTime: 30_000`、再試行1回をStart側に揃える想定です。

```js
// lib/todo-query.js — ブラウザから見えるのは同一オリジンのAPIだけ
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { todoSchema } from '@demo/api-contract'

export function todoOptions(filter) {
  return queryOptions({
    queryKey: ['todos', filter],
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      const query = new URLSearchParams({ filter })
      const response = await fetch(`/api/todos?${query}`)
      if (!response.ok) throw new Error('TODOを取得できませんでした')
      return z.array(todoSchema).parse(await response.json())
    },
  })
}
```

```js
// app/api/todos/route.js
import { filterSchema } from '@demo/api-contract'
import { readTodos } from '@/lib/todos.server' // next-read.mdのサーバー専用関数

export async function GET(request) {
  const parsed = filterSchema.safeParse(new URL(request.url).searchParams.get('filter'))
  if (!parsed.success) return Response.json({ error: '不正な絞り込み' }, { status: 400 })
  try {
    return Response.json(await readTodos(parsed.data), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return Response.json({ error: 'TODOを取得できませんでした' }, { status: 502 })
  }
}
```

```jsx
// app/todos/page.jsx — サーバー取得時は同一アプリのHTTPを経由しない
import { QueryClient, dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { filterSchema } from '@demo/api-contract'
import { readTodos } from '@/lib/todos.server'
import { Todos } from './todos'

export default async function Page({ searchParams }) {
  const filter = filterSchema.catch('all').parse((await searchParams).filter)
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } }) // リクエストごとに分ける
  await client.fetchQuery({
    queryKey: ['todos', filter],
    queryFn: () => readTodos(filter),
    staleTime: 30_000,
  })
  return <HydrationBoundary state={dehydrate(client)}><Todos filter={filter} /></HydrationBoundary>
}
```

```jsx
// app/todos/todos.jsx — 上位にブラウザ用QueryClientProviderが必要
'use client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { todoOptions } from '@/lib/todo-query'

export function Todos({ filter }) {
  const { data } = useSuspenseQuery(todoOptions(filter))
  return <ul>{data.map(todo => <li key={todo.id}>{todo.title}</li>)}</ul>
}
```

省略したブラウザ用QueryClientProviderでも、`defaultOptions.queries.retry`を1に設定します。

Next.js例ではサーバー取得用の関数とブラウザ再取得用Route Handlerを分けています。StartのQuery関数は同じサーバー関数をSSRとブラウザ遷移から呼べるため、アプリ専用RPCとして経路をまとめられます。Next.jsにも他の構成を選ぶ余地があり、この抜粋のファイル数だけで一般的な優劣は決まりません。

どちらも変更の成功後に`['todos']`を無効化すれば、絞り込みごとの一覧を再取得できます。ローカルな編集中の文字列、ダイアログの開閉、採用済み候補の状態は別途UIで管理します。

出典: [TanStack Query Advanced Server Rendering](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)、[Next.js Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data)、[Route Handler](https://nextjs.org/docs/app/api-reference/file-conventions/route)。
