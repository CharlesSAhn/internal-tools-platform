# Internal Tools Platform — Architecture & Execution Plan (pre-implementation)

Status: proposal for review. No application code written yet.
Constraints assumed: ~2 hours of Devin execution time, ≤ $200 spend, prototype quality (credible, not production).

---

## 0. The question behind the question

The VP is not asking "can Devin write a CRUD app" — that is already answered. The real questions are:

1. If we stop paying Power Apps, **who owns the replacement, and what does that cost in engineering attention?**
2. Can 60 engineers ship internal app #4 through #13 **without re-deciding auth, permissions, audit, and table UI every time?**
3. What do we **lose** that Power Apps was actually providing?

So the prototype must demonstrate *leverage across apps*, not two nice apps. The KYC app proves depth (workflow, permissions, auditability). The feature-flag app proves the platform is not KYC-shaped. The second app is the actual evidence; the first is the credibility.

### Assumptions I want to challenge

| Assumption | My position |
|---|---|
| We need to replicate Power Apps' no-code/drag-drop builder | **No.** Power Apps' core value prop is letting non-engineers build apps. This org has 60 engineers and is asking *engineers* to build these tools. Rebuilding a visual builder is the single biggest trap here — it is 10x the work and serves a user who isn't in the room. If the true requirement is "the Ops/Compliance team builds their own apps," this whole evaluation changes and we should say so now. |
| A platform means a metadata-driven "app engine" (define a schema → get an app) | **No.** That is Power Apps' architecture, and it is only rational when code is expensive. With Devin, bespoke code is cheap and generic runtimes are expensive (every customization becomes a fight with the engine). Platform = **libraries + conventions + a codegen-able template**, not a runtime interpreter. This is the most important architectural judgment in the proposal. |
| $250K/yr of licenses is $250K/yr of savings | **No.** Realistic offset is ~0.3–0.7 FTE of ongoing platform ownership (on-call, upgrades, auth changes, access reviews) ≈ $80–200K loaded, plus hosting. Net savings is real but modest; the stronger argument is **customization, data locality (KYC PII stays in our VPC/Postgres), no per-user seat tax as headcount grows, and internal tools living in the same repo/CI/observability as the product**. I'd sell it on those, and treat license savings as the tiebreaker. |
| We should compare against "build from scratch" only | **No.** The honest alternative set is: Power Apps (status quo), Retool/Appsmith self-hosted (still per-seat, but ~10x cheaper and covers most of this platform), and this in-house platform. The prototype should be framed as "what does the in-house option look like and is it worth it," not "we must build." I'll put a short comparison in the evaluation writeup. |

### What we'd give up with Power Apps (build-vs-lose list, to be in the final writeup)

Lose and must rebuild: connector catalog (Dataverse/SharePoint/Dynamics/365 etc.), non-engineer app authoring, per-environment governance + DLP policies, admin center with app inventory, mobile app shells, Microsoft support/SLA and compliance attestations inherited from the platform.
Lose and probably don't care: Excel-like formula layer, canvas/pixel layout, offline mobile, Power Automate flows (we have CI + cron + our own queue).
Gain: unlimited users, full customization, our auth/SSO, our audit store, code review, real tests, no vendor lock-in on our KYC data.

---

## 1. Architecture

**One Next.js application, one Postgres database, multiple apps mounted as route groups, shared concerns as workspace packages.**

```
Browser
  └── Next.js 15 App Router (single deployment)
        ├── middleware: session + tenantless auth gate
        ├── /kyc/*     → apps/kyc      (route group)
        ├── /flags/*   → apps/flags    (route group)
        ├── /admin/*   → platform: users, roles, audit explorer
        └── /api/flags → read API for services (token auth)
        │
        ├── @platform/auth      session, OIDC, role→permission resolution, requirePermission()
        ├── @platform/rbac      permission registry, policy checks, four-eyes helper
        ├── @platform/audit     append-only writer + queryable viewer + diff rendering
        ├── @platform/workflow  declarative state machine (states, guards, effects, auto-audit)
        ├── @platform/ui        AppShell, DataTable (server pagination/filter/sort), FormKit (zod→form), Dialog/Toast
        ├── @platform/db        Prisma client, shared models (User, Role, Permission, AuditEvent)
        └── @platform/testing   seed factories, actAs(role) test harness
Postgres (single DB, app-prefixed tables)
```

Why a single deployment rather than a service per app: at 13 internal apps with ~60 engineers, per-app services multiply auth wiring, deploys, and on-call for no benefit. One app, one login, one nav, one audit log. If one app later needs isolation (e.g. KYC PII), it can be extracted — the package boundaries make that a mechanical move, not a rewrite.

Why server-first (RSC + server actions): permission checks and audit writes happen on the server by construction. A client-fetch architecture invites "the UI hid the button" as the access control story, which is exactly what an auditor will fail us on.

### The three cross-cutting mechanisms (the actual platform)

1. **Permissions.** Every app declares its permissions statically (`kyc.case.approve`, `flags.prod.write`). Roles map to permissions in the DB, seeded per environment. Server actions are wrapped: `withPermission('kyc.case.approve', handler)`. UI reads the same registry, so nav/buttons hide consistently. Adding app #4 = adding a permission list, not touching auth.
2. **Audit.** `AuditEvent(actorId, app, entityType, entityId, action, before, after, reason, at)`, append-only, written **inside the same transaction as the mutation** — not fire-and-forget. `/admin/audit` is a generic viewer over it; each app gets a per-entity timeline for free.
3. **Workflow.** A tiny declarative state machine: `{ from, to, permission, requiresReason, guard }`. KYC uses it for case review; flags use it (lightly) for prod change approval. This is the piece that makes app #4 cheap, and it is ~150 lines — not an engine.

---

## 2. Technology stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript (strict) | One language across apps/platform; shared zod schemas. |
| Framework | Next.js 15 App Router, RSC + server actions | Server-enforced authz, minimal client state, fast to build. |
| DB | PostgreSQL 16 | Boring, transactional audit, JSONB for before/after diffs. |
| ORM | Prisma (multi-file schema) | Migrations + per-app schema files → fewer cross-session conflicts. |
| Auth | Auth.js v5 — OIDC provider (Okta/Entra) + dev credentials provider | Demo runs with seeded users; real SSO is a config swap, documented not implemented. |
| UI | Tailwind + shadcn/ui | Copy-in components we own; no design system project. |
| Validation | zod, shared client/server | FormKit generates forms from the same schema the action validates. |
| Tests | Vitest (unit/integration), Playwright (1 smoke per app) | See §8. |
| Tooling | pnpm workspaces, ESLint, tsc, GitHub Actions | |
| Hosting (documented, not deployed) | Vercel or their k8s + managed Postgres | Out of scope to deploy. |

---

## 3. Reusable platform components (scope-locked)

| Package | In prototype | Deliberately not |
|---|---|---|
| `auth` | Session, sign-in, `getCurrentUser()`, middleware gate, dev + OIDC providers | SCIM provisioning, MFA, session revocation UI |
| `rbac` | Permission registry, role→permission seed, `withPermission`, `can()` for UI, four-eyes helper | Field-level perms, ABAC, delegated admin, access-request flow |
| `audit` | Transactional writer, JSONB before/after, `/admin/audit` viewer with filters, per-entity timeline | Tamper-evident hash chain, export to SIEM, retention policy |
| `workflow` | Declarative transitions with permission guards, required reason, auto-audit | Parallel approvals, SLAs/timers, notifications, BPMN anything |
| `ui` | AppShell+nav from app registry, DataTable (server-side paging/sort/filter/saved views omitted), FormKit, ConfirmDialog, EmptyState | Charts, dashboard builder, drag-drop layout, theming |
| `db` | Prisma client, core models, seed runner | Multi-tenancy, read replicas, soft-delete framework |
| `app-registry` | Convention-based: `apps/<name>/app.config.ts` exports name, nav, permissions, routes; auto-discovered | Dynamic app install/uninstall at runtime |
| `testing` | `actAs(role)` harness, factories | Full fixture library |

**Success criterion for the platform, to be stated in the writeup:** a third app (the refunds dashboard we are *not* building) should be estimatable at "one Devin session, ~1 hour" with only `apps/refunds/` touched. If the design doesn't make that claim credible, the platform failed regardless of how the two demo apps look.

---

## 4. KYC review queue — scope

Representative of a real internal workflow: queue → claim → evidence → decision → audit.

Must have
- `KycCase`: applicant name, country, risk score, submitted docs (metadata rows only, no file storage), status, assignee, timestamps.
- Queue view: server-paginated DataTable, filter by status/risk/assignee, "my queue" vs "all".
- Case detail: applicant panel, document list, decision panel, audit timeline.
- State machine: `NEW → IN_REVIEW → (APPROVED | REJECTED | ESCALATED)`, `ESCALATED → (APPROVED | REJECTED)`. Claim assigns the case; only the assignee can decide.
- Guards that make it a real workflow, not CRUD: **reason required** on reject/escalate; **four-eyes** — the approver cannot be the person who escalated; **risk ≥ 80 requires `kyc.case.approve.high_risk`** (senior reviewer role).
- Roles: `kyc.viewer`, `kyc.reviewer`, `kyc.senior_reviewer`, plus platform `admin`.
- Every transition + field change written to the audit log with actor, reason, before/after.
- Seeded demo data: ~60 cases across statuses/risk bands, 4 demo users.

Won't have: document upload/virus scan/PII encryption, sanctions/vendor API integration, SLA timers, bulk actions, notifications, case reassignment UI, comments/attachments.

## 5. Feature-flag admin — scope

Chosen to be structurally *unlike* KYC: config-shaped, environment-scoped, consumed by machines.

Must have
- `Flag`: key, description, owner, archived.
- `FlagEnvState` per env (dev/staging/prod): enabled, rollout percentage, targeting by user ID list.
- Flag list + detail with per-environment editing.
- **Environment-graded authorization:** `flags.write.nonprod` vs `flags.write.prod` — prod edits require the elevated permission and a change reason (reuses the workflow guard + audit reason).
- Kill switch (one-click disable in prod, still audited).
- Change history per flag with rendered before/after diff (reuses `@platform/audit`).
- `GET /api/flags?env=prod` with a static service token → JSON evaluation payload. Proves internal tools can serve services, not just humans.

Won't have: SDKs, streaming updates, percentage-rollout bucketing correctness guarantees beyond a hash function, segments/complex targeting rules, scheduled rollouts, experiment/metrics analysis, approval queue with a second approver.

---

## 6. Repository organization for parallel Devin sessions

```
/
├── apps/
│   ├── kyc/        app.config.ts, routes, components, actions, prisma/kyc.prisma, tests
│   └── flags/      app.config.ts, routes, components, actions, prisma/flags.prisma, tests
├── packages/       auth rbac audit workflow ui db testing
├── prisma/
│   ├── schema/     core.prisma  (+ symlinked/collected app .prisma files)
│   └── migrations/
├── docs/           EVALUATION.md, ARCHITECTURE.md, DEMO.md
└── .github/workflows/ci.yml
```

Rules that keep concurrent sessions from colliding:
1. **Disjoint directory ownership.** A session working on an app touches only `apps/<name>/**` and `docs/`. Platform changes require a platform PR.
2. **Contract-first.** The platform package public APIs are merged to `main` *before* app sessions start; app sessions consume them and may not edit them — if a gap is found, the session reports it and stubs locally rather than editing shared code.
3. **No central registries.** Nav and permissions are discovered from `apps/*/app.config.ts` by convention, so two sessions never edit one list file. This is a deliberate design choice made for merge-ability.
4. **Per-app Prisma files.** Prisma's multi-file schema means the KYC and flags models live in separate files. Migration folder collisions are the one real hotspot: each app session generates exactly one migration, named `<timestamp>_<app>_init`; if both land, the second PR regenerates. Mitigation accepted; alternative (one session owns all schema) is slower.
5. **Lockfile conflicts** resolved by `pnpm install` re-run, never manual merge. App sessions should add zero new dependencies (state this as a constraint).

---

## 7. Task breakdown, dependencies, parallelism

Wall-clock target ~2h using two concurrent sessions in the middle phase.

| # | Task | Owner | Depends on | Est. Devin time |
|---|---|---|---|---|
| T0 | This plan | done | — | — |
| T1 | Repo scaffold: pnpm workspace, Next.js, Tailwind/shadcn, ESLint/tsc, CI | Session A | T0 approved | 15 min |
| T2 | `db` + core schema (User, Role, Permission, AuditEvent) + seed runner | Session A | T1 | 10 min |
| T3 | `auth` + `rbac`: dev credentials login, session, permission resolution, `withPermission` | Session A | T2 | 15 min |
| T4 | `audit` writer + `/admin/audit` viewer; `workflow` state machine | Session A | T3 | 15 min |
| T5 | `ui`: AppShell + nav discovery, DataTable, FormKit, dialogs | Session A | T3 | 15 min |
| T6 | **Platform PR merged to main** (the hard dependency barrier) | Session A | T1–T5 | — |
| T7 | KYC app: schema, seed, queue, detail, transitions, guards, tests | Session B | T6 | 40 min |
| T8 | Flags app: schema, seed, list/detail, env authz, kill switch, read API, tests | Session C | T6 | 30 min |
| T9 | Integration: merge both, e2e smoke, demo seed, screenshots | Session A | T7, T8 | 15 min |
| T10 | `docs/EVALUATION.md` (honest assessment, cost model, build-vs-lose, "app #3 estimate") + `DEMO.md` script | Session A | T9 | 15 min |

Critical path: T1→T6→max(T7,T8)→T9→T10 ≈ 70 + 40 + 30 ≈ **~2h 20m of serialized Devin time, ~1h 50m wall clock with B and C concurrent.** That is at the edge of the budget — see risks.

Parallel opportunities: T4 and T5 are independent after T3 (could split, but coordination overhead inside one session isn't worth it). T7 and T8 are genuinely parallel and are the demonstration of the platform's value. T10 can be drafted while T9 runs.

---

## 8. Testing strategy

Deliberately asymmetric — test the things that would be embarrassing to get wrong, skip coverage theater.

- **Unit (Vitest), highest value:** permission resolution, `withPermission` denial paths, workflow guard logic (four-eyes, high-risk, reason-required), flag rollout bucketing. Pure functions, fast, ~25 tests.
- **Integration (Vitest + test Postgres):** server actions end-to-end — an unauthorized role gets rejected, a successful transition writes exactly one audit row in the same transaction, a failed transition writes none. This is the test that proves the auditability claim.
- **E2E (Playwright), 2 tests total:** KYC reviewer approves a case and sees it in the audit timeline; non-prod role is blocked from a prod flag change.
- **CI:** lint + typecheck + unit + integration on every PR; Playwright on main only (time budget).
- Not doing: visual regression, load testing, a11y audit, mutation testing, >1 browser.

## 9. Git / branch strategy

- Trunk-based on `main`; no long-lived branches in a 2h build.
- `devin/<unix-ts>-platform`, `devin/<unix-ts>-kyc`, `devin/<unix-ts>-flags`, `devin/<unix-ts>-integration`.
- Platform PR must merge first (T6 barrier). App PRs branch from post-T6 `main` — **not** stacked, since they're path-disjoint and stacking adds rebase cost.
- One PR per task group, squash merge, CI green before merge except the final docs PR.
- Repo is currently empty (no default branch), so the first push must establish `main` directly — I'll need your go-ahead for that one push, then everything after is PR-based.

## 10. Risks and tradeoffs

| Risk | Impact | Mitigation |
|---|---|---|
| **Budget/time overrun** — plan is ~2h20m serialized vs 2h cap | High | Hard timeboxes per task; pre-agreed cut list (in order: Playwright e2e → flags targeting-by-user → KYC escalation path → audit viewer filters). Better to ship 2 solid apps + honest writeup than 3 half-features. |
| Platform PR slips, blocking both app sessions | High | T1–T5 are deliberately small and conventional; if T5 (UI kit) is late, app sessions can start with plain tables and swap in DataTable later. |
| Prisma migration collision between concurrent app sessions | Medium | Multi-file schema + one migration per app + regenerate-on-conflict rule (§6.4). |
| Over-engineering the platform into an app engine | High (project-killing) | Explicit anti-goal (§0). Rule of thumb: nothing goes into `packages/` until the second app needs it — the two apps are the forcing function. |
| Demo looks like CRUD, doesn't answer the VP's question | High | `docs/EVALUATION.md` is a first-class deliverable (T10), not a README afterthought. The artifact being evaluated is the *argument*, supported by code. |
| Real SSO not demonstrated | Medium | Dev credentials provider + documented Auth.js OIDC config; state plainly that SSO integration is ~half a day, not a risk. |
| Ongoing ownership cost understated | Medium | Put a named cost model in the writeup (0.3–0.7 FTE + hosting) rather than claiming $250K savings. |

## 11. Explicitly out of scope

Refunds dashboard · no-code/visual builder · citizen-developer authoring · multi-tenancy · real file upload / PII encryption / KMS · sanctions or KYC vendor integrations · email/Slack notifications · scheduled jobs · real SSO/SCIM provisioning · MFA · mobile/offline · i18n · charts & analytics · data connector catalog · production deployment, IaC, monitoring/alerting · rate limiting · soft-delete/undo · saved views & bulk actions · hash-chained tamper-evident audit · SIEM export · access-review workflows · performance/load work.

---

## 12. What I'd want decided before implementation

1. **Is the real user an engineer or a non-engineer?** If Ops/Compliance must author apps themselves, this architecture is wrong and we should evaluate Retool/Appsmith instead. (My read: engineers.)
2. **Budget shape:** approve ~2h serialized / ~$150 with the cut list in §10, or tighten scope now (e.g. drop the flags read API and Playwright) to buy margin.
3. **Auth:** dev credentials provider for the demo — acceptable? Wiring real Okta/Entra would consume ~20% of the budget for little evaluative signal.
4. **First push to `main`** on the empty repo — confirm.
