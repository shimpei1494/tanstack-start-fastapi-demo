# Supply bucket/region/key in a private backend.hcl; never put credentials here.
terraform {
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}
