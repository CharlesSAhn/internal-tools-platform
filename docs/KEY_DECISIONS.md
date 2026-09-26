# Key decisions (one page)

**Problem.** A Series C fintech (~60 engineers) pays ~$250K/yr for Power Apps to run three internal tools and plans
10+ more. Can a small, reusable, engineer-owned platform build customized internal tools quickly while keeping enough
of what makes Power Apps valuable — and is owning it worth it?

**Key assumptions.** Engineers, not business users, author the apps (if that is wrong, this architecture is wrong).
Most planned apps look like KYC (workflow, permissions, audit) rather than like a SharePoint list. Licence savings are
partly consumed by ownership (~0.3–0.7 FTE), so the case must rest on customization, data locality and no per-seat
tax. Prototype quality: credible, not production.

**What was built** (all on `main`). `platform/*` — demo session auth, RBAC (permissions in code, roles in data),
transactional audit log, declarative state-machine helper, UI kit, app registry, connector catalog. Two unlike apps:
KYC review queue (claim/decide/escalate, high-risk gate, four-eyes, optimistic concurrency, audit timeline) and
feature flags (dev/staging/prod, prod-only permission, kill switch, compare-and-swap saves, token read API).
`/admin/audit`, `/admin/connectors` with one live connector (Random User, fixture fallback) whose raw fields an admin
maps onto `KycCase` columns via `{path}` templates, plus eight placeholder tiles. 161 tests, CI with typecheck, tests
and build.

**Architectural decisions.**
1. Platform = libraries and conventions, not a metadata-driven app engine; no canvas or formula language.
2. One Next.js app, one Postgres, apps as route groups; each app owns `app/<id>`, its schema file and seed.
3. Permissions declared in code, roles stored as data, `admin` gets everything; enforcement server-side at page *and*
   mutation, UI `can()` is presentation only.
4. Audit rows written in the same transaction as the write; a rejected action leaves no trace.
5. Workflow as an ~80-line `defineMachine` (from/to/permission/reason/guard) shared by both apps, not an engine.
6. Optimistic concurrency everywhere users can collide (KYC conditional updates, flag `updatedAt` CAS).
7. Connector boundary is `{ id, raw }`: a documented raw subset, mapped per column with a validated template, an
   explicit "unmapped" state, and audit — rather than flattening in the adapter.
8. Nothing enters `platform/*` until a second app needs it.

**Important tradeoffs.** Non-engineers cannot author apps. Adding a permission needs a deploy. All apps share one
release train and blast radius. Demo cookie auth instead of SSO (contained swap, not done). `prisma db push` instead of
migrations. Seed is partly additive: KYC data is wiped on every seed. One real connector versus a catalog of hundreds
— the connector gap is the strongest argument for keeping Power Apps somewhere. Tests cover rules and actions, not
rendering; no browser tests in CI.

**Biggest risks.** The platform becomes a product with a roadmap and a queue. Bus factor: ownership is a person, not
an invoice. Agent-generated code shifts cost to review — two concurrency defects were found by review and browser
testing, not tests. Scope creep toward a no-code builder reopens the Retool/Appsmith question. Precisely simultaneous
writes were never forced in testing.

**What should happen next.** Decide who authors apps. Then, in order: migrations, real SSO with IdP-group → role
mapping, deployment with backups, audit hardening (tamper evidence, retention, SIEM), PII handling for KYC, a
concurrency test and browser smoke tests in CI, access-review reporting, a named platform owner. Migrate flags and
refunds first, KYC last; re-evaluate at app #5 on measured per-app cost.

**Intentionally not built.** Refunds dashboard; SSO/MFA/SCIM; migrations; deployment/monitoring/on-call; any
connector beyond one read-only HTTP GET (no OAuth, credential store, paging, write-back); a generic mapping engine;
tamper-evident audit; KYC file storage/encryption/vendor checks; browser tests in CI; citizen-developer tooling, mobile,
offline, Power Automate equivalents.
