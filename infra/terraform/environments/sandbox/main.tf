locals {
  tags = {
    Project = "tanstack-start-fastapi-demo", Environment = "sandbox", ManagedBy = "Terraform"
    RunId   = var.run_id, ExpiresAt = var.expires_at
  }
}
module "network" {
  source             = "../../modules/network"
  name               = var.name
  region             = var.region
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
  allowed_cidrs      = var.allowed_cidrs
  listener_port      = var.certificate_arn == null ? 80 : 443
  tags               = local.tags
}
module "database" {
  source            = "../../modules/database"
  name              = var.name
  subnet_ids        = module.network.db_subnet_ids
  security_group_id = module.network.security_group_ids.db
  engine_version    = var.db_engine_version
  instance_class    = var.db_instance_class
  ephemeral         = var.ephemeral
  tags              = local.tags
}
module "application" {
  source             = "../../modules/application"
  name               = var.name
  region             = var.region
  account_id         = var.allowed_account_id
  vpc_id             = module.network.vpc_id
  public_subnet_ids  = module.network.public_subnet_ids
  private_subnet_ids = module.network.private_subnet_ids
  security_group_ids = module.network.security_group_ids
  database = {
    host             = module.database.host, port = module.database.port, db_name = module.database.db_name
    app_username     = module.database.app_username, app_secret_arn = module.database.app_secret_arn
    admin_secret_arn = module.database.admin_secret_arn
  }
  images = {
    web = var.images.web, api = var.images.api, migration = coalesce(var.images.migration, var.images.api)
  }
  service_sizes       = var.service_sizes
  enable_api_service  = var.enable_api_service
  enable_web_service  = var.enable_web_service
  enable_auto_scaling = var.enable_auto_scaling
  certificate_arn     = var.certificate_arn
  public_hostname     = var.public_hostname
  ephemeral           = var.ephemeral
  log_retention_days  = var.log_retention_days
  tags                = local.tags
}
