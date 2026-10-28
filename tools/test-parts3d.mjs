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

// ---------- triangle budgets and detail ----------
const tris = node => { let n = 0; node.traverse(x => { if (!x.mesh) return; for (let q = x; q; q = q.parent) if (q.visible === false) return; n += x.mesh.indices.length / 3; }); return n; };
const bounds = node => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; node.traverse(x => { if (!x.mesh) return; for (let q = x; q; q = q.parent) if (q.visible === false) return; const W = x.world(), p = x.mesh.positions; for (let i = 0; i < p.length; i += 3) { const w = window.E3.m4.apply(W, [p[i], p[i + 1], p[i + 2]]); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); } } }); return { mn, mx }; };
const tRocket = tris(eng), tFan = tris(tf);
check("rocket engine stays under 230k triangles", tRocket < 230e3, `${(tRocket / 1000).toFixed(0)}k`);
check("turbofan stays under 300k triangles", tFan < 300e3, `${(tFan / 1000).toFixed(0)}k`);
const tRocketLo = tris(P.rocketEngine({ detail: 0.5 })), tFanLo = tris(P.turbofan({ detail: 0.5 }));
check("detail 0.5 cuts the rocket and turbofan to under 65%", tRocketLo < 0.65 * tRocket && tFanLo < 0.65 * tFan, `${(tRocketLo / 1000).toFixed(0)}k, ${(tFanLo / 1000).toFixed(0)}k`);
check("detail does not leak out of the build", (() => { const full = tris(P.turbopump()); P.turbopump({ detail: 0.4 }); return tris(P.turbopump()) === full; })());

// ---------- labels inside, rocket cutaway ----------
const inside = ["high-pressure compressor", "combustor", "LP shaft"];
const texts = a => a.labels().map(l => l.text);
tf.cutaway(false);
check("turbofan hides labels of parts inside the casings when closed", inside.every(t => !texts(tf).includes(t)) && texts(tf).includes("fan blades"));
tf.cutaway(true);
check("turbofan returns the inside labels when cut away", inside.every(t => texts(tf).includes(t)));
tf.cutaway(false);
const pumpHousing = eng.pumps[0].parts["pump housing"];
const housingVis = () => pumpHousing.children.map(c => c.visible).join();
const before = housingVis();
eng.cutaway(true);
check("rocket cutaway opens both pumps' housings", housingVis() !== before && housingVis() === "false,true" && eng.pumps[1].parts["bearing housing"].children[1].visible === true && eng.open);
eng.pose({ spin: 0 }); const r0 = eng.rotors.map(r => r.rotation[1]).join();
eng.pose({ spin: 1 }); const r1 = eng.rotors.map(r => r.rotation[1]).join();
check("rocket rotors spin with pose, the fuel pump faster", r0 !== r1 && eng.rotors[1].rotation[1] > eng.rotors[0].rotation[1]);
eng.cutaway(false);

// ---------- chain ----------
const chainM = P.chain([[0, 0, 0], [200, 0, 0], [200, 100, 0], [0, 100, 0]], { pitch: 12.7 });
check("chain lays one link per pitch around a closed path", Math.abs(chainM.chain.links - 600 / 12.7) < 1 && chainM.indices.length > 0);

// ---------- gearbox ----------
const gb = P.gearbox();
check("gearbox: two stages multiply to the ratio", near(gb.info.ratio, 12.25, 0.01) && gb.info.teeth.length === 4, gb.info.ratio.toFixed(2));
check("gearbox: 35 or more named parts with input and output ports", Object.keys(gb.parts).length >= 35 && gb.ports.input && gb.ports.output);
gb.pose({ input: 2.0 });
check("gearbox: output turns input / ratio, the same way", near(gb.shafts[2].rotation[2], 2.0 / gb.info.ratio, 1e-9) && gb.shafts[1].rotation[2] < 0);
// Teeth interleave: toward its pinion, the driven gear shows a gap (nothing past the pitch circle).
gb.pose({ input: 0 });
const rimToward = (name, dir, zTeeth) => { const n = gb.parts[name], W = n.world(), p = n.mesh.positions, cx = n.parent.position[0]; let r = 0; for (let i = 0; i < p.length; i += 3) { const q = window.E3.m4.apply(W, [p[i], p[i + 1], p[i + 2]]), d = [q[0] - cx, q[1]], a = Math.atan2(d[1], d[0]), da = Math.atan2(Math.sin(a - dir), Math.cos(a - dir)); if (Math.abs(da) < (Math.PI / zTeeth) * 0.2) r = Math.max(r, Math.hypot(d[0], d[1])); } return r; };
check("gearbox: driven gears show a gap toward their pinions", rimToward("intermediate gear", Math.PI, 60) < gb.info.teeth[1] * gb.info.module / 2 && rimToward("output gear", Math.PI, 59) < gb.info.teeth[3] * gb.info.module / 2 && rimToward("input pinion", 0, 17) > gb.info.teeth[0] * gb.info.module / 2 + 2);
solid("gearbox gear", gb.parts["output gear"].mesh);
solid("gearbox lower case", gb.parts["lower case"].mesh);
gb.explode(1);
check("gearbox: explode lifts the cover", gb.parts["cover"].position[1] > 100);
gb.explode(0);
check("gearbox: labels are world points and gear labels are inside", gb.labels().every(l => l.at.every(Number.isFinite)) && !texts(gb).includes("output gear") && (gb.open = true, texts(gb).includes("output gear")));
gb.open = false;

// ---------- electric motor ----------
const mo = P.electricMotor();
const mb = bounds(mo);
check("motor: IEC 132 frame puts the feet 132 mm under the shaft", near(mb.mn[1], -132, 0.01) && mo.info.frame === 132, mb.mn[1].toFixed(1));
check("motor: shaft leaves the +x end", mo.ports.shaft.normal[0] > 0.999 && mo.ports.shaft.center[0] > 200 && near(mo.ports.shaft.radius, 19, 1e-6));
check("motor: 20 or more parts, 1500 rpm synchronous at 4 poles", Object.keys(mo.parts).length >= 20 && mo.info.syncRpm === 1500);
mo.pose({ spin: 1.2 });
check("motor: rotor spins with pose", near(mo.rotor.rotation[1], 1.2, 1e-9));
check("motor: a bigger frame scales the shaft", P.electricMotor({ frame: 160 }).info.shaft > 40);
solid("motor frame shell", mo.parts["frame"].mesh);

// ---------- centrifugal pump ----------
const pu = P.pump({ motor: true });
check("pump: suction along +x, discharge straight up", pu.ports.inlet.normal[0] > 0.999 && pu.ports.discharge.normal[1] > 0.999);
check("pump: pump and motor share the base plate at the shaft height", near(bounds(pu.parts["base plate"]).mx[1], -pu.info.shaftHeight, 0.06) && near(bounds(pu.motor).mn[1], -pu.info.shaftHeight, 0.01));
const tip = pu.motor.ports.shaft.center, cb = bounds(pu.parts["motor coupling half"]);
check("pump: the motor shaft ends inside its coupling half", tip[0] > cb.mn[0] - 1 && tip[0] < cb.mx[0] + 1 && Math.abs(tip[1]) < 1 && Math.abs(tip[2]) < 1, `${tip.map(v => v.toFixed(0))} vs [${cb.mn[0].toFixed(0)}, ${cb.mx[0].toFixed(0)}]`);
pu.pose({ spin: 0.7 });
check("pump: rotor and motor spin together", near(pu.rotor.rotation[1], 0.7, 1e-9) && near(pu.motor.rotor.rotation[1], 0.7, 1e-9));
check("pump: 24 or more parts, the volute casing can be cut away", Object.keys(pu.parts).length >= 24 && (pu.cutaway(true), pu.parts["volute casing"].children[1].visible === true));
solid("pump casing cover", pu.parts["casing cover"].mesh);

// ---------- bicycle drivetrain ----------
const bk = P.bicycleDrivetrain();
check("bicycle: 40 or more parts, 11 cogs, two chainrings", Object.keys(bk.parts).length >= 40 && bk.info.cogs.length === 11 && bk.info.chainrings.length === 2);
check("bicycle: ratios table", near(bk.info.ratios[0][0], 50 / 11, 1e-9) && near(bk.info.ratios[1][10], 34 / 32, 1e-9));
bk.pose({ crank: 1.0, ring: 0, gear: 0 });
check("bicycle: the cassette turns crank x chainring / cog", near(bk.cassette.rotation[2], (1.0 * 50) / 11, 1e-9), bk.cassette.rotation[2].toFixed(3));
check("bicycle: jockey wheels turn opposite ways at the chain's speed", near(bk.parts["guide pulley"].rotation[2], -(1.0 * 50) / 11, 1e-9) && near(bk.parts["tension pulley"].rotation[2], (1.0 * 50) / 11, 1e-9));
const chainA = bk.parts["chain"].mesh;
bk.pose({ crank: 1.0 + (12.7 / 2) / (12.7 / (2 * Math.sin(Math.PI / 50))), ring: 0, gear: 0 });
check("bicycle: the chain advances along its path with the crank", bk.parts["chain"].mesh !== chainA && chainA.chain.links === bk.info.chainLinks, `${chainA.chain.links} links`);
const cage = g => { bk.pose({ crank: 0, ring: 0, gear: g }); return bk.cageAngle; };
check("bicycle: the cage swings forward as the chain climbs to bigger cogs", cage(0) > cage(5) && cage(5) > cage(10));
bk.pose({ crank: 0, ring: 0, gear: 10 });
const gp = bk.parts["guide pulley"].toWorld([0, 0, 0]);
check("bicycle: the guide pulley sits under the selected cog", Math.abs(gp[2] - bounds(bk.parts["cog 32"]).mn[2] - 1) < 2 && gp[1] < -60, gp.map(v => v.toFixed(0)).join(", "));
solid("bicycle chainring", bk.parts["chainring 50"].mesh);

// ---------- steam turbine ----------
const tu = P.turbine();
check("turbine: blades grow stage by stage", tu.info.bladeHeights.every((h, i, a) => i === 0 || h > a[i - 1]) && tu.stages.length === 6);
check("turbine: steam in at the top, out at the bottom", tu.ports.inlet.normal[1] > 0.999 && tu.ports.exhaust.normal[1] < -0.999 && tu.ports.inlet.center[1] > tu.ports.exhaust.center[1]);
check("turbine: 35 or more parts with a split casing", Object.keys(tu.parts).length >= 35 && (bounds(tu.parts["upper casing"]).mn[1] > -1) && (bounds(tu.parts["lower casing"]).mx[1] < 1));
tu.pose({ spin: 0.5 });
check("turbine: rotor spins with pose", near(tu.rotor.rotation[1], 0.5, 1e-9));
tu.explode(1);
check("turbine: explode lifts the upper half and drops the hood", bounds(tu.parts["upper casing"]).mn[1] > 500 && bounds(tu.parts["exhaust hood"]).mx[1] < -900);
tu.explode(0);
solid("turbine casing half", tu.parts["lower casing"].mesh);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
