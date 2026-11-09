# Desktop shell (Tauri 2)

The planner itself is the web app in `packages/app`; this package wraps it
in a native window for Windows, macOS and Linux (and later iPad/Android via
Tauri mobile). The Rust side only adds native open/save dialogs and file
access for the files picked in them (`tauri-plugin-dialog`,
`tauri-plugin-fs`). Projects are stored by the web app in the webview's
IndexedDB, inside the app's data folder.

## Requirements

- Rust (stable) and Node 22 with pnpm.
- Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev`.
- Windows: WebView2 (preinstalled on Windows 10/11) and the MSVC build tools.
- macOS: Xcode command line tools.

## Commands

```sh
pnpm desktop            # dev window against the Vite dev server (hot reload)
pnpm desktop:build      # installers in packages/desktop/src-tauri/target/release/bundle/
pnpm --filter @cabinet-planner/desktop icons   # regenerate icons from app/public/icon-1024.png
```

Installers for all platforms are built by the "Desktop builds" GitHub
workflow (run it by hand, or push a tag `v*`). They are unsigned for now:
Windows SmartScreen and macOS Gatekeeper warn on first start.
