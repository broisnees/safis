#!/usr/bin/env node
// Shrinks an image and prints it as a data URL to paste into a page, so a figure can use a real
// photo (a texture on a 3D model, a picture to filter) while the page stays one self-contained file.
// Equirectangular maps (the Moon, the Earth, Mars) should be 2:1; 1024 x 512 is plenty for a figure.
//
// Usage: node embed-image.mjs <image> [--max 1024] [--quality 0.82] [--png] [--out file.txt]
// Needs Node 22+ and Chrome, Chromium, or Edge (used to decode and resize).
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openBrowser } from "./lib/chrome.mjs";

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const file = argv.find((a, i) => !a.startsWith("--") && !["--max", "--quality", "--out"].includes(argv[i - 1]));
if (!file) { console.error("usage: node embed-image.mjs <image> [--max 1024] [--quality 0.82] [--png] [--out file.txt]"); process.exit(2); }
const max = +arg("--max", 1024), quality = +arg("--quality", 0.82), png = argv.includes("--png");
const ext = path.extname(file).slice(1).toLowerCase().replace("jpg", "jpeg");
const src = `data:image/${ext || "png"};base64,${(await readFile(file)).toString("base64")}`;
const b = await openBrowser({ viewport: { width: 800, height: 600, deviceScaleFactor: 1, mobile: false } });
try {
  await b.goto("about:blank");
  const url = await b.evaluate(`new Promise((ok, bad) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, ${max} / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, 0, 0, c.width, c.height);
      ok(c.toDataURL(${png ? '"image/png"' : '"image/jpeg"'}, ${quality}));
    };
    img.onerror = () => bad(new Error("couldn't decode the image"));
    img.src = ${JSON.stringify(src)};
  })`);
  const kb = Math.round(url.length / 1024);
  if (arg("--out", null)) { await writeFile(arg("--out"), url); console.error(`wrote ${arg("--out")} (${kb} KB of base64)`); }
  else { process.stdout.write(url + "\n"); console.error(`${kb} KB of base64`); }
  if (kb > 400) console.error("that's large for one page; try --max 768 or --quality 0.7");
} finally { await b.close(); }
