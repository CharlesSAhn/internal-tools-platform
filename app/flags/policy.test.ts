import { describe, expect, it } from "vitest";
import type { SessionUser } from "@platform/auth/session";
import { TransitionError, assertCanChangeEnv, canChangeEnv, normalizeRollout, parseTargetUserIds } from "./policy";

function user(permissions: string[]): SessionUser {
  return { id: "u1", email: "u@example.com", name: "U", roles: [], permissions };
}

const editor = user(["flags.app.view", "flags.flag.create", "flags.write.nonprod"]);
const flagAdmin = user([...editor.permissions, "flags.write.prod"]);
const viewer = user(["flags.app.view"]);

describe("environment-graded authorization", () => {
  it("lets a nonprod editor change staging", () => {
    expect(canChangeEnv(editor, { env: "STAGING", currentEnabled: false, nextEnabled: true })).toBeNull();
  });

  it("blocks a nonprod editor from prod, on the server", () => {
    expect(() =>
      assertCanChangeEnv(editor, { env: "PROD", currentEnabled: true, nextEnabled: false, reason: "rollback" }),
    ).toThrow(/flags.write.prod/);
  });

  it("blocks a viewer from every environment", () => {
    for (const env of ["DEV", "STAGING", "PROD"] as const) {
      expect(canChangeEnv(viewer, { env, currentEnabled: false, nextEnabled: true, reason: "x" })).toMatch(/permission/);
    }
  });

  it("allows a flag admin to change prod with a reason", () => {
    expect(
      canChangeEnv(flagAdmin, { env: "PROD", currentEnabled: false, nextEnabled: true, reason: "launch approved" }),
    ).toBeNull();
  });

  it("rejects a prod change without a reason", () => {
    expect(() =>
      assertCanChangeEnv(flagAdmin, { env: "PROD", currentEnabled: false, nextEnabled: true, reason: "  " }),
    ).toThrow(TransitionError);
  });

  it("does not require a reason in nonprod", () => {
    expect(canChangeEnv(editor, { env: "DEV", currentEnabled: true, nextEnabled: true, reason: null })).toBeNull();
  });

  it("covers rollout-only edits with the same guard", () => {
    expect(canChangeEnv(editor, { env: "PROD", currentEnabled: true, nextEnabled: true, reason: "ramp" })).toMatch(
      /flags.write.prod/,
    );
  });
});

describe("input normalization", () => {
  it("rejects out-of-range rollout percentages", () => {
    expect(() => normalizeRollout("101")).toThrow(TransitionError);
    expect(() => normalizeRollout("-1")).toThrow(TransitionError);
    expect(normalizeRollout("42")).toBe(42);
  });

  it("parses target user ids from a loose list", () => {
    expect(parseTargetUserIds(" u1, u2  u3,")).toEqual(["u1", "u2", "u3"]);
    expect(parseTargetUserIds("")).toEqual([]);
  });
});
