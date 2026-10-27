#!/usr/bin/env node
// Tests for the numerics in src/plot.js (window.Num) that run in Node, plus a
// smoke test that the canvas helpers register and draw without throwing.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
new Function(await readFile(path.join(root, "src/plot.js"), "utf8"))();
const N = window.Num;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// Formatting
eq("fmt 3 significant digits", N.fmt(3.14159), "3.14");
eq("fmt true minus sign", N.fmt(-2.5), "−2.5");
eq("fmt fixed", N.fmt(2, { fixed: 2 }), "2.00");
eq("fmt fixed trim", N.fmt(2.5, { fixed: 3, trim: true }), "2.5");
eq("fmt negative zero shows no sign", N.fmt(-0.0001, { fixed: 2 }), "0.00");
eq("fmt thousands", N.fmt(12500), "12 500");
eq("fmt four digits stay together", N.fmt(1500), "1500");
eq("fmt tiny is scientific", N.fmt(0.000123), "1.23×10⁻⁴");
eq("fmt huge is scientific", N.fmt(6.02e23), "6.02×10²³");
eq("fmt exact power of ten", N.fmt(1e-6), "10⁻⁶");
eq("fmt unit", N.fmt(9.81, { unit: "m/s²" }), "9.81 m/s²");
eq("fmt degree unit has no space", N.fmt(20, { unit: "°" }), "20°");
eq("fmt sign", N.fmt(3, { sign: true }), "+3");
eq("fmt NaN", N.fmt(NaN), "–");
eq("si milli", N.si(0.0042, "s"), "4.2 ms");
eq("si kilo", N.si(15300, "N"), "15.3 kN");
eq("si micro", N.si(2.2e-6, "F"), "2.2 µF");
eq("si rounds up a prefix", N.si(999999, "Hz"), "1 MHz");
eq("si plain", N.si(12, "m"), "12 m");
eq("piFmt π/2", N.piFmt(Math.PI / 2), "π/2");
eq("piFmt 3π/4", N.piFmt((3 * Math.PI) / 4), "3π/4");
eq("piFmt −2π", N.piFmt(-2 * Math.PI), "−2π");
eq("piFmt π", N.piFmt(Math.PI), "π");
eq("piFmt 0", N.piFmt(0), "0");
eq("piFmt other", N.piFmt(1.5), "1.5");
eq("decimals of 0.25", N.decimals(0.25), 2);
eq("decimals of 5e-7", N.decimals(5e-7), 7);
eq("niceStep", N.niceStep(10, 5), 2);
eq("ticks", JSON.stringify(N.ticks(-1, 1, 4)), JSON.stringify([-1, -0.5, 0, 0.5, 1]));
eq("ticks avoid float noise", JSON.stringify(N.ticks(0, 0.3, 3)), JSON.stringify([0, 0.1, 0.2, 0.3]));

// Sequences
eq("linspace", JSON.stringify(N.linspace(0, 1, 5)), JSON.stringify([0, 0.25, 0.5, 0.75, 1]));
eq("range one argument", JSON.stringify(N.range(4)), JSON.stringify([0, 1, 2, 3]));
eq("range step", JSON.stringify(N.range(0, 1, 0.25)), JSON.stringify([0, 0.25, 0.5, 0.75]));

// ODEs
{
  const decay = (t, y) => -y;
  let y = 1;
  for (let i = 0; i < 100; i++) y = N.rk4(decay, y, i * 0.01, 0.01);
  check("rk4 exponential decay", near(y, Math.exp(-1), 1e-9), `${y}`);
  const osc = (t, [x, v]) => [v, -x];
  let s = [1, 0];
  for (let i = 0; i < 6283; i++) s = N.rk4(osc, s, 0, 0.001);
  check("rk4 oscillator returns after one period", near(s[0], 1, 1e-6) && Math.abs(s[1]) < 1e-3, `${s}`);
  const a = N.advance(osc, [1, 0], 0, Math.PI);
  check("advance substeps a half period", near(a[0], -1, 1e-6), `${a}`);
  const r = N.ode(decay, 1, [0, 2], { steps: 200 });
  check("ode returns every step", r.t.length === 201 && near(r.y[200], Math.exp(-2), 1e-8));
  check("euler is first order", near(N.euler(decay, 1, 0, 0.1), 0.9));
}

// Roots and calculus
check("bisect √2", near(N.bisect(x => x * x - 2, 0, 2), Math.SQRT2, 1e-10));
check("bisect without a bracket is NaN", Number.isNaN(N.bisect(x => x * x + 1, -1, 1)));
check("newton √2", near(N.newton(x => x * x - 2, 1), Math.SQRT2, 1e-12));
check("solve brackets or starts Newton", near(N.solve(Math.cos, 0, 3), Math.PI / 2, 1e-10) && near(N.solve(Math.cos, 1), Math.PI / 2, 1e-10));
{
  const r = N.roots(Math.sin, 0.5, 10);
  check("roots of sin", r.length === 3 && near(r[0], Math.PI, 1e-9) && near(r[2], 3 * Math.PI, 1e-9), r.join(", "));
}
check("deriv sin at 0", near(N.deriv(Math.sin, 0), 1, 1e-8));
check("deriv2 of x³ at 2", near(N.deriv2(x => x ** 3, 2), 12, 1e-4));
check("integrate x² on [0, 3]", near(N.integrate(x => x * x, 0, 3), 9, 1e-12));
check("integrate sin on [0, π]", near(N.integrate(Math.sin, 0, Math.PI), 2, 1e-8));
check("interp", near(N.interp([0, 1, 3], [0, 10, 30], 2), 20) && N.interp([0, 1], [5, 6], -1) === 5 && N.interp([0, 1], [5, 6], 9) === 6);

// Random numbers and statistics
{
  const a = N.rng(42), b = N.rng(42);
  const xs = Array.from({ length: 5 }, a), ys = Array.from({ length: 5 }, b);
  check("rng is repeatable", JSON.stringify(xs) === JSON.stringify(ys));
  const r = N.rng(7), u = Array.from({ length: 20000 }, r);
  check("rng is uniform on [0, 1)", u.every(x => x >= 0 && x < 1) && near(N.mean(u), 0.5, 0.02), `${N.mean(u)}`);
  const gs = Array.from({ length: 20000 }, () => r.gauss(3, 2));
  check("gauss mean and spread", Math.abs(N.mean(gs) - 3) < 0.06 && Math.abs(N.std(gs) - 2) < 0.06, `${N.mean(gs)}, ${N.std(gs)}`);
  const ints = Array.from({ length: 1000 }, () => r.int(1, 6));
  check("int is inclusive", Math.min(...ints) === 1 && Math.max(...ints) === 6);
  check("shuffle keeps the items", JSON.stringify(r.shuffle([1, 2, 3, 4]).sort()) === "[1,2,3,4]");
}
check("variance and std", near(N.variance([1, 2, 3, 4]), 1.25) && near(N.std([2, 4, 4, 4, 5, 5, 7, 9]), 2));
check("sample variance", near(N.variance([1, 2, 3, 4], true), 5 / 3));
check("erf", near(N.erf(1), 0.8427007929, 2e-7) && near(N.erf(-1), -0.8427007929, 2e-7));
check("normalCdf", near(N.normalCdf(1.96), 0.975, 1e-4) && near(N.normalCdf(0), 0.5, 1e-9));
check("normalPdf peak", near(N.normalPdf(0), 1 / Math.sqrt(2 * Math.PI)));
{
  const h = N.histogram([0, 0.1, 0.5, 0.9, 1], { bins: 2, range: [0, 1] });
  check("histogram", JSON.stringify(h.counts) === "[2,3]" && h.edges.length === 3, JSON.stringify(h));
}

// Vectors, matrices, complex numbers
check("v2 rot", near(N.v2.rot([1, 0], Math.PI / 2)[1], 1) && Math.abs(N.v2.rot([1, 0], Math.PI / 2)[0]) < 1e-12);
check("v3 cross", JSON.stringify(N.v3.cross([1, 0, 0], [0, 1, 0])) === "[0,0,1]");
check("mat mul", JSON.stringify(N.mat.mul([[1, 2], [3, 4]], [[5, 6], [7, 8]])) === "[[19,22],[43,50]]");
check("mat mul vector", JSON.stringify(N.mat.mul([[1, 2], [3, 4]], [1, 1])) === "[3,7]");
check("det 2x2 and 3x3", N.mat.det([[1, 2], [3, 4]]) === -2 && N.mat.det([[2, 0, 1], [1, 3, 2], [1, 1, 1]]) === 0);
check("det 4x4", near(N.mat.det([[1, 2, 0, 0], [3, 4, 0, 0], [0, 0, 2, 0], [0, 0, 0, 5]]), -20));
{
  const A = [[4, 7], [2, 6]], I = N.mat.mul(A, N.mat.inv(A));
  check("inverse", near(I[0][0], 1) && Math.abs(I[0][1]) < 1e-12 && near(I[1][1], 1));
  check("singular inverse is null", N.mat.inv([[1, 2], [2, 4]]) === null);
  const e = N.mat.eigen2([[2, 0], [0, 3]]);
  check("eigen2 diagonal", e.values[0] === 3 && e.values[1] === 2 && e.vectors[0][1] === 1);
  const s = N.mat.eigen2([[2, 1], [1, 2]]);
  check("eigen2 symmetric", near(s.values[0], 3) && near(s.values[1], 1) && near(Math.abs(s.vectors[0][0]), Math.SQRT1_2));
  const r = N.mat.eigen2(N.mat.rotation(Math.PI / 2));
  check("eigen2 rotation is complex", r.complex && near(r.values[0].im, 1));
}
{
  const z = N.C.mul(N.C.of(1, 2), N.C.of(3, -1));
  check("complex mul", z.re === 5 && z.im === 5);
  const e = N.C.exp(N.C.of(0, Math.PI));
  check("Euler's identity", near(e.re, -1) && Math.abs(e.im) < 1e-12);
  check("complex fmt", N.C.fmt(N.C.of(1, -2)) === "1 − 2i");
}

// Neural-network pieces
{
  const p = N.softmax([1, 2, 3]);
  check("softmax sums to 1", near(N.sum(p), 1) && p[2] > p[1]);
  const cold = N.softmax([1, 2, 3], 0.1), hot = N.softmax([1, 2, 3], 10);
  check("temperature sharpens and flattens", cold[2] > 0.99 && hot[2] < 0.4);
  check("temperature 0 is argmax", JSON.stringify(N.softmax([1, 5, 2], 0)) === "[0,1,0]");
  check("softmax is stable for large logits", near(N.sum(N.softmax([1000, 1001])), 1));
  check("topK", JSON.stringify(N.topK([0.1, 0.5, 0.2, 0.2], 2)) === "[1,2]");
  check("sample", N.sample([0.2, 0.3, 0.5], 0.1) === 0 && N.sample([0.2, 0.3, 0.5], 0.45) === 1 && N.sample([0.2, 0.3, 0.5], 0.99) === 2);
  check("entropy of a fair coin is 1 bit", near(N.entropy([0.5, 0.5], 2), 1));
  check("sigmoid and gelu", near(N.sigmoid(0), 0.5) && near(N.gelu(0), 0) && N.gelu(3) > 2.99);
  check("logsumexp", near(N.logsumexp([0, 0]), Math.log(2)));
}

// Canvas helpers register and run against a recording g.
{
  const calls = [];
  const rec = name => (...args) => { calls.push(name); return name === "measure" ? String(args[0]).length * 7 : undefined; };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const g = { w: 640, h: 400, ctx };
  for (const k of ["line", "path", "circle", "rect", "arrow", "text", "measure", "field"]) g[k] = rec(k);
  g.clip = (box, fn) => fn(g);
  const util = { color: c => c, clamp: (x, a, b) => Math.min(b, Math.max(a, x)), lerp: (a, b, t) => a + (b - a) * t };
  check("one extension registered", window.__safisG.length === 1);
  window.__safisG[0](g, util);
  const P = g.graph({ x: [-2 * Math.PI, 2 * Math.PI], y: [-1.5, 1.5], xTicks: "pi" });
  const lines = P.fn(Math.tan, { color: "red" });
  check("tan breaks at its asymptotes", lines.length >= 4, `${lines.length} pieces`);
  check("sin is one piece", P.fn(Math.sin).length === 1);
  check("1/x breaks once", g.graph({ x: [-2, 2], y: [-3, 3] }).fn(x => 1 / x).length === 2);
  check("sqrt draws only where defined", P.fn(Math.sqrt).length === 1);
  const inv = P.inv(P([1, 0.5]));
  check("graph inverse mapping", near(inv[0], 1) && near(inv[1], 0.5));
  const E = g.graph({ x: [-1, 1], y: [-1, 1], equal: true });
  check("equal aspect", near(E.sx, E.sy));
  const Lg = g.graph({ x: [1, 1000], y: [0.1, 100], xScale: "log", yScale: "log" });
  const q = Lg.inv(Lg([10, 1]));
  check("log mapping", near(q[0], 10) && near(q[1], 1));
  check("riemann midpoint", near(P.riemann(x => x * x, 0, 1, 1000), 1 / 3, 1e-6));
  check("area returns the integral", near(P.area(Math.sin, 0, Math.PI), 2, 1e-8));
  P.contour((x, y) => x * x + y * y, 4);
  P.streamlines((x, y) => [-y, x], [[0.5, 0]]);
  P.vectorField((x, y) => [-y, x]);
  g.spring([0, 0], [100, 0]);
  g.atom([10, 10], "O");
  g.bond([0, 0], [10, 0], { order: 2 });
  g.fieldLines([{ p: [100, 100], q: 1 }, { p: [300, 100], q: -1 }]);
  const hm = g.heatmap([[0.1, 0.9], [0.5, 0.5]], { rowLabels: ["a", "b"], colLabels: ["c", "d"] });
  check("heatmap hit", JSON.stringify(hm.hit([hm.box[0] + 1, hm.box[1] + 1])) === '{"i":0,"j":0}');
  const nw = g.network([2, 3, 1], { weights: [[[1, -1], [0.5, 0.2], [0, 1]], [[1, 1, -1]]] });
  check("network hit", JSON.stringify(nw.hit(nw.nodes[1][2].p)) === '{"layer":1,"i":2}');
  const tk = g.tokens(["The", " cat", " sat"], { highlight: 1 });
  check("tokens hit", tk.hit([tk.rects[2].x + 2, tk.rects[2].y + 2]) === 2);
  const br = g.bars([1, 3, 2], { labels: ["a", "b", "c"], highlight: 1 });
  check("bars hit", br.hit([br.bars[1].x + 1, br.bars[1].y + 1]) === 1);
  g.reaction({ energies: [0, 1, -0.4], catalyzed: 0.6, show: { ea: true, dh: true } });
  g.levels([{ E: 0, label: "n = 1" }, { E: 1, label: "n = 2" }], { transitions: [{ from: 0, to: 1 }] });
  check("helpers drew", calls.length > 500, `${calls.length} calls`);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
