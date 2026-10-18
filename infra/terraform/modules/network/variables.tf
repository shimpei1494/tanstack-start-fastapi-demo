variable "name" {
  description = "Resource name prefix, unique within the deployment region."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,23}$", var.name)) && !endswith(var.name, "-")
    error_message = "name must start with a lowercase letter, contain lowercase letters, digits or hyphens, and be at most 24 characters without a trailing hyphen."
  }
}

variable "region" {
  description = "AWS region, matching the provider; used to construct the S3 endpoint service name without discovery."
  type        = string
}

variable "vpc_cidr" {
  description = "IPv4 VPC range; six /24 subnets are derived from the default /16."
  type        = string
  default     = "10.42.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr)) && try(tonumber(split("/", var.vpc_cidr)[1]) >= 16 && tonumber(split("/", var.vpc_cidr)[1]) <= 20, false)
    error_message = "vpc_cidr must be a valid IPv4 CIDR with a prefix between /16 and /20, allowing six AWS-supported subnets after adding eight prefix bits."
  }
}

variable "availability_zones" {
  description = "Exactly two distinct AZ names in the configured provider region; supplied explicitly without discovery."
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) == 2 && length(distinct(var.availability_zones)) == 2 && alltrue([for az in var.availability_zones : length(trimspace(az)) > 0])
    error_message = "Supply exactly two different, nonempty availability zone names."
  }
}

variable "allowed_cidrs" {
  description = "IPv4 source CIDRs allowed to access the ALB; an unrestricted /0 is rejected."
  type        = list(string)

  validation {
    condition = length(var.allowed_cidrs) > 0 && alltrue([
      for cidr in var.allowed_cidrs : can(cidrnetmask(cidr)) && try(tonumber(split("/", cidr)[1]) > 0, false)
    ])
    error_message = "allowed_cidrs must contain at least one valid IPv4 CIDR and must not contain a /0 range."
  }
}

variable "listener_port" {
  description = "The sole public ALB listener port; use 443 with ACM or explicitly opt into temporary HTTP on 80."
  type        = number
  default     = 443

  validation {
    condition     = contains([80, 443], var.listener_port)
    error_message = "listener_port must be 443 or 80."
  }
}

variable "tags" {
  description = "Tags shared by resources in this environment."
  type        = map(string)
  default     = {}
}
