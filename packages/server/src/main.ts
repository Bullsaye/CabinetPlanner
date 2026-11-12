/**
 * Cabinet Planner server: accounts, community packs and library sync.
 *
 *   node server.mjs                          start the server
 *   node server.mjs set-password <e-mail>    set a new password (asks for it, or reads the 2nd argument)
 *   node server.mjs users                    list accounts
 *
 * Configuration by environment: PORT, HOST, DATA_DIR, ADMIN_EMAILS,
 * CORS_ORIGINS, TRUST_PROXY (see README.md).
 */
import { networkInterfaces } from "node:os";
import { createInterface } from "node:readline/promises";
import { createApp } from "./app.ts";
import { fromEnv } from "./config.ts";

async function main(): Promise<void> {
  // node:sqlite still prints an "experimental" notice in Node 22.
  process.removeAllListeners("warning");
  process.on("warning", (w) => {
    if (w.name !== "ExperimentalWarning") console.warn(w.message);
  });

  const [command, ...args] = process.argv.slice(2);
  const config = fromEnv();

  if (command === "set-password") {
    const email = args[0];
    if (!email) return fail("Usage: set-password <e-mail> [new password]");
    let password = args[1];
    if (!password) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      password = (await rl.question("New password: ")).trim();
      rl.close();
    }
    const app = createApp(config);
    try {
      const done = await app.accounts.setPassword(email, password);
      if (!done) return fail(`No account with the e-mail ${email}.`);
      console.log(`Password set for ${email}. The account is signed out on all devices.`);
    } catch (e) {
      fail((e as Error).message);
    } finally {
      app.db.close();
    }
    return;
  }

  if (command === "users") {
    const app = createApp(config);
    for (const u of app.db.all<{ email: string; display_name: string; created_at: number }>("SELECT email, display_name, created_at FROM users ORDER BY created_at")) {
      console.log(`${new Date(u.created_at).toISOString().slice(0, 10)}  ${u.email}  ${u.display_name}${config.adminEmails.includes(u.email) ? "  (admin)" : ""}`);
    }
    app.db.close();
    return;
  }

  if (command && command !== "serve") return fail(`Unknown command "${command}". Commands: serve, set-password, users.`);

  const app = createApp(config);
  await app.listen();
  console.log(`Cabinet Planner server listening on port ${config.port} (data: ${config.dataDir})`);
  console.log(`  this computer:  http://localhost:${config.port}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) console.log(`  in the network: http://${a.address}:${config.port}`);
  }
  if (!config.adminEmails.length) console.log("  no ADMIN_EMAILS set: nobody can hide packs or mark them verified");
  const stop = (): void => void app.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

void main();
