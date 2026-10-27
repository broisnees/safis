#!/usr/bin/env node
// Scores explainer pages for the eval suite. Runs verify.mjs on each page and
// adds the counts the graders need: figures, words per figure, 3D views,
// references, and article furniture.
//
// Usage:
//   node grade.mjs <page.html>...                     print a table, one row per page
//   node grade.mjs --run <run-dir> --case <case-dir>  grade one eval run
//
// With --run, the page is the explainer under <run-dir>/outputs. The result goes
// to <run-dir>/auto-grading.json: every grader this script can check, graded with
// evidence, and the rest listed under "pending" for the LLM grader to finish.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const VERIFY = path.join(here, "../scripts/verify.mjs");

// Graders this script decides, keyed by file name without the number:
// graders/03-figure-count-in-depth.md -> "figure-count-in-depth".
const CHECKS = {
  "checker-passes": m => [m.verify === "PASS", `verify.mjs: ${m.verifyLine}`],
  "density-in-range": m => [m.perFigure >= 80 && m.perFigure <= 180, `${m.words} words of main text over ${m.figures} figures: ${m.perFigure} per figure`],
  "figure-count-in-depth": m => [m.figures >= 22, `${m.figures} main figures`],
  "figure-count-short": m => [m.figures >= 8 && m.figures <= 12 && m.words <= 2000, `${m.figures} main figures, ${m.words} words of main text`],
  "furniture": m => [!!(m.abstract && m.predictions && m.callouts && m.deeper), `abstract ${m.abstract}, predictions ${m.predictions}, callouts ${m.callouts}, going-deeper sections ${m.deeper}`],
  "cites-sources": m => [m.references >= 5, `${m.references} entries in the references list`],
  "has-3d-figure": m => [m.figures3d >= 1, `${m.figures3d} figure${m.figures3d === 1 ? "" : "s"} with a 3D view the reader can turn`],
};

function verify(page, out) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [VERIFY, page, "--out", out], { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    p.stdout.on("data", d => { log += d; });
    p.stderr.on("data", d => { log += d; });
    p.on("close", code => resolve({ code, log }));
  });
}

async function measure(page) {
  const out = path.join(os.tmpdir(), "explainer-grade", path.basename(path.dirname(path.resolve(page))));
  const { code, log } = await verify(page, out);
  const reportFile = path.join(out, "report.json");
  const report = existsSync(reportFile) ? JSON.parse(await readFile(reportFile, "utf8")) : null;
  const html = await readFile(page, "utf8");
  const a = (html.match(/<!-- explainer:article:start -->([\s\S]*?)<!-- explainer:article:end -->/) || [])[1] ?? "";
  const count = re => (a.match(re) || []).length;
  const refs = (a.match(/<ol class="references">([\s\S]*?)<\/ol>/) || [])[1] ?? "";
  const text = report?.text ?? {};
  return {
    page,
    verify: code === 0 ? "PASS" : code === 1 ? "FAIL" : "ERROR",
    verifyLine: log.trim().split("\n").filter(l => /^(PASS|FAIL)|couldn't|timed out/.test(l)).pop() ?? `exit ${code}`,
    words: text.words ?? 0,
    figures: text.figures ?? 0,
    perFigure: text.perFigure ?? null,
    figures3d: (report?.desktop.demos ?? []).filter(d => /\borbit\b/.test(d.summary)).length,
    references: (refs.match(/<li\b/g) || []).length,
    abstract: count(/class="abstract"/g),
    predictions: count(/class="quiz"/g),
    callouts: count(/class="callout\b/g),
    deeper: count(/<details class="deeper"/g),
  };
}

async function findPage(dir) {
  if (!existsSync(dir)) return null;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile() || !e.name.endsWith(".html")) continue;
    const file = path.join(e.parentPath ?? e.path, e.name);
    if ((await readFile(file, "utf8")).includes("explainer:article:start")) return file;
  }
  return null;
}

async function graders(caseDir) {
  const dir = path.join(caseDir, "graders");
  const files = (await readdir(dir)).filter(f => f.endsWith(".md")).sort();
  return Promise.all(files.map(async f => ({
    slug: f.replace(/^\d+-/, "").replace(/\.md$/, ""),
    text: (await readFile(path.join(dir, f), "utf8")).replace(/^---[\s\S]*?---\s*/, "").trim(),
  })));
}

const argv = process.argv.slice(2);
const opt = { run: null, case: null, pages: [] };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--run") opt.run = argv[++i];
  else if (argv[i] === "--case") opt.case = argv[++i];
  else opt.pages.push(argv[i]);
}

if (opt.run) {
  if (!opt.case) { console.error("usage: node grade.mjs --run <run-dir> --case <case-dir>"); process.exit(2); }
  const page = await findPage(path.join(opt.run, "outputs"));
  const m = page ? await measure(page) : null;
  const result = { page, metrics: m, expectations: [], pending: [] };
  for (const g of await graders(opt.case)) {
    if (!CHECKS[g.slug]) result.pending.push(g.text);
    else if (!m) result.expectations.push({ text: g.text, passed: false, evidence: "No explainer page in the run's outputs." });
    else { const [passed, evidence] = CHECKS[g.slug](m); result.expectations.push({ text: g.text, passed, evidence }); }
  }
  await writeFile(path.join(opt.run, "auto-grading.json"), JSON.stringify(result, null, 2));
  const passed = result.expectations.filter(e => e.passed).length;
  console.log(`${path.basename(opt.case)}: ${passed}/${result.expectations.length} checked graders pass, ${result.pending.length} left for the LLM grader`);
} else {
  if (!opt.pages.length) { console.error("usage: node grade.mjs <page.html>...  |  --run <run-dir> --case <case-dir>"); process.exit(2); }
  const row = c => c.map((v, i) => String(v).padStart(i ? 7 : 22)).join("");
  console.log(row(["page", "check", "figs", "words", "w/fig", "3D", "refs", "abst", "pred", "call", "deep"]));
  for (const p of opt.pages) {
    const m = await measure(p);
    console.log(row([path.basename(path.dirname(path.resolve(p))), m.verify, m.figures, m.words, m.perFigure ?? "-", m.figures3d, m.references, m.abstract, m.predictions, m.callouts, m.deeper]));
  }
}
