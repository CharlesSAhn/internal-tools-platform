import { kycApp } from "@/app/kyc/app.config";
import { flagsApp } from "@/app/flags/app.config";
import type { AppConfig } from "./types";

/**
 * The only file that knows which apps exist. Each app owns its own
 * `app.config.ts`, so adding internal app #3 is one line here plus one new
 * directory — no changes to auth, audit, nav or the seed.
 */
export const apps: AppConfig[] = [kycApp, flagsApp];

export const platformPermissions = [
  { key: "admin.audit.view", description: "Read the platform-wide audit log" },
  { key: "admin.users.view", description: "See users and their roles" },
];

export function allPermissions() {
  return [
    ...platformPermissions.map((p) => ({ ...p, app: "platform" })),
    ...apps.flatMap((a) => a.permissions.map((p) => ({ ...p, app: a.id }))),
  ];
}

export type { AppConfig };
