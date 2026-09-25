# Internal Tools Platform (prototype)

A small reusable platform for building internal applications, plus two applications built on it:

- **KYC Review** (`/kyc`) — a review queue with claim/decision workflow, permission-gated state transitions and a full audit trail.
- **Feature Flags** (`/flags`) — environment-scoped flag administration with production guardrails and a read API for services.

This is a prototype built to evaluate replacing Microsoft Power Apps with an in-house platform. See `PLAN.md` for the
architecture proposal and `docs/EVALUATION.md` for the honest assessment.

## Running locally

```bash
cp .env.example .env            # point DATABASE_URL at a local Postgres
npm install
npx prisma db push
npm run db:seed
npm run dev                     # http://localhost:3000
```

Sign in from `/login` by picking a seeded user — the demo has no external IdP (see "Authentication" below).

`npm run db:seed` is additive: it creates missing demo records and leaves existing configuration edited through the
UI alone. To throw away demo data and rebuild it from scratch, run `RESET_DEMO=1 npm run db:seed`.

## Layout

```
app/
  (auth)/         sign-in/out server actions
  admin/audit/    platform-wide audit explorer
  kyc/            KYC application  (owned by one team/session)
  flags/          Feature flag app (owned by one team/session)
platform/
  auth/       session + getCurrentUser + requirePermission
  rbac/       permission resolution, can(), four-eyes helper
  audit/      transactional audit writer + diffing
  workflow/   declarative state machine with permission guards
  ui/         AppShell, DataTable, form primitives, audit timeline
  registry/   app catalog: nav + permission declarations
  db/         Prisma client
prisma/schema/  core.prisma + one schema file per app
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
