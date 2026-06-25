import asyncio
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from fastapi import APIRouter, HTTPException, Request

from settings import get_settings


router = APIRouter(prefix="/api/booking", tags=["booking"])


@router.post("/prepare")
async def prepare_booking(request: Request) -> dict[str, Any]:
    return await proxy_booking_request(request, "/api/booking/prepare")


@router.post("/confirmation")
async def get_booking_confirmation(request: Request) -> dict[str, Any]:
    return await proxy_booking_request(request, "/api/booking/confirmation")


@router.post("/confirm")
async def confirm_booking(request: Request) -> dict[str, Any]:
    return await proxy_booking_request(request, "/api/booking/confirm")


@router.post("/open-checkout")
async def open_booking_checkout(request: Request) -> dict[str, Any]:
    return await proxy_booking_request(request, "/api/booking/open-checkout")


@router.post("/report-payment")
async def report_booking_payment(request: Request) -> dict[str, Any]:
    return await proxy_booking_request(request, "/api/booking/report-payment")


@router.get("/proxy-status")
async def booking_proxy_status() -> dict[str, Any]:
    settings = get_settings()
    target = settings.personal_assistant_api_base_url.rstrip("/")
    return {
        "status": "configured",
        "proxy_target": target,
        "canonical_backend": "personal-assistant-node",
        "routes": [
            "POST /api/booking/prepare",
            "POST /api/booking/confirmation",
            "POST /api/booking/confirm",
            "POST /api/booking/open-checkout",
            "POST /api/booking/report-payment"
        ]
    }


async def proxy_booking_request(request: Request, upstream_path: str) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        body = {}
    return await asyncio.to_thread(post_json_to_personal_assistant, upstream_path, body)


def post_json_to_personal_assistant(path: str, body: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    base_url = settings.personal_assistant_api_base_url.rstrip("/") + "/"
    target = urljoin(base_url, path.lstrip("/"))
    payload = json.dumps(body).encode("utf-8")
    request = UrlRequest(
        target,
        data=payload,
        headers={"content-type": "application/json", "accept": "application/json"},
        method="POST"
    )
    try:
        with urlopen(request, timeout=10) as response:
            return parse_json_response(response.read())
    except HTTPError as error:
        raise HTTPException(
            status_code=error.code,
            detail=parse_error_body(error)
        ) from error
    except URLError as error:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Personal assistant booking backend is not reachable.",
                "target": target,
                "reason": str(error.reason)
            }
        ) from error
    except TimeoutError as error:
        raise HTTPException(
            status_code=504,
            detail={
                "message": "Personal assistant booking backend timed out.",
                "target": target
            }
        ) from error


def parse_json_response(raw: bytes) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return {"raw": raw.decode("utf-8", errors="replace")}
    return value if isinstance(value, dict) else {"data": value}


def parse_error_body(error: HTTPError) -> dict[str, Any]:
    raw = error.read()
    body = parse_json_response(raw)
    return {
        "message": body.get("error") or body.get("message") or error.reason,
        "upstream_status": error.code,
        "upstream_body": body
    }
