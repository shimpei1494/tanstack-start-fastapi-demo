output "state_bucket_name" {
  description = "Bucket for separate environment states; retained beyond sandbox teardown."
  value       = aws_s3_bucket.state.id
}

output "web_repository_url" {
  description = "Web image destination. Build and push are separate operations."
  value       = aws_ecr_repository.application["web"].repository_url
}

output "api_repository_url" {
  description = "API image destination. Build and push are separate operations."
  value       = aws_ecr_repository.application["api"].repository_url
}

output "sandbox_backend_config" {
  description = "Non-secret S3 backend settings for the sandbox root, not for this bootstrap root."
  value = {
    bucket       = aws_s3_bucket.state.id
    key          = "sandbox/terraform.tfstate"
    region       = var.region
    encrypt      = true
    use_lockfile = true
  }
}
