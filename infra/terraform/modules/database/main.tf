resource "aws_db_subnet_group" "this" {
  name        = var.name
  description = "Isolated PostgreSQL subnets spanning two AZs"
  subnet_ids  = var.subnet_ids
  tags        = merge(var.tags, { Name = var.name })
}

resource "aws_db_parameter_group" "this" {
  name_prefix = "${var.name}-"
  description = "PostgreSQL 17 with mandatory TLS"
  family      = "postgres17"
  tags        = merge(var.tags, { Name = var.name })

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "this" {
  identifier                  = var.name
  engine                      = "postgres"
  engine_version              = var.engine_version
  instance_class              = var.instance_class
  allocated_storage           = 20
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = var.db_name
  username                    = "demo_admin"
  manage_master_user_password = true
  port                        = 5432
  db_subnet_group_name        = aws_db_subnet_group.this.name
  parameter_group_name        = aws_db_parameter_group.this.name
  vpc_security_group_ids      = [var.security_group_id]
  publicly_accessible         = false
  multi_az                    = false
  auto_minor_version_upgrade  = true
  backup_retention_period     = var.ephemeral ? 0 : 7
  delete_automated_backups    = var.ephemeral
  deletion_protection         = !var.ephemeral
  skip_final_snapshot         = var.ephemeral
  final_snapshot_identifier   = var.ephemeral ? null : "${var.name}-final"
  apply_immediately           = var.ephemeral
  copy_tags_to_snapshot       = true
  tags                        = merge(var.tags, { Name = var.name })
}

# Metadata only: initialization generates/stores the value outside Terraform.
# Do not add secret_version, random_password or a secret-value data source here.
resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.name}/database/application"
  description             = "Password for PostgreSQL role ${var.app_username}; initialized by a one-off ECS task"
  recovery_window_in_days = var.ephemeral ? 0 : 7
  tags                    = merge(var.tags, { Name = "${var.name}-app-db" })
}
