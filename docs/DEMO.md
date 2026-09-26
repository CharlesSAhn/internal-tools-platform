# Demo script (5-minute recorded walkthrough)

Setup beforehand (not on camera): `cp .env.example .env && npm install && npx prisma db push && npm run db:seed &&
npm run dev`, then open `http://localhost:3000` in two browser profiles so switching users is instant. Sign in at
`/login` by picking a seeded user — no password, demo auth only:

| User | Roles | Used for |
|---|---|---|
| `riley.reviewer@example.com` | kyc_reviewer | standard reviewer, blocked on high-risk approval |
| `sam.senior@example.com` | kyc_senior_reviewer | approves the escalated high-risk case |
| `eli.editor@example.com` | flags_editor | dev/staging only |
| `fran.flagadmin@example.com` | flags_admin | production + kill switch |
| `avery.admin@example.com` | admin | audit explorer, connectors |

Show behaviour, not code. Skip anything not listed.

## 0:00–0:30 — problem and thesis

"~60 engineers, ~$250K/yr on Power Apps, three internal tools, 10+ planned. The question is not whether Devin can
write a CRUD app; it is whether a small engineer-owned platform can carry customized internal tools with the
properties that matter — RBAC, audit, workflow — and what we would still owe Power Apps. This is a prototype; the
evaluation says exactly where it stops."

## 0:30–1:00 — architecture / platform

Home page as `avery.admin`: nav lists KYC Review, Feature Flags, Audit log, Connectors — app links come from each app's
`app.config.ts`, admin links from platform permissions; a user without the permission sees neither the link nor
the page. One sentence on the shape: one Next.js app, one Postgres, apps as route groups, `platform/*` is
libraries and conventions — no metadata engine, no canvas. Every mutation goes `requirePermission → transition →
transaction(write + audit)`.

## 1:00–2:15 — KYC workflow and security

As `riley.reviewer`:
- `/kyc` queue, filter to a **high-risk (≥ 80)** unassigned case, open it, **Claim**.
- **Approve** → refused: requires `kyc.case.approve.high_risk`. Say: "server-side, not a hidden button — browser
  testing forged this request past a disabled control and it was still rejected with no audit row".
- **Escalate** without a reason → refused (reason mandatory). Escalate with a reason → succeeds; timeline shows actor,
  action, reason, diff.

As `sam.senior`: open the escalated case, **Approve** → succeeds. Say: "Riley could not approve her own escalation —
four-eyes is a platform helper, not KYC code."

## 2:15–3:15 — Feature Flags

As `eli.editor`: open `checkout.new_pricing`, change the **staging** rollout → saved, list updates. Try **production**
→ refused (`flags.write.prod`).

As `fran.flagadmin`: change production with a reason; hit the **kill switch**. Then in a terminal:
`curl -H "Authorization: Bearer dev-service-token" 'localhost:3000/api/flags?env=prod'` → the flag is off for
services too; without the header → 401. Say: "same platform, structurally different app — config, environments, a
machine-facing API — and it needed no platform change."

## 3:15–3:45 — audit and parallel development

As `avery.admin`, `/admin/audit`: one log, both apps, every mutation above with actor, reason and field diff, written
in the same transaction as the change. Then briefly: KYC and flags were built by two Devin sessions in parallel off
the same platform commit and merged without touching `platform/**` — one data point, but the one the thesis needs.

## 3:45–4:30 — what Power Apps still provides

`/admin/connectors`: nine tiles, one real. Open Random User → **Schema**: raw fields (`name.first`, `nat`,
`login.uuid`…) mapped onto `KycCase` columns with a preview; **Pull now** → eight cases appear with `KYC-nnnnnn`
references and `random-user` in the Source column (seeded cases show `manual`). Say: "this one read-only HTTP source took a small module and still needed a
validator, an unmapped state and audit. The other eight tiles are the gap: Power Apps ships hundreds of maintained
connectors, plus citizen development, tenant DLP/governance, an admin inventory and a vendor SLA. None of that is
reproduced here."

## 4:30–5:00 — recommendation

"The evidence supports a hybrid and a controlled pilot, not a wholesale replacement. Keep Power Apps for simple,
M365-centric or business-authored apps; pilot this platform on engineer-owned, workflow-heavy tools — flags and refunds
first, KYC after SSO, migrations and audit hardening. Measure per-app effort and platform ownership through app #5,
then decide how much of the Power Apps footprint should shrink. Not production-ready: demo auth, `db push`, nothing
deployed."
