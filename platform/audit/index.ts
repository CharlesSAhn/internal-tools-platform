import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@platform/auth/session";
import type { Tx } from "@platform/db";

export type AuditInput = {
  app: string;
  entityType: string;
  entityId: string;
  action: string;
  reason?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
};

/**
 * Must be called with the same transaction client as the mutation it records:
 * an audit row that can be lost independently of the change is not an audit log.
 */
export async function writeAudit(tx: Tx, actor: SessionUser, input: AuditInput) {
  await tx.auditEvent.create({
    data: {
      actorId: actor.id,
      actorEmail: actor.email,
      app: input.app,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      reason: input.reason ?? null,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
    },
  });
}

export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { field: string; before: unknown; after: unknown }[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: { field: string; before: unknown; after: unknown }[] = [];
  for (const field of keys) {
    const b = before?.[field];
    const a = after?.[field];
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ field, before: b, after: a });
  }
  return out;
}
