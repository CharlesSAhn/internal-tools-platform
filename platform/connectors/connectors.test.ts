import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorDisabledError,
  connectors,
  fixtureApplicants,
  getConnector,
  listRandomUsers,
  randomUserConnector,
} from "./index";

const realFetch = globalThis.fetch;

function mockFetch(impl: typeof globalThis.fetch) {
  globalThis.fetch = impl;
}

function apiResponse(count: number) {
  return {
    ok: true,
    json: async () => ({
      results: Array.from({ length: count }, (_, i) => ({
        login: { uuid: `uuid-${i}` },
        name: { first: "Live", last: `User${i}` },
        nat: "GB",
      })),
    }),
  } as Response;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("catalog", () => {
  it("has exactly one live connector", () => {
    expect(connectors.filter((c) => c.status === "live").map((c) => c.id)).toEqual(["random-user"]);
  });

  it("lists the disabled placeholders without network access", () => {
    expect(connectors.filter((c) => c.status === "disabled").map((c) => c.id)).toEqual([
      "sharepoint",
      "dataverse",
      "sql-server",
      "outlook",
      "teams",
      "salesforce",
      "dynamics-365",
      "servicenow",
    ]);
  });
});

describe("live connector", () => {
  it("is enabled and reports a count matching listRecords()", async () => {
    mockFetch(async () => apiResponse(8));
    const connector = getConnector("random-user");
    expect(connector?.status).toBe("live");
    const records = await connector!.listRecords();
    expect(records).toHaveLength(8);
    expect(records[0]).toEqual({ id: "uuid-0", name: "Live User0", country: "GB" });
  });

  it("sanitises hostile or missing fields from the remote payload", async () => {
    mockFetch(
      async () =>
        ({
          ok: true,
          json: async () => ({
            results: [
              { login: { uuid: 42 }, name: { first: "  Ada \n Mae ", last: "x".repeat(500) }, nat: "gb" },
              { name: {}, nat: "NOT-A-COUNTRY" },
            ],
          }),
        }) as Response,
    );
    const [first, second] = await listRandomUsers();
    expect(first.id).toBe("random-user-0");
    expect(first.name.length).toBeLessThanOrEqual(120);
    expect(first.name.startsWith("Ada Mae")).toBe(true);
    expect(first.country).toBe("GB");
    expect(second).toEqual({ id: "random-user-1", name: "Applicant 2", country: "US" });
  });

  it("maps every record to { id, name, country }", async () => {
    mockFetch(async () => apiResponse(3));
    for (const r of await randomUserConnector.listRecords()) {
      expect(Object.keys(r).sort()).toEqual(["country", "id", "name"]);
    }
  });
});

describe("live connector failure handling", () => {
  it("falls back to the fixture on timeout and still yields a count", async () => {
    mockFetch(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    const records = await listRandomUsers();
    expect(records).toEqual(fixtureApplicants);
    expect(records.length).toBeGreaterThan(0);
  });

  it("falls back to the fixture on a non-200 response", async () => {
    mockFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response);
    expect(await listRandomUsers()).toEqual(fixtureApplicants);
  });

  it("falls back to the fixture on a malformed payload", async () => {
    mockFetch(async () => ({ ok: true, json: async () => ({ nope: true }) }) as Response);
    expect(await listRandomUsers()).toEqual(fixtureApplicants);
  });

  it("requests the documented url with a 2s timeout signal", async () => {
    const spy = vi.fn(async () => apiResponse(1));
    mockFetch(spy as unknown as typeof globalThis.fetch);
    await listRandomUsers();
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://randomuser.me/api/?results=8&nat=us,gb,de,fr,in&seed=internal-tools-demo");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("disabled connectors", () => {
  it("cannot be invoked", async () => {
    mockFetch(async () => {
      throw new Error("a disabled connector must not reach the network");
    });
    for (const connector of connectors.filter((c) => c.status === "disabled")) {
      await expect(connector.listRecords()).rejects.toBeInstanceOf(ConnectorDisabledError);
      await expect(connector.listRecords()).rejects.toThrow("Not wired in this prototype");
    }
  });
});
