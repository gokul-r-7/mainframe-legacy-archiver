"""
Metadata Logger Lambda
Logs job metadata to DynamoDB.
"""
import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")

METADATA_TABLE = os.environ["METADATA_TABLE"]
# NOTIFICATION_EMAIL and SNS_TOPIC_ARN are no longer used here, but kept in env for now if needed anywhere else
# or we can remove them from lambda.tf environment variables later.

table = dynamodb.Table(METADATA_TABLE)


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


def _convert_floats(obj):
    """Convert floats to Decimal for DynamoDB."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: _convert_floats(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_convert_floats(i) for i in obj]
    return obj


def _calculate_duration(start_time: str) -> str:
    """Calculate duration from start_time to now."""
    try:
        start = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
        end = datetime.now(timezone.utc)
        delta = end - start
        minutes = int(delta.total_seconds() // 60)
        seconds = int(delta.total_seconds() % 60)
        return f"{minutes}m {seconds}s"
    except (ValueError, TypeError):
        return "N/A"


def log_success(event: dict) -> dict:
    """Log successful job to DynamoDB."""
    job_id = event.get("job_id", str(uuid.uuid4()))
    database = event.get("database", "unknown")
    table_name = event.get("table", "unknown")
    email = event.get("email", "unknown")
    file_name = event.get("file_name", "unknown")
    start_time = event.get("start_time", datetime.now(timezone.utc).isoformat())
    end_time = datetime.now(timezone.utc).isoformat()
    duration = _calculate_duration(start_time)
    validation_result = event.get("validation_result", {})
    source_row_count = event.get("source_row_count", 0)

    item = _convert_floats({
        "job_id": job_id,
        "file_name": file_name,
        "table_name": table_name,
        "database_name": database,
        "archived_by": email,
        "start_time": start_time,
        "end_time": end_time,
        "duration": duration,
        "validation_status": validation_result.get("validation_status", "PASSED"),
        "source_row_count": source_row_count,
        "target_row_count": validation_result.get("target_row_count", 0),
        "schema_match": validation_result.get("schema_match", True),
        "checksum_match": validation_result.get("checksum_match", True),
        "error_message": "",
        "status": "SUCCESS",
    })

    table.put_item(Item=item)
    return {"status": "SUCCESS", "job_id": job_id}


def log_failure(event: dict) -> dict:
    """Log failed job to DynamoDB."""
    job_id = event.get("job_id", str(uuid.uuid4()))
    database = event.get("database", "unknown")
    table_name = event.get("table", "unknown")
    email = event.get("email", "unknown")
    file_name = event.get("file_name", "unknown")
    start_time = event.get("start_time", datetime.now(timezone.utc).isoformat())
    end_time = datetime.now(timezone.utc).isoformat()
    duration = _calculate_duration(start_time)
    error = event.get("error", {})
    error_message = str(error.get("Cause", error.get("Error", str(error))))

    item = _convert_floats({
        "job_id": job_id,
        "file_name": file_name,
        "table_name": table_name,
        "database_name": database,
        "archived_by": email,
        "start_time": start_time,
        "end_time": end_time,
        "duration": duration,
        "validation_status": "FAILED",
        "error_message": error_message[:1000],
        "status": "FAILED",
    })

    table.put_item(Item=item)
    return {"status": "FAILED", "job_id": job_id, "error": error_message}


def get_metadata(event: dict) -> dict:
    """Query metadata logs from DynamoDB."""
    params = event.get("queryStringParameters", {}) or {}
    email = params.get("email")
    limit = int(params.get("limit", "50"))

    if email:
        response = table.query(
            IndexName="archived-by-index",
            KeyConditionExpression=boto3.dynamodb.conditions.Key("archived_by").eq(email),
            ScanIndexForward=False,
            Limit=limit,
        )
    else:
        response = table.scan(Limit=limit)

    items = response.get("Items", [])
    # Convert Decimal to float for JSON serialization
    for item in items:
        for key, value in item.items():
            if isinstance(value, Decimal):
                item[key] = float(value)

    return items


def delete_metadata(event: dict) -> dict:
    """Delete a metadata record from DynamoDB."""
    path_params = event.get("pathParameters", {}) or {}
    job_id = path_params.get("jobId", "")

    if not job_id:
        return {"error": "job_id is required"}

    # First, get the item to find the sort key
    response = table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("job_id").eq(job_id),
    )
    items = response.get("Items", [])

    deleted = 0
    for item in items:
        table.delete_item(
            Key={
                "job_id": item["job_id"],
                "start_time": item["start_time"],
            }
        )
        deleted += 1

    return {"message": f"Deleted {deleted} record(s)", "job_id": job_id}


def handler(event, context):
    """Main Lambda handler."""
    try:
        # Step Functions invocation (direct)
        if "action" in event and "requestContext" not in event:
            action = event["action"]
            if action == "log_success":
                return log_success(event)
            elif action == "log_failure":
                return log_failure(event)

        # API Gateway invocation
        route_key = event.get("routeKey", "")
        http_method = event.get("requestContext", {}).get("http", {}).get("method", "GET")

        if http_method == "GET" or "GET" in route_key:
            items = get_metadata(event)
            return _cors_response(200, {"items": items, "count": len(items)})
        elif http_method == "DELETE" or "DELETE" in route_key:
            result = delete_metadata(event)
            return _cors_response(200, result)
        elif http_method == "POST":
            body = json.loads(event.get("body", "{}"))
            action = body.get("action", "log_success")
            event_data = {**event, **body}
            if action == "log_success":
                result = log_success(event_data)
            else:
                result = log_failure(event_data)
            return _cors_response(200, result)

        return _cors_response(400, {"error": "Unsupported method"})

    except Exception as e:
        print(f"Metadata logger error: {e}")
        if "requestContext" not in event:
            raise
        return _cors_response(500, {"error": str(e)})
