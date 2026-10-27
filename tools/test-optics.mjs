#!/usr/bin/env node
// Tests for the ray tracer in src/optics.js (window.Optics) that run in Node: Snell's
// law, the critical angle, Fresnel reflectance and energy, the thin-lens and thick-lens
// equations, mirrors, rainbow angles from rays traced through a water drop, dispersion
// through a prism, the schematic eye with accommodation and glasses, speed, and a smoke
// test that the canvas helpers register and draw without throwing.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
new Function(await readFile(path.join(root, "src/optics.js"), "utf8"))();
const O = window.Optics;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const DEG = Math.PI / 180;
const angleOf = d => Math.atan2(d[1], d[0]) / DEG;
const dirOf = s => [s.b[0] - s.a[0], s.b[1] - s.a[1]];
const between = (u, v) => Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))))) / DEG;

// ---------- materials ----------
{
  check("BK7 is 1.5168 at the d line", near(O.index("bk7"), 1.5168, 2e-4), O.index("bk7").toFixed(5));
  check("water is 1.333 at 589 nm", near(O.index("water", 589), 1.333, 1e-3), O.index("water", 589).toFixed(4));
  check("diamond is 2.417 at the d line", near(O.index("diamond"), 2.4175, 1e-3));
  check("Abbe numbers: BK7 64, flint 36", near(O.abbe("bk7"), 64.2, 0.8) && near(O.abbe("flint"), 36.4, 0.8), `${O.abbe("bk7").toFixed(1)}, ${O.abbe("flint").toFixed(1)}`);
  check("violet bends more: n(410) > n(650) for every glass", ["bk7", "flint", "water", "diamond"].every(m => O.index(m, 410) > O.index(m, 650)));
  const [r, , b] = O.wavelengthRGB(650), g530 = O.wavelengthRGB(530), b450 = O.wavelengthRGB(450);
  check("650 nm is red, 530 nm green, 450 nm blue", r > 200 && b < 60 && g530[1] > g530[0] && g530[1] > g530[2] && b450[2] > b450[0] && b450[2] > b450[1]);
  const light = O.wavelengthRGB(578, { on: "light" }), plain = O.wavelengthRGB(578);
  check("yellow is darkened for light pages", light[0] < plain[0] && light[1] < plain[1]);
}

// ---------- Snell's law and Fresnel ----------
{
  const n = 1.5, glass = O.slab([5, 0], 4, 6, { n });
  for (const i of [10, 30, 60, 80]) {
    const T = O.trace([glass, O.ray([0, -Math.tan(i * DEG) * 3], i)], { fresnel: true, minI: 0 });
    const h = T.hits[0], t = T.segments.find(s => s.via === "T");
    const tAngle = angleOf(dirOf(t));
    check(`Snell at ${i}°: sin θ₁ = 1.5 sin θ₂`, near(Math.sin(i * DEG), n * Math.sin(tAngle * DEG), 1e-12) && near(h.t, tAngle, 1e-9) && near(h.i, i, 1e-9),
      `θ₂ = ${tAngle.toFixed(4)}°, formula ${O.snell(1, n, i).toFixed(4)}°`);
  }
  check("critical angle for n = 1.5 is 41.81°", near(O.critical(1.5), 41.81, 0.01), `${O.critical(1.5).toFixed(3)}°`);
  // Inside a half disc, aimed at the center of the flat face: the angle there is exactly the aim.
  const half = O.semicircle([0, 0], 1, { angle: 180, n: 1.5 });
  const at = a => O.trace([half, O.ray([-0.9 * Math.cos(a * DEG), -0.9 * Math.sin(a * DEG)], a)], { minI: 0 }).hits.find(h => h.depth === 0);
  const below = at(41.5), above = at(42.1);
  check("41.5° inside glass escapes, 42.1° reflects totally", below.kind === "refract" && above.kind === "tir" && above.R === 1, `${below.kind} R=${below.R.toFixed(3)}, ${above.kind}`);
  check("near the critical angle the escaping ray grazes the surface", below.t > 80, `θ₂ = ${below.t.toFixed(1)}°`);
  const f0 = O.fresnel(1, 1.5, 0), fb = O.fresnel(1, 1.5, O.brewster(1, 1.5));
  check("normal incidence reflects 4% from glass", near(f0.R, 0.04, 1e-12));
  check("at Brewster's angle p-polarized light doesn't reflect", fb.Rp < 1e-12 && fb.Rs > 0.1);
  check("R + T = 1", [5, 25, 50, 75, 89].every(i => near(O.fresnel(1, 1.5, i).R + O.fresnel(1, 1.5, i).T, 1, 1e-12)));
  // Energy: everything that leaves a slab (both faces, all internal bounces) adds back up to the input.
  const T = O.trace([O.slab([0, 0], 1, 1, { n: 1.5, angle: 20 }), O.ray([-3, 0.1], 5)], { minI: 0, depth: 60 });
  const e = T.energy;
  check("energy is conserved through partial reflections", near(e.escaped + e.absorbed + e.lost, 1, 1e-12) && e.lost < 1e-9, `escaped ${e.escaped.toFixed(12)}, lost ${e.lost.toExponential(1)}`);
  const noF = O.trace([O.slab([0, 0], 1, 1, { n: 1.5 }), O.ray([-3, 0.1], 5)], { fresnel: false });
  check("fresnel: false keeps only the refracted path", noF.segments.length === 3 && noF.segments.every(s => s.I === 1));
}

// ---------- lenses and mirrors ----------
{
  for (const [f, d] of [[10, 30], [10, 15], [-8, 20]]) {
    const L = O.thinLens([0, 0], f, { aperture: 6 });
    const T = O.trace([L, O.fanTo([-d, 0], [0, -2.5], [0, 2.5], { n: 11 })]);
    const out = T.segments.filter(s => s.via === "L"), F = O.focus(out), want = 1 / (1 / f - 1 / d);
    check(`thin lens f = ${f}, object at ${d}: 1/f = 1/dₒ + 1/dᵢ`, near(F.p[0], want, 1e-9) && F.rms < 1e-9 && near(O.image(f, d).d, want, 1e-12), `image at ${F.p[0].toFixed(6)}, want ${want.toFixed(6)}`);
  }
  {
    // Off axis: the image of a point 1 above the axis is inverted and scaled by −dᵢ/dₒ.
    const T = O.trace([O.thinLens([0, 0], 10, { aperture: 8 }), O.fanTo([-30, 1], [0, -3], [0, 3], { n: 9 })]);
    const F = O.focus(T.segments.filter(s => s.via === "L"));
    check("thin lens magnification is −dᵢ/dₒ", near(F.p[0], 15, 1e-9) && near(F.p[1], -0.5, 1e-9), `image at (${F.p.map(v => v.toFixed(4))})`);
  }
  {
    // A real biconvex BK7 lens: paraxial rays meet at the back focal distance from the thick-lens equation.
    const lens = O.lens([0, 0], { f: 50, thickness: 6, aperture: 30 });
    const T = O.trace([lens, O.beam([-20, 0], 0, 0.4, { n: 5 })], { fresnel: false });
    const F = O.focus(T.segments.filter(s => s.via === "TT")), t = O.thick(O.index("bk7"), lens.optic.R1, lens.optic.R2, 6);
    check("thick lens built for f = 50 has f = 50", near(t.f, 50, 1e-9), `f = ${t.f.toFixed(6)}`);
    check("paraxial rays focus at the back focal distance", near(F.p[0], 3 + t.bfd, 0.01), `${F.p[0].toFixed(4)} vs ${(3 + t.bfd).toFixed(4)}`);
    const wide = O.trace([lens, O.beam([-20, 0], 0, 24, { n: 2 })], { fresnel: false });
    const edge = wide.segments.filter(s => s.via === "TT").map(s => s.a[0] - s.a[1] * (s.b[0] - s.a[0]) / (s.b[1] - s.a[1]));
    check("marginal rays focus shorter (spherical aberration)", edge.every(x => x < F.p[0] - 0.5), `edge rays cross at ${edge[0].toFixed(2)}`);
    check("lensmaker for a thin symmetric lens", near(O.lensmaker(1.5, 100, -100), 100, 1e-9));
  }
  {
    // Concave mirror, R = 20: paraxial light meets at f = R/2 = 10 in front of the vertex.
    const m = O.curvedMirror([10, 0], 20, { aperture: 8 });
    const T = O.trace([m, O.beam([-10, 0], 0, 0.5, { n: 5 })]);
    const F = O.focus(T.segments.filter(s => s.via === "M"));
    check("concave mirror focuses at R/2", near(F.p[0], 0, 0.005), `focus ${(10 - F.p[0]).toFixed(4)} in front`);
    const cx = O.curvedMirror([10, 0], -20, { aperture: 8 });
    const back = O.trace([cx, O.beam([-10, 0], 0, 0.5, { n: 5 })]).segments.filter(s => s.via === "M").map(s => ({ p: s.a, d: dirOf(s) }));
    check("convex mirror's virtual focus is R/2 behind it", near(O.focus(back).p[0], 20, 0.005));
    const flat = O.trace([O.mirror([0, -1], [0, 1]), O.ray([-2, -1], 30)]);
    check("flat mirror: angle of reflection equals angle of incidence", near(angleOf(dirOf(flat.segments[1])), 150, 1e-9));
    const back2 = O.trace([O.mirror([0, -1], [0, 1], { flip: true }), O.ray([-2, -1], 30)]);
    check("the hatched back of a mirror absorbs", back2.hits[0].kind === "absorb" && back2.segments.length === 1);
    const split = O.trace([O.mirror([0, -1], [0, 1], { twoSided: true, reflectance: 0.5 }), O.ray([-2, 0], 0)]);
    check("a half-silvered mirror splits 50/50", split.segments.filter(s => s.depth === 1).every(s => s.I === 0.5) && split.segments.length === 3);
  }
}

// ---------- rainbows and dispersion ----------
{
  const r1 = O.rainbow(1.333), r2 = O.rainbow(1.333, 2);
  check("primary rainbow formula: 42°", near(r1.angle, 42.0, 0.3), `${r1.angle.toFixed(2)}°`);
  check("secondary rainbow formula: 51°", near(r2.angle, 51.0, 0.3), `${r2.angle.toFixed(2)}°`);
  // Trace 800 parallel rays into a drop and find the extreme angles of the light that comes back.
  const bow = wl => {
    const rays = [];
    for (let k = 1; k < 800; k++) rays.push(O.ray([-3, -k / 800], 0, { wl }));
    const T = O.trace([O.drop([0, 0], 1), ...rays], { minI: 0, depth: 5, maxSegments: 20000 });
    const angles = via => T.segments.filter(s => s.via === via).map(s => 180 - between(dirOf(s), [1, 0]));
    return { primary: Math.max(...angles("TRT")), secondary: Math.min(...angles("TRRT")) };
  };
  const all = bow(589), red = bow(656), violet = bow(410);
  check("traced: the primary bow is at 42° (minimum deviation, one internal reflection)", near(all.primary, 42.0, 0.25), `${all.primary.toFixed(2)}°`);
  check("traced: the secondary bow is at 51° (two internal reflections)", near(all.secondary, 51.0, 0.25), `${all.secondary.toFixed(2)}°`);
  check("traced and formula agree within 0.05°", near(all.primary, O.rainbow(O.index("water", 589)).angle, 0.05) && near(all.secondary, O.rainbow(O.index("water", 589), 2).angle, 0.05));
  check("red is outside the primary bow, inside the secondary", red.primary > violet.primary + 1 && red.secondary < violet.secondary - 2,
    `primary red ${red.primary.toFixed(2)}°, violet ${violet.primary.toFixed(2)}°; secondary red ${red.secondary.toFixed(2)}°, violet ${violet.secondary.toFixed(2)}°`);
  // White light through a 60° BK7 prism splits once, at the first face, and violet bends most.
  const T = O.trace([O.prism([0, 0], 4), O.ray([-4, -0.6], 15, { wl: "white" })], { fresnel: false });
  const out = T.segments.filter(s => s.via === "TT" && s.wl != null);
  const dev = Object.fromEntries(out.map(s => [s.wl, between([Math.cos(15 * DEG), Math.sin(15 * DEG)], dirOf(s))]));
  check("white light splits into 7 colors", out.length === 7 && T.segments[0].band.length === 7);
  check("violet is deviated more than red", dev[415] > dev[650] + 1, `violet ${dev[415].toFixed(2)}°, red ${dev[650].toFixed(2)}°`);
  check("deviation grows steadily from red to violet", O.WHITE.every((wl, i) => i === 0 || dev[wl] > dev[O.WHITE[i - 1]]));
  const plain = O.trace([O.prism([0, 0], 4, { n: 1.5 }), O.ray([-4, -0.6], 15, { wl: "white" })], { fresnel: false });
  check("a material without dispersion keeps white light together", plain.segments.every(s => s.band && s.wl == null));
  const sensor = O.trace([O.prism([0, 0], 4, { n: "flint" }), O.ray([-4, -0.6], 15, { wl: "white" }), O.sensor([6, -8], [6, 8], { name: "wall" })], { fresnel: false });
  const ys = sensor.sensors.wall.map(r => [r.wl, r.p[1]]).sort((a, b) => a[0] - b[0]);
  check("a sensor records where each color lands", ys.length === 7 && ys[0][1] < ys[6][1], `violet y ${ys[0][1].toFixed(2)}, red y ${ys[6][1].toFixed(2)}`);
}

// ---------- the eye ----------
{
  const E = O.eye();
  check("Gullstrand-Emsley eye: 60.5 D, emmetropic", near(E.power, 60.48, 0.05) && !Number.isFinite(E.farPoint), `${E.power.toFixed(2)} D, far point ${E.farPoint}`);
  check("relaxed eye focuses a distant point on the retina", O.eyeFocus(E, Infinity).where === "on");
  check("a book at 25 cm focuses behind the relaxed retina", O.eyeFocus(E, 250).where === "behind" && near(O.eyeFocus(E, 250).diopters, 4, 1e-9));
  const A = O.eye({ accommodation: 4 });
  check("accommodating 4 D brings 25 cm into focus", O.eyeFocus(A, 250).where === "on" && near(A.accommodation, 4, 1e-9), `defocus ${O.eyeFocus(A, 250).diopters.toFixed(4)} D`);
  check("near point is 1/amplitude", near(1000 / E.nearPoint, E.amplitude, 1e-6) && E.amplitude > 8, `${E.amplitude.toFixed(2)} D, near point ${E.nearPoint.toFixed(0)} mm`);
  const old = O.eye({ amplitude: 1 });
  check("an eye with 1 D left can't read at 25 cm", O.eye({ amplitude: 1, accommodation: 4 }).accommodation === 1 && near(old.nearPoint, 1000, 1e-6));
  const M = O.eye({ error: -3 });
  check("−3 D myope: far point at 33 cm, a longer eye", near(M.farPoint, 333.33, 0.01) && M.length > E.length + 0.8 && near(M.error, -3, 1e-9), `length ${M.length.toFixed(2)} mm`);
  check("myope sees distance blurred in front of the retina", O.eyeFocus(M).where === "front");
  const rx = O.correction(M);
  check("spectacles at 12 mm for a −3 D eye are −3.11 D", near(rx, -3.112, 0.001), `${rx.toFixed(3)} D`);
  const MC = O.eye({ error: -3, glasses: rx });
  check("diverging glasses put distance back on the retina", O.eyeFocus(MC).where === "on" && Math.abs(O.eyeFocus(MC).diopters) < 0.02, `residual ${O.eyeFocus(MC).diopters.toFixed(4)} D`);
  const H = O.eye({ error: 2 });
  check("+2 D hyperope: virtual far point 50 cm behind, focus behind retina", near(H.farPoint, -500, 0.01) && O.eyeFocus(H).where === "behind");
  const HC = O.eye({ error: 2, glasses: O.correction(H) });
  check("converging glasses fix the hyperope", O.correction(H) > 0 && O.eyeFocus(HC).where === "on");
  // Real rays through the eye agree with the paraxial verdict.
  const traced = E2 => { const T = O.trace([E2.items, O.eyeLight(E2, Infinity, { n: 11 })]); return O.focus(T.hits.filter(h => h.name === "retina")); };
  const fe = traced(E), fm = traced(M), fmc = traced(MC);
  check("traced rays in the relaxed eye meet within 0.25 mm of the retina", Math.abs(fe.p[0] - E.retina[0]) < 0.25, `${(fe.p[0] - E.retina[0]).toFixed(3)} mm`);
  check("traced rays in the myopic eye meet ~1 mm in front", fm.p[0] < M.retina[0] - 0.8, `${(fm.p[0] - M.retina[0]).toFixed(3)} mm`);
  check("traced rays through the glasses meet on the retina", Math.abs(fmc.p[0] - MC.retina[0]) < 0.25, `${(fmc.p[0] - MC.retina[0]).toFixed(3)} mm`);
  const T = O.trace([E.items, O.eyeLight(E, Infinity, { n: 15 })]);
  check("the iris stops rays outside the pupil", T.hits.some(h => h.name === "iris") && T.sensors.retina.length > 0);
  check("the eye is plain data", JSON.stringify(structuredClone(E)) === JSON.stringify(E));
}

// ---------- speed and data ----------
{
  const scene = [
    O.prism([0, 0], 3), O.lens([5, 0], { f: 6, aperture: 4 }), O.curvedMirror([12, 0], 10, { aperture: 6 }), O.drop([3, 4], 1),
    O.thinLens([-4, 0], 5, { aperture: 4 }), O.wall([-8, -6], [14, -6]), O.sensor([-8, 6], [14, 6]),
    O.fan([-6, 0.5], 0, 60, { n: 300 }),
  ];
  for (let i = 0; i < 20; i++) O.trace(scene);
  const t0 = performance.now();
  let T;
  for (let i = 0; i < 20; i++) T = O.trace(scene);
  const ms = (performance.now() - t0) / 20;
  check("300 rays through 7 elements trace well inside a frame", ms < 20, `${ms.toFixed(2)} ms, ${T.segments.length} segments with partial reflections`);
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) O.trace(scene, { fresnel: false });
  const ms2 = (performance.now() - t1) / 20;
  check("without partial reflections it's a third of that", ms2 < 3, `${ms2.toFixed(2)} ms`);
  check("trace results and scenes are plain data", JSON.stringify(structuredClone(T)) === JSON.stringify(T) && JSON.stringify(structuredClone(scene)) === JSON.stringify(scene));
  check("inside test", O.inside(O.circle([0, 0], 1), 0.5, 0.5) && !O.inside(O.circle([0, 0], 1), 0.8, 0.8));
  check("distance to an element", near(O.distance(O.mirror([0, -1], [0, 1]), [2, 0]), 2, 1e-12) && near(O.distance(O.circle([0, 0], 1), [3, 0]), 2, 1e-12));
}

// ---------- canvas helpers ----------
{
  const calls = [];
  const rec = name => (...args) => { calls.push(name); return name === "measure" ? String(args[0]).length * 7 : undefined; };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(String(k)); }), set: (t, k, v) => { t[k] = v; return true; } });
  const g = { w: 640, h: 400, ctx, lit: () => false };
  for (const k of ["line", "path", "circle", "rect", "arrow", "text", "measure", "label"]) g[k] = rec(k);
  g.rgba = (c, a) => c;
  const util = { color: c => c, rgb: () => [252, 252, 252], rgba: (c, a) => c, mix: c => c };
  check("one extension registered", window.__safisG.length === 1);
  window.__safisG[0](g, util);
  const P = q => [320 + q[0] * 20, 200 - q[1] * 20];
  P.sx = 20;
  const T = g.optics([O.prism([0, 0], 4, { label: "prism" }), O.mirror([6, -3], [8, 3]), O.thinLens([-6, 0], 4, { aperture: 4 }), O.curvedMirror([12, 0], 8),
    O.wall([-10, -8], [10, -8]), O.screen([-10, 8], [10, 8]), O.sensor([14, -4], [14, 4]), O.ray([-12, -0.5], 10, { wl: "white" }), O.fan([-12, 1], 0, 30, { n: 7 })],
  { P, arrows: true, focal: true, axis: true });
  check("g.optics returns hits with canvas positions", T.hits.length > 5 && T.hits.every(h => h.px && Number.isFinite(h.px[0])));
  const r = g.rayAngles(T.hits.find(h => h.kind === "refract"));
  check("g.rayAngles returns the angles", r && Number.isFinite(r.i) && Number.isFinite(r.t));
  const E = O.eye({ error: -2, glasses: -2 });
  const res = g.eye(E, { P: q => [100 + q[0] * 10, 200 - q[1] * 10], distance: 500 });
  check("g.eye traces the eye and reports focus", res.trace.sensors.retina.length > 0 && typeof res.focus.where === "string");
  const S = g.visibleSpectrum([20, 20, 300, 16], { marks: [{ wl: 589, label: "sodium" }] });
  check("g.visibleSpectrum maps wavelengths", Math.abs(S.x(380) - 20) < 1e-9 && Math.abs(S.wl(S.x(550)) - 550) < 1e-9);
  check("g.wavelengthColor gives a css color", /^rgb\(/.test(g.wavelengthColor(500)));
  check("helpers drew", calls.length > 300, `${calls.length} calls`);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
