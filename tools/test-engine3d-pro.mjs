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

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
