import { defineConfig } from "@desirecore/electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      // Two entries share the main-process build: the Electron app and the
      // headless daemon (`node out/main/daemon.js`). The daemon's module graph
      // is Electron-free, so its bundle never requires "electron".
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          daemon: resolve("src/daemon/index.ts"),
        },
      },
      // NOTE: keep rollup's default `dynamicImportInCjs` behavior! With it,
      // dynamic `import()` of external ESM-only packages (the Pi SDK) stays a
      // native `import()` in the CJS main bundle, which is required by the
      // lazy loader in `src/main/agent/pi-sdk.ts` (Node >= 22 supports
      // import() from CommonJS). Setting the option to `false` would *force*
      // the require() rewrite and break ESM-only deps.
    },
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: true,
    },
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react()],
  },
});
