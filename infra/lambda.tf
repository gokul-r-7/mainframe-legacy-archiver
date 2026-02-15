# ------------------------------------------------------------------------------
# Lambda Functions
# ------------------------------------------------------------------------------

# --- Lambda Layer for shared dependencies ---
resource "aws_lambda_layer_version" "deps" {
  filename            = "${path.module}/lambda_layer.zip"
  layer_name          = "${local.name_prefix}-deps"
  compatible_runtimes = ["python3.11"]
  description         = "Shared dependencies for Lambda functions"
}

# --- Package Lambda code ---
data "archive_file" "lambda_code" {
  type        = "zip"
  source_dir  = "${path.module}/../back_end/lambda"
  output_path = "${path.module}/lambda_code.zip"
}

# --- Upload Handler ---
resource "aws_lambda_function" "upload_handler" {
  filename         = data.archive_file.lambda_code.output_path
  source_code_hash = data.archive_file.lambda_code.output_base64sha256
  function_name    = "${local.name_prefix}-upload-handler"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "upload_handler.handler"
  runtime          = "python3.11"
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory_size

  layers = [aws_lambda_layer_version.deps.arn]

  environment {
    variables = {
      DATA_BUCKET          = aws_s3_bucket.data_lake.id
      METADATA_TABLE       = aws_dynamodb_table.metadata_logs.name
      STATE_MACHINE_ARN    = aws_sfn_state_machine.archival_pipeline.arn
      GLUE_DATABASE        = aws_glue_catalog_database.main.name
      REGION               = var.aws_region
    }
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "upload_handler" {
  name              = "/aws/lambda/${aws_lambda_function.upload_handler.function_name}"
  retention_in_days = var.log_retention_days
}

# --- Validation Handler ---
resource "aws_lambda_function" "validation" {
  filename         = data.archive_file.lambda_code.output_path
  source_code_hash = data.archive_file.lambda_code.output_base64sha256
  function_name    = "${local.name_prefix}-validation"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "validation.handler"
  runtime          = "python3.11"
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory_size

  layers = [aws_lambda_layer_version.deps.arn]

  environment {
    variables = {
      DATA_BUCKET     = aws_s3_bucket.data_lake.id
      ATHENA_WORKGROUP = aws_athena_workgroup.main.name
      ATHENA_OUTPUT    = "s3://${aws_s3_bucket.athena_results.id}/results/"
      GLUE_DATABASE    = aws_glue_catalog_database.main.name
      REGION           = var.aws_region
    }
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "validation" {
  name              = "/aws/lambda/${aws_lambda_function.validation.function_name}"
  retention_in_days = var.log_retention_days
}

# --- Metadata Logger ---
resource "aws_lambda_function" "metadata_logger" {
  filename         = data.archive_file.lambda_code.output_path
  source_code_hash = data.archive_file.lambda_code.output_base64sha256
  function_name    = "${local.name_prefix}-metadata-logger"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "metadata_logger.handler"
  runtime          = "python3.11"
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory_size

  layers = [aws_lambda_layer_version.deps.arn]

  environment {
    variables = {
      METADATA_TABLE     = aws_dynamodb_table.metadata_logs.name
      NOTIFICATION_EMAIL = var.notification_email
      SNS_TOPIC_ARN      = aws_sns_topic.notifications.arn
      REGION             = var.aws_region
    }
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "metadata_logger" {
  name              = "/aws/lambda/${aws_lambda_function.metadata_logger.function_name}"
  retention_in_days = var.log_retention_days
}

# --- Athena Query Handler ---
resource "aws_lambda_function" "athena_query" {
  filename         = data.archive_file.lambda_code.output_path
  source_code_hash = data.archive_file.lambda_code.output_base64sha256
  function_name    = "${local.name_prefix}-athena-query"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "athena_query.handler"
  runtime          = "python3.11"
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory_size

  layers = [aws_lambda_layer_version.deps.arn]

  environment {
    variables = {
      ATHENA_WORKGROUP = aws_athena_workgroup.main.name
      ATHENA_OUTPUT    = "s3://${aws_s3_bucket.athena_results.id}/results/"
      GLUE_DATABASE    = aws_glue_catalog_database.main.name
      REGION           = var.aws_region
    }
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "athena_query" {
  name              = "/aws/lambda/${aws_lambda_function.athena_query.function_name}"
  retention_in_days = var.log_retention_days
}

# --- Delete Handler ---
resource "aws_lambda_function" "delete_handler" {
  filename         = data.archive_file.lambda_code.output_path
  source_code_hash = data.archive_file.lambda_code.output_base64sha256
  function_name    = "${local.name_prefix}-delete-handler"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "delete_handler.handler"
  runtime          = "python3.11"
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory_size

  layers = [aws_lambda_layer_version.deps.arn]

  environment {
    variables = {
      DATA_BUCKET      = aws_s3_bucket.data_lake.id
      METADATA_TABLE   = aws_dynamodb_table.metadata_logs.name
      ATHENA_WORKGROUP = aws_athena_workgroup.main.name
      ATHENA_OUTPUT    = "s3://${aws_s3_bucket.athena_results.id}/results/"
      GLUE_DATABASE    = aws_glue_catalog_database.main.name
      REGION           = var.aws_region
    }
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "delete_handler" {
  name              = "/aws/lambda/${aws_lambda_function.delete_handler.function_name}"
  retention_in_days = var.log_retention_days
}
