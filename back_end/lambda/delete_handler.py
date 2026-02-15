"""
Delete Handler Lambda
Deletes S3 objects, drops Athena/Iceberg tables, and removes metadata.
"""
import json
import os
import time

import boto3
from botocore.exceptions import ClientError

s3_client = boto3.client("s3")
athena_client = boto3.client("athena")
glue_client = boto3.client("glue")
dynamodb = boto3.resource("dynamodb")

DATA_BUCKET = os.environ["DATA_BUCKET"]
METADATA_TABLE = os.environ["METADATA_TABLE"]
ATHENA_WORKGROUP = os.environ["ATHENA_WORKGROUP"]
ATHENA_OUTPUT = os.environ["ATHENA_OUTPUT"]
GLUE_DATABASE = os.environ["GLUE_DATABASE"]

metadata_table = dynamodb.Table(METADATA_TABLE)


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


def _delete_s3_prefix(prefix: str) -> int:
    """Delete all S3 objects under a prefix."""
    deleted_count = 0
    paginator = s3_client.get_paginator("list_objects_v2")

    for page in paginator.paginate(Bucket=DATA_BUCKET, Prefix=prefix):
        objects = page.get("Contents", [])
        if not objects:
            continue

        delete_request = {
            "Objects": [{"Key": obj["Key"]} for obj in objects]
        }
        s3_client.delete_objects(Bucket=DATA_BUCKET, Delete=delete_request)
        deleted_count += len(objects)

    return deleted_count


def _drop_iceberg_table(database: str, table: str) -> bool:
    """Drop an Iceberg table via Athena."""
    try:
        query = f'DROP TABLE IF EXISTS "{database}"."{table}" PURGE'
        response = athena_client.start_query_execution(
            QueryString=query,
            QueryExecutionContext={"Database": database},
            WorkGroup=ATHENA_WORKGROUP,
        )
        query_id = response["QueryExecutionId"]

        # Wait for completion
        for _ in range(30):
            result = athena_client.get_query_execution(QueryExecutionId=query_id)
            state = result["QueryExecution"]["Status"]["State"]
            if state == "SUCCEEDED":
                return True
            elif state in ("FAILED", "CANCELLED"):
                print(f"Drop table query {state}: {result['QueryExecution']['Status'].get('StateChangeReason')}")
                return False
            time.sleep(2)

        return False
    except Exception as e:
        print(f"Error dropping table: {e}")
        return False


def _delete_glue_table(database: str, table: str) -> bool:
    """Delete table from Glue catalog."""
    try:
        glue_client.delete_table(DatabaseName=database, Name=table)
        return True
    except glue_client.exceptions.EntityNotFoundException:
        return True
    except Exception as e:
        print(f"Error deleting Glue table: {e}")
        return False


def _delete_metadata_for_table(database: str, table: str) -> int:
    """Delete all metadata records for a specific table."""
    deleted = 0
    response = metadata_table.query(
        IndexName="table-name-index",
        KeyConditionExpression=boto3.dynamodb.conditions.Key("table_name").eq(table),
    )

    for item in response.get("Items", []):
        if item.get("database_name") == database:
            metadata_table.delete_item(
                Key={
                    "job_id": item["job_id"],
                    "start_time": item["start_time"],
                }
            )
            deleted += 1

    return deleted


def handler(event, context):
    """Main Lambda handler."""
    try:
        path_params = event.get("pathParameters", {}) or {}
        database = path_params.get("database", "")
        table = path_params.get("table", "")

        if not database or not table:
            return _cors_response(400, {"error": "database and table are required"})

        results = {
            "database": database,
            "table": table,
            "steps": [],
        }

        # 1. Delete S3 raw data
        raw_prefix = f"{database}/{table}/raw/"
        raw_deleted = _delete_s3_prefix(raw_prefix)
        results["steps"].append({
            "action": "delete_s3_raw",
            "prefix": raw_prefix,
            "deleted_objects": raw_deleted,
            "status": "SUCCESS",
        })

        # 2. Delete S3 warehouse data
        warehouse_prefix = f"warehouse/{database}/{table}/"
        warehouse_deleted = _delete_s3_prefix(warehouse_prefix)
        results["steps"].append({
            "action": "delete_s3_warehouse",
            "prefix": warehouse_prefix,
            "deleted_objects": warehouse_deleted,
            "status": "SUCCESS",
        })

        # 3. Drop Iceberg table via Athena
        # 3. Drop Iceberg table via Athena (Catalog Database)
        table_dropped = _drop_iceberg_table(GLUE_DATABASE, table)
        
        # 4. Ensure Glue table is removed (Catalog Database)
        # Even if Iceberg drop succeeded, we can double check or if it failed, force delete
        glue_deleted = _delete_glue_table(GLUE_DATABASE, table)
        
        results["steps"].append({
            "action": "delete_catalog_table",
            "iceberg_dropped": table_dropped,
            "glue_deleted": glue_deleted,
            "status": "SUCCESS" if (table_dropped or glue_deleted) else "FAILED",
        })

        # 5. Delete metadata records
        metadata_deleted = _delete_metadata_for_table(database, table)
        results["steps"].append({
            "action": "delete_metadata",
            "deleted_records": metadata_deleted,
            "status": "SUCCESS",
        })

        overall_success = all(s["status"] == "SUCCESS" for s in results["steps"])
        results["status"] = "SUCCESS" if overall_success else "PARTIAL"

        return _cors_response(200, results)

    except Exception as e:
        print(f"Delete error: {e}")
        return _cors_response(500, {"error": str(e)})
