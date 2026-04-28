import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    resolve: {
      conditions: ["workspace"],
    },
  },
});
