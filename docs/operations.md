# FFB operations

## Environment contract

Private `.env` files and cloud secrets are never application source. Run Bun commands from the root to load the private root `.env` automatically. `.env.example` is the public contract; do not overwrite an existing `.env` during upgrades.

| Variable              | Use / default                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`            | `development`, `test`, `production`; default development                                                              |
| `DATABASE_URL`        | Required PostgreSQL runtime connection; Neon pooled in production                                                     |
| `DIRECT_DATABASE_URL` | Optional direct connection for migrations; direct Neon endpoint recommended                                           |
| `REDIS_URL`           | Required Redis TCP URL; `redis://localhost:6379` locally, `rediss://` with TLS for Upstash                            |
| `WEB_ORIGIN`          | Exact browser origin, without trailing slash; default `http://localhost:5173`                                         |
| `TRUST_FLY_PROXY`     | Default false; Fly API config enables trusted Fly-Client-IP for per-client rate limits. Enable only behind Fly Proxy. |
| `API_HOST`            | Default `0.0.0.0`                                                                                                     |
| `API_PORT`            | Default 3000, falls back to `PORT`; Fly configuration uses 8080                                                       |
| `MAIL_MODE`           | `capture` locally, `resend` required in production                                                                    |
| `MAIL_FROM`           | Sender identity; configure a verified domain for production                                                           |
| `RESEND_API_KEY`      | Required with `MAIL_MODE=resend`; server secret                                                                       |
| `VITE_API_URL`        | Public API origin, e.g. `https://api.example.com`; empty uses same-origin Vite proxy locally                          |

Only `VITE_API_URL` belongs in the web environment. Never put database, Redis, or provider credentials in `VITE_*` variables.

Use sibling custom HTTPS domains such as `play.example.com` on Vercel and `api.example.com` on Fly. Cookies are API-host-only, HttpOnly, SameSite=Lax, prefixed `__Host-` and Secure in production. Arbitrary `vercel.app` to `fly.dev` requests are cross-site and will not receive Lax session cookies. Configure sibling domains before enabling production sign-in. Local development uses `localhost` consistently; do not mix `127.0.0.1` browser URLs with a localhost `WEB_ORIGIN`.

Unsafe HTTP methods require exact `Origin` and `X-FFB-Client: web`. Credentialed CORS only permits `WEB_ORIGIN`. Local rate limits use the socket peer; the Fly config explicitly trusts its proxy-supplied Fly-Client-IP so users do not share a proxy-wide login quota. Do not enable this trust setting on a directly reachable origin. Redis failure makes sensitive requests fail closed. Passwords use Argon2id; opaque sessions have a 30-day fixed expiry, stored by SHA-256 hash. Password reset/change and deactivation revoke prior sessions. Tokens are single-use, expiring, stored hashed outside the private mail delivery outbox. Sensitive responses omit all stored hashes and simulation seeds. Avatars accept up to 2 MB PNG/JPEG/WebP, require actual decoding, reject SVG/animation/oversized dimensions, and re-encode to 256px WebP in PostgreSQL.

## Database procedure

1. Point a private environment at the intended new database. Test production migrations on an isolated Neon branch before user-approved promotion.
2. Run `bun run db:migrate` with the direct administrative connection. An advisory transaction lock serializes migration runners and checksums detect changed history.
3. Run `bun run db:seed` with the runtime connection. It inserts missing deterministic clubs, players and system lineups without replacing existing records. No legacy private data is imported.
4. Start API and worker. Verify both health endpoints and inspect worker logs. Register, verify an account, claim a club, publish a lineup, place/cancel a virtual bet, and follow a match through settlement.

Balances and payouts are whole virtual coins in checked PostgreSQL bigint columns, bounded to JavaScript's safe integer range. Accepted odds are immutable numeric(10,4) snapshots. Payout uses BigInt multiplication and exact flooring. Fixture/user locks serialize acceptance and cancellation; a request UUID makes acceptance retries idempotent. Retry a network-ambiguous placement with the same requestId and identical payload. A changed payload with an old requestId is a conflict. Settlement, grading, ledger credits and final result commit together. Deferred database checks require balances to equal their ledger sums and bets to have matching stake/refund/payout entries. Terminal results/bets and audit records cannot be rewritten.

## Scheduling and recovery

Jobs persist in PostgreSQL with stable IDs, deadlines, attempts, completion timestamps and retry metadata. The worker runs one short lifecycle transaction at a time using an advisory lock and `FOR UPDATE SKIP LOCKED`; multiple worker Machines cannot double-run domain effects. In-flight jobs roll back on process failure. Failed jobs back off exponentially to five minutes, remain visible and retry rather than disappearing.

When idle, the worker queries the next job/email deadline and arms a timer, capped at 60 seconds for reconciliation. Redis notifications wake newly submitted work earlier. This avoids the legacy one-second idle database scan. It is intentionally not a BullMQ queue, so no blocking Redis connection or additional Upstash queue compatibility requirements exist.

At lineup lock, the worker freezes team identities, formation, effective skills, starters and seven substitutes. Seed, `touchline-v1` engine version and checkpoints persist with each fixture. Every 250ms of wall time advances five simulated seconds; halftime lasts 60 steps. No spectator changes the engine cadence. Downtime catches up in bounded 240-step transactions. The final checkpoint, result, bet grading and payouts are atomic. Restart recovers missing jobs and current-week deadlines; missed historical weeks are not fabricated or granted retroactive top-ups. Keep old engine versions available when introducing new ones while fixtures remain unresolved.

Monitor `jobs` for pending rows with high attempts, overdue `run_at`, or non-null `last_error`. Inspect `mail_outbox` for delayed undelivered mail; avoid dumping its bodies or tokens into shared logs. Read-only useful queries:

```sql
SELECT kind, count(*), min(run_at), max(attempts)
FROM jobs WHERE done_at IS NULL GROUP BY kind;
SELECT count(*), min(run_at), max(attempts)
FROM mail_outbox WHERE delivered_at IS NULL;
SELECT status, count(*) FROM matches GROUP BY status;
```

The email outbox sends through a small provider adapter. Capture mode never sends network email. Resend uses the outbox ID as an idempotency key; provider deduplication has a 24-hour retention window, so an ambiguous send followed by a retry after that window can deliver a duplicate link. Single-use account tokens keep consumption safe. No provider API was called during local migration validation.

## Native WebSocket v1

Endpoint: `/api/ws` on the API origin. Cookie session and exact Origin are required. At most five sockets per account; one match subscription per socket; 4KB inbound limit; heartbeat and idle timeout; close slow consumers and reconnect/resync instead of buffering indefinitely. Messages are validated with shared schemas.

```json
{ "v": 1, "type": "subscribe", "matchId": "fixture-id", "afterRevision": 0 }
```

Client messages: `subscribe`, `unsubscribe`, `ping`. Server messages: `ready`, `changed` (matchId or null, revision), `pong`, `error`. A subscription always returns a revision invalidation, including if the client cursor is ahead. Changes invalidate the HTTP snapshot rather than exposing private engine inputs. Fetch `/api/matches/:id/live` for one consistent checkpoint and recent timeline; page `/events?afterSequence=N` for older events. On reconnect, refresh authoritative HTTP snapshots; the React client also reconciles every 15 seconds and on tab visibility changes. Old in-flight responses cannot overwrite a newer request within a resource.

Socket.IO events and transport fallback were intentionally replaced. Public match/table snapshots remain available without a session, but live WebSocket subscriptions require authentication. URLs in the React client use hash navigation.

## Manual production deployment

Configuration files are prepared only; nothing has been created, pushed or deployed.

1. **GitHub:** review the target diff, keep `.env`, `.Code`, caches and build output private, and commit/push using the user's normal workflow. The legacy repository remains unchanged.
2. **Neon:** select/create the intended project and isolated migration-test branch manually. Set pooled `DATABASE_URL` on both services and direct `DIRECT_DATABASE_URL` on the API release environment. Use verified TLS, backups/restore retention and a least-privilege application role. Test migrations and seed before promoting. No Neon services beyond PostgreSQL are required.
3. **Upstash:** select a Redis database and take its TLS TCP endpoint (`rediss://`), not its HTTPS REST URL. Configure both services in compatible nearby regions. Required commands are PING, PUBLISH/SUBSCRIBE and Lua INCR/EXPIRE. Redis eviction or loss cannot lose bets or results; transient rate limits and notifications can reset.
4. **Fly.io:** replace the example app names in `fly.api.toml` and `fly.worker.toml` with names you own, create both apps in organization `mjonny4`, and configure secrets through Fly's secret manager. Keep at least one API Machine and one persistent worker Machine. Use the same tested source version for both. Deploy API first to run the release migration, seed intentionally once, then deploy worker. API binds 0.0.0.0:8080; worker has no HTTP service. Both handle SIGTERM. Config does not create resources or secrets by itself.
5. **Vercel:** create a Vite project with Root Directory `apps/web` and allow source outside that directory. Use its `vercel.json`, Bun 1.4.4/frozen install, and set only public `VITE_API_URL`. Configure the sibling HTTPS web domain and matching API `WEB_ORIGIN`. Deploy the web client after the API is healthy. Verify login cookies and direct native WebSocket upgrade on the API domain.
6. **Email:** configure Resend's verified sender, MAIL_FROM, MAIL_MODE=resend and the private API key on server processes. Exercise delivery using an account you own after deployment approval.

Local configuration validation: `docker compose config --quiet`; parse both Fly TOML files with `Bun.TOML.parse`, and Vercel JSON with `JSON.parse`. A production container can be built with `docker build -t ffb-local .`; use the API CMD or override with `bun apps/worker/src/index.ts` for the worker. Supply runtime environment securely. No credentials enter image layers.

## Intentional changes and limits

- Fresh normalized schema replaces Prisma history. No automatic private-data migration or seeded passwords/accounts.
- Exact whole coins, server-side odds snapshots and idempotent request UUIDs replace floating payout multiplication.
- Versioned native invalidations replace Socket.IO payloads. HTTP remains authoritative.
- The streamlined React management UI preserves squad attributes, six formations, drafts/publication and locking. It uses selects instead of drag/drop. The legacy tactics editor did not feed the stored simulation input; it is omitted rather than presenting ineffective controls. Crowd audio is omitted; pitch motion respects reduced-motion preferences.
- Leaderboard ranks all active managers by net profit, then wallet/name, and marks fewer than ten settled bets provisional. Legacy qualifying-only rank/ROI ordering is intentionally replaced; ROI and hit rate remain visible.
- History and personal bet/ledger reads are bounded to protect response size; match events support cursor pagination. A larger-scale administrative archive UI is not included.
- PostgreSQL job execution serializes lifecycle writers and checks ledger sums for integrity. Scale/latency load tests and production capacity sizing remain operational work; this migration does not claim a production load test or cloud deployment validation.
