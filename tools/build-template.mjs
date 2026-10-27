#!/usr/bin/env node
// Assembles skills/safis/assets/template.html from src/.
// The runtime block sits between explainer:runtime markers so scripts/upgrade.mjs
// can swap it in existing pages.
//
// Usage: node tools/build-template.mjs [--out <file>]
// --out writes somewhere else, for trying changes without touching the skill's template.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const outArg = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null;
const read = f => readFile(path.join(root, f), "utf8");
// SAFIS_SKIP=iso,effects leaves those kits out, for building around one that isn't finished.
const skip = new Set((process.env.SAFIS_SKIP ?? "").split(",").filter(Boolean).map(n => `src/${n}.js`));
const optional = f => (!skip.has(f) && existsSync(path.join(root, f)) ? read(f) : "");

// Order matters: fonts before the theme, the engine and extensions before the runtime.
const STYLES = ["src/fonts.css", "src/theme.css", "src/tex.css", "src/plot.css", "src/sim.css", "src/article.css", "src/code.css"];
const SCRIPTS = ["src/engine3d.js", "src/parts3d.js", "src/tex.js", "src/plot.js", "src/sim.js", "src/geo.js", "src/optics.js", "src/sound.js", "src/image.js", "src/effects.js", "src/iso.js", "src/runtime.js"];
const [styles, scripts, page] = await Promise.all([
  Promise.all(STYLES.map(optional)),
  Promise.all(SCRIPTS.map(optional)),
  read("src/page.html"),
]);
// Fonts live as files in src/fonts/; pages carry them inline so they open from disk.
const inlineFonts = async s => {
  const refs = [...new Set([...s.matchAll(/url\("fonts\/([^"]+\.woff2)"\)/g)].map(m => m[1]))];
  for (const f of refs) {
    const b64 = (await readFile(path.join(root, "src/fonts", f))).toString("base64");
    s = s.replaceAll(`url("fonts/${f}")`, `url("data:font/woff2;base64,${b64}")`);
  }
  return s;
};
const css = (await Promise.all(styles.map(s => inlineFonts(s.trim())))).filter(Boolean).join("\n\n");
const block = `<!-- explainer:runtime:start v3 -->
<style>
${css}
</style>
${scripts.map(s => s.trim()).filter(Boolean).map(s => `<script>\n${s}\n</script>`).join("\n")}
<!-- explainer:runtime:end -->`;
const out = page.replace(/<!-- explainer:runtime:start -->[\s\S]*?<!-- explainer:runtime:end -->/, () => block);
if (out === page) throw new Error("runtime markers not found in src/page.html");
const dest = path.resolve(outArg ?? path.join(root, "skills/safis/assets/template.html"));
await writeFile(dest, out);
console.log(`wrote ${path.relative(process.cwd(), dest)} (${(out.length / 1024).toFixed(0)} KB)`);
