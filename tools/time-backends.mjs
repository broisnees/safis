#!/usr/bin/env node
// Times every figure in the lab pages on each simulation backend: the page loads with
// ?backend=webgl2 or ?backend=webgpu (E3 particles, Fx.fluid, Fx.waves, Fx.particles follow it),
// and each figure runs frames of one 1/60 s step and a full redraw. A frame's time is measured
// to the end of all its GPU work (a pixel read back for WebGL2, the queue drained for WebGPU),
// so a backend that defers work doesn't look faster than it is.
//
// Usage: node tools/time-backends.mjs [--gpu] [--frames 40] [--figure id] [--lab file,file]
//          [--backends webgl2,webgpu,cpu] [--template file] [--before file]
// --gpu times on this machine's GPU (WebGPU needs it; headless SwiftShader has no WebGPU unless
// --webgpu exposes its software adapter, which the pages then skip unless the backend is forced).
// --before <template> adds a column for another build of the template (the code before a change).
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openBrowser } from "../skills/safis/scripts/lib/chrome.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const gpu = argv.includes("--gpu"), webgpu = argv.includes("--webgpu") || gpu;
const frames = +arg("--frames", 40), only = arg("--figure", null);
const labs = arg("--lab", "tools/lab/article.html,tools/lab2d/article.html,tools/lab/light.html").split(",");
const backends = arg("--backends", "webgl2,webgpu").split(",");
const out = path.join(os.tmpdir(), "safis-backends");
await mkdir(out, { recursive: true });

let templatePath = arg("--template", null);
if (!templatePath) {
  templatePath = path.join(out, "template.html");
  execFileSync(process.execPath, [path.join(root, "tools/build-template.mjs"), "--out", templatePath], { stdio: "ignore" });
}
const before = arg("--before", null);
const runs = [...(before ? [{ name: "before", template: before, backend: null }] : []), ...backends.map(b => ({ name: b, template: templatePath, backend: b }))];

async function pageFor(templateFile, lab) {
  const template = await readFile(path.resolve(templateFile), "utf8");
  const article = await readFile(path.resolve(root, lab), "utf8");
  const page = template
    .replace(/<!-- explainer:article:start -->[\s\S]*?<!-- explainer:article:end -->/, () => `<!-- explainer:article:start -->\n${article}\n<!-- explainer:article:end -->`)
    .replaceAll("{{TITLE}}", "Lab").replaceAll("{{CATEGORY}}", "Engineering").replaceAll("{{DEK}}", "Lab figures.");
  const file = path.join(out, `${path.basename(path.dirname(lab))}-${path.basename(lab, ".html")}-${path.basename(templateFile, ".html")}.html`);
  await writeFile(file, page);
  return file;
}

// In the page: warm a figure up, then time frames to the end of their GPU work.
const timeFigure = (id, n) => `(async () => {
  const id = ${JSON.stringify(id)}, drive = a => window.__explainer.drive(id, a);
  const tick = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  const cv = document.querySelector("#" + id + " canvas"), c2 = cv && cv.getContext("2d");
  const D = window.__safisGPU && window.__safisGPU.device;
  const drain = async () => { if (D) await D.queue.onSubmittedWorkDone(); };
  const frame = () => { drive({ steps: 1 }); if (c2) c2.getImageData(0, 0, 1, 1); };
  drive({ play: false });
  for (let i = 0; i < 8; i++) { frame(); await tick(); }
  await drain();
  const ts = [], t0 = performance.now();
  for (let i = 0; i < ${n}; i++) { const a = performance.now(); frame(); ts.push(performance.now() - a); await tick(); }
  await drain();
  const per = (performance.now() - t0) / ${n};
  ts.sort((a, b) => a - b);
  return { per, median: ts[ts.length >> 1], p90: ts[Math.floor(ts.length * 0.9)], e3: window.E3 && window.E3.backend, fx: window.Fx && window.Fx.backend };
})()`;

const results = {}, errors = [], gpus = {};
let device = "";
for (const lab of labs) {
  for (const run of runs) {
    const file = await pageFor(run.template, lab);
    const b = await openBrowser({ viewport: { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false }, gpu, webgpu });
    b.on(m => {
      if (m.method === "Runtime.exceptionThrown") errors.push(`${run.name} ${path.basename(lab)}: ${m.params.exceptionDetails.exception?.description?.split("\n")[0] ?? m.params.exceptionDetails.text}`);
    });
    try {
      await b.setMedia("light");
      await b.goto(pathToFileURL(file).href + (run.backend ? `?backend=${run.backend}` : ""), 180000);
      await b.evaluate(`(async () => { if (window.__safisGPU) await window.__safisGPU.ready; if (window.E3 && E3.quality) E3.quality.force("high"); })()`);
      await b.settle(300);
      device ||= await b.evaluate(`(() => { const g = document.createElement("canvas").getContext("webgl2"), e = g && g.getExtension("WEBGL_debug_renderer_info"); return g ? g.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : g.RENDERER) : "no WebGL2"; })()`);
      const ids = await b.evaluate(`[...document.querySelectorAll("figure.demo")].map(f => f.id)`);
      // Every figure paused, so only the one being timed draws.
      await b.evaluate(`window.__explainer.ids().forEach(id => window.__explainer.drive(id, { play: false }))`);
      gpus[run.name] = await b.evaluate(`window.__safisGPU ? window.__safisGPU.state + " " + (window.__safisGPU.name || "") : "none"`);
      for (const id of ids) {
        if (only && id !== only) continue;
        await b.evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: "center" })`);
        await b.settle(200);
        try { (results[`${path.basename(path.dirname(lab))}/${path.basename(lab, ".html")}#${id}`] ??= {})[run.name] = await b.evaluate(timeFigure(id, frames)); }
        catch (e) { errors.push(`${run.name} ${id}: ${e.message.split("\n")[0]}`); }
      }
    } finally { await b.close(); }
  }
}

console.log(`device: ${device}; WebGPU: ${Object.entries(gpus).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`ms per frame (one 1/60 s step and a redraw, to the end of its GPU work; ${frames} frames)\n`);
const cols = runs.map(r => r.name), base = cols.includes("before") ? "before" : cols[0];
console.log("figure".padEnd(34) + cols.map(c => c.padStart(10)).join("") + cols.filter(c => c !== base).map(c => `  ${base}/${c}`.padStart(16)).join(""));
for (const [fig, r] of Object.entries(results)) {
  const cell = c => (r[c] ? r[c].per.toFixed(2) : "-").padStart(10);
  const ratio = c => (r[c] && r[base] ? `${(r[base].per / r[c].per).toFixed(2)}x` : "-").padStart(16);
  console.log(fig.padEnd(34) + cols.map(cell).join("") + cols.filter(c => c !== base).map(ratio).join(""));
}
const used = Object.values(results).flatMap(r => Object.entries(r).map(([k, v]) => `${k}: E3 ${v.e3 ?? "-"}, Fx ${v.fx ?? "-"}`));
console.log(`\nbackends in use: ${[...new Set(used)].join("; ")}`);
const uniq = [...new Set(errors)];
if (uniq.length) { console.log("\nerrors:"); for (const e of uniq.slice(0, 30)) console.log("  " + e); }
process.exit(uniq.length ? 1 : 0);
