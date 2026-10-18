output "url" {
  value       = var.certificate_arn == null ? "http://${aws_lb.this.dns_name}" : "https://${var.public_hostname}"
  description = "ALB address. HTTPS clients must use the hostname covered by the existing ACM certificate."
}
output "alb_dns_name" { value = aws_lb.this.dns_name }
output "alb_zone_id" { value = aws_lb.this.zone_id }
output "cluster_name" { value = aws_ecs_cluster.this.name }
output "service_names" {
  value = { web = try(aws_ecs_service.web[0].name, null), api = try(aws_ecs_service.api[0].name, null) }
}
output "namespace_arn" { value = aws_service_discovery_http_namespace.this.arn }
output "task_definition_arns" {
  value = { for name, definition in aws_ecs_task_definition.this : name => definition.arn }
}
output "maintenance_network_configuration" {
  description = "JSON accepted by aws ecs run-task --network-configuration; contains no credentials."
  value = jsonencode({ awsvpcConfiguration = {
    subnets = var.private_subnet_ids, securityGroups = [var.security_group_ids.maintenance], assignPublicIp = "DISABLED"
  } })
}
