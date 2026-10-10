"""Backend tests. They need a running Redis (the tests use database 15 and wipe it).

Run:  cd backend && source venv/bin/activate && pytest -v
"""
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

# Settings must be set BEFORE main is imported.
os.environ["REDIS_URL"] = os.getenv("TEST_REDIS_URL", "redis://127.0.0.1:6379/15")
os.environ["RATE_LIMIT_CREATE"] = "100000/minute"
os.environ["RATE_LIMIT_READ"] = "100000/minute"
os.environ["EXTRA_TTLS"] = "2"

import pytest  # noqa: E402
import redis as sync_redis  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

CIPHERTEXT = "k9fQ2xLmPz0vB7nTqW3yHs-_aE5dRu8c"
IV = "AAAAAAAAAAAAAAAA"  # 16 characters = 12 bytes
SALT = "A" * 22  # 22 characters = 16 bytes


@pytest.fixture()
def db():
    r = sync_redis.Redis.from_url(os.environ["REDIS_URL"], decode_responses=True)
    r.flushdb()
    yield r
    r.flushdb()


@pytest.fixture()
def client(db):
    with TestClient(main.app) as c:
        yield c


def create(client, **overrides):
    body = {"ciphertext": CIPHERTEXT, "iv": IV, "ttl_seconds": 3600, "max_views": 1}
    body.update(overrides)
    return client.post("/api/secrets", json=body)


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_read_once_then_gone(client):
    res = create(client)
    assert res.status_code == 201
    secret_id = res.json()["id"]

    first = client.get(f"/api/secrets/{secret_id}")
    assert first.status_code == 200
    assert first.json() == {
        "ciphertext": CIPHERTEXT,
        "iv": IV,
        "salt": "",
        "views_left": 0,
    }

    second = client.get(f"/api/secrets/{secret_id}")
    assert second.status_code == 404


def test_row_is_really_deleted_from_redis(client, db):
    secret_id = create(client).json()["id"]
    assert db.exists(f"secret:{secret_id}") == 1
    client.get(f"/api/secrets/{secret_id}")
    assert db.exists(f"secret:{secret_id}") == 0


def test_server_stores_only_ciphertext_fields(client, db):
    secret_id = create(client, salt=SALT).json()["id"]
    stored = json.loads(db.get(f"secret:{secret_id}"))
    assert set(stored) == {"ciphertext", "iv", "salt", "views_remaining"}


def test_password_salt_is_returned(client):
    secret_id = create(client, salt=SALT).json()["id"]
    assert client.get(f"/api/secrets/{secret_id}").json()["salt"] == SALT


def test_multi_view_counts_down_and_keeps_expiry_timer(client, db):
    secret_id = create(client, max_views=3, ttl_seconds=3600).json()["id"]
    left = [client.get(f"/api/secrets/{secret_id}").json()["views_left"] for _ in range(3)]
    assert left == [2, 1, 0]
    assert client.get(f"/api/secrets/{secret_id}").status_code == 404


def test_multi_view_keeps_original_ttl(client, db):
    secret_id = create(client, max_views=2, ttl_seconds=3600).json()["id"]
    client.get(f"/api/secrets/{secret_id}")
    ttl = db.ttl(f"secret:{secret_id}")
    assert 0 < ttl <= 3600  # KEEPTTL: the timer was not reset or removed


def test_expires_by_itself(client):
    secret_id = create(client, ttl_seconds=2).json()["id"]
    time.sleep(2.6)
    assert client.get(f"/api/secrets/{secret_id}").status_code == 404


def test_status_does_not_use_up_an_open(client):
    secret_id = create(client, max_views=1).json()["id"]
    for _ in range(5):
        assert client.get(f"/api/secrets/{secret_id}/status").status_code == 200
    assert client.get(f"/api/secrets/{secret_id}").status_code == 200  # still readable
    assert client.get(f"/api/secrets/{secret_id}/status").status_code == 404  # now gone


def test_status_of_unknown_secret_is_404(client):
    assert client.get("/api/secrets/" + "A" * 22 + "/status").status_code == 404
    assert client.get("/api/secrets/bad/status").status_code == 404


def test_unknown_and_malformed_ids_are_404(client):
    assert client.get("/api/secrets/" + "A" * 22).status_code == 404
    assert client.get("/api/secrets/not-a-real-id").status_code == 404
    assert client.get("/api/secrets/" + "A" * 200).status_code == 404


@pytest.mark.parametrize(
    "overrides",
    [
        {"ttl_seconds": 999},  # not one of the allowed expiry times
    ],
)
def test_invalid_expiry_is_400(client, overrides):
    assert create(client, **overrides).status_code == 400


@pytest.mark.parametrize(
    "overrides",
    [
        {"ciphertext": ""},
        {"ciphertext": "not base64url!"},
        {"ciphertext": "A" * 20001},
        {"iv": "short"},
        {"iv": "A" * 17},
        {"salt": "tooshort"},
        {"max_views": 0},
        {"max_views": 6},
    ],
)
def test_invalid_input_is_422(client, overrides):
    assert create(client, **overrides).status_code == 422


def test_response_headers_prevent_caching_and_referrer_leaks(client):
    res = client.get("/api/health")
    assert res.headers["cache-control"] == "no-store"
    assert res.headers["referrer-policy"] == "no-referrer"


def test_race_only_one_of_many_simultaneous_reads_wins(client):
    """30 requests hit one single-use secret at the same moment. Exactly one may succeed."""
    secret_id = create(client, max_views=1).json()["id"]
    workers = 30
    barrier = threading.Barrier(workers)

    def attempt(_):
        barrier.wait()
        return client.get(f"/api/secrets/{secret_id}").status_code

    with ThreadPoolExecutor(max_workers=workers) as pool:
        codes = list(pool.map(attempt, range(workers)))

    assert codes.count(200) == 1
    assert codes.count(404) == workers - 1


def test_race_multi_view_never_exceeds_allowed_opens(client):
    secret_id = create(client, max_views=3).json()["id"]
    workers = 30
    barrier = threading.Barrier(workers)

    def attempt(_):
        barrier.wait()
        return client.get(f"/api/secrets/{secret_id}").status_code

    with ThreadPoolExecutor(max_workers=workers) as pool:
        codes = list(pool.map(attempt, range(workers)))

    assert codes.count(200) == 3
