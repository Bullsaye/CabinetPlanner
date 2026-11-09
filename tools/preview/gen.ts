// Builds viewer data from the engine and injects it into the page template.
// Usage: pnpm preview <out.html> <project.json>...   (see tools/preview/README.md)
import { readFileSync, writeFileSync } from "node:fs";
import {
  buildProject,
  formatNumber,
  loadProject,
  localName,
  partSvg,
  sceneOf,
} from "../../packages/engine/src/index.ts";
import { createTranslator } from "../../packages/i18n/src/index.ts";

const [out, ...projects] = process.argv.slice(2);
const template = new URL("./template.html", import.meta.url).pathname;
const tr = createTranslator("en");

const cabinets: unknown[] = [];
for (const file of projects) {
  const result = buildProject(loadProject(JSON.parse(readFileSync(file!, "utf8"))));
  if (!result.ok) throw new Error(`${file} has errors`);
  for (const c of result.cabinets) {
    const scene = sceneOf(c);
    cabinets.push({
      id: c.resolved.cabinet.id,
      name: c.resolved.cabinet.name ?? result.project.name,
      size: scene.size,
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
          svg: partSvg(
            part,
            {
              title: `${part.id} · ${tr.t(`role.${part.role}`)}`,
              subtitle: `${formatNumber(part.length)} × ${formatNumber(part.width)} × ${formatNumber(part.thickness)} mm · ${localName(mat.name, "en")}`,
              face: (f) => tr.t(`face.${f}`),
              legend: {
                viewed: tr.t("drawing.viewed"),
                opposite: tr.t("drawing.opposite"),
                edge: tr.t("drawing.edge"),
                banded: tr.t("drawing.banded"),
                table: tr.t("drawing.table"),
                count: tr.t("drawing.count"),
              },
            },
            { style: false },
          ),
        };
      }),
    });
  }
}

const html = readFileSync(template!, "utf8").replace("/*DATA*/null", JSON.stringify(cabinets));
writeFileSync(out!, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB, ${cabinets.length} cabinets)`);
