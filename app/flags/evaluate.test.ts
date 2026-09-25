import { describe, expect, it } from "vitest";
import { isEnabledFor } from "./evaluate";

const base = { flagKey: "checkout.new_pricing", enabled: true, rolloutPercentage: 0, targetUserIds: [] as string[] };

describe("isEnabledFor", () => {
  it("is false when the flag is disabled, even for targeted users at 100%", () => {
    expect(isEnabledFor({ ...base, enabled: false, rolloutPercentage: 100, targetUserIds: ["u1"] }, "u1")).toBe(false);
  });

  it("is true for an explicitly targeted user at 0% rollout", () => {
    expect(isEnabledFor({ ...base, targetUserIds: ["u1"] }, "u1")).toBe(true);
  });

  it("is false at 0% rollout for a non-targeted user", () => {
    expect(isEnabledFor({ ...base, targetUserIds: ["u1"] }, "u2")).toBe(false);
  });

  it("is true at 100% rollout for everyone", () => {
    for (const u of ["u1", "u2", "zzz", ""]) {
      expect(isEnabledFor({ ...base, rolloutPercentage: 100 }, u)).toBe(true);
    }
  });

  it("is stable across calls for the same user", () => {
    const state = { ...base, rolloutPercentage: 50 };
    const first = isEnabledFor(state, "user-42");
    for (let i = 0; i < 20; i++) expect(isEnabledFor(state, "user-42")).toBe(first);
  });

  it("buckets roughly proportionally to the rollout percentage", () => {
    const users = Array.from({ length: 1000 }, (_, i) => `user-${i}`);
    const on = users.filter((u) => isEnabledFor({ ...base, rolloutPercentage: 30 }, u)).length;
    expect(on).toBeGreaterThan(200);
    expect(on).toBeLessThan(400);
  });

  it("buckets differently per flag key", () => {
    const users = Array.from({ length: 200 }, (_, i) => `user-${i}`);
    const a = users.filter((u) => isEnabledFor({ ...base, rolloutPercentage: 50 }, u));
    const b = users.filter((u) => isEnabledFor({ ...base, flagKey: "other.flag", rolloutPercentage: 50 }, u));
    expect(a).not.toEqual(b);
  });
});
