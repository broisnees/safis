#!/usr/bin/env node
// Tests for the effects kit in src/effects.js (window.Fx and g.fx). The Node part checks
// the models the shaders and 2D versions share: seeded determinism, spark ballistics,
// black-body colors, the ellipse-to-frame camera match, the water surface's derivatives,
// caustic energy, plume and flame scaling, and the airflow streaks. The browser part (when
// Chrome is found) reads canvas pixels back: shaders compile, frames are deterministic,
// the 2D fallback draws, and a throttle eased with Fx.follow never jumps between frames.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findChrome, openBrowser } from "../skills/safis/scripts/lib/chrome.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = await readFile(path.join(root, "src/effects.js"), "utf8");
globalThis.window = {};
new Function(src)();
const Fx = window.Fx;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
const box = [0, 0, 640, 400];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const finite = v => (Array.isArray(v) ? v.every(finite) : typeof v === "object" && v ? Object.values(v).every(finite) : typeof v !== "number" || Number.isFinite(v));

// ---------- registration and fallbacks ----------
check("registers a g extension and the Fx namespace", window.__safisG?.length === 1 && typeof Fx.flow === "function");
check("no WebGL2 in Node, so every effect would draw in 2D", Fx.gpu === false);
check("params clamp out-of-range options", Fx.params("fire", box, { power: 5, soot: -1 }).power === 1 && Fx.params("fire", box, { soot: -1 }).soot === 0);
check("params fill defaults from the box", same(Fx.params("sparks", box).at, [320, 340]));
check("bad numbers fall back to defaults", Fx.params("plume", box, { throttle: NaN }).throttle === 0.8);

// ---------- seeded numbers ----------
check("hash is deterministic and spreads", Fx.hash(1, 2, 3) === Fx.hash(1, 2, 3) && Fx.hash(1, 2, 3) !== Fx.hash(1, 2, 4));
{
  let worst = 0;
  for (let x = 0; x < 20; x += 0.01) worst = Math.max(worst, Math.abs(Fx.noise(x + 0.01, 3) - Fx.noise(x, 3)));
  check("value noise is continuous", worst < 0.05, `largest step ${worst.toFixed(4)}`);
}

// ---------- physics helpers ----------
{
  const [r1, g1, b1] = Fx.blackbody(1000), [r2, g2, b2] = Fx.blackbody(6500);
  check("1000 K glows red", r1 === 255 && g1 < 100 && b1 === 0, `${r1}, ${g1}, ${b1}`);
  check("6500 K is near white", Math.min(r2, g2, b2) > 240, `${r2}, ${g2}, ${b2}`);
  let up = true;
  for (let T = 1000; T < 6000; T += 100) up &&= Fx.blackbody(T + 100)[1] >= Fx.blackbody(T)[1];
  check("green rises with temperature (red to yellow to white)", up);
  check("nothing glows below the Draper point", Fx.glowLevel(700) === 0 && Fx.glowLevel(798) === 0);
  check("glow is full by 1600 K and rises between", Fx.glowLevel(1600) === 1 && Fx.glowLevel(1000) > 0.3 && Fx.glowLevel(1000) < Fx.glowLevel(1200));
  check("flames puff at 1.5 / sqrt(D) Hz", Math.abs(Fx.puff(1) - 1.5) < 1e-12 && Math.abs(Fx.puff(0.25) - 3) < 1e-12);
  let x = 0;
  for (let i = 0; i < 18; i++) x = Fx.follow(x, 1, 1 / 60, 0.3);
  check("follow covers 63% in one time constant", Math.abs(x - (1 - Math.exp(-1))) < 1e-9, x.toFixed(4));
  check("follow starts at the target when there is no value yet", Fx.follow(undefined, 0.4, 1 / 60) === 0.4);
  check("follow holds still when time doesn't move", Math.abs(Fx.follow(0.2, 1, 0) - 0.2) < 1e-12);
}

// ---------- camera match: ellipse and frame ----------
{
  // A parallel (isometric-like) projector: turn by yaw and pitch, scale, flip y.
  const yaw = -0.62, pitch = 0.35, s = 40, c = [300, 200];
  const P = ([x, y, z]) => {
    const x1 = Math.cos(yaw) * x + Math.sin(yaw) * z, z1 = -Math.sin(yaw) * x + Math.cos(yaw) * z;
    return [c[0] + x1 * s, c[1] - (Math.cos(pitch) * y - Math.sin(pitch) * z1) * s];
  };
  const center = [1, 0.5, -0.3], r = 1.3, e = Fx.ellipse(P, center, [1, 0, 0], r);
  // Every point of the 3D rim lies on the screen ellipse.
  let worst = 0;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, q = P([center[0], center[1] + r * Math.cos(a), center[2] + r * Math.sin(a)]);
    const dx = q[0] - e.center[0], dy = q[1] - e.center[1], ca = Math.cos(e.angle), sa = Math.sin(e.angle);
    worst = Math.max(worst, Math.abs(((dx * ca + dy * sa) / e.rx) ** 2 + ((-dx * sa + dy * ca) / e.ry) ** 2 - 1));
  }
  check("the rim projects onto the ellipse Fx.ellipse returns", worst < 1e-9, `worst ${worst.toExponential(2)}`);
  const truth = P(center.map((v, i) => v + [r, 0, 0][i]));
  const F = Fx.frame(e, e.axis), tip = Fx.project(F, [1, 0, 0]);
  check("the ellipse alone fixes the axis foreshortening (sqrt(major² - minor²))", Math.hypot(tip[0] - truth[0], tip[1] - truth[1]) < 1e-6, `${tip.map(v => v.toFixed(3))} vs ${truth.map(v => v.toFixed(3))}`);
  const G = Fx.frame(e), back = Fx.project(G, [1, 0, 0]);
  check("with no axis given it points along the minor axis", Math.abs(Math.abs((back[0] - e.center[0]) * (truth[0] - e.center[0]) + (back[1] - e.center[1]) * (truth[1] - e.center[1])) - Math.hypot(back[0] - e.center[0], back[1] - e.center[1]) * Math.hypot(truth[0] - e.center[0], truth[1] - e.center[1])) < 1e-6);
}

// ---------- sparks ----------
{
  const o = { t: 3.2, seed: 4, drag: 0, rate: 40 };
  check("sparks are a pure function of t and seed", same(Fx.sparks(box, o), Fx.sparks(box, o)) && !same(Fx.sparks(box, o), Fx.sparks(box, { ...o, seed: 5 })));
  const at = t => Object.fromEntries(Fx.sparks(box, { ...o, t }).map(s => [s.k, s.p]));
  const dt = 0.05, A = at(3.2), B = at(3.25), C = at(3.3), k = Object.keys(A).find(k => B[k] && C[k]);
  const ddx = A[k][0] - 2 * B[k][0] + C[k][0], ddy = A[k][1] - 2 * B[k][1] + C[k][1], g = Fx.params("sparks", box).gravity;
  check("without drag a spark flies a parabola", Math.abs(ddx) < 1e-6 && Math.abs(ddy - g * dt * dt) < 1e-6, `second differences ${ddx.toFixed(6)}, ${ddy.toFixed(4)} vs ${(g * dt * dt).toFixed(4)}`);
  const D = Fx.sparks(box, { t: 30, seed: 2, drag: 3, life: 10, rate: 1, speed: 10 }).find(s => s.age > 5), E = Fx.sparks(box, { t: 30.1, seed: 2, drag: 3, life: 10, rate: 1, speed: 10 }).find(s => s.k === D.k);
  check("with drag a spark falls at the terminal speed g / c", Math.abs((E.p[1] - D.p[1]) / 0.1 - g / 3) < 0.01 * g / 3, `${((E.p[1] - D.p[1]) / 0.1).toFixed(2)} vs ${(g / 3).toFixed(2)} px/s`);
  const list = Fx.sparks(box, { t: 5, seed: 1, life: 1, rate: 200 });
  check("sparks cool as they age", list.every(s => s.T <= 2000 && s.T >= 2000 * 0.45) && list.some(s => s.T < 1500));
  check("a spark's age never exceeds its life", list.every(s => s.age >= 0 && s.age <= s.life));
}

// ---------- arc ----------
{
  const o = { from: [50, 200], to: [590, 200], t: 1.3, seed: 7 }, a = Fx.arc(box, o);
  check("the arc runs exactly from one electrode to the other", same(a.path[0], o.from) && same(a.path[a.path.length - 1], o.to));
  let worst = 0;
  const b = Fx.arc(box, { ...o, t: 1.302 });
  a.path.forEach((p, i) => (worst = Math.max(worst, Math.hypot(p[0] - b.path[i][0], p[1] - b.path[i][1]))));
  check("the arc's path drifts smoothly in time", worst < 3, `largest move in 2 ms: ${worst.toFixed(2)} px`);
  check("branches follow the option", a.branches.length === 2 && Fx.arc(box, { ...o, branches: 0 }).branches.length === 0);
}

// ---------- water ----------
{
  const lam = 30, w = { sources: [[200, 200]], wavelength: lam, speed: 40, t: 2.5, calm: true };
  const h = q => Fx.surface(box, w, q)[0];
  // The same phase one wavelength farther out: height falls as 1 / sqrt(1 + r / λ).
  const ring = r => Math.max(...Array.from({ length: 60 }, (_, i) => h([200 + r + (i / 60) * lam, 200])));
  const ratio = ring(4 * lam) / ring(2 * lam), want = Math.sqrt((1 + 2.5) / (1 + 4.5));
  check("ripples fall off as 1 / sqrt(r)", Math.abs(ratio - want) < 0.03, `${ratio.toFixed(3)} vs ${want.toFixed(3)}`);
  const two = { ...w, sources: [[150, 200], [250, 200]] }, one = { ...w, sources: [[150, 200]] };
  check("two sources in step double the height on the line between them", Math.abs(Fx.surface(box, two, [200, 320])[0] - 2 * Fx.surface(box, one, [200, 320])[0]) < 1e-9);
  // The analytic slope and curvature (which the shaders use) match finite differences.
  const cw = { scale: 80, sources: [[300, 180]], wavelength: 26, speed: 60, t: 3, seed: 2 };
  const S = q => Fx.surface(box, cw, q), e = 1e-3, steep = 0.04 * 26 * (2 * Math.PI / 26);
  // The ring's amplitude envelope varies slowly and its derivative is left out on purpose, so
  // errors are measured against the steepest slope (and curvature) of a ring near the source.
  let slope = 0, curve = 0;
  for (let i = 0; i < 40; i++) {
    const q = [180 + i * 7.3, 120 + i * 4.1], s0 = S(q), sx = S([q[0] + e, q[1]]), sy = S([q[0], q[1] + e]), mx = S([q[0] - e, q[1]]), my = S([q[0], q[1] - e]);
    slope = Math.max(slope, Math.abs(s0[1] - (sx[0] - mx[0]) / (2 * e)), Math.abs(s0[2] - (sy[0] - my[0]) / (2 * e)));
    curve = Math.max(curve, Math.abs(s0[3] - (sx[1] - mx[1]) / (2 * e)), Math.abs(s0[4] - (sy[1] - my[1]) / (2 * e)), Math.abs(s0[5] - (sy[2] - my[2]) / (2 * e)));
  }
  check("surface slope matches finite differences", slope < 0.05 * steep, `worst ${(slope / steep * 100).toFixed(1)}% of the steepest slope`);
  check("surface curvature matches finite differences", curve < 0.08 * steep * (2 * Math.PI / 26), `worst ${(curve / (steep * 2 * Math.PI / 26) * 100).toFixed(1)}% of the largest curvature`);
  const flat = [];
  for (let x = 20; x < 620; x += 37) for (let y = 20; y < 380; y += 41) flat.push(Fx.focus(box, { t: 1, depth: 0 }, [x, y]));
  check("at zero depth the pool floor is evenly lit", flat.every(v => Math.abs(v - 1) < 1e-12));
  // Light is conserved: before the first focus, the floor's mean brightness stays 1.
  let sum = 0, n = 0, peak = 0;
  for (let x = 0; x < 640; x += 3) for (let y = 0; y < 400; y += 3) { const v = Fx.focus(box, { t: 1, depth: 50 }, [x, y]); sum += v; n++; }
  for (let x = 0; x < 640; x += 3) for (let y = 0; y < 400; y += 3) peak = Math.max(peak, Fx.focus(box, { t: 1, depth: 180 }, [x, y]));
  check("caustics conserve light at shallow depth", Math.abs(sum / n - 1) < 0.02, `mean ${(sum / n).toFixed(4)}`);
  check("deeper, the light focuses into bright lines", peak > 3, `peak ${peak.toFixed(2)}`);
}

// ---------- flame and plume ----------
{
  const H = p => Fx.params("fire", box, { power: p }).height;
  check("flame height grows as power to the 2/5", Math.abs(H(0.5) / H(1) - 0.5 ** 0.4) < 1e-12);
  const pl = o => Fx.params("plume", box, o);
  check("thinner air stretches the shock cells", pl({ ambient: 0.3 }).spacing > pl({ ambient: 1 }).spacing);
  check("in vacuum the diamonds go and the plume balloons", pl({ ambient: 0 }).diamonds === 0 && pl({ ambient: 0 }).spread > 5 * pl({ ambient: 1 }).spread);
  check("throttle 0 means no diamonds", pl({ throttle: 0 }).diamonds === 0);
  check("more throttle, a longer plume", pl({ throttle: 1 }).length > pl({ throttle: 0.3 }).length);
  const side = pl({ at: [320, 40], angle: Math.PI / 2, width: 60 }).F;
  check("a side-view nozzle's frame runs the axis down the screen", same(side.A.map(Math.round), [0, 30]) && Math.abs(Math.hypot(...side.E1) - 30) < 1e-9);
}

// ---------- airflow ----------
{
  const inlet = { center: [200, 180], rx: 20, ry: 60 }, nozzle = { center: [420, 180], rx: 15, ry: 44 };
  const o = { inlet, nozzle, throttle: 0.8, temperature: 900, speed: 0, ground: 300, t: 4, seed: 3 };
  const a = Fx.flow(box, o), b = Fx.flow(box, o);
  check("flow trails are a pure function of t and seed", same(a, b) && !same(a, Fx.flow(box, { ...o, seed: 4 })));
  check("flow trails are finite", a.every(tr => finite(tr.points) && finite(tr.T) && Number.isFinite(tr.alpha)));
  const by = s => a.filter(tr => tr.stream === s);
  check("all three streams appear (intake, exhaust, ground swirl)", by("intake").length > 20 && by("exhaust").length > 20 && by("ground").length > 0,
    `${by("intake").length}, ${by("exhaust").length}, ${by("ground").length}`);
  check("exhaust cools as it travels", by("exhaust").every(tr => tr.T[tr.T.length - 1] <= tr.T[0] + 1e-9));
  check("intake air is cold", by("intake").every(tr => tr.T.every(T => T < 290)));
  check("intake streaks end at the inlet face, not beyond", by("intake").every(tr => tr.points[tr.points.length - 1][0] < inlet.center[0] + 2 * inlet.rx + 1));
  check("exhaust stays downstream of the nozzle", by("exhaust").every(tr => tr.points.every(q => q[0] > nozzle.center[0] - nozzle.rx - 1)));
  const count = thr => Fx.flow(box, { ...o, throttle: thr }).reduce((s, tr) => s + tr.alpha, 0);
  check("streak density follows the throttle", count(1) > count(0.5) && count(0.5) > count(0.1));
  check("forward speed blows the ground vortex away", Fx.flow(box, { ...o, speed: 1 }).every(tr => tr.stream !== "ground"));
  check("an inlet high above the ground has no ground vortex", Fx.flow(box, { ...o, ground: 480 }).every(tr => tr.stream !== "ground"));
}

// ---------- embers, dust grains, wind, water in section ----------
{
  const fire = { t: 3, embers: 1, power: 0.8 }, em = Fx.embers(box, fire);
  check("embers: seeded, alive, and rising above the base", em.length > 5 && same(em, Fx.embers(box, fire)) && em.every(e => e.p[1] < Fx.params("fire", box, fire).base[1] + 1));
  check("embers cool as they age", em.every(e => e.T <= 1700 + 1e-9 && e.T >= 840));
  check("no embers unless asked", Fx.embers(box, { t: 3 }).length === 0);
  const ground = 360, burst = { t: 0.5, ground, sources: [{ at: [320, ground], start: 0 }] }, gs = Fx.grains(box, burst);
  check("dust: a burst throws grains that stay on or above the ground", gs.length > 10 && gs.every(q => q.p[1] <= ground + 1e-6));
  check("dust: grains are seeded", same(gs, Fx.grains(box, burst)));
  check("dust: nothing before the burst starts", Fx.grains(box, { ...burst, t: -0.1 }).length === 0);
  const late = Fx.grains(box, { ...burst, t: 2.9 });
  check("dust: grains land and stop", late.every(q => q.landed));
  const jet = Fx.grains(box, { t: 2, ground, sources: [{ at: [320, ground], kind: "jet" }] });
  check("dust: a jet sprays grains both ways", jet.some(q => q.p[0] < 320) && jet.some(q => q.p[0] > 320));
  const wo = { t: 4, bodies: [{ at: [250, 200], r: 40 }] };
  const v0 = Fx.windVelocity(box, { ...wo, shedding: 0, turbulence: 0 }, [-1e4, 200]);
  check("wind: free stream far upstream", Math.abs(v0[0] - Fx.params("wind", box, wo).U) < 1 && Math.abs(v0[1]) < 1);
  const top = Fx.windVelocity(box, { ...wo, shedding: 0, turbulence: 0 }, [250, 200 - 40.5]);
  check("wind: twice the stream speed over the top of a cylinder", Math.abs(top[0] / Fx.params("wind", box, wo).U - 2) < 0.05, (top[0] / Fx.params("wind", box, wo).U).toFixed(3));
  check("wind: no velocity inside the body", Fx.windVelocity(box, wo, [250, 200]) === null);
  const w1 = JSON.stringify(Fx.wind(box, { ...wo, t: 4.5 }));
  Fx.wind(box, { ...wo, t: 1, seed: 9 });   // another setting clears the cache
  check("wind: the same frame from a cold cache and a warm one", w1 === JSON.stringify(Fx.wind(box, { ...wo, t: 4.5 })));
  check("wind: dye leaves the body's shoulders", Fx.wind(box, wo).some(q => q.dye));
  const lv = x => Fx.waterLevel(box, { t: 1, level: 120 }, x);
  check("water in section: the surface moves about its level", Math.abs(lv(100) - 120) < 40 && lv(100) !== lv(300));
}

// ---------- simulations on the CPU: fluid, waves, particles ----------
{
  const maxAbs = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  // Projection: the 5-point Laplacian is exactly div grad on the staggered grid, so a converged
  // solve leaves no divergence, and the default iterations leave a tiny residual each step.
  const sim = Fx.fluid({ domain: [1.2, 0.6], cpuCells: 24, speed: 0.5, re: 100, iterations: 600, obstacles: [{ shape: "circle", at: [0.4, 0.3], r: 0.06 }] });
  const C = sim._cpu();
  for (let k = 0; k < C.u.length; k++) { C.u[k] += 15 * Math.sin(k * 0.37); C.v[k] += 15 * Math.cos(k * 0.91); }
  const before = sim.project(), after = sim.divergence();
  check("fluid: projection removes the divergence (to float precision)", after < 1e-3 * before, `max |div| ${before.toFixed(2)} -> ${after.toExponential(2)} per s`);
  sim.set({ iterations: 32 }); sim.reset(); sim.advance(3);
  check("fluid: each step leaves under 0.1% of the divergence it made", sim.divergence() < 1e-3 * sim.lastDiv, `${sim.lastDiv.toFixed(2)} -> ${sim.divergence().toExponential(2)}`);
  const still = Fx.fluid({ domain: [1, 0.5], cpuCells: 20, speed: 0, re: 50, length: 0.1, kick: false, obstacles: [{ shape: "rect", at: [0.5, 0.25], size: [0.1, 0.1] }] });
  still.advance(3);
  check("fluid: still air round a body stays still", maxAbs(still._cpu().u) < 1e-9 && maxAbs(still._cpu().v) < 1e-9);
  const free = Fx.fluid({ domain: [1, 0.5], cpuCells: 20, speed: 0.4, re: 50, length: 0.1 });
  free.advance(2);
  const uc = 0.4 / free.h;
  check("fluid: an empty channel keeps a uniform stream", free._cpu().u.every((v, k) => k % (free.grid[0] + 1) === 0 || Math.abs(v - uc) < 1e-3 * uc || k >= (free.grid[0] + 1) * free.grid[1]));
  // Wakes at the right Reynolds numbers: attached at Re 2, a recirculation bubble at Re 30.
  const wake = re => { const s = Fx.fluid({ domain: [1.6, 0.8], cpuCells: 40, speed: 0.5, re, kick: false, obstacles: [{ shape: "circle", at: [0.45, 0.4], r: 0.08 }] }); s.advance(6); return s.sample([0.45 + 0.08 * 1.6, 0.4]).u; };
  const u2 = wake(2), u30 = wake(30);
  check("fluid: at Re 2 the flow closes behind a cylinder (no bubble)", u2 > 0, `u ${u2.toFixed(3)} m/s, 0.8 D behind`);
  check("fluid: at Re 30 a recirculation bubble sits behind it", u30 < 0, `u ${u30.toFixed(3)} m/s, 0.8 D behind`);
  // Shedding: a cylinder at Re 120 sheds at a Strouhal number near 0.17 (0.15 to 0.21 here).
  const st = Fx.fluid({ domain: [2, 0.8], cpuCells: 40, speed: 0.5, re: 120, track: true, obstacles: [{ shape: "circle", at: [0.42, 0.4], r: 0.05 }] });
  st.advance(14);
  const sh = st.shedding();
  check("fluid: a cylinder at Re 120 sheds at St 0.15 to 0.21", sh.strouhal > 0.15 && sh.strouhal < 0.21, `St ${sh.strouhal.toFixed(3)}, ${sh.frequency.toFixed(2)} Hz`);
  // Determinism: the same settings give the same field, and going back in time replays it.
  const run = () => { const s = Fx.fluid({ domain: [1, 0.5], cpuCells: 16, speed: 0.5, re: 150, obstacles: [{ shape: "circle", at: [0.3, 0.25], r: 0.04 }] }); s.stir([0.6, 0.2], [0.65, 0.22]); s.advance(1.5); return s; };
  const r1 = run(), r2 = run();
  check("fluid: deterministic", same(Array.from(r1._cpu().u), Array.from(r2._cpu().u)) && same(Array.from(r1._cpu().d[0]), Array.from(r2._cpu().d[0])));
  r1.warm(1); r1.advance(2); const fwd = Array.from(r1._cpu().v); r1.advance(1.2); r1.advance(2);
  check("fluid: going back in time and forward again gives the same frame", same(fwd, Array.from(r1._cpu().v)));
  // Waves: a ring spreads at c, and shallow water gives c = sqrt(g h).
  const front = W => { const prof = t => { W.advance(t); return Array.from({ length: 260 }, (_, i) => W.height([0.6 + i * 0.002, 0.6])); }, at = t => { const p = prof(t), m = maxAbs(p); let i = p.length - 1; while (i > 0 && Math.abs(p[i]) < 0.2 * m) i--; return i * 0.002; }; const a = at(0.4), b = at(0.9); return (b - a) / 0.5; };
  const W1 = Fx.waves({ domain: [1.2, 1.2], cpuCells: 120, speed: 0.3, damping: 0 });
  W1.drop([0.6, 0.6], { amp: 0.002, r: 0.04 });
  const c1 = front(W1);
  check("waves: a pebble's ring spreads at c (within 5%)", Math.abs(c1 / 0.3 - 1) < 0.05, `${c1.toFixed(3)} vs 0.300 m/s`);
  const W2 = Fx.waves({ domain: [1.2, 1.2], cpuCells: 120, depth: 0.004, damping: 0 }), c2 = Math.sqrt(9.81 * 0.004);
  W2.drop([0.6, 0.6], { amp: 0.001, r: 0.04 });
  const m2 = front(W2);
  check("waves: shallow water runs at sqrt(g h) (within 5%)", Math.abs(W2.speed - c2) < 1e-12 && Math.abs(m2 / c2 - 1) < 0.05, `${m2.toFixed(3)} vs ${c2.toFixed(3)} m/s`);
  const W3 = Fx.waves({ domain: [1.6, 1.6], cpuCells: 120, speed: 0.3, damping: 0, sources: [{ at: [0.8, 0.8], freq: 2, amp: 0.001 }] });
  W3.advance(2.5);
  let a1 = 0;
  for (let k = 0; k < 64; k++) for (let d = -0.04; d <= 0.04; d += 0.005) a1 = Math.max(a1, Math.abs(W3.height([0.8 + (0.15 + d) * Math.cos(k / 10), 0.8 + (0.15 + d) * Math.sin(k / 10)])));
  check("waves: a source's waves are amp high one wavelength out (within 15%)", Math.abs(a1 / 0.001 - 1) < 0.15, `${(a1 * 1000).toFixed(2)} mm`);
  const wv = () => { const s = Fx.waves({ domain: [0.5, 0.5], cpuCells: 40, speed: 0.3, walls: Fx.waves.slits([0.25, 0], [0.25, 0.5], [[0.25, 0.05]]), sources: [{ at: [0.1, 0.25], freq: 3 }] }); s.drop([0.4, 0.1]); s.advance(1); return Array.from(s.heights()); };
  check("waves: deterministic", same(wv(), wv()));
  const walls = Fx.waves.slits([0, 0], [0, 1], [[0.4, 0.1], [0.6, 0.1]]);
  check("waves: slits cut a barrier into pieces with gaps", walls.length === 3 && Math.abs(walls[0].to[1] - 0.35) < 1e-12 && Math.abs(walls[1].from[1] - 0.45) < 1e-12);
  // Particles: terminal speeds from the presets, still things stay still, determinism.
  for (const [m, vt] of [["dust", 0.3], ["sand", 2.5], ["water", 5.5], ["rain", 8.5], ["snow", 1], ["spark", 7], ["bubble", -0.25], ["pollen", 0.03]]) {
    const P = Fx.particles({ matter: m, domain: [4, 400], count: 1, emitter: { at: [2, 200] }, forces: { turbulence: { strength: 0 } }, life: [30, 30], prewarm: false });
    P.advance(8);
    const v = P.alive()[0]?.v[1] ?? NaN;
    check(`particles: ${m} falls at its terminal speed (within 5%)`, Math.abs(v / vt - 1) < 0.05, `${v.toFixed(3)} vs ${vt} m/s`);
  }
  const still2 = Fx.particles({ matter: "air", domain: [1, 1], count: 1, emitter: { at: [0.5, 0.5] }, forces: { turbulence: { strength: 0 } }, life: [20, 20], prewarm: false });
  still2.advance(5);
  check("particles: a tracer in still air stays where it is", same(still2.alive()[0]?.p, [0.5, 0.5]));
  const settle = Fx.particles({ matter: "dust", domain: [1, 1], count: 40, ground: 0.9, pile: false, emitter: { shape: "line", from: [0.2, 0.5], to: [0.8, 0.5] }, life: [20, 20], prewarm: false });
  settle.advance(6);
  const down = settle.alive().filter(q => q.landed);
  settle.advance(9);
  const later = new Map(settle.alive().map(q => [q.i, q]));
  check("particles: dust that has landed stays where it landed", down.length > 2 && down.every(q => Math.abs(q.p[1] - 0.9) < 1e-9 && same(later.get(q.i)?.p, q.p)), `${down.length} landed`);
  const heap = Fx.particles({ matter: "sand", domain: [1, 1], count: 600, ground: 0.95, heap: 4, emitter: { at: [0.5, 0.2] }, life: [2, 2.5] });
  heap.advance(6);
  const pile = heap.pile(), top = Math.min(...pile.map(q => q[1])), slope = Math.max(...pile.slice(1).map((q, i) => Math.abs(q[1] - pile[i][1]) / (q[0] - pile[i][0])));
  check("particles: sand builds a heap no steeper than its angle of repose", top < 0.95 - 0.01 && slope <= Math.tan(34 * Math.PI / 180) * 1.001, `height ${(0.95 - top).toFixed(3)} m, steepest ${(Math.atan(slope) * 180 / Math.PI).toFixed(1)}°`);
  const smoke = o => Fx.particles({ matter: "smoke", domain: [10, 10], count: 300, emitter: { at: [5, 9], speed: 1, dir: -Math.PI / 2 }, ...o });
  const sa = smoke(), sb = smoke();
  sa.advance(4); sb.advance(4);
  check("particles: deterministic", same(sa.alive(), sb.alive()) && !same(sa.alive(), (() => { const s = smoke({ seed: 2 }); s.advance(4); return s.alive(); })()));
  check("particles: hot smoke rises", sa.alive().reduce((s, q) => s + q.p[1], 0) / sa.alive().length < 9 - 1);
  const rain = Fx.particles({ matter: "rain", domain: [2, 2], count: 200, ground: 1.9, emitter: { shape: "line", from: [0.2, 0], to: [1.8, 0] } });
  rain.advance(3);
  check("particles: rain splashes on the ground", rain.droplets().length > 0 && rain.alive().every(q => q.p[1] <= 1.9 + 1e-9));
  const sim2 = Fx.fluid({ domain: [2, 0.8], cpuCells: 24, speed: 1, re: 100, obstacles: [{ shape: "circle", at: [0.6, 0.4], r: 0.12 }] });
  const tr = Fx.particles({ matter: "air", fluid: sim2, count: 300, emitter: { shape: "line", from: [0.05, 0.1], to: [0.05, 0.7] } });
  tr.advance(2.5);
  check("particles: tracers in a fluid go round the body, never into it", tr.alive().length > 50 && tr.alive().every(q => Math.hypot(q.p[0] - 0.6, q.p[1] - 0.4) >= 0.12 - 1e-6) && Math.abs(sim2.time - 2.5) < 1e-6);
  // Defining matter and colormaps from a page.
  Fx.matter.define("ash", { base: "dust", vt: 0.5, color: "#777777", style: "smoke" });
  const ash = Fx.particles({ matter: "ash", domain: [4, 400], count: 1, emitter: { at: [2, 200] }, forces: { turbulence: { strength: 0 } }, life: [30, 30], prewarm: false });
  ash.advance(8);
  check("matter.define: a new matter falls at its own terminal speed", Math.abs(ash.alive()[0].v[1] / 0.5 - 1) < 0.01 && Fx.matter.names.includes("ash") && Fx.matter("ash").style === "puff");
  const err = f => { try { f(); return ""; } catch (e) { return e.message; } };
  check("matter.define: bad numbers are explained", /vt is -1; it should be terminal speed/.test(err(() => Fx.matter.define("x", { vt: -1 }))) && /unknown key "speed"/.test(err(() => Fx.matter.define("x", { speed: 1 }))) && /say how it moves/.test(err(() => Fx.matter.define("x", { style: "dot" }))));
  Fx.colormap.define("ice", ["#000", [0.5, 0.7, 1], "#ffffff"]);
  check("colormap.define: a new map interpolates its stops", same(Fx.colormap("ice", 0).map(v => +v.toFixed(3)), [0, 0, 0]) && Math.abs(Fx.colormap("ice", 0.5)[2] - 1) < 0.05 && same(Fx.colormap("ice", 1), [1, 1, 1]));
  check("colormap.define: bad stops are explained", /stop 1 is "red"/.test(err(() => Fx.colormap.define("x", ["#000", "red"]))) && /rise from 0 to 1/.test(err(() => Fx.colormap.define("x", [[0, "#000"], [0.8, "#fff"]]))));
  check("the built-in colormaps: magma dark to light, coolwarm blue to red", Fx.colormap("magma", 0)[0] < 0.01 && Fx.colormap("magma", 1)[0] > 0.95 && Fx.colormap("coolwarm", 0)[2] > Fx.colormap("coolwarm", 0)[0] && Fx.colormap("coolwarm", 1)[0] > Fx.colormap("coolwarm", 1)[2]);
}

// ---------- in a browser: shaders, determinism, fallback, smooth envelopes ----------
if (!findChrome() || typeof WebSocket === "undefined") console.log("skip browser checks (no Chrome or Node < 22)");
else {
  const runtime = await readFile(path.join(root, "src/runtime.js"), "utf8"), theme = await readFile(path.join(root, "src/theme.css"), "utf8");
  // Each figure eases a hidden setting x with Fx.follow (or snaps to it when ease is off).
  const fig = (id, draw) => `<figure class="demo" id="${id}" aria-label="${id}"></figure><script>
demo("${id}", { aspect: 1.6, autoplay: false, state: () => ({ t: 1 }),
  controls: [{ key: "x", min: 0, max: 1, step: 0.01, value: 0.2, hidden: true }, { key: "ease", type: "toggle", value: true, hidden: true }],
  step(dt, s, v) { s.t += dt; s.x = v.ease ? Fx.follow(s.x, v.x, dt) : v.x; },
  draw(g, s, v) { const x = s.x ?? v.x; window.out["${id}"] = (${draw})(g, s.t, x); } });
</script>`;
  const html = `<!doctype html><meta charset="utf-8"><style>${theme} body { margin: 0 } figure { width: 480px; margin: 0 }</style>
<script>${src}</script><script>${runtime}</script><script>window.out = {};</script><main>
${fig("plume", "(g, t, x) => g.fx.plume(null, { throttle: x, t })")}
${fig("flow", "(g, t, x) => g.fx.flow(null, { throttle: x, t, ground: g.h - 10 })")}
${fig("fire", "(g, t, x) => g.fx.fire(null, { power: x, t, size: 0.3 })")}
${fig("glow", "(g, t, x) => g.fx.glow(null, { path: [[60, g.h / 2], [g.w - 60, g.h / 2]], temp: 900 + 1000 * x })")}
${fig("water", "(g, t, x) => (g.fx.caustics(null, { t, depth: 60 + 120 * x }), g.fx.ripples([0, 0, g.w / 2, g.h], { t, sources: [[80, 80]] }))")}
${fig("misc", "(g, t, x) => (g.fx.smoke(null, { t, density: x }), g.fx.sparks(null, { t, rate: 20 + 60 * x }), g.fx.arc(null, { t, intensity: x + 0.3 }), g.fx.shimmer(null, { t, strength: 3 * x }))")}
${fig("fresh", "(g, t, x) => { const h = g.h / 2, w = g.w / 2; g.fx.dust([0, 0, w, h], { t: t + 0.5, sources: [{ at: [w / 2, h * 0.9], start: 0 }], density: x + 0.3 }); g.fx.water([w, 0, w, h], { t, depth: 40 + 100 * x }); g.fx.water([0, h, w, h], { view: 'side', t, amp: x + 0.2 }); g.fx.wind([w, h, w, h], { t: t + 2, bodies: [{ at: [w * 1.3, h * 1.5], r: 14 }] }); return g.fx.fire([0, 0, g.w, g.h], { t, power: x, embers: 1, smoke: 0.6 }); }")}
${fig("sims", "(g, t, x) => { const F = window.SF ??= Fx.fluid({ gpu: true, domain: [1.2, 0.4], cells: 32, speed: 0.4, re: 60, obstacles: [{ shape: 'circle', at: [0.3, 0.2], r: 0.04 }], streaks: 0.04 }); const W = window.SW ??= Fx.waves({ gpu: true, domain: [1, 0.5], cells: 48, speed: 0.3, walls: Fx.waves.slits([0.5, 0], [0.5, 0.5], [[0.25, 0.06]]), sources: [{ at: [0.2, 0.25], freq: 3, amp: 0.002 }] }); const P = window.SP ??= Fx.particles({ matter: 'air', fluid: F, count: 150, emitter: { shape: 'line', from: [0.02, 0.05], to: [0.02, 0.35] } }); P.advance(t + 1); W.advance(t + 1); const h = g.h / 2, r = g.fx.fluid([0, 0, g.w, h], { sim: F, arrows: true, show: x > 0.5 ? 'vorticity' : 'speed' }); g.fx.particles([0, 0, g.w, h], { sys: P }); const w = g.fx.waves([0, h, g.w, h], { sim: W, look: x > 0.5 ? 'height' : 'pool' }); return { gpu: r.gpu && w.gpu && F.gpu && W.gpu }; }")}
</main>`;
  const dir = await mkdtemp(path.join(os.tmpdir(), "fx-test-")), file = path.join(dir, "index.html");
  await writeFile(file, html);
  const b = await openBrowser({ viewport: { width: 520, height: 3000, deviceScaleFactor: 1, mobile: false } });
  const errs = [];
  b.on(m => { if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description ?? "exception"); });
  try {
    await b.setMedia("light");
    await b.goto(pathToFileURL(file).href);
    const ev = s => b.evaluate(s);
    await ev(`window.drive = (id, a) => window.__explainer.drive(id, a);
      window.ink = id => {
        const cv = document.querySelector("#" + id + " canvas"), d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data, p = palette.panel;
        const P = [1, 3, 5].map(i => parseInt(p.slice(i, i + 2), 16)), L = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b, L0 = L(...P);
        let s = 0, n = 0, h = 2166136261;
        for (let i = 0; i < d.length; i += 4) { if ((i >> 2) % 3 === 0) { s += Math.abs(L(d[i], d[i + 1], d[i + 2]) - L0) / 255; n++; } h = Math.imul(h ^ d[i] ^ (d[i + 1] << 8) ^ (d[i + 2] << 16), 16777619); }
        return { ink: s / n, hash: h >>> 0 };
      };`);
    const ids = ["plume", "flow", "fire", "glow", "water", "misc", "fresh", "sims"];
    check("the shaders compile (SwiftShader WebGL2)", (await ev("Fx.gpu")) && (await ev("Fx.errors.length")) === 0, await ev("Fx.errors.join('; ')"));
    for (const id of ids) await ev(`drive("${id}", { steps: 1 })`);
    check("shader effects report gpu: true", await ev(`["plume", "fire", "glow", "water"].every(id => out[id].gpu)`));
    check("simulations run in float textures when asked (gpu: true), with no shader errors", (await ev("out.sims.gpu")) && (await ev("Fx.errors.length")) === 0, await ev("Fx.errors.join('; ')"));
    // The GPU and CPU solvers take the same steps: a steady wake and a wave field agree.
    const agree = await ev(`(() => {
      const o = { domain: [1.2, 0.4], speed: 0.4, re: 20, kick: false, obstacles: [{ shape: "circle", at: [0.3, 0.2], r: 0.05 }] };
      const a = Fx.fluid({ ...o, gpu: true, cells: 32 }), b = Fx.fluid({ ...o, gpu: false, cpuCells: 32 });
      a.advance(3); b.advance(3);
      let fl = 0;
      for (let x = 0.05; x < 1.2; x += 0.05) for (let y = 0.03; y < 0.4; y += 0.04) { const p = a.velocity([x, y]), q = b.velocity([x, y]); fl = Math.max(fl, Math.hypot(p[0] - q[0], p[1] - q[1]) / 0.4); }
      const w = { domain: [1, 0.5], speed: 0.3, damping: 0.1, sources: [{ at: [0.3, 0.25], freq: 3, amp: 0.002 }] }, c = Fx.waves({ ...w, gpu: true, cells: 40 }), d = Fx.waves({ ...w, gpu: false, cpuCells: 40 });
      c.drop([0.7, 0.2]); d.drop([0.7, 0.2]); c.advance(1.5); d.advance(1.5);
      const H = c.heights(), K = d.heights(), m = Math.max(...K.map(Math.abs));
      let wv = 0; H.forEach((v, i) => { wv = Math.max(wv, Math.abs(v - K[i]) / m); });
      return { fl, wv, gpu: a.gpu && c.gpu && !b.gpu && !d.gpu };
    })()`);
    check("GPU and CPU fluid solvers agree (within 1% of the stream)", agree.gpu && agree.fl < 0.01, `${(agree.fl * 100).toFixed(3)}%`);
    check("GPU and CPU wave solvers agree (within 0.1%)", agree.gpu && agree.wv < 1e-3, `${(agree.wv * 100).toFixed(4)}%`);
    // Determinism: the same state renders the same pixels.
    let stable = true;
    for (const id of ids) { const a = await ev(`(drive("${id}", {}), ink("${id}").hash)`), c = await ev(`(drive("${id}", {}), ink("${id}").hash)`); stable &&= a === c; }
    check("frames are deterministic", stable);
    // Envelope: step x from 0.2 to 1 and watch the mean ink frame by frame.
    for (const id of ["plume", "flow", "fire"]) {
      const run = async ease => {
        await ev(`drive("${id}", { reset: true, set: { x: 0.2, ease: ${ease} }, play: false })`);
        const before = [];
        for (let i = 0; i < 20; i++) before.push(await ev(`(drive("${id}", { steps: 1 }), ink("${id}").ink)`));
        await ev(`drive("${id}", { set: { x: 1 } })`);
        const after = [before[before.length - 1]];
        for (let i = 0; i < 90; i++) after.push(await ev(`(drive("${id}", { steps: 1 }), ink("${id}").ink)`));
        const jumps = s => Math.max(...s.slice(1).map((v, i) => Math.abs(v - s[i])));
        return { calm: Math.max(jumps(before), jumps(after.slice(-30))), worst: jumps(after), first: Math.abs(after[1] - after[0]), total: Math.abs(after[after.length - 1] - before[before.length - 1]) };
      };
      const eased = await run(true), snapped = await run(false);
      check(`${id}: an eased throttle step never jumps a frame`, eased.worst <= eased.calm + 0.15 * eased.total,
        `largest frame change ${eased.worst.toFixed(4)}, calm ${eased.calm.toFixed(4)}, whole change ${eased.total.toFixed(4)}`);
      check(`${id}: without easing the same step pops`, snapped.first > 2 * eased.worst, `first frame ${snapped.first.toFixed(4)} vs eased ${eased.worst.toFixed(4)}`);
    }
    // The 2D versions: no WebGL2 (forced), still drawn, no errors.
    await ev("Fx.force2d = true");
    for (const id of ids) await ev(`drive("${id}", { steps: 1 })`);
    const blank = [];
    for (const id of ids) if ((await ev(`ink("${id}").ink`)) < 0.002) blank.push(id);
    check("with WebGL2 off every effect draws its 2D version", blank.length === 0 && (await ev(`Object.values(out).every(r => !r.gpu)`)), blank.join(", "));
    await b.setMedia("dark");
    await b.settle(100);
    await ev("Fx.force2d = false");
    for (const id of ids) await ev(`drive("${id}", { steps: 1 })`);
    check("dark page renders without errors", errs.length === 0 && (await ev(`ink("plume").ink`)) > 0.002, errs.join("; "));
  } finally {
    await b.close();
    await rm(dir, { recursive: true, force: true });
  }
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
