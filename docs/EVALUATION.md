# Should we replace Power Apps with an in-house internal-tools platform?

An honest assessment, written from building the prototype in this repo (~2 hours of agent time). Read
`PLAN.md` for the up-front reasoning and `docs/ARCHITECTURE.md` for how it works.

## The short answer

**Probably yes for engineer-owned workflow tools, and the deciding factor is not the $250K.** The license saving is
real but is partly consumed by platform ownership. The defensible reasons to move are customization, keeping KYC data
in our own database, no per-user seat tax as the company grows, and internal tools living inside the same repo, CI,
code review, and observability as the product.

**No if the actual goal is that non-engineers build the apps.** Nothing in this prototype gives Ops or Compliance an
app builder, and building one is a different (much larger) project. That question should be settled before any
migration is approved.

## What the prototype demonstrates

| Capability | Status | Where |
|---|---|---|
| Reusable platform consumed by two unlike apps | Built | `platform/*` |
| Authentication | Demo session cookie; OIDC is a contained swap | `platform/auth` |
| Authorization (RBAC, permissions in code, roles as data) | Built, enforced server-side at route *and* mutation | `platform/rbac` |
| Auditability (transactional, cross-app, queryable, diffed) | Built | `platform/audit`, `/admin/audit` |
| Workflow / state transitions with guards, reasons, four-eyes | Built | `platform/workflow` |
| Shared UI (tables, forms, shell, nav) | Built | `platform/ui` |
| A real review workflow | Built | `app/kyc` |
| A structurally different second app + machine-facing API | Built | `app/flags`, `/api/flags` |
| Tests around the rules that matter | Built (unit) | `*.test.ts` |
| CI | Built | `.github/workflows/ci.yml` |
| Deployment, monitoring, backups, SSO, SCIM | **Not built** | see Gaps |

The second app is the evidence that matters. It reuses auth, RBAC, audit, workflow guards, nav and tables, and it
adds environment-scoped permissions and a service-facing API without touching platform code.

Both apps were built in parallel sessions off the same platform commit and merged with no conflicts: neither session
edited `platform/**`, the core schema, or the registry. On the integrated branch, typecheck, 36 unit tests across 5
files, a production build, a clean-database seed, and the `/api/flags` service endpoint (401 unauthenticated, correct
per-environment payload with a token) all pass.

## Development speed

Observed in this exercise, with Devin doing the work:

| Unit of work | Actual |
|---|---|
| Platform foundation (auth, RBAC, audit, workflow, UI kit, registry, CI, seed) | ~40 min, one session |
| KYC review queue on top of it | one session, in parallel |
| Feature-flag admin on top of it | one session, in parallel |
| Estimated cost of internal app #3 (the refunds dashboard we skipped) | ~1 session, touching only `app/refunds/**` |

The important number is the last one. The platform's value is entirely in whether app #3 through #13 are cheap. The
architecture is designed so that each is a directory, a schema file, and a line in the registry — and the two apps
built here were genuinely developed in parallel by two independent sessions with no shared-file conflicts, which is
the practical test of that claim.

Power Apps' comparable number for a simple form-over-data app is faster (hours, by a non-engineer). Power Apps' number
for something with our KYC app's rules — four-eyes, risk-tiered approval permissions, transactional audit — is *not*
faster, because those live in a low-code layer that fights back.

## Honest cost model

| | Power Apps (status quo) | This platform |
|---|---|---|
| Licences | ~$250K/yr | $0 |
| Hosting | included | ~$3–8K/yr (one app container + managed Postgres) |
| Build cost per new internal app | low for simple, high for complex | ~1 agent session, plus human review |
| Ongoing ownership | Microsoft + a part-time admin | **0.3–0.7 FTE** (~$80–200K loaded): dependency upgrades, auth changes, access reviews, on-call, platform requests from 13 app teams |
| Marginal cost per additional user | per-seat | zero |

Net: a real but not dramatic saving in year one, improving as app count and headcount grow. **If the case is being
made on cost alone, it is a weak case.** It is a strong case on control and fit.

## What Power Apps gives us that we would have to build or give up

Would have to build (not in this prototype):
- Connector catalog — Dataverse, SharePoint, Dynamics, Outlook, and the rest of the M365 estate. If these internal
  tools need to read/write M365 data, each integration is bespoke work here.
- Environment governance — dev/test/prod app environments, DLP policies, an admin centre with an app inventory,
  and per-app sharing controls. We have one deployment and one nav.
- Non-engineer authoring, and the associated "the business changes a dropdown without a deploy" property.
- Mobile app shells and offline behaviour.
- Compliance posture inherited from the vendor: Microsoft's attestations, their SLA, their support contract. We
  become the SLA.

Would give up, and should not care:
- The formula language, canvas layout, Power Automate flows (we have CI, cron and code), and premium connectors we
  are unlikely to use for these three tools.

## Gaps before this is production-viable

Ranked by what I would do first:
1. **Real SSO** — Auth.js + Okta/Entra OIDC, IdP groups mapped to roles. Contained to `platform/auth`; ~half a day.
2. **Deployment and migrations** — container + managed Postgres, migrations in CI, secrets from the existing manager, backups/PITR verified. 1–2 sessions.
3. **Audit hardening** — hash-chained rows or an append-only sink, retention policy, SIEM export. Required before an auditor looks at the KYC tool.
4. **PII handling in KYC** — document storage with encryption at rest, access logging on document views, data retention. The prototype stores document *metadata* only, deliberately.
5. **Access reviews** — a quarterly "who has `kyc.case.approve.high_risk`" report. Cheap to add, always asked for.
6. **Integration tests against a real database** and Playwright smoke tests in CI. Currently unit tests only.
7. **Ownership model** — a named platform owner and a rule for what goes in `platform/*` versus an app.

## Risks

- **The platform becomes a product.** The failure mode is `platform/*` growing into a framework with its own roadmap
  and a queue of 13 app teams waiting on it. Mitigation: nothing enters the platform until a second app needs it;
  an app may always fork platform behaviour locally.
- **Bus factor.** Power Apps' maintenance risk is a vendor bill; ours is a person. A named owner and a second
  familiar engineer are non-negotiable.
- **Agent-built code still needs review.** Speed of generation is not speed of merge. Budget human review on every
  internal app, especially around permission checks.
- **Scope creep into a no-code builder.** If a single stakeholder asks for "let the business edit the form," resist
  or re-open the Retool/Appsmith comparison.

## The alternative we should price before deciding

Self-hosted **Retool** or **Appsmith** sits between the two options: far cheaper than Power Apps, gives non-engineers
a builder, keeps data in our VPC — but reintroduces per-seat licensing, a proprietary app format, and a ceiling on
customization that this KYC workflow would approach quickly. A fair evaluation prices all three. This prototype only
proves the in-house option is credible and cheap to extend; it does not prove it is the best of the three.

## Recommendation

1. Settle the "who builds the apps" question first. If the answer is engineers, proceed.
2. Migrate the two simplest tools (feature flags, refunds) onto this platform next quarter, keeping Power Apps live.
3. Migrate KYC only after audit hardening and PII handling are done.
4. Name a platform owner at 0.3–0.5 FTE before app #4, not after app #8.
5. Re-evaluate at app #5: if per-app cost is still ~1 session and platform churn is low, cancel the Power Apps
   renewal; if the platform has become a bottleneck, the honest move is to stay.
