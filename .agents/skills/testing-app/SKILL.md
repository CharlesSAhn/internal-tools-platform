---
name: testing-internal-tools-platform
description: Browser testing of demo identities, server authorization, stale forms and audit integrity.
---

# Internal tools platform testing

## Local setup
- Source `~/.nvm/nvm.sh` before npm commands.
- Use the repository blueprint for PostgreSQL, Prisma and seed setup.
- Check port 3000 for an existing production or development server before starting.
- Do not run `next build` concurrently with `next dev` in the same checkout:
  both write `.next`. Missing chunk/manifest errors may require stopping dev,
  removing generated `.next`, and restarting after other builds finish.

## Demo authentication and stale forms
- `/login` lists seeded users with passwordless Sign in buttons.
- Two tabs share the auth cookie. Render a form in tab A, sign in as another
  seeded identity in tab B, then submit A without refreshing to test server auth.
- For stale-write tests, render forms in two tabs before changing data. Submit
  one, then the stale other. Verify the visible error, persisted values and
  unchanged audit count; hidden buttons alone do not prove authorization.
- KYC IN_REVIEW decisions are assignee-only. ESCALATED cases are unassigned;
  a different senior/admin may decide, while the escalator is blocked by four-eyes.

## Evidence
- `/admin/audit` supports app and actor-email filters.
- Compare read-only AuditEvent counts immediately before/after denied mutations.
- Use service bearer-token HTTP requests, not extracted browser cookies, for
  `/api/flags?env=prod`.

## Devin Secrets Needed
- Local demo `.env` requires DATABASE_URL, SESSION_SECRET and FLAGS_API_TOKEN.
- Seeded demo identities require no passwords or external identity-provider secrets.
