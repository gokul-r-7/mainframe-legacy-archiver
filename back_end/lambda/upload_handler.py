"""
Upload Handler Lambda
Generates presigned URLs for S3 upload and starts Step Functions execution.
"""
import json
import os
import uuid
import hashlib
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

s3_client = boto3.client("s3")
sfn_client = boto3.client("stepfunctions")
dynamodb = boto3.resource("dynamodb")

DATA_BUCKET = os.environ["DATA_BUCKET"]
STATE_MACHINE_ARN = os.environ["STATE_MACHINE_ARN"]
GLUE_DATABASE = os.environ["GLUE_DATABASE"]
METADATA_TABLE = os.environ["METADATA_TABLE"]
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


def _extract_email(event: dict) -> str:
    """Extract email from Cognito JWT claims."""
    try:
        claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
        return claims.get("email", "unknown@unknown.com")
    except (AttributeError, KeyError):
        return "unknown@unknown.com"


def _generate_presigned_url(s3_key: str, content_type: str = "application/octet-stream") -> str:
    """Generate a presigned URL for S3 PUT."""
    url = s3_client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": DATA_BUCKET,
            "Key": s3_key,
            "ContentType": content_type,
        },
        ExpiresIn=3600,
    )
    return url


def _start_pipeline(job_id: str, s3_key: str, file_type: str,
                     database: str, table: str, load_type: str, email: str) -> str:
    """Start the Step Functions archival pipeline."""
    start_time = datetime.now(timezone.utc).isoformat()
    
    # Log initial status
    try:
        table.put_item(Item={
            "job_id": job_id,
            "file_name": s3_key,
            "table_name": table,
            "database_name": database,
            "archived_by": email,
            "start_time": start_time,
            "status": "RUNNING",
            "validation_status": "PENDING"
        })
    except Exception as e:
        print(f"Failed to log initial status: {e}")

    input_payload = {
        "job_id": job_id,
        "s3_key": s3_key,
        "file_type": file_type,
        "database": database,
        "table": table,
        "load_type": load_type,
        "email": email,
        "start_time": start_time,
    }

    response = sfn_client.start_execution(
        stateMachineArn=STATE_MACHINE_ARN,
        name=f"{job_id}-{int(datetime.now(timezone.utc).timestamp())}",
        input=json.dumps(input_payload),
    )
    return response["executionArn"]


def handler(event, context):
    """Main Lambda handler."""
    try:
        http_method = event.get("requestContext", {}).get("http", {}).get("method", "POST")
        route_key = event.get("routeKey", "")

        # Handle presigned URL request
        if "presigned-url" in route_key:
            body = json.loads(event.get("body", "{}"))
            file_name = body.get("file_name", "unknown")
            file_type = body.get("file_type", "csv")
            database = body.get("database", "default_db")
            table = body.get("table", "default_table")

            # Build structured S3 key
            s3_key = f"{database}/{table}/raw/{file_name}"

            # Map file types to content types
            content_types = {
                "csv": "text/csv",
                "parquet": "application/octet-stream",
                "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "xls": "application/vnd.ms-excel",
                "xml": "application/xml",
                "yaml": "application/x-yaml",
                "yml": "application/x-yaml",
                "json": "application/json",
            }
            content_type = content_types.get(file_type.lower(), "application/octet-stream")

            presigned_url = _generate_presigned_url(s3_key, content_type)

            return _cors_response(200, {
                "presigned_url": presigned_url,
                "s3_key": s3_key,
                "bucket": DATA_BUCKET,
            })

        # Handle upload completion / pipeline trigger
        body = json.loads(event.get("body", "{}"))
        email = _extract_email(event)

        files = body.get("files", [])
        if not files:
            # Single file mode
            files = [{
                "s3_key": body.get("s3_key"),
                "file_type": body.get("file_type", "csv"),
                "file_name": body.get("file_name", "unknown"),
            }]

        database = body.get("database", "default_db")
        table = body.get("table", "default_table")
        load_type = body.get("load_type", "full")

        results = []
        for file_info in files:
            job_id = str(uuid.uuid4())
            s3_key = file_info.get("s3_key", "")
            file_type = file_info.get("file_type", "csv")

            execution_arn = _start_pipeline(
                job_id=job_id,
                s3_key=s3_key,
                file_type=file_type,
                database=database,
                table=table,
                load_type=load_type,
                email=email,
            )

            results.append({
                "job_id": job_id,
                "execution_arn": execution_arn,
                "s3_key": s3_key,
                "status": "RUNNING",
            })

        return _cors_response(200, {
            "message": f"Pipeline started for {len(results)} file(s)",
            "jobs": results,
        })

    except ClientError as e:
        print(f"AWS Error: {e}")
        return _cors_response(500, {"error": str(e)})
    except Exception as e:
        print(f"Error: {e}")
        return _cors_response(500, {"error": str(e)})
