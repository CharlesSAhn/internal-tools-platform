import { defineApp } from "@platform/registry/types";

export const flagsApp = defineApp({
  id: "flags",
  name: "Feature Flags",
  description: "Environment-scoped feature flag administration",
  viewPermission: "flags.app.view",
  permissions: [
    { key: "flags.app.view", description: "See feature flags" },
    { key: "flags.flag.create", description: "Create and archive flags" },
    { key: "flags.write.nonprod", description: "Change flag state in dev/staging" },
    { key: "flags.write.prod", description: "Change flag state in production" },
  ],
  nav: [{ label: "Feature Flags", href: "/flags" }],
});
