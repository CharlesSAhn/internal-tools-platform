# Internal Tools Platform — prototype and Power Apps evaluation

A take-home exercise for a Series C fintech (~60 engineers, ~$250K/yr on Microsoft Power Apps, three internal
apps today, 10+ planned). The question: **can a small, reusable, engineer-owned platform let us build customized
internal tools quickly enough — with enough of what makes Power Apps valuable — to be worth owning?**

This repository is the evidence: a reusable platform, two unlike applications built on it, one live data connector
with an admin-editable schema mapping, and an honest evaluation. Everything described here is in the tree on `main`;
anything not built is called out as such.

| Document | What it is |
|---|---|
| `README.md` (this file) | What was built, how it works, how to run it, the Power Apps comparison and recommendation |
| `docs/KEY_DECISIONS.md` | One page: problem, assumptions, decisions, tradeoffs, risks, next steps |
| `docs/EVALUATION.md` | The longer build/buy/hybrid assessment with the gap list and cost table |
| `docs/ARCHITECTURE.md` | Request path, authorization/audit/workflow models, how to add app #3 |
| `docs/DEMO.md` | ~8 minute walkthrough script with the seeded users |
| `PLAN.md` | The pre-implementation proposal (kept as written, for comparison with what shipped) |
| `docs/STATUS.md` | Task status |

## What was built

- **`platform/*`** — shared libraries and conventions: session auth, RBAC, transactional audit log, a declarative
  workflow (state machine) helper, UI kit, app registry, connector catalog, Prisma client.
- **KYC Review** (`/kyc`) — a review queue: claim a case, approve/reject/escalate with mandatory reasons,
  high-risk (score ≥ 80) approvals gated behind a separate permission, four-eyes on self-escalated cases, optimistic
  concurrency on transitions, per-case audit timeline, document *metadata* only.
- **Feature Flags** (`/flags`) — environment-scoped flags (dev/staging/prod) with percentage rollouts, separate
  non-prod and prod write permissions, a production kill switch, compare-and-swap on saves so a stale form cannot undo
  a kill switch, and a token-authenticated read API for services (`GET /api/flags?env=`).
- **Admin** — `/admin/audit` (platform-wide audit explorer) and `/admin/connectors` (connector catalog).
- **Connectors** — exactly one live connector, Random User (`randomuser.me`, seeded, 2s timeout, checked-in fixture
  fallback). It keeps a documented 16-path subset of the raw record; an admin maps those raw paths onto `KycCase`
  columns at `/admin/connectors/random-user/schema` using `{path}` templates (default `{name.first} {name.last}` →
  `applicantName`, `{nat}` → `applicantCountry`) with a live preview, and "Pull now" upserts the records as `NEW` KYC
  cases keyed on `source` + `sourceId` (the source UUID). Eight other tiles (SharePoint, Dataverse, SQL Server,
  Outlook, Teams, Salesforce, Dynamics 365, ServiceNow) are **placeholders** that make no network call.
- **Tests and CI** — 161 tests in 14 files (unit tests for rules; server actions, the API route and the connector
  import run against a real Postgres), typecheck, and a production build on every PR.

## Why KYC and Feature Flags

They are structurally unlike each other, which is the point. KYC is a *workflow* app: a queue, ownership, state
transitions, tiered approval, reasons, auditability of human decisions. Feature flags is a *configuration* app:
environment-graded permissions, a machine-facing API, a safety-critical toggle. If one platform serves both without
modification, it is plausibly not shaped like either — and it was built that way: the two apps were developed by two
independent sessions in parallel off the same platform commit and merged without touching `platform/**`. The refunds
dashboard was skipped deliberately: a third app of the same shape as KYC would add cost, not evidence.

## Architecture

One Next.js 15 (App Router, React 19, server components + server actions) application, one PostgreSQL database via
Prisma, internal apps mounted as route groups. No per-app services, gateway or message bus — at ~13 apps and a few
hundred internal users those add operational surface without buying anything.

```
app/
  (auth)/           sign-in / sign-out server actions
  admin/audit/      platform-wide audit explorer
  admin/connectors/ connector catalog, pull action, [id]/schema mapping editor
  kyc/              KYC application       (app-owned: pages, actions, workflow, app.config.ts)
  flags/            feature-flag app      (app-owned)
  api/flags/        token-authenticated flag read API
platform/
  auth/        session cookie, getCurrentUser(), requireUser(), requirePermission()
  rbac/        can(), canAny(), assertPermission(), permissionsForUser(), enforceFourEyes()
  audit/       writeAudit(tx, ...) + diffFields()
  workflow/    defineMachine / resolveTransition / availableTransitions
  ui/          AppShell, DataTable, form primitives, audit timeline
  registry/    the list of apps; nav + permission declarations
  connectors/  Connector type, random-user adapter + fixture, disabled placeholders
  db/          Prisma client
prisma/schema/ core.prisma + one file per app     prisma/seed.ts → seed.core + one seed per app
test/          shared Postgres fixtures and Next.js mocks
```

The mutation path every app follows:

```
server action
  └─ requirePermission(...)                      server-side, never a hidden button
  └─ resolveTransition(machine, ...)             legal transition + permission + reason + guard
  └─ prisma.$transaction(tx => { update; writeAudit(tx, ...) })   audit in the same transaction
  └─ revalidatePath(...)
```

See `docs/ARCHITECTURE.md` for the longer version.

## How the reusable platform works

The platform is **libraries and conventions, not a runtime**. There is no metadata interpreter, no canvas, no formula
language: an app is ordinary TypeScript that imports `@platform/*`. What makes it reusable is the small set of
contracts every app follows:

- `app/<id>/app.config.ts` declares the app's id, nav entries and permission keys via `defineApp()`.
- `platform/registry/index.ts` lists the apps; the home page, nav and permission seed derive from it.
- Pages call `requirePermission()`, actions call it again, writes go through `prisma.$transaction` with `writeAudit`.
- State changes are described with `defineMachine()` so the UI's buttons and the server's checks come from one table.
- Each app owns its own `prisma/schema/<id>.prisma` and `prisma/seed.<id>.ts`; the core schema holds users, roles,
  permissions, audit and source mappings.

Nothing enters `platform/*` until a second app needs it — that rule kept it at roughly a dozen small modules.

## Authentication and RBAC

**Authentication is demo-only.** `/login` lists the six seeded users; picking one issues a self-signed 8-hour session
cookie (`jose`, HS256, `SESSION_SECRET`). There is no password, SSO, MFA, SCIM or session revocation. Consumers only
see `getCurrentUser()` / `requireUser()` / `requirePermission()`, so swapping in an OIDC provider (Okta/Entra) is
contained to `platform/auth` plus an IdP-group → role mapping — but that swap has *not* been done.

**Authorization: permissions are code, roles are data.** Apps declare keys such as `kyc.case.approve.high_risk` and
`flags.write.prod`; the platform declares `admin.audit.view`, `admin.users.view`, `admin.connectors.view`. `Role`,
`RolePermission` and `UserRole` are Postgres rows reconciled by the seed (the `admin` role receives every permission).
Enforcement is server-side and happens twice — at the page and inside the server action. The UI's `can()` only decides
what to render; browser testing forged requests past disabled controls and the server rejected them without writing an
audit row. `enforceFourEyes()` is a platform helper because every approval-shaped tool needs it.

## Audit logging

`AuditEvent(actor, app, entityType, entityId, action, reason, before, after, at)` is written with the **same Prisma
transaction as the mutation it describes** (`writeAudit(tx, user, {...})`), so a change cannot exist without its audit
row and a rejected action leaves no trace. `before`/`after` hold only the changed fields as JSONB. `/admin/audit` is a
generic, filterable viewer across apps; KYC renders a per-case timeline from the same table; connector pulls, imports,
and mapping save/delete/reset are audited too. The log is append-only by convention only — no hash chain, WORM storage
or SIEM export.

## Adding an application

1. `app/<id>/app.config.ts` — id, name, nav, permission keys (`defineApp`).
2. `prisma/schema/<id>.prisma` — models; `prisma/seed.<id>.ts` — demo data and the role → permission mapping.
3. One line in `platform/registry/index.ts`.
4. Pages and server actions using `requirePermission`, `resolveTransition`, `writeAudit`, `DataTable`.
5. `npx prisma db push && npm run db:seed`.

No changes to auth, audit, nav or another app. This is how feature flags was added next to KYC; it is an estimate, not
a measurement, for app #3 onward.

## Running locally

Requirements: Node 22, a local PostgreSQL.

```bash
cp .env.example .env            # DATABASE_URL, SESSION_SECRET, FLAGS_API_TOKEN (dev values)
npm install                     # postinstall runs `prisma generate`
npx prisma db push              # no migrations: the schema is pushed, not migrated
npm run db:seed
npm run dev                     # http://localhost:3000 → /login, pick a seeded user
```

After pulling a change to `prisma/schema/*`, re-run `npx prisma db push` and restart the dev server.

Seeding is **partly additive**: users, roles, permissions and flags are upserted (UI-edited flag config survives;
`RESET_DEMO=1 npm run db:seed` rebuilds demo flags), connector schema mappings are only installed when none exist, but
**KYC cases, documents and `kyc` audit rows are wiped and regenerated on every seed.**

Service API: `curl -H "Authorization: Bearer $FLAGS_API_TOKEN" 'http://localhost:3000/api/flags?env=prod'`.

## Running tests

```bash
npm run typecheck
npm test                        # 161 tests / 14 files; needs DATABASE_URL (actions, API, connectors hit Postgres)
npm run test:coverage           # v8 coverage; platform/connectors, rbac, registry, admin/connectors, api/flags at 100% lines
npm run build                   # do not run while `npm run dev` holds .next
```

`platform/connectors/random-user.integration.test.ts` calls the real `randomuser.me` endpoint and skips cleanly when
offline. CI (`.github/workflows/ci.yml`) runs typecheck, tests and build against a Postgres service container.
There are no browser tests in CI; browser runs were done manually and recorded.

## What was intentionally not built

- The refunds dashboard.
- Real authentication (SSO/OIDC, MFA, SCIM), IdP-group → role mapping, session revocation.
- Migrations: the schema is applied with `prisma db push`; there is no `prisma/migrations` history.
- Deployment, infrastructure-as-code, monitoring, alerting, backups, on-call.
- Any real connector beyond one unauthenticated read-only HTTP GET: no OAuth, credential storage, paging, throttling,
  write-back, or per-connector schema discovery. The other eight catalog tiles are labels.
- A generic mapping engine: the schema editor maps one source onto two `KycCase` columns with `{path}` templates.
- Tamper-evident audit, retention/legal hold, SIEM export, access-review reporting.
- KYC substance: file storage, encryption at rest, sanctions/identity vendors, retention.
- Browser tests in CI; a concurrency test that forces truly simultaneous transactions.
- Any no-code/citizen-developer authoring surface, mobile shell, offline mode, or Power Automate equivalent.

## Power Apps comparison

Legend — **Demonstrated**: working in this repo. **Needs engineering**: not built; would have to be. **Power Apps
OOTB**: comes with the licence.

| Area | Prototype | Power Apps |
|---|---|---|
| App development speed | **Demonstrated:** two unlike apps plus platform in ~2h of agent time; the second app was one parallel session with no platform change. Human review time not included. | Simple form-over-data apps in hours by anyone; complex rules get slow as the low-code layer fights back. |
| Customization | **Demonstrated:** anything expressible in TypeScript — tiered approvals, four-eyes, CAS writes, a service API. No ceiling. | Bounded by the canvas/formula model and connector capabilities; escape hatches exist (PCF, custom connectors) but are engineering work anyway. |
| Authentication | **Needs engineering:** demo cookie only. OIDC swap is contained to `platform/auth`, not done. | **OOTB:** Entra ID, conditional access, MFA inherited from the tenant. |
| RBAC | **Demonstrated:** permissions in code, roles in data, enforced server-side at page and mutation, environment-graded (`flags.write.prod`). **Needs engineering:** IdP-group mapping, access-review reports. | **OOTB:** app sharing, security roles (Dataverse), environment roles. Fine-grained business rules are harder. |
| Auditability | **Demonstrated:** transactional, cross-app, diffed, queryable, includes rejected-action guarantees. **Needs engineering:** tamper evidence, retention, SIEM. | **OOTB:** Purview/activity logging of platform events; *business-level* audit (why was this case approved) is app-by-app work. |
| Hosting | **Needs engineering:** nothing deployed; one container + managed Postgres is the design. | **OOTB:** Microsoft-hosted, SLA included. |
| Deployment | **Demonstrated:** CI on every PR (typecheck, tests, build). **Needs engineering:** migrations (`prisma migrate`), environments, release process. | **OOTB:** environments + solutions/ALM pipelines, though real ALM discipline is still on the team. |
| Connectors | **Demonstrated:** one HTTP connector, fixture fallback, raw-to-column schema mapping with preview and audit. **Needs engineering:** each further system = auth flow, token store, paging, throttling, mapping, owner. | **OOTB:** several hundred maintained connectors (Dataverse, SharePoint, SQL, Outlook, Teams, Dynamics, ServiceNow, SAP…). This is the single largest gap. |
| Governance | **Needs engineering:** no DLP policies, no environment boundaries, no app inventory beyond the registry file. | **OOTB:** tenant DLP, environments, admin centre with app inventory, ownership and usage. |
| Maintenance | **Needs ownership:** Next.js/Prisma/Node upgrades, dependency security, on-call — an estimated 0.3–0.7 FTE. | Vendor-maintained runtime; the team maintains apps and pays for the licence. |
| Compliance responsibility | Ours end to end: infrastructure, data handling, audit integrity, attestations. | Shared: Microsoft's attestations cover the platform; the team still owns app-level data handling. |
| Citizen / developer tooling | Engineers only: IDE, PR review, tests, agent-assisted generation. **Not built:** any business-user authoring. | Business analysts can build and change apps without a deploy; engineers get a weaker tooling story. |

The prototype does not replace Power Apps. It shows that for **engineer-owned, workflow-heavy, audit-sensitive**
tools the in-house option is credible and cheap to extend; it shows nothing about citizen development or M365-centric
apps, and its connector story is one tile versus a catalog.

## Economics

Baseline: **~$250K/yr** in Power Apps licences. No precise savings figure is claimed — the ranges below are
estimates, not measurements.

- **Licensing.** The in-house option removes the per-seat cost and the per-seat *growth* as headcount rises. A
  Retool/Appsmith alternative is per-seat again, at a lower rate.
- **Engineering time.** The platform plus two apps took ~2 hours of agent time across several sessions, plus human
  review and direction. Migrating the three existing apps is a one-off cost with a period of running both systems.
- **Future application marginal cost.** The evidence is one data point: the second app cost one parallel session and
  zero platform changes. If app #3–#13 stay near that, the platform pays for itself quickly; if `platform/*` grows a
  roadmap, they will not. This is the number to measure, not assume.
- **Maintenance / security ownership.** Framework and dependency upgrades, auth changes, access reviews, incident
  response for tools Compliance now depends on, and platform requests from app teams: **0.3–0.7 FTE**, roughly
  $80–200K loaded. At the low end most of the licence saving survives; at the high end it is close to a wash before
  hosting.
- **Infrastructure.** One container and a managed Postgres with backups: low, on the order of a few thousand dollars a
  year, but zero today because nothing is deployed.
- **Opportunity cost.** Every hour on the platform is an hour not on the product. Agent-generated code shifts the cost
  from writing to reviewing; it does not remove it — two of the concurrency defects here were found by review and
  browser testing, not by tests.

Made on cost alone the case is weak-to-moderate. Made on customization, data locality (KYC PII in our own database),
review/test discipline and no per-seat tax it is stronger, *provided* engineers are the intended authors.

## Recommendation

**Hybrid, with a checkpoint.**

1. **Settle who authors the apps.** If Ops/Compliance must build their own, this architecture is wrong — evaluate
   Retool/Appsmith or stay on Power Apps. Everything below assumes engineers author.
2. **Keep Power Apps (or a low-code tool) for simple form-over-data and M365-adjacent apps** where the value is mostly
   in connectors and business ownership. That is where Power Apps earns its keep and where this prototype is weakest.
3. **Build the workflow-heavy, audit-sensitive, product-adjacent tools in this platform** — feature flags and refunds
   first (simplest, lowest risk), KYC only after migrations, SSO, audit hardening and PII handling exist.
4. **Name a platform owner (0.3–0.5 FTE) before app #4**, with a written rule for what may enter `platform/*`.
5. **Re-evaluate at app #5.** If per-app cost is still about one session and platform churn is low, let the Power Apps
   renewal shrink to the apps that stay there; if the platform has become a bottleneck, the honest move is to stop.

A pure "build everything with Devin" recommendation is not supported by this evidence, and a pure "stay" leaves the
customization and data-locality problems unsolved. The prototype supports the hybrid and tells you exactly what to
measure before going further.
