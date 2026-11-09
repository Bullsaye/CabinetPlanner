// Builds viewer data from the engine and injects it into the page template.
// Usage: pnpm preview <out.html> <project.json>...   (see tools/preview/README.md)
import { readFileSync, writeFileSync } from "node:fs";
import {
  buildProject,
  drawAssembly,
  drawingText,
  drawPartSheets,
  stackSheets,
  formatNumber,
  loadProject,
  loadShop,
  localName,
  resolveStyle,
  sceneOf,
} from "../../packages/engine/src/index.ts";
import { createTranslator } from "../../packages/i18n/src/index.ts";

const args = process.argv.slice(2);
const shopArg = args.find((a) => a.startsWith("--shop="));
const [out, ...projects] = args.filter((a) => !a.startsWith("--"));
const shop = shopArg ? loadShop(JSON.parse(readFileSync(shopArg.slice(7), "utf8"))) : undefined;
const template = new URL("./template.html", import.meta.url).pathname;
const tr = createTranslator("en");

const cabinets: unknown[] = [];
for (const file of projects) {
  const result = buildProject(loadProject(JSON.parse(readFileSync(file!, "utf8"))), shop);
  if (!result.ok) throw new Error(`${file} has errors`);
  for (const c of result.cabinets) {
    const scene = sceneOf(c);
    cabinets.push({
      id: c.resolved.cabinet.id,
      name: c.resolved.cabinet.name ?? result.project.name,
      size: scene.size,
      assembly: drawAssembly({
        cabinet: {
          id: c.resolved.cabinet.id,
          ...(c.resolved.cabinet.name ? { name: c.resolved.cabinet.name } : {}),
          W: scene.size.W,
          H: scene.size.H,
          D: scene.size.D,
        },
        parts: c.parts,
        hardware: c.hardware,
        library: result.library,
        text: drawingText(tr, result.library),
        project: { name: result.project.name, revision: result.project.revision },
        css: false,
      }).svg,
      hardware: c.hardware.map((h) => ({
        id: h.item,
        name: localName(result.library.hardware.get(h.item)!.name, "en"),
        qty: h.qty,
      })),
      parts: scene.parts.map((sp) => {
        const part = c.parts.find((p) => p.id === sp.id)!;
        const mat = result.library.materials.get(part.material)!;
        return {
          ...sp,
          name: tr.t(`role.${part.role}`),
          materialName: localName(mat.name, "en"),
          size: `${formatNumber(part.length)} × ${formatNumber(part.width)} × ${formatNumber(part.thickness)}`,
          ops: part.operations.length,
          sheet: stackSheets(
            drawPartSheets({
              part,
              cabinet: { W: scene.size.W, H: scene.size.H, D: scene.size.D },
              style: resolveStyle("machine"),
              text: drawingText(tr, result.library, "Part sheet"),
              css: false,
            }),
          ),
        };
      }),
    });
  }
}

const html = readFileSync(template!, "utf8").replace("/*DATA*/null", JSON.stringify(cabinets));
writeFileSync(out!, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB, ${cabinets.length} cabinets)`);
