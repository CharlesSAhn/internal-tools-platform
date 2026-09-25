import type { SessionUser } from "@platform/auth/session";

export type Transition<S extends string, E> = {
  from: S;
  to: S;
  action: string;
  permission: string;
  requiresReason?: boolean;
  /** additional business rule; throw or return a message to deny */
  guard?: (ctx: { user: SessionUser; entity: E }) => string | void;
};

export type Machine<S extends string, E> = {
  name: string;
  transitions: Transition<S, E>[];
};

export function defineMachine<S extends string, E>(machine: Machine<S, E>): Machine<S, E> {
  return machine;
}

export class TransitionError extends Error {}

export function availableTransitions<S extends string, E>(
  machine: Machine<S, E>,
  current: S,
  user: SessionUser,
  entity: E,
): Transition<S, E>[] {
  return machine.transitions.filter(
    (t) => t.from === current && user.permissions.includes(t.permission) && !t.guard?.({ user, entity }),
  );
}

/**
 * Single choke point for state changes: resolves the transition, enforces the
 * permission, the reason requirement and the business guard. Callers perform the
 * write plus the audit row in one transaction.
 */
export function resolveTransition<S extends string, E>(
  machine: Machine<S, E>,
  args: { current: S; action: string; user: SessionUser; entity: E; reason?: string | null },
): Transition<S, E> {
  const t = machine.transitions.find((x) => x.from === args.current && x.action === args.action);
  if (!t) throw new TransitionError(`Action "${args.action}" is not allowed from state "${args.current}"`);
  if (!args.user.permissions.includes(t.permission))
    throw new TransitionError(`Missing permission: ${t.permission}`);
  if (t.requiresReason && !args.reason?.trim()) throw new TransitionError("A reason is required for this action");
  const denied = t.guard?.({ user: args.user, entity: args.entity });
  if (denied) throw new TransitionError(denied);
  return t;
}
