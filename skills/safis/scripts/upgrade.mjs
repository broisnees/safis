#!/usr/bin/env node
// Brings existing explainer pages up to the current runtime and theme from
// assets/template.html. Pages built from the first template (no runtime
// markers) also get the current page structure. A page linked to a site's
// shared runtime gets its own copy back; site.mjs links it again.
//
// Usage: node upgrade.mjs <page.html>... [--category <name>]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
let category = null;
const pages = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--category") category = argv[++i];
  else pages.push(argv[i]);
}
if (!pages.length) { console.error("usage: node upgrade.mjs <page.html>... [--category <name>]"); process.exit(2); }

const template = await readFile(path.join(here, "../assets/template.html"), "utf8");
const RUNTIME = /<!-- explainer:runtime:start[^>]*-->[\s\S]*?<!-- explainer:runtime:end -->/;
const block = template.match(RUNTIME)[0];
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

for (const file of pages) {
  let html = await readFile(file, "utf8");
  if (RUNTIME.test(html)) {
    html = html.replace(RUNTIME, () => block);
  } else {
    // First-generation page: one <style> and runtime <script> in <head>, a bare <main>.
    const headEnd = html.indexOf("</head>"), styleStart = html.indexOf("<style>");
    if (headEnd < 0 || styleStart < 0 || styleStart > headEnd) { console.error(`${file}: unrecognized page structure, skipped`); continue; }
    const cat = category ?? "Explainer";
    html = html.slice(0, styleStart) + `<meta name="explainer:category" content="${esc(cat)}">\n` + block + "\n" + html.slice(headEnd);
    html = html.replace(/<main>\s*<header>/, `<div class="page">\n<nav class="toc" aria-label="All explainers"><!-- explainer:nav:start --><!-- explainer:nav:end --></nav>\n<main>\n<!-- explainer:back:start --><!-- explainer:back:end -->\n<header>\n  <p class="kicker">${esc(cat)}</p>`);
    html = html.replace(/<\/header>/, "</header>\n<article>\n<!-- explainer:article:start -->");
    html = html.replace(/<\/main>/, "<!-- explainer:article:end -->\n</article>\n</main>\n</div>");
    html = html.replace(/<h2>Further reading<\/h2>/i, '<h2 class="plain">Further reading</h2>');
  }
  await writeFile(file, html);
  console.log(`upgraded ${file}`);
}
