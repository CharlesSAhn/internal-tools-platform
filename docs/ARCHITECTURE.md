# Architecture

## Shape

One Next.js application, one Postgres database, many internal apps mounted as route groups, shared concerns in
`platform/*`. There is no per-app service, no API gateway, no message bus. At the scale in question (~13 internal
apps, ~60 engineers, a few hundred internal users) those would add operational surface without buying anything.

```
app/
  kyc/     KYC review queue           app/<id>/app.config.ts declares nav + permissions
  flags/   feature flag admin
  admin/   platform audit explorer
  api/     machine-facing endpoints (flag reads)
platform/
  auth  rbac  audit  workflow  ui  registry  db
prisma/schema/  core.prisma + one file per app
```

## Request path for a mutation

```
server action
  └─ requirePermission(...)            server-side authz, never a hidden button
  └─ resolveTransition(machine, ...)   state legality + permission + reason + business guard
  └─ prisma.$transaction(tx =>
        update entity
        writeAudit(tx, user, { before, after, reason })   same transaction as the write
     )
  └─ revalidatePath(...)
```

The three lines above are the platform. Everything else an internal app needs — a table, a form, a detail page — is
ordinary application code, and deliberately so.

## Authorization model

- **Permissions are code.** Each app exports them from `app/<id>/app.config.ts`. They are the vocabulary of the
  system and belong next to the code that enforces them.
- **Roles are data.** `Role`, `RolePermission`, `UserRole` live in Postgres; the seed reconciles code-declared
  permissions into the `Permission` table and applies the demo role mapping. In production, role assignment would be
  driven from IdP groups.
- **Enforcement is server-side, twice.** Page/route level via `requirePermission()`, mutation level inside the server
  action. The UI's `can()` checks only control what is rendered.
- **Four-eyes** is a platform helper rather than app logic because every approval-shaped internal tool needs it.

## Audit model

`AuditEvent(actor, app, entityType, entityId, action, reason, before, after, at)` — append-only, no update path
exposed. Written with the same `tx` as the mutation, so "the change happened but the audit row didn't" is not a
reachable state. `before`/`after` are JSONB of the changed fields only; `diffFields()` renders them.

Not done (and worth doing before production): hash-chaining rows for tamper evidence, shipping to a SIEM, and a
retention/legal-hold policy.

## Workflow model

`defineMachine({ transitions: [{ from, to, action, permission, requiresReason, guard }] })`, ~80 lines. It gives
apps: legal-transition enforcement, permission binding per action, mandatory reasons, business guards, and a
`availableTransitions()` helper that drives the UI so the buttons and the server can never disagree.

It is deliberately *not* a workflow engine: no persistence of its own, no timers, no parallel branches, no DSL. If an
app needs those, that app should own them until a second app needs them too.

## Authentication

The prototype signs its own 8-hour session cookie (`jose`, HS256) against a seeded user directory so the demo runs
with no external IdP and no per-run OAuth setup. The surface area is two functions — `createSession()` and
`getCurrentUser()` — so swapping in Auth.js with an Okta/Entra OIDC provider is contained to `platform/auth`, plus
mapping IdP groups onto `Role` rows. Estimated half a day, and there is no architectural discovery left in it.

## Adding internal app #3

1. `app/refunds/app.config.ts` — name, nav entry, permission list.
2. `prisma/schema/refunds.prisma` — models.
3. `prisma/seed.refunds.ts` — demo data (and add the role→permission mapping to `seed.core.ts`).
4. One line in `platform/registry/index.ts`.
5. Pages and server actions using `requirePermission`, `resolveTransition`, `writeAudit`, `DataTable`.

No changes to auth, audit, nav, or another app.

## Deployment (designed, not built)

Single container or Vercel deployment, managed Postgres, secrets from the existing secret manager, migrations run in
CI on merge to main. Internal tools sit behind the same ingress/SSO as the rest of the internal estate. Backups and
PITR come from the managed Postgres. None of this is implemented in the prototype.
