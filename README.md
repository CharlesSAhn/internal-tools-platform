# Internal Tools Platform (prototype)

A small reusable platform for building internal applications, plus two applications built on it:

- **KYC Review** (`/kyc`) — a review queue with claim/decision workflow, permission-gated state transitions and a full audit trail.
- **Feature Flags** (`/flags`) — environment-scoped flag administration with production guardrails and a read API for services.

This is a prototype built to evaluate replacing Microsoft Power Apps with an in-house platform. It is not
production-ready: authentication is a demo cookie, the schema is applied with `prisma db push` rather than
migrations, and nothing is deployed.

| Document | What it is |
|---|---|
| `PLAN.md` | The up-front architecture and execution proposal |
| `docs/ARCHITECTURE.md` | How the platform works and how to add app #3 |
| `docs/EVALUATION.md` | The honest build/buy assessment, gaps included |
| `docs/KEY_DECISIONS.md` | Each decision, why, and what it costs |
| `docs/DEMO.md` | ~8 minute walkthrough script |

## Running locally

```bash
cp .env.example .env            # point DATABASE_URL at a local Postgres
npm install
npx prisma db push              # no migrations: the schema is pushed, not migrated
npm run db:seed
npm run dev                     # http://localhost:3000
```

Sign in from `/login` by picking a seeded user — the demo has no external IdP (see "Authentication" below).

Seeding is only partly additive. Users, roles, permissions and feature flags are upserted, so flag configuration
edited through the UI survives; `RESET_DEMO=1 npm run db:seed` rebuilds the demo flags from scratch. **KYC data is
always wiped and regenerated** — `prisma/seed.kyc.ts` deletes every case, document and `kyc` audit row on each run.

## Checks

```bash
npm run typecheck
npm test                        # 139 tests; needs DATABASE_URL — server actions and /api/flags run against Postgres
npm run build                   # do not run while `npm run dev` is using .next
```

CI (`.github/workflows/ci.yml`) runs the same three against a Postgres service on every PR.

## Layout

```
app/
  (auth)/           sign-in/out server actions
  admin/audit/      platform-wide audit explorer
  admin/connectors/ connector catalog (one live HTTP connector)
  kyc/              KYC application  (owned by one team/session)
  flags/            Feature flag app (owned by one team/session)
  api/flags/        token-authenticated flag read API for services
platform/
  auth/       session + getCurrentUser + requirePermission
  rbac/       permission resolution, can(), four-eyes helper
  audit/      transactional audit writer + diffing
  workflow/   declarative state machine with permission guards
  ui/         AppShell, DataTable, form primitives, audit timeline
  registry/   app catalog: nav + permission declarations
  connectors/ connector catalog: one live HTTP source + disabled placeholders
  db/         Prisma client
prisma/
  schema/       core.prisma + one schema file per app
  seed.ts       runs seed.core.ts + one seed file per app
test/           shared Prisma fixtures and Next.js mocks for the test suite
```

## Conventions that make parallel development work

1. An app session touches only `app/<app-id>/**`, `prisma/schema/<app-id>.prisma` and `prisma/seed.<app-id>.ts`.
2. `platform/**` is a contract. If an app needs something it doesn't provide, raise it — don't edit shared code mid-stream.
3. Apps declare their permissions in `app/<app-id>/app.config.ts`; the seed reconciles them into the database.
4. App sessions add no new dependencies.

Adding internal app #3 is: one directory, one schema file, one line in `platform/registry/index.ts`.

## Authentication

The prototype signs its own session cookie against a seeded user directory so the demo runs with no external
dependency. Every consumer only sees `getCurrentUser()` / `requirePermission()`, so replacing it with Auth.js + OIDC
(Okta/Entra) is contained to `platform/auth`.

## Authorization model

Permissions are declared in code, roles are data. Server components call `requirePermission()`; server actions
re-check permission at the mutation. The UI uses the same permission list to hide what a user cannot do, but hiding is
never the enforcement.

## Audit

`AuditEvent` rows are written with the same Prisma transaction as the mutation they describe, so a change can never
exist without its audit record. `/admin/audit` is a generic viewer; apps render per-entity timelines from the same table.
