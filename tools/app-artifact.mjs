// Turns the single-file app build into a page fragment for claude.ai
// artifacts (no doctype/html/head/body; the host adds its own skeleton).
// Usage: node tools/app-artifact.mjs packages/app/dist-single/index.html out.html
import { readFileSync, writeFileSync } from "node:fs";

const [src, out] = process.argv.slice(2);
let html = readFileSync(src, "utf8");
const take = (re) => {
  const m = html.match(re);
  return m ? m[0] : "";
};
// Pull scripts out first: the bundle itself contains "<style>" text.
const scripts = [];
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (m) => {
  scripts.push(m);
  return "";
});
const title = take(/<title>[\s\S]*?<\/title>/);
const links = [...html.matchAll(/<link [^>]*fonts\.g[^>]*>/g)].map((m) => m[0]).join("\n");
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]).join("\n");
const body = take(/<div id="app"><\/div>/);
const page = [title, '<meta name="claude:viewport-fit-sides" content="cover">', links, styles, body, ...scripts].join("\n");
writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
