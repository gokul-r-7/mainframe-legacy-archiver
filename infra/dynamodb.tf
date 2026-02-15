# ------------------------------------------------------------------------------
# DynamoDB – Metadata Logs Table
# ------------------------------------------------------------------------------

resource "aws_dynamodb_table" "metadata_logs" {
  name         = "${local.name_prefix}-metadata-logs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "job_id"
  range_key    = "start_time"

  attribute {
    name = "job_id"
    type = "S"
  }

  attribute {
    name = "start_time"
    type = "S"
  }

  attribute {
    name = "archived_by"
    type = "S"
  }

  attribute {
    name = "table_name"
    type = "S"
  }

  global_secondary_index {
    name            = "archived-by-index"
    hash_key        = "archived_by"
    range_key       = "start_time"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "table-name-index"
    hash_key        = "table_name"
    range_key       = "start_time"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(local.common_tags, { Purpose = "metadata-logs" })
}
