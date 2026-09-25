import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/test/next-mocks")).headersModule);
vi.mock("next/navigation", async () => (await import("@/test/next-mocks")).navigationModule);
vi.mock("next/cache", async () => (await import("@/test/next-mocks")).cacheModule);

import { prisma } from "@platform/db";
import { captureRedirect, formData } from "@/test/next-mocks";
import {
  auditFor,
  cleanupFixtures,
  envState,
  makeFlag,
  makeUser,
  signIn,
  signOut,
  trackFlag,
} from "@/test/fixtures";
import {
  createFlagAction,
  killSwitchAction,
  setArchivedAction,
  updateEnvStateAction,
} from "./actions";

const VIEW = "flags.app.view";
const CREATE = "flags.flag.create";
const NONPROD = "flags.write.nonprod";
const PROD = "flags.write.prod";

async function editor() {
  return makeUser([VIEW, CREATE, NONPROD], "editor");
}

async function flagAdmin() {
  return makeUser([VIEW, CREATE, NONPROD, PROD], "flagadmin");
}

beforeEach(() => {
  signOut();
});

afterAll(async () => {
  await cleanupFixtures();
});

describe("updateEnvStateAction", () => {
  it("saves a staging change and audits it in the same transaction", async () => {
    await signIn((await editor()).id);
    const flag = await makeFlag({ staging: { enabled: false, rolloutPercentage: 0 } });
    const before = await envState(flag.id, "STAGING");

    const redirected = await captureRedirect(() =>
      updateEnvStateAction(
        formData({
          flagId: flag.id,
          env: "STAGING",
          enabled: "on",
          rolloutPercentage: "25",
          targetUserIds: "u-1, u-2\nu-3",
          expectedUpdatedAt: before.updatedAt.toISOString(),
        }),
      ),
    );

    expect(redirected).toMatchObject({ path: `/flags/${flag.id}`, error: null });
    expect(redirected.params.get("saved")).toBe("1");

    const after = await envState(flag.id, "STAGING");
    expect(after).toMatchObject({ enabled: true, rolloutPercentage: 25, targetUserIds: ["u-1", "u-2", "u-3"] });

    const audit = await auditFor(flag.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ app: "flags", entityType: "FeatureFlag", action: "STAGING:enable" });
    expect(audit[0].before).toMatchObject({ env: "STAGING", enabled: false });
    expect(audit[0].after).toMatchObject({ env: "STAGING", enabled: true, rolloutPercentage: 25 });
  });

  it("records a same-state edit as an update, not an enable", async () => {
    await signIn((await editor()).id);
    const flag = await makeFlag({ dev: { enabled: true, rolloutPercentage: 10 } });
    const before = await envState(flag.id, "DEV");

    await captureRedirect(() =>
      updateEnvStateAction(
        formData({
          flagId: flag.id,
          env: "DEV",
          enabled: "on",
          rolloutPercentage: "40",
          targetUserIds: "",
          expectedUpdatedAt: before.updatedAt.toISOString(),
        }),
      ),
    );

    expect((await auditFor(flag.id))[0].action).toBe("DEV:update");
  });

  it.each([
    ["0", 0],
    ["100", 100],
  ])("accepts the boundary rollout value %s", async (input, expected) => {
    await signIn((await editor()).id);
    const flag = await makeFlag();
    const before = await envState(flag.id, "DEV");

    await captureRedirect(() =>
      updateEnvStateAction(
        formData({
          flagId: flag.id,
          env: "DEV",
          enabled: "on",
          rolloutPercentage: input,
          targetUserIds: "",
          expectedUpdatedAt: before.updatedAt.toISOString(),
        }),
      ),
    );

    expect((await envState(flag.id, "DEV")).rolloutPercentage).toBe(expected);
  });

  it.each([
    ["101", "Rollout percentage must be between 0 and 100"],
    ["-1", "Rollout percentage must be between 0 and 100"],
    ["abc", "Rollout percentage must be a number"],
  ])("rejects rollout %s without writing an audit row", async (input, expectedError) => {
    await signIn((await editor()).id);
    const flag = await makeFlag();
    const before = await envState(flag.id, "DEV");

    const redirected = await captureRedirect(() =>
      updateEnvStateAction(
        formData({
          flagId: flag.id,
          env: "DEV",
          enabled: "on",
          rolloutPercentage: input,
          targetUserIds: "",
          expectedUpdatedAt: before.updatedAt.toISOString(),
        }),
      ),
    );

    expect(redirected.error).toBe(expectedError);
    expect((await envState(flag.id, "DEV")).enabled).toBe(false);
    expect(await auditFor(flag.id)).toHaveLength(0);
  });

  it("blocks a non-prod editor from changing production on the server", async () => {
    await signIn((await editor()).id);
    const flag = await makeFlag({ prod: { enabled: false } });
    const before = await envState(flag.id, "PROD");

    const redirected = await captureRedirect(() =>
      updateEnvStateAction(
        formData({
          flagId: flag.id,
          env: "PROD",
          enabled: "on",
          rolloutPercentage: "10",
          targetUserIds: "",
          reason: "ship it",
          expectedUpdatedAt: before.updatedAt.toISOString(),
        }),
      ),
    );

    expect(redirected.error).toBe(`Missing permission: ${PROD}`);
    expect((await envState(flag.id, "PROD")).enabled).toBe(false);
    expect(await auditFor(flag.id)).toHaveLength(0);
  });

  it("requires a reason for production changes", async () => {
    await signIn((await flagAdmin()).id);
    const flag = await makeFlag({ prod: { enabled: false } });
    const before = await envState(flag.id, "PROD");

    const redirected = await captureRedirect(() =>
      updateEnvStateAction(
        formData({
          flagId: flag.id,
          env: "PROD",
          enabled: "on",
          rolloutPercentage: "10",
          targetUserIds: "",
          reason: "   ",
          expectedUpdatedAt: before.updatedAt.toISOString(),
        }),
      ),
    );

    expect(redirected.error).toBe("A reason is required for this action");
    expect((await envState(flag.id, "PROD")).enabled).toBe(false);
    expect(await auditFor(flag.id)).toHaveLength(0);
  });

  it("allows a prod admin with a reason and stores the reason on the audit row", async () => {
    await signIn((await flagAdmin()).id);
    const flag = await makeFlag({ prod: { enabled: false } });
    const before = await envState(flag.id, "PROD");

    await captureRedirect(() =>
      updateEnvStateAction(
        formData({
          flagId: flag.id,
          env: "PROD",
          enabled: "on",
          rolloutPercentage: "100",
          targetUserIds: "",
          reason: "launch approved",
          expectedUpdatedAt: before.updatedAt.toISOString(),
        }),
      ),
    );

    expect((await envState(flag.id, "PROD")).enabled).toBe(true);
    expect((await auditFor(flag.id))[0]).toMatchObject({ action: "PROD:enable", reason: "launch approved" });
  });

  it("rejects an unknown flag id", async () => {
    await signIn((await editor()).id);
    const redirected = await captureRedirect(() =>
      updateEnvStateAction(
        formData({
          flagId: "does-not-exist",
          env: "DEV",
          enabled: "on",
          rolloutPercentage: "1",
          targetUserIds: "",
          expectedUpdatedAt: new Date().toISOString(),
        }),
      ),
    );
    expect(redirected.error).toBe("Unknown environment state");
  });

  it("rejects an unknown environment name", async () => {
    await signIn((await editor()).id);
    const flag = await makeFlag();
    const redirected = await captureRedirect(() =>
      updateEnvStateAction(
        formData({
          flagId: flag.id,
          env: "QA",
          enabled: "on",
          rolloutPercentage: "1",
          targetUserIds: "",
          expectedUpdatedAt: new Date().toISOString(),
        }),
      ),
    );
    expect(redirected.error).toBeTruthy();
    expect(await auditFor(flag.id)).toHaveLength(0);
  });

  it.each([
    ["a stale timestamp", new Date(0).toISOString()],
    ["a missing timestamp", ""],
    ["a malformed timestamp", "not-a-date"],
  ])("rejects %s with the reload message", async (_label, expectedUpdatedAt) => {
    await signIn((await editor()).id);
    const flag = await makeFlag();

    const redirected = await captureRedirect(() =>
      updateEnvStateAction(
        formData({
          flagId: flag.id,
          env: "DEV",
          enabled: "on",
          rolloutPercentage: "5",
          targetUserIds: "",
          expectedUpdatedAt,
        }),
      ),
    );

    expect(redirected.error).toBe("Flag changed under you. Reload.");
    expect((await envState(flag.id, "DEV")).enabled).toBe(false);
    expect(await auditFor(flag.id)).toHaveLength(0);
  });

  it("sends an anonymous caller to the login page", async () => {
    const flag = await makeFlag();
    const redirected = await captureRedirect(() =>
      updateEnvStateAction(formData({ flagId: flag.id, env: "DEV", expectedUpdatedAt: "" })),
    );
    expect(redirected.path).toBe("/login");
  });

  it("sends a caller without flags.app.view to the forbidden page", async () => {
    await signIn((await makeUser(["kyc.app.view"], "outsider")).id);
    const flag = await makeFlag();
    const redirected = await captureRedirect(() =>
      updateEnvStateAction(formData({ flagId: flag.id, env: "DEV", expectedUpdatedAt: "" })),
    );
    expect(redirected.path).toBe("/forbidden");
    expect(redirected.params.get("p")).toBe(VIEW);
  });
});

describe("killSwitchAction", () => {
  it("disables production, zeroes the rollout and keeps the targeted users", async () => {
    await signIn((await flagAdmin()).id);
    const flag = await makeFlag({
      prod: { enabled: true, rolloutPercentage: 80, targetUserIds: ["vip-1"] },
    });
    const before = await envState(flag.id, "PROD");

    await captureRedirect(() =>
      killSwitchAction(formData({ flagId: flag.id, expectedUpdatedAt: before.updatedAt.toISOString() })),
    );

    expect(await envState(flag.id, "PROD")).toMatchObject({
      enabled: false,
      rolloutPercentage: 0,
      targetUserIds: ["vip-1"],
    });
    expect((await auditFor(flag.id))[0]).toMatchObject({
      action: "PROD:kill-switch",
      reason: "kill switch",
    });
  });

  it("refuses a non-prod editor", async () => {
    await signIn((await editor()).id);
    const flag = await makeFlag({ prod: { enabled: true, rolloutPercentage: 80 } });
    const before = await envState(flag.id, "PROD");

    const redirected = await captureRedirect(() =>
      killSwitchAction(formData({ flagId: flag.id, expectedUpdatedAt: before.updatedAt.toISOString() })),
    );

    expect(redirected.error).toBe(`Missing permission: ${PROD}`);
    expect((await envState(flag.id, "PROD")).enabled).toBe(true);
    expect(await auditFor(flag.id)).toHaveLength(0);
  });

  it("rejects a save prepared before the row moved, so a kill cannot be undone", async () => {
    const admin = await flagAdmin();
    await signIn(admin.id);
    const flag = await makeFlag({ prod: { enabled: true, rolloutPercentage: 100 } });
    const rendered = await envState(flag.id, "PROD");

    await captureRedirect(() =>
      killSwitchAction(formData({ flagId: flag.id, expectedUpdatedAt: rendered.updatedAt.toISOString() })),
    );

    const stale = await captureRedirect(() =>
      updateEnvStateAction(
        formData({
          flagId: flag.id,
          env: "PROD",
          enabled: "on",
          rolloutPercentage: "100",
          targetUserIds: "",
          reason: "re-enable",
          expectedUpdatedAt: rendered.updatedAt.toISOString(),
        }),
      ),
    );

    expect(stale.error).toBe("Flag changed under you. Reload.");
    expect((await envState(flag.id, "PROD")).enabled).toBe(false);
    expect(await auditFor(flag.id)).toHaveLength(1);
  });

  it("rejects an unknown flag id", async () => {
    await signIn((await flagAdmin()).id);
    const redirected = await captureRedirect(() =>
      killSwitchAction(formData({ flagId: "nope", expectedUpdatedAt: new Date().toISOString() })),
    );
    expect(redirected.error).toBe("Unknown environment state");
  });

  it("sends an anonymous caller to the login page", async () => {
    const flag = await makeFlag();
    const redirected = await captureRedirect(() =>
      killSwitchAction(formData({ flagId: flag.id, expectedUpdatedAt: "" })),
    );
    expect(redirected.path).toBe("/login");
  });
});

describe("setArchivedAction", () => {
  it("archives and unarchives, auditing both directions", async () => {
    await signIn((await editor()).id);
    const flag = await makeFlag();

    await captureRedirect(() =>
      setArchivedAction(formData({ flagId: flag.id, archived: "true", reason: "retired" })),
    );
    expect((await prisma.featureFlag.findUniqueOrThrow({ where: { id: flag.id } })).archived).toBe(true);

    await captureRedirect(() => setArchivedAction(formData({ flagId: flag.id, archived: "false" })));
    expect((await prisma.featureFlag.findUniqueOrThrow({ where: { id: flag.id } })).archived).toBe(false);

    const audit = await auditFor(flag.id);
    expect(audit.map((a) => a.action)).toEqual(["archive", "unarchive"]);
    expect(audit[0]).toMatchObject({ reason: "retired" });
    expect(audit[0].after).toMatchObject({ archived: true });
    expect(audit[1].reason).toBeNull();
  });

  it("rejects an unknown flag id without auditing", async () => {
    await signIn((await editor()).id);
    const redirected = await captureRedirect(() =>
      setArchivedAction(formData({ flagId: "nope", archived: "true" })),
    );
    expect(redirected.path).toBe("/flags/nope");
    expect(redirected.error).toBeTruthy();
    expect(await auditFor("nope")).toHaveLength(0);
  });

  it("requires flags.flag.create", async () => {
    await signIn((await makeUser([VIEW, NONPROD], "viewer")).id);
    const flag = await makeFlag();
    const redirected = await captureRedirect(() =>
      setArchivedAction(formData({ flagId: flag.id, archived: "true" })),
    );
    expect(redirected.path).toBe("/forbidden");
    expect(redirected.params.get("p")).toBe(CREATE);
    expect((await prisma.featureFlag.findUniqueOrThrow({ where: { id: flag.id } })).archived).toBe(false);
  });
});

describe("createFlagAction", () => {
  it("creates a flag with all three environments off and audits the creation", async () => {
    await signIn((await editor()).id);
    const key = `test.created_${Math.random().toString(36).slice(2, 8)}`;

    const redirected = await captureRedirect(() =>
      createFlagAction(formData({ key, description: "new flag", ownerEmail: "owner@test.local" })),
    );

    const created = await prisma.featureFlag.findUniqueOrThrow({
      where: { key },
      include: { envStates: true },
    });
    trackFlag(created.id);

    expect(redirected.path).toBe(`/flags/${created.id}`);
    expect(created.envStates).toHaveLength(3);
    expect(created.envStates.every((s) => !s.enabled && s.rolloutPercentage === 0)).toBe(true);
    expect((await auditFor(created.id))[0]).toMatchObject({ action: "create", before: null });
  });

  it.each([
    ["Checkout.NewPricing", "Key must look like area.flag_name (lowercase, dot-separated)"],
    ["nodots", "Key must look like area.flag_name (lowercase, dot-separated)"],
    ["", "Key must look like area.flag_name (lowercase, dot-separated)"],
  ])("rejects the invalid key %s", async (key, expectedError) => {
    await signIn((await editor()).id);
    const redirected = await captureRedirect(() =>
      createFlagAction(formData({ key, description: "d", ownerEmail: "owner@test.local" })),
    );
    expect(redirected.path).toBe("/flags/new");
    expect(redirected.error).toBe(expectedError);
  });

  it("requires a description and an email-shaped owner", async () => {
    await signIn((await editor()).id);
    const noDescription = await captureRedirect(() =>
      createFlagAction(formData({ key: "test.no_description", description: "  ", ownerEmail: "o@test.local" })),
    );
    expect(noDescription.error).toBe("Description is required");

    const badOwner = await captureRedirect(() =>
      createFlagAction(formData({ key: "test.bad_owner", description: "d", ownerEmail: "nobody" })),
    );
    expect(badOwner.error).toBe("Owner must be an email address");

    expect(await prisma.featureFlag.findUnique({ where: { key: "test.no_description" } })).toBeNull();
    expect(await prisma.featureFlag.findUnique({ where: { key: "test.bad_owner" } })).toBeNull();
  });

  it("rejects a duplicate key", async () => {
    await signIn((await editor()).id);
    const existing = await makeFlag();
    const redirected = await captureRedirect(() =>
      createFlagAction(
        formData({ key: existing.key, description: "dup", ownerEmail: "owner@test.local" }),
      ),
    );
    expect(redirected.error).toBe(`Flag "${existing.key}" already exists`);
  });

  it("requires flags.flag.create", async () => {
    await signIn((await makeUser([VIEW, NONPROD], "viewer")).id);
    const redirected = await captureRedirect(() =>
      createFlagAction(formData({ key: "test.forbidden", description: "d", ownerEmail: "o@test.local" })),
    );
    expect(redirected.path).toBe("/forbidden");
    expect(await prisma.featureFlag.findUnique({ where: { key: "test.forbidden" } })).toBeNull();
  });

  it("sends an anonymous caller to the login page", async () => {
    const redirected = await captureRedirect(() =>
      createFlagAction(formData({ key: "test.anon", description: "d", ownerEmail: "o@test.local" })),
    );
    expect(redirected.path).toBe("/login");
  });
});
