#!/usr/bin/env node
// Creates a new explainer page from assets/template.html with the title,
// category, and one-sentence summary filled in and an empty article.
//
// Usage: node new-page.mjs --title "The Jaw Joint" --category Body --dek "..." --out site/jaw-joint/index.html [--force] [--template <file>]

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--force") opt.force = true;
  else if (a.startsWith("--")) opt[a.slice(2)] = argv[++i];
}
if (!opt.title || !opt.out) {
  console.error('usage: node new-page.mjs --title "..." --category <Body|Biology|Chemistry|Physics|Machines|Earth & Space|Computing|AI|Math> --dek "..." --out <dir/index.html> [--force]');
  process.exit(2);
}
const out = path.resolve(opt.out);
if (existsSync(out) && !opt.force) { console.error(`${out} already exists (pass --force to overwrite)`); process.exit(1); }

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
let html = await readFile(opt.template ? path.resolve(opt.template) : path.join(here, "../assets/template.html"), "utf8");
html = html
  .replaceAll("{{TITLE}}", esc(opt.title))
  .replaceAll("{{CATEGORY}}", esc(opt.category ?? "Explainer"))
  .replaceAll("{{DEK}}", esc(opt.dek ?? ""));
html = html.replace(/<!-- explainer:article:start -->[\s\S]*?<!-- explainer:article:end -->/, `<!-- explainer:article:start -->
<!-- Write the article here: prose, then each <figure class="demo"> followed by its <script>. -->

<!-- explainer:article:end -->`);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`created ${out}`);
console.log("Write the article between the explainer:article markers; leave the runtime block in <head> alone.");
