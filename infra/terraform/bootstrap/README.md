# Bootstrap

S3 state bucketとWeb/APIのECR repositoryを管理する独立したTerraform root。
**AWS上では未検証**。リソース作成、料金、削除手順を確認してから利用する。

このrootは、state保存先を作成するため、意図的にlocal backendで始める。
`terraform.tfstate`とそのbackupはGitに入れず、秘密情報を含み得るファイルとしてアクセス制限・暗号化された保存先・安全なbackupを用意する。
後でremote backendへ移す場合は、bootstrap専用のkey（例: `bootstrap/terraform.tfstate`）を使い、sandboxのstateと共有しない。移行手順は未検証。

`bootstrap.tfvars.example`は入力の例。実値のtfvarsには利用予定アカウントの12桁IDと、未使用のbucket名を設定する。
認証情報は通常のAWS credential chainから渡し、tfvarsへ書き込まない。providerの`allowed_account_ids`で想定外のアカウントを拒否する。

作成後に出力される`sandbox_backend_config`と`backend.hcl.example`は、sandbox rootのS3 backend設定に使う。
`backend.hcl.example`自体はTerraformのactiveなbackend設定ではない。S3 backendのstate lockは`use_lockfile = true`を使う。利用者のIAM権限には、state objectの読み書きとlock objectの作成・読み書き・削除が別途必要。

このrootのリソースはsandboxのdestroyでは消えない。bucketには`prevent_destroy = true`を設定し、versioningを有効にしている。ECRは`force_delete = false`で、イメージが入っていれば通常の削除は失敗する。
完全に削除する場合は、stateの移行・保管先、ECRの稼働中イメージ、S3の全versionとdelete markerを確認し、保護を意図的に解除する別の作業が必要。

ECRの自動削除は古い**untagged imageだけ**に限定する。デプロイ・rollbackで参照するdigestにはimmutableなSHAタグを残し、利用中に手動でタグを外さない。タグ付きイメージは自動削除されず、保管費用が残る。

このコードにはimage build/push、OIDC、AWS操作の自動実行は含めない。
