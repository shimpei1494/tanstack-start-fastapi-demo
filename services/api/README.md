# FastAPI demo service

TODOの保存と、外部モデルへ接続しないダミーAIを担当する。認証のないローカル・単一利用者向けのデモである。

Python 3.13、uvを用意し、リポジトリのComposeでPostgreSQLを起動してから実行する。

```sh
cd services/api
uv sync --frozen
export DATABASE_URL=postgresql+psycopg://demo:demo@localhost:5432/demo
uv run alembic upgrade head
uv run seed-demo
uv run uvicorn demo_api.main:app --host 127.0.0.1 --port 8000 --reload
```

`seed-demo`は固定IDのサンプル3件を、未投入の場合だけ追加する。APIの起動だけでは投入しない。`GET /health`はDB接続とTODOテーブルを確認し、未接続・未マイグレーションの場合は503を返す。

```sh
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run export-openapi
```

`openapi.json`は生成物をコミットし、`packages/api-contract`のTypeScript型の入力にする。スナップショットのテストで更新忘れを検出する。テストはSQLiteでCRUD・マイグレーション・再起動後の永続化を確認し、実HTTPサーバーでSSEの途中到着と切断時の停止も確認する。後者にはlocalhostポートのbind許可が必要である。実運用の保存先はPostgreSQLである。

## JSON API

| API | 入出力 |
| --- | --- |
| `GET /todos` | `Todo[]`。`completed=true`、`false`、省略で絞り込み |
| `POST /todos` | `{title}` → 201 `Todo` |
| `PATCH /todos/{todo_id}` | `{title?, completed?}` → `Todo` |
| `DELETE /todos/{todo_id}` | 204 |
| `POST /ai/suggestions` | `{goal, scenario?}` → `{suggestions: [{title}], model_version: "mock-v1"}` |

`Todo`はUUID文字列の`id`、`title`、`completed`、UTC ISO日時の`created_at`、`updated_at`を持つ。タイトルは前後の空白を除いて1〜200文字、目的は1〜1,000文字とする。空のPATCH、null、未知のキーを拒否する。存在しないTODOは404、入力不備は422を返す。候補の取得ではTODOを保存しない。

候補の`scenario`は`normal`（既定）、`slow`（1.25秒待つ）、`error`（HTTP 503）。固定規則のサンプルであり、目的文に応じた実推論の品質を示すものではない。

## チャット契約

`POST /chat/stream`はAG-UI Python SDK 1.0.0の`RunAgentInput`を継承した限定スキーマを受け取り、SDKのイベント型と`EventEncoder`で`text/event-stream`を返す。[共通契約](../../docs/plans/streaming-contract.md)も参照する。

```json
{
  "threadId": "thread-1",
  "runId": "run-1",
  "state": {},
  "messages": [{"id": "user-1", "role": "user", "content": "勉強会の準備を手伝って"}],
  "tools": [],
  "context": [],
  "forwardedProps": {"scenario": "normal"}
}
```

受け付けるメッセージは`user`と`assistant`のテキストだけで、最後は`user`とする。1〜40件、各本文1〜4,000文字、本文の合計20,000文字まで。各IDは1〜128文字で、メッセージIDは重複させない。`state`は空オブジェクト、`tools`と`context`は空配列、`forwardedProps`の許可キーは`scenario`だけである。ツール、添付、親の実行、再開には対応しない。

| scenario | 配信 |
| --- | --- |
| `normal` | 工程`retrieve` → `generate` → `validate`、6分割の本文、`RUN_FINISHED` |
| `slow` | 同じイベントを各処理0.65秒で返す。停止の確認用 |
| `error` | 本文2チャンクの後、`RUN_ERROR`、code=`MOCK_STREAM_ERROR` |
| `disconnect` | 本文2チャンクの後、終端イベントなしで接続を閉じる |
| `before-error` | 配信前にHTTP 503、code=`MOCK_UNAVAILABLE` |

`normal`等の処理遅延はサーバーのasync generatorで作る。ストリーム開始後の成功は`RUN_FINISHED`だけで判断し、`TEXT_MESSAGE_END`やHTTP 200、終端なしの切断を成功として補わない。エラーの本文は利用者向けの固定文であり、内部例外を返さない。

ブラウザからの中止で上流HTTPが閉じると、Starletteが配信タスクをキャンセルし、生成器の`finally`が実行される。終了時のログは次の形式であり、会話本文を記録しない。

```text
chat run ended run_id=run-1 outcome=cancelled content_chunks=1
```

`outcome`は`finished`、`error`、`disconnected`、`cancelled`のいずれかである。実HTTPのテストでは最初の本文受信後に切断し、チャンク数が1で停止したログと、その後もTODOを保存できることを確認する。実モデルを追加するときは、そのSDKの中止・リソース解放も同じ生成器へ接続する。

公式仕様: [AG-UI Python型](https://docs.ag-ui.com/sdk/python/core/types)、[サーバー実装](https://docs.ag-ui.com/quickstart/server)。対応は上記の部分集合であり、AG-UIの全機能の適合性を保証するものではない。
