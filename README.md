# Ephemera: zero-knowledge ephemeral secret vault

Share a password, API key or `.env` file through a link that deletes the secret after it is opened.

- The secret is encrypted **in the browser** with AES-256-GCM (Web Crypto).
- The key lives in the link after the `#`. Browsers never send that part to a server, so the server holds only scrambled text.
- The first open deletes the record from Redis (atomically, with a Lua script). Unopened secrets expire after 5 minutes, 1 hour, 1 day or 7 days.
- Optional password mode: PBKDF2-SHA256, 600,000 iterations. The link then carries no key (`#p`).

Stack: Next.js (React, TypeScript) + FastAPI + Redis.

## 1. One-time setup on a Mac

Open Terminal and run:

```bash
# Homebrew (skip if `brew --version` already works)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node redis python
```

Optional, for the demo: install **Redis Insight** (free GUI) from https://redis.io/insight/ to show the database.

## 2. Run it

```bash
cd ephemera
chmod +x dev.sh
./dev.sh
```

The first run installs everything (a few minutes). Then open **http://localhost:3000**.
Press `Ctrl+C` to stop; the script also stops the Redis it started.

For the demo use `./dev.sh prod`, which runs the production build (with the strict Content-Security-Policy).

If `./dev.sh` shows an error, paste it to whoever helped you; the script prints what failed.

## 3. Three-minute demo script

1. **Create.** Type a fake secret such as `DB_PASSWORD=hunter2`. Choose "1 hour", "1" open. Click *Lock and create link*. Watch the text get redacted.
2. **Show the database.** Point at the "Sent to the server" panel, then run in Terminal `redis-cli GET secret:<id>` (the *Copy command* button copies it). The audience sees only ciphertext, an IV and a counter. Say: the key is the underlined part after `#`, and it is not in Redis.
3. **Open in a private window.** Paste the link into an incognito window. Click *Reveal secret*. The text appears, and the page says it was deleted from the server.
4. **Refresh.** The page shows **404: Payload shredded**. Run `redis-cli GET secret:<id>` again and it returns `(nil)`.
5. **Optional extras.** Password mode (the link ends in `#p`), 3 opens (a countdown), and the *What Ephemera can't protect against* section, which shows you understand the limits.

Questions the mentor may ask:

- *Why can't the server read it?* The key is in the URL fragment, which the browser never sends (RFC 3986).
- *Why GCM?* It encrypts and authenticates, so tampering is detected. The IV is random per message.
- *What if two people open at once?* The read-and-delete runs as one Lua script in Redis, so exactly one succeeds. The test suite checks this with 30 threads.
- *Why Redis?* Native expiry (`EX`), atomic scripts, and no disk persistence, so deleted data is not left in a file.
- *Weakness?* Anyone with the full link can open it; the server could serve malicious JavaScript (self-host for high-stakes use); malware on the device.

## 4. Tests

```bash
# Frontend crypto tests (16 tests, no server needed)
cd frontend && npm run test:crypto

# Backend API tests (needs Redis running)
cd backend && venv/bin/pip install -r requirements-dev.txt && venv/bin/pytest -v

# Type check
cd frontend && npm run typecheck
```

## 5. Layout

```
backend/main.py            FastAPI app: create, status, read-once burn (Lua)
backend/tests/             pytest suite, including race tests
frontend/lib/crypto-engine.ts   all cryptography (Web Crypto)
frontend/pages/index.tsx   create page
frontend/pages/s/[id].tsx  reveal page
frontend/styles/globals.css     design system
```

## 6. Security notes

- Nothing secret is logged or stored by the server except ciphertext, IV, salt, and counters.
- Rate limiting (slowapi), size limits, strict input validation, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, CSP in production, no third-party requests (fonts are bundled).
- The reveal page checks existence with a read-only `/status` call and only downloads the secret when you click the button, so link previews and refreshes do not burn it.
- Not included: accounts, audit logs, HTTPS (put it behind a reverse proxy such as Caddy or Nginx for real use).

## 7. What was tested when this was generated

Tested for real: the Redis burn script (including concurrent reads), the validation rules, the crypto module (16 tests), and the full browser flow in headless Chromium against a real Redis.

Not run in the build environment (package installs were blocked): the FastAPI server itself, the pytest suite, `next dev/build`, and the bundled fonts. These were written carefully, but the first run on your machine may need a small fix. Report any error text you see.
