#!/usr/bin/env node
// Tests for the isometric illustration kit in src/iso.js (window.Iso), run in Node:
// projection math, face normals and culling, paint order on simple stacks and shells,
// picking, section cuts, the SVG export, the drag helper, and the motion helpers.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
new Function(await readFile(path.join(root, "src/iso.js"), "utf8"))();
const Iso = window.Iso;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const BOX = [0, 0, 800, 600];
const DIM = { yaw: Math.PI / 4, pitch: Math.PI / 6 };

// ---------- projection ----------
{
  const S = Iso.scene();
  S.box({ size: [1, 1, 1] });
  const V = Iso.layout(S, { box: BOX, view: DIM, scale: 10 });
  const o = V.project([0, 0, 0]), x = V.project([1, 0, 0]), y = V.project([0, 1, 0]), z = V.project([0, 0, 1]);
  const k = 10 * Math.sqrt(1.6), A = DIM.yaw, E = DIM.pitch;
  check("one floor unit is one scale unit in the default view", near(Math.hypot(x[0] - o[0], x[1] - o[1]), 10, 1e-9), Math.hypot(x[0] - o[0], x[1] - o[1]).toFixed(6));
  check("x' = ox + k (x sinA - y cosA)", near(x[0] - o[0], k * Math.sin(A)) && near(y[0] - o[0], -k * Math.cos(A)));
  check("y' = oy + k ((x cosA + y sinA) sinE - z cosE)", near(x[1] - o[1], k * Math.cos(A) * Math.sin(E)) && near(z[1] - o[1], -k * Math.cos(E)));
  check("x runs right and down, y left and down, z straight up", x[0] > o[0] && x[1] > o[1] && y[0] < o[0] && y[1] > o[1] && near(z[0], o[0]) && z[1] < o[1]);
  check("depth grows toward the viewer", z[2] > o[2] && x[2] > o[2] && y[2] > o[2]);
  const p = [0.3, -0.7, 0.45], q = V.project(p), back = V.unproject(q, { point: p, normal: [0.2, 0.5, 0.8] });
  check("unproject inverts project on a plane", Math.hypot(back[0] - p[0], back[1] - p[1], back[2] - p[2]) < 1e-9);
  const g0 = V.unproject(V.project([2, 3, 0]), 0);
  check("unproject onto the ground plane", Math.hypot(g0[0] - 2, g0[1] - 3, g0[2]) < 1e-9);
  const iso = Iso.layout(S, { box: BOX, view: Iso.VIEWS.iso, scale: 10, fit: "always" }), a = iso.project([0, 0, 0]);
  const lens = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(d => { const b = iso.project(d); return Math.hypot(b[0] - a[0], b[1] - a[1]); });
  check("true isometric foreshortens all three axes equally", near(lens[0], lens[1], 1e-9) && near(lens[1], lens[2], 1e-9), lens.map(l => l.toFixed(4)).join(", "));
  const e = V.ellipse([0, 0, 0], [0, 0, 1], 1);
  check("a ground circle projects to a flat ellipse", e.rx > e.ry && near(e.ry / e.rx, Math.sin(E), 1e-6), `ry/rx ${(e.ry / e.rx).toFixed(4)}`);
}

// ---------- face normals and culling ----------
{
  const S = Iso.scene();
  const b = S.box({ from: [0, 0, 0], to: [2, 1, 1] });
  const P = b.mesh.P, F = b.mesh.F.filter(f => !f.d);
  const outward = F.every(f => {
    const c = f.v.reduce((s, q) => [s[0] + P[q * 3], s[1] + P[q * 3 + 1], s[2] + P[q * 3 + 2]], [0, 0, 0]).map(v => v / f.v.length);
    return (c[0] - 1) * f.n[0] + (c[1] - 0.5) * f.n[1] + (c[2] - 0.5) * f.n[2] > 0;
  });
  check("box faces point outward", outward && F.length === 6, `${F.length} faces`);
  const V = Iso.layout(S, { box: BOX, view: DIM });
  check("three faces of a box face the viewer", V.list.length === 3);
  const t = V.list.map(it => it.t).sort().join("");
  check("top, left and right faces get top, light and dark tones", t === "013", t);
  const C = Iso.scene().cylinder({ r: 1, length: 2, segments: 32 });
  const m = C.mesh, side = m.F.filter(f => f.v.length === 4);
  check("cylinder sides share one smooth group (no lines between bands)", new Set(side.map(f => f.s)).size === 1 && side[0].s > 0);
  check("cylinder outline: silhouettes but no creases between bands", m.E.filter(e => e[4] && m.F[e[2]].v.length === 4 && m.F[e[3]]?.v.length === 4).length === 0);
  const sh = Iso.scene();
  sh.cylinder({ r: 1, length: 1, segments: 24, material: "steel" });
  const L = Iso.layout(sh, { box: BOX, view: DIM }), tones = new Set(L.list.map(it => it.t));
  check("a metal cylinder shows banded tones and a specular stripe", tones.size >= 4 && tones.has(5), [...tones].join(","));
}

// ---------- paint order ----------
const order = (V, names) => names.map(n => V.chunks.findIndex(c => c.r.names.includes(n)));
{
  const S = Iso.scene();
  S.box({ name: "bottom", size: [2, 2, 1] });
  S.box({ name: "middle", size: [1.5, 1.5, 1], at: [0, 0, 1] });
  S.box({ name: "top", size: [1, 1, 1], at: [0, 0, 2] });
  for (const view of [DIM, Iso.VIEWS.iso, { yaw: 2, pitch: 0.8 }, { yaw: -2.5, pitch: 0.3 }]) {
    S._rank = null;
    const V = Iso.layout(S, { box: BOX, view, fit: "always" }), [a, b, c] = order(V, ["bottom", "middle", "top"]);
    check(`a stack paints bottom to top (yaw ${view.yaw.toFixed(2)})`, a < b && b < c && Iso.audit(S, { view: V }).ok);
  }
  const R = Iso.scene();
  for (let i = 0; i < 5; i++) R.box({ name: "x" + i, size: [0.8, 0.8, 0.5 + 0.3 * i], at: [i, 0, 0] });
  const V = Iso.layout(R, { box: BOX, view: DIM }), ix = order(V, ["x0", "x1", "x2", "x3", "x4"]);
  check("a row along +x paints far to near", ix.every((v, i) => !i || v > ix[i - 1]), ix.join(","));
  const V2 = Iso.layout(R, { box: BOX, view: { yaw: Math.PI / 4 + Math.PI, pitch: 0.5 }, fit: "always" }), ix2 = order(V2, ["x0", "x1", "x2", "x3", "x4"]);
  check("seen from the other side the row reverses", ix2.every((v, i) => !i || v < ix2[i - 1]), ix2.join(","));
}
{
  // A long rail under a carriage: the rail is split so the carriage sorts against each piece.
  const S = Iso.scene();
  S.box({ name: "rail", from: [0, -0.1, 0], to: [6, 0.1, 0.2] });
  const car = S.box({ name: "car", from: [2.6, -0.3, 0.2], to: [3.4, 0.3, 0.6] });
  S.box({ name: "post", from: [3.6, -0.6, 0], to: [3.8, -0.4, 1.2] });
  const views = [DIM, { yaw: 2.4, pitch: 0.5 }, { yaw: -0.9, pitch: 0.3 }, { yaw: 4, pitch: 1.1 }];
  let ok = true;
  for (const view of views) for (const x of [-2, 0, 1.5]) { car.move = [x, 0, 0]; const V = Iso.layout(S, { box: BOX, view, fit: "always" }); ok &&= Iso.audit(S, { view: V }).ok && V.cycles === 0; }
  check("split rail, carriage and post sort without conflicts from four views", ok);
}
{
  // Random scattered boxes that don't overlap: the audit finds no conflicts.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const S = Iso.scene();
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const h = 0.3 + rnd() * 2, w = 0.3 + rnd() * 0.6;
    S.box({ name: `b${i}${j}`, size: [w, w * (0.5 + rnd()), h], at: [i * 1.1, j * 1.1, rnd() < 0.3 ? 0.4 : 0] });
  }
  let conflicts = 0;
  for (const yaw of [0.3, 0.785, 2, 3.5, 5]) { const V = Iso.layout(S, { box: BOX, view: { yaw, pitch: 0.5 }, fit: "always" }); conflicts += Iso.audit(S, { view: V }).conflicts.length; }
  check("36 scattered boxes, five views: no paint-order conflicts", conflicts === 0, `${conflicts} conflicts`);
}
{
  // A shell around a rod: back half, rod, front half.
  const S = Iso.scene();
  S.cylinder({ name: "tube", r: 1, hole: 0.9, length: 3, axis: "x", at: [0, 0, 1.5], segments: 32 });
  S.cylinder({ name: "rod", r: 0.3, length: 2, axis: "x", at: [0.5, 0, 1.5], segments: 16 });
  const V = Iso.layout(S, { box: BOX, view: DIM });
  const tube = V.chunks.map((c, i) => [c, i]).filter(([c]) => c.r.names.includes("tube")), rod = V.chunks.findIndex(c => c.r.names.includes("rod"));
  const back = tube.filter(([c]) => !(c.c & 1)).map(([, i]) => i), front = tube.filter(([c]) => c.c & 1).map(([, i]) => i);
  check("a wrapping shell paints back half, inner part, front half", back.length && front.length && Math.max(...back) < rod && rod < Math.min(...front), `back ${back} rod ${rod} front ${front}`);
}

// ---------- pick ----------
{
  const S = Iso.scene();
  S.box({ name: "base", size: [4, 4, 1] });
  S.box({ name: "block", size: [1, 1, 1], at: [0, 0, 1] });
  S.part(new Iso.Mesh(), {});
  const V = Iso.layout(S, { box: BOX, view: DIM });
  const top = V.project([0, 0, 2]), side = V.project([1.9, 1.9, 0.5]);
  check("pick finds the block on top", V.pick(top)?.name === "block");
  check("pick finds the base beside it", V.pick(side)?.name === "base");
  check("pick misses empty space", V.pick([2, 2]) === null);
  const hit = V.pick(top);
  check("pick returns the 3D point under the pointer", hit.point && Math.abs(hit.point[2] - 2) < 1e-9);
  const at = V.at("block"), c = V.project([0, 0, 1.5]);
  check("at(name) projects the part's center", Math.hypot(at[0] - c[0], at[1] - c[1]) < 1e-9);
}

// ---------- section cut ----------
{
  const S = Iso.scene();
  const p = S.cylinder({ name: "c", r: 1, hole: 0.6, length: 2, segments: 24, cut: [0, 1, 0, 0] });
  const V = Iso.layout(S, { box: BOX, view: DIM }), G = p._g;
  let worst = -1e9;
  for (const f of G.F) for (const q of f.v) worst = Math.max(worst, G.W[q * 3 + 1]);
  const caps = G.F.filter(f => f.cap);
  check("a cut removes everything past the plane", worst < 1e-9, `max y ${worst.toExponential(2)}`);
  check("a cut tube gets section caps facing the cut", caps.length >= 1 && caps.every(f => f.n[1] > 0.99), `${caps.length} caps`);
  check("section caps are drawn with the cut tone", V.list.some(it => G.F[it.f].cap && it.t === 6));
}

// ---------- SVG ----------
{
  const S = Iso.scene();
  S.box({ name: "base", size: [2, 2, 0.5], bevel: 0.05, material: "steel" });
  const b = S.box({ name: "box", size: [1, 1, 1], at: [0, 0, 0.5] });
  b.screen({ face: "+y", size: [0.6, 0.3], text: "65 A <ok>" });
  S.cylinder({ r: 0.3, length: 1, at: [0.6, -0.6, 0.5], cut: [1, 0, 0, 0.6] });
  S._view = Iso.layout(S, { box: [0, 0, 400, 300], view: DIM });
  const svg = Iso.toSVG(S, { title: "test" });
  const tags = [...svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)], stack = [];
  let balanced = true;
  for (const [, close, name, self] of tags) { if (self) continue; if (close) { if (stack.pop() !== name) balanced = false; } else stack.push(name); }
  check("SVG is one balanced <svg> element", svg.startsWith("<svg") && svg.endsWith("</svg>") && balanced && !stack.length);
  check("SVG carries light and dark colors as CSS variables", /<style>svg\{--i0:#[0-9a-f]{6}/.test(svg) && /prefers-color-scheme:dark/.test(svg));
  check("SVG escapes text and keeps the screen readout", svg.includes("65 A &lt;ok&gt;"));
  check("SVG has a blurred contact shadow and a hatch for the cut", /feGaussianBlur/.test(svg) && /url\(#iso-hatch\)/.test(svg));
  check("SVG uses no hard-coded fills on parts", !/fill="#/.test(svg));
}

// ---------- drag and hover helpers ----------
{
  const S = Iso.scene();
  S.box({ name: "rail", from: [0, -0.1, 0], to: [4, 0.1, 0.1] });
  const g = S.group({ name: "slider" });
  g.box({ name: "block", size: [0.4, 0.4, 0.3], at: [1, 0, 0.1] });
  S._view = Iso.layout(S, { box: BOX, view: DIM, scale: 50 });
  const D = Iso.drag(S, { part: "slider", axis: "x", key: "x", min: 0, max: 2 }), s = { x: 1 }, v = {};
  const p0 = S._view.project([1, 0, 0.4]), unit = S._view.project([2, 0, 0.4]);
  check("drag.hit claims the named group and nothing else", D.hit(p0) && !D.hit(S._view.project([3.5, 0, 0.1])));
  D.start(p0, s, v);
  D.move([p0[0] + (unit[0] - p0[0]) * 0.5, p0[1] + (unit[1] - p0[1]) * 0.5], s, v);
  check("dragging along the projected axis moves by world units", near(s.x, 1.5, 1e-9), s.x.toFixed(4));
  D.move([p0[0] + (unit[0] - p0[0]) * 5, p0[1] + (unit[1] - p0[1]) * 5], s, v);
  check("drag stops at its limits", s.x === 2);
  D.end();
  const H = Iso.hover(S), st = {};
  check("hover writes the part name and reports a change", H(p0, st) === true && st.hover === "block" && H(p0, st) === false);
}

// ---------- motion ----------
{
  const a = Iso.follow(0, 1, 0.1, 0.25), b = Iso.follow(Iso.follow(0, 1, 0.05, 0.25), 1, 0.05, 0.25);
  check("follow is frame-rate independent", near(a, b, 1e-12) && near(a, 1 - Math.exp(-0.4), 1e-12));
  check("follow clamps a long sleep", near(Iso.follow(0, 1, 5, 0.25), Iso.follow(0, 1, 0.1, 0.25)));
  const st = { x: 0, v: 0 };
  let over = 0;
  for (let i = 0; i < 240; i++) over = Math.max(over, Iso.spring(st, 1, 1 / 60, 0.2));
  check("critically damped spring settles without overshoot", over <= 1 + 1e-9 && Math.abs(st.x - 1) < 1e-3, `peak ${over.toFixed(6)}`);
  check("pulse rises smoothly then decays", Iso.pulse(-1) === 0 && near(Iso.pulse(0.12), 1) && Iso.pulse(0.06) > 0.4 && Iso.pulse(1) < 0.3);
}

// ---------- performance ----------
{
  const S = Iso.scene(), spin = S.group({ name: "spin" });
  for (let i = 0; i < 6; i++) spin.blades({ at: [i * 0.3, 0, 2], axis: "x", count: 24, r0: 0.3, r1: 1, chord: 0.12, spans: 2 });
  for (let i = 0; i < 40; i++) S.box({ size: [0.2, 0.2, 0.5], at: [(i % 10) * 0.4 - 1, Math.floor(i / 10) * 0.6 - 1, 0], bevel: 0.02 });
  let V = Iso.layout(S, { box: BOX, view: DIM });
  const t0 = performance.now(), n = 20;
  for (let i = 0; i < n; i++) { spin.rotate = { axis: "x", angle: i * 0.05, about: [0, 0, 2] }; V = Iso.layout(S, { box: BOX, view: DIM }); }
  const ms = (performance.now() - t0) / n, faces = V.recs.reduce((s, r) => s + r.G.F.length, 0);
  check(`relayout of a turning ${faces}-face model`, ms < 40, `${ms.toFixed(1)} ms per frame in Node`);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
