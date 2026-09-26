# Key decisions (one page)

**Problem.** ~60 engineers, ~$250K/yr on Power Apps, three internal tools, 10+ planned. Can a small, reusable,
engineer-owned platform built with Devin carry customized internal tools — and what would we still owe Power Apps?

**Assumptions.** Engineers author the apps. Most future apps are workflow-shaped, not SharePoint lists. Licence
savings are partly consumed by platform ownership (assumed 0.3–0.7 FTE, not measured). Prototype quality throughout.

**Built** (all on `main`, 161 tests in 14 files, CI = typecheck + tests + build on Postgres): `platform/*` (demo
session auth, RBAC, transactional audit, ~80-line state-machine helper, UI kit, registry, connector catalog); KYC
review queue; feature-flag admin with a token read API; `/admin/audit`; `/admin/connectors` with one live connector
and admin-editable raw-field → column mapping. Not built: refunds dashboard.

| Decision | Why | Evidence | Cost |
|---|---|---|---|
| Platform = libraries + conventions, not a metadata app engine | A runtime engine is Power Apps' architecture; it pays off only when code is expensive, which with Devin it is not | Both apps are ordinary TypeScript importing `@platform/*`; `platform/*` stayed at ~a dozen small modules | Non-engineers cannot author apps |
| One Next.js app, one Postgres, apps as route groups, per-app schema/seed files | ~13 apps and a few hundred users do not justify per-app services | KYC and flags built by two parallel sessions off one commit, merged with no `platform/**` change (one data point) | Shared release train and blast radius |
| Permissions in code, roles in data; enforced server-side at page *and* action; UI `can()` is presentation only | Hidden buttons are not access control | Browser tests forged requests past disabled controls; all rejected, no audit row written | Adding a permission needs a deploy; IdP-group mapping not built |
| Audit row written in the same transaction as the mutation | "Change happened, audit didn't" must be unreachable | `writeAudit(tx, …)` in every action; rejected actions leave nothing; `/admin/audit` spans both apps | Append-only by convention only — no hash chain, retention or SIEM |
| Declarative transitions (`defineMachine`) shared by KYC and flags | Legality + permission + reason + guard is the same shape in both apps; one table drives UI and server | Four-eyes, high-risk gate, prod-only writes and the kill switch all go through it | Not a workflow engine: no persistence, timers or branches |
| Optimistic concurrency (KYC conditional update; flag `updatedAt` compare-and-swap) | A stale save must not undo a production kill switch or another reviewer's decision | Both races reproduced in the browser sequentially before the fix and rejected after | Truly simultaneous transactions never forced; no concurrency test in CI |
| Connector boundary is `{ id, raw }` with a documented raw subset mapped per column via validated `{path}` templates | Flattening in the adapter hides the real mapping problem | One live source (Random User) with fixture fallback, preview, unmapped state, audit; upserts on `source`+`sourceId` | Eight catalog tiles are placeholders; no OAuth, paging or write-back anywhere |
| Demo cookie auth (`jose` HS256, seeded users), `prisma db push`, nothing deployed | Keeps the prototype runnable in minutes; agreed scope for this exploration | Runs locally and in CI from a clean database | Not production: no SSO/MFA, no migrations, no hosting/backups/on-call |
| Tests cover rules and server actions against real Postgres, not rendering | Authorization and audit are the failure modes that matter | 161 tests; browser runs recorded manually | No browser tests in CI |

**Biggest risks.** The platform grows a roadmap and becomes a product. Ownership is a person, not an invoice.
Agent-generated code shifts cost to review — two concurrency defects were found by review and browser testing, not by
tests. A "let the business edit the form" request reopens the Retool/Appsmith question.

**Recommendation.** Hybrid via a controlled pilot; not a wholesale replacement. Keep Power Apps for simple,
M365-centric or business-authored apps; pilot this platform on engineer-owned workflow tools (flags, refunds first; KYC
after SSO, migrations, audit hardening, PII handling). Name a platform owner before app #3; measure per-app effort and
ownership time through app #5; decide the Power Apps footprint then. Full reasoning: `docs/EVALUATION.md`.
