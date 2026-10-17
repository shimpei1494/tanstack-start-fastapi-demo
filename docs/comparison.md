# Start実装とNext.jsの対応コード

このデモは、TODOのCRUD、目的文からの候補提案、ストリーミングチャットを、ブラウザ → TanStack Start → FastAPI → PostgreSQLの経路で実装しています。業務データを保存するのはFastAPIです。Startは画面のためのサーバー境界とAPI中継を担当します。

**Startのコードは実装、Next.jsのコードは説明用の概念例**です。Next.jsアプリはインストールしておらず、対応例のビルド・型チェック・実行はしていません。両アプリを動かした性能、工数、コード量の実測比較ではありません。確認したコマンドと制約は[実装メモ](implementation-notes.md)、ブラウザで読む紹介資料は[guide.html](guide.html)にまとめています。

## 最初にコードを追う順番

| 順番 | 実装ファイル                                                                                                      | 読みどころ                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1    | [TODO route](../apps/web/src/routes/todos.tsx)                                                                    | URLのfilterを検証し、loaderと画面へ渡す              |
| 2    | [Query定義](../apps/web/src/queries/todos.ts)                                                                     | `['todos', filter]`を取得条件の単位にする            |
| 3    | [TODOサーバー関数](../apps/web/src/server/functions/todos.ts)                                                     | `.validator(...)`と`.handler(...)`がサーバーへの入口 |
| 4    | [内部APIクライアント](../apps/web/src/server/api-client/client.server.ts)                                         | 接続先、HTTP、応答の実行時検証                       |
| 5    | [FastAPI](../services/api/src/demo_api/main.py)                                                                   | 保存操作と候補提案、チャット配信のHTTP入口           |
| 6    | [Chatサーバー関数](../apps/web/src/server/functions/chat.ts)、[アダプター](../packages/chat-adapter/src/index.ts) | 入力整形、イベント検証、終端確認、キャンセルの中継   |

Startのloaderはブラウザ遷移でも動きます。APIクライアントをloaderへ直接importせず、`createServerFn`で定義した関数を呼びます。ビルドはブラウザ側のサーバー関数をRPC呼び出しへ置き換えます。内部接続設定を返却値やエラー文へ含めないことも、実装側の責任です。[Start Server Functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)

## フレームワークと周辺ライブラリの役割

| 担当                   | このアプリで担うこと                                         | その機能だけで解決しないこと                      |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| TanStack Start         | SSR、サーバー関数、ブラウザとサーバー間の型付き呼び出し      | Queryキャッシュ、入力フォームの状態、認証ポリシー |
| TanStack Router        | URLの検証、遷移、loader、読み込みとエラー境界                | DB保存や上流APIへの秘密情報の管理                 |
| TanStack Query         | キャッシュ、取得状態、mutation、成功後の一覧無効化           | サーバー実行場所の保証や実行時入力検証            |
| TanStack Form / UI部品 | 入力・送信状態、画面操作                                     | 画面を経由しない不正リクエストへの検証            |
| TanStack AI            | 会話メッセージ、受信状態、停止・再生成とストリームの読み取り | FastAPIの生成処理、履歴DB、上流キャンセルの配線   |
| API契約 / chat-adapter | OpenAPI型、Zod検証、AG-UIの入力とイベントの接続              | AI出力の品質、AG-UIの全機能対応                   |
| FastAPI / PostgreSQL   | TODOの永続保存、固定候補、時間差のイベント生成               | ブラウザ上のQueryキャッシュ管理                   |

取得のための`useEffect`を減らすのはRouterとQueryの効果です。サーバーの処理を型付き関数として呼ぶのはStartの効果です。チャットの会話状態を手書きせずに済む部分はAI SDKの効果であり、Next.jsでも同じSDKを使えます。編集入力や採用済み候補のような画面固有stateは残ります。

## 同じ操作の対応表

| 操作                 | このStart実装                                       | Next.js App Routerの概念例                                           |
| -------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| 一覧を読む           | loader → Query → GETサーバー関数                    | Server Component → サーバー専用関数。取得をServer Actionに統一しない |
| 完了状態で絞る       | 検証済みURL → loaderDeps → Queryキー                | `searchParams`を検証 → サーバー取得。同じQuery条件にもできる         |
| TODOを追加する       | Form → mutation → POSTサーバー関数 → API            | フォーム → Server Action → API → 再検証                              |
| 更新後に一覧を変える | `invalidateQueries(['todos'])`相当                  | Server Componentなら`revalidatePath`。QueryならQueryの無効化も必要   |
| 目的文から候補を読む | POSTサーバー関数 → `/ai/suggestions`                | オンデマンドのServer Action等 → 同じAPI                              |
| 候補を採用する       | 通常のTODO作成を別に実行                            | 同じ。候補の生成だけでは保存しない                                   |
| チャットを送る       | `useChat`のfetcher → POSTサーバー関数               | 同じ`useChat` → HTTP接続 → Route Handler                             |
| 生成を止める         | ブラウザのsignal → Startの上流HTTP → Pythonの生成器 | ブラウザのsignal → Route Handlerの上流HTTP → 同じPythonの生成器      |

対応例: [Server Component](snippets/next-read.md)、[Server Action](snippets/next-mutations.md)、[Queryの条件を揃える例](snippets/next-query.md)、[チャットRoute Handler](snippets/next-chat.md)。公式の取得・更新・HTTPの用途に合わせて整理しています。[Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data)、[Mutating Data](https://nextjs.org/docs/app/getting-started/mutating-data)、[Route Handler](https://nextjs.org/docs/app/api-reference/file-conventions/route)

### Queryの条件を揃えて見る

Startでは`todoOptions(filter)`をloaderの事前取得と画面で共有します。`getRouter()`がQueryClientを生成するため、SSRのキャッシュをプロセス全体のグローバル変数へ置きません。取得時の状態と更新後の無効化はQueryが管理します。

Next.jsにもTanStack Queryを導入できます。対応例は同じQueryキーとstaleTimeを使い、Server Componentで事前取得してHydrationBoundaryへ渡し、ブラウザの再取得は同一オリジンのRoute Handlerを使います。SSR用QueryClientはリクエストごとに分けます。ブラウザ用Providerの設置は別に必要です。[TanStack Query Advanced Server Rendering](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)

この例でStartの経路を追いやすくするのは、同じ関数をSSRとブラウザから呼べることです。Queryのキャッシュ自体はStart固有ではありません。Next.js側でQueryを使わずServer Component中心に設計する判断もあり、要件が変われば比較の基準も変わります。

### チャットは通信経路とUIを分けて見る

`useChat`は同じAG-UIのイベントからメッセージと状態を更新できます。Startのサーバー関数はPromiseを返すのでfetcherを使います。Next.jsのRoute Handlerには`fetchServerSentEvents('/api/chat')`で接続する対応例を示します。[TanStack AI Transports](https://tanstack.com/ai/latest/docs/transports/overview)、[Server Functions](https://tanstack.com/ai/latest/docs/transports/server-functions)

AG-UI入力へ変換する境界、受け付けるイベント、IDの整合、実行の終端、途中切断とキャンセルは、どちらのサーバーでも必要です。チャンクを全部読んでから返すと途中表示になりません。`TEXT_MESSAGE_END`だけで実行全体の成功にはせず、`RUN_FINISHED`または`RUN_ERROR`を扱います。SDKの対応型があることと、Pythonから届いた値が正しいことは別なのでアダプターで検証します。詳細は[共通契約](plans/streaming-contract.md)を参照してください。

## 小変更: AI候補に「理由」を追加する

練習用の変更です。現在の候補の保存項目はtitleだけです。理由は候補を選ぶための表示情報として追加し、TODOのテーブルへ保存するかは別に判断します。

1. [Pythonスキーマ](../services/api/src/demo_api/schemas.py)の`Suggestion`に`reason`を追加する。
2. [fixture](../services/api/src/demo_api/fixtures.py)と[API実装](../services/api/src/demo_api/main.py)で各候補の理由を返し、APIテストの期待値を更新する。
3. OpenAPIを再出力して`npm run generate:api`で[生成型](../packages/api-contract/src/generated.ts)を更新する。生成型を直接手書きしない。
4. [JSON契約](../packages/api-contract/src/index.ts)の`suggestionsSchema`へ理由のZodスキーマを追加する。生成型だけでは実行時検証が変わらないため、この変更も必要になる。
5. [TODO画面](../apps/web/src/features/todos/todo-page.tsx)の候補表示に理由を出す。採用はこれまでどおりtitleだけを作成APIへ渡す。
6. 型チェック・APIテスト・該当画面のテストで、候補の表示と採用を確認する。

Startの関数の戻り型はスキーマから画面へ伝わります。一方、PythonとTypeScriptは別言語なので、OpenAPI更新とZod変更は自動で一体化しません。Next.jsでも同じAPI契約の変更は必要です。Startへ替えるだけで境界の調整作業が消えるとは扱いません。

## チャットが不要な案件へ絞る

TODOとJSONの候補提案はチャットSDKへ依存させていません。削除するときは以下の単位で進めます。

1. `/chat` routeとナビゲーション、チャットのサーバー関数と専用UIを削除する。
2. `packages/chat-adapter`と`@demo/chat-adapter`、`@tanstack/ai`、`@tanstack/ai-react`への依存を削除する。AG-UIを他で使わなければ`@ag-ui/core`も外す。
3. FastAPIの`/chat/stream`、`chat.py`、チャット専用入力、`ag-ui-protocol`依存、対応するfixtureとテストを削除する。
4. OpenAPIとlockfileを更新し、ルート生成・型チェック・テスト・ビルドを実行する。

CRUDと候補提案にAG-UIを持ち込む必要はありません。ダミーAIの候補取得APIは残せます。

## 比較で判断できることと制約

画面からサーバーまでどのファイルを追うか、入力検証をどこへ置くか、追加項目がどこまで型として伝わるかを確認するデモです。初見の開発者による理解時間や小変更の所要時間はまだ計測していません。ファイル数や短い抜粋だけからStartの方が簡単と結論付けません。

ローカルの単一利用者向けです。実モデル接続、認証・利用者ごとの権限、RAG、添付、ツール呼び出し、履歴DB、永続ジョブ、再接続による途中再開は実装範囲に含めません。threadIdとrunIdはこのデモでの識別子であり、永続化・再開・冪等性の保証ではありません。

チャットSDKの採用版はpackage.jsonとlockfileへ固定しています。SDKの成熟度、ホスティングのストリーム対応、プロキシのバッファリング、切断検出の速さはフレームワークの呼び出し構文とは別に検証が必要です。StartとFastAPIは別プロセスなので、サーバー専用APIの接続設定、タイムアウト、API起動の確認も必要です。

公式仕様の確認日: **2026-10-17**。Next.jsの旧`updating-data`ページは確認時404で、現在の`mutating-data`へリンクしています。資料で参照する最新版と、実装で固定した版を混同しないでください。
