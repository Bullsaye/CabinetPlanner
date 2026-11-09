import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `vite build --mode single` produces one self-contained index.html
// (used for the published preview); the normal build splits assets.
export default defineConfig(({ mode }) => ({
  plugins: [svelte(), ...(mode === "single" ? [viteSingleFile()] : [])],
  build: { target: "es2022", outDir: mode === "single" ? "dist-single" : "dist" },
  server: { port: 5173 },
}));
