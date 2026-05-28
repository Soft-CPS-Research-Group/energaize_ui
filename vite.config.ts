import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  assetsInclude: ["**/*.onnx"],
  server: {
    proxy: {
      "/community-api": {
        target: "http://193.136.62.78:8017",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/community-api/, "")
      },
      "/access-api": {
        target: "http://193.136.62.78:8018",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/access-api/, "")
      },
      "/telemetry-api": {
        target: "http://193.136.62.78:8019",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/telemetry-api/, "")
      },
      "/flexibility-api": {
        target: "http://193.136.62.78:8020",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/flexibility-api/, "")
      }
    },
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
