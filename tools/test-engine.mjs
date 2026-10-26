#!/usr/bin/env node
// Geometry tests for src/engine3d.js that run in Node (no WebGL needed).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
new Function(await readFile(path.join(root, "src/engine3d.js"), "utf8"))();
const { mesh, triangulate, m4, v3 } = window.E3;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

function volume(m) {
  const P = m.positions, I = m.indices;
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = [P[I[t] * 3], P[I[t] * 3 + 1], P[I[t] * 3 + 2]], b = [P[I[t + 1] * 3], P[I[t + 1] * 3 + 1], P[I[t + 1] * 3 + 2]], c = [P[I[t + 2] * 3], P[I[t + 2] * 3 + 1], P[I[t + 2] * 3 + 2]];
    v += v3.dot(a, v3.cross(b, c)) / 6;
  }
  return v;
}
// Share of triangles whose winding normal points away from the mesh center (convex shapes: should be 1).
function outward(m) {
  const P = m.positions, I = m.indices, c = m.bounds.center;
  let good = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = [P[I[t] * 3], P[I[t] * 3 + 1], P[I[t] * 3 + 2]], b = [P[I[t + 1] * 3], P[I[t + 1] * 3 + 1], P[I[t + 1] * 3 + 2]], cc = [P[I[t + 2] * 3], P[I[t + 2] * 3 + 1], P[I[t + 2] * 3 + 2]];
    const n = v3.cross(v3.sub(b, a), v3.sub(cc, a));
    const mid = v3.scale(v3.add(v3.add(a, b), cc), 1 / 3);
    if (v3.len(n) < 1e-12 || v3.dot(n, v3.sub(mid, c)) > 0) good++;
  }
  return good / (I.length / 3);
}
// Vertex normals should agree with the winding of the triangles that use them.
function normalsAgree(m) {
  const P = m.positions, N = m.normals, I = m.indices;
  let good = 0;
  for (let t = 0; t < I.length; t += 3) {
    const ia = I[t], ib = I[t + 1], ic = I[t + 2];
    const a = [P[ia * 3], P[ia * 3 + 1], P[ia * 3 + 2]], b = [P[ib * 3], P[ib * 3 + 1], P[ib * 3 + 2]], c = [P[ic * 3], P[ic * 3 + 1], P[ic * 3 + 2]];
    const n = v3.cross(v3.sub(b, a), v3.sub(c, a));
    const vn = [N[ia * 3] + N[ib * 3] + N[ic * 3], N[ia * 3 + 1] + N[ib * 3 + 1] + N[ic * 3 + 1], N[ia * 3 + 2] + N[ib * 3 + 2] + N[ic * 3 + 2]];
    if (v3.len(n) < 1e-12 || v3.dot(n, vn) > 0) good++;
  }
  return good / (I.length / 3);
}

const area = tris => tris.reduce((s, [a, b, c]) => s + ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2, 0);
const circle = (r, n = 48, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
const polyArea = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
check("triangulate square", near(area(triangulate(sq)), 100, 1e-9));
check("triangulate square with hole", near(area(triangulate(sq, [circle(2, 32, 5, 5)])), 100 - polyArea(circle(2, 32)), 1e-6));
const twoHoles = triangulate(sq, [circle(1.5, 24, 3, 3), circle(1.5, 24, 7, 7)]);
check("triangulate two holes", near(area(twoHoles), 100 - 2 * polyArea(circle(1.5, 24)), 1e-6));
const L = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]];
check("triangulate concave L", near(area(triangulate(L)), 20, 1e-9));
check("all triangles counterclockwise", twoHoles.every(([a, b, c]) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]) > 0));

const box = mesh.box(2, 3, 4);
check("box volume", near(volume(box), 24, 1e-6), volume(box).toFixed(4));
check("box outward", outward(box) === 1);
const rbox = mesh.box(2, 3, 4, { round: 0.4 });
check("rounded box volume", volume(rbox) < 24 && volume(rbox) > 22.5, volume(rbox).toFixed(3));
check("rounded box outward", outward(rbox) === 1);
check("rounded box normals agree", normalsAgree(rbox) === 1);
const ell = mesh.ellipsoid(3, 2, 1);
check("ellipsoid volume", near(volume(ell), (4 / 3) * Math.PI * 6, 0.02), volume(ell).toFixed(3));
check("ellipsoid outward", outward(ell) === 1);
check("ellipsoid normals agree", normalsAgree(ell) === 1);
const cyl = mesh.cylinder(1, 2);
check("cylinder volume", near(volume(cyl), Math.PI * 2, 0.02), volume(cyl).toFixed(3));
check("cylinder outward", outward(cyl) === 1);
const cone = mesh.cylinder(1, 3, { r2: 0 });
check("cone volume", near(volume(cone), Math.PI, 0.02), volume(cone).toFixed(3));
const tor = mesh.torus(3, 1);
check("torus volume", near(volume(tor), 2 * Math.PI * Math.PI * 3, 0.03), volume(tor).toFixed(3));
check("torus normals agree", normalsAgree(tor) === 1);
const lat = mesh.lathe([[0, -1], [1, -1], [1, 1], [0, 1]]);
check("lathe cylinder volume", near(volume(lat), Math.PI * 2, 0.02), volume(lat).toFixed(3));
const ex = mesh.extrude(sq, 2);
check("extrude volume", near(volume(ex), 200, 1e-6), volume(ex).toFixed(3));
check("extrude outward", outward(ex) === 1);
const exh = mesh.extrude(sq, 2, { holes: [circle(2, 32, 5, 5)] });
check("extrude with hole volume", near(volume(exh), (100 - polyArea(circle(2, 32))) * 2, 1e-4), volume(exh).toFixed(3));
check("extrude with hole normals agree", normalsAgree(exh) === 1);
const exb = mesh.extrude(circle(5, 64), 4, { bevel: 1 });
check("beveled extrude smaller than plain", volume(exb) < polyArea(circle(5, 64)) * 4 && volume(exb) > polyArea(circle(5, 64)) * 4 * 0.85, volume(exb).toFixed(2));
check("beveled extrude normals agree", normalsAgree(exb) === 1);
const gear = mesh.gear({ teeth: 20, module: 1, thickness: 2, hole: 1, spokes: 4 });
check("gear volume positive", volume(gear) > 0, volume(gear).toFixed(2));
check("gear lies flat (axis y)", near(gear.bounds.max[1] - gear.bounds.min[1], 2, 1e-6));
check("gear normals agree", normalsAgree(gear) === 1);
const path3 = Array.from({ length: 30 }, (_, i) => [0, 0, i / 29 * 10]);
const tube = mesh.tube(path3, 1, { segments: 32 });
check("tube volume", near(volume(tube), Math.PI * 10, 0.02), volume(tube).toFixed(3));
check("tube outward", outward(tube) > 0.99);
const bent = Array.from({ length: 40 }, (_, i) => { const a = (i / 39) * Math.PI; return [10 * Math.cos(a), 10 * Math.sin(a), 0]; });
const bentTube = mesh.tube(bent, (t) => 1 + t, { segments: 20 });
check("bent tube volume positive", volume(bentTube) > 0);
check("bent tube normals agree", normalsAgree(bentTube) === 1);
const sw = mesh.sweep(bent, [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]], { up: [0, 0, 1] });
check("sweep with up vector volume", near(volume(sw), 2 * Math.PI * 10, 0.03), volume(sw).toFixed(2));
check("sweep normals agree", normalsAgree(sw) === 1);
const arr = mesh.arrow([0, 0, 0], [0, 0, 10]);
check("arrow points along +z", near(arr.bounds.max[2], 10, 1e-4) && near(arr.bounds.min[2], 0, 1e-4));
const arc = mesh.arcArrow(5, 0, Math.PI);
check("arc arrow builds", arc.indices.length > 0 && volume(arc) > 0);
const helix = mesh.helix(2, 1, 5, 0.2);
check("helix volume positive", volume(helix) > 0);

// compose and invert
const M = m4.compose([1, 2, 3], [0.3, 0.5, 0.7], 2, [0.5, 0, 0]);
const p = m4.apply(m4.invert(M), m4.apply(M, [4, 5, 6]));
check("matrix invert roundtrip", v3.dist(p, [4, 5, 6]) < 1e-4);
const R = m4.rotationY(Math.PI / 2);
check("rotationY maps +x to -z", v3.dist(m4.apply(R, [1, 0, 0]), [0, 0, -1]) < 1e-6);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
