locals {
  azs = { for index, az in var.availability_zones : tostring(index) => az }
  security_groups = {
    alb         = "Public application load balancer"
    web         = "Private TanStack Start tasks"
    api         = "Private FastAPI tasks and Service Connect server proxy"
    maintenance = "Private one-off database initialization and migration tasks"
    db          = "Isolated PostgreSQL database"
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(var.tags, { Name = var.name })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = var.name })
}

resource "aws_subnet" "public" {
  for_each = local.azs

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.value
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, tonumber(each.key))
  map_public_ip_on_launch = false
  tags                    = merge(var.tags, { Name = "${var.name}-public-${each.key}" })
}

resource "aws_subnet" "app" {
  for_each = local.azs

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.value
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 2 + tonumber(each.key))
  map_public_ip_on_launch = false
  tags                    = merge(var.tags, { Name = "${var.name}-app-${each.key}" })
}

resource "aws_subnet" "db" {
  for_each = local.azs

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.value
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 4 + tonumber(each.key))
  map_public_ip_on_launch = false
  tags                    = merge(var.tags, { Name = "${var.name}-db-${each.key}" })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "${var.name}-public" })
}

resource "aws_route" "public_default" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  for_each = local.azs

  subnet_id      = aws_subnet.public[each.key].id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = merge(var.tags, { Name = "${var.name}-nat" })
}

# One zonal NAT is intentional for this temporary demo. The other AZ pays
# cross-AZ transfer charges and depends on this AZ for outbound connectivity.
resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public["0"].id
  tags          = merge(var.tags, { Name = var.name })

  depends_on = [aws_internet_gateway.this, aws_route.public_default, aws_route_table_association.public]
}

resource "aws_route_table" "app" {
  for_each = local.azs

  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "${var.name}-app-${each.key}" })
}

resource "aws_route" "app_default" {
  for_each = local.azs

  route_table_id         = aws_route_table.app[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this.id
}

resource "aws_route_table_association" "app" {
  for_each = local.azs

  subnet_id      = aws_subnet.app[each.key].id
  route_table_id = aws_route_table.app[each.key].id
}

# No default route or NAT association is created for the database subnets.
resource "aws_route_table" "db" {
  for_each = local.azs

  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "${var.name}-db-${each.key}" })
}

resource "aws_route_table_association" "db" {
  for_each = local.azs

  subnet_id      = aws_subnet.db[each.key].id
  route_table_id = aws_route_table.db[each.key].id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for key in sort(keys(local.azs)) : aws_route_table.app[key].id]
  tags              = merge(var.tags, { Name = "${var.name}-s3" })
}

# Only standalone rule resources are used. AWS's default allow-all egress
# is removed by aws_security_group; each required path is declared below.
resource "aws_security_group" "this" {
  for_each = local.security_groups

  name_prefix = "${var.name}-${each.key}-"
  description = each.value
  vpc_id      = aws_vpc.this.id
  tags        = merge(var.tags, { Name = "${var.name}-${each.key}" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb" {
  for_each = toset(var.allowed_cidrs)

  security_group_id = aws_security_group.this["alb"].id
  description       = "Allowlisted browser access"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = var.listener_port
  to_port           = var.listener_port
  tags              = var.tags
}

locals {
  internal_paths = {
    alb_to_web        = { source = "alb", destination = "web", port = 3000 }
    web_to_api        = { source = "web", destination = "api", port = 8000 }
    api_to_db         = { source = "api", destination = "db", port = 5432 }
    maintenance_to_db = { source = "maintenance", destination = "db", port = 5432 }
  }
}

resource "aws_vpc_security_group_ingress_rule" "internal" {
  for_each = local.internal_paths

  security_group_id            = aws_security_group.this[each.value.destination].id
  referenced_security_group_id = aws_security_group.this[each.value.source].id
  description                  = replace(each.key, "_", " ")
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
  tags                         = var.tags
}

resource "aws_vpc_security_group_egress_rule" "internal" {
  for_each = local.internal_paths

  security_group_id            = aws_security_group.this[each.value.source].id
  referenced_security_group_id = aws_security_group.this[each.value.destination].id
  description                  = replace(each.key, "_", " ")
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
  tags                         = var.tags
}

resource "aws_vpc_security_group_egress_rule" "https" {
  for_each = toset(["web", "api", "maintenance"])

  security_group_id = aws_security_group.this[each.value].id
  description       = "HTTPS to ECR, S3, Logs, Secrets Manager and external APIs"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  tags              = var.tags
}
