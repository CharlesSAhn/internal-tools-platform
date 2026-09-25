import type { SessionUser } from "@platform/auth/session";
import { defineMachine, resolveTransition, TransitionError } from "@platform/workflow";

export type FlagEnvName = "DEV" | "STAGING" | "PROD";

export const ENVS: FlagEnvName[] = ["DEV", "STAGING", "PROD"];

export const VIEW_PERMISSION = "flags.app.view";
export const CREATE_PERMISSION = "flags.flag.create";

/** Environment-graded authorization: prod is a different permission, not a stricter UI. */
export function writePermission(env: FlagEnvName): string {
  return env === "PROD" ? "flags.write.prod" : "flags.write.nonprod";
}

export function requiresReason(env: FlagEnvName): boolean {
  return env === "PROD";
}

type EnvEntity = { env: FlagEnvName };
type EnvState = "on" | "off";

/**
 * One transition per (environment, action) so the permission and the
 * reason requirement live in the same declarative table the KYC app uses.
 */
export const flagEnvMachine = defineMachine<EnvState, EnvEntity>({
  name: "flag-env-state",
  transitions: ENVS.flatMap((env) => {
    const permission = writePermission(env);
    const reason = requiresReason(env);
    return [
      { from: "off" as const, to: "on" as const, action: `${env}:enable`, permission, requiresReason: reason },
      { from: "on" as const, to: "off" as const, action: `${env}:disable`, permission, requiresReason: reason },
      { from: "on" as const, to: "on" as const, action: `${env}:update`, permission, requiresReason: reason },
      { from: "off" as const, to: "off" as const, action: `${env}:update`, permission, requiresReason: reason },
    ];
  }),
});

export function transitionAction(env: FlagEnvName, current: boolean, next: boolean): string {
  if (current === next) return `${env}:update`;
  return next ? `${env}:enable` : `${env}:disable`;
}

/**
 * The single choke point for every flag state change — the server actions and
 * the kill switch both go through it, so the UI is never the enforcement.
 */
export function assertCanChangeEnv(
  user: SessionUser,
  args: { env: FlagEnvName; currentEnabled: boolean; nextEnabled: boolean; reason?: string | null },
): void {
  resolveTransition(flagEnvMachine, {
    current: args.currentEnabled ? "on" : "off",
    action: transitionAction(args.env, args.currentEnabled, args.nextEnabled),
    user,
    entity: { env: args.env },
    reason: args.reason,
  });
}

export function canChangeEnv(
  user: SessionUser,
  args: { env: FlagEnvName; currentEnabled: boolean; nextEnabled: boolean; reason?: string | null },
): string | null {
  try {
    assertCanChangeEnv(user, args);
    return null;
  } catch (e) {
    if (e instanceof TransitionError) return e.message;
    throw e;
  }
}

export const STALE_STATE_MESSAGE = "Flag changed under you. Reload.";

/**
 * Optimistic concurrency: the form carries the `updatedAt` it was rendered
 * from, so a save that lost a race (a kill switch, another editor) is
 * rejected instead of silently reinstating a stale configuration.
 */
export function assertFresh(expectedUpdatedAt: unknown, actualUpdatedAt: Date): void {
  const expected = String(expectedUpdatedAt ?? "");
  const expectedMs = expected ? new Date(expected).getTime() : NaN;
  if (Number.isNaN(expectedMs) || expectedMs !== actualUpdatedAt.getTime()) {
    throw new TransitionError(STALE_STATE_MESSAGE);
  }
}

export function normalizeRollout(value: unknown): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) throw new TransitionError("Rollout percentage must be a number");
  if (n < 0 || n > 100) throw new TransitionError("Rollout percentage must be between 0 and 100");
  return n;
}

export function parseTargetUserIds(value: unknown): string[] {
  return String(value ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export { TransitionError };
