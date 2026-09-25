import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupFixtures, makeFlag } from "@/test/fixtures";
import { GET } from "./route";

const TOKEN = "test-api-token";

type FlagsBody = {
  env: string;
  generatedAt: string;
  flags: Record<string, { enabled: boolean; rolloutPercentage: number; targetUserIds: string[] }>;
};

function request(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

function authed(url: string) {
  return request(url, { authorization: `Bearer ${TOKEN}` });
}

let liveKey: string;
let archivedKey: string;
let offKey: string;
let originalToken: string | undefined;

beforeAll(async () => {
  originalToken = process.env.FLAGS_API_TOKEN;
  process.env.FLAGS_API_TOKEN = TOKEN;

  const live = await makeFlag({
    dev: { enabled: true, rolloutPercentage: 100 },
    staging: { enabled: true, rolloutPercentage: 50, targetUserIds: ["u1", "u2"] },
    prod: { enabled: true, rolloutPercentage: 0, targetUserIds: [] },
  });
  const archived = await makeFlag({ archived: true, prod: { enabled: true, rolloutPercentage: 100 } });
  const off = await makeFlag({ prod: { enabled: false, rolloutPercentage: 0, targetUserIds: [] } });
  liveKey = live.key;
  archivedKey = archived.key;
  offKey = off.key;
});

afterAll(async () => {
  process.env.FLAGS_API_TOKEN = originalToken;
  await cleanupFixtures();
});

describe("GET /api/flags authentication", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await GET(request("http://test.local/api/flags?env=prod"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a wrong token", async () => {
    const res = await GET(request("http://test.local/api/flags", { authorization: "Bearer nope" }));
    expect(res.status).toBe(401);
  });

  it("accepts a bare token without the Bearer scheme", async () => {
    const res = await GET(request("http://test.local/api/flags", { authorization: TOKEN }));
    expect(res.status).toBe(200);
  });

  it("accepts a lowercase bearer scheme", async () => {
    const res = await GET(request("http://test.local/api/flags", { authorization: `bearer ${TOKEN}` }));
    expect(res.status).toBe(200);
  });

  it("rejects a token that only differs in case", async () => {
    const res = await GET(request("http://test.local/api/flags", { authorization: `Bearer ${TOKEN.toUpperCase()}` }));
    expect(res.status).toBe(401);
  });

  it("rejects a token that is a prefix of the real one", async () => {
    const res = await GET(request("http://test.local/api/flags", { authorization: `Bearer ${TOKEN.slice(0, -1)}` }));
    expect(res.status).toBe(401);
  });

  it("rejects an empty Authorization header", async () => {
    const res = await GET(request("http://test.local/api/flags", { authorization: "" }));
    expect(res.status).toBe(401);
  });

  it("rejects a Bearer scheme with no token", async () => {
    const res = await GET(request("http://test.local/api/flags", { authorization: "Bearer " }));
    expect(res.status).toBe(401);
  });

  it("rejects every request when the server has no token configured", async () => {
    delete process.env.FLAGS_API_TOKEN;
    try {
      const res = await GET(authed("http://test.local/api/flags"));
      expect(res.status).toBe(401);
    } finally {
      process.env.FLAGS_API_TOKEN = TOKEN;
    }
  });
});

describe("GET /api/flags payload", () => {
  it("returns the requested environment for non-archived flags", async () => {
    const res = await GET(authed("http://test.local/api/flags?env=staging"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as FlagsBody;
    expect(body.env).toBe("staging");
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
    expect(body.flags[liveKey]).toEqual({
      enabled: true,
      rolloutPercentage: 50,
      targetUserIds: ["u1", "u2"],
    });
  });

  it("defaults to prod when env is omitted", async () => {
    const body = (await (await GET(authed("http://test.local/api/flags"))).json()) as FlagsBody;
    expect(body.env).toBe("prod");
    expect(body.flags[liveKey]).toEqual({ enabled: true, rolloutPercentage: 0, targetUserIds: [] });
  });

  it("treats the env parameter case-insensitively", async () => {
    const body = (await (await GET(authed("http://test.local/api/flags?env=DeV"))).json()) as FlagsBody;
    expect(body.env).toBe("dev");
    expect(body.flags[liveKey].rolloutPercentage).toBe(100);
  });

  it("omits archived flags", async () => {
    const body = (await (await GET(authed("http://test.local/api/flags?env=prod"))).json()) as FlagsBody;
    expect(body.flags[archivedKey]).toBeUndefined();
  });

  it("rejects an unknown environment with 400", async () => {
    const res = await GET(authed("http://test.local/api/flags?env=qa"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown env "qa"' });
  });

  it("rejects an empty env parameter rather than silently defaulting", async () => {
    const res = await GET(authed("http://test.local/api/flags?env="));
    expect(res.status).toBe(400);
  });

  it("rejects an env that only looks like a real one", async () => {
    for (const env of ["production", "pro d", "prod%20", "dev1"]) {
      const res = await GET(authed(`http://test.local/api/flags?env=${encodeURIComponent(env)}`));
      expect(res.status).toBe(400);
    }
  });

  it("reports a disabled flag rather than omitting it", async () => {
    const body = (await (await GET(authed("http://test.local/api/flags?env=prod"))).json()) as FlagsBody;
    expect(body.flags[offKey]).toEqual({ enabled: false, rolloutPercentage: 0, targetUserIds: [] });
  });

  it("ignores unknown query parameters and honours the first env value", async () => {
    const body = (await (
      await GET(authed("http://test.local/api/flags?env=dev&env=prod&debug=1"))
    ).json()) as FlagsBody;
    expect(body.env).toBe("dev");
    expect(body.flags[liveKey].rolloutPercentage).toBe(100);
  });

  it("serves every environment with a consistent per-flag shape", async () => {
    for (const env of ["dev", "staging", "prod"]) {
      const res = await GET(authed(`http://test.local/api/flags?env=${env}`));
      expect(res.status).toBe(200);
      const body = (await res.json()) as FlagsBody;
      expect(body.env).toBe(env);
      expect(Object.keys(body.flags[liveKey]).sort()).toEqual([
        "enabled",
        "rolloutPercentage",
        "targetUserIds",
      ]);
    }
  });
});
