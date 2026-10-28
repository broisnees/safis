#!/usr/bin/env node
// Captures the figures the site's "What it makes" page shows, from the standalone pages in
// site/, at 2x in light and dark: website/public/media/<name>.webp and <name>-dark.webp.
// The images are kept in the repo; rerun this when one of those figures changes.
// Usage: node website/scripts/media.mjs [name...]
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openBrowser } from "../../skills/safis/scripts/lib/chrome.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.join(here, "../public/media");
// name, page, and what to capture: a figure id (its stage), a CSS selector, or "top" (the page's opening).
export const SHOTS = [
  ["plume", "rocket-engine", "#plume"],
  ["engine-apart", "rocket-engine", "#apart"],
  ["gas", "rocket-engine", "#gas"],
  ["turbofan-cutaway", "turbofan", "#cutaway"],
  ["wing", "turbofan", "#wing"],
  ["jaw", "jaw-joint", "#jaw"],
  ["pendulum", "pendulum", "#beat"],
  ["derivative", "derivative", "#slopefn"],
  ["neuron", "neuron", "#spike"],
  ["learning", "learning", "#surface"],
  ["molecule", "ice", "#molecule"],
  ["globe", "cdn", "#hero"],
  ["spectrum", "fourier", "#spectrum"],
  ["attention", "attention", "#matrix"],
  ["diagram", "dns", "figure.diagram"],
  ["code", "hash-table", ".code-block"],
  ["paper", "lock", "top"],
];
const only = process.argv.slice(2);
await mkdir(out, { recursive: true });
const b = await openBrowser({ viewport: { width: 1280, height: 1000, deviceScaleFactor: 2, mobile: false } });
try {
  for (const [name, slug, what] of SHOTS) {
    if (only.length && !only.includes(name)) continue;
    for (const scheme of ["light", "dark"]) {
      await b.setMedia(scheme, "reduce");
      await b.goto(pathToFileURL(path.join(root, "site", slug, "index.html")).href, 180000);
      const box = await b.evaluate(`(() => {
        document.documentElement.classList.add("safis-checking");
        const what = ${JSON.stringify(what)};
        let el;
        if (what === "top") {
          const h = document.querySelector("main header"), a = document.querySelector("article");
          h.scrollIntoView({ block: "start" });
          const r = h.getBoundingClientRect(), x = r.left - 24, w = Math.min(a.getBoundingClientRect().width + 340, innerWidth - x - 8);
          return { x: x + scrollX, y: r.top + scrollY - 16, width: w, height: 900 };
        }
        el = what.startsWith("#") ? document.querySelector(what + " .stage") : document.querySelector(what);
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
      })()`);
      if (!box) { console.log(`missing: ${name} (${slug} ${what})`); continue; }
      await b.settle(700);
      const file = path.join(out, `${name}${scheme === "dark" ? "-dark" : ""}.webp`);
      await writeFile(file, await b.screenshot(box, { format: "webp", quality: 82 }));
      console.log(`media: ${path.relative(root, file)} ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
  }
} finally {
  await b.close();
}
