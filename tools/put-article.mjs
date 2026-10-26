#!/usr/bin/env node
// Replaces the article region of a page with the contents of a file.
// Usage: node tools/put-article.mjs <page.html> <article.html>
import { readFile, writeFile } from "node:fs/promises";
const [page, src] = process.argv.slice(2);
const html = await readFile(page, "utf8"), body = await readFile(src, "utf8");
const out = html.replace(/<!-- explainer:article:start -->[\s\S]*?<!-- explainer:article:end -->/, () => `<!-- explainer:article:start -->\n${body.trim()}\n<!-- explainer:article:end -->`);
if (out === html) throw new Error("article markers not found");
await writeFile(page, out);
console.log(`article: ${body.length} chars -> ${page}`);
