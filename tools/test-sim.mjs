#!/usr/bin/env node
// Tests for the simulators in src/sim.js (window.Sim) that run in Node: conservation
// laws, known periods and speeds, determinism with seeds, frame-rate independence,
// and that the tiny neural network, language model, and attention head compute what
// they claim.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
new Function(await readFile(path.join(root, "src/engine3d.js"), "utf8"))();
new Function(await readFile(path.join(root, "src/sim.js"), "utf8"))();
const S = window.Sim, E3 = window.E3;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
const run = (step, w, seconds, fps = 60) => { for (let i = 0; i < Math.round(seconds * fps); i++) step(w, 1 / fps); };
const clone = o => structuredClone(o);

// ---------- particles ----------
{
  // Spring period: one mass on a spring to a pinned anchor, no gravity. T = 2π √(m / k).
  const w = S.particles.create({ gravity: [0, 0] });
  const a = S.particles.add(w, { x: 0, y: 0, pinned: true }), b = S.particles.add(w, { x: 1.2, y: 0, m: 2 });
  S.particles.spring(w, a, b, { k: 50, damping: 0, rest: 1 });
  const crossings = [];
  let prev = w.p[b].x - 1;
  for (let i = 0; i < 6000; i++) {
    S.particles.step(w, 1 / 600);
    const x = w.p[b].x - 1;
    if (prev < 0 && x >= 0) crossings.push(w.t);
    prev = x;
  }
  const T = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1), want = 2 * Math.PI * Math.sqrt(2 / 50);
  check("spring period matches 2π√(m/k)", rel(T, want) < 0.005, `${T.toFixed(4)} s vs ${want.toFixed(4)} s`);
}
{
  // Energy stays put for an undamped spring chain under gravity (symplectic Euler drifts little).
  const w = S.particles.create({ gravity: [0, -9.81] });
  const ids = S.particles.rope(w, [0, 0], [1, 0], 6, { spring: 400, damping: 0 });
  const e0 = S.particles.energy(w).total;
  let worst = 0;
  for (let i = 0; i < 600; i++) { S.particles.step(w, 1 / 60); worst = Math.max(worst, Math.abs(S.particles.energy(w).total - e0)); }
  const scale = Math.abs(S.particles.energy(w).potential) + 1;
  check("spring rope conserves energy within 1%", worst / scale < 0.01, `drift ${(worst / scale * 100).toFixed(3)}%`);
  check("rope has 6 particles, first pinned", ids.length === 6 && w.p[ids[0]].im === 0);
}
{
  // Rods keep their length.
  const w = S.particles.create({ drag: 1.5 });
  const ids = S.particles.rope(w, [0, 0], [2, 0], 11);
  run(S.particles.step, w, 10);
  let worst = 0;
  for (const r of w.rods) { const A = w.p[r.a], B = w.p[r.b]; worst = Math.max(worst, Math.abs(Math.hypot(B.x - A.x, B.y - A.y) - r.rest) / r.rest); }
  check("rods hold their length within 1%", worst < 0.01, `${(worst * 100).toFixed(3)}%`);
  check("a hanging rope settles straight down", w.p[ids[10]].y < -1.9, `end at y = ${w.p[ids[10]].y.toFixed(2)}`);
}
{
  // Frame-rate independence: the same 2 s at 30 fps and at 144 fps lands in the same place.
  const make = () => { const w = S.particles.create(); S.particles.rope(w, [0, 0], [1, 0], 8, { spring: 300, damping: 0.3 }); return w; };
  const a = make(), b = make();
  run(S.particles.step, a, 2, 30);
  run(S.particles.step, b, 2, 144);
  const d = Math.hypot(a.p[7].x - b.p[7].x, a.p[7].y - b.p[7].y);
  check("particles: same result at 30 and 144 fps", d < 1e-9 || Math.abs(a.t - b.t) < 1e-9 && d < 1e-6, `difference ${d.toExponential(2)} m`);
}
{
  // Snapshot and restore: a structuredClone of the state continues identically.
  const w = S.particles.create();
  S.particles.cloth(w, { nx: 6, ny: 5 });
  run(S.particles.step, w, 0.5);
  const copy = clone(w);
  run(S.particles.step, w, 0.5); run(S.particles.step, copy, 0.5);
  check("particles: snapshot continues identically", w.p.every((p, i) => p.x === copy.p[i].x && p.y === copy.p[i].y));
}
{
  // Stiff springs can't blow up: a cloth of very stiff springs stays finite.
  const w = S.particles.create();
  S.particles.cloth(w, { nx: 18, ny: 13, width: 1.8, height: 1.3, springs: 1200, pin: "top" });
  run(S.particles.step, w, 2);
  check("stiff spring cloth stays finite", Number.isFinite(S.particles.energy(w).total) && w.p.every(p => Math.abs(p.y) < 5));
  const r = S.particles.create();
  S.particles.cloth(r, { nx: 18, ny: 13, width: 1.8, height: 1.3, pin: "top" });
  run(S.particles.step, r, 2);
  let worst = 0;
  for (const rod of r.rods) { const A = r.p[rod.a], B = r.p[rod.b]; worst = Math.max(worst, Math.abs(Math.hypot(B.x - A.x, B.y - A.y) - rod.rest) / rod.rest); }
  check("rod cloth hangs without stretching more than 5%", worst < 0.05, `${(worst * 100).toFixed(2)}%`);
}
{
  // Mouse spring pulls a particle toward the target.
  const w = S.particles.create({ gravity: [0, 0] });
  S.particles.add(w, { x: 0, y: 0 });
  check("grab finds the particle", S.particles.grab(w, [0.05, 0], 0.2) === 0);
  S.particles.drag(w, [1, 0]);
  run(S.particles.step, w, 2);
  check("drag pulls it to the target", Math.abs(w.p[0].x - 1) < 0.05, `x = ${w.p[0].x.toFixed(3)}`);
}

// ---------- rigid bodies ----------
{
  // A box dropped on the ground comes to rest on it.
  const w = S.rigid.create();
  S.rigid.ground(w, 0);
  const b = S.rigid.box(w, 0, 2, 1, 1);
  run(S.rigid.step, w, 3);
  const B = w.bodies[b];
  check("box comes to rest on the ground", Math.abs(B.y - 0.5) < 0.02 && Math.hypot(B.vx, B.vy) < 0.02, `y = ${B.y.toFixed(3)}, speed ${Math.hypot(B.vx, B.vy).toFixed(3)}`);
}
{
  // A stack of 8 boxes stands for 5 s.
  const w = S.rigid.create();
  S.rigid.ground(w, 0);
  const ids = Array.from({ length: 8 }, (_, i) => S.rigid.box(w, 0, 0.5 + i * 1.0, 1, 1));
  run(S.rigid.step, w, 5);
  const drift = Math.max(...ids.map(i => Math.abs(w.bodies[i].x))), top = w.bodies[ids[7]];
  check("a stack of 8 boxes stands", drift < 0.05 && Math.abs(top.y - 7.5) < 0.1 && Math.abs(top.a) < 0.05, `drift ${drift.toFixed(3)}, top at ${top.y.toFixed(3)}, tilt ${top.a.toFixed(3)}`);
}
{
  // A pyramid of 15 boxes stays up.
  const w = S.rigid.create();
  S.rigid.ground(w, 0);
  const ids = [];
  for (let row = 0; row < 5; row++) for (let k = 0; k < 5 - row; k++) ids.push(S.rigid.box(w, (k - (4 - row) / 2) * 1.05, 0.5 + row, 1, 1));
  run(S.rigid.step, w, 5);
  const top = w.bodies[ids[ids.length - 1]];
  check("a pyramid of 15 boxes stands", Math.abs(top.y - 4.5) < 0.15 && Math.abs(top.x) < 0.1, `top at (${top.x.toFixed(3)}, ${top.y.toFixed(3)})`);
}
{
  // Circles: a ball rolls down a ramp; circle-circle bounce keeps momentum.
  const w = S.rigid.create({ gravity: [0, 0], restitution: 1 });
  const a = S.rigid.circle(w, -1, 0, 0.25, { vx: 2, restitution: 1 }), b = S.rigid.circle(w, 1, 0, 0.25, { restitution: 1 });
  const p0 = S.rigid.momentum(w).linear[0];
  run(S.rigid.step, w, 2);
  check("head-on elastic collision swaps velocities", Math.abs(w.bodies[a].vx) < 0.1 && Math.abs(w.bodies[b].vx - 2) < 0.1, `${w.bodies[a].vx.toFixed(3)}, ${w.bodies[b].vx.toFixed(3)}`);
  check("collision conserves momentum", rel(S.rigid.momentum(w).linear[0], p0) < 1e-6);
}
{
  const w = S.rigid.create();
  S.rigid.ground(w, 0);
  const c = S.rigid.circle(w, 0, 0.3, 0.3), p = S.rigid.poly(w, [[0, 0], [1, 0], [0.5, 0.8]], { x: 2, y: 1 });
  run(S.rigid.step, w, 3);
  check("a circle rests on the ground", Math.abs(w.bodies[c].y - 0.3) < 0.02, `y = ${w.bodies[c].y.toFixed(3)}`);
  check("a triangle settles on its base", Math.abs(w.bodies[p].a % (2 * Math.PI)) < 0.05 || Math.abs(Math.abs(w.bodies[p].a) - 2 * Math.PI) < 0.05, `angle ${w.bodies[p].a.toFixed(3)}`);
  check("hit-test finds the triangle", S.rigid.hit(w, [w.bodies[p].x, w.bodies[p].y]) === p);
}
{
  const make = () => { const w = S.rigid.create(); S.rigid.ground(w, 0); for (let i = 0; i < 5; i++) S.rigid.box(w, i * 0.3, 1 + i * 1.2, 1, 1, { angle: i * 0.3 }); return w; };
  const a = make(), b = make();
  run(S.rigid.step, a, 3, 30); run(S.rigid.step, b, 3, 120);
  check("rigid: same result at 30 and 120 fps", a.bodies.every((x, i) => x.x === b.bodies[i].x && x.y === b.bodies[i].y));
}

// ---------- fields ----------
{
  // 1D wave: a pulse sent right travels c·t (the scheme is exact at Courant number 1).
  const G = S.wave.create({ nx: 400, c: 2, dx: 0.01, boundary: "absorbing" });
  S.wave.pulse(G, 100, 0, { amp: 1, sigma: 6, moving: 1 });
  run(S.wave.step, G, 0.5);
  let peak = 0, pi = 0;
  G.u.forEach((v, i) => { if (v > peak) { peak = v; pi = i; } });
  const want = 100 + (2 * G.t) / 0.01;
  check("wave pulse travels at c", Math.abs(pi - want) <= 2, `peak at cell ${pi}, expected ${want.toFixed(1)}`);
  check("wave pulse keeps its height", peak > 0.97, `height ${peak.toFixed(3)}`);
}
{
  // 1D wave between fixed ends conserves energy without damping.
  const G = S.wave.create({ nx: 200, c: 1, dx: 0.01, boundary: "fixed", cfl: 0.9 });
  S.wave.pulse(G, 100, 0, { amp: 1, sigma: 8 });
  S.wave.step(G, 0.05);
  const e0 = S.wave.energy(G);
  run(S.wave.step, G, 3);
  check("fixed-end wave keeps its energy within 2%", rel(S.wave.energy(G), e0) < 0.02, `${(rel(S.wave.energy(G), e0) * 100).toFixed(2)}%`);
}
{
  // 2D wave: two sources, interference keeps the field bounded and symmetric.
  const G = S.wave.create({ nx: 81, ny: 61, c: 1, dx: 0.02, boundary: "absorbing" });
  S.wave.source(G, 30, 30, { amp: 1, freq: 2 });
  S.wave.source(G, 50, 30, { amp: 1, freq: 2 });
  run(S.wave.step, G, 2);
  let asym = 0, max = 0;
  for (let j = 0; j < 61; j++) for (let i = 0; i < 81; i++) { const v = G.u[j * 81 + i], m = G.u[j * 81 + (80 - i)]; asym = Math.max(asym, Math.abs(v - m)); max = Math.max(max, Math.abs(v)); }
  check("2D two-source pattern is mirror symmetric", asym < 1e-9 * Math.max(1, max), `asymmetry ${asym.toExponential(2)}`);
  check("2D field stays bounded", max < 5, `max ${max.toFixed(3)}`);
}
{
  // Heat: total heat conserved with insulated edges; it spreads.
  const G = S.heat.create({ nx: 60, ny: 40, D: 2e-3, dx: 0.01 });
  for (let j = 15; j < 25; j++) for (let i = 25; i < 35; i++) G.u[j * 60 + i] = 1;
  const q0 = S.heat.total(G);
  run(S.heat.step, G, 1);
  const peak = Math.max(...G.u);
  check("heat: insulated edges conserve heat", rel(S.heat.total(G), q0) < 1e-9, `${S.heat.total(G)} vs ${q0}`);
  check("heat spreads out (peak falls)", peak < 0.99 && peak > 0, `peak ${peak.toFixed(3)}`);
}
{
  // Gray-Scott makes a pattern: v spreads from the seeds.
  const G = S.grayScott.create({ nx: 64, ny: 64, preset: "coral", seed: 3 });
  const start = G.v.reduce((s, v) => s + (v > 0.1), 0);
  run(S.grayScott.step, G, 3);
  const after = G.v.reduce((s, v) => s + (v > 0.1), 0);
  check("Gray-Scott pattern grows from its seeds", after > start * 1.5, `${start} → ${after} active cells`);
  check("Gray-Scott values stay in range", G.u.every(v => v >= -0.01 && v <= 1.01) && G.v.every(v => v >= -0.01 && v <= 1.01));
}
{
  // Advection moves a blob by v·t.
  const G = { nx: 64, ny: 1, u: new Float64Array(64) };
  G.u[10] = 1;
  for (let i = 0; i < 20; i++) S.advect(G, () => [1, 0], 1);
  let pi = 0;
  G.u.forEach((v, i) => { if (v > G.u[pi]) pi = i; });
  check("advection carries the blob downstream", pi === 30, `peak at ${pi}`);
}

// ---------- N-body ----------
{
  const w = S.nbody.create({ bodies: "figure8" });
  const e0 = S.nbody.energy(w).total, p0 = S.nbody.momentum(w);
  run(S.nbody.step, w, 6.3259, 60); // one period of the figure eight
  const e1 = S.nbody.energy(w).total, p1 = S.nbody.momentum(w);
  check("figure eight: energy conserved (leapfrog)", rel(e1, e0) < 1e-5, `${(rel(e1, e0) * 100).toExponential(2)}%`);
  check("figure eight: momentum stays zero", Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1e-9);
  check("figure eight returns after one period", Math.hypot(w.b[0].x + 0.97000436, w.b[0].y - 0.24308753) < 0.02, `off by ${Math.hypot(w.b[0].x + 0.97000436, w.b[0].y - 0.24308753).toFixed(4)}`);
}
{
  const w = S.nbody.create({ bodies: "solar" });
  run(S.nbody.step, w, 2 * Math.PI, 60); // the inner planet's period at r = 1
  check("inner planet completes a circular orbit", Math.hypot(w.b[1].x - 1, w.b[1].y) < 0.02, `off by ${Math.hypot(w.b[1].x - 1, w.b[1].y).toFixed(4)}`);
}

// ---------- randomness ----------
{
  const w = S.walkers.create({ n: 4000, D: 0.5, seed: 7 });
  run(S.walkers.step, w, 2);
  const want = 2 * 2 * 0.5 * w.t;
  check("random walk: mean squared displacement ≈ 4Dt", rel(S.walkers.msd(w), want) < 0.05, `${S.walkers.msd(w).toFixed(3)} vs ${want.toFixed(3)}`);
  const a = S.walkers.create({ n: 10, seed: 3 }), b = S.walkers.create({ n: 10, seed: 3 });
  run(S.walkers.step, a, 1); run(S.walkers.step, b, 1);
  check("random walk is deterministic with a seed", a.x.every((v, i) => v === b.x[i]));
}
{
  const st = { rng: 11 };
  const est = S.mc.pi(st, 200000);
  check("Monte Carlo π within 1%", rel(est, Math.PI) < 0.01, est.toFixed(4));
}
{
  const cold = S.ising.create({ n: 32, T: 1.0, init: "up", seed: 2 }), hot = S.ising.create({ n: 32, T: 5, seed: 2 });
  for (let i = 0; i < 200; i++) { S.ising.sweep(cold); S.ising.sweep(hot); }
  check("Ising: cold lattice stays magnetized", Math.abs(S.ising.magnetization(cold)) > 0.9, S.ising.magnetization(cold).toFixed(3));
  check("Ising: hot lattice is disordered", Math.abs(S.ising.magnetization(hot)) < 0.15, S.ising.magnetization(hot).toFixed(3));
  check("Ising: ground-state energy is −2 per spin", Math.abs(S.ising.energy(S.ising.create({ n: 16, init: "up" })) + 2) < 1e-12);
}

// ---------- ODE systems ----------
{
  // Small-angle pendulum: period 2π√(L/g). Wide swing (90°): about 18% longer.
  const period = th0 => {
    const st = S.ode.create("pendulum", { L: 1, g: 9.81 }, [th0, 0]);
    const ts = [];
    let prev = st.y[1];
    for (let i = 0; i < 2400 && ts.length < 3; i++) { S.ode.step(st, 1 / 240); if (prev > 0 && st.y[1] <= 0) ts.push(st.t); prev = st.y[1]; }
    return ts[2] - ts[1];
  };
  const T0 = 2 * Math.PI * Math.sqrt(1 / 9.81);
  check("pendulum: small swings keep 2π√(L/g)", rel(period(0.05), T0) < 0.003, `${period(0.05).toFixed(4)} vs ${T0.toFixed(4)}`);
  check("pendulum: a 90° swing is 18% slower", Math.abs(period(Math.PI / 2) / T0 - 1.1803) < 0.01, `ratio ${(period(Math.PI / 2) / T0).toFixed(4)}`);
}
{
  const st = S.ode.create("doublePendulum", {}, [2, 2.5, 0, 0]);
  const e0 = S.ode.energy(st);
  run(S.ode.step, st, 10);
  check("double pendulum conserves energy (RK4, small step)", rel(S.ode.energy(st), e0) < 1e-4, `${(rel(S.ode.energy(st), e0) * 100).toExponential(2)}%`);
  const a = S.ode.create("doublePendulum", {}, [2, 2.5, 0, 0]), b = S.ode.create("doublePendulum", {}, [2 + 1e-6, 2.5, 0, 0]);
  run(S.ode.step, a, 15); run(S.ode.step, b, 15);
  const d = Math.hypot(...S.ode.bobs(a)[1].map((v, i) => v - S.ode.bobs(b)[1][i]));
  check("double pendulum: a millionth of a radian grows to a different path", d > 0.1, `bobs ${d.toFixed(3)} m apart after 15 s`);
}
{
  const r = S.ode.run("sir", { beta: 0.3, gamma: 0.1 }, [0.999, 0.001, 0], 160, { h: 0.1 });
  const last = r.y[r.y.length - 1];
  check("SIR: S + I + R stays 1", Math.abs(last[0] + last[1] + last[2] - 1) < 1e-9);
  // Final size equation for R0 = 3: s∞ = exp(-R0 (1 - s∞)) gives s∞ ≈ 0.0595.
  check("SIR: final susceptible fraction matches the final-size equation", Math.abs(last[0] - 0.0595) < 0.005, last[0].toFixed(4));
  const L = S.ode.run("lorenz", {}, [1, 1, 1], 20, { h: 0.005, every: 10 });
  check("Lorenz stays on its attractor (bounded)", L.y.every(([x, y, z]) => Math.abs(x) < 30 && Math.abs(y) < 40 && z > -1 && z < 60));
}

// ---------- neural networks ----------
{
  const { X, Y } = S.data.xor({ n: 40, seed: 2 });
  const net = S.nn.mlp({ sizes: [2, 8, 2], act: "tanh", seed: 4 });
  const l0 = S.nn.loss(net, X, Y);
  for (let i = 0; i < 600; i++) S.nn.train(net, X, Y, { lr: 0.03, batch: 32 });
  check("MLP learns XOR", S.nn.accuracy(net, X, Y) > 0.97, `accuracy ${(S.nn.accuracy(net, X, Y) * 100).toFixed(1)}%, loss ${l0.toFixed(3)} → ${S.nn.loss(net, X, Y).toFixed(3)}`);
}
{
  const { X, Y } = S.data.spirals({ n: 100, noise: 0.03, seed: 1 });
  const net = S.nn.mlp({ sizes: [2, 16, 16, 2], act: "tanh", seed: 1 });
  const t0 = performance.now();
  for (let i = 0; i < 3000; i++) S.nn.train(net, X, Y, { lr: 0.01, batch: 32 });
  const ms = (performance.now() - t0) / 3000;
  check("MLP 2-16-16-2 separates two spirals", S.nn.accuracy(net, X, Y) > 0.9, `accuracy ${(S.nn.accuracy(net, X, Y) * 100).toFixed(1)}%`);
  check("a training step takes well under a frame", ms < 1, `${ms.toFixed(3)} ms per batch of 32`);
}
{
  // Gradient check on a tiny net: the analytic step matches a finite difference.
  const net = S.nn.mlp({ sizes: [2, 3, 2], seed: 9 }), X = [[0.3, -0.7]], Y = [1];
  const copy = structuredClone(net), lr = 1e-3;
  const L0 = S.nn.loss(net, X, Y);
  S.nn.train(copy, X, Y, { lr, batch: 1, opt: "sgd" });
  const k = 1, eps = 1e-6, plus = structuredClone(net);
  plus.layers[0].W[k] += eps;
  const numeric = (S.nn.loss(plus, X, Y) - L0) / eps, analytic = (net.layers[0].W[k] - copy.layers[0].W[k]) / lr;
  check("backprop gradient matches a finite difference", rel(analytic, numeric) < 1e-3, `${analytic.toFixed(6)} vs ${numeric.toFixed(6)}`);
}
{
  const a = S.nn.mlp({ seed: 5 }), b = S.nn.mlp({ seed: 5 }), { X, Y } = S.data.moons({ seed: 5 });
  for (let i = 0; i < 50; i++) { S.nn.train(a, X, Y); S.nn.train(b, X, Y); }
  check("training is deterministic with a seed", a.layers[1].W.every((v, i) => v === b.layers[1].W[i]));
  const g = S.nn.grid(a, [-1, 1], [-1, 1], 8, 6);
  check("decision grid is probabilities", g.length === 48 && g.every(v => v >= 0 && v <= 1));
}

// ---------- language model and attention ----------
{
  const text = "the cat sat on the mat. the cat ate the rat. the rat sat on the cat.";
  const m = S.lm.counts(text, { level: "word" });
  const p = S.lm.next(m, "the");
  check("bigram: next-word probabilities sum to 1", Math.abs(p.reduce((s, v) => s + v, 0) - 1) < 1e-12);
  check("bigram: after 'the', 'cat' is likeliest", m.vocab[p.indexOf(Math.max(...p))] === "cat");
  const st1 = { rng: 4 }, st2 = { rng: 4 };
  check("bigram sampling is deterministic with a seed", S.lm.sample(m, st1, "the", 12) === S.lm.sample(m, st2, "the", 12));
  const cold = S.lm.next(m, "the", { T: 0.2 }), hot = S.lm.next(m, "the", { T: 5 });
  check("temperature sharpens and flattens", Math.max(...cold) > Math.max(...p) && Math.max(...hot) < Math.max(...p));
  const L = S.lm.learner(text, { level: "word", seed: 2 });
  const before = S.lm.crossEntropy(L, text);
  for (let i = 0; i < 400; i++) S.lm.train(L, { lr: 2, batch: 64 });
  const after = S.lm.crossEntropy(L, text), best = S.lm.crossEntropy(m, text);
  check("learned bigram approaches the counted one", after < before && after - best < 0.1, `${before.toFixed(3)} → ${after.toFixed(3)} nats (counts: ${best.toFixed(3)})`);
}
{
  const W = S.attention.init({ d: 6, dk: 3, seed: 3 }), X = S.attention.positions(5, 6);
  const r = S.attention.head(X, W);
  check("attention weights: each row sums to 1", r.weights.every(row => Math.abs(row.reduce((s, v) => s + v, 0) - 1) < 1e-12));
  const c = S.attention.head(X, W, { causal: true });
  check("causal attention ignores later tokens", c.weights.every((row, i) => row.every((v, j) => j <= i || v < 1e-12)));
  check("first token attends only to itself when causal", Math.abs(c.weights[0][0] - 1) < 1e-12);
  // The output is the weighted mix of value rows.
  const mix = r.V[0].map((_, k) => r.weights[2].reduce((s, w, j) => s + w * r.V[j][k], 0));
  check("attention output = weights · V", mix.every((v, k) => Math.abs(v - r.out[2][k]) < 1e-12));
}

// ---------- 3D builders ----------
{
  const flat = E3.mesh.surface(() => 0.5, { n: 4, doubleSided: false });
  let up = true;
  for (let i = 1; i < flat.normals.length; i += 3) up &&= Math.abs(flat.normals[i] - 1) < 1e-6;
  check("surface: a flat height field faces up", up && flat.indices.length === 4 * 4 * 2 * 3);
  const both = E3.mesh.surface(() => 0.5, { n: 4 });
  check("surface: double-sided has both faces", both.indices.length === 2 * flat.indices.length);
  const f = (x, z) => x * x - z * z;
  const one = E3.mesh.surface(f, { n: 20, doubleSided: false }), bands = E3.mesh.surfaceBands(f, { n: 20, bands: 6, doubleSided: false });
  const areaOf = m => { let A = 0; for (let t = 0; t < m.indices.length; t += 3) { const q = [0, 1, 2].map(k => [m.positions[m.indices[t + k] * 3], m.positions[m.indices[t + k] * 3 + 1], m.positions[m.indices[t + k] * 3 + 2]]); const u = E3.v3.sub(q[1], q[0]), w = E3.v3.sub(q[2], q[0]); A += E3.v3.len(E3.v3.cross(u, w)) / 2; } return A; };
  const total = bands.meshes.reduce((s, m) => s + areaOf(m), 0);
  check("surface bands partition the surface (same area)", rel(total, areaOf(one)) < 1e-6 && bands.levels.length === 6, `${total.toFixed(6)} vs ${areaOf(one).toFixed(6)}`);
  const inBand = bands.meshes.every((m, k) => { for (let i = 1; i < m.positions.length; i += 3) { const y = m.positions[i]; if ((k > 0 && y < bands.levels[k] - 1e-6) || (k < 5 && y > bands.levels[k + 1] + 1e-6)) return false; } return true; });
  check("every band stays between its levels", inBand);
  const holes = E3.mesh.surface((x, z) => (x * x + z * z < 0.25 ? NaN : 1), { n: 20, doubleSided: false });
  check("surface: non-finite values leave holes", holes.indices.length < one.indices.length);
  const sphere = E3.mesh.parametric((u, v) => [Math.cos(u) * Math.sin(v), Math.cos(v), Math.sin(u) * Math.sin(v)], { u: [0, 2 * Math.PI], v: [0, Math.PI], wrapU: true, doubleSided: false });
  check("parametric sphere has radius 1", Math.abs(sphere.bounds.radius - 1) < 0.01, sphere.bounds.radius.toFixed(4));
  const gl = E3.mesh.glyphs([[0, 0, 0], [1, 0, 0], [2, 0, 0]], [[0, 1, 0], [0, 0, 0], [1, 0, 0]], { scale: 0.5 });
  check("glyphs skip zero vectors and reach |v|·scale", Math.abs(gl.bounds.max[1] - 0.5) < 0.02 && gl.bounds.max[0] > 2.45);
  window.palette = { blue: "#2c5da8", red: "#b5372a" };
  check("ramp ends on its stops", E3.ramp(0, ["blue", "red"]) === "#2c5da8" && E3.ramp(1, ["blue", "red"]) === "#b5372a");
  const scene = E3.scene(), ax = E3.axes3(scene, { x: [-2, 2], y: [0, 3], z: [-1, 1], ticks: 1, grid: true });
  check("axes3 adds axes and a grid with labels", ax.nodes.length === 4 && ax.labels.filter(l => !l.tick).length === 3 && ax.labels.some(l => l.text === "3"));
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
