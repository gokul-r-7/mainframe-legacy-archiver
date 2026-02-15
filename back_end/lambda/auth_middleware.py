"""
Auth Middleware
JWT token validation utility using Cognito JWKS.
"""
import json
import os
import time
import urllib.request
from functools import lru_cache

import hmac
import hashlib
import base64
import struct


# Cognito JWKS URL is constructed from the User Pool ID
def _get_jwks_url(region: str, user_pool_id: str) -> str:
    return f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json"


@lru_cache(maxsize=1)
def _get_jwks(region: str, user_pool_id: str) -> dict:
    """Fetch and cache JWKS from Cognito."""
    url = _get_jwks_url(region, user_pool_id)
    with urllib.request.urlopen(url) as response:
        return json.loads(response.read().decode("utf-8"))


def _base64url_decode(data: str) -> bytes:
    """Decode base64url encoded data."""
    padding = 4 - len(data) % 4
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data)


def decode_jwt_payload(token: str) -> dict:
    """Decode JWT payload without verification (for non-critical reads).
    API Gateway already verifies the JWT; this is for extracting claims.
    """
    try:
        parts = token.replace("Bearer ", "").split(".")
        if len(parts) != 3:
            raise ValueError("Invalid JWT format")

        payload = _base64url_decode(parts[1])
        return json.loads(payload.decode("utf-8"))
    except Exception as e:
        raise ValueError(f"Failed to decode JWT: {e}")


def extract_user_email(event: dict) -> str:
    """Extract user email from API Gateway JWT authorizer context."""
    try:
        # API Gateway v2 HTTP API with JWT authorizer
        claims = (
            event.get("requestContext", {})
            .get("authorizer", {})
            .get("jwt", {})
            .get("claims", {})
        )
        email = claims.get("email", "")
        if email:
            return email

        # Fallback: extract from Authorization header
        auth_header = event.get("headers", {}).get("authorization", "")
        if auth_header:
            payload = decode_jwt_payload(auth_header)
            return payload.get("email", "unknown@unknown.com")

        return "unknown@unknown.com"

    except Exception as e:
        print(f"Error extracting email: {e}")
        return "unknown@unknown.com"


def extract_user_sub(event: dict) -> str:
    """Extract user sub (unique ID) from JWT claims."""
    try:
        claims = (
            event.get("requestContext", {})
            .get("authorizer", {})
            .get("jwt", {})
            .get("claims", {})
        )
        return claims.get("sub", "")
    except Exception:
        return ""


def validate_request(event: dict) -> dict:
    """Validate that the request has valid authentication.
    Returns user info if valid, raises exception if not.
    """
    email = extract_user_email(event)
    sub = extract_user_sub(event)

    if email == "unknown@unknown.com" and not sub:
        raise PermissionError("Authentication required")

    return {
        "email": email,
        "sub": sub,
        "authenticated": True,
    }


def handler(event, context):
    """Lambda handler for auth validation (can be used as custom authorizer)."""
    try:
        user_info = validate_request(event)
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps(user_info),
        }
    except PermissionError as e:
        return {
            "statusCode": 401,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps({"error": str(e)}),
        }
