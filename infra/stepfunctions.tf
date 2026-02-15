# ------------------------------------------------------------------------------
# Step Functions – Archival Pipeline State Machine
# ------------------------------------------------------------------------------

resource "aws_sfn_state_machine" "archival_pipeline" {
  name     = "${local.name_prefix}-archival-pipeline"
  role_arn = aws_iam_role.sfn_exec.arn

  definition = jsonencode({
    Comment = "Data Archival Pipeline - Orchestrates validation, ETL, crawling, and notification"
    StartAt = "ValidateSource"
    States = {
      ValidateSource = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.validation.arn
          Payload = {
            "action"      = "validate_source"
            "job_id.$"    = "$.job_id"
            "s3_key.$"    = "$.s3_key"
            "file_type.$" = "$.file_type"
            "database.$"  = "$.database"
            "table.$"     = "$.table"
            "load_type.$" = "$.load_type"
            "email.$"     = "$.email"
          }
        }
        ResultPath = "$.validation_result"
        ResultSelector = {
          "source_row_count.$" = "$.Payload.source_row_count"
          "source_schema.$"    = "$.Payload.source_schema"
          "source_checksum.$"  = "$.Payload.source_checksum"
          "status.$"           = "$.Payload.status"
        }
        Next  = "RunGlueETL"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "LogFailure"
        }]
      }

      RunGlueETL = {
        Type     = "Task"
        Resource = "arn:aws:states:::glue:startJobRun.sync"
        Parameters = {
          JobName = aws_glue_job.iceberg_etl.name
          Arguments = {
            "--ETL_JOB_ID.$" = "$.job_id"
            "--S3_KEY.$"    = "$.s3_key"
            "--FILE_TYPE.$" = "$.file_type"
            "--DATABASE.$"  = "$.database"
            "--TABLE.$"     = "$.table"
            "--LOAD_TYPE.$" = "$.load_type"
          }
        }
        ResultPath = "$.glue_result"
        Next       = "ValidateTarget"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "LogFailure"
        }]
      }

      ValidateTarget = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.validation.arn
          Payload = {
            "action"            = "validate_target"
            "job_id.$"          = "$.job_id"
            "database.$"        = "$.database"
            "table.$"           = "$.table"
            "source_row_count.$" = "$.validation_result.source_row_count"
            "source_schema.$"   = "$.validation_result.source_schema"
            "source_checksum.$" = "$.validation_result.source_checksum"
            "load_type.$"       = "$.load_type"
          }
        }
        ResultPath = "$.target_validation"
        ResultSelector = {
          "target_row_count.$"  = "$.Payload.target_row_count"
          "schema_match.$"      = "$.Payload.schema_match"
          "checksum_match.$"    = "$.Payload.checksum_match"
          "validation_status.$" = "$.Payload.validation_status"
          "validation_details.$" = "$.Payload.validation_details"
        }
        Next  = "CheckValidationStatus"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "LogFailure"
        }]
      }

      CheckValidationStatus = {
        Type = "Choice"
        Choices = [{
          Variable     = "$.target_validation.validation_status"
          StringEquals = "FAILED"
          Next         = "SetValidationError"
        }]
        Default = "LogSuccess"
      }

      SetValidationError = {
        Type = "Pass"
        Result = {
          "Cause": "Validation Failed: Row count or schema mismatch"
          "Error": "ValidationFailure"
        }
        ResultPath = "$.error"
        Next = "LogValidationFailure"
      }

      LogValidationFailure = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.metadata_logger.arn
          Payload = {
            "action"       = "log_failure"
            "job_id.$"     = "$.job_id"
            "database.$"   = "$.database"
            "table.$"      = "$.table"
            "email.$"      = "$.email"
            "file_name.$"  = "$.s3_key"
            "start_time.$" = "$.start_time"
            "error"        = {
              "Cause" = "Validation Failed: Row count or schema mismatch"
              "Details.$" = "$.target_validation.validation_details"
            }
          }
        }
        ResultPath = "$.log_result"
        Next       = "NotifyFailure"
      }

      LogSuccess = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.metadata_logger.arn
          Payload = {
            "action"             = "log_success"
            "job_id.$"           = "$.job_id"
            "database.$"         = "$.database"
            "table.$"            = "$.table"
            "email.$"            = "$.email"
            "file_name.$"        = "$.s3_key"
            "start_time.$"       = "$.start_time"
            "validation_result.$" = "$.target_validation"
            "source_row_count.$" = "$.validation_result.source_row_count"
          }
        }
        ResultPath = "$.log_result"
        Next       = "NotifySuccess"
      }

      NotifySuccess = {
        Type     = "Task"
        Resource = "arn:aws:states:::sns:publish"
        Parameters = {
          TopicArn = aws_sns_topic.notifications.arn
          Subject  = "Data Archival Completed Successfully"
          "Message.$" = "States.Format('Job {} completed successfully. Database: {}, Table: {}, Rows: {}', $.job_id, $.database, $.table, $.validation_result.source_row_count)"
        }
        End = true
      }

      LogFailure = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.metadata_logger.arn
          Payload = {
            "action"       = "log_failure"
            "job_id.$"     = "$.job_id"
            "database.$"   = "$.database"
            "table.$"      = "$.table"
            "email.$"      = "$.email"
            "file_name.$"  = "$.s3_key"
            "start_time.$" = "$.start_time"
            "error.$"      = "$.error"
          }
        }
        ResultPath = "$.log_result"
        Next       = "NotifyFailure"
      }

      NotifyFailure = {
        Type     = "Task"
        Resource = "arn:aws:states:::sns:publish"
        Parameters = {
          TopicArn = aws_sns_topic.notifications.arn
          Subject  = "Data Archival FAILED"
          "Message.$" = "States.Format('Job {} FAILED. Database: {}, Table: {}. Error: {}', $.job_id, $.database, $.table, $.error)"
        }
        End = true
      }
    }
  })

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.sfn.arn}:*"
    include_execution_data = true
    level                  = "ERROR"
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "sfn" {
  name              = "/aws/states/${local.name_prefix}-archival-pipeline"
  retention_in_days = var.log_retention_days
}
