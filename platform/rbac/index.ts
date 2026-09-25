import { prisma } from "@platform/db";
import type { SessionUser } from "@platform/auth/session";

export class ForbiddenError extends Error {
  constructor(public permission: string) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export function can(user: SessionUser | null, permission: string): boolean {
  if (!user) return false;
  return user.permissions.includes(permission);
}

export function canAny(user: SessionUser | null, permissions: string[]): boolean {
  return permissions.some((p) => can(user, p));
}

export function assertPermission(user: SessionUser | null, permission: string): asserts user is SessionUser {
  if (!can(user, permission)) throw new ForbiddenError(permission);
}

export async function permissionsForUser(userId: string): Promise<string[]> {
  const rows = await prisma.userRole.findMany({
    where: { userId },
    select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } },
  });
  const keys = new Set<string>();
  for (const r of rows) for (const rp of r.role.permissions) keys.add(rp.permission.key);
  return [...keys].sort();
}

/**
 * Four-eyes: the actor may not approve work they themselves initiated.
 * Kept in the platform because every approval-shaped internal tool needs it.
 */
export function enforceFourEyes(actorId: string, initiatorId: string | null | undefined) {
  if (initiatorId && actorId === initiatorId) {
    throw new Error("Four-eyes violation: you cannot approve an action you initiated");
  }
}
