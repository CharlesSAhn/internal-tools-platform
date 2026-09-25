# Demo script (~8 minutes)

```bash
cp .env.example .env && npm install && npx prisma db push && npm run db:seed && npm run dev
```

Seeded demo users (sign in by picking one at `/login` — no password, demo auth only):

| User | Roles | Point of the user |
|---|---|---|
| `avery.admin@example.com` | admin | sees everything |
| `riley.reviewer@example.com` | kyc_reviewer | standard reviewer — blocked on high-risk approvals |
| `sam.senior@example.com` | kyc_senior_reviewer | can approve high-risk cases |
| `quinn.viewer@example.com` | kyc_viewer, auditor | read-only + audit log |
| `eli.editor@example.com` | flags_editor | dev/staging only — blocked from production |
| `fran.flagadmin@example.com` | flags_admin | can change production |

## 1. The platform is the point (1 min)

Home page as `quinn.viewer` — only the apps her roles grant are listed, the others show the missing permission.
Note: nav, permissions and access are derived from each app's `app.config.ts`; nothing app-specific lives in the shell.

## 2. KYC: a real workflow, not CRUD (3 min)

As `riley.reviewer`:
- `/kyc` — queue with filters (status, risk band, assigned to me) and server-side pagination.
- Open a **low-risk** case → Claim → Approve. Show the audit timeline entry appearing with actor, action and diff.
- Open a **high-risk (≥80)** case → Claim → Approve is refused: the approval requires `kyc.case.approve.high_risk`.
- Escalate it with a reason (the reason is mandatory — the transition is rejected without it).

As `sam.senior`:
- Pick up the escalated case and approve it. Point out that Riley could not have claimed it back — four-eyes is
  enforced in the platform, not in the page.

## 3. Feature flags: a different shape of app, same platform (2 min)

As `eli.editor`:
- `/flags` → open a flag → change the **staging** rollout. Works.
- Try to change **production** → refused server-side (not a hidden button).

As `fran.flagadmin`:
- Change production with a change reason; use the **kill switch**.
- `curl -H "Authorization: Bearer dev-service-token" 'http://localhost:3000/api/flags?env=prod'` — internal tools
  serving services, not just humans. Without the header: 401.

## 4. Auditability across every app (1 min)

As `avery.admin` → `/admin/audit`: one log, both apps, every mutation, with actor, reason and field-level diff.
Every row was written in the same database transaction as the change it describes.

## 5. What it costs to add app #3 (1 min)

Walk `app/flags/` and show that it contains only the flag domain: no auth code, no audit plumbing, no table
component. Then `platform/registry/index.ts` — adding the refunds dashboard is one line plus one directory.

Close with `docs/EVALUATION.md`: the recommendation, the ownership cost, and what Power Apps still gives us.
