# 実装メモと検証の範囲

計画からの判断、依存互換性、確認した範囲を残します。Next.jsは[対応コード](snippets/README.md)だけで、アプリは作っていません。説明用HTMLは[guide.html](guide.html)です。

## 固定した依存

ここに記載する版は実装時のmanifestに基づきます。正本は[ルートpackage.json](../package.json)、[web](../apps/web/package.json)、[chat-adapter](../packages/chat-adapter/package.json)、[Python pyproject.toml](../services/api/pyproject.toml)と各lockfileです。

| 対象                           | 採用版                                                |
| ------------------------------ | ----------------------------------------------------- |
| Node.js                        | 24系。enginesは`>=24 <25`                             |
| React / React DOM              | 19.3.1                                                |
| TanStack Start                 | 1.169.3                                               |
| Router / SSR Query連携         | 1.170.45 / 1.167.3                                    |
| Query / Form                   | 5.104.3 / 1.33.5                                      |
| TanStack AI / AI React         | 0.69.0 / 0.30.4                                       |
| AG-UI TypeScript / Python      | @ag-ui/core 1.0.0 / ag-ui-protocol 1.0.0              |
| TypeScript / Oxlint / tsgolint | 7.0.2 / 1.88.0 / 7.0.2004                             |
| Base UI / cva                  | @base-ui/react 1.9.0 / class-variance-authority 0.7.1 |
| Oxfmt / Vitest                 | 0.73.0 / 5.0.5                                        |
| Vite / Nitro                   | 8.3.4 / 3.0.260903-beta                               |
| OpenAPI型生成                  | openapi-typescript 7.13.0、専用環境のTypeScript 5.9.3 |
| Python / FastAPI               | Python 3.13〜3.14、FastAPI 0.143.3                    |

### TypeScript 7と型生成を分離する

アプリの型チェックは`oxlint --type-aware --type-check`へまとめています。Lint、型チェック、Viteの本番ビルド、ルート型の生成は同じ処理ではないため、別々に確認します。

`openapi-typescript`はTypeScriptの従来のコンパイラAPIを使い、採用版のpeer dependencyは`^5.x`です。アプリ側のTypeScript 7と同じ依存解決へ混ぜず、[tooling/api-codegen](../tooling/api-codegen/package.json)をルートworkspacesの外へ分け、専用lockfileとTypeScript 5.9.3を持たせました。

```sh
npm run setup:codegen
npm run generate:api
```

生成元はFastAPIが出力する`services/api/openapi.json`です。Pythonのスキーマを変えた際はOpenAPIも再出力します。生成型を手で修正しません。Zodの実行時検証は生成型と別に管理するので、応答項目を増やす場合は両者の更新が必要です。

### Startの採用版に合わせたAPI

採用したStart 1.169.3では入力検証に`.validator(schema)`を使います。計画段階で候補とした`.inputValidator`を使わず、インストールした版のAPIに合わせました。資料の抜粋も、このリポジトリで固定した版に合わせます。最新版ドキュメントのサンプルを、固定版でそのまま利用できるとは仮定しません。

### UI部品の組み立て

共有ButtonはBase UIのアクセシブルなプリミティブに、cvaとTailwindのバリアントを組み合わせたローカル実装です。shadcn/uiの構成に寄せていますが、shadcn CLIのregistryから生成したコンポーネントではありません。フォームの状態はTanStack Formを使います。

### チャットの接続と検証

サーバー関数方式を使い、`useChat`のfetcherから呼びます。Promiseを返す関数を同期AsyncIterable向けの`stream()`へ渡しません。Startは上流ヘッダーを確認してからSSEを開始するため、開始前のHTTP失敗と開始後の`RUN_ERROR`を分けられます。

`chat-adapter`はUIMessageを限定したRunAgentInputへ変換し、AG-UI SDKスキーマに加えて、このデモが受け付けるテキスト、工程名、ID、イベント順、終端を検証します。独自のイベント形式へ往復変換する処理は持ちません。テキスト差分は順次返し、終端イベントだけはEOFまで保留して重複終端を検出します。全体をバッファしているわけではありません。

キャンセルはブラウザのsignalとStartのリクエストsignal、下流レスポンスのキャンセル、上流fetchを接続します。Pythonはasync generatorの待機で協調的に中止します。停止は正常終了で補完せず、タイムアウトや切断とは区別します。

対応上限・アイドルタイムアウト・全体タイムアウトは[入力スキーマ](../packages/chat-adapter/src/input.ts)、[SSEリーダー](../packages/chat-adapter/src/sse.ts)、[サーバー関数](../apps/web/src/server/functions/chat.ts)、[Pythonスキーマ](../services/api/src/demo_api/schemas.py)で確認できます。履歴DB、ツール、添付、途中再開はサポートしません。

## 検証の記録

実装中に確認した結果を記録します。Composeの本番構成で、早期停止後の次の送信を含む7件のE2Eが成功しています。

| 確認                       | 実装中の結果                             | 範囲                                                                                                                        |
| -------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| FastAPIテスト              | 34件成功                                 | TODO、入力、fixture、配信等。SQLiteのテストDBでの確認                                                                       |
| Vitest                     | 38件成功                                 | 入力・イベント・分割SSE・終端・キャンセル・Python SDK fixtureとの契約・早期停止時の空assistant履歴・Python側の上限との整合  |
| Start本番ビルド            | 成功                                     | クライアント・サーバーの生成。ブラウザ操作の代替ではない                                                                    |
| 型チェック検出範囲         | `npm run verify:typecheck`成功           | アプリ・共有パッケージに意図的に入れた型エラーの検出を確認                                                                  |
| OpenAPI型生成              | 専用環境で生成成功                       | アプリTypeScript 7と型生成TypeScript 5.9.3を分離                                                                            |
| Oxlint・型チェック / Oxfmt | 成功                                     | 型検査を含むLintと整形チェック                                                                                              |
| Python Ruff                | 成功                                     | PythonのLint・整形チェック                                                                                                  |
| ブラウザ用バンドル境界     | `npm run check:boundary`成功             | サーバー専用の接続設定・内部コードがクライアントへ混入しないことを確認                                                      |
| Composeイメージ            | build成功                                | Start・FastAPIのコンテナイメージの生成                                                                                      |
| 開発サーバーのブラウザE2E  | 6件成功                                  | TODO CRUD・URL絞り込み・再読込での保持・候補の一度だけの採用、配信途中表示・再生成・停止・配信前後の失敗・切断              |
| PostgreSQL統合             | 実DBで成功                               | migration・seed・CRUD。SQLite単体テストとは別に確認                                                                         |
| 上流キャンセルの到達       | APIログで確認                            | 通常6チャンクに対し、ブラウザ停止時は`outcome=cancelled content_chunks=1`                                                   |
| Compose本番構成のE2E       | 7件成功                                  | PostgreSQL・FastAPI・Startの本番構成。最初のテキスト前の停止後にも同じ会話で次の送信が成功                                  |
| 説明用HTML                 | 1440px / 390pxでChromium表示と画像を確認 | モバイル幅のdocument scrollWidthは390px、横にはみ出しなし。ローカルリンク欠損・HTML ID重複なし、外部ネットワークリソース0件 |
| Next.js対応例              | 公式資料を2026-10-17に確認               | 概念例のみ。未型チェック・未ビルド・未実行                                                                                  |

説明用HTMLには実装済みアプリの[TODO画面](screenshots/todos.png)と[チャット画面](screenshots/chat.png)、構成図、実装へのリンクを掲載しています。JavaScript・外部フォント・CDN依存はありません。画面の操作は実アプリで確認してください。

Startサーバー関数の配信経路で途中表示と停止を確認できたため、チャットのServer Route方式への切り替えは行っていません。開発環境のブラウザ検証と、Compose本番構成の検証は分けて記録しています。

テスト中にhttpx TestClient由来の非推奨警告が1件、本番ビルド中にNitro/Rolldown由来の`use client`に関する警告が出ています。テストとビルドは成功しており、この時点では動作を妨げていません。

## 今回の判断と制約

- TODOとJSONのAI候補は、AG-UIやチャットSDKへ依存させません。候補は採用操作まで保存されません。
- TODOのDBはFastAPIが所有します。アプリDBをStartへ移す案2の構成と混在させません。
- AIは固定ルールのダミーです。外部AIキー、GPU、モデルプロバイダーは使いません。
- 会話はブラウザのメモリ内です。threadIdは永続履歴、runIdは冪等性や再開を保証しません。
- 単一利用者のローカルデモです。認証・利用者別権限、公開運用、AWS等の構築は別の要件です。
- Nitroは固定したbeta版です。TanStack AIも0系の固定版を使い、全機能や本番向け成熟度を一括保証する比較にはしません。
- 実装時間、初見の理解時間、性能、Next.jsとの実測比較は行っていません。機能追加の練習手順は用意しています。

## 公式仕様の参照

確認日: 2026-10-17。

- [Start Server Functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)
- [Query Advanced Server Rendering](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)
- [TanStack AI Server Functions](https://tanstack.com/ai/latest/docs/transports/server-functions)
- [TanStack AI Transports](https://tanstack.com/ai/latest/docs/transports/overview)
- [Next.js Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data)
- [Next.js Mutating Data](https://nextjs.org/docs/app/getting-started/mutating-data)
- [Next.js Route Handler](https://nextjs.org/docs/app/api-reference/file-conventions/route)

計画が参照するNext.jsの旧`updating-data` URLは確認時に404だったため、比較資料では現行の`mutating-data`へリンクしています。
