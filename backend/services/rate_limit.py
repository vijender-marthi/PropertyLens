"""Lightweight in-process rate limiting for abuse-prone endpoints.

A sliding-window counter keyed by (bucket, client IP), used as a FastAPI
dependency. This blunts online brute-force and request floods against auth
endpoints. It is per-process and in-memory — good enough for a single worker and
a strong deterrent, but true network-layer DDoS protection belongs at a reverse
proxy / CDN / WAF in front of the app.

Set RATE_LIMIT_DISABLED=true to turn it off (e.g. for load tests).
"""
import os
import time
import threading
from collections import defaultdict, deque

from fastapi import Request, HTTPException

_lock = threading.Lock()
_hits: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    # Honour a proxy's forwarded client IP when present, else the socket peer.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, limit: int, window_seconds: int):
    """Return a FastAPI dependency enforcing `limit` requests / `window_seconds`
    per client IP for the given bucket."""
    def _dep(request: Request):
        if os.getenv("RATE_LIMIT_DISABLED", "").lower() == "true":
            return
        key = f"{bucket}:{_client_ip(request)}"
        now = time.time()
        with _lock:
            dq = _hits[key]
            cutoff = now - window_seconds
            while dq and dq[0] <= cutoff:
                dq.popleft()
            if len(dq) >= limit:
                retry = int(window_seconds - (now - dq[0])) + 1
                raise HTTPException(
                    status_code=429,
                    detail=f"Too many attempts. Please wait {retry}s and try again.",
                    headers={"Retry-After": str(retry)},
                )
            dq.append(now)
    return _dep
