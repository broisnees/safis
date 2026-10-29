#!/usr/bin/env node
// Tests for the physically based side of src/engine3d.js that run in Node (no WebGL):
// materials, black-body and temper colors, deterministic particles, the ideal gas
// pressure read from wall hits, and the airfoil flow the tracers follow.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
new Function(await readFile(path.join(root, "src/engine3d.js"), "utf8"))();
const E3 = window.E3, _ = E3._;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };

// Materials
const m = n => _.resolveMaterial(E3.node(null, n));
check("porcelain stays diagram shading", !m({ material: "porcelain" }).physical);
check("steel is a physical metal", m({ material: "steel" }).physical && m({ material: "steel" }).metal === 1);
check("legacy { color, metal: true } is a metal", m({ material: { color: "#888888", metal: true } }).metal === 1);
check("glass without opacity refracts", m({ material: "glass" }).kind === "glass");
check("glass with node opacity stays a ghost", m({ material: "glass", opacity: 0.3 }).kind === "ghost");
check("water refracts like glass, with ripples", m({ material: "water" }).kind === "glass" && !!m({ material: "water" }).water);
check("water with an opacity stays a ghost (tides page)", m({ material: "water", opacity: 0.45 }).kind === "ghost");
check("object form with base", m({ material: { base: "steel", roughness: 0.1 } }).roughness === 0.1);
check("inconel with temperature heat-tints", m({ material: "inconel", temperature: 700 }).heatShift === 150);
check("hot glows", m({ material: "hot" }).glow);
for (const n of ["porcelain", "ceramic", "steel", "brushed", "aluminum", "titanium", "copper", "brass", "inconel", "carbon", "rubber", "paint", "glass", "ghost", "hot", "bone", "graphite", "water"]) check(`material ${n} exists`, !!E3.MATERIALS[n]);
check("looks", ["studio", "diagram", "night", "outdoor"].every(k => E3.LOOKS[k]));

// Color physics
const bb = _.blackbody;
check("black body: 1000 K is red", bb(1000)[0] === 1 && bb(1000)[2] === 0);
check("black body: 6600 K is near white", bb(6600).every(v => v > 0.95));
check("glow is zero below 720 K and rises", _.glowOf(700) === 0 && _.glowOf(1500) > _.glowOf(1000));
const tint = T => _.heatTint(T).color;
check("temper: straw at 220 C", tint(493)[0] > tint(493)[2] + 0.2);
check("temper: blue at 300 C", tint(573)[2] > tint(573)[0]);
check("temper: none below 180 C", _.heatTint(400).amount === 0);
check("temperature field interpolates", Math.abs(_.tempAt(_.tempField({ stops: [[0, 300], [1, 700]] }), 0.5) - 500) < 1e-9);

// Particles: deterministic from seed and time
const make = () => E3.particles({ count: 300, seed: 7, life: [1, 2], cpu: true, emitter: { shape: "disk", radius: 0.5, speed: [1, 2], spread: 0.3 }, forces: { gravity: -9.8, drag: 0.2 } });
const a = make(), b = make();
a.simulate(3.0); b.simulate(1.0); b.simulate(2.0); b.simulate(3.0);
check("same seed and time give the same particles", a.alive().length > 0 && JSON.stringify(a.alive().slice(0, 20)) === JSON.stringify(b.alive().slice(0, 20)));
const c = make(); c.seed = 8; c.simulate(3.0);
check("another seed differs", JSON.stringify(a.alive()[0]) !== JSON.stringify(c.alive()[0]));
const fall = E3.particles({ count: 1, life: 10, prewarm: false, cpu: true, emitter: { speed: 0 }, forces: { gravity: -9.8 } });
fall.simulate(1.0);
const y = fall.alive()[0]?.position[1] ?? 0;
check("gravity: free fall about 4.9 m in 1 s", Math.abs(y + 4.9) < 0.3, y.toFixed(2));
const bounce = E3.particles({ count: 200, life: 3, cpu: true, emitter: { shape: "sphere", radius: 0.3, position: [0, 1, 0], speed: [0, 1], spread: Math.PI }, forces: { gravity: -9.8 }, colliders: [{ plane: [0, 1, 0, 0], bounce: 0.5 }] });
bounce.simulate(4);
check("floor collider keeps particles above y = 0", bounce.alive().every(p => p.position[1] >= -1e-6));

// Matter: each kind of particle moves as what it is made of says (turbulence off to measure).
const drop = (matter, t, o = {}) => {
  const s = E3.particles({ matter, count: 1, life: 30, prewarm: false, cpu: true, emitter: { speed: 0 }, ...o, forces: { turbulence: null, ...(o.forces || {}) } });
  s.simulate(t);
  return s.alive()[0]?.position[1] ?? NaN;
};
const vtFall = (vt, t) => -vt * (t - (1 - Math.exp(-(9.81 / vt) * t)) / (9.81 / vt));
check("dust settles at its terminal speed, 0.3 m/s", Math.abs(drop("dust", 5) - vtFall(0.3, 5)) < 0.02, drop("dust", 5).toFixed(3));
check("a water drop falls slower than free fall, as drag says", Math.abs(drop("water", 1) - vtFall(5.5, 1)) < 0.05, drop("water", 1).toFixed(2));
check("units: dust in millimeters falls 1000 times the number", Math.abs(drop("dust", 5, { units: "mm" }) / drop("dust", 5) - 1000) < 1);
check("hot smoke rises", drop("smoke", 2, { life: 8 }) > 2, drop("smoke", 2, { life: 8 }).toFixed(2));
check("steam rises, slower than smoke", drop("steam", 1, { life: 3 }) > 0.2 && drop("steam", 1, { life: 3 }) < drop("smoke", 1, { life: 8 }));
check("a bubble rises at about 0.25 m/s", Math.abs(drop("bubble", 4) - 1) < 0.03, drop("bubble", 4).toFixed(3));
check("drag is stable when stiff (dust at a 1/30 s step)", Number.isFinite(drop("dust", 20)) && drop("dust", 20) < 0);
const landed = drop("water", 3, { emitter: { speed: 0, position: [0, 1, 0] }, ground: 0 });
check("ground: water lands and stays on it", landed >= -1e-6 && landed < 0.01, landed.toFixed(4));
const sp = E3.particles({ matter: "spark", colliders: [{ plane: [0, 1, 0, 0] }] });
check("colliders take the matter's bounce", sp.colliders[0].bounce === E3.matter.spark.bounce);
check("explicit forces win over the preset", E3.particles({ matter: "smoke", forces: { drag: 9 } }).forces.drag === 9);
let threw = false; try { E3.particles({ matter: "plasma" }); } catch { threw = true; }
check("unknown matter is an error", threw);

// Ideal gas: pressure from wall hits matches N k T / V (k T = m sigma^2, m = 1)
const N = 400, sigma = 1.5, side = 1, H = 1.2;
const gas = E3.particles({
  count: N, life: Infinity, cpu: true, measure: true, measureWindow: 3, step: 1 / 120, seed: 3,
  emitter: { shape: "box", size: [side * 0.9, H * 0.9, side * 0.9], position: [0, H / 2, 0], speed: 0, thermal: sigma },
  colliders: [{ plane: [0, -1, 0, -H], bounce: 1 }, { plane: [0, 1, 0, 0], bounce: 1 }, { plane: [1, 0, 0, -side / 2], bounce: 1 }, { plane: [-1, 0, 0, -side / 2], bounce: 1 }, { plane: [0, 0, 1, -side / 2], bounce: 1 }, { plane: [0, 0, -1, -side / 2], bounce: 1 }],
});
gas.simulate(4);
const p = gas.hits[0] / (side * side), ideal = (N * sigma * sigma) / (side * side * H);
check("ideal gas: piston pressure within 10% of N k T / V", Math.abs(p / ideal - 1) < 0.1, `${p.toFixed(0)} vs ${ideal.toFixed(0)}`);

// Airfoil flow: free stream far away, smooth trailing edge (Kutta), lift 2 pi sin(alpha + beta)
const wing = E3.flow.airfoil({ chord: 2, thickness: 0.12, camber: 0.04, alpha: 0.1, U: 1 });
const far = wing.velocity([-60, 0, 0]);
check("airfoil: free stream far upstream", Math.abs(far[0] - 1) < 0.02 && Math.abs(far[1]) < 0.02);
const top = wing.velocity([0, 0.25, 0]), bottom = wing.velocity([0, -0.25, 0]);
check("airfoil: faster over the top", Math.hypot(...top) > Math.hypot(...bottom));
check("airfoil: lift coefficient", Math.abs(wing.lift - 2 * Math.PI * Math.sin(0.1 + wing.spec.beta)) < 1e-9);
const outline = wing.outline(96), xs = outline.map(q => q[0]);
check("airfoil outline spans the chord", Math.abs(Math.max(...xs) - Math.min(...xs) - 2 * Math.cos(0.1)) < 0.08);
check("inside the wing has no velocity", wing.velocity([0, 0.02, 0]) === null);

// Quality tiers
check("three tiers", ["low", "medium", "high"].every(k => E3.quality.tiers[k]));
const sc = E3.scene();
check("a still frame never runs as moving", !_.qualityFor(sc, { still: true }, 2, 1000).moving && !_.qualityFor(sc, { still: true }, 1, 1010).moving);
check("a frame in a stream runs as moving", _.qualityFor(sc, {}, 2, 1020).moving);

// Plume: expansion follows the throttle; two lights
const pl = E3.plume({ radius: 0.5, length: 6, throttle: 1 });
check("plume defaults to a slightly over-expanded jet", Math.abs(pl.expansionNow - 0.8) < 1e-9);
pl.throttle = 0.5;
check("throttling down runs more over-expanded", pl.expansionNow < 0.8 && pl.lengthNow < 6);
check("plume lights: one at the nozzle, one down the jet", pl.glowLights().length === 2 && pl.glowLights()[0].position[1] > pl.glowLights()[1].position[1]);
pl.throttle = 0;
check("no lights when off", pl.glowLights().length === 0);
check("paint is neutral by default", m({ material: "paint" }).rgb.every(v => v > 0.85) && Math.abs(m({ material: "paint" }).rgb[0] - m({ material: "paint" }).rgb[2]) < 0.1);
check("smoke defaults: no glow, segments unset", E3.particles({}).glow === 0 && E3.particles({}).segments === null);


// Light transport: the BVH finds the same hits as brute force, lights follow the inverse-square
// and cosine laws, solid angles match closed forms, presets can be added and are checked.
{
  const scene = E3.scene();
  scene.add(E3.mesh.box(2, 0.01, 2), { name: "floor", position: [0, -0.005, 0] });
  scene.add(E3.mesh.box(0.8, 0.8, 0.02), { name: "wall", position: [0, 0.4, 0] });
  for (let i = 0; i < 30; i++) scene.add(E3.mesh.sphere(0.05, { segments: 10 }), { name: "b" + i, position: [Math.sin(i) * 0.7, 0.1 + (i % 5) * 0.12, Math.cos(i * 1.7) * 0.7] });
  const down = E3.trace(scene, [0.5, 1, 0.5], [0, -1, 0]);
  check("trace: a ray straight down lands on the floor", !!down && Math.abs(down.point[1]) < 1e-6 && down.node.name === "floor", down && down.point.join(","));
  check("trace: the wall stops a ray through it", E3.trace(scene, [0, 0.4, 1], [0, 0, -1]).node.name === "wall");
  check("trace: a ray into empty sky misses", E3.trace(scene, [0, 2, 0], [0, 1, 0]) === null);
  // Brute force against every triangle, for random rays.
  const items = [];
  scene.traverse(n => { if (n.mesh) items.push(n); });
  const brute = (o, d) => {
    let best = Infinity;
    for (const n of items) {
      const W = n.world(), P = n.mesh.positions, I = n.mesh.indices;
      const at = k => E3.m4.apply(W, [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]);
      for (let t = 0; t < I.length; t += 3) {
        const a = at(I[t]), b = at(I[t + 1]), c = at(I[t + 2]), v = E3.v3;
        const e1 = v.sub(b, a), e2 = v.sub(c, a), pv = v.cross(d, e2), det = v.dot(e1, pv);
        if (Math.abs(det) < 1e-14) continue;
        const tv = v.sub(o, a), u = v.dot(tv, pv) / det; if (u < 0 || u > 1) continue;
        const qv = v.cross(tv, e1), w = v.dot(d, qv) / det; if (w < 0 || u + w > 1) continue;
        const tt = v.dot(e2, qv) / det; if (tt > 1e-9 && tt < best) best = tt;
      }
    }
    return best;
  };
  let agree = 0;
  for (let i = 0; i < 200; i++) {
    const o = [Math.sin(i * 1.3) * 1.5, 0.3 + Math.abs(Math.cos(i * 0.7)), Math.cos(i * 2.1) * 1.5];
    const d = E3.v3.norm([-o[0] + Math.sin(i) * 0.3, -0.4 - (i % 3) * 0.2, -o[2] + Math.cos(i * 3) * 0.3]);
    const h = E3.trace(scene, o, d), b = brute(o, d);
    if ((h === null && b === Infinity) || (h && Math.abs(h.t - b) < 1e-6)) agree++;
  }
  check("trace: the BVH agrees with brute force on 200 rays", agree === 200, `${agree}/200`);

  // Radiometry: a 100 W point light 2 m above a floor gives P / (4 pi r^2) under it.
  const rig = _.lightRig({ units: "m", lights: [{ type: "point", position: [0, 2, 0], power: 100 }] });
  const I = rig[0].rgb[1];
  check("point light: intensity is P / 4 pi (W/sr)", Math.abs(I - 100 / (4 * Math.PI)) < 1e-9);
  const rigCm = _.lightRig({ units: "cm", lights: [{ type: "sphere", position: [0, 200, 0], radius: 10, power: 100 }] })[0];
  check("sphere light: radiance P / (4 pi^2 R^2) with R in meters", Math.abs(rigCm.radiance - 100 / (4 * Math.PI ** 2 * 0.01)) < 1e-6);
  const rect = _.lightRig({ units: "m", lights: [{ type: "rect", position: [0, 1, 0], size: [0.5, 0.2], power: 50 }] })[0];
  check("rect light: radiance P / (pi A), facing down", Math.abs(rect.radiance - 50 / (Math.PI * 0.1)) < 1e-6 && E3.v3.norm(E3.v3.cross(rect.U, rect.V))[1] < -0.99);
  const aimed = _.lightRig({ lights: [{ type: "disk", position: [0, 1, 0], radius: 0.2, power: 10, target: [1, 1, 0] }] })[0];
  check("disk light: aimed at its target", E3.v3.norm(E3.v3.cross(aimed.U, aimed.V))[0] > 0.99);
  check("old studio point lights stay studio lights", _.lightRig({ lights: [{ position: [0, 1, 0], color: "#fff", intensity: 1 }] }).length === 0);

  // Solid angle: a sphere of radius R at distance d subtends 2 pi (1 - sqrt(1 - R^2/d^2)).
  const sa = E3.solidAngle([0, 0, 0], [0, 1, 0], { type: "sphere", position: [0, 2, 0], radius: 0.5 });
  const exact = 2 * Math.PI * (1 - Math.sqrt(1 - 0.25 / 4));
  check("solid angle of a sphere overhead", Math.abs(sa.omega - exact) / exact < 0.01, `${sa.omega.toFixed(4)} vs ${exact.toFixed(4)}`);
  // A small square of side a at height h overhead: about a^2 / h^2, all of it near the normal.
  const sq = E3.solidAngle([0, 0, 0], [0, 1, 0], { type: "rect", position: [0, 1, 0], size: [0.1, 0.1] });
  check("solid angle of a small square overhead", Math.abs(sq.omega - 0.01) / 0.01 < 0.02 && Math.abs(sq.projected - sq.omega) / sq.omega < 0.01, sq.omega.toFixed(5));
  const tilt = E3.solidAngle([0, 0, 0], [0, 1, 0], { type: "rect", position: [1, 1, 0], size: [0.1, 0.1] });
  check("projected solid angle carries the cosine", Math.abs(tilt.projected / tilt.omega - Math.SQRT1_2) < 0.02);

  // The Sun reddens as it sets.
  const noon = _.sunTransmittance([0, 1, 0]), low = _.sunTransmittance([1, 0.03, 0]);
  check("sunlight: nearly white at noon, red at sunset", noon.every(v => v > 0.6) && low[0] > low[1] * 1.5 && low[1] > low[2]);
  check("sunlight: none below the horizon", _.sunTransmittance([1, -0.2, 0]).every(v => v === 0));

  // New presets from a page.
  E3.define.material("ice", { base: "glass", ior: 1.31, roughness: 0.08 });
  check("define.material: a new material resolves", m({ material: "ice" }).kind === "glass" && m({ material: "ice" }).ior === 1.31);
  let err = "";
  try { E3.define.material("bad", { rougness: 0.2 }); } catch (e) { err = e.message; }
  check("define.material: a misspelled key fails loudly", /unknown key "rougness"/.test(err));
  E3.define.matter("ash", { vt: 0.5, style: "dot", life: [3, 6], size: [0.003, 0.003], color: "#777777" });
  const ash = E3.particles({ matter: "ash", units: "m" });
  check("define.matter: falls at its terminal speed", Math.abs(-ash.forces.gravity / ash.forces.drag - 0.5) < 1e-9);
  err = "";
  try { E3.define.matter("fog", { style: "smoke", life: [1, 2], size: [0.1, 1] }); } catch (e) { err = e.message; }
  check("define.matter: says how to make it move", /terminal fall speed/.test(err));
  check("motes settle at a few mm/s", E3.matter.motes.vt < 0.01);

  // Grass: one blade per root, every blade rooted on the patch, a lawn's heights.
  const lawn = E3.grass({ size: 0.4, count: 500, seed: 1 });
  const B = lawn.blades.mesh, hts = [];
  for (let i = 3; i < B.extra[3][0].length; i += 2) hts.push(B.extra[3][0][i]);
  check("grass: blades between 6 and 14 cm", hts.every(h => h >= 0.06 - 1e-9 && h <= 0.14 + 1e-9));
  check("grass: roots inside the patch", Array.from({ length: 500 }, (_, b) => B.extra[2][0].slice(b * 9 * 4, b * 9 * 4 + 3)).every(r => Math.abs(r[0]) <= 0.2 && Math.abs(r[2]) <= 0.2));
  const globe = E3.earth();
  const p0 = globe.at(0, 0), pn = globe.at(90, 0), pe = globe.at(0, 90);
  check("earth: lat 0 lon 0 faces +z, north is +y, east is +x", p0[2] > 0.99 && pn[1] > 0.99 && pe[0] > 0.99);
}

// Water: the dispersion relation, the FFT the GPU runs, ring speeds, the sea's statistics, determinism.
{
  const om = E3.water.omega, g = 9.81;
  const c = (lam, h, ten) => om((2 * Math.PI) / lam, h, ten) / ((2 * Math.PI) / lam);
  check("water: deep gravity waves, c = sqrt(g / k) (10 m waves at 3.95 m/s)", Math.abs(c(10, Infinity, false) - Math.sqrt((g * 10) / (2 * Math.PI))) < 1e-9, c(10, Infinity, false).toFixed(3));
  check("water: long waves in shallow water, c = sqrt(g h)", Math.abs(c(100, 0.5, false) / Math.sqrt(g * 0.5) - 1) < 0.01, c(100, 0.5, false).toFixed(3));
  let cmin = Infinity, lmin = 0;
  for (let lam = 0.005; lam < 0.05; lam *= 1.001) { const v = c(lam, Infinity, true); if (v < cmin) { cmin = v; lmin = lam; } }
  check("water: slowest ripples 23 cm/s at 1.7 cm (capillary-gravity minimum)", Math.abs(cmin - 0.231) < 0.003 && Math.abs(lmin - 0.0171) < 0.0005, `${(cmin * 100).toFixed(1)} cm/s at ${(lmin * 100).toFixed(2)} cm`);
  check("water: 3 mm ripples are surface tension waves, c = sqrt(sigma k / rho)", Math.abs(c(0.003, Infinity, true) / Math.sqrt((0.0728 / 998.2) * (2 * Math.PI / 0.003) + g / (2 * Math.PI / 0.003)) - 1) < 1e-9);

  // The inverse FFT (Stockham, the same butterflies as the GPU pass) against the plain sum.
  const N = 16, re = Array.from({ length: N }, (_, i) => Math.sin(i * 1.7) + 0.3 * i), im = Array.from({ length: N }, (_, i) => Math.cos(i * 0.9));
  const [fr, fi] = _.waterIfft1(re, im);
  let err = 0;
  for (let j = 0; j < N; j++) {
    let sr = 0, si = 0;
    for (let m = 0; m < N; m++) { const a = (2 * Math.PI * m * j) / N; sr += re[m] * Math.cos(a) - im[m] * Math.sin(a); si += re[m] * Math.sin(a) + im[m] * Math.cos(a); }
    err = Math.max(err, Math.abs(sr - fr[j]), Math.abs(si - fi[j]));
  }
  check("water: the GPU's inverse FFT matches the direct sum", err < 1e-9, err.toExponential(1));

  // A drop in shallow water: the ring's crest runs out at sqrt(g h).
  const shallow = E3.water({ size: 4, depth: 0.05, tension: false, damping: 0, resolution: 128, basin: false });
  shallow.drop([0, 0], { time: 0, r: 0.2, amp: 0.01, shape: "bump" });
  const xs = Array.from({ length: 160 }, (_, i) => 0.3 + i * 0.01);
  const line = _.waterPoolLine(shallow, xs.map(x => [x, 0]), 1);
  const crest = xs[line.indexOf(Math.max(...line))];
  check("water: a ring in 5 cm of water runs at sqrt(g h) = 0.70 m/s", Math.abs(crest - Math.sqrt(g * 0.05)) < 0.06, `crest at ${crest.toFixed(2)} m after 1 s`);

  // A pebble in deep water (Cauchy-Poisson): at distance r after time t the waves have the length
  // whose group speed is r / t: k = g t² / (4 r²). At 0.8 m after 2 s: 41 cm.
  const deep = E3.water({ size: 6, depth: 50, tension: false, damping: 0, resolution: 128, basin: false });
  deep.drop([0, 0], { time: 0, r: 0.06, amp: -0.01 });
  const rs = Array.from({ length: 400 }, (_, i) => 0.5 + i * 0.0015);
  const hl = _.waterPoolLine(deep, rs.map(r => [r, 0]), 2);
  const zc = [];
  for (let i = 1; i < rs.length; i++) if (hl[i - 1] * hl[i] < 0) zc.push(rs[i - 1] + (rs[i] - rs[i - 1]) * hl[i - 1] / (hl[i - 1] - hl[i]));
  const i8 = zc.findIndex(z => z > 0.8), rm = (zc[i8] + zc[i8 - 1]) / 2, k8 = Math.PI / (zc[i8] - zc[i8 - 1]), kth = (g * 4) / (4 * rm * rm);
  // (Leading-order stationary phase, read from zero crossings: good to about 15% here; a wrong
  // dispersion law, e.g. waves that don't disperse or twice the frequency, is off by factors.)
  check("water: deep-water rings sort by wavelength, k = g t^2 / 4r^2", i8 > 0 && Math.abs(k8 / kth - 1) < 0.15, `k ${k8.toFixed(1)} vs ${kth.toFixed(1)} rad/m at ${rm.toFixed(2)} m`);

  // Reflecting walls: the water's slope across a wall is zero (it meets the wall flat).
  const wall = E3.water({ size: 2, depth: 1, tension: false, damping: 0, resolution: 128, basin: false });
  wall.drop([0.8, 0], { time: 0, r: 0.05, amp: -0.005 });
  const [a1, a2, a3] = _.waterPoolLine(wall, [[0.99, 0.1], [1.0, 0.1], [0.9, 0.1]], 0.7);
  check("water: walls reflect (no slope at the wall)", Math.abs(a2 - a1) < 0.1 * Math.abs(a3 - a1) + 1e-7, `${(a2 - a1).toExponential(1)} vs ${(a3 - a1).toExponential(1)}`);

  // Determinism: the same drops and seed give the same water at the same time.
  const twin = () => { const w = E3.water({ size: 2, depth: 1, resolution: 64, basin: false, ripples: 0.001, seed: 4 }); w.drop([0.2, -0.3], { time: 0.5 }); return w; };
  const hA = twin().heightAt(0.1, 0.1, 2.25), hB = twin().heightAt(0.1, 0.1, 2.25);
  check("water: the pool is the same at the same time", hA === hB && hA !== 0, hA.toExponential(3));

  // The sea: Hs = 0.21 U²/g (Pierson-Moskowitz), every mode turning at its own ω(k), seeded.
  const sea = E3.water({ mode: "ocean", wind: 10, seed: 3, resolution: 64 });
  const f0 = _.oceanHeightField(sea, 0, 0), f1 = _.oceanHeightField(sea, 0, 1);
  const vr = f => f.h.reduce((s, v) => s + v * v, 0) / f.h.length;
  const Hs = 4 * Math.sqrt(vr(f0) + vr(f1));
  check("water: the sea's significant wave height is 0.21 U^2 / g (2.1 m at 10 m/s)", Math.abs(Hs / ((0.21 * 100) / g) - 1) < 0.2, `${Hs.toFixed(2)} m`);
  const C = f0.cascade, Nn = f0.N;
  let best = 0, bx = 0, bz = 0;
  for (let z = 0; z < Nn; z++) for (let x = 0; x < Nn; x++) { const e = C.h0[(z * Nn + x) * 4] ** 2 + C.h0[(z * Nn + x) * 4 + 1] ** 2; if (e > best) { best = e; bx = x; bz = z; } }
  const kx = (bx < Nn / 2 ? bx : bx - Nn) * C.dk, kz = (bz < Nn / 2 ? bz : bz - Nn) * C.dk, T = (2 * Math.PI) / om(Math.hypot(kx, kz), sea.depth, true);
  const proj = t => { const f = _.oceanHeightField(sea, t, 0).h; let r = 0, i = 0; for (let z = 0; z < Nn; z++) for (let x = 0; x < Nn; x++) { const a = (2 * Math.PI * ((bx * x + bz * z) % Nn)) / Nn; r += f[z * Nn + x] * Math.cos(a); i -= f[z * Nn + x] * Math.sin(a); } return [r, i]; };
  const [p0r, p0i] = proj(1), [phr, phi] = proj(1 + T / 2), [pTr, pTi] = proj(1 + T);
  const mag = Math.hypot(p0r, p0i);
  check("water: the strongest sea wave turns at omega(k): half a period flips it, a period restores it", Math.hypot(p0r + phr, p0i + phi) < 1e-6 * mag + 1e-12 && Math.hypot(p0r - pTr, p0i - pTi) < 1e-6 * mag + 1e-12, `period ${T.toFixed(2)} s`);
  const sea2 = E3.water({ mode: "ocean", wind: 10, seed: 3, resolution: 64 }), sea3 = E3.water({ mode: "ocean", wind: 10, seed: 4, resolution: 64 });
  check("water: the same seed gives the same sea, another seed another", _.oceanHeightField(sea2, 5, 0).h[77] === _.oceanHeightField(sea, 5, 0).h[77] && _.oceanHeightField(sea3, 5, 0).h[77] !== _.oceanHeightField(sea, 5, 0).h[77]);
  const S = _.oceanSetup(sea);
  check("water: slopes the sea doesn't draw become roughness (Cox and Munk)", S.subSlope > 0 && S.subSlope < S.msSlope && Math.abs(S.msSlope - (0.003 + 0.0512)) < 1e-9, `resolved ${S.resolvedSlope.toFixed(4)}, unresolved ${S.subSlope.toFixed(4)}`);

  // Absorption (Pope and Fry 1997): through 1 m of pure water red keeps 64%, blue 98%; a white
  // tile 3 m down (6 m of water there and back) loses most of its red and turns blue-green.
  const ab = E3.water.bodies.clear.absorb, Tm = L => ab.map(a => Math.exp(-a * L));
  check("water: absorption, red most and blue least, of the right size", ab[0] > 0.3 && ab[0] < 0.6 && ab[1] > 0.04 && ab[1] < 0.1 && ab[2] > 0.005 && ab[2] < 0.03);
  check("water: deeper is bluer and darker", Tm(6)[0] < 0.1 && Tm(6)[2] > 0.9 && Tm(12).every((v, i) => v < Tm(6)[i]), Tm(6).map(v => v.toFixed(2)).join(" "));
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
