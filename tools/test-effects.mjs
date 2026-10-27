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
    const ids = ["plume", "flow", "fire", "glow", "water", "misc"];
    check("the shaders compile (SwiftShader WebGL2)", (await ev("Fx.gpu")) && (await ev("Fx.errors.length")) === 0, await ev("Fx.errors.join('; ')"));
    for (const id of ids) await ev(`drive("${id}", { steps: 1 })`);
    check("shader effects report gpu: true", await ev(`["plume", "fire", "glow", "water"].every(id => out[id].gpu)`));
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
