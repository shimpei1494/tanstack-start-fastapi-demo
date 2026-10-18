variable "name" { type = string }
variable "region" { type = string }
variable "account_id" { type = string }
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "private_subnet_ids" { type = list(string) }
variable "security_group_ids" {
  type = object({ alb = string, web = string, api = string, maintenance = string, db = string })
}
variable "database" {
  type = object({
    host             = string, port = number, db_name = string, app_username = string,
    admin_secret_arn = string, app_secret_arn = string
  })
}
variable "images" {
  type = object({ web = string, api = string, migration = string })
}
variable "service_sizes" {
  type = map(object({ cpu = number, memory = number, min_capacity = number, max_capacity = number, cpu_target = number }))
}
variable "enable_api_service" { type = bool }
variable "enable_web_service" { type = bool }
variable "enable_auto_scaling" { type = bool }
variable "certificate_arn" { type = string }
variable "public_hostname" { type = string }
variable "ephemeral" { type = bool }
variable "log_retention_days" { type = number }
variable "tags" { type = map(string) }
