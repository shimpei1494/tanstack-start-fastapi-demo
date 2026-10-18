locals {
  task_kinds = toset(["web", "api", "init", "migration", "seed"])
  # This sandbox uses commercial AWS regions and ECR repositories in its own account.
  repository_arns = distinct([for image in values(var.images) :
    "arn:aws:ecr:${var.region}:${var.account_id}:repository/${join("/", slice(split("/", split("@", image)[0]), 1, length(split("/", split("@", image)[0]))))}"
  ])
  assume_task = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ecs-tasks.amazonaws.com" }
      Condition = {
        StringEquals = { "aws:SourceAccount" = var.account_id }
        ArnLike      = { "aws:SourceArn" = "arn:aws:ecs:${var.region}:${var.account_id}:*" }
      }
    }]
  })
}

resource "aws_iam_role" "execution" {
  for_each           = local.task_kinds
  name               = "${var.name}-${each.key}-exec"
  assume_role_policy = local.assume_task
  tags               = var.tags
}

resource "aws_iam_role_policy" "execution" {
  for_each = local.task_kinds
  name     = "image-and-logs"
  role     = aws_iam_role.execution[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], Resource = local.repository_arns },
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = [for group in aws_cloudwatch_log_group.this : "${group.arn}:*"] }
    ]
  })
}

resource "aws_iam_role_policy" "secret_injection" {
  for_each = toset(["api", "seed", "init", "migration"])
  name     = "database-secret-injection"
  role     = aws_iam_role.execution[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = contains(["init", "migration"], each.key) ? var.database.admin_secret_arn : var.database.app_secret_arn
    }]
  })
}

# Application task roles have no AWS permissions, except explicit initialization.
resource "aws_iam_role" "task" {
  for_each           = local.task_kinds
  name               = "${var.name}-${each.key}-task"
  assume_role_policy = local.assume_task
  tags               = var.tags
}

resource "aws_iam_role_policy" "initialize_secret" {
  name = "initialize-application-password"
  role = aws_iam_role.task["init"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow", Action = ["secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue"]
      Resource = var.database.app_secret_arn
    }]
  })
}
