# AWSデモ環境とTerraformの構成計画

更新日: 2026-10-18。**Terraformコードの草案を作成済み・AWS未検証**。[コードと実行手順](../../infra/README.md)を追加した。AWSへのplan・apply・デプロイ・destroy、AWS用イメージのbuildはまだ実施していない。実環境での検証と、その結果に応じた構成の再検討が必要。デプロイ用CIも未作成。

現行アプリの `7cb9f85` までをmainへpush済み。この計画は、その後のローカル変更として管理する。

## 方針と前提

利用者の希望は「小規模デモ向けに簡潔・低コスト」「自分・関係者のIPに限定」。追加条件は「作成して挙動確認後、30分以内を目標にdestroyする一時環境」。常設時の月額最小化より、一般的なネットワーク分離と削除の再現性を優先する。

**Public ALB → private subnetのWeb service → private subnetのAPI service → isolated subnetのRDS**を採用案とする。同じECSクラスター内にWeb/APIの2サービスを置き、タスク定義・台数・リリースを分離する。内部通信にはECS Service Connectを使い、ECSにPublic IPは付けない。

想定リージョンは東京 `ap-northeast-1`。リージョン、AWSアカウント、接続を許可するCIDR、HTTPS方式と1回の検証予算は実装前に確定する。ネットワークは2 AZへ分離するが、NAT 1台・Single-AZ DBから始めるため、構成全体の高可用性を保証する計画ではない。

30分は検証の短い利用期間の目標とする。**apply開始からAWSの削除完了までを30分以内に保証することはできない**。特にRDSの削除時間はAWS側の内部処理によって変わる。稼働時間・destroy開始時刻・削除完了時刻を別々に記録する。

## 構成

```mermaid
flowchart TD
    User[許可IPのブラウザ] -->|HTTPS| ALB
    subgraph Public[Public subnets / 2 AZ]
        ALB[Public ALB]
        NAT[NAT Gateway / まず1台]
    end
    subgraph App[Private app subnets / 2 AZ]
        subgraph Cluster[ECS cluster / Fargate]
            Web[Web service / TanStack Start / 1〜2 tasks]
            API[API service / FastAPI / 1〜4 tasks]
            Web -->|Service Connect / api:8000| API
        end
    end
    subgraph Data[Isolated DB subnets / 2 AZ]
        DB[(RDS PostgreSQL / Single-AZ)]
    end
    ALB -->|3000| Web
    API -->|TLS / 5432| DB
    Web -->|外向きHTTPS| NAT
    API -->|外向きHTTPS| NAT
    NAT --> Services[ECR / Logs / Secrets Manager等]
    Web -->|イメージレイヤー取得| S3[S3 Gateway Endpoint]
    API -->|イメージレイヤー取得| S3
```

| 部品 | 初期案 |
| --- | --- |
| Web/API | 同一クラスターの独立した2サービス。各タスクはアプリ1コンテナとService Connectの管理proxyを持つ |
| 初期台数 | Web 1 / API 1から開始。AZ分散の確認時は各2。スケール上限候補はWeb 2 / API 4 |
| タスクのサイズ | Web/APIそれぞれ0.5 vCPU / 1 GiBを候補とし、proxyの使用分も含めて実測する |
| 内部通信 | Service Connect。Webがclient、APIがclient-server。環境専用Cloud Map namespaceを使用 |
| アーキテクチャ | まずlinux/amd64に統一。Macでのビルド時もplatformを明示。ARM64は別途互換確認後 |
| 外部入口 | ALBを1台。外部から到達できるアプリはStartのみ |
| DB | RDS PostgreSQL 17系、db.t4g.micro候補、Single-AZ、gp3 20 GiBから検証 |
| ネットワーク | 1 VPC、2 AZ × Public・private app・isolated DBの3層、計6 subnet |
| 外向き通信 | app subnetからNAT Gateway 1台経由。Fargateはassign_public_ip=false。S3 Gateway Endpointも利用 |
| 証明書 | ドメインを利用する場合は同リージョンのACM証明書。DNSは既存zoneを優先 |
| 保存・保護 | 一時検証専用: RDS暗号化、backup retention 0、削除保護なし、最終snapshotを作らない。合成データだけを投入 |
| ログ | Web/APIを分けたCloudWatch Logs、保持14日を初期値候補とする |

Web/APIが各1タスクでは、それぞれ単一タスクの停止で影響を受ける。各2タスクを2 AZへ分散しても、NAT 1台とSingle-AZ DBは単一障害点として残る。AZ障害への耐性を確認する段階では、AZごとのNATとDBのMulti-AZも別途有効にする。各サービスのmaximum percent 200を前提に、初期台数では更新中最大4タスク、上限台数では合計最大12タスクのリソース・IP・接続数を見込む。

今回のNATは一般的なzonal NAT 1台を候補とし、両app subnetの外向き経路に使う。別AZからNATを利用する転送費用を見積もりへ含める。S3 Gateway Endpointをapp route tableへ関連付け、ECRのS3レイヤー取得をNAT経由から外す。ECR API/DKR・Logs・Secrets Manager等は初期はNAT経由とする。外向き経路も閉じたい検証では、必要なInterface Endpoint一式への切り替えを検討する。[S3 Gateway Endpoint](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html)、[ECSとVPC Endpoint](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/vpc-endpoints.html)

サービス分離により、WebとAPIは異なるawsvpcタスクのprivate IPで通信する。APIのlocalhostをWebから指定する方式は使わない。[タスクのネットワーク](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking-awsvpc.html)

## 通信とIP制限

| Security Group | 許可する受信 |
| --- | --- |
| ALB | 許可CIDRから443。80を使う場合も同じCIDRだけに限定 |
| Web task | ALBのSGから3000だけ |
| API task | Web taskのSGから8000だけ。Service Connect proxyの受信ポートと一致させる |
| 初期化/migration task | 受信ルールなし |
| RDS | API taskおよび初期化/migration taskのSGから5432だけ。Webからの接続は許可しない |

- ALBの接続先はタスクのprivate IP。target groupのtarget_typeは`ip`を使う。
- FargateにはPublic IPを付けない。app subnetはデフォルト経路をNATへ向け、Internet Gatewayへ直接向けない。初期化・migration用の単発タスクも同じprivate app subnetに配置する。
- Public subnetだけがInternet Gatewayへのデフォルト経路を持つ。NATのElastic IPとALBのPublic IPv4を費用へ含める。
- DB subnetにはInternet Gatewayへのデフォルト経路を置かず、RDSは`publicly_accessible=false`とする。
- `allowed_cidrs`は必須かつ空を拒否する。初期設定で`0.0.0.0/0`や`::/0`へ開かない。変動する自宅IPはTerraform変数の更新で対応する。
- ドメイン未確定なら、IP制限したALB DNS名のHTTPで一時的な接続確認はできる。通常の利用URLはHTTPSとし、ドメインまたは既存証明書を実装前に確定する。

旧案の「Public subnetのtask＋NATなし」は常設時の費用節約案として残す。今回の一時環境はprivate taskを既定とし、AWSサービスへの到達経路も確認対象にする。[Fargateの外向き通信](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/networking-outbound.html)、[ALBのターゲット](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html)、[RDSのVPC配置](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)

## ECSの単位・内部通信・更新

- `web`と`api`を別のECS service / task definition / IAM role / Security Group / scaling targetにする。クラスターは1つでよく、Webを増やす操作でAPIまで増やさない。
- 既存Dockerfileから別々にbuildしてECRへ保存し、SHAタグとdigestで固定する。`latest`をデプロイの識別子にしない。
- 環境専用のCloud Map HTTP namespaceをTerraformで作り、APIをService Connectのclient-server、Webをclientとして登録する。APIのport mappingに名前と`appProtocol=http`を設定し、aliasを`api:8000`へ固定する。
- Webのサーバー側へ `API_BASE_URL=http://api:8000` を渡す。同じ文字列でもComposeのDNSとは別の仕組みである。ブラウザはALBのWebだけに接続し、API URLを公開しない。内部ALBは追加しない。
- Service Connectは各タスクへ管理proxyを追加する。AWS推奨の追加256 CPU units・64 MiB以上を考慮し、アプリへタスク全量を割り当てない。初期サイズで足りるか計測して確定する。
- APIのendpointを先に作り、稼働確認後にWebを起動する。通常のAPI増減は接続先aliasを変えずに行う。新しいendpointを追加・変更した場合は既存Web taskの再配置も必要になる。
- ECS内の生存確認とDB readinessを分ける。コード草案ではWebの既存`/`のリダイレクト（200〜399）を生存確認に利用し、APIにDB非依存の`/live`を追加した。既存`/health`はDBを含む疎通確認に残す。APIにはALBがないためcontainer health checkを設定する。
- 更新はサービスごとのrolling deployment。minimum healthy percent 100 / maximum percent 200、deployment circuit breakerとrollbackを有効にする。Web/API間をコンテナの`dependsOn`では制御しない。
- APIはリクエスト間でプロセス内の会話状態を共有しない構成を維持する。TODOはRDSに保存し、現在のチャットは必要な履歴をリクエストで渡すためsticky sessionは前提にしない。将来の永続履歴・共有キャッシュは別途設計する。
- Web/API/proxyのログを区別する。コード草案にはLogsとAuto Scaling用CPUアラームがあるが、タスク停止、ALB healthy target・5xx、APIエラー・応答時間、RDS接続数・ストレージの運用アラーム・通知先は未実装。Container Insights等も追加費用を見て選ぶ。

Service ConnectはAPI側の増減後、新しい接続を複数のタスクへ振り分ける。接続済みのSSEは別タスクへ移動しない。proxyの再接続・再試行もあるため、障害試験では書き込みの重複とstream開始後の再送が起きないか確認し、アプリに安易なPOSTの再試行を追加しない。[Service Connectの構成と制約](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-connect-concepts-deploy.html)、[設定の概要](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-connect-concepts.html)

## 独立したスケール

| サービス | 台数の初期候補 | 自動スケールの初期候補 |
| --- | --- | --- |
| Web | min 1 / max 2 | サービス平均CPU 60%を目安にtarget tracking。ALBの要求数/targetは実測後の代替候補 |
| API | min 1 / max 4 | サービス平均CPU 60%を目安に独立したtarget tracking。外部ALBの要求数をAPIの指標に流用しない |

数値は検証用の仮値。scale-out cooldown 60秒 / scale-in 300秒を候補とし、起動時間・SSE継続時間に合わせて調整する。Fargateの使用上限、subnetのIP数、DB接続上限も先に確認する。30分の検証では、まずAPIだけ1→3→1へ台数を変更し、Webの台数が変わらずTODO・チャット・レポートを利用できることを確認する。自動スケール中に試す場合はAPIのmin/maxを一時的に同じ値へ変更し、終了後に戻す。

Pythonの`asyncio.sleep`やSSEの接続待ちではCPUはほぼ増えないため、現在のslowシナリオだけでCPUによる自動増加を期待しない。CPU負荷試験は上限を決めた別の検証とする。実モデル等のI/O待ちが主要な負荷になった場合は、同時処理数などのアプリ指標を追加し、1タスク当たりの処理量に応じたポリシーを改めて設計する。[ECSのtarget tracking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-targettracking.html)

DB接続poolはAPIのプロセスごとに発生する。`API最大台数 × 更新時の増加率 × worker数 × (pool_size + max_overflow)`にmigrationと管理用の余裕を足し、RDSの接続上限へ収める。小さいRDSではSQLAlchemyの既定値をそのまま採用せず、pool設定を明示して上限台数を決める。APIを増やしてもDBは自動では増えない。

Terraformはtask definition・image・scaling policyを管理し、稼働中のdesired_countはApplication Auto Scalingへ任せる。`ignore_changes = [desired_count]`を使い、通常のapplyで台数を初期値へ戻さない。初回はサービス自体をまだ作らずtask definitionまで準備し、migration成功後にAPI、次にWebを初期台数1で作成する。この順序でdesired_count=0からの更新とignore_changesの衝突を避ける。

## DB認証情報と接続

Terraformで平文のDATABASE_URLやパスワードを組み立てず、タスク定義には接続先等とsecret ARNを持たせる。

- RDSの管理者パスワードはRDS管理のSecrets Manager secretを使う。これはDB初期化・migration用とする。
- 通常のAPI用に専用のDBユーザーとsecretを作る。初期化用の単発タスクが、管理者secretを利用してユーザーと必要な権限を準備する。
- API用secretの**メタデータ**はTerraformで管理し、値は初期化処理で生成・保存する。Terraformで`secret_string`を読み戻さず、値をstate、tfvars、CIログへ渡さない。初回のsecret作成からDBユーザー作成までの再実行手順も実装する。
- APIに `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER` と、secret参照による `DB_PASSWORD` を渡す。SQLAlchemy URL.createを使い、記号を含むパスワードも安全に扱う。
- RDS CA bundleと`sslmode=verify-full`等のTLS設定をAPI・migrationへ適用する。ローカルのDATABASE_URL方式は維持する。
- タスク起動時のsecret注入はローテーション後に自動更新されない。API用secretは初期は手動更新と新タスクへの切り替えをセットにする。自動ローテーションを足す場合は再配置またはアプリ側の資格情報再取得を同時に設計する。

Web/APIそれぞれのexecution role・通常task roleと、DB初期化/migration用roleを分ける。API用DB secretはAPIのexecution roleだけが注入できるようにし、WebにDB資格情報を渡さない。管理者secretへの権限は通常のWeb/APIへ渡さない。RDSの管理者secretの自動ローテーションは、毎回新しい資格情報を取得する単発migration taskで扱う。[RDSのsecret管理](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html)、[ECSへのsecret注入](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)、[RDS PostgreSQLのTLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)

## migrationと初回起動

現在のAPI Dockerfileは起動時にAlembicを実行する。ECSでは新旧タスクが並行するため、AWS用起動コマンドはUvicornのみにし、migrationはAPIイメージを使う単発ECS taskで先に実行する。Composeの既存起動手順は維持できる。

初回の順序:

1. state管理用S3とECRをbootstrapする。
2. 現行コミットのWeb/APIイメージをbuild・pushし、digestを取得する。
3. VPC、RDS、IAM、ALB、Cloud Map namespace、task definition等をTerraformで作成する。Web/API serviceは作成フラグを無効にして、まだ起動しない。
4. DB初期化taskでAPIユーザーとsecretを準備し、migration taskで `alembic upgrade head` を実行する。両方の終了コード0を確認する。
5. 必要なら `seed-demo` を明示実行する。毎回のデプロイでseedしない。
6. API serviceを初期台数1で作り、healthyとService Connect endpointの準備を確認する。その後Web serviceを初期台数1で作り、ALB経由で確認する。Terraform上もWebからAPI serviceへの依存を明示する。
7. 各サービスに独立したAuto Scaling target/policyを設定する。AZ分散の確認時はminを各2へ変更する。初期化/migration taskはRDSへ直接接続し、Service Connectには参加しない。

通常リリースの順序:

1. 変更対象のWeb/APIをbuildし、テスト済みdigestを固定する。各サービスの稼働digestを記録し、APIだけの変更でWebの更新を必須にしない。
2. DB変更がある場合は、**稼働中サービスのimage変数は旧版のまま**、migration用imageだけ新版へ更新してTerraformをapplyする。
3. DB変更がある場合は単発migration taskを実行し、成功後にAPIのimage変数を新版へ更新してapplyする。APIのsteady stateを確認し、必要ならWebを別のapplyで更新する。Webのみの変更では不要なmigrationを実行しない。
4. steady stateと疎通を確認する。CIを導入したら環境ごとのconcurrencyで実行を直列化する。

Terraformがサービスのtask definitionを管理し、CIが別途update-serviceして所有権を二重化する構成を避ける。独立更新中は旧Webと新APIが通信するため、API契約・DB変更は新旧アプリと互換な追加変更を優先する。削除等は利用側の移行後に別リリースで行い、アプリのrollbackがDBを自動で元に戻すとは扱わない。[ECSの単発タスク](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/standalone-tasks.html)

## SSEとSSRを維持する設定

ALBからStartへはチャットのSSEとレポートのSSRをそのまま通す。初期はCloudFront、API Gateway、独自リバースプロキシを追加しない。

| 設定 | 初期候補と確認事項 |
| --- | --- |
| ALB idle timeout | 120秒。無通信のtimeoutであり、アプリの生成上限を伸ばす設定ではない |
| アプリの上限 | 現行のチャット全体60秒・無応答30秒を維持して検証 |
| Service Connect | API側でperRequestTimeout 120秒 / idleTimeout 120秒を明示。既定の15秒では長いSSEを切断する可能性があるため変更 |
| target deregistration delay | 90秒を候補にし、更新中のstream終了と新規要求の振り分けを確認 |
| container stopTimeout | 最大120秒の範囲で設定し、SIGTERM時に正常終了できるか検証 |
| Node HTTP設定 | backend keep-alive/idle設定とALBの整合を採用版のNitroで確認 |

Service Connectの追加後も、`X-Accel-Buffering: no`ヘッダーだけでAWS上の動作確認済みとはしない。実URLで、最初のチャンクが完了前に到着すること、ブラウザの停止がPythonへ届くこと、レポートの見出しが集計結果より先に届くことを確認する。APIのscale-in・rolling更新中も、既存SSEの終了猶予と停止の伝播を確認する。[ALBの接続属性](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html)、[Fargateの依存・停止時間](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)

## Terraformの配置案

次の構成のコード草案を作成した。[手順・未検証事項](../../infra/README.md)を参照。backend無効の静的確認と実環境のplan/applyを区別する。

```text
infra/terraform/
  bootstrap/                  # state用S3、ECR、必要になった時点のOIDC準備
  environments/sandbox/
    backend.tf                # bootstrapしたS3を指定
    versions.tf               # CLI/provider制約とlockで選択版を固定
    main.tf                   # 各moduleの組み立て
    variables.tf
    outputs.tf
    sandbox.tfvars.example       # 値は例示。秘密情報を含めない
  modules/
    network/                  # VPC、subnet、route、SG
    database/                 # RDS、parameter/subnet group、secretメタデータ
    application/              # IAM、ALB、ECS 2 services、Service Connect、Auto Scaling、単発task、Logs
```

- bootstrapとsandboxでstateを分ける。state用S3は暗号化、public access block、versioningを有効化する。
- S3 backendの`use_lockfile=true`を採用する。新規構成でDynamoDB lock tableは追加しない。
- state bucketはsandboxのdestroyと分けて保持する。権限を限定し、state自体も秘密情報を含み得るものとして扱う。
- image build/push、migration実行、疎通確認をTerraformのlocal-execへ詰め込まず、手順またはdeploy scriptで順に実行する。
- 主な入力はregion、project/environment、allowed_cidrs、domain/certificate、image digests、migration image digest、サービス作成フラグ、Web/API別のmin/max台数・CPU/memory・scaling設定、DBサイズ、log retention、ephemeralモード。ephemeralによる削除設定はsandbox専用とし、常設環境の既定値を変更しない。
- 出力はURL、ECR URI、cluster名、Web/API service名、Service Connect namespace、migration task definition、DB endpoint等。secretの値は出力しない。
- `.terraform.lock.hcl`はcommitし、state、実値tfvars、planファイルはGitへ入れない。Terraform/providerの版は実装時に確認して固定する。

S3 lockingとversioningはHashiCorp公式の現行仕様を参照する。[S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3)

## 1回の検証費用とdestroy

常設730時間の見積もりから、**1回の作成・稼働・削除まで**の見積もりへ変更する。短時間のためNATを利用する判断はしやすいが、30分が各サービスの時間料金の半額になるとは限らない。

| 費用項目 | 見積もりに含めるもの |
| --- | --- |
| NAT | 1台の利用時間。1時間未満の端数も1時間分と、処理GB、別AZからの転送を考慮 |
| ALB | 1時間未満の端数も1時間分のALB料金と、LCU・Public IPv4 |
| Fargate | 初期Web 1 + API 1の各proxy込みのサイズ。各2台やscale-out時の増加、初期化・migration、更新中の一時増加、イメージ取得からの時間 |
| RDS | 作成等の課金状態変更後は最短10分の秒課金。ストレージ、削除完了までの時間も考慮 |
| 周辺 | ECR、Logs、Secrets Manager、S3 state、必要なDNS、NATのElastic IP等 |

東京の現在単価と想定転送量で1回分を算出し、削除遅延・失敗時の余裕を加えた予算を決める。確定金額はまだ算出していない。[NAT料金](https://aws.amazon.com/vpc/pricing/)、[ALB料金](https://aws.amazon.com/elasticloadbalancing/pricing/)、[RDS料金](https://aws.amazon.com/rds/postgresql/pricing/)、[Fargate料金](https://aws.amazon.com/fargate/pricing/)

### 一時環境だけの削除設定

- sandboxには合成データのみ投入する。ローカルや常設DBのデータをコピーしない。
- RDSは`deletion_protection=false`、`skip_final_snapshot=true`、`backup_retention_period=0`、`delete_automated_backups=true`を候補とする。常設環境では削除保護とバックアップを有効にする別設定を持つ。
- sandbox所有のLogsはdestroyで削除する。アプリ用secretは一時環境でのみ回復待ち期間なしの削除を候補とし、RDS管理secretとの削除順序・再作成時の名前衝突も検証する。
- 共通のbootstrapにはstate用S3とECRを残せるが、**それらはsandboxのdestroyだけでは消えない**。全消去が必要なら、イメージとversioningされたstateの保存方針を決め、最後にbootstrapを別途削除する。両者の残存費用も記録する。
- リソースにはproject・environment・run_id・expires_atのタグを付け、削除対象をその実行専用のリソースへ限定する。expires_atは目印であり、タグだけでは自動削除されない。

### 短時間検証の進め方

1. Docker buildとローカルテスト、イメージpush、既存ドメイン/証明書の準備は一時環境を作る前に済ませる。
2. apply後、初期化とmigration、API、Webの順に起動する。検証はTODOの読み書き、SSEの途中到着・停止、レポートpending、許可IP制限を優先する。API単独の台数変更も確認する。
3. 利用時間の上限で新しい検証を打ち切り、destroyへ進む。デプロイ手順は失敗時にもcleanupへ進む設計にし、CIなら常時実行のcleanup段階とrunner停止時の別の回収経路を用意する。
4. destroyが完了したか、ECS service/task、ALB/target group、NAT/EIP、RDS、Logs、secret、Auto Scaling target/policy、Cloud Map namespace/serviceの残存を確認する。ECS削除だけではnamespaceは消えないため、Terraformで明示管理する。state上で消えたこととAWS側の削除完了を照合する。
5. 削除失敗時はstateを保持し、状態を確認して再実行する。短時間制限に合わせて単にコマンドをtimeoutさせても、AWSリソースは消えない。

RDSは最終snapshotを省いても内部削除処理が残る。**作成開始から削除完了まで30分厳守**が必要なら、実測後に判定し、必要に応じてDBだけ事前作成した検証用RDSを使う構成へ切り替える。その場合は「各回の完全destroy」と異なり、共有DBが残ることを明示する。[RDSの削除](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_DeleteInstance.html)

## 他の配置案との比較

| 案 | 適する場合 | 今回の判断 |
| --- | --- | --- |
| private Fargate / 2 services + RDS | Web/APIを独立更新・スケール | 採用案。Service Connect、NAT 1台、初期Web 1 + API 1 |
| private Fargate / 同居2 containers + RDS | 同時更新・同時スケールで十分な場合 | 以前の案。今回の独立スケール要件には使わない |
| Public Fargate / 2 containers + RDS | 常設環境でNATの固定費を削る | 旧案。今は選択しない |
| ECS Express Mode | 自動HTTPSや周辺設定の自動化を優先 | Terraform対応もある候補。今回は入口のIP制限・小さな固定構成・所有するリソースの明示を優先 |
| EC2 + Compose | 常時費用を別途比較し、OS運用も引き受ける | 選択肢として残すが、今回はサーバー管理を減らすFargateを優先 |

Express Modeを「Terraform未対応」や「同一タスクを使えない」という理由で除外しない。採用する場合はカスタムtask definitionとIP制限の管理方法を検証し、通常ECSとの二重管理を避ける。[Express Mode](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html)、[カスタムtask definitionの指定](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-getting-started.html)

## AWS検証までの段階と完了条件

1. アカウント・リージョン・許可CIDR・HTTPS方式・1回の予算と、30分を計測する起点を確定する。
2. DB接続のsecret/TLS対応、health確認、migrationの分離はコードとローカルテストを追加済み。AWS用イメージのbuildとRDS接続はこれから確認する。
3. Terraformのbootstrapとsandboxの草案を作成済み。fmt・validateを行い、その後のAWS検証で実値のplanとdestroy planの対象範囲を確認する。
4. イメージをECRへ保存し、初期化・migration・API・Webの順に起動する。Service Connectの名前解決・HTTP通信・明示timeoutを確認する。
5. 許可IPから主要フローを確認し、許可外の入口拒否、taskにPublic IPがないこと、appのNAT経路とDBの分離も確認する。
6. APIだけを1→3→1へ変更し、Webの台数と主要フローが維持されること、DB接続が予算内であることを確認する。
7. destroyと残存確認を最初の検証サイクルから行う。自動スケール負荷試験・独立更新・rollback・secret更新は別の短時間サイクルに分けて確認し、作成・検証・削除の所要時間をREADMEへ記録する。
8. 手動手順が固まった後、必要ならGitHub Actionsの手動実行とOIDCを追加する。AWSの長期アクセスキーをGitHubへ保存しない。[GitHub OIDC](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)

AWSへのplan・applyと公開は次の検証段階の作業。静的validateやローカルテストをAWS動作確認の代わりにしない。AWS上の動作、実効権限、料金、RDSバージョン・インスタンスタイプの選択可能性は未検証であり、初回検証結果によって構成を見直す。
