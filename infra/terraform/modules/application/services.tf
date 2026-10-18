resource "aws_ecs_service" "api" {
  count                              = var.enable_api_service ? 1 : 0
  name                               = "api"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.this["api"].arn
  desired_count                      = var.service_sizes.api.min_capacity
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  wait_for_steady_state              = true
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.security_group_ids.api]
    assign_public_ip = false
  }
  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.this.arn
    log_configuration {
      log_driver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.this["api-proxy"].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "proxy"
      }
    }
    service {
      port_name      = "api"
      discovery_name = "api"
      client_alias {
        dns_name = "api"
        port     = 8000
      }
      timeout {
        idle_timeout_seconds        = 120
        per_request_timeout_seconds = 120
      }
    }
  }
  tags = var.tags
  lifecycle {
    ignore_changes = [desired_count]
  }
}

resource "aws_ecs_service" "web" {
  count                              = var.enable_web_service ? 1 : 0
  name                               = "web"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.this["web"].arn
  desired_count                      = var.service_sizes.web.min_capacity
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60
  wait_for_steady_state              = true
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.security_group_ids.web]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }
  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.this.arn
    log_configuration {
      log_driver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.this["web-proxy"].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "proxy"
      }
    }
  }
  tags = var.tags
  lifecycle {
    ignore_changes = [desired_count]
    precondition {
      condition     = var.enable_api_service
      error_message = "Start the API endpoint before creating the Web Service Connect client."
    }
  }
  depends_on = [aws_ecs_service.api, aws_lb_listener.web]
}

locals {
  scaling_services = {
    for name, enabled in { web = var.enable_web_service, api = var.enable_api_service } :
    name => var.service_sizes[name] if enabled && var.enable_auto_scaling
  }
}

resource "aws_appautoscaling_target" "this" {
  for_each           = local.scaling_services
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${each.key}"
  min_capacity       = each.value.min_capacity
  max_capacity       = each.value.max_capacity
  tags               = var.tags
  depends_on         = [aws_ecs_service.web, aws_ecs_service.api]
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each           = local.scaling_services
  name               = "${var.name}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.this[each.key].resource_id
  service_namespace  = aws_appautoscaling_target.this[each.key].service_namespace
  scalable_dimension = aws_appautoscaling_target.this[each.key].scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value       = each.value.cpu_target
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
