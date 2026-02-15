# ------------------------------------------------------------------------------
# S3 Buckets – Data Lake, Athena Results, Glue Scripts
# ------------------------------------------------------------------------------

resource "aws_s3_bucket" "data_lake" {
  bucket        = "${local.name_prefix}-data-lake-${local.suffix}"
  force_destroy = !var.enable_deletion_protection

  tags = merge(local.common_tags, { Purpose = "data-lake" })
}

resource "aws_s3_bucket_versioning" "data_lake" {
  bucket = aws_s3_bucket.data_lake.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data_lake" {
  bucket = aws_s3_bucket.data_lake.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "data_lake" {
  bucket                  = aws_s3_bucket.data_lake.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "data_lake" {
  bucket = aws_s3_bucket.data_lake.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# --- Athena Results Bucket ---
resource "aws_s3_bucket" "athena_results" {
  bucket        = "${local.name_prefix}-athena-results-${local.suffix}"
  force_destroy = true

  tags = merge(local.common_tags, { Purpose = "athena-query-results" })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "athena_results" {
  bucket                  = aws_s3_bucket.athena_results.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  rule {
    id     = "expire-results"
    status = "Enabled"

    expiration {
      days = 7
    }
  }
}

# --- Glue Scripts Bucket ---
resource "aws_s3_bucket" "glue_scripts" {
  bucket        = "${local.name_prefix}-glue-scripts-${local.suffix}"
  force_destroy = true

  tags = merge(local.common_tags, { Purpose = "glue-etl-scripts" })
}

resource "aws_s3_bucket_public_access_block" "glue_scripts" {
  bucket                  = aws_s3_bucket.glue_scripts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Upload Glue ETL script to S3
resource "aws_s3_object" "glue_etl_script" {
  bucket = aws_s3_bucket.glue_scripts.id
  key    = "scripts/iceberg_etl_job.py"
  source = "${path.module}/../back_end/glue/iceberg_etl_job.py"
  etag   = filemd5("${path.module}/../back_end/glue/iceberg_etl_job.py")
}

# --- Frontend Bucket ---
resource "aws_s3_bucket" "frontend" {
  bucket        = "${local.name_prefix}-frontend-${local.suffix}"
  force_destroy = true

  tags = merge(local.common_tags, { Purpose = "frontend-hosting" })
}

resource "aws_s3_bucket_website_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html"
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.frontend.arn}/*"
      },
    ]
  })
  
  depends_on = [aws_s3_bucket_public_access_block.frontend]
}
