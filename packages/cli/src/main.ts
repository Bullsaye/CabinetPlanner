#!/usr/bin/env -S npx tsx
import { readFileSync, writeFileSync } from "node:fs";
import { run } from "./app.ts";

process.exitCode = run(process.argv.slice(2), {
  readFile: (p) => readFileSync(p, "utf8"),
  writeFile: (p, c) => writeFileSync(p, c, "utf8"),
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  env: process.env,
});
