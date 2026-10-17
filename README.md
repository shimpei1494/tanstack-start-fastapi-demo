# Workroom — TanStack Start × FastAPI

TODO管理、ダミーAIによるTODO候補、途中配信するチャットを備えたローカルデモです。ブラウザ → StartのServer Functions → FastAPI → PostgreSQLの境界を、動くコードで追えます。外部AIサービスのAPIキーは不要です。

## 最短の起動

Docker Composeを使用します。初回は依存とイメージのダウンロードが必要です。

```sh
docker compose up --build -d
docker compose exec api seed-demo
```

[TODO画面](http://localhost:3000/todos) / [チャット画面](http://localhost:3000/chat) / [作業レポート](http://localhost:3000/reports) / [FastAPI仕様](http://localhost:8000/docs)

seedは初期TODOを重複作成しません。保存先はComposeのPostgreSQL volumeです。`docker compose down` で停止してもTODOが残ります。起動に使うポートは3000（Web）、8000（API）、5435（DB）です。

## 操作してみる

1. TODOを追加し、編集・完了切り替え・削除を試します。「すべて／未完了／完了」はURLに反映されます。再読み込みでも保存内容が残ります。
2. 「達成したいこと」に目的を入力し、候補を提案します。「TODOに追加」を押すまでDBは変わりません。採用した候補は追加済みになります。「遅い応答」「エラー」で状態表示も試せます。
3. チャットへ移動しメッセージを送ります。処理工程と部分回答が届きます。「ゆっくり配信」では生成中に停止できます。「配信途中のエラー」「途中切断」「配信開始前のエラー」は完了扱いされません。「返答を再生成」は新しいrunIdで実行します。

AIは入力検証後に同じ固定候補・固定返答を返すfixtureです。会話は画面のメモリ内のみで、再読み込みで消えます。停止後もTODO操作は利用できます。

## 待ち時間とpendingを試す

「レポート」はPython APIが約3秒待ってから、保存済みTODOの集計を返します。初回は集計欄だけが待機表示になり、再集計は前回の結果を残します。「3秒待って失敗」では局所的なエラーと再試行を確認できます。TODO候補の送信も「3秒待って成功／失敗」で試せます。

取得用のuseEffectやloading専用stateを増やさず、Suspense・QueryのisFetching・mutationのisPendingから表示を決めています。コードと役割の解説は [待ち時間の実装](docs/pending.md) を参照してください。

## ローカル開発

Node.js 24系、uv、Python 3.13〜3.14、Dockerが必要です。依存はnpmとuvのlockfileで固定しています。

```sh
npm ci
docker compose up -d db
cd services/api
uv sync --frozen
export DATABASE_URL=postgresql+psycopg://demo:demo@localhost:5435/demo
uv run alembic upgrade head
uv run seed-demo
uv run uvicorn demo_api.main:app --reload --host 127.0.0.1 --port 8000
```

別のターミナルでリポジトリのルートから実行します。

```sh
npm run dev
```

Startの内部API接続先はサーバー環境変数 `API_BASE_URL`（既定 `http://127.0.0.1:8000`）。Composeでは `http://api:8000` を渡します。設定例は [.env.example](.env.example)。uvコマンドには `DATABASE_URL` を明示的にexportしてください。Compose全体とローカル開発は同じポートを使うため、Web/APIを同時に二重起動しないでください。

```sh
npm run build
npm run start
```

本番ビルドはNitroのNodeサーバーへ出力します。Startは安定版1.169.3、TanStack AIはRC系列の採用版0.69.0（Reactフック0.30.4）です。バージョン固有の注意点は [実装・検証メモ](docs/implementation-notes.md) に記録します。

## 検証

```sh
npm run lint                 # Oxlint type-aware + type-check（TypeScript 7）
npm run verify:typecheck     # appと共有packageの意図的な型エラー検出を確認
npm run format:check
npm test                     # AG-UI、SSE、UTF-8分割、順序、終端、停止など
npm run build
npm run check:boundary       # public配信物にサーバー設定が混入していないか
uv run --directory services/api ruff check .
uv run --directory services/api pytest
```

APIとDBを起動した状態で、ブラウザの主要フローを確認できます。

```sh
npx playwright install chromium
npm run test:e2e
```

通常はテストがStartの開発サーバーを起動します。Composeや本番サーバーを確認する場合は `E2E_EXTERNAL_SERVER=1 npm run test:e2e`。テストはデモDBにTODOを作成します。生成器の停止は `docker compose logs api` の `outcome=cancelled content_chunks=...` でも確認できます。

## コードを読む順番

| 入口                                                                   | 役割                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------ |
| [TODO route](apps/web/src/routes/todos.tsx)                            | URL検証、loaderDeps、loaderでの先行取得          |
| [Query定義](apps/web/src/queries/todos.ts)                             | loaderと画面で共有するキーと取得関数             |
| [Server Functions](apps/web/src/server/functions/todos.ts)             | 型付きRPCとサーバー側入力検証                    |
| [内部APIクライアント](apps/web/src/server/api-client/client.server.ts) | サーバー専用設定、OpenAPI型、応答のZod検証       |
| [TODO画面](apps/web/src/features/todos/todo-page.tsx)                  | TanStack Form、Query mutation、採用操作          |
| [Router](apps/web/src/router.tsx)                                      | SSRリクエストごとのQueryClientとhydration        |
| [チャット画面](apps/web/src/features/chat/chat-page.tsx)               | TanStack AI useChatのfetcher、会話状態、工程表示 |
| [チャット関数](apps/web/src/server/functions/chat.ts)                  | SSEの中継とリクエスト中止の接続                  |
| [AG-UI adapter](packages/chat-adapter/src/index.ts)                    | 入力変換、イベント検証、順序と終端のチェック     |
| [FastAPI](services/api/src/demo_api/main.py)                           | 最小CRUD、候補、Python SDKでの配信               |

loaderはブラウザでも実行されるため、内部APIを直接呼ばずServer Functionsを使います。Server Functionsは実行境界と型を、Queryはキャッシュ・取得状態・更新後の再取得を、TanStack AIは会話と配信状態を担当します。これらをStart単体の機能とは説明しません。

## API型の更新

通常のJSON APIはOpenAPI型とopenapi-fetchを使い、必要な入出力をZodでも検証します。チャットのみAG-UIです。

```sh
uv run --directory services/api export-openapi
npm run setup:codegen
npm run generate:api
```

生成型はGitへ同梱済みなので通常の起動時にコード生成は不要です。openapi-typescriptの旧コンパイラAPI依存を `tooling/api-codegen` のTypeScript 5.9.3へ隔離し、アプリのTypeScript 7と分けています。API変更時はOpenAPI・生成型・Zod境界・契約テストを揃えます。

## 計画・比較・紹介資料

- [全体計画](docs/plans/README.md) / [実装計画と進捗](docs/plans/implementation.md) / [ストリーミング契約](docs/plans/streaming-contract.md)
- [Next.js対応例と読み方](docs/comparison.md) / [説明用コード](docs/snippets/README.md)
- [紹介HTML](docs/guide.html)（ローカルで開く。外部依存なし） / [実装・検証メモ](docs/implementation-notes.md)

Next.jsのアプリは作成せず、Server Components・Server Actions・Route Handlerによる対応を概念例として示します。フレームワークの実装時間や性能の実測比較は行っていません。

認証・永続チャット履歴・実モデル・AWS構築・ジョブ基盤は今回の範囲外です。チャットが不要な場合の削除箇所、小さな機能追加の手順は比較ドキュメントに記載しています。
