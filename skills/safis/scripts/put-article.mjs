#!/usr/bin/env node
// Replaces the article between a page's explainer:article markers with the contents
// of a file, so the article can be written and edited on its own instead of inside
// the page, which is mostly runtime.
// Usage: node put-article.mjs <page.html> <article.html>
import { readFile, writeFile } from "node:fs/promises";
const [page, src] = process.argv.slice(2);
if (!page || !src) { console.error("usage: node put-article.mjs <page.html> <article.html>"); process.exit(2); }
const html = await readFile(page, "utf8"), body = await readFile(src, "utf8");
const out = html.replace(/<!-- explainer:article:start -->[\s\S]*?<!-- explainer:article:end -->/, () => `<!-- explainer:article:start -->\n${body.trim()}\n<!-- explainer:article:end -->`);
if (!/<!-- explainer:article:start -->/.test(html)) { console.error(`${page}: no explainer:article markers (build pages with new-page.mjs)`); process.exit(1); }
await writeFile(page, out);
console.log(`article: ${body.length} chars -> ${page}`);
