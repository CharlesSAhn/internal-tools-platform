import { afterAll, describe, expect, it } from "vitest";

import { cleanupFixtures, makeUser } from "@/test/fixtures";
import type { SessionUser } from "@platform/auth/session";
import { assertPermission, can, canAny, enforceFourEyes, ForbiddenError, permissionsForUser } from "./index";

const user: SessionUser = { id: "u1", email: "u@example.com", name: "U", roles: ["r"], permissions: ["kyc.app.view"] };

afterAll(cleanupFixtures);

describe("rbac", () => {
  it("checks single and any-of permissions, denying anonymous callers", () => {
    expect(can(user, "kyc.app.view")).toBe(true);
    expect(can(user, "kyc.app.approve")).toBe(false);
    expect(can(null, "kyc.app.view")).toBe(false);
    expect(canAny(user, ["kyc.app.approve", "kyc.app.view"])).toBe(true);
    expect(canAny(user, ["kyc.app.approve"])).toBe(false);
    expect(canAny(null, ["kyc.app.view"])).toBe(false);
  });

  it("assertPermission throws a ForbiddenError naming the missing permission", () => {
    expect(() => assertPermission(user, "kyc.app.view")).not.toThrow();
    expect(() => assertPermission(user, "flags.edit")).toThrow(ForbiddenError);
    expect(() => assertPermission(null, "flags.edit")).toThrow(/Missing permission: flags.edit/);
    try {
      assertPermission(user, "flags.edit");
    } catch (e) {
      expect((e as ForbiddenError).permission).toBe("flags.edit");
      expect((e as ForbiddenError).name).toBe("ForbiddenError");
    }
  });

  it("four-eyes blocks self-approval only", () => {
    expect(() => enforceFourEyes("a", "a")).toThrow(/Four-eyes/);
    expect(() => enforceFourEyes("a", "b")).not.toThrow();
    expect(() => enforceFourEyes("a", null)).not.toThrow();
    expect(() => enforceFourEyes("a", undefined)).not.toThrow();
  });

  it("permissionsForUser flattens roles into a sorted key list", async () => {
    const u = await makeUser(["kyc.app.view", "flags.app.view"], "rbac");
    expect(await permissionsForUser(u.id)).toEqual(["flags.app.view", "kyc.app.view"]);
    expect(await permissionsForUser("no-such-user")).toEqual([]);
  });
});
