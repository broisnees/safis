#!/usr/bin/env node
// Checks the built website (website/dist) before it is deployed:
//   1. every internal link and asset in every page resolves to a file in the build;
//   2. every explainer and the home page pass skills/safis/scripts/verify.mjs, served over HTTP;
//   3. --compare loads a few pages from the old site (site/, one shared runtime) and the new
//      one on a throttled mobile connection with compression, and reports bytes and timings.
//
// Usage: node tools/check-website.mjs [--build] [--compare] [--only slug,slug] [--jobs 3]

import { execFileSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { openBrowser } from "../skills/safis/scripts/lib/chrome.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "website/dist");
const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const only = arg("--only", "") ? arg("--only").split(",") : null;
const jobs = +arg("--jobs", 3);

if (flag("--build") || !existsSync(dist)) execFileSync("npm", ["run", "build", "-w", "website"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });

// ---------- a static server that compresses like the CDN ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain" };
const brCache = new Map();
function serve(dir, { pretty = true } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let p = path.join(dir, decodeURIComponent(url.pathname));
    if (existsSync(p) && statSync(p).isDirectory()) p = path.join(p, "index.html");
    else if (pretty && !existsSync(p) && !path.extname(p) && existsSync(p + "/index.html")) { res.writeHead(308, { location: url.pathname + "/" }); return res.end(); }
    let status = 200;
    if (!existsSync(p)) { status = 404; p = path.join(dir, "404.html"); if (!existsSync(p)) { res.writeHead(404); return res.end(); } }
    const type = TYPES[path.extname(p)] ?? "application/octet-stream";
    let body = await readFile(p);
    const headers = { "content-type": type, "cache-control": "no-store" };
    if (/text|javascript|json|xml|svg/.test(type) && /\bbr\b/.test(req.headers["accept-encoding"] ?? "")) {
      const key = `${p}:${body.length}`;
      if (!brCache.has(key)) brCache.set(key, zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
      body = brCache.get(key);
      headers["content-encoding"] = "br";
    }
    res.writeHead(status, headers);
    res.end(body);
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

// ---------- 1. links ----------
async function* htmlFiles(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* htmlFiles(p);
    else if (e.name.endsWith(".html")) yield p;
  }
}
let broken = 0, links = 0;
for await (const file of htmlFiles(dist)) {
  const html = await readFile(file, "utf8");
  const refs = [...html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)].map(m => m[1]);
  for (const r of new Set(refs)) {
    links++;
    const p = path.join(dist, r);
    const ok = existsSync(p) && (statSync(p).isFile() || existsSync(path.join(p, "index.html")));
    if (!ok) { broken++; console.log(`broken link: ${path.relative(dist, file)} -> ${r}`); }
  }
}
console.log(`links: ${links} checked, ${broken} broken`);

// ---------- 2. verify every page ----------
const pages = JSON.parse(await readFile(path.join(root, "website/src/generated/pages.json"), "utf8"));
const { server, origin } = await serve(dist);
// The site's own pages: those with live figures go through verify.mjs like the explainers;
// those without load no runtime and get a lighter check (errors, requests, sideways scroll).
const SITE_PAGES = ["what-it-makes", "how-it-works", "usage", "examples", "404"];
const hasFigures = async slug => (await readFile(path.join(dist, slug === "home" ? "index.html" : slug === "404" ? "404.html" : `${slug}/index.html`), "utf8")).includes('class="demo');
const targets = [{ slug: "home", url: `${origin}/` }, ...SITE_PAGES.map(s => ({ slug: s, url: s === "404" ? `${origin}/no-such-page/` : `${origin}/${s}/`, site: true })), ...pages.map(p => ({ slug: p.slug, url: `${origin}/${p.slug}/` }))].filter(t => !only || only.includes(t.slug));
for (const t of targets) t.light = t.site && !(await hasFigures(t.slug));
const outRoot = path.join(os.tmpdir(), "safis-website-check");
const results = [];
// A page with no figures: load it at desktop and phone width and look for errors, requests
// that leave the site, and sideways scroll. Prints a verify-style last line.
async function lightCheck(t) {
  const errors = [], external = new Set();
  const b = await openBrowser({ viewport: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false } });
  try {
    b.on(m => {
      const p = m.params;
      if (m.method === "Runtime.exceptionThrown") errors.push(p.exceptionDetails.exception?.description?.split("\n")[0] ?? p.exceptionDetails.text);
      else if (m.method === "Runtime.consoleAPICalled" && p.type === "error") errors.push(p.args.map(a => a.value ?? a.description ?? "").join(" "));
      else if (m.method === "Network.requestWillBeSent" && !/^(data|blob|about):/.test(p.request.url) && !p.request.url.startsWith(origin + "/")) external.add(p.request.url);
    });
    const out = [];
    for (const [name, vp] of [["desktop", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }], ["phone", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }]]) {
      await b.setViewport(vp);
      await b.goto(t.url, 60000);
      const over = await b.evaluate("document.documentElement.scrollWidth - innerWidth");
      if (over > 1) errors.push(`${name}: ${over}px of sideways scroll`);
      out.push(name);
    }
    const lines = [...errors.map(e => `  ERROR ${e}`), ...[...external].map(u => `  ERROR loads ${u}`)];
    return { ...t, code: lines.length ? 1 : 0, out: `${lines.join("\n")}\n${lines.length ? "FAIL" : "PASS"} (no figures: checked errors, requests, and layout at ${out.join(" and ")})` };
  } finally { await b.close(); }
}
const verify = t => t.light ? lightCheck(t) : new Promise(resolve => {
  const child = spawn(process.execPath, [path.join(root, "skills/safis/scripts/verify.mjs"), t.url, "--out", path.join(outRoot, t.slug)], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", d => (out += d));
  child.stderr.on("data", d => (out += d));
  child.on("close", code => resolve({ ...t, code, out }));
});
const queue = targets.slice();
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  while (queue.length) {
    const r = await verify(queue.shift());
    results.push(r);
    const last = r.out.trim().split("\n").pop();
    const text = (r.out.match(/^Text: (.*)$/m) || [])[1] ?? "";
    console.log(`${r.slug}: ${last}${text ? ` | ${text}` : ""}`);
    if (!/^PASS/.test(last)) for (const l of r.out.split("\n").filter(l => /ERROR|error|console:|FAIL|loads /.test(l)).slice(0, 6)) console.log(`    ${l.trim()}`);
  }
}));
const failed = results.filter(r => !/^PASS/m.test(r.out.trim().split("\n").pop()));
console.log(`pages: ${results.length - failed.length} of ${results.length} pass (screenshots in ${outRoot})`);

// ---------- 3. old site against new ----------
if (flag("--compare")) {
  const old = await serve(path.join(root, "site"), { pretty: false });
  const SLOW_4G = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
  const b = await openBrowser({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } });
  await b.send("Network.setCacheDisabled", { cacheDisabled: true });
  await b.send("Network.emulateNetworkConditions", SLOW_4G);
  // Records when every figure on the page has been set up.
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const t = () => { const n = document.querySelectorAll("figure.demo").length; if (window.__explainer && n && window.__explainer.ids().length >= n) { window.__figuresReady = performance.now(); return; } requestAnimationFrame(t); }; requestAnimationFrame(t); })();` });
  let bytes = 0;
  b.on(m => { if (m.method === "Network.loadingFinished") bytes += m.params.encodedDataLength; });
  const measure = async url => {
    bytes = 0;
    await b.goto(url, 120000);
    await b.evaluate(`new Promise(r => { const t0 = performance.now(); (function poll() { if (window.__figuresReady || performance.now() - t0 > 60000) r(); else setTimeout(poll, 50); })(); })`);
    const m = await b.evaluate(`(() => { const nav = performance.getEntriesByType("navigation")[0]; const fcp = performance.getEntriesByName("first-contentful-paint")[0]; return { fcp: fcp ? fcp.startTime : null, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, ready: window.__figuresReady ?? null }; })()`);
    return { ...m, kb: bytes / 1024 };
  };
  const SAMPLE = ["", "derivative", "lock", "rocket-engine", "dns"];
  const rows = [];
  for (const s of SAMPLE) {
    const a = await measure(s ? `${old.origin}/${s}/index.html` : `${old.origin}/index.html`);
    const n = await measure(s ? `${origin}/${s}/` : `${origin}/`);
    rows.push({ page: s || "home", a, n });
  }
  await b.close();
  old.server.close();
  const f = v => (v == null ? "-" : `${(v / 1000).toFixed(2)} s`);
  console.log("\nSlow 4G, cold cache, phone (old site -> new site)");
  console.log("page            transferred            first paint          figures ready");
  for (const { page, a, n } of rows) console.log(`${page.padEnd(15)} ${`${a.kb.toFixed(0)} KB -> ${n.kb.toFixed(0)} KB`.padEnd(22)} ${`${f(a.fcp)} -> ${f(n.fcp)}`.padEnd(20)} ${f(a.ready)} -> ${f(n.ready)}`);
}

server.close();
process.exit(broken || failed.length ? 1 : 0);
