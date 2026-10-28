#!/usr/bin/env node
// Builds the safis package and every example app, serves each build, and checks it
// in headless Chrome: no console errors, every figure mounted and drawn, controls
// change their figures, prose links work, theme CSS and fonts load, and unmounting
// or navigating leaves no stale figures behind. Saves one screenshot per example.
//
// Usage: node tools/test-packages.mjs [--skip-build] [--apps <dir>] [example...]
// --apps checks already-built copies of the examples in <dir> (for instance apps that installed
// the packed tarballs, the way a user installs from npm) instead of the ones in examples/.

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeException, openBrowser, sleep } from "../skills/safis/scripts/lib/chrome.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const appsDir = argv.includes("--apps") ? path.resolve(argv[argv.indexOf("--apps") + 1]) : null;
const skipBuild = argv.includes("--skip-build") || !!appsDir;
const EXAMPLES = {
  "react-vite": { kind: "toggle" },
  "vue-vite": { kind: "toggle" },
  "svelte-vite": { kind: "toggle" },
  "astro-blog": { kind: "navigate", start: "/posts/springs-and-gears/" },
};
const only = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--apps");
const names = only.length ? only : Object.keys(EXAMPLES);
const shots = path.join(os.tmpdir(), "safis-packages-test");
await mkdir(shots, { recursive: true });

if (!skipBuild) {
  const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  console.log("building packages/safis");
  run("node", ["tools/build-packages.mjs"]);
  for (const name of names) {
    console.log(`building examples/${name}`);
    try { run("npm", ["run", "build", "-w", `examples/${name}`]); } catch (e) {
      console.log(String(e.stdout) + String(e.stderr));
      process.exit(1);
    }
  }
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon" };
function serve(dir) {
  const server = http.createServer(async (req, res) => {
    let p = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (existsSync(p) && statSync(p).isDirectory()) p = path.join(p, "index.html");
    if (!existsSync(p) && !path.extname(p)) p = existsSync(`${p}/index.html`) ? `${p}/index.html` : path.join(dir, "index.html");
    if (!existsSync(p)) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] ?? "application/octet-stream" });
    res.end(await readFile(p));
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Runs in the page: the state of every figure and the checks that need the DOM.
const INSPECT = `(async () => {
  await document.fonts.ready;
  const figs = [...document.querySelectorAll("figure.demo")];
  const ids = window.__explainer ? window.__explainer.ids() : [];
  const report = window.__explainer ? window.__explainer.check() : { ok: false, errors: ["no runtime"], demos: [], warnings: [] };
  const fig = figs[0];
  const ink = fig ? getComputedStyle(fig).getPropertyValue("--ink").trim() : "";
  const fonts = [...document.fonts].filter(f => f.status === "loaded").map(f => f.family.replace(/"/g, ""));
  return {
    figures: figs.length, ids, live: figs.filter(f => f.querySelector(".plate canvas")).length,
    ok: report.ok, errors: report.errors, warnings: report.warnings,
    demos: report.demos.map(d => ({ id: d.id, errors: d.errors, warnings: d.warnings, summary: d.summary })),
    ink, fonts: [...new Set(fonts)], palette: { ...(window.palette ?? {}) },
    scrubs: [...document.querySelectorAll(".scrub")].map(s => s.textContent),
    math: document.querySelectorAll(".tex math").length,
    captions: document.querySelectorAll("figure.demo figcaption").length,
  };
})()`;

const values = id => `JSON.stringify(Object.fromEntries(window.__explainer.describe(${JSON.stringify(id)}).controls.filter(c => c.key).map(c => [c.key, c.value])))`;

let failures = 0;
const b = await openBrowser({ viewport: { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false } });
const errors = [];
b.on(msg => {
  const p = msg.params;
  if (msg.method === "Runtime.exceptionThrown") errors.push(describeException(p.exceptionDetails));
  else if (msg.method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "assert")) errors.push(p.args.map(a => a.value ?? a.description ?? "").join(" "));
  else if (msg.method === "Log.entryAdded" && p.entry.level === "error") errors.push(p.entry.text + (p.entry.url ? ` (${p.entry.url})` : ""));
});
await b.setMedia("light");

try {
  for (const name of names) {
    const ex = EXAMPLES[name];
    const dist = path.join(appsDir ?? path.join(root, "examples"), name, "dist");
    const server = await serve(dist);
    const base = `http://127.0.0.1:${server.address().port}`;
    const fails = [];
    const expect = (cond, what) => { if (!cond) fails.push(what); };
    const step = what => { if (process.env.DEBUG) console.log(`  ${name}: ${what}`); };
    errors.length = 0;
    try {
      await b.goto(base + (ex.start ?? "/"));
      await b.settle(600);
      step("inspect");
      const a = await b.evaluate(INSPECT);
      expect(a.figures > 0, "no figures on the page");
      expect(a.live === a.figures, `${a.figures - a.live} figure(s) never mounted`);
      expect(a.ids.length === a.figures, `runtime tracks ${a.ids.length} figures, page has ${a.figures}`);
      expect(a.ok, `self-check failed: ${JSON.stringify(a.errors.concat(a.demos.flatMap(d => d.errors)))}`);
      for (const d of a.demos) for (const w of d.warnings) expect(false, `#${d.id}: ${w}`);
      for (const w of a.warnings) expect(false, w);
      expect(a.ink, "theme CSS didn't load (--ink is empty on the figure)");
      for (const n of ["panel", "ink", "blue"]) expect(/^(#[0-9a-f]{3}|#[0-9a-f]{6})$/i.test(a.palette[n] ?? ""), `figure colors not read from the theme (palette.${n} = "${a.palette[n]}")`);
      for (const f of ["Safis Serif", "Safis Sans"]) expect(a.fonts.includes(f), `font "${f}" didn't load (loaded: ${a.fonts.join(", ") || "none"})`);
      expect(a.scrubs.length && a.scrubs.every(t => t.trim()), `scrubs not bound: ${JSON.stringify(a.scrubs)}`);
      expect(a.math > 0, "no typeset math");
      expect(a.captions === a.figures, `${a.figures - a.captions} figure(s) without a caption`);

      // A "try this" link moves its figure.
      const link = await b.evaluate(`(() => { const e = document.querySelector(".set"); if (!e) return null; e.scrollIntoView({ block: "center" }); return { figure: e.dataset.figure, set: e.dataset.set }; })()`);
      expect(link, "no .set link");
      if (link) {
        await b.evaluate(`document.querySelector(".set").click()`);
        await sleep(800);
        const now = JSON.parse(await b.evaluate(values(link.figure)));
        for (const pair of link.set.split(" ")) {
          const [k, v] = pair.split("=");
          expect(Math.abs(now[k] - Number(v)) < 1e-6, `set link ${link.set}: ${k} is ${now[k]}`);
        }
      }

      // Screenshot the first figure.
      const box = await b.evaluate(`(() => { const f = document.querySelector("figure.demo"); f.scrollIntoView({ block: "center" }); const r = f.getBoundingClientRect(); return { x: r.left + scrollX - 8, y: r.top + scrollY - 8, width: r.width + 16, height: r.height + 16 }; })()`);
      await b.settle(300);
      const shot = path.join(shots, `${name}.png`);
      await writeFile(shot, await b.screenshot(box));

      step("dark mode");
      // Forcing dark mode recolors the figures (the runtime rereads the theme).
      const lum = hex => { const n = parseInt(String(hex).slice(1), 16); return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255); };
      const toDark = ex.kind === "navigate"
        ? `(() => { const t = document.querySelector("[data-safis-theme-toggle]"); t.click(); t.click(); })()`
        : `window.Safis.setTheme("dark")`;
      await b.evaluate(toDark);
      await b.settle(200);
      const dark = await b.evaluate(`({ theme: document.documentElement.dataset.theme, panel: window.palette.panel })`);
      expect(dark.theme === "dark" && lum(dark.panel) < lum(a.palette.panel) / 2, `dark mode didn't recolor figures: ${JSON.stringify(dark)}`);

      step("remount or navigate");
      // Unmount and mount again, or navigate away and back.
      if (ex.kind === "toggle") {
        expect(!(await b.evaluate(`!!document.querySelector(".theme-toggle, .skip")`)), "the runtime injected page chrome (theme switch or skip link) into the app");
        const before = a.ids.length;
        await b.evaluate(`document.querySelector("[data-test=toggle]").click()`);
        await b.settle(300);
        const off = await b.evaluate(`({ figures: document.querySelectorAll("figure.demo").length, ids: window.__explainer.ids().length })`);
        expect(off.ids === before - 1 && off.figures === before - 1, `after unmount: ${off.ids} tracked, ${off.figures} on page (expected ${before - 1})`);
        await b.evaluate(`document.querySelector("[data-test=toggle]").click()`);
        await b.settle(500);
        const on = await b.evaluate(INSPECT);
        expect(on.ids.length === before && on.figures === before, `after remount: ${on.ids.length} tracked, ${on.figures} on page (expected ${before})`);
        expect(new Set(on.ids).size === on.ids.length, `duplicate figures tracked: ${on.ids}`);
        expect(on.ok && on.demos.every(d => !d.errors.length), "self-check failed after remount");
      } else {
        await b.evaluate(`(() => { const l = [...document.querySelectorAll("article a")].find(x => x.textContent.includes("pendulum")); l.click(); })()`);
        await b.evaluate(`new Promise(r => document.addEventListener("astro:page-load", r, { once: true }))`);
        await b.settle(800);
        const next = await b.evaluate(INSPECT);
        expect(next.ids.length === next.figures && next.figures > 0, `after navigating: ${next.ids.length} tracked, ${next.figures} on page`);
        expect(next.ids.join() === "pendulum,coil", `after navigating, tracked ${next.ids.join()}`);
        expect(next.ok && next.demos.every(d => !d.errors.length && !d.warnings.length), `self-check after navigating: ${JSON.stringify(next.demos)}`);
        expect(next.math > 0 && next.scrubs.every(t => t.trim()), "math or scrubs missing after navigating");
        await b.evaluate(`(() => { const l = [...document.querySelectorAll("article a")].find(x => x.textContent.includes("springs")); l.click(); })()`);
        await b.evaluate(`new Promise(r => document.addEventListener("astro:page-load", r, { once: true }))`);
        await b.settle(800);
        const back = await b.evaluate(INSPECT);
        expect(back.ids.join() === "spring,gears", `after navigating back, tracked ${back.ids.join()}`);
        expect(back.ok, "self-check failed after navigating back");
        const kept = await b.evaluate(`({ theme: document.documentElement.dataset.theme, panel: window.palette.panel, icon: !!document.querySelector("[data-safis-theme-toggle] svg") })`);
        expect(kept.theme === "dark" && lum(kept.panel) < lum(a.palette.panel) / 2 && kept.icon, `dark choice lost across navigation: ${JSON.stringify(kept)}`);
      }
      await b.evaluate(`window.Safis.setTheme("auto")`);
      for (const e of errors) expect(false, `console: ${e}`);
      console.log(`${fails.length ? "FAIL" : "ok  "}  ${name}: ${a.figures} figures, ${a.math} equations, fonts ${a.fonts.filter(f => f.startsWith("Safis")).join(", ")}; screenshot ${shot}`);
      for (const f of fails) console.log(`        ${f}`);
      failures += fails.length ? 1 : 0;
    } finally {
      server.close();
    }
  }
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} example(s) failed` : "\nall examples pass");
process.exit(failures ? 1 : 0);
