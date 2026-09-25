import { describe, expect, it } from "vitest";

import { allPermissions, apps, platformPermissions } from "./index";
import { defineApp } from "./types";

describe("app registry", () => {
  it("registers each app once under a unique id that its view permission and nav belong to", () => {
    const ids = apps.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const app of apps) {
      expect(app.permissions.map((p) => p.key)).toContain(app.viewPermission);
      for (const p of app.permissions) expect(p.key.startsWith(`${app.id}.`)).toBe(true);
      for (const n of app.nav) expect(n.href.startsWith(`/${app.id}`)).toBe(true);
    }
  });

  it("allPermissions tags every key with its owning app and has no duplicates", () => {
    const all = allPermissions();
    const keys = all.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of platformPermissions) expect(all).toContainEqual({ ...p, app: "platform" });
    for (const app of apps) for (const p of app.permissions) expect(all).toContainEqual({ ...p, app: app.id });
  });

  it("defineApp is an identity that preserves the config", () => {
    const cfg = { id: "x", name: "X", description: "", viewPermission: "x.view", permissions: [], nav: [] };
    expect(defineApp(cfg)).toBe(cfg);
  });
});
