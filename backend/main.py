"""Ephemera backend.

This server is deliberately "dumb": it stores ciphertext it cannot read and
destroys it the moment it is read. It never receives the encryption key.

Storage is Redis, which gives us two things for free:
  * a built-in expiry timer (TTL), so unread secrets delete themselves
  * atomic Lua scripts, so "read + count + delete" happens as ONE step and two
    people can never both receive the same one-time secret
"""
import json
import os
import re
import secrets
from contextlib import asynccontextmanager

import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# ---------------------------------------------------------------- settings
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
RATE_CREATE = os.getenv("RATE_LIMIT_CREATE", "30/minute")
RATE_READ = os.getenv("RATE_LIMIT_READ", "60/minute")

# Only these expiry times are accepted: 5 minutes, 1 hour, 1 day, 7 days.
ALLOWED_TTL = {300, 3600, 86400, 604800}
# Extra values for automated tests only (e.g. EXTRA_TTLS=2). Empty in normal use.
ALLOWED_TTL |= {int(x) for x in os.getenv("EXTRA_TTLS", "").split(",") if x.strip()}

ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{22}$")  # token_urlsafe(16) is 22 chars
B64URL = r"^[A-Za-z0-9_-]+$"

# Atomic read-and-burn. Runs inside Redis as a single uninterruptible step.
#   1. read the record
#   2. reduce the number of opens left
#   3. delete it when no opens are left (otherwise keep the original timer)
BURN_SCRIPT = """
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local data = cjson.decode(raw)
data.views_remaining = data.views_remaining - 1
if data.views_remaining <= 0 then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
end
return raw
"""


# ----------------------------------------------------------------- app set-up
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = redis.from_url(REDIS_URL, decode_responses=True)
    app.state.burn = app.state.redis.register_script(BURN_SCRIPT)
    yield
    await app.state.redis.aclose()


def client_key(request: Request) -> str:
    """Who is making the request, for rate limiting.

    The Next.js dev proxy forwards the browser's address in X-Forwarded-For.
    (In a real deployment you would only trust this header from your own proxy.)
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=client_key)
app = FastAPI(title="Ephemera", docs_url=None, redoc_url=None, lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


# -------------------------------------------------------------------- models
class CreateSecret(BaseModel):
    # Everything here is base64url text produced in the browser.
    ciphertext: str = Field(min_length=1, max_length=20000, pattern=B64URL)
    iv: str = Field(min_length=16, max_length=16, pattern=B64URL)  # 12 bytes
    salt: str = Field(default="", pattern=r"^([A-Za-z0-9_-]{22})?$")  # empty = no password
    ttl_seconds: int = 3600
    max_views: int = Field(default=1, ge=1, le=5)


# ----------------------------------------------------------------- endpoints
@app.get("/api/health")
async def health(request: Request):
    await request.app.state.redis.ping()
    return {"ok": True}


@app.post("/api/secrets", status_code=201)
@limiter.limit(RATE_CREATE)
async def create_secret(request: Request, body: CreateSecret):
    if body.ttl_seconds not in ALLOWED_TTL:
        raise HTTPException(status_code=400, detail="Invalid expiry time.")

    secret_id = secrets.token_urlsafe(16)  # 128 random bits: cannot be guessed
    record = json.dumps(
        {
            "ciphertext": body.ciphertext,
            "iv": body.iv,
            "salt": body.salt,
            "views_remaining": body.max_views,
        }
    )
    # ex= sets the expiry timer: Redis deletes the record by itself when it ends.
    await request.app.state.redis.set(f"secret:{secret_id}", record, ex=body.ttl_seconds)
    return {"id": secret_id, "expires_in": body.ttl_seconds}


@app.get("/api/secrets/{secret_id}/status")
@limiter.limit(RATE_READ)
async def secret_status(request: Request, secret_id: str):
    """Does this secret still exist? Read-only: it does NOT use up an open.

    The page calls this when it loads, so a link that was already used shows the
    "shredded" screen straight away instead of waiting for a click.
    """
    if not ID_PATTERN.match(secret_id) or not await request.app.state.redis.exists(f"secret:{secret_id}"):
        raise HTTPException(status_code=404, detail="Payload shredded, expired, or never existed.")
    return {"exists": True}


@app.get("/api/secrets/{secret_id}")
@limiter.limit(RATE_READ)
async def read_and_burn(request: Request, secret_id: str):
    not_found = HTTPException(
        status_code=404, detail="Payload shredded, expired, or never existed."
    )
    if not ID_PATTERN.match(secret_id):
        raise not_found

    raw = await request.app.state.burn(keys=[f"secret:{secret_id}"])
    if raw is None:
        raise not_found

    data = json.loads(raw)
    return {
        "ciphertext": data["ciphertext"],
        "iv": data["iv"],
        "salt": data["salt"],
        "views_left": max(data["views_remaining"] - 1, 0),
    }
