#!/usr/bin/env -S npx tsx
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { run } from "./app.ts";

process.exitCode = run(process.argv.slice(2), {
  readFile: (p) => readFileSync(p, "utf8"),
  writeFile: (p, c) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, c);
  },
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  env: process.env,
});
