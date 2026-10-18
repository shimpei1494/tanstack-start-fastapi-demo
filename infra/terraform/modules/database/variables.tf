variable "name" {
  description = "Resource name prefix, unique within the deployment region."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,23}$", var.name)) && !endswith(var.name, "-") && !strcontains(var.name, "--")
    error_message = "name must start with a lowercase letter, be at most 24 characters, and contain lowercase letters, digits or single hyphens without a trailing hyphen."
  }
}

variable "subnet_ids" {
  description = "Isolated database subnet IDs covering at least two AZs."
  type        = list(string)

  validation {
    condition     = length(distinct(var.subnet_ids)) >= 2
    error_message = "Supply at least two different database subnet IDs."
  }
}

variable "security_group_id" {
  description = "Database security group allowing PostgreSQL only from API and maintenance tasks."
  type        = string
}

variable "db_name" {
  description = "Initial PostgreSQL database name."
  type        = string
  default     = "demo"

  validation {
    condition     = can(regex("^[A-Za-z][A-Za-z0-9_]{0,62}$", var.db_name))
    error_message = "db_name must start with a letter and contain at most 63 letters, digits or underscores."
  }
}

variable "app_username" {
  description = "Non-admin application role, created later by the explicit initialization task."
  type        = string
  default     = "demo_app"

  validation {
    condition     = can(regex("^[a-z_][a-z0-9_]{0,62}$", var.app_username)) && !contains(["demo_admin", "postgres", "rdsadmin"], var.app_username) && !startswith(var.app_username, "pg_")
    error_message = "Use a lowercase PostgreSQL role name of at most 63 characters, distinct from admin or reserved roles."
  }
}

variable "engine_version" {
  description = "PostgreSQL 17 engine version; availability must be checked in the chosen region before apply."
  type        = string
  default     = "17"

  validation {
    condition     = can(regex("^17(\\.[0-9]+)*$", var.engine_version))
    error_message = "The parameter group is for PostgreSQL 17; engine_version must be 17 or a 17.x release."
  }
}

variable "instance_class" {
  description = "Initial low-cost Single-AZ RDS class; region and engine compatibility are unverified."
  type        = string
  default     = "db.t4g.micro"
}

variable "ephemeral" {
  description = "Temporary synthetic-data sandbox: no backups, no deletion protection, no final snapshot, and immediate application-secret deletion."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags shared by resources in this environment."
  type        = map(string)
  default     = {}
}
