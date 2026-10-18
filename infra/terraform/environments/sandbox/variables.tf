variable "name" {
  description = "Unique resource prefix for this sandbox run (at most 24 characters)."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,23}$", var.name)) && !endswith(var.name, "-") && !strcontains(var.name, "--")
    error_message = "Use a lowercase prefix starting with a letter, at most 24 characters, without trailing or consecutive hyphens."
  }
}
variable "region" {
  type    = string
  default = "ap-northeast-1"
  validation {
    condition     = can(regex("^(ap|us|eu|ca|sa|me|af|il|mx)-[a-z]+-[0-9]+$", var.region))
    error_message = "This draft supports commercial AWS regions only."
  }
}
variable "allowed_account_id" {
  description = "Explicit target account guard; do not derive it from currently active credentials."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.allowed_account_id))
    error_message = "Set the intended 12-digit AWS account ID."
  }
}
variable "availability_zones" {
  description = "Two AZs available to the target account; availability has not been queried."
  type        = list(string)
  default     = ["ap-northeast-1a", "ap-northeast-1c"]
  validation {
    condition = length(var.availability_zones) == 2 && length(distinct(var.availability_zones)) == 2 && alltrue([
      for az in var.availability_zones : startswith(az, var.region)
    ])
    error_message = "Specify two distinct AZ names in the chosen region."
  }
}
variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}
variable "allowed_cidrs" {
  description = "Only these IPv4 CIDRs may access the public ALB; no /0 or IPv6."
  type        = list(string)
  validation {
    condition = length(var.allowed_cidrs) > 0 && alltrue([
      for cidr in var.allowed_cidrs : can(cidrnetmask(cidr)) && try(tonumber(split("/", cidr)[1]) > 0, false)
    ])
    error_message = "Supply at least one IPv4 CIDR with a nonzero prefix."
  }
}
variable "run_id" {
  description = "Human-readable run identifier included in resource tags."
  type        = string
  validation {
    condition     = length(trimspace(var.run_id)) > 0
    error_message = "run_id must not be empty."
  }
}
variable "expires_at" {
  description = "RFC3339 cleanup reminder tag only; does not schedule deletion."
  type        = string
  validation {
    condition     = can(formatdate("YYYY-MM-DD", var.expires_at))
    error_message = "expires_at must be an RFC3339 timestamp."
  }
}
variable "certificate_arn" {
  description = "Existing ACM certificate in this region; DNS ownership/validation is external to this draft."
  type        = string
  default     = null
  validation {
    condition     = var.certificate_arn == null ? true : can(regex("^arn:aws:acm:${var.region}:${var.allowed_account_id}:certificate/", var.certificate_arn))
    error_message = "Use an ACM certificate ARN in the intended account and region."
  }
}
variable "public_hostname" {
  description = "Hostname covered by the certificate; manually point its DNS to the ALB output."
  type        = string
  default     = null
  validation {
    condition     = var.certificate_arn == null || try(can(regex("^[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$", var.public_hostname)), false)
    error_message = "HTTPS requires public_hostname covered by the ACM certificate."
  }
}
variable "allow_temporary_http" {
  description = "Explicitly allow IP-restricted HTTP for synthetic-data testing without a domain."
  type        = bool
  default     = false
  validation {
    condition     = var.certificate_arn != null || var.allow_temporary_http
    error_message = "Provide a certificate and hostname, or explicitly opt into temporary HTTP."
  }
}
variable "images" {
  description = "Images pinned by digest. API/migration must use infra/runtime/Dockerfile.api, not the local API Dockerfile."
  type        = object({ web = string, api = string, migration = optional(string) })
  validation {
    condition = alltrue([for image in [var.images.web, var.images.api, coalesce(var.images.migration, var.images.api)] :
      can(regex("^${var.allowed_account_id}\\.dkr\\.ecr\\.${var.region}\\.amazonaws\\.com/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$", image))
    ])
    error_message = "Pin every image by sha256 digest in ECR in the target account and region."
  }
}
variable "enable_api_service" {
  description = "Keep false until initialization and migrations have succeeded."
  type        = bool
  default     = false
}
variable "enable_web_service" {
  description = "Enable only after API and its Service Connect endpoint are healthy."
  type        = bool
  default     = false
  validation {
    condition     = !var.enable_web_service || var.enable_api_service
    error_message = "The API service must be enabled before the Web service."
  }
}
variable "enable_auto_scaling" {
  description = "After services start, let independent ECS target-tracking policies manage their counts."
  type        = bool
  default     = false
}
variable "service_sizes" {
  description = "Task resources include the proxy. Initial CPU targets and bounds must be calibrated."
  type        = map(object({ cpu = number, memory = number, min_capacity = number, max_capacity = number, cpu_target = number }))
  default = {
    web = { cpu = 512, memory = 1024, min_capacity = 1, max_capacity = 2, cpu_target = 60 }
    api = { cpu = 512, memory = 1024, min_capacity = 1, max_capacity = 4, cpu_target = 60 }
  }
  validation {
    condition     = toset(keys(var.service_sizes)) == toset(["web", "api"])
    error_message = "Configure exactly the web and api services."
  }
  validation {
    condition = alltrue([for config in values(var.service_sizes) :
      config.min_capacity >= 1 && floor(config.min_capacity) == config.min_capacity &&
      config.max_capacity >= config.min_capacity && floor(config.max_capacity) == config.max_capacity &&
      config.cpu_target > 0 && config.cpu_target < 100 &&
      contains([512, 1024, 2048, 4096], config.cpu) && config.memory % 1024 == 0 &&
      config.memory >= config.cpu * 2 && config.memory <= (config.cpu == 4096 ? 30720 : config.cpu * 8)
    ])
    error_message = "Use integer capacity >=1, CPU target between 0 and 100, and a supported Fargate size (512–4096 CPU units, valid memory in 1 GiB steps)."
  }
}
variable "db_engine_version" {
  type    = string
  default = "17"
}
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "ephemeral" {
  description = "Synthetic-data sandbox deletion settings; false alone does not make this a production architecture."
  type        = bool
  default     = true
}
variable "log_retention_days" {
  type    = number
  default = 14
  validation {
    condition     = contains([1, 3, 5, 7, 14, 30], var.log_retention_days)
    error_message = "Choose one of 1, 3, 5, 7, 14 or 30 days for the sandbox logs."
  }
}
