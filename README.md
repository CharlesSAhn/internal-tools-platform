# Internal Tools Platform — prototype

**What this is.** A take-home prototype answering one question for a ~60-engineer fintech that spends ~$250K/yr on
Microsoft Power Apps: can a small, reusable, engineer-owned platform — built and maintained with Devin — be a credible
alternative or complement for internal tools?

**What was built.** A shared platform (`platform/*`: demo session auth, RBAC, transactional audit log, declarative
workflow helper, UI kit, app registry, connector catalog) and two structurally different apps on it:

- **KYC Review** (`/kyc`) — queue, claim, approve/reject/escalate with mandatory reasons, high-risk (score ≥ 80)
  approvals behind a separate permission, four-eyes on self-escalated cases, optimistic concurrency, audit timeline.
- **Feature Flags** (`/flags`) — dev/staging/prod flags with rollout percentages, prod-only write permission, kill
  switch, compare-and-swap saves, and a token-authenticated read API for services (`GET /api/flags?env=`).
- **Admin** — `/admin/audit` (cross-app audit explorer) and `/admin/connectors`: one live connector (Random User,
  fixture fallback) whose raw fields an admin maps onto `KycCase` columns via `{path}` templates; eight placeholder
  tiles with no network behind them.

**Why.** KYC is a workflow app (state, ownership, tiered approval, audited decisions); flags is a configuration app
(environment-graded permissions, a machine-facing API, a safety toggle). One platform serving both without changes is
the evidence that it is reusable. The two apps were built by two Devin sessions in parallel off the same platform
commit and merged without touching `platform/**`. The refunds dashboard was intentionally not built.

**Status.** Prototype, not production: demo cookie auth (no SSO), `prisma db push` instead of migrations, nothing
deployed, audit append-only by convention only, one read-only HTTP connector, no browser tests in CI.

| Document | Read it for |
|---|---|
| `docs/KEY_DECISIONS.md` | one page: what was decided, why, evidence, cost — ~1 minute |
| `docs/EVALUATION.md` | Power Apps comparison, cost discussion, recommendation, production gaps |
| `docs/ARCHITECTURE.md` | request path, authorization/audit/workflow models, how to add an app |
| `docs/DEMO.md` | 5-minute walkthrough script |
| `PLAN.md` | the pre-implementation proposal, kept as written |
| `docs/STATUS.md` | task status |

## Run locally

Node 22 and a local PostgreSQL.

```bash
cp .env.example .env            # DATABASE_URL, SESSION_SECRET, FLAGS_API_TOKEN (dev values)
npm install                     # postinstall runs `prisma generate`
npx prisma db push              # no migrations in this prototype
npm run db:seed
npm run dev                     # http://localhost:3000 → /login, pick a seeded user (no password)
```

Re-run `npx prisma db push` and restart the dev server after any change to `prisma/schema/*`.

Seeding is partly additive: users, roles, permissions and flags are upserted (`RESET_DEMO=1` rebuilds demo flags),
connector mappings are installed only when none exist, but **KYC cases, documents and `kyc` audit rows are wiped and
regenerated on every seed**.

## Checks

```bash
npm run typecheck
npm test                        # 161 tests in 14 files; needs DATABASE_URL — actions, API and connector tests hit Postgres
npm run test:coverage
npm run build                   # not while `npm run dev` holds .next
```

CI (`.github/workflows/ci.yml`) runs typecheck, tests and build against a Postgres service on every PR.
`platform/connectors/random-user.integration.test.ts` calls the real `randomuser.me` and skips when offline.
There are no browser tests in CI; authorization, stale-form and audit behaviour were exercised in recorded manual
browser runs.

## Layout

```
app/
  (auth)/            sign-in / sign-out actions
  admin/audit/       audit explorer
  admin/connectors/  connector catalog, pull action, [id]/schema mapping editor
  kyc/  flags/       the two apps — pages, actions, workflow, app.config.ts (nav + permissions)
  api/flags/         token-authenticated flag read API
platform/
  auth  rbac  audit  workflow  ui  registry  connectors  db
prisma/schema/       core.prisma + one file per app;  prisma/seed.ts runs seed.core + one seed per app
test/                Postgres fixtures and Next.js mocks
```

## How the platform works, briefly

- **Authentication** — `/login` lists seeded users; picking one issues a self-signed 8-hour cookie (`jose`, HS256).
  Consumers see only `getCurrentUser()` / `requireUser()` / `requirePermission()`; an OIDC swap is contained to
  `platform/auth` but has not been done.
- **RBAC** — permissions are declared in code (`app/<id>/app.config.ts`, e.g. `kyc.case.approve.high_risk`,
  `flags.write.prod`), roles are Postgres rows reconciled by the seed. Enforced server-side at the page and again in
  the server action; the UI's `can()` only decides what renders.
- **Audit** — `writeAudit(tx, ...)` runs in the same Prisma transaction as the mutation, so no change exists without
  its audit row and a rejected action leaves none. `before`/`after` hold changed fields only.
- **Workflow** — `defineMachine({ from, to, action, permission, requiresReason, guard })` drives both the UI's
  available actions and the server's checks.
- **Adding an app** — `app/<id>/app.config.ts`, `prisma/schema/<id>.prisma`, `prisma/seed.<id>.ts`, one line in
  `platform/registry/index.ts`, then pages and actions using the helpers above. Done once (flags next to KYC); an
  estimate for app #3 onward.

Details: `docs/ARCHITECTURE.md`. Comparison, cost and recommendation: `docs/EVALUATION.md`.
