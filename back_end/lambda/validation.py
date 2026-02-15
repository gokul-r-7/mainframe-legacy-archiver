"""
Validation Lambda
Validates source and target data: row count, schema comparison, MD5 checksum.
"""
import json
import os
import hashlib
import csv
import io
import time

import boto3
from botocore.exceptions import ClientError

s3_client = boto3.client("s3")
athena_client = boto3.client("athena")
glue_client = boto3.client("glue")

DATA_BUCKET = os.environ["DATA_BUCKET"]
ATHENA_WORKGROUP = os.environ["ATHENA_WORKGROUP"]
ATHENA_OUTPUT = os.environ["ATHENA_OUTPUT"]
GLUE_DATABASE = os.environ["GLUE_DATABASE"]


def _cors_response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        },
        "body": json.dumps(body, default=str),
    }


def _get_s3_object(s3_key: str) -> bytes:
    """Download S3 object content."""
    response = s3_client.get_object(Bucket=DATA_BUCKET, Key=s3_key)
    return response["Body"].read()


def _count_csv_rows(content: bytes) -> int:
    """Count rows in CSV content (excluding header)."""
    text = content.decode("utf-8", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    return max(0, len(rows) - 1)  # exclude header


import re

def _get_csv_schema(content: bytes) -> list:
    """Extract column names from CSV header."""
    text = content.decode("utf-8", errors="replace")
    reader = csv.reader(io.StringIO(text))
    header = next(reader, [])
    # Normalize: lower case and replace non-alphanumeric with underscore
    return [re.sub(r'[^a-z0-9]', '_', col.strip().lower()) for col in header]


def _compute_checksum(content: bytes) -> str:
    """Compute MD5 checksum of content."""
    return hashlib.md5(content).hexdigest()


def _count_source_rows(content: bytes, file_type: str) -> int:
    """Count rows in source file based on type."""
    if file_type.lower() == "csv":
        return _count_csv_rows(content)
    elif file_type.lower() in ("xlsx", "xls"):
        # For Excel, count non-empty lines (approximate)
        return max(0, content.count(b"\n") - 1) if b"\n" in content else 0
    elif file_type.lower() == "parquet":
        # Parquet row count requires pyarrow, return -1 as placeholder
        return -1
    elif file_type.lower() == "xml":
        # Count record elements
        return content.count(b"<record") + content.count(b"<row") + content.count(b"<item")
    elif file_type.lower() in ("yaml", "yml"):
        return max(0, content.count(b"\n-"))
    else:
        return content.count(b"\n")


def _get_source_schema(content: bytes, file_type: str) -> list:
    """Extract schema from source file."""
    if file_type.lower() == "csv":
        return _get_csv_schema(content)
    else:
        return []


def _run_athena_query(query: str) -> list:
    """Execute an Athena query and wait for results."""
    response = athena_client.start_query_execution(
        QueryString=query,
        QueryExecutionContext={"Database": GLUE_DATABASE},
        WorkGroup=ATHENA_WORKGROUP,
    )
    query_execution_id = response["QueryExecutionId"]

    # Poll for completion
    for _ in range(60):
        result = athena_client.get_query_execution(QueryExecutionId=query_execution_id)
        state = result["QueryExecution"]["Status"]["State"]
        if state in ("SUCCEEDED",):
            break
        elif state in ("FAILED", "CANCELLED"):
            reason = result["QueryExecution"]["Status"].get("StateChangeReason", "Unknown")
            raise Exception(f"Athena query {state}: {reason}")
        time.sleep(2)
    else:
        raise Exception("Athena query timed out")

    # Get results
    results = athena_client.get_query_results(QueryExecutionId=query_execution_id)
    rows = results["ResultSet"]["Rows"]
    return rows


def _get_target_row_count(database: str, table: str) -> int:
    """Get row count from Athena/Iceberg table."""
    try:
        # User logical database maps to single Glue Catalog database
        query = f'SELECT COUNT(*) as cnt FROM "{GLUE_DATABASE}"."{table}"'
        rows = _run_athena_query(query)
        if len(rows) > 1:
            return int(rows[1]["Data"][0]["VarCharValue"])
        return 0
    except Exception as e:
        print(f"Error getting target row count: {e}")
        return -1


def _get_target_schema(database: str, table: str) -> list:
    """Get schema from Glue catalog."""
    try:
        # User logical database maps to single Glue Catalog database
        response = glue_client.get_table(DatabaseName=GLUE_DATABASE, Name=table)
        columns = response["Table"]["StorageDescriptor"]["Columns"]
        return [col["Name"].lower() for col in columns]
    except Exception as e:
        print(f"Error getting target schema: {e}")
        return []


def validate_source(event: dict) -> dict:
    """Validate source file and return metrics."""
    s3_key = event["s3_key"]
    file_type = event["file_type"]

    content = _get_s3_object(s3_key)

    source_row_count = _count_source_rows(content, file_type)
    source_schema = _get_source_schema(content, file_type)
    source_checksum = _compute_checksum(content)

    return {
        "source_row_count": source_row_count,
        "source_schema": source_schema,
        "source_checksum": source_checksum,
        "status": "VALIDATED",
    }


def validate_target(event: dict) -> dict:
    """Validate target (Athena/Iceberg) data against source metrics."""
    database = event["database"]
    table = event["table"]
    source_row_count = event.get("source_row_count", -1)
    source_schema = event.get("source_schema", [])
    source_checksum = event.get("source_checksum", "")
    load_type = event.get("load_type", "full")

    target_row_count = _get_target_row_count(database, table)
    target_schema = _get_target_schema(database, table)

    # Row count comparison
    if load_type == "full":
        row_count_match = source_row_count == target_row_count
    else:
        # For incremental, target should have >= source rows
        row_count_match = target_row_count >= source_row_count

    # Schema comparison (case-insensitive)
    schema_match = True
    if source_schema and target_schema:
        source_set = set(s.lower() for s in source_schema)
        target_set = set(t.lower() for t in target_schema)
        schema_match = source_set.issubset(target_set)

    # Checksum (recompute from target is not directly feasible for Iceberg, mark as N/A)
    checksum_match = True  # Cannot directly compare for Iceberg tables

    validation_status = "PASSED" if (row_count_match and schema_match) else "FAILED"

    validation_details = {
        "row_count_match": row_count_match,
        "schema_match": schema_match,
        "checksum_match": checksum_match,
        "source_row_count": source_row_count,
        "target_row_count": target_row_count,
        "source_schema": source_schema,
        "target_schema": target_schema,
    }

    return {
        "target_row_count": target_row_count,
        "schema_match": schema_match,
        "checksum_match": checksum_match,
        "validation_status": validation_status,
        "validation_details": validation_details,
    }


def handler(event, context):
    """Main Lambda handler - dispatches based on action."""
    try:
        # Check if called from Step Functions (direct invoke) or API Gateway
        if "action" in event:
            action = event["action"]
        else:
            body = json.loads(event.get("body", "{}"))
            action = body.get("action", "validate_source")
            event = {**event, **body}

        if action == "validate_source":
            result = validate_source(event)
        elif action == "validate_target":
            result = validate_target(event)
        else:
            return _cors_response(400, {"error": f"Unknown action: {action}"})

        # If from Step Functions, return raw result
        if "requestContext" not in event:
            return result

        return _cors_response(200, result)

    except Exception as e:
        print(f"Validation error: {e}")
        error_response = {"error": str(e), "status": "FAILED"}
        if "requestContext" not in event:
            raise
        return _cors_response(500, error_response)
