# 更新と候補取得: Server Action

**概念例 / 未ビルド・未型チェック・未実行。** サーバーの検証と、期待できる入力エラーを戻り値で表す経路に絞ったJS/JSXです。認証はローカルデモと同様に省略しています。

```js
// app/todos/actions.js
'use server'
import { revalidatePath } from 'next/cache'
import { createTodoSchema, suggestionInputSchema, suggestionsSchema } from '@demo/api-contract'

export async function addTodo(_previousState, formData) {
  const parsed = createTodoSchema.safeParse({ title: formData.get('title') })
  if (!parsed.success) return { error: 'タイトルは1〜200文字で入力してください' }
  try {
    const response = await fetch(`${process.env.API_BASE_URL}/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return { error: 'TODOを追加できませんでした' }
  } catch {
    return { error: 'APIへ接続できませんでした' }
  }
  revalidatePath('/todos')
  return { error: null }
}

// サーバー実行が必要なオンデマンドの提案取得。DBには保存しない。
export async function suggest(input) {
  const parsed = suggestionInputSchema.safeParse(input)
  if (!parsed.success) return { error: '目的文を確認してください' }
  try {
    const response = await fetch(`${process.env.API_BASE_URL}/ai/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return { error: '候補を取得できませんでした' }
    return { data: suggestionsSchema.parse(await response.json()) }
  } catch {
    return { error: '候補を取得できませんでした' }
  }
}
```

```jsx
// app/todos/add-form.jsx
'use client'
import { useActionState } from 'react'
import { addTodo } from './actions'

export function AddForm() {
  const [state, action, pending] = useActionState(addTodo, { error: null })
  return (
    <form action={action}>
      <label>タイトル<input name="title" required maxLength={200} /></label>
      <button disabled={pending}>{pending ? '保存中…' : '追加'}</button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  )
}
```

更新・削除でもAction内でIDと更新値を検証してから同じFastAPIへ渡します。候補の採用は、候補のtitleを`addTodo`相当の作成操作へ渡す別操作です。提案が返っただけではDBを書き換えません。

`revalidatePath`はServer Componentの一覧を更新する比較です。[同じQueryを使う比較](next-query.md)では、Actionの成功を確かめた後に`queryClient.invalidateQueries({ queryKey: ['todos'] })`も行います。Next.jsの再検証とブラウザのQueryキャッシュの無効化は別の仕組みです。

Startでは`createServerFn({ method: 'POST' }).validator(schema).handler(...)`で入力検証とサーバー処理を並べ、画面がmutationから呼びます。いずれも、入力欄の`required`やTypeScriptの型だけでサーバー検証を代用できません。認証が必要な案件では両者とも各操作の境界に権限チェックが必要です。

出典: [Next.js Mutating Data](https://nextjs.org/docs/app/getting-started/mutating-data)。
