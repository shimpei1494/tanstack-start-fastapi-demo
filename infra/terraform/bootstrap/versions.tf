terraform {
  required_version = ">= 1.11, < 2.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.69.1"
    }
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.allowed_account_id]

  default_tags {
    tags = merge(var.tags, {
      Project   = var.name
      Component = "bootstrap"
      ManagedBy = "Terraform"
    })
  }
}
