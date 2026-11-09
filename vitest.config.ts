import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // Property tests run hundreds of cabinets; slow CI machines (Windows) need more than the default 5 s.
    testTimeout: 60_000,
  },
});
