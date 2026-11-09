# Cabinet Planner server

Optional server for the app: accounts, the community section (shared packs
of presets, templates, hardware …) and sync of the shop library between
devices. The app works fully without it.

One Node 22 process, one SQLite file. No native modules, no framework:
`node:http`, `node:sqlite`, `node:crypto`, zod, and the planner engine to
check shared content.

## First try on a Windows PC (web app, desktop app and phone in the same Wi-Fi)

1. Install [Node.js 22](https://nodejs.org) and pnpm (`npm install -g pnpm`).
2. In the repository folder:

   ```sh
   pnpm install
   pnpm run server
   ```

   (`pnpm run server`, not `pnpm server`: pnpm has a built-in command of
   that name, which does nothing here.) The server prints its addresses,
   for example

   ```
   this computer:  http://localhost:8787
   in the network: http://192.168.1.23:8787
   ```

   Data goes to `packages/server/data/` (delete the folder to start over).
3. The first time, Windows asks whether Node may accept connections: allow
   it for **private networks**, otherwise the phone cannot reach the PC.
4. Start the app (`pnpm app`, or the desktop app) and click **Sign in** in
   the top bar. Under **Server**, enter `http://localhost:8787` on the PC.
   On the phone or tablet enter the network address
   (`http://192.168.1.23:8787`). Register an account; use the same account on
   every device.
5. Check from the phone's browser that `http://192.168.1.23:8787/health`
   shows `{"ok":true,…}`. If not: firewall (step 3) or a guest Wi-Fi that
   separates devices.

To preset the address in a build of the app, set `VITE_CLOUD_URL` when
building (`VITE_CLOUD_URL=https://packs.example.com pnpm app:build`); users
can still change it in the account dialog.

Good to know for the first try:

- A web app served over **https** cannot talk to an `http://` server (the
  browser blocks mixed content). `http://localhost:5173` → `http://…:8787`
  is fine. A hosted web app needs the server on https.
- The desktop and Android apps must allow the server address in their
  content security policy (`connect-src`), and Android blocks plain `http`
  unless clear-text traffic is enabled for the build. For anything beyond a
  test at home, host the server with https.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to listen on |
| `DATA_DIR` | `./data` | Folder of the SQLite file `cabinet-planner.sqlite` |
| `ADMIN_EMAILS` | – | Comma-separated e-mail addresses of admins |
| `CORS_ORIGINS` | `*` | Comma-separated origins allowed to call the API. `*` is safe here because sign-in uses an `Authorization` header, not cookies. To restrict it, list the web app's origin and those of the Tauri apps (`tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`). |
| `TRUST_PROXY` | off | `1` behind a reverse proxy: take the client address (rate limits, install counts) from `X-Forwarded-For` |

Windows (PowerShell): `$env:ADMIN_EMAILS="you@example.com"; pnpm run server`.

## Admin

- Admins are the accounts whose e-mail is in `ADMIN_EMAILS`. **Register
  those accounts yourself right after the first start**: e-mail addresses
  are not verified yet (see below), so whoever registers an admin address
  first is that admin.
- In the app an admin sees *Mark verified* and *Hide* on a pack. Reports:
  `GET /api/admin/reports` (and `POST /api/admin/reports/:id/resolve`) with
  the admin's token.
- New password for an account (there is no reset by e-mail):

  ```sh
  pnpm --filter @cabinet-planner/server admin set-password someone@example.com
  # bundled: node server.mjs set-password someone@example.com
  # Docker:  docker exec -it <container> node server.mjs set-password someone@example.com
  ```

  The account is signed out everywhere. `… admin users` lists the accounts.

## Hosting

Build one file and run it anywhere Node 22 runs:

```sh
pnpm server:build                 # → packages/server/dist/server.mjs
DATA_DIR=/var/lib/cabinet-planner ADMIN_EMAILS=you@example.com node packages/server/dist/server.mjs
```

Or with Docker (from the repository root):

```sh
docker build -f packages/server/Dockerfile -t cabinet-planner-server .
docker run -d --name cabinet-planner -p 8787:8787 \
  -v cabinet-planner-data:/data \
  -e ADMIN_EMAILS=you@example.com \
  cabinet-planner-server
```

- **VPS**: run the container and put Caddy, nginx or Traefik in front for
  https (Caddy: `packs.example.com { reverse_proxy localhost:8787 }`), and
  set `TRUST_PROXY=1`.
- **Fly.io / Render / Railway**: deploy the Dockerfile, mount a persistent
  volume at `/data`, set `ADMIN_EMAILS` and `TRUST_PROXY=1`. They provide
  https. Run a single instance: SQLite is one file, and the rate limiter
  lives in memory.
- **Backup**: copy `cabinet-planner.sqlite` (plus the `-wal` file if
  present), or `sqlite3 cabinet-planner.sqlite ".backup backup.sqlite"`.
- The database schema is migrated at start (numbered steps in `src/db.ts`,
  tracked in `PRAGMA user_version`).

## What it does and does not do

- **Accounts**: e-mail, display name (unique), password of at least 10
  characters. Passwords are stored as scrypt hashes with a salt per user;
  sessions are random 256-bit tokens, stored as SHA-256 hashes, valid for
  30 days. Changing the password signs other devices out.
- **No e-mail is sent.** There is no address verification and no password
  reset by mail yet; use `set-password` above. Registering tells whether an
  address already has an account.
- **Deleting an account** removes its sessions, synced documents, ratings
  and **its packs with all versions**. Copies other people installed stay
  in their libraries; reports the account filed stay without a name.
- **Packs**: content is validated with the engine's library schema
  (unknown fields are dropped) and limited to 512 kB. Trust levels:
  `community`, `tested` (the author ticks "I machined a part with this"),
  `verified` (admins). A new version resets `verified`. Installs are counted
  once per account, or once per address and day without one.
- **Sync**: one document per user, kind and id with a revision counter
  (`/api/sync/docs/:kind/:id`); a write based on an old revision gets `409`
  with the server copy. The app syncs the shop library (`shop/default`).
- **Limits**: request bodies 64 kB (packs ~1 MB, synced documents 2 MB);
  per address 10 sign-in/registration requests per minute and 6 publishing
  requests per minute (in memory, per process).
- Errors are always `{ "error": { "code": "…", "message": "…" } }` with a
  stable `code`; the app translates codes and never shows `message`.

## API

`Authorization: Bearer <token>` where marked 🔒 (👑 = admin).

| Method and path | |
| --- | --- |
| `GET /health` | status, API version, licences |
| `POST /api/auth/register` | `{ email, password, displayName }` → `{ token, expiresAt, user }` |
| `POST /api/auth/login` | `{ email, password }` → `{ token, expiresAt, user }` |
| `POST /api/auth/logout` 🔒 | ends this session |
| `GET /api/me` 🔒 | `{ user }` |
| `PATCH /api/me` 🔒 | `{ displayName }` |
| `POST /api/me/password` 🔒 | `{ currentPassword, newPassword }` |
| `DELETE /api/me` 🔒 | `{ password }` |
| `GET /api/packs` | `q`, `type` (presets, templates, hardware, materials, edgebands, drawingStyles, dxfProfiles), `tag`, `trust` (comma list), `sort` (newest, downloads, rating), `page`, `pageSize` (≤ 50), `ids`, `mine=1` 🔒 |
| `GET /api/packs/:id` | pack with versions and the content of the latest version |
| `GET /api/packs/:id/versions/:version` | content of one version |
| `POST /api/packs` 🔒 | `{ name, description, tags, licence, language, tested, version, changelog, forkedFrom?, content }` |
| `POST /api/packs/:id/versions` 🔒 owner | `{ version, changelog, tested, content }` (version must be newer) |
| `PATCH /api/packs/:id` 🔒 owner | name, description, tags, licence, language, tested |
| `DELETE /api/packs/:id` 🔒 owner | unpublish |
| `PUT` / `DELETE /api/packs/:id/rating` 🔒 | `{ stars: 1–5 }`, not for the own pack |
| `POST /api/packs/:id/reports` 🔒 | `{ reason }` |
| `POST /api/packs/:id/installed` | counts an install |
| `GET /api/admin/reports` 👑 | open reports (`all=1`: all) |
| `POST /api/admin/reports/:id/resolve` 👑 | |
| `PATCH /api/admin/packs/:id` 👑 | `{ hidden?, verified? }` |
| `GET /api/sync/docs/:kind` 🔒 | list of documents |
| `GET` / `DELETE /api/sync/docs/:kind/:id` 🔒 | `{ doc, revision, updatedAt }` |
| `PUT /api/sync/docs/:kind/:id` 🔒 | `{ baseRevision, doc }` → `{ revision }` or `409` + `current` |

Tests: `pnpm test` (root) starts the server on a free port with an
in-memory database and exercises every endpoint.
