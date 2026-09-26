# Should we replace Power Apps with an in-house internal-tools platform?

An engineering evaluation written from the prototype in this repository, to inform our build-vs-buy decision on
Power Apps. The platform and two apps were planned for ~2 hours of
agent time (`PLAN.md`); the actual work ran across several Devin sessions including review fixes and follow-up
features, and total effort was not measured precisely — treat any time figure here as an estimate. Everything
claimed as "built" below is in the tree on `main`; everything else is explicitly marked as not built. `PLAN.md` has
the up-front reasoning, `docs/ARCHITECTURE.md` how it works, `docs/KEY_DECISIONS.md` the decisions and their costs.

## The short answer

**The prototype supports a hybrid approach and justifies a controlled pilot. It does not yet justify a wholesale
Power Apps replacement.**

What the evidence supports: the in-house platform is technically credible; Devin can build reusable internal-app
infrastructure; two structurally different apps share the platform without modifying it; engineer-owned,
workflow-heavy, audit-sensitive tools are a plausible fit, and there the platform has a clear advantage —
customization without a ceiling, KYC data in our own database, no per-seat cost, and the same repo, CI, review and
tests as the product.

What it does not yet prove: the long-term cost of owning the platform; that future apps will consistently take one
session; that migrating off Power Apps is cheaper; that the company should cancel Power Apps; or that anything here is
production-ready. Power Apps keeps real advantages in citizen development, connectors, governance and vendor
operations. If the actual goal is that non-engineers build the apps, this architecture is the wrong one.

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
checked-in fixture, and importable as NEW KYC cases (keyed on `source` + `sourceId` = `login.uuid`, given a standard
`KYC-nnnnnn` reference). The connector does not flatten the payload: it keeps a documented 16-path subset of the raw
record (`name.first`, `location.country`, `dob.date`, `id.value`, …) and the admin decides at
`/admin/connectors/random-user/schema` which of those fill each `KycCase` column, via `{path}` templates such as
`{name.first} {name.last}` → `applicantName`. That is the real Power Apps-style mapping problem — nested source, flat
target, per-column choices, a preview against a sample record — and even this one-source version needed a validator,
a legacy-value upgrade, an "explicitly unmapped" state and an audit trail. The other eight — SharePoint,
Dataverse, SQL Server, Outlook, Teams, Salesforce, Dynamics 365, ServiceNow — are placeholders whose `listRecords()`
throws; there is no OAuth, no credential storage, no paging, no throttling and no write path behind any of them. One
unauthenticated read-only JSON endpoint took a single small module. Each of those eight, done properly, is an auth
flow, a token store with rotation, schema mapping, rate-limit handling, and an on-call owner. That distance — one
tile versus a catalog of several hundred maintained by the vendor — is the Power Apps gap, and it is the strongest
argument for keeping Power Apps (or a hybrid) wherever an internal tool's value is mostly in reaching M365 data.

Two different lists, worth keeping apart — Power Apps is not inferior at these; the question is fit for this company:

- **Not reproduced, and it matters here:** the connector catalog (if future tools live off M365/Dataverse data),
  citizen development (if Ops/Compliance are meant to author apps), tenant DLP and environment governance, the admin
  inventory and access-review reporting, the vendor SLA and compliance attestations.
- **Not reproduced, and probably not important for these three tools:** the formula language, the canvas layout model,
  mobile shells and offline mode, Power Automate flows (we have CI, cron and code), and premium connectors these
  workflow tools are unlikely to need.

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
| Tests — 161 across 14 files, including server actions, connector import and the API route against a real Postgres | Built | `*.test.ts`, `test/fixtures.ts` |
| Parallel development — KYC and flags built by two independent sessions off the same platform commit, merged without platform changes | Done once (one data point) | PRs #1, #2, #3 |
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

## Prototype vs Power Apps, area by area

Legend — **Demonstrated**: working in this repo. **Needs engineering**: not built here; would have to be.
**Power Apps OOTB**: comes with the licence. Power Apps is not inferior where it is strong; the question is fit.

| Area | Prototype | Power Apps |
|---|---|---|
| Development speed | **Demonstrated:** platform + two apps across a handful of sessions; the second app was one parallel session with no platform change (one data point; human review time not measured). | Simple form-over-data apps in hours by anyone; complex rules get slow as the low-code layer resists. |
| Customization | **Demonstrated:** anything expressible in TypeScript — tiered approvals, four-eyes, CAS writes, a service API. | Bounded by the canvas/formula model; escape hatches (PCF, custom connectors) are engineering work anyway. |
| Authentication | **Needs engineering:** demo cookie only; OIDC swap contained to `platform/auth`, not done. | **OOTB:** Entra ID, conditional access, MFA from the tenant. |
| RBAC | **Demonstrated:** permissions in code, roles in data, server-side at page and mutation, environment-graded. **Needs engineering:** IdP-group mapping, access-review reports. | **OOTB:** app sharing, security roles, environment roles; fine-grained business rules are harder. |
| Auditability | **Demonstrated:** transactional, cross-app, diffed, queryable; rejected actions leave no row. **Needs engineering:** tamper evidence, retention, SIEM. | **OOTB:** platform activity logging via Purview; business-level audit is app-by-app work. |
| Hosting | **Needs engineering:** nothing deployed; single container + managed Postgres is the design. | **OOTB:** Microsoft-hosted with SLA. |
| Deployment | **Demonstrated:** CI on every PR (typecheck, tests, build). **Needs engineering:** migrations, environments, release process. | **OOTB:** environments and solution pipelines; ALM discipline still on the team. |
| Connectors | **Demonstrated:** one HTTP connector, fixture fallback, raw-to-column mapping with preview and audit. **Needs engineering:** every further system. | **OOTB:** several hundred maintained connectors. The largest gap. |
| Governance | **Needs engineering:** no DLP, no environment boundaries, no inventory beyond the registry file. | **OOTB:** tenant DLP, environments, admin centre. |
| Maintenance | Ours: framework/dependency upgrades, security, on-call — assumed 0.3–0.7 FTE, not measured. | Vendor-maintained runtime; the team maintains apps. |
| Compliance responsibility | Ours end to end. | Shared: Microsoft's attestations cover the platform; the team owns app-level data handling. |
| Citizen / developer tooling | Engineers only: IDE, PRs, tests, agent-assisted generation. No business-user authoring. | Business analysts build and change apps without a deploy. |

## Build vs buy vs hybrid

| | Power Apps (status quo) | Retool / Appsmith (self-hosted) | This platform (in-house) |
|---|---|---|---|
| Who authors apps | Business + engineers | Mostly engineers, some analysts | Engineers only |
| Customization ceiling | Low once rules get real | Medium — escape hatches, but a proprietary app format | None — it is ordinary application code |
| Data locality | Microsoft cloud / Dataverse | Our VPC | Our database, our schema |
| Cost shape | ~$250K/yr per-seat | Per-seat again, lower | Engineering time + ownership + hosting |
| Governance out of the box | Strong (DLP, environments, admin centre) | Moderate | Whatever we build |
| Time to a simple CRUD app | Hours | Hours | est. ~1 session (not measured) |
| Time to something like our KYC rules | Slow — the low-code layer fights back | Medium | observed once: one session per app in this prototype, plus review |

**The hybrid is the honest recommendation, and it is not a fudge.** The three tools are not one problem: keep
Power Apps (or move to Retool/Appsmith) for simple form-over-data and M365-adjacent apps that business users want to
own, and build the workflow-heavy, audit-sensitive, product-adjacent tools — KYC, feature flags, refunds — in this
repo. That preserves citizen development where it earns its keep and stops paying a low-code tax where it doesn't.

The pure-build case is only strong if (a) engineers are accepted as the authors, and (b) most of the 13 planned apps
look like KYC rather than like a SharePoint list. Price Retool/Appsmith properly before deciding: this prototype
shows the in-house option is credible and was cheap to extend once, not that it beats the other two.

## Cost

Baseline: the stated **~$250K/yr** Power Apps spend. **Do not compare it with "$0 software cost."** The in-house
option replaces a licence with ownership: engineering time, platform maintenance, hosting, security, framework and
dependency upgrades, operational support, and compliance responsibility that Microsoft currently carries. The economic
question is whether the additional control and customization justify that ownership cost — not whether $250K goes to
zero.

Everything in the right-hand column below is a **planning estimate or assumption**, not a measurement from this
prototype. Nothing has been deployed, so hosting and ownership have never been observed.

| | Power Apps (status quo) | This platform (estimates) |
|---|---|---|
| Licences | ~$250K/yr (stated) | none, but see the rows below |
| Hosting | included | assumption: one container + managed Postgres with backups; low, but $0 today because nothing is deployed |
| Build cost per internal app | low for simple apps, high once rules get complex | one data point: the second app took one parallel session plus human review; not yet a trend |
| Migration of the 3 existing apps | — | one-off engineering plus a period of running both; not estimated |
| Ongoing ownership | Microsoft + a part-time admin | assumption: **0.3–0.7 FTE** (upgrades, auth, access reviews, incidents, platform requests) |
| Marginal cost per additional user | per seat | none |

At the low end of the ownership assumption most of the licence spend is recovered; at the high end — a platform that
has grown a roadmap — it is close to a wash before hosting. Which end applies is unknown until a few more apps exist.

**Made on cost alone the case is unproven. Made on control, customization and data locality it is a reasonable one
for the workflow-heavy tools** — and the cost argument only becomes decisive if per-app effort stays low, which is
exactly what the pilot below is meant to measure.

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

**Hybrid, via a controlled pilot.** Keep Power Apps for simple form-over-data and M365-centric apps and for anything
business users need to author. Pilot this platform on the engineer-owned, workflow-heavy tools, and make the
build-vs-buy decision on what the pilot measures rather than on this prototype.

Decision criteria to answer during the pilot:

1. **Who needs to author the applications?** Engineers only → this architecture fits. Business users → it does not;
   compare Retool/Appsmith or stay.
2. **How many of the 10+ future apps are workflow-heavy versus simple CRUD or M365-centric?** The platform's advantage
   is concentrated in the first group; the connector gap is concentrated in the second.
3. **What is the actual engineering effort per application?** The prototype has one data point (the second app, one
   session, no platform change). Measure apps #3–#5 including human review.
4. **How much ongoing platform ownership is required?** The 0.3–0.7 FTE figure is an assumption; track the real time
   spent on upgrades, auth, access reviews and platform requests.
5. **How important are Power Apps connectors and citizen development to the planned apps?** If most of them reach
   into M365 data or are owned by non-engineers, Power Apps remains the right tool for them.

Suggested sequence: name a platform owner before app #3; pilot with feature flags and refunds (lowest risk) while
Power Apps stays live; do migrations, SSO, audit hardening and PII handling before KYC moves; re-evaluate after app
#5 with measured per-app effort and ownership time. Only then decide whether the Power Apps footprint should shrink,
and by how much. A wholesale replacement is not supported by the current evidence; neither is dismissing the
in-house option — for the workflow-heavy tools it is credible, and the customization and data-locality advantages
are real.
