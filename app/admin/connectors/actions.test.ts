import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/test/next-mocks")).headersModule);
vi.mock("next/navigation", async () => (await import("@/test/next-mocks")).navigationModule);
vi.mock("next/cache", async () => (await import("@/test/next-mocks")).cacheModule);

import { prisma } from "@platform/db";
import { captureRedirect, formData } from "@/test/next-mocks";
import { cleanupFixtures, makeUser, signIn, signOut } from "@/test/fixtures";
import { pullIntoKycAction } from "./actions";
import { CONNECTORS_PERMISSION, isUniqueViolation, referenceFor, syntheticRisk } from "./import";

const realFetch = globalThis.fetch;
const importedReferences: string[] = [];

function mockApi(count: number) {
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        results: Array.from({ length: count }, (_, i) => ({
          login: { uuid: `${i}-${Math.random().toString(36).slice(2, 10)}-test` },
          name: { first: "Imported", last: `Applicant${i}` },
          nat: "DE",
        })),
      }),
    }) as Response) as unknown as typeof globalThis.fetch;
}

async function importedCases() {
  const cases = await prisma.kycCase.findMany({ where: { reference: { startsWith: "RANDOM-USER-" } } });
  for (const c of cases) importedReferences.push(c.reference);
  return cases;
}

/** Test files run in parallel against one database, so identify rows by diff, not by order. */
async function casesCreatedBy(run: () => Promise<unknown>) {
  const before = new Set((await importedCases()).map((c) => c.id));
  await run();
  return (await importedCases()).filter((c) => !before.has(c.id));
}

beforeEach(() => {
  signOut();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  const cases = await prisma.kycCase.findMany({ where: { reference: { in: importedReferences } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: cases.map((c) => c.id) } } });
  await prisma.kycCase.deleteMany({ where: { id: { in: cases.map((c) => c.id) } } });
  await cleanupFixtures();
});

describe("pullIntoKycAction authorization", () => {
  it("sends an anonymous caller to the login page", async () => {
    mockApi(2);
    const before = (await importedCases()).length;
    const redirected = await captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" })));
    expect(redirected.path).toBe("/login");
    expect((await importedCases()).length).toBe(before);
  });

  it("refuses a signed-in user without admin.connectors.view", async () => {
    mockApi(2);
    const user = await makeUser(["kyc.app.view"], "nonadmin");
    await signIn(user.id);
    const before = (await importedCases()).length;
    const redirected = await captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" })));
    expect(redirected.path).toBe("/forbidden");
    expect((await importedCases()).length).toBe(before);
  });
});

describe("pullIntoKycAction", () => {
  it("creates NEW KYC cases from the connector records", async () => {
    mockApi(3);
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);

    let redirected;
    const created = await casesCreatedBy(async () => {
      redirected = await captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" })));
    });
    expect(redirected!.params.get("imported")).toBe("3");

    expect(created).toHaveLength(3);
    for (const c of created) {
      expect(c.status).toBe("NEW");
      expect(c.assigneeId).toBeNull();
      expect(c.applicantCountry).toBe("DE");
      expect(c.riskScore).toBeGreaterThanOrEqual(0);
      expect(c.riskScore).toBeLessThan(100);
    }
  });

  it("is idempotent: re-pulling the same records imports nothing new", async () => {
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);

    const fixedResponse = {
      ok: true,
      json: async () => ({
        results: [{ login: { uuid: "stable-uuid-1" }, name: { first: "Stable", last: "Applicant" }, nat: "FR" }],
      }),
    } as Response;
    globalThis.fetch = (async () => fixedResponse) as unknown as typeof globalThis.fetch;

    const first = await captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" })));
    await importedCases();
    const second = await captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" })));
    expect(first.params.get("imported")).toBe("1");
    expect(second.params.get("imported")).toBe("0");
    expect(second.params.get("updated")).toBe("0");
    expect(second.params.get("seen")).toBe("1");
  });

  it("updates the existing case when the source record changed", async () => {
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);

    const uuid = `changing-${Math.random().toString(36).slice(2, 10)}`;
    const respondWith = (last: string, nat: string) => {
      globalThis.fetch = (async () =>
        ({
          ok: true,
          json: async () => ({ results: [{ login: { uuid }, name: { first: "Changing", last }, nat }] }),
        }) as Response) as unknown as typeof globalThis.fetch;
    };

    respondWith("Before", "FR");
    const created = await casesCreatedBy(() =>
      captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" }))),
    );
    expect(created).toHaveLength(1);

    respondWith("After", "GB");
    const second = await casesCreatedBy(async () => {
      const redirected = await captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" })));
      expect(redirected.params.get("imported")).toBe("0");
      expect(redirected.params.get("updated")).toBe("1");
    });
    expect(second).toHaveLength(0);

    const updated = await prisma.kycCase.findUniqueOrThrow({ where: { reference: created[0].reference } });
    expect(updated.applicantName).toBe("Changing After");
    expect(updated.applicantCountry).toBe("GB");
    expect(updated.status).toBe("NEW");

    const events = await prisma.auditEvent.findMany({ where: { entityId: updated.id } });
    expect(events).toHaveLength(2);
  });

  it("leaves a reviewed case untouched when the source record changes", async () => {
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);

    const uuid = `reviewed-${Math.random().toString(36).slice(2, 10)}`;
    const respondWith = (last: string) => {
      globalThis.fetch = (async () =>
        ({
          ok: true,
          json: async () => ({ results: [{ login: { uuid }, name: { first: "Reviewed", last }, nat: "US" }] }),
        }) as Response) as unknown as typeof globalThis.fetch;
    };

    respondWith("Before");
    const created = await casesCreatedBy(() =>
      captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" }))),
    );
    await prisma.kycCase.update({ where: { id: created[0].id }, data: { status: "APPROVED" } });

    respondWith("After");
    const redirected = await captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" })));
    expect(redirected.params.get("imported")).toBe("0");
    expect(redirected.params.get("updated")).toBe("0");

    const after = await prisma.kycCase.findUniqueOrThrow({ where: { id: created[0].id } });
    expect(after.applicantName).toBe("Reviewed Before");
    expect(after.status).toBe("APPROVED");
  });

  it("writes an audit row for every imported case", async () => {
    mockApi(2);
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);

    const created = await casesCreatedBy(() =>
      captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" }))),
    );
    expect(created).toHaveLength(2);
    const events = await prisma.auditEvent.findMany({ where: { entityId: { in: created.map((c) => c.id) } } });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.action === "import:random-user" && e.actorId === user.id)).toBe(true);
  });

  it("survives two pulls racing on the same records", async () => {
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);

    const uuid = `race-${Math.random().toString(36).slice(2, 10)}`;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          results: [{ login: { uuid }, name: { first: "Race", last: "Applicant" }, nat: "GB" }],
        }),
      }) as Response) as unknown as typeof globalThis.fetch;

    const created = await casesCreatedBy(async () => {
      const [a, b] = await Promise.all([
        captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" }))),
        captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" }))),
      ]);
      expect([a, b].map((r) => r.params.get("imported")).sort()).toEqual(["0", "1"]);
    });
    expect(created).toHaveLength(1);
  });

  it("refuses to pull from a disabled connector", async () => {
    globalThis.fetch = (async () => {
      throw new Error("a disabled connector must not reach the network");
    }) as unknown as typeof globalThis.fetch;
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);

    const redirected = await captureRedirect(() => pullIntoKycAction(formData({ connectorId: "sharepoint" })));
    expect(redirected.path).toBe("/admin/connectors");
    expect(redirected.error).toBe("Not wired in this prototype");
  });

  it("still imports from the fixture when the connector call fails", async () => {
    globalThis.fetch = (async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    }) as unknown as typeof globalThis.fetch;
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);

    const redirected = await captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" })));
    expect(Number(redirected.params.get("seen"))).toBe(8);
    await importedCases();
  });
});

describe("helpers", () => {
  it("derives a stable reference and a stable synthetic risk score", () => {
    expect(referenceFor("random-user", "abc-123-def")).toBe("RANDOM-USER-ABC123DEF");
    expect(referenceFor("random-user", "8f6c1a2e-0000-4aaa-9bbb-ccccdddd0001")).not.toBe(
      referenceFor("random-user", "8f6c1a2e-0000-4aaa-9bbb-ccccdddd0002"),
    );
    expect(syntheticRisk("abc")).toBe(syntheticRisk("abc"));
    expect(syntheticRisk("abc")).toBeLessThan(100);
    expect(isUniqueViolation({ code: "P2002" })).toBe(true);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
  });
});
