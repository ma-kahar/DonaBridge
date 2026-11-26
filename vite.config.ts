import os from "node:os";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // Keep the dependency cache outside the project. Projects stored in OneDrive
  // (or any synced folder) cannot reliably create node_modules/.vite temp files
  // and esbuild fails with "Access is denied".
  cacheDir: path.join(os.tmpdir(), "dona-bridge-vite-cache"),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Tauri expects a fixed port in dev. Bind IPv4 explicitly: on some Windows
  // setups `localhost` resolves to ::1 while WebView2 tries 127.0.0.1 first,
  // which leaves the shell on a blank page.
  server: {
    port: 5173,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5183,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/target/**", "**/dist/**"],
    },
  },
  build: {
    // Tauri uses Chromium on Windows — target modern baseline
    target: ["es2021", "chrome105"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
