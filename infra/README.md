# AWS検証環境のTerraform草案

**コードを作成した段階です。AWSへのplan・apply・デプロイ・destroyは未実施で、動作確認済みの構成ではありません。** Terraformの整形・静的validateやPythonのローカルテストが通っても、AWS上で作成・通信・更新・削除できることは保証しません。初回検証の結果によって構成とコードを見直す前提です。

[構成計画](../docs/plans/aws-infrastructure.md)に沿った、合成データ専用の短時間sandboxです。

```text
許可IP → Public ALB → private Web service → Service Connect → private API service
                                                               ↓ TLS
                                                          isolated RDS
private app subnet → NAT Gateway → ECR / Logs / Secrets Manager
                  → S3 Gateway Endpoint（イメージレイヤー）
```

- ECSクラスターは1つ、Web/APIは別サービス。初期台数は各1、独立したCPU target trackingの候補はWeb 1〜2、API 1〜4。
- 2 AZにpublic・private app・isolated DB subnetを配置。NATは1台、RDSはSingle-AZ。構成全体の高可用性は未実現。
- タスクとRDSにPublic IPは付けない。APIへの8000番はWebのSGから、DBへの5432番はAPI/maintenanceのSGからのみ許可。
- 外部HTTPSは既存ACM証明書を指定し、DNSは別途設定する。Web→APIは内部HTTP。サービス間TLS/Private CAはこの草案に含めない。
- RDS管理者secretとアプリ用secretを分離。Terraformはアプリ用secretの値を生成・取得しない。初期化タスクが値とDBユーザーを準備する。
- AWS用APIイメージは[専用Dockerfile](runtime/Dockerfile.api)を使う。既存Compose用イメージにはAWS起動処理・RDS CAの前提が揃わない。

## 配置とローカル確認

| パス                             | 内容                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| `terraform/bootstrap`            | state用S3・Web/API ECR。sandboxを削除しても保持              |
| `terraform/environments/sandbox` | 入力・backend・3 moduleの組み立て                            |
| `terraform/modules/network`      | VPC・6 subnet・NAT・S3 endpoint・用途別SG                    |
| `terraform/modules/database`     | TLS必須RDS・管理者secret・アプリsecretメタデータ             |
| `terraform/modules/application`  | ALB・ECS・Service Connect・IAM・Logs・Auto Scaling・単発task |
| `runtime/Dockerfile.api`         | boto3 extraとRDS CAを含むAWS用APIイメージ                    |
| `scripts/run-task.sh`            | 明示したinit/migration/seedだけを実行し、終了コードを確認    |

Terraform CLI 1.16.2 / AWS provider 6.69.1で静的確認。必要Terraformは1.11以上2.0未満、providerはlockファイルに固定する。初回のprovider取得は公開Registryへの接続が必要だが、以下ではbackendを無効にし、AWSのplan/applyは実行しない。

```bash
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform/bootstrap init -backend=false
terraform -chdir=infra/terraform/bootstrap validate
terraform -chdir=infra/terraform/environments/sandbox init -backend=false
terraform -chdir=infra/terraform/environments/sandbox validate
(cd services/api && uv run --frozen pytest)
```

作成時のローカル確認は、両rootの`validate`、Terraform/文書の整形、APIのpytest 53件、ruff、helperのbash構文確認が成功した。AWS APIや実リソースを使う検証は実施していない。

`validate`はAWSの認証、IAM実効権限、イメージの存在、入力値に対する実際のplanまでは確認しない。AWSイメージのbuild、RDS初期化SQL、TLS、Service Connect経由SSEも未検証。[API側のAWS対応](../services/api/README.md)も参照。

## 将来AWSで試すときの手順（今回は未実行）

必要ツールはTerraform、Docker buildx、AWS CLI、単発タスク用のbash/jq。対象アカウント・権限・東京リージョン・許可IP・予算・cleanup担当を先に確認する。providerは明示した`allowed_account_id`へ限定する。AWS資格情報は環境の認証方法を使い、tfvars/backend設定/イメージへ保存しない。

### 1. Bootstrapを別stateで準備する

`bootstrap/bootstrap.tfvars.example`を`bootstrap/local.tfvars`へコピーし、アカウントID・ECR prefix・グローバルに一意なstate bucket名を実値へ変更する。例示の値をそのまま使わない。

```bash
terraform -chdir=infra/terraform/bootstrap init
terraform -chdir=infra/terraform/bootstrap plan -var-file=local.tfvars -out=bootstrap.tfplan
terraform -chdir=infra/terraform/bootstrap apply bootstrap.tfplan
```

bootstrapは初回local state。stateは秘密情報を含み得るため安全に保存する。sandbox state用bucketの準備後も、bootstrap stateは別途保護して管理する。[詳細](terraform/bootstrap/README.md)

### 2. AWS用イメージを準備する

Webは`apps/web/Dockerfile`、APIは`infra/runtime/Dockerfile.api`をリポジトリルートcontextから`--platform linux/amd64`でbuildする。ローカルbuildの例:

```bash
docker buildx build --platform linux/amd64 --load -f apps/web/Dockerfile -t workroom-web:aws .
docker buildx build --platform linux/amd64 --load -f infra/runtime/Dockerfile.api -t workroom-api:aws .
```

ECRのbootstrap出力先へ別途認証・tag・pushし、digestを取得する。タグはGit SHA等で一意にし、同じimmutableタグを再利用しない。Terraformにbuild/push用local-execはない。RDS CAはAWS用イメージのbuild時に公式trust storeからHTTPSで取得するため、取得先・CA期限・再buildも確認対象。

### 3. Sandboxの基盤とtask definitionを作る

`sandbox.tfvars.example`を同じディレクトリの`local.tfvars`へ、`backend.hcl.example`を`backend.hcl`へコピーする。実値のアカウントID・許可CIDR・run名・期限タグ・イメージdigestを設定する。run名とstate keyは他の検証環境と重複させない。

HTTPSでは同リージョン/アカウントの既存ACM証明書と、その証明書がカバーする`public_hostname`を指定する。DNSはALB出力へのalias等を別途設定する。ドメインなしの一時的な疎通だけなら、証明書/hostnameをnullにし`allow_temporary_http=true`を明示できる。いずれも許可CIDR必須。

```bash
terraform -chdir=infra/terraform/environments/sandbox init -reconfigure -backend-config=backend.hcl
terraform -chdir=infra/terraform/environments/sandbox plan -var-file=local.tfvars -out=sandbox.tfplan
terraform -chdir=infra/terraform/environments/sandbox apply sandbox.tfplan
```

ここでは`enable_api_service=false`、`enable_web_service=false`、`enable_auto_scaling=false`を維持する。サービスはまだなく、DB・ALB・task definition等だけを作る。RDSやNAT等はこの段階から費用が発生する。

### 4. 初期化・migration・必要なseedを明示実行する

```bash
infra/scripts/run-task.sh init
infra/scripts/run-task.sh migration
# サンプルが必要な場合だけ。毎回は実行しない。
infra/scripts/run-task.sh seed
```

helperはAWSへの書き込みを行う。各コマンドの成功を確認してから次へ進み、init/migrationの失敗時にサービスを起動しない。helperの待機がtimeoutしてもタスクを自動停止しないため、表示したtask ARNから状態・Logsを確認する。init/migration taskにはService Connect proxyを付けず、RDSへ直接接続する。

### 5. API、Web、Auto Scalingの順に有効化する

1. `enable_api_service=true`に変更し、planレビュー後にapply。API container healthとService Connect endpointを確認する。
2. `enable_web_service=true`へ変更し、planレビュー後にapply。HTTPSならDNSを設定し、出力URLから疎通確認する。
3. `enable_auto_scaling=true`にし、planレビュー後にapply。Web/APIそれぞれにtarget/policyが作られる。

初回作成時の台数は`service_sizes.*.min_capacity`。その後の`desired_count`は常にTerraformのignore対象。**Auto Scaling無効のままmin/maxを書き換えても、既存サービスの台数は変わらない。** 台数検証はAuto Scalingを有効にしたうえでAPIのmin/maxを一時的に両方3へ変更し、1へ戻す（終了後は元の1〜4へ戻す）。単なるslowシナリオのsleepではCPUは上がらないため、自動スケール負荷試験は別に実施する。

通常リリースでは`images.migration`だけ先に新版へ変更し、migration成功後にAPI digest、必要ならWeb digestを別々に更新する。DB変更がないリリースにmigrationは不要。旧Webと新APIが共存できる契約を維持する。アプリ用secretを更新したら、稼働中taskの環境変数は自動で変わらないため、新taskへの再配置も明示的に行う。

### 6. Sandboxを削除し、残存を確認する

```bash
terraform -chdir=infra/terraform/environments/sandbox plan -destroy -var-file=local.tfvars -out=destroy.tfplan
terraform -chdir=infra/terraform/environments/sandbox apply destroy.tfplan
```

`ephemeral=true`ではDBを最終snapshot/backupなしで削除し、アプリsecretも回復待ちなしで削除する。合成データ以外を投入しない。ECS task/service、Auto Scaling、ALB、Cloud Map、NAT/EIP、RDS、Logs、secretの削除完了を確認し、失敗時はstateを保持して復旧する。`expires_at`タグは目印だけで自動削除機能はない。

**30分以内の削除完了は保証しない。** RDS等は作成・削除に時間がかかり、失敗時にも料金が残る。apply開始・利用開始・destroy開始・削除完了を記録する。

bootstrapのstate S3とECRは残る。S3には`prevent_destroy`、ECRには`force_delete=false`を設定しているため、全消去は保存方針を決めた別作業となる。sandboxのdestroyに含めない。

## 初回検証と構成の再検討事項

- `fmt`/`validate`成功後も、AWS上のplanとdestroy planを実値でレビューする。リージョン/AZ、RDS 17・db.t4g.microの対応、Fargate・EIP等のquota、実行者のPassRoleやサービスリンクロール作成権限は未確認。
- APIイメージbuildとRDS CA、管理者secret注入、初期化の再実行、migration、アプリユーザーのCRUDと権限制限を実DBで確認する。secret値はTerraform/state/ログに出さない。
- 許可外IPの拒否、WebからRDSへの接続拒否、private taskのNAT経路、isolated DBにdefault routeがないことを確認する。
- TODO・チャットSSEの途中到着と停止伝播・レポートのSSR/pendingをALBとService Connect経由で確認する。各proxyのtimeout、Node keep-alive、SIGTERM/scale-in時のstream終了は実測する。
- APIのみ1→3→1、Web/APIの独立更新・rollbackを確認する。API poolは1プロセス当たり2+overflow 1。上限4台・rolling最大200%ではAPIだけで最大24接続を想定し、migration/管理用を含めてRDS側の上限と照合する。
- 各task 0.5 vCPU/1 GiBのうちproxyへCPU256・memory128 MiBの余裕を残すが、十分かは未検証。CPU60%・cooldown60/300秒・台数上限は仮値。
- NAT 1台とSingle-AZ DBは可用性の制約。常設・実データ・認証・内部TLS・AZ障害対応が必要なら、NAT配置、DB Multi-AZ/backup、Private CA等を含めて再設計する。`ephemeral=false`にするだけでは本番対応にならない。常設側の削除保護解除・最終snapshot名の再利用も別途設計する。
- ALBアクセスログ、RDS/アプリの運用アラーム・通知先、定期cleanup、CI/OIDCは未実装。Auto Scalingが作るCPUアラームとCloudWatch Logsだけで運用監視が完成したとは扱わない。
- Terraform state/secret/ECR残存を含む実費と削除所要時間を測る。現時点では東京の構成全体の料金見積もりも未確定。

## 参照した仕様

- [ECSの設計指針](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/application_architecture.html)
- [Service Connectの制約・リソース・timeout](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-connect-concepts-deploy.html)
- [RDSのSecrets Manager連携](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html)
- [ECSへのsecret注入](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- [S3 backendとlock](https://developer.hashicorp.com/terraform/language/backend/s3)
- [AWS provider: ECS service](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecs_service)
