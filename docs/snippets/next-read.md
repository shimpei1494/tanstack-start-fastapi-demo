# 一覧取得: Server Component

**概念例 / 未ビルド・未型チェック・未実行。** `.jsx`と`.js`として置く想定の抜粋です。`@demo/api-contract`はこのリポジトリにある実際のZodスキーマを指します。Next.js用エイリアスの設定は省略しています。

Startではloader → `todoOptions(filter)` → `listTodos({ data: filter })` → サーバー専用APIクライアントです。Next.jsではServer Componentからサーバー専用関数を直接呼べます。どちらもブラウザからFastAPIへ直接接続しません。

```jsx
// app/todos/page.jsx — Server Component
import { filterSchema } from '@demo/api-contract'
import { readTodos } from '@/lib/todos.server'
import { TodoList } from './todo-list'

export default async function Page({ searchParams }) {
  const search = await searchParams
  const filter = filterSchema.catch('all').parse(search.filter)
  const todos = await readTodos(filter)
  return <TodoList todos={todos} filter={filter} />
}
```

```js
// lib/todos.server.js — このモジュールはClient Componentへimportしない
import 'server-only'
import { z } from 'zod'
import { todoSchema } from '@demo/api-contract'

export async function readTodos(filter) {
  const query = new URLSearchParams()
  if (filter !== 'all') query.set('completed', String(filter === 'completed'))
  const response = await fetch(`${process.env.API_BASE_URL}/todos?${query}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('TODOを取得できませんでした')
  return z.array(todoSchema).parse(await response.json())
}
```

`TodoList`は表示部品として省略しています。更新操作を持つならClient ComponentとAction等を組み合わせます。`API_BASE_URL`を`NEXT_PUBLIC_`環境変数へ移す必要はありません。`no-store`はこの比較例で毎回最新を読む意図を明示する指定です。Next.jsのキャッシュ全体や性能を測った例ではありません。

Startのloaderはクライアント遷移でも実行されるため、loaderの中に内部APIの接続先や資格情報を置きません。Next.jsのServer Componentとloaderを、同じ実行境界と考えないことが読みどころです。

出典: [Next.js Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data)、[Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)。
