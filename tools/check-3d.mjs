#!/usr/bin/env node
// Renders the 3D lab (tools/lab/article.html) in headless Chrome: every figure still and
// turned, the MSAA path (which only runs while the view moves), the tier the frame ran at,
// triangle and particle counts, and any script or WebGL error. Screenshots go to --out.
//
// Usage: node tools/check-3d.mjs [--figure id] [--out dir] [--dark] [--scale 2] [--template file] [--lab file]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openBrowser, sleep } from "../skills/safis/scripts/lib/chrome.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const only = arg("--figure", null);
const out = path.resolve(arg("--out", path.join(os.tmpdir(), "safis-lab")));
const dark = argv.includes("--dark");
// --set key=value,key=value sets the figure's controls before it is shot.
const preset = arg("--set", null) ? Object.fromEntries(arg("--set").split(",").map(kv => { const [k, v] = kv.split("="); return [k, v === "true" ? true : v === "false" ? false : isNaN(+v) ? v : +v]; })) : null;
const templatePath = arg("--template", path.join(root, "skills/safis/assets/template.html"));
await mkdir(out, { recursive: true });

// Build the lab page from the template and the lab article.
const template = await readFile(templatePath, "utf8");
// --lab <file> renders another lab page (tools/lab/bio.html for the anatomy kit).
const article = await readFile(path.resolve(arg("--lab", path.join(root, "tools/lab/article.html"))), "utf8");
const page = template
  .replace(/<!-- explainer:article:start -->[\s\S]*?<!-- explainer:article:end -->/, () => `<!-- explainer:article:start -->\n${article}\n<!-- explainer:article:end -->`)
  .replace("{{TITLE}}", "3D lab").replace("{{CATEGORY}}", "Engineering").replace("{{DEK}}", "Proof figures for the 3D engine.");
const pagePath = path.join(out, "lab.html");
await writeFile(pagePath, page);

const scale = +arg("--scale", 1);
const b = await openBrowser({ viewport: { width: 1100, height: 900, deviceScaleFactor: scale, mobile: false } });
const errors = [];
b.on(m => {
  if (m.method === "Runtime.exceptionThrown") errors.push(`exception: ${m.params.exceptionDetails.exception?.description?.split("\n")[0] ?? m.params.exceptionDetails.text}`);
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) errors.push(`console.${m.params.type}: ${m.params.args.map(a => a.value ?? a.description ?? "").join(" ").split("\n")[0]}`);
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(`log: ${m.params.entry.text.split("\n")[0]}`);
});
// Reduced motion: figures draw stills on demand, so heavy animated 3D can't starve the page load.
await b.setMedia(dark ? "dark" : "light", "reduce");
await b.goto(pathToFileURL(pagePath).href, 180000);
// Screenshots run as the page checker does (the high tier, still frames); the drag and
// MSAA checks below turn that off again so the adaptive path is what's exercised.
await b.evaluate(`document.documentElement.classList.add("safis-checking")`);
await b.settle(400);

const ids = await b.evaluate(`[...document.querySelectorAll("figure.demo")].map(f => f.id)`);
const rows = [];
for (const id of ids) {
  if (only && id !== only) continue;
  const rect = async () => b.evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`);
  await b.evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: "center" })`);
  await b.settle(900);
  // Let any animation run a little, then pause it so the still frame is deterministic.
  await b.evaluate(`(() => { const h = LAB.handles[${JSON.stringify(id)}]; if (h) { h.play(false); ${preset ? `h.setMany(${JSON.stringify(preset)});` : ""} } })()`);
  await b.settle(700);
  const stats = () => b.evaluate(`(LAB.scenes[${JSON.stringify(id)}] || {}).stats || null`);
  const statsStill = await stats();
  const r = await rect();
  await writeFile(path.join(out, `${id}.png`), await b.screenshot(r));
  // Turn the view with a drag across the canvas and shoot again mid-drag (the moving tier).
  await b.evaluate(`document.documentElement.classList.remove("safis-checking")`);
  const cx = r.x + r.width / 2, cy = r.y + r.height * 0.45 - (await b.evaluate("scrollY"));
  await b.drag([cx - 120, cy], [cx + 120, cy + 20], { steps: 10, hold: 160 });
  const statsMoving = await stats();
  await b.settle(500);
  const statsAfter = await stats();
  await writeFile(path.join(out, `${id}-turned.png`), await b.screenshot(await rect()));
  await b.evaluate(`document.documentElement.classList.add("safis-checking")`);
  rows.push({ id, still: statsStill, moving: statsMoving, after: statsAfter });
}

// MSAA probe: two quick frames at ss 1 while "moving" must pick samples > 0 and draw something.
await b.evaluate(`document.documentElement.classList.remove("safis-checking")`);
const probe = await b.evaluate(`(() => {
  const sc = LAB.scenes.prism || Object.values(LAB.scenes)[0];
  E3.quality.force("high");
  E3.render(sc, { still: false, yaw: 0.3, pitch: 0.3 }, 420, 300, 1, 1);
  const first = E3.stats;
  const view = E3.render(sc, { still: false, yaw: 0.35, pitch: 0.3 }, 420, 300, 1, 1);
  const second = E3.stats;
  E3.quality.force(null);
  const gl = E3.canvas.getContext("webgl2");
  const err = gl.getError();
  const src = view.source, img = src.image, w = src.sw, h = src.sh;
  const cv = new OffscreenCanvas(w, h), c2 = cv.getContext("2d");
  c2.drawImage(img, src.sx, src.sy, src.sw, src.sh, 0, 0, w, h);
  const d = c2.getImageData(0, 0, w, h).data;
  let lit = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 10) lit++; sum += d[i] + d[i + 1] + d[i + 2]; }
  return { first, second, err, lit: lit / (w * h), mean: sum / (d.length / 4 * 3) };
})()`).catch(e => ({ error: e.message }));

await b.close();
const fmt = s => (s ? `${s.tier}${s.moving ? "*" : ""} ss${s.ss} msaa${s.samples} ${s.size[0]}x${s.size[1]}` : "-");
console.log(`lab page: ${pagePath}`);
console.log(`screenshots: ${out}`);
console.log("figure      triangles  particles  still                       moving                      after");
for (const r of rows) console.log(`${r.id.padEnd(11)} ${String(r.still?.triangles ?? "-").padStart(9)}  ${String(r.still?.particles ?? "-").padStart(9)}  ${fmt(r.still).padEnd(27)} ${fmt(r.moving).padEnd(27)} ${fmt(r.after)}`);
console.log(`msaa probe: ${probe.error ? probe.error : `samples ${probe.first.samples} then ${probe.second.samples}, gl error ${probe.err}, ${(probe.lit * 100).toFixed(0)}% pixels drawn, mean ${probe.mean.toFixed(0)}`}`);
const bad = [];
for (const r of rows) {
  if (!r.still) bad.push(`${r.id}: no frame rendered`);
  else if (r.still.moving) bad.push(`${r.id}: still frame ran as moving (${r.still.tier})`);
  if (r.after && r.after.moving) bad.push(`${r.id}: frame after the drag stayed at the moving tier`);
}
if (!probe.error && probe.second.samples === 0) bad.push("msaa probe: no samples picked while moving");
if (!probe.error && probe.err !== 0) bad.push(`msaa probe: gl error ${probe.err}`);
if (!probe.error && probe.lit < 0.1) bad.push("msaa probe: frame mostly blank");
if (errors.length) { console.log("\nerrors:"); for (const e of [...new Set(errors)].slice(0, 20)) console.log("  " + e); }
if (bad.length) { console.log("\nproblems:"); for (const e of bad) console.log("  " + e); }
console.log(bad.length || errors.length ? "\nFAIL" : "\nPASS");
process.exit(bad.length || errors.length ? 1 : 0);
