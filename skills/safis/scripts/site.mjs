#!/usr/bin/env node
// Turns a folder of explainer pages into a small site: writes <root>/index.html
// (every page, grouped by category) and puts the same index in each page's
// sidebar. Pages live at <root>/<slug>/index.html. Links point at index.html
// files so the site also works straight from disk.
//
// Usage: node site.mjs <root> [--title "Explainers"] [--intro "..."] [--thumbs]
// --thumbs screenshots each page's first figure (needs Chrome, like verify.mjs).

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ORDER = ["Body", "Biology", "Chemistry", "Physics", "Machines", "Earth & Space", "Computing", "Math"];

const argv = process.argv.slice(2);
const opt = { root: null, title: null, intro: null, thumbs: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--title") opt.title = argv[++i];
  else if (a === "--intro") opt.intro = argv[++i];
  else if (a === "--thumbs") opt.thumbs = true;
  else opt.root = a;
}
if (!opt.root) { console.error('usage: node site.mjs <root> [--title "..."] [--intro "..."] [--thumbs]'); process.exit(2); }
const root = path.resolve(opt.root);

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const meta = (html, name) => unesc((html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) || [])[1] ?? "");

// Keep the title and intro from an existing home page unless new ones are given.
const homeFile = path.join(root, "index.html");
const oldHome = existsSync(homeFile) ? await readFile(homeFile, "utf8") : "";
const siteTitle = opt.title ?? (unesc((oldHome.match(/<h1>([^<]*)<\/h1>/) || [])[1] ?? "") || "Explainers");
const intro = opt.intro ?? (unesc((oldHome.match(/<p class="dek">([^<]*)<\/p>/) || [])[1] ?? "") || "Interactive explanations of how things work, built around figures you can turn, drag, and take apart.");

const pages = [];
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = path.join(root, entry.name, "index.html");
  if (!existsSync(file)) continue;
  const html = await readFile(file, "utf8");
  if (!html.includes("explainer:runtime:start")) { console.log(`skipped ${entry.name}: not built from the explainer template (run upgrade.mjs)`); continue; }
  const title = unesc((html.match(/<title>([^<]*)<\/title>/) || [])[1] ?? entry.name);
  pages.push({
    slug: entry.name, file, html, title,
    dek: meta(html, "description"),
    category: meta(html, "explainer:category") || "Other",
    figures: ((html.match(/<!-- explainer:article:start -->([\s\S]*?)<!-- explainer:article:end -->/) || [])[1] ?? "").split('<figure class="demo').length - 1,
  });
}
const cats = [...new Set(pages.map(p => p.category))].sort((a, b) => {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
});
const byCat = c => pages.filter(p => p.category === c).sort((a, b) => a.title.localeCompare(b.title));

if (opt.thumbs && pages.length) {
  const { openBrowser } = await import("./lib/chrome.mjs");
  const b = await openBrowser({ viewport: { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false } });
  try {
    await b.setMedia("light");
    for (const p of pages) {
      await b.goto(pathToFileURL(p.file).href);
      const box = await b.evaluate(`(() => {
        const s = document.querySelector("figure.demo .stage");
        if (!s) return null;
        s.scrollIntoView({ block: "center" });
        const r = s.getBoundingClientRect();
        return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
      })()`);
      if (!box) continue;
      await b.settle(400);
      await writeFile(path.join(root, p.slug, "thumb.png"), await b.screenshot(box));
      console.log(`thumbnail: ${p.slug}/thumb.png`);
    }
  } finally {
    await b.close();
  }
}

// Sidebar index in every page.
for (const p of pages) {
  const nav = `<a class="site" href="../index.html">${esc(siteTitle)}</a>` + cats.map(c =>
    `<h2>${esc(c)}</h2><ul>${byCat(c).map(q => `<li><a href="../${q.slug}/index.html"${q === p ? ' aria-current="page"' : ""}>${esc(q.title)}</a></li>`).join("")}</ul>`).join("");
  let html = p.html
    .replace(/<!-- explainer:nav:start -->[\s\S]*?<!-- explainer:nav:end -->/, () => `<!-- explainer:nav:start -->${nav}<!-- explainer:nav:end -->`)
    .replace(/<!-- explainer:back:start -->[\s\S]*?<!-- explainer:back:end -->/, () => `<!-- explainer:back:start --><a class="backlink" href="../index.html">← ${esc(siteTitle)}</a><!-- explainer:back:end -->`)
    .replace(/<div class="page(?: has-toc)?">/, '<div class="page has-toc">');
  if (html !== p.html) await writeFile(p.file, html);
}

// Home page: the theme CSS from the template, then cards grouped by category.
const template = await readFile(path.join(here, "../assets/template.html"), "utf8");
const css = (template.match(/<style>([\s\S]*?)<\/style>/) || [])[1] ?? "";
const card = p => {
  const thumb = existsSync(path.join(root, p.slug, "thumb.png")) ? `<img src="${p.slug}/thumb.png" alt="" loading="lazy">` : `<span class="noimg"></span>`;
  return `<a class="card" href="${p.slug}/index.html">${thumb}<span class="card-title">${esc(p.title)}</span><span class="card-dek">${esc(p.dek)}</span><span class="card-meta">${p.figures} interactive figure${p.figures === 1 ? "" : "s"}</span></a>`;
};
const home = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(siteTitle)}</title>
<meta name="description" content="${esc(intro)}">
<meta name="explainer:site" content="home">
<style>${css}
main.home { max-width: 64rem; }
.cat { margin-top: 56px; }
.cat h2 { font: 600 12px/1 var(--font-text); letter-spacing: 0.14em; text-transform: uppercase; color: var(--brass); margin: 0 0 18px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 28px 24px; }
.card { display: grid; gap: 6px; text-decoration: none; color: var(--ink); }
.card img, .card .noimg { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; border-radius: 10px; border: 1px solid var(--faint); background: var(--bg); }
.card:hover img { border-color: var(--muted); }
.card-title { font-weight: 640; font-size: 1.08rem; letter-spacing: -0.01em; margin-top: 6px; }
.card-dek { color: var(--muted); font-size: 0.95rem; line-height: 1.5; }
.card-meta { font: 500 12px/1 var(--font-mono); color: var(--muted); margin-top: 4px; }
</style>
</head>
<body>
<div class="page">
<main class="home">
<header>
  <p class="kicker">${pages.length} explainer${pages.length === 1 ? "" : "s"}</p>
  <h1>${esc(siteTitle)}</h1>
  <p class="dek">${esc(intro)}</p>
</header>
${cats.map(c => `<section class="cat"><h2>${esc(c)}</h2><div class="cards">${byCat(c).map(card).join("")}</div></section>`).join("\n")}
</main>
</div>
</body>
</html>
`;
await writeFile(homeFile, home);
console.log(`wrote ${homeFile}: ${pages.length} pages in ${cats.length} categor${cats.length === 1 ? "y" : "ies"}`);
