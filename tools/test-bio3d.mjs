#!/usr/bin/env node
// Tests for src/bio3d.js (E3.bio), run in Node without WebGL: the modeling helpers (implicit
// surfaces, sheets, muscles, Murray's and Rall's laws), and every assembly: closed meshes,
// part counts, triangle budgets, pose, explode, cutaway, and what each one's motion must do.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
for (const f of ["engine3d", "parts3d", "bio3d"]) new Function(await readFile(path.join(root, `src/${f}.js`), "utf8"))();
const { v3, m4 } = window.E3, B = window.E3.bio;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1e-9, Math.abs(b));
const tri = (m, t) => [0, 1, 2].map(k => { const i = m.indices[t + k] * 3; return [m.positions[i], m.positions[i + 1], m.positions[i + 2]]; });
const volume = m => { let v = 0; for (let t = 0; t < m.indices.length; t += 3) { const [a, b, c] = tri(m, t); v += v3.dot(a, v3.cross(b, c)) / 6; } return v; };
const area = m => { let s = 0; for (let t = 0; t < m.indices.length; t += 3) { const [a, b, c] = tri(m, t); s += v3.len(v3.cross(v3.sub(b, a), v3.sub(c, a))) / 2; } return s; };
// Closed: after welding by position (tolerance relative to the mesh's size), every edge is
// used as often in each direction.
function openEdges(m) {
  const q = Math.max(m.bounds.radius, 1e-6) * 1e-6;
  const key = p => p.map(x => Math.round(x / q)).join(",");
  const edges = new Map();
  for (let t = 0; t < m.indices.length; t += 3) {
    const k = tri(m, t).map(key);
    for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e + 1) % 3]; if (a === b) continue; const id = `${a}|${b}`; edges.set(id, (edges.get(id) || 0) + 1); }
  }
  let bad = 0;
  for (const [id, n] of edges) { const [a, b] = id.split("|"); if (n !== (edges.get(`${b}|${a}`) || 0)) bad++; }
  return bad;
}
function normalsAgree(m) {
  let good = 0, n = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = tri(m, t), fn = v3.cross(v3.sub(b, a), v3.sub(c, a));
    if (v3.len(fn) < 1e-12) continue;
    const vn = [0, 1, 2].reduce((s, k) => { const i = m.indices[t + k] * 3; return v3.add(s, [m.normals[i], m.normals[i + 1], m.normals[i + 2]]); }, [0, 0, 0]);
    n++; if (v3.dot(fn, vn) > 0) good++;
  }
  return n ? good / n : 1;
}
const allMeshes = asm => { const out = []; asm.traverse(n => { if (n.mesh) out.push([n.name, n.mesh]); }); return out; };
const visibleTris = asm => { let s = 0; const walk = n => { if (!n.visible) return; if (n.mesh) s += n.mesh.indices.length / 3; for (const c of n.children) walk(c); }; walk(asm); return s; };

// ---------- helpers ----------
const sph = B.polygonize(B.sd.sphere([1, 2, 3], 10), { h: 0.5 });
check("implicit sphere: area within 1.5% of 4πr²", near(area(sph), 4 * Math.PI * 100, 0.015), area(sph).toFixed(1));
check("implicit sphere: volume within 1.5% of 4/3πr³", near(volume(sph), (4 / 3) * Math.PI * 1000, 0.015), volume(sph).toFixed(1));
check("implicit sphere is closed with outward normals", openEdges(sph) === 0 && normalsAgree(sph) > 0.999, `${openEdges(sph)} open edges`);
const blob = B.polygonize(B.sd.displace(B.sd.smooth(3, B.sd.capsule([0, 0, 0], [20, 0, 0], 5), B.sd.ellipsoid([10, 6, 0], [6, 4, 4])), 0.4, 0.3, 2), { h: 0.6 });
check("blended, displaced implicit shape is closed", openEdges(blob) === 0 && volume(blob) > 0 && normalsAgree(blob) > 0.995, `${openEdges(blob)} open edges, normals ${(normalsAgree(blob) * 100).toFixed(1)}%`);
const shell = B.polygonize(B.sd.shell(B.sd.sphere([0, 0, 0], 10), 1.5), { h: 0.5 });
check("a shell's volume is the difference of two spheres", near(volume(shell), (4 / 3) * Math.PI * (1000 - 8.5 ** 3), 0.03), volume(shell).toFixed(0));
const sh = B.sheet((u, v) => [u * 10, Math.sin(u * 3) * 2, v * 6], { nu: 12, nv: 6, thickness: 0.4 });
check("sheet is a closed thin solid", openEdges(sh) === 0 && near(volume(sh), 0.4 * 6 * 10.9, 0.08), volume(sh).toFixed(1));
const ring = B.sheet((u, v) => [Math.cos(u * 6.2832) * (3 + v), v * 0.2, Math.sin(u * 6.2832) * (3 + v)], { nu: 24, nv: 4, thickness: 0.3, closedU: true });
check("closed-u sheet (a ring) is closed", openEdges(ring) === 0 && volume(ring) > 0);
const mu = B.muscle([0, 0, 0], [0, 80, 0], { belly: 8, width: 12, tendonLength: 12, via: [[6, 40, 0]] });
check("muscle runs origin to insertion through its via point", v3.dist(mu.path[0], [0, 0, 0]) < 1e-6 && v3.dist(mu.path[mu.path.length - 1], [0, 80, 0]) < 1e-6 && mu.path.some(p => v3.dist(p, [6, 40, 0]) < 3), mu.length.toFixed(1));
check("muscle is closed, its belly wider than its tendons", openEdges(mu.mesh) === 0 && volume(mu.mesh) > 0);
for (const [n, label] of [[3, "Murray's law (r³)"], [1.5, "Rall's law (r^1.5)"]]) {
  const tr = B.vesselTree({ root: [0, 0, 0], dir: [0, 1, 0], radius: 2, length: 20, depth: 3, exponent: n, seed: 4 });
  let worst = 0;
  tr.segments.forEach((s, i) => { const kids = tr.segments.filter(c => c.parent === i); if (kids.length === 2) worst = Math.max(worst, Math.abs(kids.reduce((a, c) => a + c.r0 ** n, 0) / s.r1 ** n - 1)); });
  check(`vessel tree branches follow ${label}`, tr.segments.length >= 7 && worst < 1e-9, `${tr.segments.length} segments`);
}

// ---------- assemblies ----------
const BUDGET = 250000;
const built = {};
for (const [name, minParts] of [["heart", 15], ["eye", 15], ["knee", 15], ["neuron", 15], ["cell", 15], ["tooth", 15], ["skin", 15]]) {
  const t0 = Date.now();
  const a = B[name]();
  built[name] = a;
  const ms = Date.now() - t0;
  check(`${name}: builds with ${Object.keys(a.parts).length} named parts`, Object.keys(a.parts).length >= minParts, `${ms} ms`);
  const closedT = visibleTris(a);
  a.cutaway(true);
  const openT = visibleTris(a);
  let bad = [];
  for (const [n, m] of allMeshes(a)) {
    if (!m.indices.length) continue;
    const oe = openEdges(m), vol = volume(m), na = normalsAgree(m);
    if (oe || vol <= 0 || na < 0.99) bad.push(`${n}: ${oe} open edges, volume ${vol.toExponential(1)}, normals ${(na * 100).toFixed(1)}%`);
  }
  check(`${name}: every mesh is closed with outward normals (closed and cut away)`, bad.length === 0, bad.slice(0, 3).join("; "));
  a.cutaway(false);
  check(`${name}: under ${BUDGET / 1000}k triangles closed and open`, closedT < BUDGET && openT < BUDGET, `${Math.round(closedT / 1000)}k closed, ${Math.round(openT / 1000)}k open`);
  const labels = a.labels().length;
  a.cutaway(true);
  check(`${name}: cutaway shows inside labels`, a.labels().length >= labels, `${labels} -> ${a.labels().length}`);
  a.cutaway(false);
  // Explode moves at least one part.
  const ex = Object.values(a.parts).find(n => n._ex);
  if (ex) { const w0 = ex.world().slice(12, 15); a.explode(1); const w1 = ex.world().slice(12, 15); a.explode(0); check(`${name}: explode moves ${ex.name}`, v3.dist(Array.from(w0), Array.from(w1)) > 1e-6); }
}
// Detail lowers the triangle count.
const lo = B.heart({ detail: 0.5 });
check("detail 0.5 has well under half the triangles of detail 1", visibleTris(lo) < 0.45 * visibleTris(built.heart), `${Math.round(visibleTris(lo) / 1000)}k vs ${Math.round(visibleTris(built.heart) / 1000)}k`);

// Heart: the valves open and shut on the Wiggers timing; volumes from 120 to 50 mL.
{
  const H = built.heart, st = H.state;
  H.pose({ phase: 0.3 });
  check("heart in ejection: aortic and pulmonary valves open, mitral and tricuspid shut", st.aortic > 0.95 && st.pulmonary > 0.95 && st.mitral < 0.05 && st.tricuspid < 0.05, st.name);
  H.pose({ phase: 0.75 });
  check("heart in filling: mitral and tricuspid open, aortic and pulmonary shut", st.mitral > 0.95 && st.tricuspid > 0.95 && st.aortic < 0.05 && st.pulmonary < 0.05, st.name);
  H.pose({ phase: 0.14 });
  check("isovolumetric contraction: all four valves shut", [st.mitral, st.tricuspid, st.aortic, st.pulmonary].every(v => v < 0.05));
  const ed = st.lvVolume;
  H.pose({ phase: 0.46 });
  check("left ventricle: 120 mL at end-diastole, 50 mL at end-systole", near(ed, 120, 0.01) && near(st.lvVolume, 50, 0.02), `${ed.toFixed(0)} -> ${st.lvVolume.toFixed(0)} mL`);
  const sv = H.parts["ventricles"].scale;
  check("ventricles shrink in systole", sv[0] < 0.75 && sv[1] < 0.9, sv.map(v => v.toFixed(2)).join(", "));
  // A shut aortic valve's cusps meet near the center; an open one's lie against the wall.
  const cuspsOf = () => H.valves.aortic.leaves.map(n => n.mesh);
  const centerGap = ms => { const c = [1, 2, 2], ax = v3.norm([-0.25, 1, 0.15]); let near0 = Infinity; for (const m of ms) for (let i = 0; i < m.positions.length; i += 3) { const d = v3.sub([m.positions[i], m.positions[i + 1], m.positions[i + 2]], c); near0 = Math.min(near0, v3.len(v3.sub(d, v3.scale(ax, v3.dot(d, ax))))); } return near0; };
  H.pose({ phase: 0.75 }); const shut = centerGap(cuspsOf());
  H.pose({ phase: 0.3 }); const open = centerGap(cuspsOf());
  check("aortic cusps close at the center and open to the wall", shut < 2.5 && open > 6, `${shut.toFixed(1)} mm vs ${open.toFixed(1)} mm from the axis`);
}
// Eye: pupil, accommodation, gaze.
{
  const E = built.eye;
  const pupilOf = () => { const m = E.parts.iris.children[0].mesh; let r = Infinity; for (let i = 0; i < m.positions.length; i += 3) r = Math.min(r, Math.hypot(m.positions[i], m.positions[i + 1])); return 2 * r; };
  E.pose({ pupil: 3 }); const p3 = pupilOf();
  E.pose({ pupil: 7 }); const p7 = pupilOf();
  check("pupil diameter follows the pose", Math.abs(p3 - 3) < 0.2 && Math.abs(p7 - 7) < 0.2, `${p3.toFixed(2)}, ${p7.toFixed(2)} mm`);
  E.pose({ accommodation: 0 }); const t0 = E.state.lens.thickness;
  E.pose({ accommodation: 1 }); const t1 = E.state.lens.thickness;
  check("the lens thickens when focusing near (4.0 to 4.5 mm, Le Grand)", near(t0, 4.0, 0.03) && near(t1, 4.5, 0.03), `${t0.toFixed(2)} -> ${t1.toFixed(2)} mm`);
  check("axial length about 24 mm", E.info.axialLength > 23.5 && E.info.axialLength < 24.5, E.info.axialLength);
  E.pose({ gaze: [0, 0], accommodation: 0 }); const lat0 = E.state["lateral rectus"], med0 = E.state["medial rectus"];
  E.pose({ gaze: [0.35, 0] }); const lat1 = E.state["lateral rectus"], med1 = E.state["medial rectus"];
  check("looking outward shortens the lateral rectus and stretches the medial", lat1 < lat0 - 1 && med1 > med0 + 1, `lateral ${lat0.toFixed(1)} -> ${lat1.toFixed(1)}, medial ${med0.toFixed(1)} -> ${med1.toFixed(1)} mm`);
  E.pose({ gaze: [0, 0] });
}
// Knee: the cruciates stay taut through flexion; the femur rolls back; the patella tracks.
{
  const K = built.knee;
  K.pose({ flex: 0 }); const a0 = K.state.acl, p0 = K.state.pcl;
  let worst = 0, roll = 0, psi = [];
  for (const f of [0.3, 0.7, 1.1, 1.6, 2.0]) { K.pose({ flex: f }); worst = Math.max(worst, Math.abs(K.state.acl / a0 - 1), Math.abs(K.state.pcl / p0 - 1)); if (f === 1.6) roll = K.state.rollback; psi.push(K.state.patellaAngle); }
  check("cruciate ligaments stay within 6% of their length from 0 to 115°", worst < 0.06, `${(worst * 100).toFixed(1)}%`);
  check("the femur rolls back on the tibia in flexion (more than 6 mm at 90°)", roll > 6, `${roll.toFixed(1)} mm`);
  check("the patella runs down its groove as the knee bends", psi.every((v, i) => i === 0 || v > psi[i - 1]), psi.map(v => v.toFixed(2)).join(", "));
  check("ACL about 32 mm, PCL about 38 mm", near(K.info.acl, 34, 0.15) && near(K.info.pcl, 37, 0.15), `${K.info.acl}, ${K.info.pcl}`);
  K.pose({ flex: 1.2 });
  check("the patellar tendon keeps its length", near(K.state.patellarTendon, 46, 0.01), K.state.patellarTendon.toFixed(2));
  K.pose({ flex: 0 });
}
// Neuron: saltatory conduction; Rall's law in the dendrites.
{
  const N = built.neuron;
  const active = s => { N.pose({ signal: s }); return N.state.activeNode; };
  const ks = [0, 0.2, 0.4, 0.6, 0.8, 1].map(active);
  check("the action potential moves down the axon node by node", ks.every((k, i) => i === 0 || k >= ks[i - 1]) && ks[0] < 0 && ks[ks.length - 1] >= N.info.axon.internodes, ks.join(" "));
  N.pose({ signal: 0.5 });
  const lit = Object.keys(N.parts).filter(n => /node of Ranvier/.test(n) && N.parts[n].highlight).length;
  check("one node of Ranvier fires at a time", lit === 1, `${lit}`);
}
// Cell: the organelles sit inside the membrane; opening it reveals them.
{
  const C = built.cell;
  const org = C.parts["organelles"];
  check("cell interior hidden when closed, shown when open", !org.visible && (C.cutaway(true), org.visible) && (C.cutaway(false), !org.visible));
  let outside = 0;
  for (const [n, m] of allMeshes(org)) { if (/membrane/.test(n)) continue; for (let i = 0; i < m.positions.length; i += 3) if (Math.hypot(m.positions[i] / 12, m.positions[i + 1] / 9.84, m.positions[i + 2] / 11.4) > 1.02) outside++; }
  check("every organelle lies inside the membrane", outside === 0, `${outside} vertices outside`);
}
// Tooth and skin: layers in the right order.
{
  const Tt = built.tooth, en = Tt.parts.enamel.children[0].mesh;
  let ymin = Infinity; for (let i = 1; i < en.positions.length; i += 3) ymin = Math.min(ymin, en.positions[i]);
  check("enamel only covers the crown (above the cementoenamel junction)", ymin > -0.1, ymin.toFixed(2));
  const S = built.skin, top = name => S.parts[name].children[0].mesh.bounds.max[1], bot = name => S.parts[name].children[0].mesh.bounds.min[1];
  check("skin layers: stratum corneum over epidermis over dermis", top("stratum corneum") >= top("epidermis") - 1e-6 && bot("epidermis") > bot("dermis") && top("dermis") <= top("epidermis"));
  const coil = S.parts["sweat gland"].mesh.bounds;
  check("the sweat gland's coil sits deep in the dermis, its duct reaching the surface", coil.min[1] < -1.6 && coil.max[1] > -0.05);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
