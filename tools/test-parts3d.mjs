#!/usr/bin/env node
// Geometry tests for src/parts3d.js (E3.parts), run in Node without WebGL: closed meshes,
// outward winding, the bell's area ratio, blade counts, kinematics, and the turbofan's
// bypass ratio from its annulus areas.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
new Function(await readFile(path.join(root, "src/engine3d.js"), "utf8"))();
new Function(await readFile(path.join(root, "src/parts3d.js"), "utf8"))();
const { v3 } = window.E3, P = window.E3.parts;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const tri = (m, t) => [0, 1, 2].map(k => { const i = m.indices[t + k] * 3; return [m.positions[i], m.positions[i + 1], m.positions[i + 2]]; });
function volume(m) { let v = 0; for (let t = 0; t < m.indices.length; t += 3) { const [a, b, c] = tri(m, t); v += v3.dot(a, v3.cross(b, c)) / 6; } return v; }
// Closed: after welding by position, every edge is used once in each direction.
function watertight(m) {
  const key = p => p.map(x => Math.round(x * 1000)).join(",");
  const edges = new Map();
  for (let t = 0; t < m.indices.length; t += 3) {
    const k = tri(m, t).map(key);
    for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e + 1) % 3]; if (a === b) continue; const id = `${a}|${b}`; edges.set(id, (edges.get(id) || 0) + 1); }
  }
  let bad = 0;
  for (const [id, n] of edges) { const [a, b] = id.split("|"); if (n !== (edges.get(`${b}|${a}`) || 0)) bad++; }
  return bad;
}
// Share of triangles whose vertex normals agree with their winding.
function normalsAgree(m) {
  let good = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = tri(m, t), n = v3.cross(v3.sub(b, a), v3.sub(c, a));
    const vn = [0, 1, 2].reduce((s, k) => { const i = m.indices[t + k] * 3; return v3.add(s, [m.normals[i], m.normals[i + 1], m.normals[i + 2]]); }, [0, 0, 0]);
    if (v3.len(n) < 1e-9 || v3.dot(n, vn) > 0) good++;
  }
  return good / (m.indices.length / 3);
}
const solid = (name, m) => {
  const bad = watertight(m), vol = volume(m), agree = normalsAgree(m);
  check(`${name} is closed, outward, and shaded consistently`, bad === 0 && vol > 0 && agree > 0.995, `${bad} open edges, volume ${vol.toExponential(2)}, normals ${(agree * 100).toFixed(1)}%`);
};

// ---------- profiles ----------
const f = P.fillet([[0, 0], [10, 0, 2], [10, 10]]);
check("fillet replaces a corner with an arc of the given radius", f.length > 3 && f.every(p => p[0] <= 10 + 1e-9) && f.some(p => Math.abs(Math.hypot(p[0] - 8, p[1] - 2) - 2) < 1e-6));
const r = P.route([[0, 0, 0], [100, 0, 0], [100, 100, 0]], 30);
const mid = r.filter(p => p[0] > 70 && p[1] < 30 && p[1] > 0);
check("pipe route bends on a true radius", mid.length > 2 && mid.every(p => Math.abs(Math.hypot(p[0] - 70, p[1] - 30) - 30) < 1e-6));
const nc = P.naca("2412", 20), xs = nc.map(p => p[0]), th = Math.max(...nc.map(p => p[1])) - Math.min(...nc.map(p => p[1]));
check("NACA 2412 spans one chord and is about 12% thick", near(Math.min(...xs), 0, 1e-3) && near(Math.max(...xs), 1, 1e-3) && th > 0.11 && th < 0.15, th.toFixed(3));

// ---------- the bell nozzle ----------
for (const eps of [8, 16, 40]) {
  const noz = P.bellNozzle({ throat: 100, expansion: eps });
  const wall = noz.find("nozzle wall").mesh, p = wall.positions;
  let rt = Infinity, re = Infinity;
  const yExit = -noz.contour.length;
  for (let i = 0; i < p.length; i += 3) {
    const rr = Math.hypot(p[i], p[i + 2]);
    rt = Math.min(rt, rr);
    if (Math.abs(p[i + 1] - yExit) < 1e-3) re = Math.min(re, rr);
  }
  const ratio = (re * re) / (rt * rt);
  check(`bell nozzle area ratio matches ${eps} (measured on the mesh)`, near(ratio, eps, 0.02), ratio.toFixed(2));
}
const C = P.bellContour({ throat: 100, expansion: 16 });
check("80% bell is 80% of a 15° cone's length", near(C.length, (0.8 * (400 - 100 + 38.2 * (1 / Math.cos(Math.PI / 12) - 1))) / Math.tan(Math.PI / 12), 1e-6), C.length.toFixed(1));
check("Rao angles for ε = 16 are about 28° and 9.5°", C.thetaN > 27 && C.thetaN < 29 && C.thetaE > 9 && C.thetaE < 10.5, `${C.thetaN.toFixed(1)}°, ${C.thetaE.toFixed(1)}°`);
const noz = P.bellNozzle({ throat: 100, expansion: 16 });
solid("nozzle wall", noz.find("nozzle wall").mesh);
solid("regen tube jacket", noz.find("regen tubes").mesh);

// ---------- parts are closed solids ----------
solid("combustion chamber", P.combustionChamber({ throat: 100 }).find("chamber").mesh);
solid("bolt", P.bolt({ d: 10, length: 40 }));
solid("nut", P.nut({ d: 10 }));
solid("flange", P.flange({ pipe: 40 }));
solid("hollow pipe", P.pipe([[0, 0, 0], [200, 0, 0], [200, 150, 80]], { radius: 20 }).children[0].mesh);
solid("stepped shaft", P.shaft());
solid("hollow shaft", P.shaft({ bore: 20 }));
solid("spring", P.spring());
solid("bellows", P.bellows());
solid("impeller", P.impeller());
solid("volute", P.volute());
solid("tank", P.tank().children[0].mesh);
solid("twisted blade", P.blade({ span: 200, chord: [80, 50], twist: [10, 45] }));
const b = P.bearing({ bore: 20 });
solid("bearing inner ring", b.find("inner ring").mesh);
solid("bearing outer ring", b.find("outer ring").mesh);
solid("cutaway nacelle (open wedge with caps)", P.nacelle({ arc: Math.PI * 1.5 }));

// ---------- stages and counts ----------
const rs = P.rotorStage({ blades: 24, hub: 100, tip: 200 });
const one = P.blade({ span: 100 });
check("rotor stage has the blades it was asked for", rs.find("rotor blades").mesh.indices.length % 24 === 0);
solid("rotor stage blades", rs.find("rotor blades").mesh);
const tf = P.turbofan();
const fanB = tf.parts["fan"].find("fan blades").mesh;
let maxR = 0;
for (let i = 0; i < fanB.positions.length; i += 3) maxR = Math.max(maxR, Math.hypot(fanB.positions[i], fanB.positions[i + 2]));
check("turbofan has 18 fan blades that clear the fan case", tf.info.fanBlades === 18 && fanB.indices.length % 18 === 0 && maxR < 905 && maxR > 880, `tip radius ${maxR.toFixed(1)} mm`);
solid("fan blades", fanB);
check("turbofan bypass ratio from annulus areas is high-bypass (5 to 12)", tf.info.bypassRatio > 5 && tf.info.bypassRatio < 12, tf.info.bypassRatio.toFixed(1));
check("turbofan spools turn independently", (() => { tf.pose({ low: 1, high: 3 }); return tf.spools.low.rotation[1] === 1 && tf.spools.high.rotation[1] === 3; })());
check("turbofan cutaway swaps whole casings for cut ones", (() => { tf.cutaway(true); const on = tf.parts["nacelle"].children.map(c => c.visible).join(); tf.cutaway(false); return on === "false,true"; })());

// ---------- assemblies ----------
const eng = P.rocketEngine();
const ex = eng.ports.nozzleExit;
check("rocket nozzle exit is at the bottom, facing down, at the bell's exit radius", Math.abs(ex.center[1]) < 1e-3 && near(ex.normal[1], -1, 1e-6) && near(ex.radius, eng.info.exit, 1e-6));
eng.pose({ pitch: 0.08 });
const ex2 = eng.ports.nozzleExit;
check("gimbaling swings the nozzle exit about the pivot", Math.abs(ex2.center[2]) > 50 && near(v3.dist(ex2.center, [0, eng.info.pivot, 0]), eng.info.pivot, 1e-3), ex2.center.map(v => v.toFixed(0)).join(", "));
check("gimbal angles are clamped to the range", (() => { eng.pose({ pitch: 1 }); return near(eng.gimbal.pitch, eng.gimbal.range, 1e-9); })());
check("rocket engine exposes two pump shafts", eng.shafts.length === 2 && eng.shafts.every(s => s.name === "rotor"));
eng.explode(1);
check("explode moves the nozzle down and the frame up", eng.parts["nozzle"].position[1] < eng.info.nozzleLength - 100 && eng.parts["thrust frame"].position[1] > 100);
eng.explode(0);
check("labels come back in world coordinates", eng.labels().length > 10 && eng.labels().every(l => l.at.every(Number.isFinite)));

const pe = P.pistonEngine();
const B = pe.info.bore, S = pe.info.stroke;
check("2.0 L inline four from 86 x 86 mm", near(pe.info.displacement, 1998, 0.002), `${pe.info.displacement.toFixed(0)} cc`);
const yAt = th => { pe.pose({ crank: th }); return pe.parts["piston 1"].position[1]; };
check("piston 1 travels exactly one stroke", near(yAt(0) - yAt(Math.PI), S, 1e-6), (yAt(0) - yAt(Math.PI)).toFixed(3));
const lifts = Array.from({ length: 72 }, (_, i) => pe.lift(1, "intake", (i / 72) * 4 * Math.PI));
check("each intake valve opens once per two crank turns", lifts.filter((l, i) => l > 0.5 && !(lifts[(i + 71) % 72] > 0.5)).length === 1, `max ${Math.max(...lifts).toFixed(1)} mm`);
void B; void one;

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
