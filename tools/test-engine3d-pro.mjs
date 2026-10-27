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
check("water stays a ghost", m({ material: "water" }).kind === "ghost");
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

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
