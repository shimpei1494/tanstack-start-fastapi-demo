locals {
  database_environment = [
    { name = "DB_HOST", value = var.database.host },
    { name = "DB_PORT", value = tostring(var.database.port) },
    { name = "DB_NAME", value = var.database.db_name },
    { name = "DB_USER", value = var.database.app_username },
    { name = "DB_SSLMODE", value = "verify-full" },
    { name = "DB_SSLROOTCERT", value = "/opt/rds/global-bundle.pem" },
    { name = "DB_POOL_SIZE", value = "2" },
    { name = "DB_MAX_OVERFLOW", value = "1" },
    { name = "AWS_REGION", value = var.region },
    { name = "PYTHONDONTWRITEBYTECODE", value = "1" }
  ]
  application_secret = [{ name = "DB_PASSWORD", valueFrom = "${var.database.app_secret_arn}:password::" }]
  admin_secret       = [{ name = "RDS_ADMIN_CREDENTIALS", valueFrom = var.database.admin_secret_arn }]
  task_settings = {
    web = {
      image   = var.images.web, cpu = var.service_sizes.web.cpu, memory = var.service_sizes.web.memory
      command = ["node", ".output/server/index.mjs"]
      environment = [
        { name = "API_BASE_URL", value = "http://api:8000" },
        { name = "HOST", value = "0.0.0.0" },
        { name = "PORT", value = "3000" },
        { name = "NODE_ENV", value = "production" }
      ]
      secrets = []
    }
    api = {
      image       = var.images.api, cpu = var.service_sizes.api.cpu, memory = var.service_sizes.api.memory
      command     = ["python", "-m", "demo_api.aws_runtime", "serve"]
      environment = local.database_environment, secrets = local.application_secret
    }
    init = {
      image       = var.images.migration, cpu = 512, memory = 1024
      command     = ["python", "-m", "demo_api.aws_runtime", "init"]
      environment = concat(local.database_environment, [{ name = "APP_SECRET_ARN", value = var.database.app_secret_arn }])
      secrets     = local.admin_secret
    }
    migration = {
      image       = var.images.migration, cpu = 512, memory = 1024
      command     = ["python", "-m", "demo_api.aws_runtime", "migrate"]
      environment = local.database_environment, secrets = local.admin_secret
    }
    seed = {
      image       = var.images.api, cpu = 512, memory = 1024
      command     = ["python", "-m", "demo_api.aws_runtime", "seed"]
      environment = local.database_environment, secrets = local.application_secret
    }
  }
  health_checks = {
    web = ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/',{redirect:'manual'}).then(r=>process.exit(r.status>=200&&r.status<400?0:1)).catch(()=>process.exit(1))"]
    api = ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/live', timeout=2)"]
  }
}

resource "aws_ecs_task_definition" "this" {
  for_each                 = local.task_settings
  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(each.value.cpu)
  memory                   = tostring(each.value.memory)
  execution_role_arn       = aws_iam_role.execution[each.key].arn
  task_role_arn            = aws_iam_role.task[each.key].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([merge({
    name        = each.key
    image       = each.value.image
    essential   = true
    command     = each.value.command
    environment = each.value.environment
    secrets     = each.value.secrets
    stopTimeout = 120
    # Reserve CPU and memory for Service Connect's managed proxy on services.
    cpu    = contains(["web", "api"], each.key) ? each.value.cpu - 256 : each.value.cpu
    memory = contains(["web", "api"], each.key) ? each.value.memory - 128 : each.value.memory
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.this[each.key].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ecs"
      }
    }
    }, jsondecode(contains(["web", "api"], each.key) ? jsonencode({
      portMappings = [{ name = each.key, containerPort = each.key == "web" ? 3000 : 8000, protocol = "tcp", appProtocol = "http" }]
      healthCheck = {
        command = local.health_checks[each.key], interval = 15, timeout = 5, retries = 3, startPeriod = 45
      }
  }) : "{}"))])
  tags = var.tags

  depends_on = [aws_iam_role_policy.execution, aws_iam_role_policy.secret_injection, aws_iam_role_policy.initialize_secret]
}
