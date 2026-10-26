#!/usr/bin/env node
// Plays with every figure on a page in headless Chrome and saves one contact
// sheet per figure: each slider swept across its range, toggles flipped,
// the 3D view turned, and animations stepped forward in time. Reading these
// sheets shows whether a figure actually teaches what its paragraph promises.
//
// Usage: node explore.mjs <page.html> [--figure <id>] [--out <dir>] [--steps 5] [--width 1280]
// Needs Node 22+ and Chrome, Chromium, or Edge.

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openBrowser } from "./lib/chrome.mjs";

const argv = process.argv.slice(2);
const opt = { page: null, figure: null, out: null, steps: 5, width: 1280 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--figure") opt.figure = argv[++i];
  else if (a === "--out") opt.out = argv[++i];
  else if (a === "--steps") opt.steps = Math.max(2, +argv[++i]);
  else if (a === "--width") opt.width = +argv[++i];
  else if (!a.startsWith("-")) opt.page = a;
  else { console.error(`unknown option ${a}`); process.exit(2); }
}
if (!opt.page) { console.error("usage: node explore.mjs <page.html> [--figure <id>] [--out <dir>] [--steps 5]"); process.exit(2); }
const pagePath = path.resolve(opt.page);
if (!existsSync(pagePath)) { console.error(`no such file: ${pagePath}`); process.exit(2); }
const outDir = path.resolve(opt.out ?? path.join(os.tmpdir(), "explainer-explore", path.basename(path.dirname(pagePath))));

const fmt = x => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function main() {
  const b = await openBrowser({ viewport: { width: opt.width, height: 1000, deviceScaleFactor: 1, mobile: false } });
  try {
    await b.setMedia("light");
    await b.goto(pathToFileURL(pagePath).href);
    if (!(await b.evaluate("typeof window.__explainer === 'object'"))) throw new Error("the page has no explainer runtime");
    const ids = opt.figure ? [opt.figure] : await b.evaluate("window.__explainer.ids()");
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    const sheets = [];
    for (const id of ids) {
      const info = await b.evaluate(`window.__explainer.describe(${JSON.stringify(id)})`);
      if (!info) { console.log(`#${id}: no such figure`); continue; }
      const dir = path.join(outDir, id);
      await mkdir(dir, { recursive: true });
      const frames = [];
      const drive = action => b.evaluate(`window.__explainer.drive(${JSON.stringify(id)}, ${JSON.stringify(action)})`);
      const canvasBox = () => b.evaluate(`(() => {
        const el = document.getElementById(${JSON.stringify(id)});
        el.scrollIntoView({ block: "center" });
        const r = el.querySelector(".stage").getBoundingClientRect();
        return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
      })()`);
      await canvasBox();
      await b.settle(200);
      await drive({ play: false });
      const defaults = Object.fromEntries(info.controls.filter(c => c.type !== "button").map(c => [c.key, c.value]));
      const shoot = async (row, caption, action) => {
        await drive({ reset: true, ...action, set: { ...defaults, ...(action.set || {}) }, play: false });
        const box = await canvasBox();
        const file = `${String(frames.length).padStart(2, "0")}.png`;
        await writeFile(path.join(dir, file), await b.screenshot(box));
        frames.push({ row, caption, file: `${id}/${file}` });
      };

      await shoot("start", "as the page loads", {});
      for (const c of info.controls) {
        if (c.type === "button") continue;
        if (c.type === "toggle") {
          for (const val of [false, true]) await shoot(c.label, `${c.label}: ${val ? "on" : "off"}`, { set: { [c.key]: val } });
          continue;
        }
        for (let i = 0; i < opt.steps; i++) {
          const val = c.min + ((c.max - c.min) * i) / (opt.steps - 1);
          await shoot(c.label, `${c.label} = ${fmt(val)}`, { set: { [c.key]: val } });
        }
      }
      // Buttons: press each one from the start and with the first slider at its far end,
      // then let time run, since buttons often start a motion.
      const first = info.controls.find(c => c.type === "slider");
      for (const c of info.controls.filter(c => c.type === "button")) {
        for (const [where, set] of [["at start", {}], ...(first ? [[`${first.label} at max`, { [first.key]: first.max }]] : [])]) {
          for (const [cap, n] of info.stepped ? [["just pressed", 0], ["0.5 s later", 30], ["1 s later", 60], ["3 s later", 180]] : [["pressed", 0]]) {
            await shoot(`${c.label}`, `${where}, ${cap}`, { set, press: c.label, steps: n });
          }
        }
      }
      if (info.orbit) {
        for (const [cap, dyaw, dpitch] of [["turned 90° left", -Math.PI / 2, 0], ["turned 90° right", Math.PI / 2, 0], ["from behind", Math.PI, 0], ["from above", 0, 0.9]]) {
          await shoot("view", cap, { viewDelta: [dyaw, dpitch] });
        }
      }
      if (info.animated) {
        for (const [cap, n] of [["0 s", 0], ["0.5 s", 30], ["1 s", 60], ["2 s", 120], ["4 s", 240]]) await shoot("time", `after ${cap}`, { steps: n });
      }
      await drive({ reset: true, set: defaults, play: true });

      // Contact sheet: lay the frames out in rows by what changed.
      const rows = [];
      for (const f of frames) { let r = rows.find(x => x.name === f.row); if (!r) rows.push((r = { name: f.row, frames: [] })); r.frames.push(f); }
      const html = `<!doctype html><meta charset="utf-8"><style>
        body { margin: 0; padding: 16px; background: #fff; font: 13px/1.4 system-ui, sans-serif; color: #222; width: max-content; }
        h1 { font-size: 15px; margin: 0 0 12px; } .row { display: flex; gap: 10px; margin-bottom: 14px; align-items: flex-start; }
        .name { width: 90px; flex: none; font-weight: 600; color: #666; padding-top: 4px; }
        figure { margin: 0; width: 260px; } img { width: 260px; display: block; border: 1px solid #ddd; border-radius: 4px; }
        figcaption { color: #444; margin-top: 3px; font-variant-numeric: tabular-nums; }
      </style><h1>#${esc(id)}</h1>${rows.map(r => `<div class="row"><div class="name">${esc(r.name)}</div>${r.frames.map(f => `<figure><img src="${esc(f.file)}"><figcaption>${esc(f.caption)}</figcaption></figure>`).join("")}</div>`).join("")}`;
      const sheetHtml = path.join(outDir, `${id}.html`);
      await writeFile(sheetHtml, html);
      sheets.push({ id, html: sheetHtml, frames: frames.length });
      console.log(`#${id}: ${frames.length} frames`);
    }
    // Render each sheet to a PNG with the same browser.
    for (const s of sheets) {
      await b.setViewport({ width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
      await b.goto(pathToFileURL(s.html).href);
      const size = await b.evaluate("({ width: document.body.scrollWidth, height: document.body.scrollHeight })");
      const png = path.join(outDir, `${s.id}.png`);
      await writeFile(png, await b.screenshot({ x: 0, y: 0, width: size.width, height: size.height }));
      console.log(`  sheet: ${png}`);
    }
  } finally {
    await b.close();
  }
}
main().catch(e => { console.error(`explore.mjs couldn't finish: ${e.message}`); process.exit(2); });
