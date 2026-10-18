output "host" {
  description = "Private PostgreSQL hostname; clients must verify TLS against the RDS CA bundle."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "PostgreSQL port."
  value       = aws_db_instance.this.port
}

output "db_name" {
  description = "Application database name."
  value       = var.db_name
}

output "app_username" {
  description = "Application role to be created by initialization."
  value       = var.app_username
}

output "admin_secret_arn" {
  description = "RDS-managed admin secret ARN, for initialization and migrations only; no secret value is read."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "app_secret_arn" {
  description = "Application-password secret ARN; the value does not exist until explicit initialization succeeds."
  value       = aws_secretsmanager_secret.app.arn
}
