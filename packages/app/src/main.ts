import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { hostKind } from "./lib/platform.ts";

if (import.meta.env.MODE !== "single") {
  // Bundled fonts: the app works offline (PWA, desktop).
  void import("./fonts.ts");
  // Offline cache for the web app; Tauri ships its files locally.
  if (hostKind() === "web" && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    void navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  }
}

mount(App, { target: document.getElementById("app")! });
