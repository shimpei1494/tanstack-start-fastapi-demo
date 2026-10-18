variable "region" {
  description = "AWS region for the state bucket and container repositories."
  type        = string
  default     = "ap-northeast-1"
}

variable "allowed_account_id" {
  description = "Expected AWS account ID; the provider rejects credentials for other accounts."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.allowed_account_id))
    error_message = "allowed_account_id must contain exactly 12 digits."
  }
}

variable "name" {
  description = "Short resource prefix, starting with a lowercase letter and ending with a letter or digit."
  type        = string

  validation {
    condition     = length(var.name) <= 24 && can(regex("^[a-z]([a-z0-9-]*[a-z0-9])?$", var.name))
    error_message = "name must be 1–24 lowercase letters, digits, or hyphens, start with a letter, and end with a letter or digit."
  }
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name. Availability must be checked before provisioning."
  type        = string

  validation {
    condition = (
      length(var.state_bucket_name) >= 3 && length(var.state_bucket_name) <= 63 &&
      can(regex("^[a-z0-9][a-z0-9-]*[a-z0-9]$", var.state_bucket_name)) &&
      !startswith(var.state_bucket_name, "xn--") &&
      !startswith(var.state_bucket_name, "sthree-") &&
      !startswith(var.state_bucket_name, "amzn-s3-demo-") &&
      !endswith(var.state_bucket_name, "-s3alias") &&
      !endswith(var.state_bucket_name, "--ol-s3") &&
      !endswith(var.state_bucket_name, "--x-s3") &&
      !endswith(var.state_bucket_name, "--table-s3")
    )
    error_message = "Use a unique 3–63 character lowercase S3 bucket name with letters, digits, and hyphens, without an AWS-reserved prefix or suffix."
  }
}

variable "untagged_image_retention_days" {
  description = "Only untagged ECR images older than this age are eligible for automatic expiry."
  type        = number
  default     = 14

  validation {
    condition     = var.untagged_image_retention_days >= 1 && floor(var.untagged_image_retention_days) == var.untagged_image_retention_days
    error_message = "untagged_image_retention_days must be a positive integer."
  }
}

variable "tags" {
  description = "Additional non-sensitive tags."
  type        = map(string)
  default     = {}
}
