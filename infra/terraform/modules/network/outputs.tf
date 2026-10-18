output "vpc_id" {
  description = "Environment VPC ID."
  value       = aws_vpc.this.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs in the supplied AZ order, for the internet-facing ALB."
  value       = [for key in sort(keys(local.azs)) : aws_subnet.public[key].id]

  depends_on = [aws_route.public_default, aws_route_table_association.public]
}

output "private_subnet_ids" {
  description = "Private application subnet IDs in the supplied AZ order."
  value       = [for key in sort(keys(local.azs)) : aws_subnet.app[key].id]

  depends_on = [aws_route.app_default, aws_route_table_association.app, aws_vpc_endpoint.s3]
}

output "db_subnet_ids" {
  description = "Isolated database subnet IDs in the supplied AZ order."
  value       = [for key in sort(keys(local.azs)) : aws_subnet.db[key].id]

  depends_on = [aws_route_table_association.db]
}

output "security_group_ids" {
  description = "Separate ALB, Web, API, maintenance and database security groups."
  value       = { for name, group in aws_security_group.this : name => group.id }

  depends_on = [
    aws_vpc_security_group_ingress_rule.alb,
    aws_vpc_security_group_ingress_rule.internal,
    aws_vpc_security_group_egress_rule.internal,
    aws_vpc_security_group_egress_rule.https,
  ]
}
