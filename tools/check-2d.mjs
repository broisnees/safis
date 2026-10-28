#!/usr/bin/env node
// Renders the 2D lab (tools/lab2d/article.html) in headless Chrome: every figure still and
// mid-animation, light and dark, with frame times and any script or shader error.
// Screenshots go to --out. --gpu times frames on the machine's GPU (screenshots then come
// from the GPU too); the default software renderer is several times slower than a laptop.
//
// Usage: node tools/check-2d.mjs [--figure id] [--out dir] [--template file] [--gpu] [--frames 40]
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openBrowser } from "../skills/safis/scripts/lib/chrome.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const only = arg("--figure", null);
const out = path.resolve(arg("--out", path.join(os.tmpdir(), "safis-lab2d")));
const gpu = argv.includes("--gpu");
const frames = +arg("--frames", 40);
await mkdir(out, { recursive: true });

// The lab page: the template (built fresh unless one is given) with the lab article.
let templatePath = arg("--template", null);
if (!templatePath) {
  templatePath = path.join(out, "template.html");
  execFileSync(process.execPath, [path.join(root, "tools/build-template.mjs"), "--out", templatePath], { stdio: "ignore" });
}
const template = await readFile(templatePath, "utf8");
const article = await readFile(path.join(root, "tools/lab2d/article.html"), "utf8");
const page = template
  .replace(/<!-- explainer:article:start -->[\s\S]*?<!-- explainer:article:end -->/, () => `<!-- explainer:article:start -->\n${article}\n<!-- explainer:article:end -->`)
  .replaceAll("{{TITLE}}", "2D lab").replaceAll("{{CATEGORY}}", "Physics").replaceAll("{{DEK}}", "Proof figures for the 2D effect kits.");
const pagePath = path.join(out, "lab2d.html");
await writeFile(pagePath, page);

const rows = [], errors = [];
for (const scheme of ["light", "dark"]) {
  const b = await openBrowser({ viewport: { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false }, gpu });
  b.on(m => {
    if (m.method === "Runtime.exceptionThrown") errors.push(`${scheme}: ${m.params.exceptionDetails.exception?.description?.split("\n")[0] ?? m.params.exceptionDetails.text}`);
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) errors.push(`${scheme} console.${m.params.type}: ${m.params.args.map(a => a.value ?? a.description ?? "").join(" ").split("\n")[0]}`);
  });
  await b.setMedia(scheme);
  await b.goto(pathToFileURL(pagePath).href);
  await b.settle(300);
  const ids = await b.evaluate(`[...document.querySelectorAll("figure.demo")].map(f => f.id)`);
  for (const id of ids) {
    if (only && id !== only) continue;
    const rect = () => b.evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`);
    await b.evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: "center" }); LAB.handles[${JSON.stringify(id)}]?.play(false)`);
    await b.settle(300);
    await writeFile(path.join(out, `${id}-${scheme}.png`), await b.screenshot(await rect()));
    // Frame time: one step of 1/60 s and a full redraw, timed in the page.
    const ms = await b.evaluate(`(() => {
      const ts = [];
      // Reading a pixel back makes the browser finish the frame, GPU work included.
      const cv = document.querySelector("#" + ${JSON.stringify(id)} + " canvas"), c2 = cv.getContext("2d");
      for (let i = 0; i < ${frames}; i++) { const t0 = performance.now(); window.__explainer.drive(${JSON.stringify(id)}, { steps: 1 }); c2.getImageData(0, 0, 1, 1); ts.push(performance.now() - t0); }
      ts.sort((a, b) => a - b);
      return { median: ts[ts.length >> 1], p90: ts[Math.floor(ts.length * 0.9)] };
    })()`);
    await b.evaluate(`window.__explainer.drive(${JSON.stringify(id)}, { steps: 50 })`);
    await b.settle(150);
    await writeFile(path.join(out, `${id}-${scheme}-later.png`), await b.screenshot(await rect()));
    const fx = await b.evaluate(`(window.Fx && Fx.errors.slice()) || []`);
    for (const e of fx) errors.push(`${scheme} Fx shader: ${e.split("\n")[0]}`);
    rows.push({ id, scheme, ...ms });
  }
  await b.close();
}

console.log(`lab page: ${pagePath}`);
console.log(`screenshots: ${out}`);
console.log(`frame times (${gpu ? "GPU" : "software WebGL"}; step + redraw)`);
console.log("figure        light median/p90      dark median/p90");
const byId = {};
for (const r of rows) (byId[r.id] ??= {})[r.scheme] = r;
for (const [id, r] of Object.entries(byId)) {
  const f = x => (x ? `${x.median.toFixed(1)} / ${x.p90.toFixed(1)} ms` : "-");
  console.log(`${id.padEnd(13)} ${f(r.light).padEnd(21)} ${f(r.dark)}`);
}
const uniq = [...new Set(errors)];
if (uniq.length) { console.log("\nerrors:"); for (const e of uniq.slice(0, 30)) console.log("  " + e); }
console.log(uniq.length ? "\nFAIL" : "\nPASS");
process.exit(uniq.length ? 1 : 0);
