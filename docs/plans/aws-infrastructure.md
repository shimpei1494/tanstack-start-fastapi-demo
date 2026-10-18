# AWSデモ環境とTerraformの構成計画

更新日: 2026-10-18。**計画段階**。Terraformコード、AWSリソース、デプロイ用CIはまだ作成していない。

現行アプリの `7cb9f85` までをmainへpush済み。この計画は、その後のローカル変更として管理する。

## 方針と前提

利用者の希望は「小規模デモ向けに簡潔・低コスト」「自分・関係者のIPに限定」。既存の2つのDockerイメージを利用し、**ECS Fargateの1サービス・1タスク内にWebとAPIを配置し、PostgreSQLはRDSへ分離する**。

想定リージョンは東京 `ap-northeast-1`。リージョン、AWSアカウント、接続を許可するCIDR、ドメインと月額予算は実装前に確定する。可用性より構築の少なさを優先するデモ環境とし、本番案件への転用時はサービス分離・配置・認証を再判断する。

## 構成

```mermaid
flowchart TD
    User[許可IPのブラウザ] -->|HTTPS| ALB[Public ALB / 2 AZ]
    ALB -->|3000 / private IP| Web
    subgraph Task[ECS Fargate / 1 task]
        Web[TanStack Start / 3000] -->|localhost:8000| API[FastAPI / 8000]
    end
    API -->|TLS / 5432| DB[(Private RDS PostgreSQL)]
    ECR[ECR / WebとAPIの2 repositories] -. イメージ取得 .-> Task
    Secret[Secrets Manager] -. APIのDB認証情報 .-> Task
    Task -. stdout / stderr .-> Logs[CloudWatch Logs]
```

| 部品 | 初期案 |
| --- | --- |
| Web/API | Fargate、Linux、1タスク、2コンテナを同時に更新 |
| タスクのサイズ | まず0.5 vCPU / 1 GiBを候補とし、NodeとPythonの同時利用を実測して増量 |
| アーキテクチャ | まずlinux/amd64に統一。Macでのビルド時もplatformを明示。ARM64は別途互換確認後 |
| 外部入口 | ALBを1台。外部から到達できるアプリはStartのみ |
| DB | RDS PostgreSQL 17系、db.t4g.micro候補、Single-AZ、gp3 20 GiBから検証 |
| ネットワーク | 1 VPC、Public subnet 2つ、DB用private subnet 2つ、Internet Gateway |
| 外向き通信 | FargateをPublic subnetに配置してPublic IPv4を付与。NAT Gatewayは作らない |
| 証明書 | ドメインを利用する場合は同リージョンのACM証明書。DNSは既存zoneを優先 |
| 保存・保護 | RDS暗号化・自動バックアップ7日、削除保護と最終snapshot |
| ログ | Web/APIを分けたCloudWatch Logs、保持14日を初期値候補とする |

ALBやDB subnet groupを2 AZへ配置しても、タスク1つとSingle-AZ DBの構成は高可用性にはならない。デプロイ中は新旧タスクの2つが一時的に動く余裕を持たせる。

同じawsvpcタスクのコンテナはlocalhostで通信できる。AWSも、同じライフサイクルで動かすコンテナを同一タスクへ配置する選択を説明している。[タスクのネットワーク](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking-awsvpc.html)、[コンテナの配置判断](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/container-considerations.html)

## 通信とIP制限

| Security Group | 許可する受信 |
| --- | --- |
| ALB | 許可CIDRから443。80を使う場合も同じCIDRだけに限定 |
| Fargate task | ALBのSGから3000だけ。8000への外部ingressは作らない |
| RDS | Fargate taskおよびmigration taskのSGから5432だけ |

- ALBの接続先はタスクのprivate IP。target groupのtarget_typeは`ip`を使う。
- taskのPublic IPv4はECR、CloudWatch、Secrets Manager等への外向き通信に使う。Public IPがあることと、外部からアプリへ直接接続できることを分けて設定する。
- DB subnetにはInternet Gatewayへのデフォルト経路を置かず、RDSは`publicly_accessible=false`とする。
- `allowed_cidrs`は必須かつ空を拒否する。初期設定で`0.0.0.0/0`や`::/0`へ開かない。変動する自宅IPはTerraform変数の更新で対応する。
- ドメイン未確定なら、IP制限したALB DNS名のHTTPで一時的な接続確認はできる。通常の利用URLはHTTPSとし、ドメインまたは既存証明書を実装前に確定する。

このPublic subnet案は今回の費用・簡潔さを優先した選択。private taskへ変更する場合は、NATまたはECR・S3・Logs・Secrets Manager等の到達経路を別途設計し、費用も比較する。[Fargateの外向き通信](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/networking-outbound.html)、[ALBのターゲット](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html)、[RDSのVPC配置](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)

## ECSの単位と更新

- `web`と`api`は既存Dockerfileから別々にbuildしてECRへ保存し、SHAタグとdigestで固定する。`latest`をデプロイの識別子にしない。
- Webへ `API_BASE_URL=http://127.0.0.1:8000` を渡す。Composeの`http://api:8000`をそのまま使わない。
- WebとAPIはともにessentialとし、APIの起動確認後にWebを起動する。リソース量と起動猶予は実測して確定する。
- ECS内の生存確認とDB readinessを分ける。Web用の軽い`/_health`、API用のDB非依存の`/live`を追加候補とし、既存`/health`はDBを含む疎通確認に残す。
- 通常の更新はrolling deployment。minimum healthy percent 100 / maximum percent 200、deployment circuit breakerとrollbackを有効にする。
- CloudWatchの最小限の監視はタスク停止、ALBのhealthy target・5xx、RDSストレージ等。高度な分析やContainer Insightsは費用を見て追加する。

Web/APIを一緒に更新・スケールする制約を受け入れることで、内部ALB、Service Connect、Cloud Mapの初期導入を省く。独立したチーム・リリース・負荷特性が必要になったら2サービスへ分離する。API_BASE_URLという境界はそのまま利用できる。[サービスのrolling更新とrollback](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/update-service-parameters.html)

## DB認証情報と接続

Terraformで平文のDATABASE_URLやパスワードを組み立てず、タスク定義には接続先等とsecret ARNを持たせる。

- RDSの管理者パスワードはRDS管理のSecrets Manager secretを使う。これはDB初期化・migration用とする。
- 通常のAPI用に専用のDBユーザーとsecretを作る。初期化用の単発タスクが、管理者secretを利用してユーザーと必要な権限を準備する。
- API用secretの**メタデータ**はTerraformで管理し、値は初期化処理で生成・保存する。Terraformで`secret_string`を読み戻さず、値をstate、tfvars、CIログへ渡さない。初回のsecret作成からDBユーザー作成までの再実行手順も実装する。
- APIに `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER` と、secret参照による `DB_PASSWORD` を渡す。SQLAlchemy URL.createを使い、記号を含むパスワードも安全に扱う。
- RDS CA bundleと`sslmode=verify-full`等のTLS設定をAPI・migrationへ適用する。ローカルのDATABASE_URL方式は維持する。
- タスク起動時のsecret注入はローテーション後に自動更新されない。API用secretは初期は手動更新と新タスクへの切り替えをセットにする。自動ローテーションを足す場合は再配置またはアプリ側の資格情報再取得を同時に設計する。

execution role、通常task role、DB初期化/migration用roleを分け、管理者secretへの権限を通常のWeb/APIへ渡さない。RDSの管理者secretの自動ローテーションは、毎回新しい資格情報を取得する単発migration taskで扱う。[RDSのsecret管理](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html)、[ECSへのsecret注入](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)、[RDS PostgreSQLのTLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)

## migrationと初回起動

現在のAPI Dockerfileは起動時にAlembicを実行する。ECSでは新旧タスクが並行するため、AWS用起動コマンドはUvicornのみにし、migrationはAPIイメージを使う単発ECS taskで先に実行する。Composeの既存起動手順は維持できる。

初回の順序:

1. state管理用S3とECRをbootstrapする。
2. 現行コミットのWeb/APIイメージをbuild・pushし、digestを取得する。
3. VPC、RDS、IAM、ALB、task definition等をTerraformで作成する。サービスのdesired_countは0にする。
4. DB初期化taskでAPIユーザーとsecretを準備し、migration taskで `alembic upgrade head` を実行する。両方の終了コード0を確認する。
5. 必要なら `seed-demo` を明示実行する。毎回のデプロイでseedしない。
6. Terraformでdesired_countを1にし、ALB経由で主要フローを確認する。

通常リリースの順序:

1. Web/APIを同一Git SHAでbuildし、テスト済みdigestを固定する。
2. **稼働中サービスのimage変数は旧版のまま**、migration用imageだけ新版へ更新してTerraformをapplyする。
3. 単発migration taskを実行し、成功したらWeb/APIのimage変数を新版へ更新して再度applyする。
4. steady stateと疎通を確認する。CIを導入したら環境ごとのconcurrencyで実行を直列化する。

Terraformがサービスのtask definitionを管理し、CIが別途update-serviceして所有権を二重化する構成を避ける。DB変更は新旧アプリと互換な追加変更を優先し、アプリのrollbackがDBを自動で元に戻すとは扱わない。[ECSの単発タスク](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/standalone-tasks.html)

## SSEとSSRを維持する設定

ALBからStartへはチャットのSSEとレポートのSSRをそのまま通す。初期はCloudFront、API Gateway、独自リバースプロキシを追加しない。

| 設定 | 初期候補と確認事項 |
| --- | --- |
| ALB idle timeout | 120秒。無通信のtimeoutであり、アプリの生成上限を伸ばす設定ではない |
| アプリの上限 | 現行のチャット全体60秒・無応答30秒を維持して検証 |
| target deregistration delay | 90秒を候補にし、更新中のstream終了と新規要求の振り分けを確認 |
| container stopTimeout | 最大120秒の範囲で設定し、SIGTERM時に正常終了できるか検証 |
| Node HTTP設定 | backend keep-alive/idle設定とALBの整合を採用版のNitroで確認 |

`X-Accel-Buffering: no`ヘッダーだけでAWS上の動作確認済みとはしない。実URLで、最初のチャンクが完了前に到着すること、ブラウザの停止がPythonへ届くこと、レポートの見出しが集計結果より先に届くことを確認する。[ALBの接続属性](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html)、[Fargateの依存・停止時間](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)

## Terraformの配置案

次の構成を**実装時に作る**。今は.tfファイルを追加しない。

```text
infra/terraform/
  bootstrap/                  # state用S3、ECR、必要になった時点のOIDC準備
  environments/demo/
    backend.tf                # bootstrapしたS3を指定
    versions.tf               # 検証したTerraform/providerを固定
    main.tf                   # 各moduleの組み立て
    variables.tf
    outputs.tf
    demo.tfvars.example       # 値は例示。秘密情報を含めない
  modules/
    network/                  # VPC、subnet、route、SG
    database/                 # RDS、parameter/subnet group、secretメタデータ
    application/              # IAM、ALB、ECS、通常/初期化/migration task、Logs
```

- bootstrapとdemoでstateを分ける。state用S3は暗号化、public access block、versioningを有効化する。
- S3 backendの`use_lockfile=true`を採用する。新規構成でDynamoDB lock tableは追加しない。
- state bucketは環境のdestroyと分けて保持する。権限を限定し、state自体も秘密情報を含み得るものとして扱う。
- image build/push、migration実行、疎通確認をTerraformのlocal-execへ詰め込まず、手順またはdeploy scriptで順に実行する。
- 主な入力はregion、project/environment、allowed_cidrs、domain/certificate、image digests、migration image digest、desired_count、CPU/memory、DBサイズ、log retention。
- 出力はURL、ECR URI、cluster/service名、migration task definition、DB endpoint等。secretの値は出力しない。
- `.terraform.lock.hcl`はcommitし、state、実値tfvars、planファイルはGitへ入れない。Terraform/providerの版は実装時に確認して固定する。

S3 lockingとversioningはHashiCorp公式の現行仕様を参照する。[S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3)

## 費用と停止

「コンテナを1タスクにまとめる」「NATを置かない」「Single-AZ DB」「task 1つ」が今回の簡素化。ALBやRDSの固定費は残るため、従量でゼロに近づく構成とは扱わない。

| 費用項目 | 見積もりに含めるもの |
| --- | --- |
| Fargate | taskのCPU・メモリと稼働時間。デプロイ中は一時的に2つ |
| ALB | 稼働時間、LCU、利用するPublic IPv4 |
| RDS | インスタンス、ストレージ、必要なbackup/snapshot容量 |
| ネットワーク | taskのPublic IPv4、通信量、AZ間転送等 |
| 周辺 | ECR、Logs、Secrets Manager、S3 state、必要ならDNS |

実装前に東京・730時間/月・task 1つ・DB 1台でPricing Calculatorへ入力し、USD/月の内訳と予算を確認する。現時点ではリージョン別の確定見積もりは未作成で、無料枠や為替換算による安さを前提にしない。[Fargate料金](https://aws.amazon.com/fargate/pricing/)、[ALB料金](https://aws.amazon.com/elasticloadbalancing/pricing/)、[RDS料金](https://aws.amazon.com/rds/postgresql/pricing/)、[VPC料金](https://aws.amazon.com/vpc/pricing/)、[Pricing Calculator](https://calculator.aws/)

desired_countを0にしてもALB・DB・保存データ等の課金は残る。長期停止はDBの保管方針とsnapshotを決めて環境を削除する。RDSの一時停止も無期限ではなく、停止可能期間と自動再起動を確認する。[RDSの一時停止](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html)

## 他の配置案との比較

| 案 | 適する場合 | 今回の判断 |
| --- | --- | --- |
| Fargate 1 service / 2 containers + RDS | 小さな一体型アプリを少ない部品で配置 | 第一候補 |
| Fargate 2 services + RDS | Web/APIを独立更新・スケール | 必要になった時点でService Connect等を検討 |
| ECS Express Mode | 自動HTTPSや周辺設定の自動化を優先 | Terraform対応もある候補。今回は入口のIP制限・小さな固定構成・所有するリソースの明示を優先 |
| EC2 + Compose | 常時費用を別途比較し、OS運用も引き受ける | 選択肢として残すが、今回はサーバー管理を減らすFargateを優先 |

Express Modeを「Terraform未対応」や「同一タスクを使えない」という理由で除外しない。採用する場合はカスタムtask definitionとIP制限の管理方法を検証し、通常ECSとの二重管理を避ける。[Express Mode](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html)、[カスタムtask definitionの指定](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-getting-started.html)

## 実装の段階と完了条件

1. アカウント・リージョン・許可CIDR・HTTPS方式・予算を確定する。
2. DB接続のsecret/TLS対応、health確認、migrationの分離を小さなアプリ変更として実装する。
3. Terraformのbootstrapとdemoを作り、fmt・validate・planを確認する。
4. イメージをECRへ保存し、初期化・migration・サービス起動を行う。
5. 許可IPからTODO CRUD・再起動後の保持・候補・レポートpending・チャットを確認し、許可外からは入口に到達できないことを確認する。
6. 更新・rollback・secret更新時の新タスク起動・削除とsnapshotを試し、READMEへ記録する。
7. 手動手順が固まった後、必要ならGitHub Actionsの手動実行とOIDCを追加する。AWSの長期アクセスキーをGitHubへ保存しない。[GitHub OIDC](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)

AWSへのapplyと公開は次の実装段階の作業。この計画だけではAWS上の動作、料金、RDSバージョン・インスタンスタイプの選択可能性を検証済みとはしない。
