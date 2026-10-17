# 案1 TanStack StartとFastAPI Backendの実装計画

TODO、ダミーAI候補提案、ストリーミングするチャットを持つアプリを新しいモノレポに作り、TanStack Startでサーバー処理を導入する手順と分かりやすさを示す。FastAPIの改善は目的にせず、比較に必要な小さな業務APIとして固定する。

背景と共通仕様は [全体計画](README.md) を参照する。既存テンプレートのコピーや改修を前提にせず、このリポジトリだけで起動とコードの理解ができる成果物を作る。

## 示したい体験

| 利用者や開発者の操作 | コードで見せること |
| --- | --- |
| TODO一覧を開く | loaderからサーバー関数を呼び、一覧データを画面へ渡す |
| TODOを追加し完了にする | 型付きのサーバー関数呼び出しと更新後の反映 |
| AIに目的文を送る | サーバー専用の接続設定を使って内部APIを呼ぶ |
| AI候補からTODOを追加する | 提案の取得とDBへの保存を別の操作として扱う |
| チャットを送り返答を途中から読む | サーバー関数によるストリーム中継とTanStack AI |
| チャットの生成を止める | 画面から上流の生成器までの中止要求 |
| 空の入力やAPIエラーを試す | サーバーでの検証と画面へのエラー表示 |
| Next.jsでの対応コードを読む | 実行境界、関数定義、呼び出し、状態管理の違い |

FastAPIの性能改善、レイヤー構造の刷新、ワーカー、永続ジョブ、分析履歴、認証基盤の追加は完了条件に含めない。TODOとダミーAIに必要な新規APIだけを実装する。

## 新規モノレポの構成

リポジトリ名はtanstack-start-fastapi-demoとする。既存リポジトリのexamples配下ではなく、独立したGitリポジトリとして作る。

```text
tanstack-start-fastapi-demo/
  apps/
    web/                    # 紹介の中心となるTanStack Start
      src/routes/
      src/features/todos/
      src/features/chat/
      src/server/functions/
      src/server/api-client/
      src/queries/
  services/
    api/                    # 最小限のFastAPIとダミーAI関数
      src/
      tests/
  packages/
    ui/                     # 共有できる表示部品
    api-contract/           # 共通のAPI型とサンプル
    chat-adapter/           # AG-UIの検証、中継、SDKとの型の調整
  docs/
    comparison.md           # 同じ操作に対応するコードと読み方
    snippets/               # Next.jsで書く場合の説明用コード
  compose.yml
  README.md
```

JavaScript側はworkspacesで管理し、Pythonはservices/api内で依存関係を管理する。Next.jsの比較用アプリや起動コマンドは作らず、後から説明用HTMLへ載せる対応コードをdocsへ残す。

周辺ライブラリは全体計画の方針を適用する。StartはVite、単体テストはVitest、UIはshadcn/uiとBase UI、フォームはTanStack Formを使う。OxlintとOxfmtを採用し、TypeScript 7系の型チェックはOxlintのtype-awareとtype-checkへまとめる方針とする。チャットはTanStack AIを初期導入し、RCであることを記録して初期検証後にバージョンを固定する。不要な案件ではチャット画面と依存を削除できる構成にする。

## 段階1 最小限の共通APIを作る

PostgreSQLにTODOを保存し、初期データを投入できるようにする。Pythonの実装は小さく保ち、必要な入力検証とエラー応答を持たせる。

| 操作 | API |
| --- | --- |
| 一覧と完了状態による絞り込み | GET /todos |
| TODO追加 | POST /todos |
| タイトルと完了状態の更新 | PATCH /todos/{id} |
| 削除 | DELETE /todos/{id} |
| AI候補の取得 | POST /ai/suggestions |
| チャットのストリーミング | POST /chat/stream |

AIはgoalを受け取り、suggestionsとmodel_versionを返すPythonのダミー関数とする。通常応答、短い遅延、失敗のfixtureを用意する。外部AIには接続しない。

APIには最小限の初期化手順とスモークテストを用意し、以後の説明では機能と仕様を固定する。Next.jsの対応コードでも、同じAPIと内部接続の条件を前提にする。

API型生成を入れる場合は、FastAPIのOpenAPIを保存し、openapi-typescriptで生成した型とopenapi-fetchの薄いクライアントを使う。型生成だけではHTTP応答の実行時検証は行わないため、必要な境界のZod検証と契約テストを別に用意する。

完了条件は、同じ入力で同じTODO操作とAI応答を確認できること、再読み込みでTODOが残ることである。

## 段階2 Startでサーバー関数を使う

1. 安定版のStartと互換性のあるRouter、Query、Node.js、TypeScript 7系を選び、依存関係を固定する。OpenAPI型生成のコンパイラAPI依存も確認する。
2. TODO取得、作成、更新、削除、AI候補取得をサーバー関数として定義する。
3. FastAPIクライアントをサーバー専用モジュールへ置き、関数のハンドラーから呼ぶ。
4. 入力スキーマを関数の境界へ置き、画面を経由しない呼び出しにも適用する。
5. サーバー専用の接続先や設定がブラウザのバンドルやレスポンスへ含まれないことを確認する。

この段階では、画面からどの関数を呼ぶとサーバーへ渡るかがコードを追って理解できる状態にする。ブラウザとStart間の型推論と、Python APIとの型契約は別の境界として説明する。

Oxlintの型チェックを使う際は、アプリと共有パッケージに意図的な型エラーを入れて検出範囲を確認する。ツール内部にTypeScript 6の互換APIが必要なら、その依存をコード生成用workspaceへ限定する。Startの型生成と本番ビルドは型チェックとは別に確認する。

Startのloaderはブラウザでも動くため、内部APIクライアントをloaderから直接呼ばず、Server Functionsを使う。[Server Functionsの公式説明](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)

## 段階3 TODOとAIの画面を完成させる

- 一覧、タイトル入力、完了切り替え、編集と削除を一画面にまとめる。
- すべて、未完了、完了のURLパラメーターを検証し、loaderの依存とQueryキーへ含める。
- loaderと画面で同じQuery定義を使い、取得データと状態管理を共有する。
- 変更操作はmutationで扱い、成功後に一覧を更新する。
- AI欄は目的文、提案ボタン、処理中表示、候補一覧、候補ごとの追加操作を持つ。
- 候補を採用するまではDBを変更せず、追加済みの候補は再度押せないようにする。

取得用のuseEffectを減らす効果はRouterとQuery、サーバーの機能を関数として利用する効果はStartとして、対応するコードを分けて記録する。ダイアログなどの画面固有stateまで排除しない。

SSR時のQueryClientはリクエストごとに分ける。サーバー関数を呼んだだけでは取得状態が自動管理されるわけではないため、Queryとmutationの役割をREADMEに示す。[Queryとの連携](https://tanstack.com/start/latest/docs/framework/react/guide/tanstack-query)

完了条件は、TODO操作とAI候補の採用が動き、入力不備とAPI失敗が画面に表示されることである。

## 段階4 チャットと疑似ストリーミングを追加する

チャットSDKはTanStack AIの@tanstack/ai-reactと@tanstack/aiを初期導入する。公式トップは現在RC表記であるため、最初にダミーチャンクから画面までを配信できる小さな動作確認を行い、配信形式と終了イベント、停止の伝播を確認してバージョンを固定する。モデルプロバイダー用のパッケージは初期には入れない。Pythonの配信は [共通契約案](streaming-contract.md) に揃える。

1. FastAPIのasync generatorとAG-UI Python SDKで、工程イベントと固定した返答を時間差で送る。ブラウザだけの文字送りにはしない。
2. StartのPOSTサーバー関数からFastAPIへ接続する。入力はサーバー側で実行時に検証する。
3. AG-UIの入力とイベントを検証し、必要なSDKとの型の調整を行い、toServerSentEventsResponseなどで配信する。独自イベントへの往復変換は増やさない。
4. /chatのuseChatへfetcherを渡し、サーバー関数を呼ぶ。メッセージ、送信中、受信中、エラー、停止、再生成と、工程イベントによる進捗表示を扱う。
5. ブラウザの停止要求をStartの上流fetchへ伝え、FastAPIの生成器が後続処理を止めることを確認する。

TODOとチャットの両方をサーバー関数で呼ぶ構成を優先する。Startのサーバー関数はPromiseを返すため、useChatのfetcherを使い、同期の生成器向けのstream()へそのまま渡さない。ブラウザのAbortSignalを関数呼び出しに渡すだけでPythonの処理まで停止するとは仮定せず、Start側のリクエスト中止と上流fetchを接続して確認する。[公式の接続方法](https://tanstack.com/ai/latest/docs/transports/server-functions)

採用版で配信や停止に支障がある場合は、StartのPOST /api/chatとfetchServerSentEventsへ接続方法を変更する。SDKやDS契約の全面変更を先に行わない。必要な動作を満たせない場合はAI SDKの再検討理由を記録する。

最初のチャンクが完了前に届くこと、途中エラー時に返答を完了扱いしないこと、停止後も通常のTODO操作ができることを確認する。UI用SDKの効果とStartの配信経路の効果を分けて記録する。初期の会話履歴はメモリ内とし、履歴DBや再接続による途中再開は追加しない。

## 段階5 Next.jsの対応コードと説明材料を整理する

Next.jsの比較用アプリは作らない。動いたStartのコードを軸に、同じAPI、データ、AI応答を扱う場合のNext.jsコード例を用意し、アプリ完成後に説明用HTMLへまとめる。

チャットの対応例では、Next.jsのRoute Handlerから同じFastAPIへ接続し、TanStack AIのuseChatとHTTP接続を使う形を示せる。SDKの送受信と状態管理をStartの独自性とは説明せず、関数呼び出しとルート定義、型、サーバー設定の扱いを比べる。AI SDKとTanStack AIの選定は別の論点に分ける。

Next.js側もServer Componentsによる取得やServer Actionsによる更新など、目的に合うサーバー機能を使う。取得のためにすべてをServer Actionsへ寄せる実装は比較の基準にしない。Queryを使う効果を比べる場面では、Next.js側にも同じQueryを使える条件を揃える。[Next.jsのサーバー処理と更新](https://nextjs.org/docs/app/getting-started/updating-data)

| 比較する項目 | 確認方法 |
| --- | --- |
| 実行場所の理解 | 初見の開発者がサーバー側の関数と設定を指せるか |
| 機能追加の手順 | AI候補の返却項目を一つ増やしたときの変更箇所 |
| 呼び出しの分かりやすさ | 画面からAPIまでの経路と型を追えるか |
| 取得と更新の作法 | 読み込み、入力エラー、更新後の反映に必要な概念 |
| 開発の負担 | 必要な調査、手書きコード、つまずいた点 |

Startの方が簡単という結論を先に固定しない。両者で同等に簡潔な部分と、チームがStartを理解しやすかった部分を具体例として残す。コード行数は補助指標とし、共通パッケージへ移しただけの行数削減を成果にしない。Next.js例は公式の現行仕様を確認し、概念例と型チェック等で確認した例を区別する。アプリ全体の動作、開発時間、性能を実測した比較とは説明しない。

## 段階6 起動と紹介の準備

ComposeでStart、FastAPI、DBを起動できるようにする。Next.jsのビルド、起動、依存インストールは不要にする。

READMEには次の入口を置く。

1. 最短の起動と初期データの投入。
2. TODOを追加してAI候補を採用する操作手順。
3. チャットの途中表示、停止、途中エラーを試す操作手順。
4. サーバー関数、loader、Query、内部APIクライアントを読む順番。
5. Next.jsの対応する説明用コードと、後から作るHTMLへの案内。
6. 初見の開発者が小さな機能追加を試す手順。

最低限、型チェック、Lint、本番ビルド、TODOとAIの主要フロー、入力エラー、サーバー専用情報の非公開を確認する。紹介資料には実際に動いた画面とコードを使う。

ストリームについては、チャンクの途中到着、UTF-8やイベントの分割、正常終了、途中切断、キャンセルの伝播を確認する。配信経路でレスポンス全体をバッファしていないことも確認する。

## 完成条件と追加検証

TODOと候補提案までの基本版を先に完成させる。アプリの紹介版は、新規モノレポを取得した人が参照用リポジトリなしで起動でき、TODOとストリーミングチャットを体験できたら完成とする。そのコードと画面を基に、Next.jsの対応例を含む説明用HTMLを次の成果物として作る。

本格的な認証、AWS構築、FastAPI側の設計改善、長時間処理、永続ジョブは、この案の初期実装へ追加しない。実際の案件へ適用する際は別の要件として判断する。

## 実装状況（2026-10-17）

| 段階 | 状況 | 成果物・確認 |
| --- | --- | --- |
| 1 共通API | 完了 | PostgreSQL、Alembic、seed、CRUD、候補、Python SDKのAG-UI配信。pytestと実DBで検証 |
| 2 サーバー関数 | 完了 | TODO・候補・チャットをServer Functionsで呼び、入力と応答を検証。型エラー検出範囲とクライアントへの設定非混入を確認 |
| 3 TODOと候補の画面 | 完了 | URL絞り込み、Query連携、Form、編集・完了・削除、候補採用と失敗表示。SSR初期化前は入力を無効化 |
| 4 チャット | 完了 | fetcher方式、工程・途中表示・停止・再生成・3種の失敗。実ブラウザからPythonの生成停止まで確認 |
| 5 比較説明 | 完了 | docs/comparison.mdとNext.js概念例。Next.jsアプリは作らず、型チェック・実行済み例とは扱わない |
| 6 起動と紹介 | 完了 | Compose、README、docs/guide.html、検証手順。詳しい証跡はdocs/implementation-notes.md |

採用版での確認から、次の調整を行った。

- Start 1.169.3の入力検証は`.validator`を使う。公式最新版の`.inputValidator`記法をそのまま適用しない。
- TypeScript 7.0.2での型チェックはOxlintへ統合した。openapi-typescript 7.13.0のpeerはTypeScript 5系で、旧コンパイラAPIが必要だったため、型生成だけを独立した`tooling/api-codegen`（TypeScript 5.9.3）へ隔離した。
- UIはBase UI + cva + Tailwindの共有Buttonをローカル実装した。shadcnのCLI registry生成は行っていない。
- 配信はServer Functions方式で必要な挙動を満たし、Server Routeへの切り替えは不要だった。
- 終端イベントだけはEOFまで保留し、重複終端を検出する。本文と工程は逐次配信する。

初見の第三者による小変更の所要時間、Next.jsとの性能・工数比較、実モデル・公開運用の確認は未実施であり、完成の範囲とは区別する。
