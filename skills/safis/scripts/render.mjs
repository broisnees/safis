#!/usr/bin/env node
// Pre-renders diagrams and code in explainer pages, so the pages carry no renderer
// and still make no network requests.
//
// Usage: node render.mjs <page.html>...
//
// In the article:
//   <pre class="mermaid">graph LR; A --> B</pre>
//       becomes an inline SVG diagram (beautiful-mermaid: flowcharts, sequence, state,
//       class, ER, and xychart-beta), drawn in the page's colors in light and dark.
//   <pre><code class="language-js">...</code></pre>
//       becomes highlighted code (Shiki) with light and dark colors. Any Shiki language.
//   <pre><code class="language-diff">...</code></pre>
//       marks added, removed, and hunk lines of a unified diff.
//   data-title="resolver.js" on <code> adds a title bar; class="numbered" on <pre> adds
//   line numbers; Shiki's notation comments work in any language:
//   // [!code ++]  // [!code --]  // [!code highlight]  // [!code focus]
//
// The source stays in each block's data-src, so running it again re-renders safely.
// The first run installs pinned renderers into a cache folder (needs npm and network once).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEPS = { "shiki": "4.5.0", "@shikijs/transformers": "4.5.0", "beautiful-mermaid": "1.1.3" };
const THEMES = { light: "github-light", dark: "github-dark" };
const cache = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "safis", "render-1");

const pages = process.argv.slice(2);
if (!pages.length) { console.error("usage: node render.mjs <page.html>..."); process.exit(2); }

async function load() {
  const missing = Object.keys(DEPS).filter(n => !existsSync(path.join(cache, "node_modules", n, "package.json")));
  if (missing.length) {
    await mkdir(cache, { recursive: true });
    await writeFile(path.join(cache, "package.json"), JSON.stringify({ private: true, type: "module" }));
    const specs = Object.entries(DEPS).map(([n, v]) => `${n}@${v}`);
    console.log(`installing ${specs.join(", ")} into ${cache} (first run only)`);
    try {
      execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...specs], { cwd: cache, stdio: "inherit", shell: process.platform === "win32" });
    } catch {
      console.error("render.mjs couldn't install its renderers: it needs npm and a network connection the first time.");
      process.exit(2);
    }
  }
  // A module inside the cache resolves the packages from the cache's node_modules.
  const loader = path.join(cache, "load.mjs");
  await writeFile(loader, `export { codeToHtml, bundledLanguages } from "shiki";
export { transformerNotationDiff, transformerNotationHighlight, transformerNotationFocus } from "@shikijs/transformers";
export { renderMermaidSVG } from "beautiful-mermaid";
`);
  return import(pathToFileURL(loader).href);
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = s => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&amp;/g, "&");
const attr = (attrs, name) => (attrs.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];

// The SVG's own stylesheet would apply to the whole page and pulls a web font, so keep
// its rules but scope them to the diagram, drop the import, and use the page's sans.
function scopeCss(css) {
  return css
    .replace(/@import[^;]*;/g, "")
    .replace(/font-family:[^;}]*/g, "font-family: var(--font-text)")
    .replace(/(^|[{}])(\s*)([^{}@]+)\{/g, (m, brace, ws, sel) =>
      `${brace}${ws}${sel.split(",").map(x => x.trim()).map(x => (x.startsWith("svg") ? `.mermaid-svg ${x}` : `.mermaid-svg svg ${x}`)).join(", ")} {`);
}

function diagram(lib, src, n) {
  let svg = lib.renderMermaidSVG(src, { transparent: true, font: "sans-serif" });
  svg = svg.replace(/<style>([\s\S]*?)<\/style>/g, (m, css) => `<style>${scopeCss(css)}</style>`);
  // Colors come from code.css, so the diagram follows the page's theme. A wide diagram
  // shrinks to the column only so far; past that it scrolls, so its text stays readable.
  const w = Number((svg.match(/^<svg[^>]*?\swidth="([\d.]+)"/) || [])[1]) || 0;
  const minW = w ? Math.round(Math.min(w, Math.max(320, w * 0.72))) : 0;
  svg = svg.replace(/^<svg([^>]*?)\sstyle="[^"]*"/, `<svg$1${minW ? ` style="min-width: ${minW}px"` : ""}`);
  // Ids are page-wide, so give each diagram its own.
  const ids = [...new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))];
  for (const id of ids) {
    const re = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    svg = svg.replace(new RegExp(`id="${re}"`, "g"), `id="d${n}-${id}"`)
      .replace(new RegExp(`url\\(#${re}\\)`, "g"), `url(#d${n}-${id})`)
      .replace(new RegExp(`href="#${re}"`, "g"), `href="#d${n}-${id}"`);
  }
  return `<div class="mermaid-svg" role="img" data-src="${esc(src)}">${svg.trim()}</div>`;
}

async function code(lib, src, lang, o) {
  let known = !lang || lang === "text" || lang in lib.bundledLanguages;
  if (!known) console.log(`  no Shiki grammar for "${lang}", shown as plain text`);
  const lines = src.split("\n");
  const marks = {
    name: "safis-diff-lines",
    line(node, i) {
      if (lang !== "diff") return;
      const t = lines[i - 1] ?? "";
      if (/^\+(?!\+\+ )/.test(t)) this.addClassToHast(node, "diff add");
      else if (/^-(?!-- )/.test(t)) this.addClassToHast(node, "diff remove");
      else if (/^@@/.test(t)) this.addClassToHast(node, "diff hunk");
    },
    pre(node) { if (lang === "diff") this.addClassToHast(node, "has-diff diff-file"); },
  };
  const html = await lib.codeToHtml(src, {
    lang: known ? lang || "text" : "text",
    themes: THEMES,
    defaultColor: false,
    transformers: [lib.transformerNotationDiff(), lib.transformerNotationHighlight(), lib.transformerNotationFocus(), marks],
  });
  const data = [`data-lang="${esc(lang || "text")}"`, o.title ? `data-title="${esc(o.title)}"` : "", o.numbered ? "data-numbered" : ""].filter(Boolean).join(" ");
  const title = o.title ? `<div class="code-title">${esc(o.title)}</div>` : "";
  return `<div class="code-block" ${data} data-src="${esc(src)}">${title}${html.replace(/\stabindex="0"/, ' tabindex="0"')}</div>`;
}

// String.replace with an async replacer, applied in order.
async function replaceAsync(s, re, fn) {
  const parts = [];
  let last = 0;
  for (const m of s.matchAll(re)) {
    parts.push(s.slice(last, m.index), await fn(...m));
    last = m.index + m[0].length;
  }
  return parts.join("") + s.slice(last);
}

const lib = await load();
let failed = 0;
for (const page of pages) {
  const html = await readFile(page, "utf8");
  const start = html.indexOf("<!-- explainer:article:start -->"), end = html.indexOf("<!-- explainer:article:end -->");
  const [head, body, tail] = start >= 0 && end > start ? [html.slice(0, start), html.slice(start, end), html.slice(end)] : ["", html, ""];
  let n = 0, diagrams = 0, blocks = 0;
  let out = body;
  try {
    // Diagrams: fresh <pre class="mermaid"> blocks and ones rendered before.
    out = await replaceAsync(out, /<div class="mermaid-svg" role="img" data-src="([^"]*)">[\s\S]*?<\/svg><\/div>|<pre class="mermaid"[^>]*>([\s\S]*?)<\/pre>/g, async (m, prev, fresh) => {
      diagrams++;
      return diagram(lib, unesc(prev ?? fresh).trim(), ++n);
    });
    // A diagram outside a figure gets one, so it's numbered like the other figures.
    out = out.replace(/(<figure\b[^>]*>\s*)?(<div class="mermaid-svg"[\s\S]*?<\/svg><\/div>)/g, (m, fig, d) => (fig ? m : `<figure class="diagram">${d}</figure>`));
    // Code: fresh <pre><code class="language-x"> blocks and ones rendered before.
    out = await replaceAsync(out, /<div class="code-block"([^>]*?) data-src="([^"]*)">[\s\S]*?<\/pre><\/div>|<pre([^>]*)>\s*<code([^>]*\bclass="[^"]*\blanguage-[^"]*"[^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/g, async (m, prevAttrs, prevSrc, preAttrs, codeAttrs, fresh) => {
      blocks++;
      if (prevSrc != null) return code(lib, unesc(prevSrc), attr(prevAttrs, "data-lang"), { title: attr(prevAttrs, "data-title") && unesc(attr(prevAttrs, "data-title")), numbered: /\bdata-numbered\b/.test(prevAttrs) });
      const lang = (attr(codeAttrs, "class").match(/\blanguage-([\w+#.-]+)/) || [])[1];
      const title = attr(codeAttrs, "data-title");
      return code(lib, unesc(fresh).replace(/^\n/, "").replace(/\n\s*$/, ""), lang, { title: title && unesc(title), numbered: /\bclass="[^"]*\bnumbered\b/.test(preAttrs) });
    });
  } catch (e) {
    failed++;
    console.error(`${page}: ${e.message}`);
    continue;
  }
  if (out !== body) await writeFile(page, head + out + tail);
  console.log(`${page}: ${diagrams} diagram${diagrams === 1 ? "" : "s"}, ${blocks} code block${blocks === 1 ? "" : "s"}`);
}
process.exit(failed ? 1 : 0);
