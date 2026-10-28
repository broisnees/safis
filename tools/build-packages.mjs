#!/usr/bin/env node
// Builds packages/safis/dist from src/ so the figures can be used from npm:
//   dist/safis.js       ES module; safe to import during server rendering, starts in the browser
//   dist/safis.iife.js  classic script that sets window.Safis, E3, Num, SafisTeX
//   dist/tex.js         TeX -> MathML only, runs anywhere (Node too), for server-rendered math
//   dist/style.css      the whole book theme, global (for sites and blogs)
//   dist/scoped.css     the same rules, but only inside elements with class "safis"
//   dist/fonts/         the embedded fonts and their licenses
// The wrappers in packages/react, vue, svelte and astro are plain source and need no build.
//
// Usage: node tools/build-packages.mjs

import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = f => path.join(root, "src", f);
const read = async f => (existsSync(src(f)) ? (await readFile(src(f), "utf8")).trim() : "");
const out = path.join(root, "packages/safis/dist");
const version = JSON.parse(await readFile(path.join(root, "packages/safis/package.json"), "utf8")).version;
const banner = `/*! safis ${version} | generated from src/ by tools/build-packages.mjs; edit src/, not this file.
    Fonts: Source Serif 4, Source Sans 3, STIX Two Math (SIL Open Font License, see fonts/). */`;

// The same sources, in the same order, as the page template (tools/build-template.mjs).
const templateBuild = await readFile(path.join(root, "tools/build-template.mjs"), "utf8");
const list = name => JSON.parse(templateBuild.match(new RegExp(`const ${name} = (\\[[^\\]]*\\])`))[1]).map(f => f.replace(/^src\//, ""));
const SCRIPTS = list("SCRIPTS");
const STYLES = list("STYLES");
const scripts = (await Promise.all(SCRIPTS.map(read))).map(scopedTheme).filter(Boolean);
// Pages inline their fonts; the package serves them as files, so let text show while they load.
const css = (await Promise.all(STYLES.map(read))).filter(Boolean).join("\n\n")
  .replace(/url\("fonts\//g, 'url("./fonts/').replace(/font-display:\s*block/g, "font-display: swap");

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "fonts"), { recursive: true });

// ---------- ES module ----------
// The sources are classic scripts that set globals and start a frame loop, so they
// run inside a function, once, the first time the module is evaluated in a browser.
// On the server nothing runs and the exports are inert until the browser loads it.
const esm = `${banner}
const browser = typeof window !== "undefined" && typeof document !== "undefined";
function sources() {
${scripts.join("\n;\n")}
}
export let E3, Num, Sim, SafisTeX, Geo, Optics, Sound, Img, Fx, Iso, palette;
let api = null;
function start() {
  if (api) return api;
  if (!browser) throw new Error("safis draws in the browser: mount figures from an effect, onMounted, or a client script");
  // A page built from the template already has the runtime; share it instead of starting a second one.
  if (!(window.Safis && window.__explainer)) {
    window.__safisHost = true; // an app hosts the figures: no page chrome (theme switch, skip link)
    sources.call(window);
  }
  api = window.Safis;
  ({ E3, Num, Sim, SafisTeX, Geo, Optics, Sound, Img, Fx, Iso, palette } = window);
  return api;
}
if (browser) start();

// The theme colors are read from CSS. If the stylesheet arrived after the runtime
// started (some bundlers inject CSS late), nudge the runtime to read them again.
function refreshColors() {
  if (window.palette && window.palette.ink) return;
  const r = document.documentElement, t = r.getAttribute("data-theme");
  if (t == null) { r.setAttribute("data-theme", ""); r.removeAttribute("data-theme"); } else r.setAttribute("data-theme", t);
}

/** Turns a <figure> element into a live figure. spec may be a function returning the spec. */
export function mount(el, spec) {
  start();
  refreshColors();
  return api.demo(el, typeof spec === "function" ? spec() : spec);
}
export const demo = mount;
/** Binds .scrub, .set and [data-part] elements under root to their figures. */
export function enhance(root) { if (browser) start().enhance(root ?? document); }
/** Typesets .tex elements under root as MathML. */
export function typeset(root) { if (!browser) return 0; start(); return window.SafisTeX ? window.SafisTeX.typeset(root ?? document.body) : 0; }
/** TeX source to a MathML string (browser; use "@safis/core/tex" on a server). */
export function toMathML(src, options) { start(); return window.SafisTeX ? window.SafisTeX.toMathML(src, options) : String(src); }
/** "light" or "dark" forces a theme (remembered for the reader); "auto" follows their system setting. */
export function setTheme(mode) {
  if (!browser) return;
  const s = start();
  if (s.setTheme) return s.setTheme(mode);
  const r = document.documentElement;
  if (mode === "light" || mode === "dark") r.setAttribute("data-theme", mode); else r.removeAttribute("data-theme");
}
/** Starts the runtime now (it starts on import in a browser anyway) and returns window.Safis. */
export function ready() { return start(); }
export const version = ${JSON.stringify(version)};
export default { mount, demo, enhance, typeset, toMathML, setTheme, ready, version };
`;
await writeFile(path.join(out, "safis.js"), esm);

// ---------- classic script ----------
await writeFile(path.join(out, "safis.iife.js"), `${banner}\n${scripts.join("\n;\n")}\n`);

// ---------- TeX only, runs anywhere ----------
// tex.js picks its global from \`window\`; handing it a private object keeps it from
// touching the real page, so this works in Node and next to the full runtime.
const tex = await read("tex.js");
await writeFile(path.join(out, "tex.js"), `${banner}
const scope = {};
(function (window) {
${tex}
}).call(scope, scope);
/** TeX source to a MathML string. { display: true } for a block equation. */
export const toMathML = (src, options) => scope.SafisTeX.toMathML(src, options);
export default { toMathML };
`);

// ---------- CSS ----------
await writeFile(path.join(out, "style.css"), `${banner}\n${css}\n`);
await writeFile(path.join(out, "scoped.css"), `${banner}
/* Every rule applies only inside an element with class "safis" (an <Explainer>,
   or a <Figure>, which carries the class itself), so the host app keeps its styles. */
${scope(css)}
`);

for (const f of await readdir(path.join(root, "src/fonts"))) {
  if (/\.(woff2|txt)$/.test(f)) await copyFile(path.join(root, "src/fonts", f), path.join(out, "fonts", f));
}
console.log(`built packages/safis/dist (${SCRIPTS.filter((_, i) => scripts[i]).length} scripts, ${(esm.length / 1024).toFixed(0)} KB module)`);

// Interim patches to the bundled runtime, each a no-op once src/runtime.js does it itself:
// skip page chrome when an app hosts the figures, and (with scoped.css, where the theme
// tokens sit on a .safis element rather than <html>) read the tokens from there.
function scopedTheme(code) {
  // Same idea for page chrome: an app embedding figures gets no theme switch or skip link.
  if (!code.includes("__safisHost")) {
    code = code
      .replace("  function addThemeToggle() {\n", "  function addThemeToggle() {\n    if (window.__safisHost) return;\n")
      .replace("  function addSkipLink() {\n", "  function addSkipLink() {\n    if (window.__safisHost) return;\n");
  }
  const read = "    const cs = getComputedStyle(root);\n    for (const n of NAMES) palette[n]";
  if (!code.includes(read)) return code;
  return code
    .replace(read, `    let cs = getComputedStyle(root);
    if (!cs.getPropertyValue("--ink").trim()) { const el = document.querySelector(".safis"); if (el) cs = getComputedStyle(el); }
    for (const n of NAMES) palette[n]`)
    .replace("    if (!el.id) el.id = `figure-${++autoId}`;", "    if (!palette.ink) readTheme();\n    if (!el.id) el.id = `figure-${++autoId}`;");
}

// Prefixes every selector so it only matches inside .safis. The page-level selectors
// (:root, html, body) become the .safis element itself, so it carries the tokens and
// the base type; a figure.demo that has the class itself matches too.
function scope(text) {
  let i = 0, res = "";
  const n = text.length;
  while (i < n) {
    // comments and whitespace pass through
    if (text.startsWith("/*", i)) { const e = text.indexOf("*/", i + 2); res += text.slice(i, e + 2) + "\n"; i = e + 2; continue; }
    const open = findBrace(text, i);
    if (open < 0) { res += text.slice(i); break; }
    const head = text.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const close = matchBrace(text, open);
    const body = text.slice(open + 1, close);
    if (head.startsWith("@media") || head.startsWith("@supports") || head.startsWith("@container")) res += `${head} {\n${scope(body)}\n}\n`;
    else if (head.startsWith("@")) res += `${head} {${body}}\n`;
    else res += `${splitSelectors(head).map(scopeSelector).join(",\n")} {${body}}\n`;
    i = close + 1;
  }
  return res;
}
function findBrace(t, from) {
  for (let i = from, q = null; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === q && t[i - 1] !== "\\") q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (t.startsWith("/*", i)) i = t.indexOf("*/", i + 2) + 1;
    else if (c === "{") return i;
  }
  return -1;
}
function matchBrace(t, open) {
  for (let i = open + 1, depth = 1, q = null; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === q && t[i - 1] !== "\\") q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (t.startsWith("/*", i)) i = t.indexOf("*/", i + 2) + 1;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error("unbalanced braces in CSS");
}
function splitSelectors(s) {
  const parts = [];
  let depth = 0, cur = "";
  for (const c of s.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
function scopeSelector(sel) {
  if (sel === ":root" || sel === "html" || sel === "body") return ".safis";
  if (sel.startsWith(":root")) return `${sel} .safis`;
  const own = sel.match(/^figure\.demo((?:\.[\w-]+)*)/);
  return own ? `:where(.safis) ${sel}, ${sel.replace(own[0], `${own[0]}.safis`)}` : `:where(.safis) ${sel}`;
}
