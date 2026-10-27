# FFB · Football. Your call.

A fictional football league with 20 original clubs, 460 generated players, club management, live matches, and betting with virtual coins. No real money.

Bun 1.4.4 runs the monorepo. React 19/Vite serves the client; native Bun HTTP/WebSockets serve the API; a persistent Bun worker runs durable PostgreSQL jobs. PostgreSQL owns accounts, wallets, bets, schedules, simulation checkpoints, results, and the email outbox. Redis carries transient notifications and rate limits.

## Local development

```sh
bun install --frozen-lockfile
# First setup only: create a private .env from .env.example, then edit it.
cp .env.example .env
bun run infra:up
bun run db:migrate
bun run db:seed
```

Run these in separate terminals from the repository root:

```sh
bun run dev:api
bun run dev:worker
bun run dev:web
```

Open http://localhost:5173. The API defaults to port 3000 and binds `0.0.0.0`. `GET /health/live` checks process liveness; `GET /health/ready` checks PostgreSQL and Redis. The worker has no public port. SIGTERM/SIGINT drains in-flight work; interrupted jobs roll back and retry on restart.

Register through the app. Signup credits 1,000 whole virtual coins; Monday rounds credit 200. Rounds open Monday 09:00 and betting/cancellation close Friday 23:59 in `Europe/Madrid`. Games run Saturday and Sunday, with lineups locked one hour before kickoff. Seeding on a weekend prepares the next Monday job rather than inventing an open betting window. Keep the worker running for continuous games and email delivery.

`MAIL_MODE=capture` stores local messages privately in `mail_outbox`, with `provider_id` beginning `captured:` after delivery. Inspect that table in a local database GUI to open verification/reset links. Tokens and messages never go to logs or public APIs. Production requires the HTTPS Resend adapter and a verified sender.

## Validation

```sh
bun run check
bun run test:integration
bun run build:web
docker compose config --quiet
```

`check` runs strict workspace/test type checks, lint, format checks, and domain tests. Integration tests explicitly require local PostgreSQL/Redis; they create and remove their own `ffb_test_*` database and do not reset your development data. The local database user needs `CREATEDB`. Tests cover concurrent acceptance, exact payouts, terminal/ledger constraints, sessions/reset/revocation, HTTP security and uploads, native WebSocket updates/reconnect, worker catch-up/restart, and idempotent settlement. The engine characterization fixture comes from the audited legacy engine.

## Workspace

| Path                  | Responsibility                                                    |
| --------------------- | ----------------------------------------------------------------- |
| `apps/web`            | React pages, forms, native WebSocket client and HTTP recovery     |
| `apps/api`            | Native Bun server, domain routes, sessions, CORS/CSRF and uploads |
| `apps/worker`         | Deadline timers, durable job execution and email adapter          |
| `packages/config`     | Validated server environment                                      |
| `packages/contracts`  | Shared Zod request, response and WebSocket schemas                |
| `packages/database`   | SQL migrations, seeds and transactional repositories              |
| `packages/football`   | Pure markets, odds, lineups, squads, standings and calendar       |
| `packages/simulation` | Deterministic versioned match engine and input freezing           |

SQL migrations are ordered, transactional, checksum-checked and advisory-locked. Never edit an applied migration; add a new file under `packages/database/migrations`. `db:migrate` uses `DIRECT_DATABASE_URL` if set; runtime and seed use `DATABASE_URL`. Seeds are repeatable and preserve manager lineups, accounts, balances, and historical fixtures. This is a fresh target schema, not an in-place Prisma upgrade or private database import.

See [operations and deployment](docs/operations.md) for environment variables, manual Neon/Upstash/Fly/Vercel setup, live protocol, recovery, and limitations. Audit and execution evidence is local-only under `.Code/docs/`. No deployment or Git publishing is performed by the migration.

Static club/player assets retain the legacy MIT license. Country flags retain [their MIT license](apps/web/public/flags/LICENSE.flag-icons).
