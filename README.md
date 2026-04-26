# QRIS EventHub

Backend service for collecting Android notifications, storing them in SQLite / Cloudflare D1, and matching QRIS payments for e‑commerce workflows.

> **Fork Notice**
> This project is forked from [Wimboro/qris-eventhub](https://github.com/Wimboro/qris-eventhub).
> It has been **heavily modified** and is maintained independently. Major changes include:
> - Refactored into modular file structure (`handlers/`, `db/`, `services/`)
> - Added SHA-256 callback signature verification (`X-QRIS-Signature`)
> - Added 66+ unit tests with Vitest
> - Fixed D1 `undefined` binding errors
> - Cleaned up response helpers, routing, and error handling
>
> No pull request is planned to the upstream repo. All credit to the original author for the foundation.

## Highlights

- Webhook ingestion for Android push notifications with device tracking and analytics.
- QRIS utilities: convert static → dynamic codes, generate unique 3‑digit suffixes, and confirm payments.
- **Callback signature** — outgoing payment callbacks include an `X-QRIS-Signature` header (SHA-256) for tamper-proof verification.
- SQLite persistence (Express) or Cloudflare D1 (Worker) out of the box.
- API-key enforcement, security headers, logging, and CORS enabled by default.
- **66 unit tests** covering helpers, handlers, QRIS converter, payment matching, and callback signatures.

## Project Structure

```
src/
├── worker.js                    ← Cloudflare Worker entry point + router
├── constants.js                 ← CORS headers, TTL, pool size config
├── helpers.js                   ← jsonResponse(), jsonError()
├── qris-converter.js            ← Static → dynamic QRIS conversion + CRC16
│
├── db/
│   ├── init.js                  ← CREATE TABLE IF NOT EXISTS (all 4 tables)
│   ├── device.js                ← upsertDevice()
│   ├── notification.js          ← insertNotification(), getNotifications(), getStats()
│   ├── payment.js               ← createPaymentExpectation(), reserveUniqueAmount(), etc.
│   └── turso-adapter.js         ← D1-compatible wrapper for Turso/libSQL (Vercel)
│
├── handlers/
│   ├── notification.js          ← /health /webhook /test /notifications /devices /stats
│   └── qris.js                  ← /qris/convert /validate /generate-for-order /unique-amount
│
└── services/
    └── payment-matcher.js       ← checkPaymentMatch(), signature generation, callback firing

api/
└── index.js                     ← Vercel serverless function entry point
```

## Getting Started

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and edit:

```env
PORT=3000
API_KEY=change-me
CALLBACK_SECRET=generate-a-long-random-string-here
```

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Express server port | `3000` |
| `API_KEY` | API authentication key (`X-API-Key` header) | `your-secret-api-key` (auth skipped) |
| `CALLBACK_SECRET` | SHA-256 secret for signing `X-QRIS-Signature` on payment callbacks | _(none — callbacks sent unsigned)_ |
| `DB_PATH` | SQLite database file path (Express only) | `./notifications.db` |

### 3. Run

```bash
npm run dev   # nodemon — live reload
npm start     # production
```

### 4. Run tests

```bash
npm test              # single run (vitest)
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```

### Docker

```bash
export API_KEY=change-me
export CALLBACK_SECRET=your-random-secret
docker compose up -d
docker compose logs -f qris-eventhub
```

## Cloudflare Workers Deployment

### Environment variables

Set secrets via Wrangler CLI:

```bash
wrangler secret put API_KEY
wrangler secret put CALLBACK_SECRET
```

Or add to `wrangler.toml` under `[vars]` (not recommended for secrets):

```toml
[vars]
API_KEY = "change-me"
CALLBACK_SECRET = "your-random-secret"
```

### Deploy

```bash
npm run cf:dev      # local dev with Wrangler
npm run cf:deploy   # deploy to Cloudflare
```

### Run migration (once after first deploy)

Tables are **not** created automatically. Run the migration endpoint once after deploying:

```bash
curl -X POST https://your-worker.workers.dev/migrate \
  -H "x-api-key: YOUR_API_KEY"
```

This is safe to call multiple times — it uses `CREATE TABLE IF NOT EXISTS`.

## Vercel Deployment

Vercel uses **Turso** (SQLite-compatible) as the database instead of Cloudflare D1.
All SQL queries remain identical — a D1-compatible adapter handles the translation.

### 1. Create a Turso database

```bash
# Install Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# Sign up & login
turso auth signup

# Create database
turso db create qris-eventhub

# Get connection URL
turso db show qris-eventhub --url
# → libsql://qris-eventhub-username.turso.io

# Create auth token
turso db tokens create qris-eventhub
# → eyJhbGciOi...
```

### 2. Set environment variables in Vercel

Go to **Vercel Dashboard → Project → Settings → Environment Variables** and add:

| Variable | Value |
|----------|-------|
| `TURSO_DATABASE_URL` | `libsql://qris-eventhub-username.turso.io` |
| `TURSO_AUTH_TOKEN` | `eyJhbGciOi...` |
| `API_KEY` | Your API key |
| `CALLBACK_SECRET` | Your callback signature secret |

### 3. Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

### 4. Run migration

```bash
curl -X POST https://your-project.vercel.app/api/migrate \
  -H "x-api-key: YOUR_API_KEY"
```

### Vercel vs Cloudflare — URL differences

| Cloudflare Worker | Vercel |
|-------------------|--------|
| `POST /webhook` | `POST /api/webhook` |
| `POST /migrate` | `POST /api/migrate` |
| `GET /health` | `GET /api/health` |
| `POST /qris/generate-for-order` | `POST /api/qris/generate-for-order` |

## API Overview

> Provide `X-API-Key: ${API_KEY}` on every call except `/health` when the key is configured.
>
> **Vercel:** All paths are prefixed with `/api` (e.g. `/api/webhook` instead of `/webhook`).

### Core endpoints

| Purpose | Method & Path | Notes |
|---------|---------------|-------|
| Migrate | `POST /migrate` | Create database tables. Run once after deploy. |
| Health  | `GET /health` | Unauthenticated heartbeat. |
| Webhook | `POST /webhook` | Notification ingest. Requires `deviceId` and `packageName`. |
| Test    | `POST /test` | Echo endpoint for integration checks. |
| Data    | `GET /notifications` | Supports `device_id`, `limit`, and `offset` query params. |
|         | `GET /devices` | Lists devices ordered by `last_seen`. |
|         | `GET /stats` | Aggregate counts and top applications. |

### QRIS endpoints

| Purpose | Method & Path | Notes |
|---------|---------------|-------|
| Convert | `POST /qris/convert` | Convert static QRIS to dynamic with amount. |
| Validate | `POST /qris/validate` | Validate QRIS format. |
| Generate for order | `POST /qris/generate-for-order` | Generate dynamic QRIS + unique amount for payment tracking. |
| Unique amount | `GET /qris/unique-amount/:orderRef` | Retrieve unique amount for an order. |

## Payment Flow

```
1. Your backend  →  POST /qris/generate-for-order
                    {
                      staticQRIS, originalAmount, orderRef,
                      callbackUrl: "https://your-api.com/payment-confirmed"
                    }
                    ← Returns dynamic QRIS + combined amount

2. Customer scans QR code and pays via banking app

3. Android Notification Listener  →  POST /webhook
                                     { deviceId, packageName, amountDetected, ... }

4. Worker matches payment automatically
   → Marks payment_expectations.status = 'completed'
   → POSTs to callbackUrl with X-QRIS-Signature header

5. Your backend verifies signature and updates order status
```

## Callback Signature Verification

When `CALLBACK_SECRET` is configured, every outgoing payment callback includes an `X-QRIS-Signature` header containing a SHA-256 hex digest.

### Signature format

```
SHA-256( amount_detected + order_reference + completed_at + CALLBACK_SECRET )
```

### Verify in Laravel (PHP)

```php
$signature = $request->header('X-QRIS-Signature');
$secret    = config('services.qris.callback_secret');

$expected = hash('sha256',
    $request->input('amount_detected')
    . $request->input('order_reference')
    . $request->input('completed_at')
    . $secret
);

if (! hash_equals($expected, $signature)) {
    return response()->json(['error' => 'Invalid signature'], 400);
}
```

### Verify in Node.js

```javascript
import { createHash } from 'crypto';

const secret    = process.env.CALLBACK_SECRET;
const signature = req.headers['x-qris-signature'];

const expected = createHash('sha256')
  .update(req.body.amount_detected + req.body.order_reference + req.body.completed_at + secret)
  .digest('hex');

if (expected !== signature) {
  return res.status(400).json({ error: 'Invalid signature' });
}
```

### Callback payload example

```json
{
  "event": "payment.completed",
  "order_reference": "ORDER-20240426-001",
  "status": "completed",
  "amount_detected": "50075",
  "expected_amount": "50075",
  "original_amount": "50000",
  "unique_amount": "075",
  "match_type": "amount_only_match",
  "completed_at": "2026-04-26T15:30:00.000Z"
}
```

## Scripts & Tooling

| Script | Description |
|--------|-------------|
| `npm test` | Run all unit tests (Vitest). |
| `npm run test:watch` | Watch mode for development. |
| `npm run dev` | Start Express server with live reload. |
| `npm start` | Start Express server. |
| `npm run cf:dev` | Cloudflare Wrangler local dev. |
| `npm run cf:deploy` | Deploy to Cloudflare Workers. |

## Database Schema

Tables are created via `POST /migrate` (see `src/db/init.js`). Run once after first deploy:

| Table | Purpose |
|-------|---------|
| `notifications` | All received notification payloads. |
| `devices` | Device metadata and notification counts. |
| `payment_expectations` | Pending/completed payment intents with `callback_url`. |
| `unique_amounts` | Pool of reserved 3-digit suffixes (001–200) with expiry. |

## Troubleshooting

- **Missing `deviceId` or `packageName`** → `400 Bad Request` from `/webhook`.
- **`D1_TYPE_ERROR: Type 'undefined'`** → A field passed to D1 `.bind()` is `undefined` instead of `null`. All optional fields are now coerced with `?? null`.
- **Callback not received** → Check that `callbackUrl` was provided in the `/qris/generate-for-order` request and that `CALLBACK_SECRET` matches on both sides.
- **Signature mismatch** → Ensure both Worker and receiver use the exact same secret string and the same field concatenation order: `amount_detected + order_reference + completed_at + secret`.

## Additional Documentation

- `docs/index.md` – full table of contents.
- `docs/architecture.md` – module breakdown and data flow.
- `docs/api.md` – endpoint reference with payload examples.
- `docs/local-development.md` – environment setup, commands, and troubleshooting.
- `docs/deployment-cloudflare.md` – Worker-specific steps and best practices.
