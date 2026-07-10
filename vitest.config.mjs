import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "Temp_prototype_parts/**",
      "mockup_integration_project/**",
    ],
  },
});
