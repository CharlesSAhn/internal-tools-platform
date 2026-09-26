import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    coverage: {
      provider: "v8",
      include: ["app/**/*.ts", "platform/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@platform": resolve(__dirname, "platform"),
      "@": resolve(__dirname, "."),
    },
  },
});
