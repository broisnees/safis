#!/usr/bin/env node
// Assembles skills/safis/assets/template.html from src/.
// The runtime block sits between explainer:runtime markers so scripts/upgrade.mjs
// can swap it in existing pages.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => readFile(path.join(root, f), "utf8");
const [css, engine, runtime, page] = await Promise.all([
  read("src/theme.css"), read("src/engine3d.js"), read("src/runtime.js"), read("src/page.html"),
]);
const block = `<!-- explainer:runtime:start v2 -->
<style>
${css.trim()}
</style>
<script>
${engine.trim()}
</script>
<script>
${runtime.trim()}
</script>
<!-- explainer:runtime:end -->`;
const out = page.replace(/<!-- explainer:runtime:start -->[\s\S]*?<!-- explainer:runtime:end -->/, () => block);
if (out === page) throw new Error("runtime markers not found in src/page.html");
const dest = path.join(root, "skills/safis/assets/template.html");
await writeFile(dest, out);
console.log(`wrote ${path.relative(root, dest)} (${(out.length / 1024).toFixed(0)} KB)`);
