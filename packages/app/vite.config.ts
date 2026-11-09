import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * `vite build --mode single` produces one self-contained index.html (the
 * published preview): fonts from Google Fonts, no service worker. The normal
 * build (PWA, Tauri) bundles the fonts and links the manifest so it works
 * offline.
 */
const head = (single: boolean): Plugin => ({
  name: "app-head",
  transformIndexHtml: (html) =>
    html.replace(
      "<!--app-head-->",
      single
        ? `<link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />`
        : `<link rel="manifest" href="./manifest.webmanifest" />
    <link rel="icon" href="./icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="./apple-touch-icon.png" />`,
    ),
});

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [svelte(), head(mode === "single"), ...(mode === "single" ? [viteSingleFile()] : [])],
  build: { target: "es2022", outDir: mode === "single" ? "dist-single" : "dist", chunkSizeWarningLimit: 1500 },
  // Single-file build needs no static files.
  publicDir: mode === "single" ? false : "public",
  server: { port: 5173, strictPort: true },
  // Tauri reads these (desktop dev against the Vite server).
  envPrefix: ["VITE_", "TAURI_ENV_"],
  clearScreen: false,
}));
