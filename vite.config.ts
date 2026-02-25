import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "esnext",
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background/service-worker.ts"),
        content: resolve(__dirname, "src/content/overlay.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        // No code splitting — each entry is self-contained
        inlineDynamicImports: false,
        format: "es",
      },
    },
  },
});
