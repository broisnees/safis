#!/usr/bin/env node
// Research tool: opens a published explainer in headless Chrome, screenshots a
// spread of its figures, drags their sliders and rotates their 3D views, and
// records the text around each figure.
//
// Usage: node tools/peek.mjs <url> --out <dir> [--figures 12] [--interact 5]

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openBrowser, sleep } from "../skills/safis/scripts/lib/chrome.mjs";

const argv = process.argv.slice(2);
const opt = { figures: 12, interact: 5, out: null, url: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") opt.out = argv[++i];
  else if (a === "--figures") opt.figures = +argv[++i];
  else if (a === "--interact") opt.interact = +argv[++i];
  else opt.url = a;
}
if (!opt.url || !opt.out) { console.error("usage: node tools/peek.mjs <url> --out <dir> [--figures N] [--interact K]"); process.exit(2); }

// Runs in the page: find figure blocks in reading order, tag them, return metadata.
const COLLECT = `(() => {
  const article = document.querySelector(".article") || document.body;
  const blocks = [];
  const isFig = el => el.matches(".drawer_container, .split_container, .canvas_container") ||
    (el.querySelector && el.querySelector(":scope > canvas") && el.getBoundingClientRect().width > 200);
  const isSlider = el => /slider|segment|button_container|controls/i.test(el.className || "");
  const textOf = el => (el && el.textContent || "").replace(/\\s+/g, " ").trim();
  const kids = [...article.querySelectorAll("p, h1, h2, h3, .drawer_container, .split_container, .canvas_container, .slider_container, canvas")]
    .filter(el => !(el.matches(".drawer_container, .canvas_container, canvas") && el.parentElement.closest(".split_container, .drawer_container, .canvas_container")))
    .filter(el => !(el.matches(".slider_container") && el.parentElement.closest(".slider_container")));
  let current = null;
  for (const el of kids) {
    if (isFig(el)) {
      current = { els: [el], sliders: [] };
      blocks.push(current);
      let p = el.previousElementSibling;
      while (p && p.tagName !== "P") p = p.previousElementSibling;
      current.leadIn = textOf(p).slice(-500);
    } else if (current && isSlider(el)) {
      current.els.push(el);
      current.sliders.push(el);
    } else if (el.tagName === "P" && current) {
      if (!current.followUp) current.followUp = textOf(el).slice(0, 500);
      current = null;
    } else if (/^H[1-3]$/.test(el.tagName)) {
      current = null;
    }
  }
  return blocks.map((b, i) => {
    b.els.forEach(el => el.dataset.peek = String(i));
    b.sliders.forEach((s, j) => s.dataset.peekSlider = i + "-" + j);
    return {
      index: i,
      classes: b.els[0].className,
      sliders: b.sliders.length,
      canvases: b.els[0].querySelectorAll("canvas").length + (b.els[0].tagName === "CANVAS" ? 1 : 0),
      leadIn: b.leadIn || "",
      followUp: b.followUp || "",
    };
  });
})()`;

const RECT = idx => `(() => {
  const els = [...document.querySelectorAll('[data-peek="${idx}"]')];
  els[0].scrollIntoView({ block: "center" });
  const rs = els.map(e => e.getBoundingClientRect());
  const x0 = Math.min(...rs.map(r => r.left)), y0 = Math.min(...rs.map(r => r.top));
  const x1 = Math.max(...rs.map(r => r.right)), y1 = Math.max(...rs.map(r => r.bottom));
  return { x: x0 + scrollX, y: y0 + scrollY, width: x1 - x0, height: y1 - y0, vx: x0, vy: y0 };
})()`;

const SLIDER = id => `(() => {
  const s = document.querySelector('[data-peek-slider="${id}"]');
  const knob = s && s.querySelector(".slider_knob");
  if (!knob) return null;
  const sr = s.getBoundingClientRect(), kr = knob.getBoundingClientRect();
  return { left: sr.left, width: sr.width, kx: kr.left + kr.width / 2, ky: kr.top + kr.height / 2 };
})()`;

const CANVAS = idx => `(() => {
  const el = document.querySelector('[data-peek="${idx}"]');
  const c = el.tagName === "CANVAS" ? el : el.querySelector("canvas");
  const r = (c || el).getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
})()`;

async function main() {
  await mkdir(opt.out, { recursive: true });
  const b = await openBrowser({ viewport: { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false } });
  try {
    await b.goto(opt.url, 60000);
    await sleep(1500);
    const meta = await b.evaluate(`({
      title: document.title,
      headings: [...document.querySelectorAll(".article h2, .article h1, h2")].map(h => h.textContent.trim()),
      words: (document.querySelector(".article") || document.body).innerText.split(/\\s+/).length,
    })`);
    const figs = await b.evaluate(COLLECT);
    const n = figs.length;
    const pick = n <= opt.figures ? figs.map(f => f.index)
      : [...new Set(Array.from({ length: opt.figures }, (_, i) => Math.round(i * (n - 1) / (opt.figures - 1))))];
    const report = { url: opt.url, ...meta, figureCount: n, figures: [] };
    let interacted = 0;
    for (const idx of pick) {
      const f = figs[idx];
      await b.evaluate(RECT(idx));
      await sleep(900);
      const rect = await b.evaluate(RECT(idx));
      const shots = [];
      const shoot = async tag => {
        const file = `fig${String(idx).padStart(2, "0")}-${tag}.png`;
        await b.settle(150);
        const r = await b.evaluate(RECT(idx));
        await writeFile(path.join(opt.out, file), await b.screenshot({ x: r.x, y: r.y, width: Math.max(1, r.width), height: Math.max(1, r.height) }));
        shots.push(file);
      };
      await shoot("a");
      if (interacted < opt.interact) {
        if (f.sliders > 0) {
          interacted++;
          for (const [tag, t] of [["lo", 0.04], ["mid", 0.5], ["hi", 0.96]]) {
            const s = await b.evaluate(SLIDER(`${idx}-0`));
            if (!s) break;
            await b.drag([s.kx, s.ky], [s.left + s.width * t, s.ky]);
            await sleep(500);
            await shoot(`slider-${tag}`);
          }
        } else if (f.canvases > 0) {
          interacted++;
          const c = await b.evaluate(CANVAS(idx));
          await b.drag([c.cx, c.cy], [c.cx + c.w * 0.25, c.cy + c.h * 0.08]);
          await sleep(700);
          await shoot("dragged");
        }
      }
      report.figures.push({ ...f, rect: { width: Math.round(rect.width), height: Math.round(rect.height) }, shots });
    }
    await writeFile(path.join(opt.out, "report.json"), JSON.stringify(report, null, 2));
    console.log(`${meta.title}: ${n} figures, ${meta.words} words, ${meta.headings.length} headings; captured ${report.figures.length}, interacted ${interacted}`);
  } finally {
    await b.close();
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
