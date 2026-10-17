# Next.js対応例の読み方

ここにあるコードは、同じFastAPIとデータ契約をNext.js App Routerから使う場合の**概念例**です。Next.jsの依存、起動するアプリ、型チェック用workspaceは追加していません。TypeScriptの型注釈を省いた説明用JS/JSXであり、ビルド・型チェック・実行テストはしていません。アプリへコピーしてそのまま完成するコードではありません。

公式資料は2026-10-17に確認しました。公式の最新版と、Startアプリが固定している依存の版は別です。実装済みStartのコードと対応させ、サーバー境界・取得・更新・ストリームの経路を読む目的で使ってください。

| 操作 | 概念例 | 実装済みStartの入口 |
| --- | --- | --- |
| 一覧取得 | [Server Component](next-read.md) | `apps/web/src/routes/todos.tsx` → `src/queries/todos.ts` |
| TODO追加・候補取得 | [Server Action](next-mutations.md) | `apps/web/src/server/functions/todos.ts` |
| 同じQuery条件で一覧取得 | [QueryとHydration](next-query.md) | `apps/web/src/router.tsx`、`src/queries/todos.ts` |
| チャット配信 | [Route Handlerと同じTanStack AI](next-chat.md) | `apps/web/src/server/functions/chat.ts` |

Next.jsでは読み込みをすべてServer Actionへ集約せず、Server Componentによる読み込み、Actionによる操作、Route HandlerによるHTTP接続を目的に合わせて使います。QueryとチャットSDKを使う効果は、どちらのフレームワークにも持ち込めます。

実行できるアプリの起動は[ルートREADME](../../README.md)、比較全体は[comparison.md](../comparison.md)を参照してください。
