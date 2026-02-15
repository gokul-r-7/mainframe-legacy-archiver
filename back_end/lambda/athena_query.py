"""
Athena Query Lambda
Executes ad-hoc Athena queries and returns paginated results.
"""
import json
import os
import time

import boto3
from botocore.exceptions import ClientError

athena_client = boto3.client("athena")

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


def _execute_query(query: str, database: str = None) -> dict:
    """Execute an Athena query and return results."""
    db = database or GLUE_DATABASE

    # Start query execution
    start_params = {
        "QueryString": query,
        "QueryExecutionContext": {"Database": db},
        "WorkGroup": ATHENA_WORKGROUP,
    }

    response = athena_client.start_query_execution(**start_params)
    query_execution_id = response["QueryExecutionId"]

    # Poll for completion (max 120 seconds)
    for attempt in range(60):
        result = athena_client.get_query_execution(QueryExecutionId=query_execution_id)
        state = result["QueryExecution"]["Status"]["State"]

        if state == "SUCCEEDED":
            break
        elif state in ("FAILED", "CANCELLED"):
            reason = result["QueryExecution"]["Status"].get(
                "StateChangeReason", "Query execution failed"
            )
            return {
                "status": state,
                "error": reason,
                "query_execution_id": query_execution_id,
            }

        time.sleep(2)
    else:
        return {
            "status": "TIMEOUT",
            "error": "Query timed out after 120 seconds",
            "query_execution_id": query_execution_id,
        }

    # Get query results
    results = athena_client.get_query_results(
        QueryExecutionId=query_execution_id, MaxResults=1000
    )

    # Parse column info
    column_info = results["ResultSet"]["ResultSetMetadata"]["ColumnInfo"]
    columns = [col["Name"] for col in column_info]
    column_types = [col["Type"] for col in column_info]

    # Parse rows
    rows = results["ResultSet"]["Rows"]
    data = []

    for i, row in enumerate(rows):
        if i == 0:
            continue  # Skip header row
        record = {}
        for j, field in enumerate(row["Data"]):
            value = field.get("VarCharValue", "")
            record[columns[j]] = value
        data.append(record)

    # Statistics
    stats = result["QueryExecution"].get("Statistics", {})

    return {
        "status": "SUCCEEDED",
        "query_execution_id": query_execution_id,
        "columns": columns,
        "column_types": column_types,
        "data": data,
        "row_count": len(data),
        "statistics": {
            "data_scanned_bytes": stats.get("DataScannedInBytes", 0),
            "execution_time_ms": stats.get("EngineExecutionTimeInMillis", 0),
        },
    }


def _list_tables(database: str = None) -> dict:
    """List all tables in the Glue database."""
    db = database or GLUE_DATABASE
    query = f"SHOW TABLES IN \"{db}\""
    return _execute_query(query, db)


def handler(event, context):
    """Main Lambda handler."""
    try:
        body = json.loads(event.get("body", "{}"))

        action = body.get("action", "query")
        query = body.get("query", "")
        database = body.get("database", GLUE_DATABASE)

        if action == "list_tables":
            # Always list from the managed Glue Catalog database
            result = _list_tables(GLUE_DATABASE)
            return _cors_response(200, result)

        if not query:
            return _cors_response(400, {"error": "Query is required"})

        # Security: basic SQL injection prevention
        dangerous_keywords = ["DROP DATABASE", "DROP SCHEMA", "CREATE USER", "GRANT"]
        query_upper = query.upper().strip()
        for keyword in dangerous_keywords:
            if keyword in query_upper:
                return _cors_response(400, {
                    "error": f"Dangerous operation detected: {keyword}"
                })

        result = _execute_query(query, database)

        if result["status"] != "SUCCEEDED":
            return _cors_response(400, result)

        return _cors_response(200, result)

    except ClientError as e:
        print(f"Athena error: {e}")
        return _cors_response(500, {"error": str(e)})
    except Exception as e:
        print(f"Error: {e}")
        return _cors_response(500, {"error": str(e)})
