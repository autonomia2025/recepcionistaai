import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests for pure functions: frontend helpers (src/lib) and the edge
// functions' shared modules (supabase/functions/_shared), which have no
// remote imports and run the same under Node.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
