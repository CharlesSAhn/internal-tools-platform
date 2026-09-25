import { describe, expect, it } from "vitest";
import { defineMachine, resolveTransition, availableTransitions, TransitionError } from "./index";
import type { SessionUser } from "@platform/auth/session";

type S = "NEW" | "IN_REVIEW" | "APPROVED";
type Entity = { ownerId: string | null };

const machine = defineMachine<S, Entity>({
  name: "test",
  transitions: [
    { from: "NEW", to: "IN_REVIEW", action: "claim", permission: "t.claim" },
    {
      from: "IN_REVIEW",
      to: "APPROVED",
      action: "approve",
      permission: "t.decide",
      requiresReason: true,
      guard: ({ user, entity }) => (entity.ownerId === user.id ? undefined : "Only the assignee can decide"),
    },
  ],
});

const user = (id: string, permissions: string[]): SessionUser => ({
  id,
  email: `${id}@example.com`,
  name: id,
  roles: [],
  permissions,
});

describe("workflow", () => {
  it("resolves a permitted transition", () => {
    const t = resolveTransition(machine, {
      current: "NEW",
      action: "claim",
      user: user("u1", ["t.claim"]),
      entity: { ownerId: null },
    });
    expect(t.to).toBe("IN_REVIEW");
  });

  it("rejects an action that is not legal from the current state", () => {
    expect(() =>
      resolveTransition(machine, { current: "NEW", action: "approve", user: user("u1", ["t.decide"]), entity: { ownerId: "u1" } }),
    ).toThrow(TransitionError);
  });

  it("rejects a transition the user lacks permission for", () => {
    expect(() =>
      resolveTransition(machine, { current: "NEW", action: "claim", user: user("u1", []), entity: { ownerId: null } }),
    ).toThrow(/Missing permission/);
  });

  it("requires a reason when the transition demands one", () => {
    expect(() =>
      resolveTransition(machine, {
        current: "IN_REVIEW",
        action: "approve",
        user: user("u1", ["t.decide"]),
        entity: { ownerId: "u1" },
        reason: "  ",
      }),
    ).toThrow(/reason is required/);
  });

  it("applies the business guard", () => {
    expect(() =>
      resolveTransition(machine, {
        current: "IN_REVIEW",
        action: "approve",
        user: user("u2", ["t.decide"]),
        entity: { ownerId: "u1" },
        reason: "ok",
      }),
    ).toThrow(/Only the assignee/);
  });

  it("lists only transitions the user can actually take", () => {
    const actions = availableTransitions(machine, "IN_REVIEW", user("u2", ["t.decide"]), { ownerId: "u1" });
    expect(actions).toHaveLength(0);
    expect(availableTransitions(machine, "IN_REVIEW", user("u1", ["t.decide"]), { ownerId: "u1" })).toHaveLength(1);
  });
});
