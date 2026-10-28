#!/usr/bin/env node
// Prepares the Astro site from the repo. Runs before `astro dev` and `astro build`; everything
// it writes is generated (ignored by git), so the explainers in site/ stay the source of truth.
//
//   src/generated/kits/<kit>.js        one runtime kit as `export default function install()`
//   src/generated/safis.css            the book theme, with the fonts as files in public/fonts/
//   src/generated/articles/<slug>.html the article, finished ahead of time (math typeset, contents,
//                                      anchors, note and citation numbers) with its figure scripts in place
//   src/generated/kitfiles.json        each kit's URL: a minified classic script in public/kits/, loaded
//                                      in <head> so figures build in place as the page parses (no shifts)
//   src/generated/pages.json           title, dek, category, counts, kits, and when each page was added
//   src/generated/fonts.json           the fonts' fingerprinted file names, for preloads
//   public/fonts/<name>.<hash>.woff2   the fonts, cached forever by their fingerprint
//   public/<slug>/thumb.webp           the card image (and thumb-dark.webp for dark pages)
// Pages with a folder in drafts/ are left out, as the old deploy did.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { build as rolldown } from "rolldown";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "..");
const root = path.resolve(web, "..");
const gen = path.join(web, "src/generated");
const site = path.join(root, "site");
// SAFIS_BASE serves the site under a path (GitHub project pages use "/<repo>"); default "/".
const base = ("/" + (process.env.SAFIS_BASE ?? "").replace(/^\/+|\/+$/g, "") + "/").replace("//", "/");
await rm(gen, { recursive: true, force: true });
for (const d of ["kits", "articles"]) await mkdir(path.join(gen, d), { recursive: true });
await rm(path.join(web, "public/fonts"), { recursive: true, force: true });
await mkdir(path.join(web, "public/fonts"), { recursive: true });

// The same sources, in the same order, as the page template (tools/build-template.mjs).
const templateBuild = await readFile(path.join(root, "tools/build-template.mjs"), "utf8");
const list = name => JSON.parse(templateBuild.match(new RegExp(`const ${name} = (\\[[^\\]]*\\])`))[1]).map(f => f.replace(/^src\//, ""));
// Like the template build, a listed source that doesn't exist is skipped.
const read = async f => (existsSync(path.join(root, "src", f)) ? (await readFile(path.join(root, "src", f), "utf8")).trim() : "");

// Kits, in template order. "base" (TeX, plots, numerics) and "runtime" load on every page;
// the rest only where a page's figures use them.
const KITS = [];
for (const f of list("SCRIPTS")) {
  const name = f === "tex.js" || f === "plot.js" ? "base" : f.replace(/\.js$/, "");
  const k = KITS.find(x => x.name === name) ?? (KITS.push({ name, files: [] }), KITS[KITS.length - 1]);
  k.files.push(f);
}
for (const k of KITS) {
  const body = (await Promise.all(k.files.map(read))).filter(Boolean).join("\n;\n");
  await writeFile(path.join(gen, `kits/${k.name}.js`), `// ${k.name} (${k.files.join(", ")}): generated from src/ by website/scripts/sync.mjs; edit src/, not this file.\nexport default function install() {\n${body}\n}\n`);
}
await writeFile(path.join(gen, "kits.json"), JSON.stringify(KITS.map(k => k.name)) + "\n");
// The same kits as classic scripts, minified and fingerprinted, for <script src> in the head.
await rm(path.join(web, "public/kits"), { recursive: true, force: true });
await mkdir(path.join(web, "public/kits"), { recursive: true });
await mkdir(path.join(gen, "classic"), { recursive: true });
const kitFiles = {};
for (const k of KITS) {
  const src = path.join(gen, "classic", `${k.name}.js`);
  await writeFile(src, (await Promise.all(k.files.map(read))).filter(Boolean).join("\n;\n") + "\n");
  const out = await rolldown({ input: src, output: { format: "iife", minify: true }, write: false, logLevel: "silent" });
  const code = out.output[0].code;
  const name = `${k.name}.${createHash("sha256").update(code).digest("hex").slice(0, 10)}.js`;
  await writeFile(path.join(web, "public/kits", name), code);
  kitFiles[k.name] = `${base}kits/${name}`;
}
await writeFile(path.join(gen, "kitfiles.json"), JSON.stringify({ order: KITS.map(k => k.name), files: kitFiles }, null, 2) + "\n");

// Theme CSS with the fonts as fingerprinted files that cache once for the whole site.
const fonts = {};
for (const f of await readdir(path.join(root, "src/fonts"))) {
  if (!f.endsWith(".woff2")) continue;
  const buf = await readFile(path.join(root, "src/fonts", f));
  const name = f.replace(/\.woff2$/, `.${createHash("sha256").update(buf).digest("hex").slice(0, 8)}.woff2`);
  await writeFile(path.join(web, "public/fonts", name), buf);
  fonts[f] = `${base}fonts/${name}`;
}
await writeFile(path.join(gen, "fonts.json"), JSON.stringify(fonts, null, 2) + "\n");
const css = (await Promise.all(list("STYLES").map(read))).filter(Boolean).join("\n\n")
  .replace(/url\("fonts\/([^"]+)"\)/g, (m, f) => (fonts[f] ? `url("${fonts[f]}")` : m));
await writeFile(path.join(gen, "safis.css"), css);

// Which kits a page's figures use: each kit's global and the helpers it adds to `g`.
// Loading one a page doesn't need only costs bytes; missing one breaks a figure, so err wide.
const KIT_TESTS = {
  engine3d: /\bE3\.|\brender3d\b|\bg\.gizmo\b/,
  parts3d: /\bE3\.parts\b/,
  bio3d: /\bE3\.bio\b/,
  sim: /\bSim\.|\bg\.gridField\b/,
  geo: /\bGeo\.|\bg\.map\(/,
  optics: /\bOptics\.|\bg\.(eye|optics|rayAngles|visibleSpectrum|wavelengthColor)\b/,
  sound: /\bSound\.|\bg\.(envelope|spectrogram|spectrum|waveform)\b/,
  image: /\bImg\.|\bg\.(histogram|kernel|pixels)\b/,
  effects: /\bFx\.|\bg\.fx\b/,
  iso: /\bIso\.|\bg\.iso\b/,
};
export function kitsFor(code) {
  const k = Object.keys(KIT_TESTS).filter(n => KIT_TESTS[n].test(code));
  if ((k.includes("parts3d") || k.includes("bio3d")) && !k.includes("engine3d")) k.unshift("engine3d");
  return k;
}

// Each figure's aspect ratio at a phone and a desktop width, read from its spec's
// `aspect:` line, so the placeholder before it mounts has the figure's final shape.
function aspects(code) {
  const out = {};
  const starts = [...code.matchAll(/demo\("([\w-]+)"\s*,\s*\{/g)];
  starts.forEach((m, i) => {
    const chunk = code.slice(m.index, starts[i + 1]?.index ?? code.length);
    const line = chunk.match(/^\s*aspect:\s*(.+?),?\s*$/m);
    if (!line) { out[m[1]] = [1.6, 1.6]; return; }
    try {
      const v = new Function(`return (${line[1]});`)();
      const at = w => (typeof v === "function" ? v(w) : v);
      const narrow = +at(358), wide = +at(608);
      if (narrow > 0.2 && narrow < 6 && wide > 0.2 && wide < 6) out[m[1]] = [narrow, wide];
    } catch {}
  });
  return out;
}
const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const meta = (html, name) => unesc((html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) || [])[1] ?? "");
// When a page first appeared in git (new pages, not yet committed, count as now).
const added = slug => {
  try {
    const t = execFileSync("git", ["log", "--diff-filter=A", "--format=%ct", "--", `site/${slug}/index.html`], { cwd: root }).toString().trim().split("\n").filter(Boolean).pop();
    return t ? +t * 1000 : Date.now();
  } catch { return Date.now(); }
};

// ---------- finishing an article ahead of time ----------
// What the runtime would otherwise insert after the page paints (and so shift the text): math
// typeset as MathML, heading ids and anchors, the contents list, sidenote numbers, citation
// numbers, and figure references. The runtime skips anything already done.
const texScope = {};
new Function("window", await read("tex.js"))(texScope);
const TeX = texScope.SafisTeX;
const slugOf = t => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "section";
const textOf = h => unesc(h.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const escAttr = t => String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function finishArticle(html) {
  // Math: <span class="tex">, <div class="tex">, <p class="tex"> (display unless inline span).
  html = html.replace(/<(span|div|p)(\s+class="([^"]*\btex\b[^"]*)")([^>]*)>([\s\S]*?)<\/\1>/g, (m, tag, clsAttr, cls, rest, inner) => {
    if (/data-tex=/.test(rest) || /</.test(inner)) return m;
    const src = unesc(inner).trim(), display = /\bdisplay\b/.test(cls) || tag !== "span";
    const r = TeX.convert(src, display);
    const num = r.tag ? ` data-number="${escAttr(r.tag)}"` : "";
    return `<${tag}${clsAttr}${rest} data-tex="${escAttr(src)}"${num}>${display && !r.error ? `<span class="tex-scroll">${r.html}</span>` : r.html}</${tag}>`;
  });
  // Headings: ids and anchors (the same slug rule as the runtime).
  // Every id already on the page counts as taken, so a heading named like a figure ("Shells" and
  // <figure id="shells">) gets "shells-2" instead of stealing the figure's id from demo().
  const used = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const heads = [];
  html = html.replace(/<(h2|h3)([^>]*)>([\s\S]*?)<\/\1>/g, (m, tag, attrs, inner) => {
    if (/class="anchor"/.test(inner)) return m;
    let id = (attrs.match(/\sid="([^"]+)"/) || [])[1];
    const text = textOf(inner);
    if (!id) { const b0 = slugOf(text); id = b0; let k = 2; while (used.has(id)) id = `${b0}-${k++}`; attrs += ` id="${id}"`; }
    used.add(id);
    if (tag === "h2" && !/class="[^"]*\bplain\b/.test(attrs)) heads.push({ id, text });
    return `<${tag}${attrs}>${inner}<a class="anchor" href="#${id}" aria-label="Link to “${escAttr(text)}”">#</a></${tag}>`;
  });
  // Contents for long articles, after the abstract (open: closing it later would shift the page).
  if (heads.length >= 5 && !/class="contents"/.test(html)) {
    const nav = `<details class="contents" open><summary>Contents</summary><ol>${heads.map(h => `<li><a href="#${h.id}">${h.text.replace(/</g, "&lt;")}</a></li>`).join("")}</ol></details>`;
    const ab = html.match(/<div class="abstract"[\s\S]*?<\/div>\s*<\/div>|<div class="abstract"[\s\S]*?<\/div>/);
    html = ab ? html.replace(ab[0], ab[0] + "\n" + nav) : nav + "\n" + html;
  }
  // Sidenotes: their numbered buttons.
  let n = 0;
  html = html.replace(/<span class="(sidenote|marginnote)"([^>]*)>/g, (m, kind, rest) => {
    const numbered = kind === "sidenote";
    let id = (rest.match(/\sid="([^"]+)"/) || [])[1];
    if (numbered) n++;
    if (!id) { id = numbered ? `note-${n}` : `note-m${n}-${Math.random().toString(36).slice(2, 6)}`; rest += ` id="${id}"`; }
    if (numbered) rest += ` data-n="${n}"`;
    const label = numbered ? `Note ${n}` : "Margin note";
    return `<button class="sn-ref" type="button" aria-expanded="false" aria-controls="${id}" aria-label="${label}">${numbered ? n : "⊕"}</button><span class="${kind}"${rest}>`;
  });
  // Citations: [k] by the reference's position in the list.
  const refIds = [...html.matchAll(/<ol class="references"[^>]*>([\s\S]*?)<\/ol>/g)].flatMap(m => [...m[1].matchAll(/<li id="([^"]+)"/g)].map(x => x[1]));
  html = html.replace(/<a class="cite" href="#([^"]+)"([^>]*)><\/a>/g, (m, id, rest) => { const k = refIds.indexOf(id) + 1; return k ? `<a class="cite" href="#${id}"${rest} aria-label="Reference ${k}">[${k}]</a>` : m; });
  // Figure references: "Figure k" by order of figures on the page.
  const figIds = [...html.matchAll(/<figure class="demo[^"]*" id="([\w-]+)"/g)].map(m => m[1]);
  html = html.replace(/<a class="figref" href="#([\w-]+)"([^>]*)><\/a>/g, (m, id, rest) => { const k = figIds.indexOf(id) + 1; return k ? `<a class="figref" href="#${id}"${rest}>Figure ${k}</a>` : m; });
  return html;
}

const pages = [];
for (const entry of await readdir(site, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const slug = entry.name, file = path.join(site, slug, "index.html");
  if (!existsSync(file) || existsSync(path.join(root, "drafts", slug))) continue;
  const html = await readFile(file, "utf8");
  const art = (html.match(/<!-- explainer:article:start -->([\s\S]*?)<!-- explainer:article:end -->/) || [])[1];
  if (!art) continue;
  let code = "", n = 0;
  for (const m of art.matchAll(/<script>([\s\S]*?)<\/script>/g)) code += m[1] + "\n";
  const asp = aspects(code);
  const body = art
    .replace(/<figure class="(demo[^"]*)" id="([\w-]+)"/g, (m, cls, id) => (asp[id] ? `<figure class="${cls}" id="${id}" style="--ph: ${+asp[id][1].toFixed(3)}; --ph-narrow: ${+asp[id][0].toFixed(3)}"` : m))
    .replace(/<!-- explainer:[^>]*-->/g, "")
    .replace(/href="\.\.\/([a-z0-9-]+)\/index\.html(#[^"]*)?"/g, (_, s, h) => `href="${base}${s}/${h ?? ""}"`)
    .replace(/href="\.\.\/index\.html"/g, `href="${base}"`)
    .trim();
  const prose = body.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  const finished = finishArticle(body);
  const thumb = existsSync(path.join(site, slug, "thumb.webp")), thumbDark = existsSync(path.join(site, slug, "thumb-dark.webp"));
  if (thumb || thumbDark) await mkdir(path.join(web, "public", slug), { recursive: true });
  if (thumb) await copyFile(path.join(site, slug, "thumb.webp"), path.join(web, "public", slug, "thumb.webp"));
  if (thumbDark) await copyFile(path.join(site, slug, "thumb-dark.webp"), path.join(web, "public", slug, "thumb-dark.webp"));
  pages.push({
    slug, title: unesc((html.match(/<title>([^<]*)<\/title>/) || [])[1] ?? slug), dek: meta(html, "description"),
    category: meta(html, "explainer:category") || "Other",
    figures: body.split('<figure class="demo').length - 1, minutes: Math.max(1, Math.round(prose / 230)), words: prose,
    kits: kitsFor(code), added: added(slug), thumb, thumbDark,
  });
  await writeFile(path.join(gen, `articles/${slug}.html`), finished + "\n");
}
pages.sort((a, b) => a.title.localeCompare(b.title));
await writeFile(path.join(gen, "pages.json"), JSON.stringify(pages, null, 2) + "\n");
console.log(`sync: ${pages.length} pages; kits ${KITS.map(k => k.name).join(", ")}`);
