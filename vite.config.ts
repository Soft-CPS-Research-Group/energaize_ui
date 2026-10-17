import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { communityRuntime } from './config/communityRuntime';
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
 const env = loadEnv(mode, process.cwd(), "");
 return {
  plugins: [react(), communityRuntime(), {
    name: "console-entry",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || "/").split("?", 1)[0];
        if (["/console", "/console/", "/console/index.html"].includes(path)) {
          res.writeHead(302, { Location: '/communities', "Cache-Control": "no-store" });
          res.end();
        } else next();
      });
    }
  }],
  assetsInclude: ["**/*.onnx"],
  server: {

    proxy: {
      "/ai-training-api": { target: env.AI_TRAINING_PROXY_TARGET || "http://127.0.0.1:8022", changeOrigin: true, rewrite: path => path.replace(/^\/ai-training-api/, "") },
      "/training-api": { target: env.TRAINING_PROXY_TARGET || "http://193.136.62.78:8011", changeOrigin: true, rewrite: path => path.replace(/^\/training-api/, "") },
      "/runtime-api": { target: env.RUNTIME_PROXY_TARGET || "http://127.0.0.1:8021", changeOrigin: true, rewrite: path => path.replace(/^\/runtime-api/, "") },
      "/measurement-api": { target: env.MEASUREMENT_PROXY_TARGET || "http://193.136.62.78:8000", changeOrigin: true, ws: true, rewrite: (path) => path.replace(/^\/measurement-api/, "") },
      "/community-api": {
        target: env.COMMUNITY_PROXY_TARGET || "http://127.0.0.1:8017",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/community-api/, "")
      },
      "/access-api": {
        target: env.ACCESS_PROXY_TARGET || "http://127.0.0.1:8018",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/access-api/, "")
      },
      "/telemetry-api": {
        target: env.TELEMETRY_PROXY_TARGET || "http://127.0.0.1:8019",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/telemetry-api/, "")
      },
      "/flexibility-api": {
        target: env.FLEXIBILITY_PROXY_TARGET || "http://127.0.0.1:8020",
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
    include: ['src/**/*.test.{ts,tsx}'],
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: true,
    css: true
  }
};
});
