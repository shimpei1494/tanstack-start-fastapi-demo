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

## AWS向け起動コード（未デプロイ・実機未検証）

`infra/runtime/Dockerfile.api`をリポジトリルートからビルドする想定である。通常のCompose用Dockerfileは従来どおりで、このAWS用イメージは起動時にマイグレーションしない。AWS用イメージだけが`aws` extra（boto3）とRDSの公開CA bundleを含む。

`DATABASE_URL`を設定すると従来どおり優先する。未設定で`DB_HOST`がある場合は`DB_HOST`・`DB_PORT`（既定5432）・`DB_NAME`・`DB_USER`・`DB_PASSWORD`からSQLAlchemy `URL.create`で接続先を作る。パスワード中の記号を手でURLエスケープする必要はない。`DB_SSLMODE=verify-full`・`DB_SSLROOTCERT=/opt/rds/global-bundle.pem`をAWSで指定する。`DB_POOL_SIZE=2`・`DB_MAX_OVERFLOW=1`は1プロセス当たりの上限候補で、RDS接続上限と同時タスク数を実機確認して調整する。SQLiteにはこれらのpool設定を適用しない。

| ECSのcommand | 用途・権限 |
| --- | --- |
| `python -m demo_api.aws_runtime init` | 一度に1タスクで実行。RDS管理者でアプリ用LOGINとCRUD権限を初期化。アプリSecretのGet/Putだけをtask roleへ付与 |
| `python -m demo_api.aws_runtime migrate` | RDS管理者でAlembicを1回実行。サービス更新前に終了コード0を確認 |
| `python -m demo_api.aws_runtime serve` | アプリ用DBログインでuvicornを1 worker起動。マイグレーションなし |
| `python -m demo_api.aws_runtime seed` | アプリ用ログインで合成データを明示的に投入 |

init/migrateだけにECS secretsで`RDS_ADMIN_CREDENTIALS`（`username`・`password`のJSON）を注入する。initには`APP_SECRET_ARN`・`AWS_REGION`も必要。TerraformがSecretのメタデータを作り、initが初回の値を作成する。再実行時は既存パスワードを再利用する。Secretのusernameが`DB_USER`と異なる場合や権限エラーは失敗とし、勝手に上書きしない。複数initのパスワード生成をDB advisory lockで直列化する。APIサービスへ管理者資格情報を渡さず、アプリSecretのpasswordだけを`DB_PASSWORD`へ注入する。Secret変更後は新しいサービスタスクへの置換が必要。

initが与えるのはDB接続・public schema使用・現在と今後の管理者所有テーブルのCRUD・sequence使用で、schema CREATEや管理者権限は与えない。既存roleに特権属性や他roleへの所属があれば失敗とし、自動的に特権を変更しない。RDS管理者はPostgreSQLの真のsuperuserではないため、role作成時の非特権defaultを使い、ALTERではLOGINとパスワードだけを変更する。Alembicの管理テーブル`alembic_version`はinitとmigration後にアプリ権限を取り消す。新規のRDS PostgreSQL 17を前提とし、既存DBのPUBLIC権限やあらゆる過去の権限付与を監査・除去する機能ではない。[PostgreSQL ALTER ROLEの権限制約](https://www.postgresql.org/docs/17/sql-alterrole.html)と[RDS管理者roleの仕様](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html)を参照。

障害時は資格情報やSQLをログへ出さないため詳細例外を抑止して非0終了する。IAM・環境変数・ネットワークとDB側ログを確認して切り分ける。

`GET /live`はDBへ接続せず応答する、OpenAPI公開対象外のlivenessである。`GET /health`は従来どおりDB readinessを確認する。起動成功だけでDB疎通成功と判断しない。

ローカルテストは接続設定・資格情報の記号・SQLite互換性・Secret再利用と権限SQL（mock）・liveness・通常API契約を確認する。AWS、RDS PostgreSQL、IAM、Secrets Managerへの実接続、CA bundle取得を含むAWS用イメージのビルドは未検証。RDS上のrole/default privileges、TLS hostname検証、Secret初回値作成、失敗時の復旧とマイグレーション順序をデプロイ前に検証し、構成も再検討する必要がある。

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
