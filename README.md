# Datability

- **Stack:** Node.js 22+, Express, TypeScript, MySQL 8.4.
- **Purpose:** Register webhook endpoints, accept unique events, and deliver with bounded retries inside the API request.
- **IDs:** UUID v7 for endpoints and deliveries; caller-provided, case-sensitive event IDs.

## 1. Setup

- Run commands from the project root (the directory containing `package.json`).
- Install Node.js 22+ and Docker Compose, or provide an existing MySQL 8.4 instance.
- For first-time setup in PowerShell:

```powershell
npm install
Copy-Item .env.example .env
npm run docker:up
npm run migrate
npm run start:dev
```

- Skip copying `.env` if it is already configured.
- Compose starts only MySQL and creates `webhook_api` and `webhook_api_test` on first initialization; the API runs locally at `http://localhost:3000`.
- With an existing MySQL instance, create both databases, grant access, configure `.env`, and skip `docker:up`.
- Run migrations one process at a time.
- Build and start compiled code:

```powershell
npm run build
npm run start:prod
```

- Stop MySQL with `npm run docker:down`; its volume preserves data.
- To reset MySQL completely, run `docker compose down -v`, then `npm run docker:up` and `npm run migrate`. **This deletes database data.**

## 2. Configuration

- Settings load from `.env`; existing environment variables take priority.
- Credentials in `.env.example` are for local development. Keep `.env` out of version control.

| Variable | Default | Purpose / allowed range |
| --- | --- | --- |
| PORT | 3000 | API port |
| DB_HOST | 127.0.0.1 | Database host |
| DB_PORT | 3306 | Database port |
| DB_USER | webhook | Database user |
| DB_PASSWORD | webhook_local | Database password |
| DB_NAME | webhook_api | Application database |
| DB_CONNECTION_LIMIT | 10 | Pool size: 1-100 |
| DELIVERY_TIMEOUT_MS | 5000 | Attempt timeout: 1-60000 ms |
| DELIVERY_MAX_ATTEMPTS | 3 | Total attempts: 1-3 |
| DELIVERY_RETRY_DELAY_MS | 100 | Retry delay: 0-60000 ms |
| DELIVERY_CONCURRENCY | 10 | Concurrent deliveries per request: 1-100 |
| TEST_DB_NAME | webhook_api_test | Test database; must end in `_test` |
| LOG_LEVEL | info | debug, info, warn, error |
| LOG_FILE | logs/app.log | File path for appended JSON logs, relative to the project root or absolute |

## 3. API

- Send POST bodies as JSON with `Content-Type: application/json`.
- Success responses use `{ "success": true, "data": ... }`.
- Validation errors return `400` with field details; oversized bodies return `413` (limit: 1 MB).
- Both POST routes reject unknown top-level fields; event `payload` accepts arbitrary object keys.
- Supported event types: `order.created`, `order.updated`, `order.cancelled`, `payment.succeeded`, `payment.failed`.

### Register an endpoint

- **POST `/webhook-endpoints`**
- Use an absolute HTTP/HTTPS URL, up to 2048 characters, without embedded credentials.
- Supply a nonempty array of supported events; duplicate subscriptions are collapsed.
- Returns `201` with `id`, `url`, `events`, and `createdAt`.

```json
{
  "url": "http://127.0.0.1:4000/webhook",
  "events": ["order.created", "order.updated"]
}
```

- The example requires a local receiver on port 4000; automated tests create their own receivers.

### Accept and deliver an event

- **POST `/events`**
- Require a nonblank `eventId` (up to 255 characters), a supported `eventType`, and an object `payload`.
- Outgoing webhook bodies contain exactly the same three fields.

```json
{
  "eventId": "evt_1001",
  "eventType": "order.created",
  "payload": { "orderId": "order_123", "amount": 1500 }
}
```

- **Accepted: `201`**, after deliveries finish. Acceptance succeeded even when destinations fail; delivery records communicate the outcome without encouraging event resubmission.
- **Duplicate: `409`**, even if the payload changes. This explicitly identifies an already accepted ID and prevents another delivery round.
- **No subscribers: `201`**, with an empty deliveries array.

### Inspect an event

- **GET `/events/:eventId`**; URL-encode the event ID.
- Returns `200` with the event and delivery records, or `404` for an unknown event.
- Each delivery includes `id`, `endpointId`, `url`, `status`, `attempts`, `lastResponseStatus`, `lastError`, and creation/update/attempt/completion timestamps.
- Final statuses are `succeeded` or `failed`; concurrent reads may show `pending` or `delivering`.
- Network failures and timeouts have a null response status and an error message. Database timestamps are UTC.

## 4. Delivery and Database Decisions

- **Retries:** Fixed 100 ms delay by default; simple to explain and test, and avoids immediate retry bursts. Delay and attempt limit are configurable.
- **Bounded work:** At most three attempts including the initial attempt; success stops retries immediately.
- **Timeout:** Default 5 seconds per attempt, covering DNS, connection, TLS, and waiting for response headers.
- **Success:** Any 2xx response. Other statuses, network errors, and timeouts fail the attempt; redirects are not followed.
- **Response handling:** Discard response bodies after headers to avoid waiting for large or endless bodies.
- **Isolation:** Delivery tasks run concurrently within the configured limit; a failing destination does not stop the others. Database connections are released before network delivery.
- **Uniqueness:** MySQL enforces the event primary key. Concurrent inserts allow exactly one accepted event; application-only existence checks are avoided.
- **Transactions:** Persist the event and delivery snapshot together before making HTTP requests; persist endpoints and subscriptions atomically.
- **Relationships:** Foreign keys link each delivery to one event and endpoint; `(event_id, endpoint_id)` is unique.
- **Lookup:** Subscription index `(event_type, endpoint_id)` supports finding destinations efficiently.
- **Schema:** Four SQL migrations use InnoDB, `CHAR(36)` UUID storage, and `VARCHAR` event/status columns. Allowed values are defined in `webhook.interface.ts`; request validation uses the shared event types.

## 5. Tests

```powershell
npm test
npm run test:mysql
npm run build
```

- `npm test`: 28 API tests using an in-memory repository and real local HTTP mock servers; no database required.
- `npm run test:mysql`: The same 28 tests against MySQL, including ten parallel duplicate submissions. Start MySQL first.
- **MySQL tests migrate and delete records in `TEST_DB_NAME`. Use a dedicated disposable database ending in `_test`, different from `DB_NAME`; do not run suites concurrently against it.**
- Required coverage: valid registration, invalid input, successful delivery, sequential duplicates, concurrent duplicates, retry exhaustion, and timeouts.
- Additional coverage: retry recovery, dropped connections, redirects, no matching subscribers, GET/404, malformed JSON, and configurable attempt limits.
- All automated webhook traffic uses controlled local servers. Use local receivers for manual testing too.

## 6. Project Structure and Logs

- `apps/webhook/src/`: Routes, validation, services, repository, and interfaces.
- `apps/webhook/database/migrations/`: Four table migrations in dependency order.
- `libs/common/src/`: Configuration, error handling, and shared logger.
- `libs/database/`: MySQL pool, migration runner, and test-database initialization.
- `libs/http-client/src/`: HTTP delivery with an attempt deadline.
- `test/`: Shared contract, in-memory repository, and MySQL suite.
- Logs use JSON lines for startup/shutdown, requests, delivery attempts, migrations, and errors.
- Logs are appended to `logs/app.log` (override with `LOG_FILE`). Console colors are green for info, orange for warnings, red for errors, and cyan for debug. Files contain plain JSON without color codes. Set `NO_COLOR` to disable console colors or `FORCE_COLOR=1` to enable them when output is redirected.
- Match request logs with the response's `X-Request-ID`; bodies, destination URLs, credentials, and raw database errors are excluded.

## 7. Limitations and Future Work

- **Process crash:** Accepted deliveries may remain `pending` or `delivering`. No automatic recovery or replay runs; duplicate submissions remain `409`.
- **Receiver duplicates:** If a receiver processes a request but its acknowledgement is lost, retries may repeat its side effects. Receivers should deduplicate by `eventId`.
- **Database failure after delivery:** The receiver may have received a webhook while its stored result is stale. Infrastructure failures return `500`; inspect the event before deciding what happened.
- **Snapshot subscriptions:** Endpoints registered after acceptance do not receive that event.
- **Request duration:** The request stays open during delivery. Concurrency is limited per request; there is no global limit across requests.
- **Future production work:** Authentication, webhook signing, SSRF protection, rate limits, and global concurrency limits.
- **Scope:** No UI, pagination, endpoint update/delete API, workers, queues, or schedulers.
- **Unfinished required features:** None identified in the assignment review.
