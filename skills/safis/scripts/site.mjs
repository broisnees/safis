#!/usr/bin/env node
// Turns a folder of explainer pages into a small site: writes <root>/index.html
// (every page, grouped by category) and puts the same index in each page's
// sidebar. Pages live at <root>/<slug>/index.html. Links point at index.html
// files so the site also works straight from disk.
//
// Usage: node site.mjs <root> [--title "Explainers"] [--intro "..."] [--thumbs] [--shared | --inline] [--home <template.html>]
// --thumbs screenshots each page's first figure at 2x as thumb.webp, and in dark mode as
// thumb-dark.webp (needs Chrome, like verify.mjs).
// --shared writes one copy of the runtime to <root>/safis.css and <root>/safis.js
// and links every page to it instead of carrying its own; the site still opens
// from disk. --inline puts the runtime back in each page. The choice is kept in
// the home page, so later runs don't need the flag.
// --home uses your own home page (a product page, say) instead of the generated one.
// In the template, <!-- explainer:theme --> and <!-- explainer:runtime --> become the
// stylesheet and runtime, <!-- explainer:gallery --> the cards by category, and
// {{PAGES}}, {{FIGURES}}, {{CATEGORIES}} the counts. <meta name="explainer:title">
// names the site in every page's sidebar.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ORDER = ["Body", "Biology", "Chemistry", "Physics", "Machines", "Engineering", "Earth & Space", "Computing", "AI", "Math", "History", "Philosophy", "Language", "Economics & Society", "Art & Music"];

const argv = process.argv.slice(2);
const opt = { root: null, title: null, intro: null, thumbs: false, shared: null, home: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--title") opt.title = argv[++i];
  else if (a === "--intro") opt.intro = argv[++i];
  else if (a === "--thumbs") opt.thumbs = true;
  else if (a === "--shared") opt.shared = true;
  else if (a === "--inline") opt.shared = false;
  else if (a === "--home") opt.home = argv[++i];
  else opt.root = a;
}
if (!opt.root) { console.error('usage: node site.mjs <root> [--title "..."] [--intro "..."] [--thumbs] [--shared | --inline]'); process.exit(2); }
const root = path.resolve(opt.root);

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const meta = (html, name) => unesc((html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) || [])[1] ?? "");

// Keep the title and intro from an existing home page unless new ones are given.
const homeFile = path.join(root, "index.html");
const oldHome = existsSync(homeFile) ? await readFile(homeFile, "utf8") : "";
const homeTemplate = opt.home ? await readFile(opt.home, "utf8") : null;
const siteTitle = opt.title ?? (meta(homeTemplate ?? oldHome, "explainer:title") || unesc((oldHome.match(/<h1>([^<]*)<\/h1>/) || [])[1] ?? "") || "Explainers");
const intro = opt.intro ?? (unesc((oldHome.match(/<p class="dek">([^<]*)<\/p>/) || [])[1] ?? "") || "Interactive explanations of how things work, built around figures you can turn, drag, and take apart.");
const shared = opt.shared ?? oldHome.includes('<meta name="explainer:runtime" content="shared">');

// The runtime block from the template, and the shared files built from it.
const template = await readFile(path.join(here, "../assets/template.html"), "utf8");
const RUNTIME = /<!-- explainer:runtime:start([^>]*)-->[\s\S]*?<!-- explainer:runtime:end -->/;
const [block, tag] = template.match(RUNTIME);
const version = t => (t.match(/\bv\d+\b/) || [""])[0];
const css = [...block.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join("\n");
const js = [...block.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n;\n");
const hash = s => createHash("sha256").update(s).digest("hex").slice(0, 10);
const cssHref = `safis.css?v=${hash(css)}`, jsHref = `safis.js?v=${hash(js)}`;
const sharedBlock = `<!-- explainer:runtime:start ${version(tag)} shared -->
<link rel="stylesheet" href="../${cssHref}">
<script src="../${jsHref}"></script>
<!-- explainer:runtime:end -->`;
if (shared) {
  await writeFile(path.join(root, "safis.css"), css);
  await writeFile(path.join(root, "safis.js"), js);
} else if (oldHome.includes('<meta name="explainer:runtime" content="shared">')) {
  await rm(path.join(root, "safis.css"), { force: true });
  await rm(path.join(root, "safis.js"), { force: true });
}

const article = html => (html.match(/<!-- explainer:article:start -->([\s\S]*?)<!-- explainer:article:end -->/) || [])[1] ?? "";
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
    figures: article(html).split('<figure class="demo').length - 1,
    minutes: Math.max(1, Math.round(article(html).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length / 230)),
  });
}
const cats = [...new Set(pages.map(p => p.category))].sort((a, b) => {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
});
const byCat = c => pages.filter(p => p.category === c).sort((a, b) => a.title.localeCompare(b.title));

if (opt.thumbs && pages.length) {
  const { openBrowser } = await import("./lib/chrome.mjs");
  const b = await openBrowser({ viewport: { width: 1280, height: 1000, deviceScaleFactor: 2, mobile: false } });
  try {
    // Reduced motion: a thumbnail is a still, and an animated 3D figure redrawing in software
    // WebGL can keep a heavy page from ever finishing its load.
    await b.setMedia("light", "reduce");
    for (const p of pages) {
      // Heavy 3D pages render slowly in headless Chrome's software WebGL at 2x; give them time.
      await b.goto(pathToFileURL(p.file).href, 180000);
      const box = await b.evaluate(`(() => {
        document.documentElement.classList.add("safis-checking");
        const s = document.querySelector("figure.demo .stage");
        if (!s) return null;
        s.scrollIntoView({ block: "center" });
        const r = s.getBoundingClientRect();
        return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
      })()`);
      if (!box) continue;
      await b.settle(400);
      await writeFile(path.join(root, p.slug, "thumb.webp"), await b.screenshot(box, { format: "webp", quality: 84 }));
      await rm(path.join(root, p.slug, "thumb.png"), { force: true });
      // The same figure in dark mode, for cards on a dark page. The runtime redraws every
      // figure when the color scheme changes; give a heavy 3D figure time to finish.
      await b.setMedia("dark", "reduce");
      await b.settle(900);
      await writeFile(path.join(root, p.slug, "thumb-dark.webp"), await b.screenshot(box, { format: "webp", quality: 84 }));
      await b.setMedia("light", "reduce");
      console.log(`thumbnail: ${p.slug}/thumb.webp, thumb-dark.webp`);
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
  // Link the page to the shared runtime, or give it its own copy back. A page on
  // another runtime version keeps what it has until upgrade.mjs moves it over.
  const m = html.match(RUNTIME);
  if (m && version(m[1]) !== version(tag)) {
    if (shared) console.log(`kept ${p.slug} inline: its runtime is ${version(m[1]) || "unversioned"}, the template's is ${version(tag)} (run upgrade.mjs on it first)`);
  } else if (m && shared) html = html.replace(RUNTIME, () => sharedBlock);
  else if (m && /\bshared\b/.test(m[1])) html = html.replace(RUNTIME, () => block);
  if (html !== p.html) await writeFile(p.file, html);
}

// Home page: the theme CSS from the template, then cards grouped by category.
const card = p => {
  const file = ["thumb.webp", "thumb.png"].find(f => existsSync(path.join(root, p.slug, f)));
  const dark = existsSync(path.join(root, p.slug, "thumb-dark.webp"));
  // Both images are lazy and the hidden one has no box, so a reader downloads only one.
  const thumb = file ? `<img class="thumb-light" src="${p.slug}/${file}" alt="" loading="lazy" decoding="async">${dark ? `<img class="thumb-dark" src="${p.slug}/thumb-dark.webp" alt="" loading="lazy" decoding="async">` : ""}` : `<span class="noimg"></span>`;
  return `<a class="card" href="${p.slug}/index.html"><span class="thumb">${thumb}</span><span class="card-title">${esc(p.title)}</span><span class="card-dek">${esc(p.dek)}</span><span class="card-meta">${p.figures} figure${p.figures === 1 ? "" : "s"} · ${p.minutes} min read</span></a>`;
};
const homePage = theme => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(siteTitle)}</title>
<meta name="description" content="${esc(intro)}">
<meta name="explainer:site" content="home">${shared ? '\n<meta name="explainer:runtime" content="shared">' : ""}
${theme}
<style>
main.home { max-width: 68rem; }
.home header { max-width: 40rem; }
.cat { margin-top: 72px; }
.cat h2 { display: flex; align-items: baseline; gap: 14px; font: 600 16px/1.2 var(--font-serif); font-variant-caps: all-small-caps; letter-spacing: 0.07em; color: var(--accent); margin: 0 0 26px; }
.cat h2::after { content: ""; flex: 1; height: 1px; background: var(--rule); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 44px 36px; }
.card { display: grid; align-content: start; gap: 6px; text-decoration: none; color: var(--ink); }
.card .thumb { display: block; border: 1px solid var(--rule); border-radius: 6px; background: var(--panel); box-shadow: var(--shadow); overflow: hidden; margin-bottom: 10px; transition: border-color 0.2s, transform 0.25s cubic-bezier(.3,.7,.4,1); }
.card img, .card .noimg { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; }
.card img { outline: 1px solid oklch(0 0 0 / 0.1); outline-offset: -1px; }
:root[data-theme="dark"] .card img { outline-color: oklch(1 0 0 / 0.1); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .card img { outline-color: oklch(1 0 0 / 0.1); } }
@media (hover: hover) { .card:hover .thumb { border-color: var(--faint); transform: translateY(-2px); } }
.card-title { font: 600 1.28rem/1.25 var(--font-serif); letter-spacing: -0.005em; text-wrap: balance; }
.card:focus-visible { outline: 2px solid var(--accent); outline-offset: 6px; border-radius: 6px; }
.card:hover .card-title { text-decoration: underline; text-decoration-color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 0.18em; }
.card-dek { color: var(--muted); font-size: 1rem; line-height: 1.5; text-wrap: pretty; }
.card-meta { font: 600 13.5px/1 var(--font-serif); font-variant-caps: all-small-caps; letter-spacing: 0.06em; color: var(--muted); margin-top: 6px; }
:root[data-theme="dark"] .card img { filter: brightness(0.92); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .card img { filter: brightness(0.92); } }
</style>
<script>
// Light / dark / system switch, the same one the pages carry (remembered per browser).
(() => {
  const K = "safis-theme", root = document.documentElement;
  const get = () => { try { return localStorage.getItem(K) || "auto"; } catch { return "auto"; } };
  const apply = m => { if (m === "auto") delete root.dataset.theme; else root.dataset.theme = m; };
  apply(get());
  const ICON = {
    auto: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z"/></svg>',
    light: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    dark: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1z"/></svg>',
  };
  addEventListener("DOMContentLoaded", () => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "theme-toggle";
    const sync = () => { const m = get(); b.innerHTML = ICON[m]; b.title = "Theme: " + (m === "auto" ? "match system" : m); b.setAttribute("aria-label", b.title); };
    b.addEventListener("click", () => {
      const order = ["auto", "light", "dark"], m = order[(order.indexOf(get()) + 1) % 3];
      try { if (m === "auto") localStorage.removeItem(K); else localStorage.setItem(K, m); } catch {}
      apply(m); sync();
    });
    sync(); document.body.append(b);
  });
})();
</script>
</head>
<body>
<div class="page">
<main class="home">
<header>
  <p class="kicker">${pages.length} explainer${pages.length === 1 ? "" : "s"} · ${pages.reduce((n, p) => n + p.figures, 0)} figures</p>
  <h1>${esc(siteTitle)}</h1>
  <p class="dek">${esc(intro)}</p>
</header>
${cats.map(c => `<section class="cat"><h2>${esc(c)}</h2><div class="cards">${byCat(c).map(card).join("")}</div></section>`).join("\n")}
</main>
</div>
</body>
</html>
`;
const inlineTheme = `<style>${css}</style>`;
if (homeTemplate) {
  const gallery = cats.map(c => `<section class="cat"><h3>${esc(c)}</h3><div class="cards">${byCat(c).map(card).join("")}</div></section>`).join("\n");
  const scripts = [...block.matchAll(/<script>[\s\S]*?<\/script>/g)].map(m => m[0]).join("\n");
  await writeFile(homeFile, homeTemplate
    .replace("<!-- explainer:theme -->", () => (shared ? `<meta name="explainer:runtime" content="shared">\n<link rel="stylesheet" href="${cssHref}">` : inlineTheme))
    .replace("<!-- explainer:runtime -->", () => (shared ? `<script src="${jsHref}"></script>` : scripts))
    .replace("<!-- explainer:gallery -->", () => gallery)
    .replaceAll("{{PAGES}}", String(pages.length))
    .replaceAll("{{FIGURES}}", String(pages.reduce((n, p) => n + p.figures, 0)))
    .replaceAll("{{CATEGORIES}}", String(cats.length)));
} else await writeFile(homeFile, homePage(shared ? `<link rel="stylesheet" href="${cssHref}">` : inlineTheme));

// A 404 page in the same style, for static hosts (Cloudflare, Netlify, Vercel, GitHub Pages).
// It carries its own theme: hosts serve it at any path, where a relative link to safis.css would miss.
const notFound = homePage(inlineTheme)
  .replace(/<title>[^<]*<\/title>/, `<title>Not found · ${esc(siteTitle)}</title>`)
  .replace(/<meta name="explainer:site" content="home">(\n<meta name="explainer:runtime" content="shared">)?/, '<meta name="explainer:site" content="404">')
  .replace(/<main class="home">[\s\S]*<\/main>/, `<main class="home"><header><p class="kicker">404</p><h1>This page isn't here</h1><p class="dek">It may have moved. <a href="/">Back to ${esc(siteTitle)}</a>.</p></header></main>`);
await writeFile(path.join(root, "404.html"), notFound);
console.log(`wrote ${homeFile}: ${pages.length} pages in ${cats.length} categor${cats.length === 1 ? "y" : "ies"}`);
