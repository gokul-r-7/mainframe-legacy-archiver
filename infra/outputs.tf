output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = aws_apigatewayv2_stage.main.invoke_url
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  description = "Cognito App Client ID"
  value       = aws_cognito_user_pool_client.main.id
}

output "cognito_domain" {
  description = "Cognito hosted UI domain"
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "data_bucket_name" {
  description = "S3 data lake bucket name"
  value       = aws_s3_bucket.data_lake.id
}

output "athena_workgroup" {
  description = "Athena workgroup name"
  value       = aws_athena_workgroup.main.name
}

output "glue_database" {
  description = "Glue catalog database name"
  value       = aws_glue_catalog_database.main.name
}

output "dynamodb_table" {
  description = "DynamoDB metadata table name"
  value       = aws_dynamodb_table.metadata_logs.name
}

output "frontend_bucket_name" {
  description = "Frontend S3 bucket name"
  value       = aws_s3_bucket.frontend.id
}

output "frontend_url" {
  description = "Frontend CloudFront URL (HTTPS)"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}
