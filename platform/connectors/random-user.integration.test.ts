import { beforeAll, describe, expect, it } from "vitest";
import { readPath } from "@/app/admin/connectors/import";
import { RANDOM_USER_FIELDS, RANDOM_USER_URL, fixtureApplicants, listRandomUsers } from "./index";

/**
 * The only test in the suite that touches a third party. It is skipped when the
 * network is unreachable so CI and offline runs stay deterministic; everything
 * about the fallback path is covered by the mocked tests in connectors.test.ts.
 */
let online = false;

beforeAll(async () => {
  try {
    const res = await fetch(RANDOM_USER_URL, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    online = res.ok;
  } catch {
    online = false;
  }
});

describe("random-user integration", () => {
  it("returns eight usable records from the live endpoint", async () => {
    if (!online) return;
    const records = await listRandomUsers();
    expect(records).toHaveLength(8);
    /** The fixture is the seeded live response, so falling back imports the same eight cases. */
    expect(records).toEqual(fixtureApplicants);
    for (const record of records) {
      expect(record.id).toBe(readPath(record.raw, "login.uuid"));
      for (const path of RANDOM_USER_FIELDS) expect(readPath(record.raw, path)).not.toBe("");
      expect(["US", "GB", "DE", "FR", "IN"]).toContain(readPath(record.raw, "nat"));
    }
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length);
  });

  it("never rejects, whatever the endpoint does", async () => {
    await expect(listRandomUsers()).resolves.toHaveLength(8);
  });
});
