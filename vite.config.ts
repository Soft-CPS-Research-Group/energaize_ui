import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  assetsInclude: ["**/*.onnx"],
  server: {
    watch: {
      usePolling: true,
      interval: 500,
      ignored: ["**/example/jobs/**", "**/dist/**"]
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: true,
    css: true
  }
});
