# ------------------------------------------------------------------------------
# AWS Glue – Database, Job, Crawler
# ------------------------------------------------------------------------------

resource "aws_glue_catalog_database" "main" {
  name = replace("${local.name_prefix}_db", "-", "_")

  description = "Data archival platform catalog database"
}

resource "aws_glue_job" "iceberg_etl" {
  name     = "${local.name_prefix}-iceberg-etl"
  role_arn = aws_iam_role.glue_exec.arn

  command {
    name            = "glueetl"
    script_location = "s3://${aws_s3_bucket.glue_scripts.id}/scripts/iceberg_etl_job.py"
    python_version  = "3"
  }

  default_arguments = {
    "--job-language"                     = "python"
    "--job-bookmark-option"              = "job-bookmark-enable"
    "--enable-metrics"                   = "true"
    "--enable-continuous-cloudwatch-log" = "true"
    "--enable-spark-ui"                  = "true"
    "--spark-event-logs-path"            = "s3://${aws_s3_bucket.glue_scripts.id}/spark-logs/"
    "--datalake-formats"                 = "iceberg"
    "--conf"                             = "spark.sql.extensions=org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions --conf spark.sql.catalog.glue_catalog=org.apache.iceberg.spark.SparkCatalog --conf spark.sql.catalog.glue_catalog.catalog-impl=org.apache.iceberg.aws.glue.GlueCatalog --conf spark.sql.catalog.glue_catalog.warehouse=s3://${aws_s3_bucket.data_lake.id}/warehouse/"
    "--DATA_BUCKET"                      = aws_s3_bucket.data_lake.id
    "--GLUE_DATABASE"                    = aws_glue_catalog_database.main.name
    "--REGION"                           = var.aws_region
  }

  glue_version      = "4.0"
  worker_type       = var.glue_worker_type
  number_of_workers = var.glue_number_of_workers
  timeout           = 60

  execution_property {
    max_concurrent_runs = 5
  }

  tags = local.common_tags
}


