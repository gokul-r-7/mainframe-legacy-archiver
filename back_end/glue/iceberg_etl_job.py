"""
Iceberg ETL Job (PySpark)
Reads flat files from S3, dynamically infers schema, and writes to Athena Iceberg tables.
Supports: CSV, Parquet, Excel, XML, YAML
Modes: append (incremental), overwrite (full load)
"""
import sys
import json

from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from awsglue.context import GlueContext
from awsglue.job import Job
from pyspark.context import SparkContext
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, lit, current_timestamp, input_file_name
from pyspark.sql.types import StringType


# ─── Initialize Glue Context ───────────────────────────────────────────────
args = getResolvedOptions(sys.argv, [
    "JOB_NAME",
    "ETL_JOB_ID",
    "S3_KEY",
    "FILE_TYPE",
    "DATABASE",
    "TABLE",
    "LOAD_TYPE",
    "DATA_BUCKET",
    "GLUE_DATABASE",
    "REGION",
])

sc = SparkContext()
glue_context = GlueContext(sc)
spark = glue_context.spark_session
job = Job(glue_context)
job.init(args["JOB_NAME"], args)

# ─── Configuration ──────────────────────────────────────────────────────────
JOB_ID = args["ETL_JOB_ID"]
S3_KEY = args["S3_KEY"]
FILE_TYPE = args["FILE_TYPE"].lower()
DATABASE = args["DATABASE"]
TABLE = args["TABLE"]
LOAD_TYPE = args["LOAD_TYPE"].lower()
DATA_BUCKET = args["DATA_BUCKET"]
GLUE_DATABASE = args["GLUE_DATABASE"]
REGION = args["REGION"]

S3_INPUT_PATH = f"s3://{DATA_BUCKET}/{S3_KEY}"
WAREHOUSE_PATH = f"s3://{DATA_BUCKET}/warehouse/"
ICEBERG_TABLE = f"glue_catalog.{GLUE_DATABASE}.{TABLE}"



def read_source_data(file_type: str, s3_path: str):
    """Read source data based on file type with dynamic schema inference."""
    print(f"Reading {file_type} from {s3_path}")

    if file_type == "csv":
        df = (
            spark.read
            .option("header", "true")
            .option("inferSchema", "true")
            .option("multiLine", "true")
            .option("escape", '"')
            .option("mode", "PERMISSIVE")
            .csv(s3_path)
        )

    elif file_type == "parquet":
        df = spark.read.parquet(s3_path)

    elif file_type in ("xlsx", "xls", "excel"):
        # Use Spark Excel reader
        df = (
            spark.read
            .format("com.crealytics.spark.excel")
            .option("header", "true")
            .option("inferSchema", "true")
            .option("dataAddress", "'Sheet1'!A1")
            .load(s3_path)
        )

    elif file_type == "xml":
        df = (
            spark.read
            .format("com.databricks.spark.xml")
            .option("rowTag", "record")
            .option("inferSchema", "true")
            .load(s3_path)
        )

    elif file_type in ("yaml", "yml"):
        # Read YAML as text, parse into DataFrame
        raw_text = spark.sparkContext.wholeTextFiles(s3_path).collect()
        if raw_text:
            import yaml
            content = raw_text[0][1]
            data = yaml.safe_load(content)

            if isinstance(data, list):
                df = spark.createDataFrame(data)
            elif isinstance(data, dict):
                # Try to find list values
                for key, value in data.items():
                    if isinstance(value, list) and len(value) > 0:
                        df = spark.createDataFrame(value)
                        break
                else:
                    df = spark.createDataFrame([data])
            else:
                raise ValueError(f"Unsupported YAML structure: {type(data)}")
        else:
            raise ValueError("No YAML content found")

    elif file_type == "json":
        df = (
            spark.read
            .option("multiLine", "true")
            .option("inferSchema", "true")
            .json(s3_path)
        )

    else:
        raise ValueError(f"Unsupported file type: {file_type}")

    return df


def sanitize_column_names(df):
    """Sanitize column names for Iceberg compatibility."""
    for old_name in df.columns:
        new_name = (
            old_name.strip()
            .lower()
            .replace(" ", "_")
            .replace("-", "_")
            .replace(".", "_")
            .replace("(", "")
            .replace(")", "")
            .replace("/", "_")
            .replace("\\", "_")
        )
        if new_name != old_name:
            df = df.withColumnRenamed(old_name, new_name)
    return df


def add_audit_columns(df, job_id: str):
    """Add audit/metadata columns to the DataFrame."""
    df = df.withColumn("_etl_job_id", lit(job_id))
    df = df.withColumn("_etl_timestamp", current_timestamp())
    df = df.withColumn("_source_file", lit(S3_KEY))
    return df


def create_iceberg_table(df, table_name: str):
    """Create an Iceberg table from DataFrame schema if it doesn't exist."""
    try:
        spark.sql(f"DESCRIBE TABLE {table_name}")
        print(f"Table {table_name} already exists")
    except Exception:
        print(f"Creating Iceberg table: {table_name}")
        # Create table using DataFrame schema
        df.writeTo(table_name).using("iceberg").create()
        print(f"Table {table_name} created successfully")


def write_to_iceberg(df, table_name: str, load_type: str):
    """Write DataFrame to Iceberg table."""
    row_count = df.count()
    print(f"Writing {row_count} rows to {table_name} (mode: {load_type})")

    if load_type == "full":
        # Overwrite all data
        try:
            spark.sql(f"DESCRIBE TABLE {table_name}")
            df.writeTo(table_name).overwritePartitions()
        except Exception:
            df.writeTo(table_name).using("iceberg").create()
    else:
        # Append (incremental)
        try:
            spark.sql(f"DESCRIBE TABLE {table_name}")
            df.writeTo(table_name).append()
        except Exception:
            df.writeTo(table_name).using("iceberg").create()

    print(f"Successfully wrote {row_count} rows to {table_name}")
    return row_count


# ─── Main ETL Pipeline ─────────────────────────────────────────────────────
try:
    print("=" * 60)
    print(f"Starting ETL Job: {JOB_ID}")
    print(f"Source: {S3_INPUT_PATH}")
    print(f"File Type: {FILE_TYPE}")
    print(f"Target: {ICEBERG_TABLE}")
    print(f"Load Type: {LOAD_TYPE}")
    print("=" * 60)

    # 1. Read source data
    source_df = read_source_data(FILE_TYPE, S3_INPUT_PATH)
    print(f"Source schema: {source_df.schema.simpleString()}")
    print(f"Source row count: {source_df.count()}")

    # 2. Sanitize column names
    clean_df = sanitize_column_names(source_df)

    # 3. Add audit columns
    audit_df = add_audit_columns(clean_df, JOB_ID)

    # 4. Write to Iceberg
    rows_written = write_to_iceberg(audit_df, ICEBERG_TABLE, LOAD_TYPE)

    print("=" * 60)
    print(f"ETL Job {JOB_ID} completed successfully")
    print(f"Rows written: {rows_written}")
    print("=" * 60)

except Exception as e:
    print(f"ETL Job {JOB_ID} FAILED: {str(e)}")
    import traceback
    traceback.print_exc()
    raise

finally:
    job.commit()
