import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/test/next-mocks")).headersModule);
vi.mock("next/navigation", async () => (await import("@/test/next-mocks")).navigationModule);
vi.mock("next/cache", async () => (await import("@/test/next-mocks")).cacheModule);

import { randomUserConnector } from "@platform/connectors";
import { prisma } from "@platform/db";
import { captureRedirect, formData } from "@/test/next-mocks";
import { cleanupFixtures, makeUser, signIn, signOut } from "@/test/fixtures";
import { pullIntoKycAction } from "./actions";
import { deleteMappingAction, resetMappingAction, saveMappingAction } from "./[id]/schema/actions";
import {
  applyMapping,
  CONNECTORS_PERMISSION,
  ensureMappingRows,
  isUniqueViolation,
  isValidTemplate,
  legacyReferenceFor,
  loadMapping,
  MISSING,
  readPath,
  referenceFor,
  renderTemplate,
  resolveColumns,
  syntheticRisk,
  templatePaths,
  UNMAPPED,
} from "./import";

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
  const cases = await prisma.kycCase.findMany({ where: { source: "random-user" } });
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
      expect(c.source).toBe("random-user");
      expect(c.sourceId).toMatch(/-test$/);
      expect(c.reference).toBe(referenceFor(c.caseNumber));
      expect(c.reference).toMatch(/^KYC-\d{6,}$/);
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

  it("records a per-pull summary row even when nothing changed", async () => {
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);
    const fixed = {
      ok: true,
      json: async () => ({
        results: ["summary-a", "summary-b"].map((uuid) => ({ login: { uuid }, name: { first: "S", last: uuid }, nat: "GB" })),
      }),
    } as Response;
    globalThis.fetch = (async () => fixed) as unknown as typeof globalThis.fetch;

    await captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" })));
    await captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" })));

    const pulls = await prisma.auditEvent.findMany({
      where: { app: "admin", entityType: "Connector", entityId: "random-user", action: "pull", actorId: user.id },
      orderBy: { at: "asc" },
    });
    expect(pulls).toHaveLength(2);
    expect(pulls[0].after).toEqual({ seen: 2, imported: 2, updated: 0 });
    expect(pulls[1].after).toEqual({ seen: 2, imported: 0, updated: 0 });
  });

  it("applies the admin-edited schema mapping and marks deleted mappings UNMAPPED", async () => {
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);
    const fixed = {
      ok: true,
      json: async () => ({
        results: [
          {
            login: { uuid: "mapped-1" },
            name: { title: "Dr", first: "Mapped", last: "Person" },
            location: { city: "Pune", country: "India" },
            nat: "IN",
          },
        ],
      }),
    } as Response;
    globalThis.fetch = (async () => fixed) as unknown as typeof globalThis.fetch;
    const pull = () => captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" })));
    const schema = (a: typeof saveMappingAction, extra: Record<string, string>) =>
      captureRedirect(() => a(formData({ source: "random-user", ...extra })));

    try {
      await schema(resetMappingAction, {});
      const created = await casesCreatedBy(pull);
      expect(created).toHaveLength(1);
      expect(created[0].applicantName).toBe("Mapped Person");

      const saved = await schema(saveMappingAction, {
        targetField: "applicantName",
        sourceField: "{name.last}, {name.title} {name.first}",
      });
      expect(saved.path).toBe("/admin/connectors/random-user/schema");
      await schema(saveMappingAction, { targetField: "applicantCountry", sourceField: "{location.country} ({location.city})" });
      await pull();
      let row = await prisma.kycCase.findUniqueOrThrow({ where: { id: created[0].id } });
      expect(row.applicantName).toBe("Person, Dr Mapped");
      expect(row.applicantCountry).toBe("India (Pune)");
      expect(row.sourceId).toBe("mapped-1");

      await schema(deleteMappingAction, { targetField: "applicantCountry" });
      await pull();
      row = await prisma.kycCase.findUniqueOrThrow({ where: { id: created[0].id } });
      expect(row.applicantCountry).toBe(UNMAPPED);
      expect(row.applicantName).toBe("Person, Dr Mapped");

      // Unmapping the last mapped column must not fall back to defaults.
      await schema(deleteMappingAction, { targetField: "applicantName" });
      await pull();
      row = await prisma.kycCase.findUniqueOrThrow({ where: { id: created[0].id } });
      expect(row.applicantName).toBe(UNMAPPED);
      expect(row.applicantCountry).toBe(UNMAPPED);

      await schema(resetMappingAction, {});
      await pull();
      row = await prisma.kycCase.findUniqueOrThrow({ where: { id: created[0].id } });
      expect(row.applicantName).toBe("Mapped Person");
      expect(row.applicantCountry).toBe("IN");

      const bad = await schema(saveMappingAction, { targetField: "riskScore", sourceField: "{nat}" });
      expect(bad.params.get("error")).toBe("Unknown field");
      for (const sourceField of ["id", "name", "{login.password}", "literal only", "{name.first", "{nat}{missing", "{{nat}}", ""]) {
        const rejected = await schema(saveMappingAction, { targetField: "applicantName", sourceField });
        expect(rejected.params.get("error")).toMatch(/^Template must use only/);
      }
      await pull();
      row = await prisma.kycCase.findUniqueOrThrow({ where: { id: created[0].id } });
      expect(row.applicantName).toBe("Mapped Person");

      const audits = await prisma.auditEvent.findMany({ where: { entityType: "SourceMapping", actorId: user.id } });
      expect(audits.map((a) => a.action).sort()).toEqual([
        "mapping.delete",
        "mapping.delete",
        "mapping.reset",
        "mapping.reset",
        "mapping.save",
        "mapping.save",
      ]);
      expect(audits.find((a) => a.action === "mapping.delete")?.after).toMatchObject({ sourceField: "" });
    } finally {
      await schema(resetMappingAction, {});
    }
  });

  it("materialises the other default when the first edit happens on an unconfigured source", async () => {
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);
    try {
      await prisma.sourceMapping.deleteMany({ where: { source: "random-user" } });
      await captureRedirect(() =>
        saveMappingAction(formData({ source: "random-user", targetField: "applicantName", sourceField: "{email}" })),
      );
      const rows = await prisma.sourceMapping.findMany({ where: { source: "random-user" }, orderBy: { targetField: "asc" } });
      expect(rows.map((r) => [r.targetField, r.sourceField])).toEqual([
        ["applicantCountry", "{nat}"],
        ["applicantName", "{email}"],
      ]);
    } finally {
      await captureRedirect(() => resetMappingAction(formData({ source: "random-user" })));
    }
  });

  it("keeps existing details when a mapped source path is empty, and writes MISSING for a new case", async () => {
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);
    const uuid = `sparse-${Math.random().toString(36).slice(2, 10)}`;
    const respond = (results: unknown[]) => {
      globalThis.fetch = (async () => ({ ok: true, json: async () => ({ results }) }) as Response) as unknown as typeof globalThis.fetch;
    };
    const pull = () => captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" })));

    respond([{ login: { uuid }, nat: "GB" }]);
    const [created] = await casesCreatedBy(pull);
    expect(created.applicantName).toBe(MISSING);
    expect(created.applicantCountry).toBe("GB");

    respond([{ login: { uuid }, name: { first: "Ada", last: "Lovelace" }, nat: "GB" }]);
    await pull();
    respond([{ login: { uuid } }]);
    await pull();
    const after = await prisma.kycCase.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.applicantName).toBe("Ada Lovelace");
    expect(after.applicantCountry).toBe("GB");
  });

  it("upgrades mapping rows stored by the flattened editor to raw-path templates", async () => {
    try {
      await prisma.sourceMapping.deleteMany({ where: { source: "random-user" } });
      await prisma.sourceMapping.createMany({
        data: [
          { source: "random-user", targetField: "applicantName", sourceField: "id" },
          { source: "random-user", targetField: "applicantCountry", sourceField: "country" },
        ],
      });
      expect(await loadMapping(randomUserConnector)).toEqual({
        applicantName: "{name.first} {name.last}",
        applicantCountry: "{nat}",
      });
      const rows = await prisma.sourceMapping.findMany({ where: { source: "random-user" } });
      expect(rows.map((r) => r.sourceField).sort()).toEqual(["{name.first} {name.last}", "{nat}"]);
    } finally {
      await captureRedirect(() => resetMappingAction(formData({ source: "random-user" })));
    }
  });

  it("adopts a case imported under the legacy reference scheme instead of duplicating it", async () => {
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);
    const uuid = `legacy-${Math.random().toString(36).slice(2, 10)}`;
    const legacy = await prisma.kycCase.create({
      data: {
        reference: legacyReferenceFor("random-user", uuid),
        applicantName: "Old Import",
        applicantCountry: "FR",
        riskScore: 1,
        status: "APPROVED",
      },
    });
    importedReferences.push(legacy.reference);
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({ results: [{ login: { uuid }, name: { first: "New", last: "Name" }, nat: "GB" }] }),
      }) as Response) as unknown as typeof globalThis.fetch;

    const created = await casesCreatedBy(() =>
      captureRedirect(() => pullIntoKycAction(formData({ connectorId: "random-user" }))),
    );
    const after = await prisma.kycCase.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(created.map((c) => c.id)).toEqual([legacy.id]);
    expect(after.source).toBe("random-user");
    expect(after.sourceId).toBe(uuid);
    expect(after.applicantName).toBe("Old Import");
    expect(after.status).toBe("APPROVED");
  });

  it("refuses schema edits without admin.connectors.view", async () => {
    const user = await makeUser(["kyc.app.view"], "nonadmin");
    await signIn(user.id);
    const redirected = await captureRedirect(() =>
      saveMappingAction(formData({ source: "random-user", targetField: "applicantName", sourceField: "{email}" })),
    );
    expect(redirected.path).toBe("/forbidden");
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

  it("rejects an unknown or missing connector id", async () => {
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);
    for (const data of [formData({ connectorId: "nope" }), formData({})]) {
      const redirected = await captureRedirect(() => pullIntoKycAction(data));
      expect(redirected.path).toBe("/admin/connectors");
      expect(redirected.error).toBe("Not wired in this prototype");
    }
  });

  it("propagates non-unique database errors instead of retrying them", async () => {
    mockApi(1);
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("connection lost"));
    try {
      await expect(pullIntoKycAction(formData({ connectorId: "random-user" }))).rejects.toThrow("connection lost");
    } finally {
      spy.mockRestore();
    }
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
  it("derives a standard reference and a stable synthetic risk score", () => {
    expect(referenceFor(42)).toBe("KYC-000042");
    expect(referenceFor(1234567)).toBe("KYC-1234567");
    expect(syntheticRisk("abc")).toBe(syntheticRisk("abc"));
    expect(syntheticRisk("abc")).toBeLessThan(100);
    expect(isUniqueViolation({ code: "P2002" })).toBe(true);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
  });

  it("validates templates and resolves columns without a database", () => {
    const fields = randomUserConnector.fields;
    expect(isValidTemplate(undefined, fields)).toBe(false);
    expect(isValidTemplate(42, fields)).toBe(false);
    expect(isValidTemplate("{nat}".padEnd(121, "x"), fields)).toBe(false);
    expect(isValidTemplate("{name.last}, {name.first} ({nat})", fields)).toBe(true);
    expect(templatePaths("{name.last}, {nat} {bogus")).toEqual(["name.last", "nat"]);

    const raw = { name: { first: "Ada" }, dob: { age: 36 }, location: { country: null } };
    expect(readPath(raw, "name.first")).toBe("Ada");
    expect(readPath(raw, "dob.age")).toBe("36");
    expect(readPath(raw, "location.country")).toBe("");
    expect(readPath(raw, "name.first.deeper")).toBe("");
    expect(renderTemplate("  {name.first}   {name.last} ", raw)).toBe("Ada");

    const record = { id: "x", raw: { nat: "gb" } };
    expect(applyMapping({ applicantName: "{name.first}", applicantCountry: "{nat}" }, record)).toEqual({
      applicantName: null,
      applicantCountry: "GB",
    });
    expect(applyMapping({}, record)).toEqual({ applicantName: UNMAPPED, applicantCountry: UNMAPPED });
    expect(resolveColumns({ applicantName: null, applicantCountry: null }, null)).toEqual({
      applicantName: MISSING,
      applicantCountry: MISSING,
    });
    expect(
      resolveColumns({ applicantName: "New", applicantCountry: null }, { applicantName: "Old", applicantCountry: "FR" }),
    ).toEqual({ applicantName: "New", applicantCountry: "FR" });
  });
});

describe("schema actions: guards", () => {
  it("rejects an unknown connector and an unknown target field on every action", async () => {
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);
    for (const action of [saveMappingAction, deleteMappingAction, resetMappingAction]) {
      const redirected = await captureRedirect(() => action(formData({ source: "nope", targetField: "applicantName", sourceField: "{nat}" })));
      expect(redirected.path).toBe("/admin/connectors");
      expect(redirected.error).toBe("Unknown connector");
    }
    const before = await prisma.sourceMapping.findMany({ where: { source: "random-user" } });
    const redirected = await captureRedirect(() => deleteMappingAction(formData({ source: "random-user", targetField: "riskScore" })));
    expect(redirected.path).toBe("/admin/connectors/random-user/schema");
    expect(redirected.error).toBe("Unknown field");
    expect(await prisma.sourceMapping.findMany({ where: { source: "random-user" } })).toEqual(before);
  });

  it("denies anonymous and non-admin users", async () => {
    const data = () => formData({ source: "random-user", targetField: "applicantName", sourceField: "{email}" });
    for (const action of [saveMappingAction, deleteMappingAction, resetMappingAction]) {
      signOut();
      expect((await captureRedirect(() => action(data()))).path).toBe("/login");
      const user = await makeUser(["kyc.app.view"], "nonadmin");
      await signIn(user.id);
      expect((await captureRedirect(() => action(data()))).path).toBe("/forbidden");
    }
    const rows = await prisma.sourceMapping.findMany({ where: { source: "random-user", sourceField: "{email}" } });
    expect(rows).toHaveLength(0);
  });

  it("upgrades the legacy `name` mapping and does not clobber a concurrent save", async () => {
    const user = await makeUser([CONNECTORS_PERMISSION], "connectoradmin");
    await signIn(user.id);
    try {
      await prisma.sourceMapping.deleteMany({ where: { source: "random-user" } });
      await prisma.sourceMapping.createMany({
        data: [
          { source: "random-user", targetField: "applicantName", sourceField: "name" },
          { source: "random-user", targetField: "applicantCountry", sourceField: "{location.country}" },
        ],
      });
      /** A `tx` whose first read is followed by an admin save, before the upgrade write runs. */
      let reads = 0;
      const racingTx = {
        sourceMapping: {
          ...prisma.sourceMapping,
          updateMany: (args: Parameters<typeof prisma.sourceMapping.updateMany>[0]) => prisma.sourceMapping.updateMany(args),
          createMany: (args: Parameters<typeof prisma.sourceMapping.createMany>[0]) => prisma.sourceMapping.createMany(args),
          findMany: async (args: Parameters<typeof prisma.sourceMapping.findMany>[0]) => {
            const rows = await prisma.sourceMapping.findMany(args);
            if (reads++ === 0) {
              await prisma.sourceMapping.updateMany({
                where: { source: "random-user", targetField: "applicantName" },
                data: { sourceField: "{email}" },
              });
            }
            return rows;
          },
        },
      } as unknown as typeof prisma;
      const rows = await ensureMappingRows(racingTx, "random-user");
      expect(rows.map((r) => [r.targetField, r.sourceField])).toEqual([
        ["applicantCountry", "{location.country}"],
        ["applicantName", "{email}"],
      ]);
      expect(await loadMapping(randomUserConnector)).toEqual({
        applicantName: "{email}",
        applicantCountry: "{location.country}",
      });
      await prisma.sourceMapping.updateMany({
        where: { source: "random-user", targetField: "applicantName" },
        data: { sourceField: "name" },
      });
      expect((await loadMapping(randomUserConnector)).applicantName).toBe("{name.first} {name.last}");
    } finally {
      await captureRedirect(() => resetMappingAction(formData({ source: "random-user" })));
    }
  });
});
