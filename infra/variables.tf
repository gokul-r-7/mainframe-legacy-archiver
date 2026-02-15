variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use"
  type        = string
  default     = "default"
}

variable "project_name" {
  description = "Project name used as prefix for all resources"
  type        = string
  default     = "data-archival-platform"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "dev"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "notification_email" {
  description = "Email address for SES/SNS notifications"
  type        = string
}

variable "glue_worker_type" {
  description = "Glue job worker type"
  type        = string
  default     = "G.1X"
}

variable "glue_number_of_workers" {
  description = "Number of Glue workers"
  type        = number
  default     = 2
}

variable "lambda_memory_size" {
  description = "Lambda function memory in MB"
  type        = number
  default     = 256
}

variable "lambda_timeout" {
  description = "Lambda function timeout in seconds"
  type        = number
  default     = 300
}

variable "frontend_container_port" {
  description = "Port exposed by the frontend container"
  type        = number
  default     = 80
}

variable "frontend_cpu" {
  description = "CPU units for ECS Fargate task"
  type        = number
  default     = 256
}

variable "frontend_memory" {
  description = "Memory in MB for ECS Fargate task"
  type        = number
  default     = 512
}

variable "enable_deletion_protection" {
  description = "Enable deletion protection on critical resources"
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 14
}
