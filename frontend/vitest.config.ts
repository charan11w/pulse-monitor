import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    pool: "threads",
    maxWorkers: 1,
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
