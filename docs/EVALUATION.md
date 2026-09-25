# Should we replace Power Apps with an in-house internal-tools platform?

An honest assessment written from the prototype in this repository (~2 hours of agent time, 28 commits). Everything
claimed as "built" below is in the tree on `main`; everything else is explicitly marked as not built. `PLAN.md` has
the up-front reasoning, `docs/ARCHITECTURE.md` how it works, `docs/KEY_DECISIONS.md` the decisions and their costs.

## The short answer

**Probably yes for engineer-owned workflow tools, and the deciding factor is not the $250K.** The licence saving is
real but partly consumed by platform ownership. The defensible reasons to move are customization, keeping KYC data in
our own database, no per-seat tax as headcount grows, and internal tools living in the same repo, CI, review and
observability as the product.

**No if the actual goal is that non-engineers build the apps.** Nothing here gives Ops or Compliance an app builder,
and building one is a different and much larger project. Settle that question before approving any migration.

## What Power Apps is actually good for

Worth being precise about, because these are the things we would be giving up or rebuilding:

- **Connectors.** Several hundred prebuilt connectors — Dataverse, SharePoint, Outlook/Exchange, Dynamics, SQL, SAP,
  ServiceNow — with authentication, paging and throttling already handled. In this repo, every integration is bespoke
  code. If these internal tools live off M365 data, that is the single biggest cost of leaving.
- **Citizen development.** A business analyst can build a form-over-data app in an afternoon, and change a dropdown
  or a validation rule without a deploy, a PR, or an engineer. Our equivalent is a code change and a release.
- **Governance and DLP.** Tenant-level data-loss-prevention policies that stop a connector combination before it is
  ever published, per-environment (dev/test/prod) app boundaries, sharing controls, and Purview/audit integration.
  We have one deployment, one nav, and role assignment that is still seeded rather than driven by the IdP.
- **Admin inventory.** A single admin centre listing every app, its owner, its connections, and its usage — which is
  how you answer "what internal apps exist and who can see customer data?" in one place. We would have to build the
  inventory, the ownership metadata, and the access-review reporting ourselves.
- **Vendor compliance posture.** Microsoft's attestations, SLA and support contract. In-house, we become the SLA.
- **Mobile shells and offline behaviour**, which we do not attempt at all.

`/admin/connectors` makes that first bullet concrete rather than rhetorical. The catalog has nine tiles and exactly
one of them is real: Random User (`https://randomuser.me`), a plain HTTP GET with a 2s timeout that falls back to a
checked-in fixture, mapped to `{ id, name, country }` and importable as NEW KYC cases. The other eight — SharePoint,
Dataverse, SQL Server, Outlook, Teams, Salesforce, Dynamics 365, ServiceNow — are placeholders whose `listRecords()`
throws; there is no OAuth, no credential storage, no paging, no throttling and no write path behind any of them. One
unauthenticated read-only JSON endpoint took a single small module. Each of those eight, done properly, is an auth
flow, a token store with rotation, schema mapping, rate-limit handling, and an on-call owner. That distance — one
tile versus a catalog of several hundred maintained by the vendor — is the Power Apps gap, and it is the strongest
argument for keeping Power Apps (or a hybrid) wherever an internal tool's value is mostly in reaching M365 data.

What we would give up and should not miss: the formula language, the canvas layout model, Power Automate flows (we
have CI, cron and code), and premium connectors these three tools are unlikely to use.

## What the prototype demonstrated

| Capability | Status | Where |
|---|---|---|
| Reusable platform consumed by two unlike apps | Built | `platform/*` |
| Authentication | Demo session cookie (`jose` HS256, seeded users); OIDC is a contained swap | `platform/auth` |
| Authorization — permissions in code, roles as data, enforced at page *and* mutation | Built | `platform/rbac`, `app/*/app.config.ts` |
| Auditability — transactional, cross-app, queryable, diffed | Built | `platform/audit`, `/admin/audit` |
| Workflow — declarative transitions with permission, required reason, business guards, four-eyes | Built | `platform/workflow`, `app/kyc/workflow.ts` |
| Shared UI — shell, nav, tables, pagination, forms, audit timeline | Built | `platform/ui` |
| A real review workflow (claim, approve/reject/escalate, risk-tiered approval at score ≥ 80) | Built | `app/kyc` |
| A structurally different second app — environment-scoped config with production guardrails | Built | `app/flags` |
| Machine-facing API — token-authenticated flag reads per environment | Built | `app/api/flags` |
| Optimistic concurrency on both apps' writes | Built | `app/kyc/actions.ts`, `app/flags/actions.ts` |
| Connector catalog — one live HTTP connector with fixture fallback, eight placeholders | Built | `platform/connectors`, `/admin/connectors` |
| Tests — 140 across 12 files, including server actions and the API route against a real Postgres | Built | `*.test.ts`, `test/fixtures.ts` |
| CI — Postgres service, typecheck, tests, production build on every PR | Built | `.github/workflows/ci.yml` |

The second app is the evidence that matters. KYC and feature flags were built by two independent sessions in parallel
off the same platform commit and merged with no conflicts, because neither touched `platform/**`, the core schema or
the registry. Feature flags added environment-graded permissions and a service API without a single platform change.

Browser testing (recorded, against local Postgres) exercised the authorization claims adversarially: direct
navigation by unauthorized users, re-enabling disabled controls in the DOM and submitting anyway, non-assignee
decisions, forged high-risk approvals, four-eyes after self-escalation, and stale forms submitted after another tab
changed state. All were rejected server-side, and none wrote an audit row.

## What it did not demonstrate

- **No production deployment, IaC, monitoring, alerting, backups or on-call.** Nothing has ever run outside a laptop
  and CI.
- **Schema is applied with `prisma db push`, not migrations.** There is no `prisma/migrations` directory and no
  migration history: the CI job and the local setup both push the schema onto an empty database. That is fine for a
  prototype and unacceptable for production — a real deployment needs `prisma migrate`, reviewed migration files, and
  a forward-only path with rollback tested. Treat this as a day-one task, not a detail.
- **The seed is only partly additive.** `npm run db:seed` upserts users, roles, permissions and feature flags, leaving
  flag configuration edited through the UI alone; `RESET_DEMO=1 npm run db:seed` deletes and rebuilds the demo flags
  and their audit rows. KYC is the exception: `prisma/seed.kyc.ts` unconditionally deletes every KYC case, document
  and `kyc` audit row and regenerates them, so re-seeding always discards KYC work. Nothing reconciles a *removed*
  code-declared permission out of the database either. A production tool would need seed and demo data separated
  entirely.
- **Authentication is a demo.** Self-signed 8-hour cookie over seeded users. No SSO, MFA, SCIM, session revocation, or
  IdP group → role mapping.
- **No real KYC substance.** Document *metadata* only — no file storage, no encryption at rest, no access logging on
  document views, no sanctions/identity vendor integration, no retention policy.
- **No browser tests in CI.** UI regressions are caught by manual recorded runs, not automatically.
- **Audit is not tamper-evident.** Append-only by convention, not by hash chain, WORM storage or SIEM export.
- **The refunds dashboard was deliberately skipped**, so "app #3 costs about one session" is an estimate, not a
  measurement.
- **Concurrency — one known gap, below.**

### Known gap: concurrent writes

Both apps now use optimistic concurrency. KYC transitions update conditionally on the status and assignee that were
read; flag environment writes compare-and-swap on the row's `updatedAt`, supplied by the form that was rendered, so a
save cannot silently undo a production kill switch it never saw. Both failure modes were reproduced in the browser
before the fix and rejected after it, with no audit row written for the rejected attempt.

The residual gap: **only sequential staleness was tested.** Precisely simultaneous transactions were never forced, and
there is no automated concurrency test in CI — the guarantee rests on the compare-and-swap being correct, not on a
test that would catch it regressing. The flag API and the UI also both read without any locking, which is intended,
but means a reader can observe a state that is one write out of date. Before production: add a test that runs the two
writers concurrently, and decide whether flag reads need a version/ETag for callers that cache.

## Build vs buy vs hybrid

| | Power Apps (status quo) | Retool / Appsmith (self-hosted) | This platform (in-house) |
|---|---|---|---|
| Who authors apps | Business + engineers | Mostly engineers, some analysts | Engineers only |
| Customization ceiling | Low once rules get real | Medium — escape hatches, but a proprietary app format | None — it is ordinary application code |
| Data locality | Microsoft cloud / Dataverse | Our VPC | Our database, our schema |
| Cost shape | ~$250K/yr per-seat | Per-seat again, lower | Engineering time + hosting |
| Governance out of the box | Strong (DLP, environments, admin centre) | Moderate | Whatever we build |
| Time to a simple CRUD app | Hours | Hours | ~1 session |
| Time to something like our KYC rules | Slow — the low-code layer fights back | Medium | ~1 session |

**The hybrid is the honest recommendation, and it is not a fudge.** The three tools are not one problem: keep
Power Apps (or move to Retool/Appsmith) for simple form-over-data and M365-adjacent apps that business users want to
own, and build the workflow-heavy, audit-sensitive, product-adjacent tools — KYC, feature flags, refunds — in this
repo. That preserves citizen development where it earns its keep and stops paying a low-code tax where it doesn't.

The pure-build case is only strong if (a) engineers are accepted as the authors, and (b) most of the 13 planned apps
look like KYC rather than like a SharePoint list. Price Retool/Appsmith properly before deciding: this prototype
proves the in-house option is credible and cheap to extend, not that it beats the other two.

## Cost

| | Power Apps (status quo) | This platform |
|---|---|---|
| Licences | ~$250K/yr | $0 |
| Hosting | included | ~$3–8K/yr (one container + managed Postgres, plus backups) |
| Build cost per internal app | Low for simple, high for complex | ~1 agent session + human review |
| Migration of the 3 existing apps | — | one-off engineering, and a period of running both |
| Ongoing ownership | Microsoft + a part-time admin | **0.3–0.7 FTE**, call it $80–200K loaded |
| Marginal cost per additional user | Per-seat | Zero |

Ownership is not optional overhead — it is dependency and framework upgrades (Next.js and Prisma move fast), auth
changes, access reviews, incident response for tools that Compliance now depends on, and answering platform requests
from a dozen app teams. At 0.3 FTE with a healthy platform, the saving is most of the $250K; at 0.7 FTE with a
platform that has become a product, it is roughly a wash before hosting.

**So: a real but not dramatic year-one saving, improving as app count and headcount grow. Made on cost alone this is
a weak case. Made on control, customization and data locality it is a strong one** — and the cost argument only
becomes decisive if the per-app cost stays near one session, which is exactly what the app-#5 checkpoint below tests.

## Gaps before this is production-viable

Ranked by what I would do first:

1. **Migrations.** Replace `prisma db push` with reviewed `prisma migrate` files applied in CI. Everything else is
   reversible; schema drift is not.
2. **Real SSO** — Auth.js + Okta/Entra OIDC, IdP groups mapped to `Role` rows. Contained to `platform/auth`; ~half a day.
3. **Deployment** — container + managed Postgres, secrets from the existing manager, backups and PITR verified.
4. **Audit hardening** — hash-chained or append-only sink, retention/legal hold, SIEM export. Required before an
   auditor looks at the KYC tool.
5. **PII handling in KYC** — document storage with encryption at rest, access logging on views, retention.
6. **Concurrency test in CI**, plus Playwright smoke tests for the authorization paths currently checked by hand.
7. **Access reviews** — a periodic "who holds `kyc.case.approve.high_risk`" report. Cheap, and always asked for.
8. **Ownership model** — a named platform owner and a written rule for what may enter `platform/*`.

## Risks

- **The platform becomes a product.** `platform/*` grows a roadmap and a queue of app teams waiting on it. Mitigation:
  nothing enters the platform until a second app needs it; an app may always fork behaviour locally.
- **Bus factor.** Power Apps' maintenance risk is a vendor invoice; ours is a person. A named owner and a second
  familiar engineer are non-negotiable.
- **Agent-built code still needs review.** Speed of generation is not speed of merge. Two of the concurrency defects
  above were found by review and browser testing, not by tests — budget human review on every internal app,
  concentrated on permission checks and write paths.
- **Scope creep toward a no-code builder.** The first "let the business edit the form" request either gets refused or
  re-opens the Retool/Appsmith comparison.

## Recommendation

1. Settle "who authors the apps" first. If the answer is engineers, proceed on the hybrid split above.
2. Migrate the two simplest tools (feature flags, refunds) next quarter, keeping Power Apps live in parallel.
3. Migrate KYC only after migrations, SSO, audit hardening and PII handling are done.
4. Name a platform owner at 0.3–0.5 FTE before app #4, not after app #8.
5. Re-evaluate at app #5: if per-app cost is still ~1 session and platform churn is low, cancel the Power Apps
   renewal; if the platform has become a bottleneck, the honest move is to stay.
