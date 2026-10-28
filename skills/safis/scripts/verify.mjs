#!/usr/bin/env node
// Checks an explainer page in headless Chrome. It runs the page's built-in
// self-check at desktop and phone widths, records console errors and any
// network requests that leave the file, measures words of main text per
// figure, and saves a screenshot of every
// figure (desktop light, desktop dark, phone) for a visual pass.
//
// Usage: node verify.mjs <page.html | http(s)://url> [--out <dir>] [--timeout <seconds, 600>]
// A URL checks a served page (a built site, or the live one); requests to its own origin count
// as part of the page, anything else as external.
// Needs Node 22+ and Chrome, Chromium, or Edge (set CHROME_PATH if it isn't found).
// Exit code: 0 = no errors, 1 = errors found, 2 = couldn't run the check.

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describeException, openBrowser } from "./lib/chrome.mjs";

const DESKTOP = { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

function usage(msg) {
  if (msg) console.error(msg);
  console.error("usage: node verify.mjs <page.html | http(s)://url> [--out <dir>] [--timeout <seconds>]");
  process.exit(2);
}

const argv = process.argv.slice(2);
let pagePath = null;
let outDir = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") outDir = argv[++i];
  else if (argv[i] === "--timeout") i++;
  else if (argv[i].startsWith("-")) usage(`unknown option ${argv[i]}`);
  else pagePath = argv[i];
}
if (!pagePath) usage();
const isUrl = /^https?:\/\//.test(pagePath);
if (!isUrl) {
  pagePath = path.resolve(pagePath);
  if (!existsSync(pagePath)) usage(`no such file: ${pagePath}`);
}
const origin = isUrl ? new URL(pagePath).origin : null;
const slugOf = () => (isUrl ? new URL(pagePath).pathname.split("/").filter(Boolean).pop() || "home" : path.basename(path.dirname(pagePath)));
outDir = path.resolve(outDir ?? path.join(os.tmpdir(), "explainer-check", slugOf()));

async function main() {
  let b;
  try {
    b = await openBrowser({ viewport: DESKTOP });
  } catch (e) {
    console.error(`verify.mjs couldn't start a browser: ${e.message}`);
    return 2;
  }
  try {
    const consoleErrors = [];
    const external = new Set();
    b.on(msg => {
      const p = msg.params;
      if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(describeException(p.exceptionDetails));
      else if (msg.method === "Runtime.consoleAPICalled" && p.type === "error") {
        const text = p.args.map(a => a.value ?? a.description ?? "").join(" ");
        if (!text.startsWith("[demo #")) consoleErrors.push(text); // figure failures are reported per figure
      } else if (msg.method === "Log.entryAdded" && p.entry.level === "error") {
        consoleErrors.push(p.entry.text + (p.entry.url ? ` (${p.entry.url})` : ""));
      } else if (msg.method === "Network.requestWillBeSent") {
        const u = p.request.url;
        if (!/^(file|data|blob|about):/.test(u) && !(origin && u.startsWith(origin + "/"))) external.add(u);
      }
    });

    await b.setMedia("light");
    await b.goto(isUrl ? pagePath : pathToFileURL(pagePath).href);
    // A hosted site may load the runtime as a module after the page itself; give it a moment.
    await b.evaluate(`new Promise(r => { const t0 = performance.now(); (function poll() { if (window.__explainer || performance.now() - t0 > 20000) r(); else setTimeout(poll, 50); })(); })`);
    await b.settle();

    await rm(outDir, { recursive: true, force: true });
    await mkdir(path.join(outDir, "dark"), { recursive: true });
    await mkdir(path.join(outDir, "phone"), { recursive: true });

    async function shoot(file, id) {
      let clip = null;
      if (id) {
        const box = await b.evaluate(`(() => {
          const el = document.getElementById(${JSON.stringify(id)});
          el.scrollIntoView({ block: "center" });
          const r = el.getBoundingClientRect();
          const side = el.querySelector(".side");
          const s = side && getComputedStyle(side).position === "absolute" ? side.getBoundingClientRect() : r;
          const right = Math.max(r.right, s.right);
          return { x: r.left + scrollX, y: r.top + scrollY, width: right - r.left, height: r.height };
        })()`);
        await b.settle(250);
        const pad = 8;
        clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad };
      } else {
        await b.evaluate("scrollTo(0, 0)");
        await b.settle(250);
      }
      await writeFile(path.join(outDir, file), await b.screenshot(clip));
    }

    const hasRuntime = await b.evaluate("typeof window.__explainer === 'object'");
    if (!hasRuntime) {
      await shoot("page-top.png");
      console.log(`\nFAIL: ${pagePath} doesn't include the explainer runtime (window.__explainer is missing).`);
      console.log("Build pages from assets/template.html (or scripts/new-page.mjs) so the figures and this check work.");
      for (const e of consoleErrors) console.log(`  console: ${e}`);
      console.log(`\nScreenshot: ${path.join(outDir, "page-top.png")}`);
      return 1;
    }

    const desktop = await b.evaluate("window.__explainer.check()");
    const ids = desktop.demos.map(d => d.id);

    // Main text against main figures: paragraphs and list items, leaving out
    // captions, sidenotes, the abstract, deep dives, predictions, and references.
    const text = await b.evaluate(`(() => {
      const a = document.querySelector("article");
      if (!a) return { words: 0, figures: 0 };
      const skip = "figure, details, .abstract, .sidenote, .quiz, .references, .refs, table, pre";
      const strip = el => { const c = el.cloneNode(true); c.querySelectorAll(".sidenote").forEach(n => n.remove()); return c.textContent; };
      const words = [...a.querySelectorAll("p, li")]
        .filter(el => !el.closest(skip) && !el.querySelector("p, li"))
        .reduce((n, el) => n + (strip(el).match(/[A-Za-z0-9][\\w'’.-]*/g) || []).length, 0);
      const figures = [...a.querySelectorAll("figure.demo")].filter(f => !f.closest("details")).length;
      return { words, figures };
    })()`);
    text.perFigure = text.figures ? Math.round(text.words / text.figures) : null;
    await shoot("page-top.png");
    for (const id of ids) await shoot(`figure-${id}.png`, id);

    await b.setMedia("dark");
    await b.settle();
    for (const id of ids) await shoot(`dark/figure-${id}.png`, id);
    await b.setMedia("light");

    await b.setViewport(PHONE);
    await b.settle();
    const phone = await b.evaluate("window.__explainer.check()");
    const overflow = await b.evaluate("document.documentElement.scrollWidth - window.innerWidth");
    await shoot("phone/page-top.png");
    for (const id of ids) await shoot(`phone/figure-${id}.png`, id);

    // Report
    const pageErrors = [...new Set(consoleErrors)].map(e => `console: ${e}`);
    if (overflow > 1) pageErrors.push(`at ${PHONE.width}px wide the page scrolls sideways by ${overflow}px (something is wider than the screen)`);
    const pageWarnings = [...external].map(u => `loads ${u} (the page should be self-contained)`);
    if (text.perFigure > 180) pageWarnings.push(`${text.perFigure} words of main text per figure (aim for 130-180): some paragraphs describe what no figure shows; give them a figure or cut them`);
    else if (text.perFigure !== null && text.perFigure < 80) pageWarnings.push(`${text.perFigure} words of main text per figure: too little text to set each figure up and say what it showed`);
    let errorCount = pageErrors.length;

    const print = (label, res) => {
      console.log(`\n${label}`);
      for (const e of res.errors) console.log(`  ERROR ${e}`);
      for (const w of res.warnings) console.log(`  warn  ${w}`);
      errorCount += res.errors.length;
      for (const r of res.demos) {
        const tag = r.errors.length ? "ERROR" : r.warnings.length ? "warn " : "ok   ";
        console.log(`  ${tag} #${r.id}  ${r.summary}`);
        for (const e of r.errors) console.log(`        error: ${e}`);
        for (const w of r.warnings) console.log(`        warn: ${w}`);
        errorCount += r.errors.length;
      }
    };
    console.log(`Checked ${pagePath}`);
    print(`Desktop, ${DESKTOP.width}px`, desktop);
    print(`Phone, ${PHONE.width}px`, phone);
    console.log(`\nText: ${text.words} words of main text, ${text.figures} figures${text.perFigure === null ? "" : `, ${text.perFigure} words per figure`}`);
    if (pageErrors.length || pageWarnings.length) {
      console.log("\nWhole page");
      for (const e of pageErrors) console.log(`  ERROR ${e}`);
      for (const w of pageWarnings) console.log(`  warn  ${w}`);
    }

    await writeFile(path.join(outDir, "report.json"), JSON.stringify({ page: pagePath, desktop, phone, text, overflow, consoleErrors, external: [...external] }, null, 2));
    console.log(`\nScreenshots in ${outDir}`);
    console.log("  page-top.png, figure-<id>.png    desktop, light");
    console.log("  dark/figure-<id>.png             desktop, dark");
    console.log("  phone/page-top.png, phone/figure-<id>.png");
    console.log("For each figure across its range of motion, run explore.mjs.");
    const noFigures = desktop.demos.length ? "" : " (but the page has no figures)";
    console.log(`\n${errorCount ? `FAIL: ${errorCount} error${errorCount === 1 ? "" : "s"}` : "PASS"}${noFigures}`);
    return errorCount ? 1 : 0;
  } finally {
    await b.close();
  }
}

// A watchdog so a hung browser can't stall a pipeline; heavy 3D pages on a busy machine need minutes.
const limit = +(argv.includes("--timeout") ? argv[argv.indexOf("--timeout") + 1] : process.env.SAFIS_VERIFY_TIMEOUT ?? 600);
const watchdog = setTimeout(() => { console.error(`verify.mjs timed out after ${limit}s`); process.exit(2); }, limit * 1000);
watchdog.unref();
main().then(code => process.exit(code), err => { console.error(`verify.mjs couldn't finish: ${err.message}`); process.exit(2); });
