/* E3: a small WebGL2 engine for explainer figures.
   Surfaces are drawn the way a technical illustration is: porcelain diagram shading
   or physically based materials (metals that reflect a studio, brushed and heat-tinted
   steel, refracting glass, glowing hot parts), ink outlines, soft shadows, section cuts
   with hatching, see-through parts, ambient occlusion, GPU particles, a ray-marched
   rocket plume, bloom, and adaptive quality.
   Reference: references/engine3d.md in the skill. */
(() => {
  "use strict";

  // ---------- vectors and matrices (column-major, like WebGL) ----------
  const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(a[0], a[1], a[2]),
    norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  };

  const m4 = {
    identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    multiply(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    translation: ([x, y, z]) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]),
    scaling: ([x, y, z]) => new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]),
    rotationX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
    rotationY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    rotationZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    rotationAxis(axis, a) {
      const [x, y, z] = v3.norm(axis), c = Math.cos(a), s = Math.sin(a), t = 1 - c;
      return new Float32Array([
        t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
        t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
        t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
        0, 0, 0, 1,
      ]);
    },
    // Rotates +y onto dir (for arrows, cylinders between two points).
    alignY(dir) {
      const d = v3.norm(dir);
      const axis = v3.cross([0, 1, 0], d);
      const s = v3.len(axis), c = d[1];
      if (s < 1e-8) return c > 0 ? m4.identity() : m4.rotationX(Math.PI);
      return m4.rotationAxis(axis, Math.atan2(s, c));
    },
    invert(m) {
      const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
      const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
      const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return m4.identity();
      det = 1 / det;
      return new Float32Array([
        (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det,
        (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
        (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det,
        (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
        (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det,
        (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
        (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det,
        (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
      ]);
    },
    // Upper 3x3 of the inverse transpose, for transforming normals.
    normalMatrix(m) {
      const i = m4.invert(m);
      return new Float32Array([i[0], i[4], i[8], i[1], i[5], i[9], i[2], i[6], i[10]]);
    },
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    ortho(l, r, b, t, n, f) {
      return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0,
        -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
    },
    lookAt(eye, target, up) {
      const z = v3.norm(v3.sub(eye, target));
      let x = v3.cross(up, z);
      if (v3.len(x) < 1e-6) x = v3.cross([0, 0, 1], z);
      x = v3.norm(x);
      const y = v3.cross(z, x);
      return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
        -v3.dot(x, eye), -v3.dot(y, eye), -v3.dot(z, eye), 1]);
    },
    apply: (m, p) => [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ],
    applyDir: (m, d) => [
      m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
      m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
      m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
    ],
    project(m, p) {
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [x / w, y / w, z / w, w];
    },
    // position, rotation [x, y, z] (applied X, then Y, then Z), scale, optional pivot
    compose(position, rotation, scale, pivot) {
      let m = m4.translation(position);
      if (pivot) m = m4.multiply(m, m4.translation(pivot));
      if (rotation[2]) m = m4.multiply(m, m4.rotationZ(rotation[2]));
      if (rotation[1]) m = m4.multiply(m, m4.rotationY(rotation[1]));
      if (rotation[0]) m = m4.multiply(m, m4.rotationX(rotation[0]));
      const s = typeof scale === "number" ? [scale, scale, scale] : scale;
      if (s[0] !== 1 || s[1] !== 1 || s[2] !== 1) m = m4.multiply(m, m4.scaling(s));
      if (pivot) m = m4.multiply(m, m4.translation(v3.scale(pivot, -1)));
      return m;
    },
  };

  // ---------- 2D polygon helpers and triangulation ----------
  const area2 = pts => { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const cross2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const samePt = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  function inTri(p, a, b, c) {
    const d1 = cross2(a, b, p), d2 = cross2(b, c, p), d3 = cross2(c, a, p);
    const neg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12, pos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
    return !(neg && pos);
  }

  // Joins a clockwise hole into a counterclockwise outline through a mutually visible pair of vertices.
  function bridge(poly, hole) {
    let mi = 0;
    for (let i = 1; i < hole.length; i++) if (hole[i][0] > hole[mi][0]) mi = i;
    const M = hole[mi];
    let best = Infinity, bi = -1;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a[1] > M[1]) === (b[1] > M[1])) continue;
      const x = a[0] + (M[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
      if (x >= M[0] - 1e-9 && x - M[0] < best) { best = x - M[0]; bi = a[0] > b[0] ? i : (i + 1) % poly.length; }
    }
    if (bi < 0) return poly;
    const I = [M[0] + best, M[1]], P = poly[bi];
    let pick = bi, bestAngle = Infinity;
    for (let i = 0; i < poly.length; i++) {
      if (i === bi) continue;
      const q = poly[i], prev = poly[(i - 1 + poly.length) % poly.length], next = poly[(i + 1) % poly.length];
      if (cross2(prev, q, next) >= 0) continue; // only reflex vertices can block the bridge
      if (!inTri(q, M, I, P)) continue;
      const angle = Math.abs(Math.atan2(q[1] - M[1], q[0] - M[0]));
      if (angle < bestAngle) { bestAngle = angle; pick = i; }
    }
    const out = poly.slice(0, pick + 1);
    for (let k = 0; k <= hole.length; k++) out.push(hole[(mi + k) % hole.length]);
    out.push(poly[pick], ...poly.slice(pick + 1));
    return out;
  }

  // Ear clipping. Returns triangles [[a, b, c], ...] wound counterclockwise.
  function triangulate(outer, holes = []) {
    let poly = area2(outer) < 0 ? outer.slice().reverse() : outer.slice();
    const hs = holes.map(h => (area2(h) > 0 ? h.slice().reverse() : h.slice()));
    hs.sort((a, b) => Math.max(...b.map(p => p[0])) - Math.max(...a.map(p => p[0])));
    for (const h of hs) poly = bridge(poly, h);
    const idx = poly.map((_, i) => i);
    const tris = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < 100000) {
      let clipped = false;
      for (let k = 0; k < idx.length; k++) {
        const i0 = idx[(k - 1 + idx.length) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
        const a = poly[i0], b = poly[i1], c = poly[i2];
        if (cross2(a, b, c) <= 1e-12) continue;
        let ear = true;
        for (const j of idx) {
          if (j === i0 || j === i1 || j === i2) continue;
          const p = poly[j];
          if (samePt(p, a) || samePt(p, b) || samePt(p, c)) continue;
          if (inTri(p, a, b, c)) { ear = false; break; }
        }
        if (!ear) continue;
        tris.push([a, b, c]);
        idx.splice(k, 1);
        clipped = true;
        break;
      }
      if (!clipped) {
        // Degenerate input: drop the flattest vertex and keep going.
        let worst = 0, wv = Infinity;
        for (let k = 0; k < idx.length; k++) {
          const v = Math.abs(cross2(poly[idx[(k - 1 + idx.length) % idx.length]], poly[idx[k]], poly[idx[(k + 1) % idx.length]]));
          if (v < wv) { wv = v; worst = k; }
        }
        idx.splice(worst, 1);
      }
    }
    if (idx.length === 3 && cross2(poly[idx[0]], poly[idx[1]], poly[idx[2]]) > 1e-12) tris.push(idx.map(i => poly[i]));
    return tris;
  }

  // Moves each vertex of a closed polygon by d along its inward miter (positive d shrinks a CCW outline).
  function inset(pts, d) {
    if (!d) return pts.map(p => p.slice());
    const n = pts.length, ccw = area2(pts) > 0 ? 1 : -1;
    return pts.map((p, i) => {
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      const e0 = v2norm([p[0] - a[0], p[1] - a[1]]), e1 = v2norm([b[0] - p[0], b[1] - p[1]]);
      const n0 = [-e0[1] * ccw, e0[0] * ccw], n1 = [-e1[1] * ccw, e1[0] * ccw];
      const m = v2norm([n0[0] + n1[0], n0[1] + n1[1]]);
      const cos = m[0] * n0[0] + m[1] * n0[1];
      const len = d / Math.max(cos, 0.4);
      return [p[0] + m[0] * len, p[1] + m[1] * len];
    });
  }
  function v2norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

  // Catmull-Rom resampling of a 2D or 3D polyline (closed or open), for smooth outlines.
  function smooth(points, { closed = false, steps = 8 } = {}) {
    const n = points.length, out = [];
    const get = i => points[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        out.push(p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    if (!closed) out.push(points[n - 1].slice());
    return out;
  }

  // ---------- meshes ----------
  // Builders collect a triangle soup; finish() welds it and computes normals,
  // keeping edges sharper than `crease` degrees hard.
  class Soup {
    constructor() { this.p = []; }
    tri(a, b, c) { this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
    quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  }

  function finish(soup, { crease = 35, closed = false } = {}) {
    let p = soup.p;
    const nt = p.length / 9;
    if (closed && nt) {
      let vol = 0;
      for (let t = 0; t < nt; t++) {
        const o = t * 9;
        vol += p[o] * (p[o + 4] * p[o + 8] - p[o + 5] * p[o + 7]) - p[o + 1] * (p[o + 3] * p[o + 8] - p[o + 5] * p[o + 6]) + p[o + 2] * (p[o + 3] * p[o + 7] - p[o + 4] * p[o + 6]);
      }
      if (vol < 0) {
        p = p.slice();
        for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const o = t * 9; const tmp = p[o + 3 + k]; p[o + 3 + k] = p[o + 6 + k]; p[o + 6 + k] = tmp; }
      }
    }
    const fn = new Float64Array(nt * 3), fu = new Float64Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const o = t * 9;
      const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2];
      const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      fn[t * 3] = nx; fn[t * 3 + 1] = ny; fn[t * 3 + 2] = nz;
      const l = Math.hypot(nx, ny, nz) || 1;
      fu[t * 3] = nx / l; fu[t * 3 + 1] = ny / l; fu[t * 3 + 2] = nz / l;
    }
    const q = v => Math.round(v * 1e4);
    const key = c => `${q(p[c * 3])},${q(p[c * 3 + 1])},${q(p[c * 3 + 2])}`;
    const groups = new Map();
    for (let c = 0; c < nt * 3; c++) {
      const k = key(c);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(c);
    }
    const cosC = Math.cos((crease * Math.PI) / 180);
    const positions = [], normals = [], indices = [], vmap = new Map();
    for (let c = 0; c < nt * 3; c++) {
      const f = (c / 3) | 0;
      let nx = 0, ny = 0, nz = 0;
      for (const d of groups.get(key(c))) {
        const g = (d / 3) | 0;
        if (fu[f * 3] * fu[g * 3] + fu[f * 3 + 1] * fu[g * 3 + 1] + fu[f * 3 + 2] * fu[g * 3 + 2] >= cosC) {
          nx += fn[g * 3]; ny += fn[g * 3 + 1]; nz += fn[g * 3 + 2];
        }
      }
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) { nx = fu[f * 3]; ny = fu[f * 3 + 1]; nz = fu[f * 3 + 2]; l = Math.hypot(nx, ny, nz) || 1; }
      nx /= l; ny /= l; nz /= l;
      const vk = `${key(c)}|${Math.round(nx * 1000)},${Math.round(ny * 1000)},${Math.round(nz * 1000)}`;
      let vi = vmap.get(vk);
      if (vi === undefined) {
        vi = positions.length / 3;
        vmap.set(vk, vi);
        positions.push(p[c * 3], p[c * 3 + 1], p[c * 3 + 2]);
        normals.push(nx, ny, nz);
      }
      indices.push(vi);
    }
    return makeMesh(new Float32Array(positions), new Float32Array(normals), new Uint32Array(indices));
  }

  function makeMesh(positions, normals, indices) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
      if (positions[i + k] < min[k]) min[k] = positions[i + k];
      if (positions[i + k] > max[k]) max[k] = positions[i + k];
    }
    if (!positions.length) { min.fill(0); max.fill(0); }
    const center = v3.lerp(min, max, 0.5);
    let radius = 0;
    for (let i = 0; i < positions.length; i += 3) radius = Math.max(radius, v3.dist(center, [positions[i], positions[i + 1], positions[i + 2]]));
    return { positions, normals, indices, bounds: { min, max, center, radius }, version: 0, isMesh: true };
  }

  function transformMesh(mesh, m) {
    const nm = m4.normalMatrix(m);
    const pos = new Float32Array(mesh.positions.length), nor = new Float32Array(mesh.normals.length);
    for (let i = 0; i < pos.length; i += 3) {
      const p = m4.apply(m, [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
      const n = mesh.normals;
      const q = v3.norm([nm[0] * n[i] + nm[3] * n[i + 1] + nm[6] * n[i + 2], nm[1] * n[i] + nm[4] * n[i + 1] + nm[7] * n[i + 2], nm[2] * n[i] + nm[5] * n[i + 1] + nm[8] * n[i + 2]]);
      pos.set(p, i);
      nor.set(q, i);
    }
    return makeMesh(pos, nor, mesh.indices.slice());
  }

  function mergeMeshes(...meshes) {
    meshes = meshes.flat();
    let nv = 0, ni = 0;
    for (const m of meshes) { nv += m.positions.length; ni += m.indices.length; }
    const pos = new Float32Array(nv), nor = new Float32Array(nv), idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const m of meshes) {
      pos.set(m.positions, vo);
      nor.set(m.normals, vo);
      const base = vo / 3;
      for (let i = 0; i < m.indices.length; i++) idx[io + i] = m.indices[i] + base;
      vo += m.positions.length;
      io += m.indices.length;
    }
    return makeMesh(pos, nor, idx);
  }

  function grid(soup, rows, cols, at, { wrapCols = false } = {}) {
    const cc = wrapCols ? cols : cols - 1;
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cc; j++) {
      const j1 = (j + 1) % cols;
      soup.quad(at(i, j), at(i + 1, j), at(i + 1, j1), at(i, j1));
    }
  }

  const mesh = {
    box(w, h, d, { round = 0, segments = 4 } = {}) {
      const hx = w / 2, hy = h / 2, hz = d / 2;
      const r = Math.min(round, hx, hy, hz);
      const half = [hx, hy, hz], inner = [hx - r, hy - r, hz - r];
      const samples = k => {
        if (r <= 0) return [-half[k], half[k]];
        const s = [];
        for (let i = segments; i >= 1; i--) s.push(-(inner[k] + r * Math.tan((i / segments) * Math.PI / 4)));
        if (inner[k] > 1e-9) s.push(-inner[k], inner[k]); else s.push(0);
        for (let i = 1; i <= segments; i++) s.push(inner[k] + r * Math.tan((i / segments) * Math.PI / 4));
        return s;
      };
      const soup = new Soup();
      for (let axis = 0; axis < 3; axis++) for (const sign of [1, -1]) {
        const u = (axis + 1) % 3, v = (axis + 2) % 3;
        const su = samples(u), sv = samples(v);
        const at = (i, j) => {
          const pt = [0, 0, 0];
          pt[axis] = sign * half[axis];
          pt[u] = su[i];
          pt[v] = sign > 0 ? sv[j] : -sv[j];
          if (r <= 0) return pt;
          const c = pt.map((x, k) => Math.max(-inner[k], Math.min(inner[k], x)));
          const n = v3.norm(v3.sub(pt, c));
          return v3.add(c, v3.scale(n, r));
        };
        grid(soup, su.length, sv.length, at);
      }
      return finish(soup, { crease: r > 0 ? 50 : 30, closed: true });
    },

    ellipsoid(rx, ry = rx, rz = rx, { segments = 28 } = {}) {
      const soup = new Soup(), rows = segments + 1, cols = segments * 2;
      const at = (i, j) => {
        const th = (i / segments) * Math.PI, ph = (j / cols) * Math.PI * 2;
        return [rx * Math.sin(th) * Math.cos(ph), ry * Math.cos(th), rz * Math.sin(th) * Math.sin(ph)];
      };
      grid(soup, rows, cols, at, { wrapCols: true });
      return finish(soup, { crease: 80, closed: true });
    },
    sphere(r, o) { return mesh.ellipsoid(r, r, r, o); },

    // Along y, centered on the origin. r2 = 0 makes a cone.
    cylinder(r, h, { r2 = r, segments = 36, caps = true } = {}) {
      const soup = new Soup(), y0 = -h / 2, y1 = h / 2;
      const ring = (rad, y) => Array.from({ length: segments }, (_, j) => {
        const a = (j / segments) * Math.PI * 2;
        return [rad * Math.cos(a), y, -rad * Math.sin(a)];
      });
      const b = ring(r, y0), t = ring(r2, y1);
      for (let j = 0; j < segments; j++) {
        const k = (j + 1) % segments;
        soup.quad(b[j], b[k], t[k], t[j]);
      }
      if (caps) {
        for (let j = 0; j < segments; j++) {
          const k = (j + 1) % segments;
          if (r > 0) soup.tri([0, y0, 0], b[k], b[j]);
          if (r2 > 0) soup.tri([0, y1, 0], t[j], t[k]);
        }
      }
      return finish(soup, { crease: 40, closed: caps });
    },

    // Around y, in the xz plane.
    torus(R, r, { segments = 64, tube = 18, arc = Math.PI * 2 } = {}) {
      const soup = new Soup(), full = arc >= Math.PI * 2 - 1e-6;
      const cols = full ? segments : segments + 1;
      const at = (i, j) => {
        const a = (j / segments) * arc, b = (i / tube) * Math.PI * 2;
        const rr = R + r * Math.cos(b);
        return [rr * Math.cos(a), r * Math.sin(b), -rr * Math.sin(a)];
      };
      for (let i = 0; i < tube; i++) for (let j = 0; j < (full ? segments : segments); j++) {
        const j1 = full ? (j + 1) % segments : j + 1;
        soup.quad(at(i, j), at(i, j1), at(i + 1, j1), at(i + 1, j));
      }
      return finish(soup, { crease: 60, closed: full });
    },

    // Revolves a profile [[radius, y], ...] around y.
    lathe(profile, { segments = 48, crease = 35 } = {}) {
      const soup = new Soup(), n = profile.length;
      const at = (i, j) => {
        const a = (j / segments) * Math.PI * 2, [r, y] = profile[i];
        return [r * Math.cos(a), y, -r * Math.sin(a)];
      };
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < segments; j++) {
        const j1 = (j + 1) % segments;
        soup.quad(at(i, j), at(i, j1), at(i + 1, j1), at(i + 1, j));
      }
      const closed = profile[0][0] === 0 && profile[n - 1][0] === 0;
      return finish(soup, { crease, closed });
    },

    // Extrudes a 2D outline (xy) along z, centered. Optional rounded bevel and holes.
    extrude(shape, depth, { bevel = 0, bevelSegments = 3, holes = [] } = {}) {
      const outer = area2(shape) < 0 ? shape.slice().reverse() : shape.slice();
      const hs = holes.map(h => (area2(h) > 0 ? h.slice().reverse() : h.slice()));
      const b = Math.min(bevel, depth / 2 - 1e-6);
      const layers = [];
      if (b > 0) {
        for (let k = bevelSegments; k >= 0; k--) {
          const a = (k / bevelSegments) * Math.PI / 2;
          layers.push({ inset: b * (1 - Math.cos(a)), z: -(depth / 2 - b) - b * Math.sin(a) });
        }
        for (let k = 0; k <= bevelSegments; k++) {
          const a = (k / bevelSegments) * Math.PI / 2;
          layers.push({ inset: b * (1 - Math.cos(a)), z: depth / 2 - b + b * Math.sin(a) });
        }
      } else {
        layers.push({ inset: 0, z: -depth / 2 }, { inset: 0, z: depth / 2 });
      }
      const soup = new Soup();
      const loops = [outer, ...hs];
      for (const loop of loops) {
        const rings = layers.map(L => inset(loop, L.inset).map(p => [p[0], p[1], L.z]));
        for (let k = 0; k < rings.length - 1; k++) {
          const A = rings[k], B = rings[k + 1], n = loop.length;
          for (let i = 0; i < n; i++) {
            const i1 = (i + 1) % n;
            soup.quad(A[i], A[i1], B[i1], B[i]);
          }
        }
      }
      const capInset = b;
      const capOuter = inset(outer, capInset), capHoles = hs.map(h => inset(h, capInset));
      const tris = triangulate(capOuter, capHoles);
      for (const [p, q, r] of tris) {
        soup.tri([p[0], p[1], depth / 2], [q[0], q[1], depth / 2], [r[0], r[1], depth / 2]);
        soup.tri([p[0], p[1], -depth / 2], [r[0], r[1], -depth / 2], [q[0], q[1], -depth / 2]);
      }
      return finish(soup, { crease: 35, closed: true });
    },

    // Sweeps a 2D cross-section along a 3D path. section: [[x, y], ...] or (t, i) => [[x, y], ...]
    // with the same point count everywhere. x maps to the side vector, y to the up vector.
    sweep(path, section, { closed = false, caps = true, up = null, crease = 50 } = {}) {
      const n = path.length;
      const T = path.map((_, i) => {
        const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
        const b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
        return v3.norm(v3.sub(b, a));
      });
      const Nn = [], Bn = [];
      if (up) {
        for (let i = 0; i < n; i++) {
          let B = v3.sub(up, v3.scale(T[i], v3.dot(up, T[i])));
          if (v3.len(B) < 1e-6) B = Bn[i - 1] || [1, 0, 0];
          B = v3.norm(B);
          Bn.push(B);
          Nn.push(v3.norm(v3.cross(B, T[i])));
        }
      } else {
        let N0 = v3.cross(T[0], Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
        let N = v3.norm(N0);
        for (let i = 0; i < n; i++) {
          if (i > 0) {
            N = v3.sub(N, v3.scale(T[i], v3.dot(N, T[i])));
            N = v3.len(N) < 1e-6 ? Nn[i - 1] : v3.norm(N);
          }
          Nn.push(N);
          Bn.push(v3.norm(v3.cross(T[i], N)));
        }
      }
      const sec = i => (typeof section === "function" ? section(n > 1 ? i / (n - 1) : 0, i) : section);
      const rings = path.map((P, i) => sec(i).map(([x, y]) => v3.add(P, v3.add(v3.scale(Nn[i], x), v3.scale(Bn[i], y)))));
      const m = rings[0].length;
      // Orient side quads so normals point away from the path.
      const probe = () => {
        const a = rings[0][0], b = rings[0][1 % m], c = rings[1][1 % m];
        const nrm = v3.cross(v3.sub(b, a), v3.sub(c, a));
        const s0 = sec(0), cx = s0.reduce((s, p) => s + p[0], 0) / m, cy = s0.reduce((s, p) => s + p[1], 0) / m;
        const center = v3.add(path[0], v3.add(v3.scale(Nn[0], cx), v3.scale(Bn[0], cy)));
        return v3.dot(nrm, v3.sub(a, center)) >= 0;
      };
      const flip = n > 1 && !probe();
      const soup = new Soup();
      const segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const A = rings[i], B = rings[(i + 1) % n];
        for (let j = 0; j < m; j++) {
          const j1 = (j + 1) % m;
          if (flip) soup.quad(A[j], B[j], B[j1], A[j1]);
          else soup.quad(A[j], A[j1], B[j1], B[j]);
        }
      }
      if (caps && !closed) {
        for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
          const tris = triangulate(sec(i));
          for (const tri of tris) {
            const pts = tri.map(([x, y]) => v3.add(path[i], v3.add(v3.scale(Nn[i], x), v3.scale(Bn[i], y))));
            const nrm = v3.cross(v3.sub(pts[1], pts[0]), v3.sub(pts[2], pts[0]));
            if (v3.dot(nrm, T[i]) * dir >= 0) soup.tri(pts[0], pts[1], pts[2]);
            else soup.tri(pts[0], pts[2], pts[1]);
          }
        }
      }
      return finish(soup, { crease, closed: closed || caps });
    },

    // A tube of radius r (number or t => number) along a path.
    tube(path, r, { segments = 18, closed = false, caps = true } = {}) {
      const radius = typeof r === "function" ? r : () => r;
      const circle = t => Array.from({ length: segments }, (_, j) => {
        const a = (j / segments) * Math.PI * 2, rr = Math.max(1e-4, radius(t));
        return [rr * Math.cos(a), rr * Math.sin(a)];
      });
      return mesh.sweep(path, circle, { closed, caps, crease: 70 });
    },

    helix(radius, pitch, turns, wire, { segments = 24 } = {}) {
      const steps = Math.max(12, Math.round(turns * 36)), path = [];
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * turns * Math.PI * 2;
        path.push([radius * Math.cos(a), (i / steps) * turns * pitch - (turns * pitch) / 2, -radius * Math.sin(a)]);
      }
      return mesh.tube(path, wire, { segments });
    },

    // A spur gear lying in the xz plane (axis along y).
    gear({ teeth = 20, module = 1, thickness = 2, hole = 0, spokes = 0, rim = null, bevel = 0 } = {}) {
      const rp = (teeth * module) / 2, ra = rp + module, rr = Math.max(rp - 1.25 * module, module * 0.5);
      const P = (Math.PI * 2) / teeth, pts = [];
      const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
      for (let k = 0; k < teeth; k++) {
        const c = k * P;
        pts.push(polar(rr, c - 0.5 * P), polar(rr, c - 0.3 * P), polar(rp, c - 0.22 * P), polar(ra, c - 0.13 * P),
          polar(ra, c), polar(ra, c + 0.13 * P), polar(rp, c + 0.22 * P), polar(rr, c + 0.3 * P));
      }
      const holes = [];
      const circle = (r, n = 32) => Array.from({ length: n }, (_, i) => polar(r, (i / n) * Math.PI * 2));
      if (hole > 0) holes.push(circle(hole));
      if (spokes > 0) {
        const rimW = rim ?? module * 2.2, rOut = rr - rimW, rIn = Math.max(hole * 2.2, rp * 0.28);
        const spokeAng = Math.min(0.5, (module * 1.6) / ((rOut + rIn) / 2));
        for (let s = 0; s < spokes; s++) {
          const a0 = (s / spokes) * Math.PI * 2 + spokeAng / 2, a1 = ((s + 1) / spokes) * Math.PI * 2 - spokeAng / 2;
          if (rOut <= rIn || a1 <= a0) continue;
          const win = [];
          for (let i = 0; i <= 12; i++) win.push(polar(rOut, a0 + ((a1 - a0) * i) / 12));
          for (let i = 12; i >= 0; i--) win.push(polar(rIn, a0 + ((a1 - a0) * i) / 12));
          holes.push(win);
        }
      }
      const m = mesh.extrude(pts, thickness, { holes, bevel });
      return transformMesh(m, m4.rotationX(-Math.PI / 2));
    },

    // A straight arrow from a to b (world units), shaft plus cone head.
    arrow(a, b, { radius = null, head = null, headRadius = null, segments = 20 } = {}) {
      const len = v3.dist(a, b);
      const r = radius ?? len * 0.03, hl = Math.min(head ?? r * 5, len * 0.6), hr = headRadius ?? r * 2.4;
      const shaft = transformMesh(mesh.cylinder(r, len - hl, { segments }), m4.translation([0, (len - hl) / 2, 0]));
      const tip = transformMesh(mesh.cylinder(hr, hl, { r2: 0, segments }), m4.translation([0, len - hl / 2, 0]));
      const m = m4.multiply(m4.translation(a), m4.alignY(v3.sub(b, a)));
      return transformMesh(mergeMeshes(shaft, tip), m);
    },

    // A curved arrow around the y axis, from angle a0 to a1 (radians, counterclockwise seen from +y).
    arcArrow(radius, a0, a1, { tube = null, head = null, y = 0, segments = 40 } = {}) {
      const r = tube ?? radius * 0.06, hl = head ?? r * 5, dir = Math.sign(a1 - a0) || 1;
      const headAng = Math.min(Math.abs(a1 - a0) * 0.5, hl / radius);
      const end = a1 - dir * headAng, path = [];
      for (let i = 0; i <= segments; i++) {
        const a = a0 + ((end - a0) * i) / segments;
        path.push([radius * Math.cos(a), y, -radius * Math.sin(a)]);
      }
      const body = mesh.tube(path, r, { segments: 16 });
      const p1 = [radius * Math.cos(a1), y, -radius * Math.sin(a1)];
      const p0 = [radius * Math.cos(end), y, -radius * Math.sin(end)];
      const cone = transformMesh(mesh.cylinder(r * 2.4, v3.dist(p0, p1), { r2: 0, segments: 20 }),
        m4.multiply(m4.multiply(m4.translation(v3.lerp(p0, p1, 0.5)), m4.alignY(v3.sub(p1, p0))), m4.identity()));
      return mergeMeshes(body, cone);
    },

    plane(w, d) {
      const soup = new Soup(), x = w / 2, z = d / 2;
      soup.quad([-x, 0, z], [x, 0, z], [x, 0, -z], [-x, 0, -z]);
      return finish(soup, { crease: 10 });
    },

    custom(positions, indices, { crease = 35 } = {}) {
      const soup = new Soup();
      for (let i = 0; i < indices.length; i += 3) soup.tri(positions[indices[i]], positions[indices[i + 1]], positions[indices[i + 2]]);
      return finish(soup, { crease });
    },

    transform: transformMesh,
    merge: mergeMeshes,
  };


  // ---------- color ----------
  // Colors are 0..1 display (sRGB) values unless a name says linear. Palette values arrive
  // as #rgb, #rrggbb, or rgb() once a host's CSS minifier has had them.
  const clamp01 = x => Math.max(0, Math.min(1, x));
  function parseColor(v) {
    const s = String(v ?? "").trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [...m[1]].map(h => parseInt(h + h, 16) / 255);
    m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(s);
    if (m) { const n = parseInt(m[1], 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
    return null;
  }
  const hexRgb = hex => parseColor(hex) ?? [0.5, 0.5, 0.5];
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const toLinear = c => c.map(v => Math.max(0, v) ** 2.2);
  const toHex = c => "#" + c.map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("");

  // Color of a black body at T kelvin, as linear RGB with its brightest channel at 1
  // (Tanner Helland's fit to the Planckian locus). The shaders carry the same formula.
  function blackbody(T) {
    const t = Math.min(40000, Math.max(500, T)) / 100;
    const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    return [r, g, b].map(v => clamp01(v / 255) ** 2.2);
  }
  // How brightly a surface at T kelvin glows, in the engine's linear units: nothing below
  // about 720 K (450 °C), a dull red by 1000 K, bright orange by 1500 K, near white past 2500 K.
  const glowOf = T => { const k = Math.max(T - 720, 0) / 700; return k * k * k * 2.5; };
  // Temper colors: the oxide film on hot steel goes straw, brown, purple, blue, then grey.
  // T in kelvin; shift moves the ramp up for alloys that resist it (inconel: 150).
  // Returns { color: [r, g, b] display, amount: 0..1 }.
  function heatTint(T, shift = 0) {
    const c = T - shift - 273.15, sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
    let col = mixRgb([0.93, 0.86, 0.62], [0.85, 0.66, 0.32], sm(190, 240, c));
    col = mixRgb(col, [0.62, 0.38, 0.2], sm(240, 260, c));
    col = mixRgb(col, [0.45, 0.22, 0.42], sm(260, 278, c));
    col = mixRgb(col, [0.15, 0.2, 0.55], sm(278, 295, c));
    col = mixRgb(col, [0.3, 0.5, 0.78], sm(295, 320, c));
    col = mixRgb(col, [0.52, 0.55, 0.58], sm(320, 380, c));
    col = mixRgb(col, [0.36, 0.35, 0.34], sm(380, 600, c));
    return { color: col, amount: sm(180, 230, c) };
  }

  // ---------- materials ----------
  // Materials without `metal` or `roughness` keep the original porcelain shading: soft wrap
  // light, ink outlines, the house diagram look. The rest are physically based: GGX
  // specular, Fresnel, metalness and roughness, lit by the studio environment. f0 is the
  // measured reflectance of the metal (linear RGB).
  const MATERIALS = {
    porcelain: { color: "#f1efe9" },
    paper: { color: "#f7f5ef" },
    bone: { color: "#ede2c9" },
    enamel: { color: "#f8f5ed" },
    cartilage: { color: "#d5e4ea" },
    muscle: { color: "#dc8c80" },
    tendon: { color: "#eee1c0" },
    tissue: { color: "#f0c5ba" },
    fat: { color: "#f2e0a6" },
    nerve: { color: "#ecd067" },
    artery: { color: "#d8645c" },
    vein: { color: "#7896c8" },
    graphite: { color: "#4a4a50" },
    steel: { color: "#bfc3ca", metal: 1, roughness: 0.3, f0: [0.56, 0.57, 0.58] },
    brushed: { color: "#c4c7cc", metal: 1, roughness: 0.3, f0: [0.6, 0.6, 0.6], anisotropy: 0.75, brush: "turned" },
    aluminum: { color: "#d4d7db", metal: 1, roughness: 0.36, f0: [0.91, 0.92, 0.92] },
    titanium: { color: "#a9a49c", metal: 1, roughness: 0.38, f0: [0.54, 0.5, 0.45], heatShift: 60 },
    chrome: { color: "#d8dadc", metal: 1, roughness: 0.08, f0: [0.55, 0.56, 0.55] },
    copper: { color: "#cf8a5c", metal: 1, roughness: 0.26, f0: [0.95, 0.64, 0.54] },
    brass: { color: "#d1a650", metal: 1, roughness: 0.24, f0: [0.91, 0.78, 0.42] },
    gold: { color: "#e0b94f", metal: 1, roughness: 0.18, f0: [1.0, 0.77, 0.34] },
    inconel: { color: "#b8b3aa", metal: 1, roughness: 0.4, f0: [0.62, 0.58, 0.52], heatShift: 150 },
    ceramic: { color: "#ece8df", metal: 0, roughness: 0.4 },
    plastic: { color: "#e9e7e2", metal: 0, roughness: 0.5 },
    concrete: { color: "#bdb8ae", metal: 0, roughness: 0.92 },
    carbon: { color: "#2b2c30", metal: 0, roughness: 0.32, clearcoat: 1, weave: true },
    rubber: { color: "#2c2c2e", metal: 0, roughness: 0.9 },
    paint: { color: "#e6e3dc", metal: 0, roughness: 0.45, clearcoat: 1 },
    glass: { color: "#eef4f4", glass: true, ior: 1.5, roughness: 0.03, dispersion: 0.008 },
    frosted: { color: "#f1f4f4", glass: true, ior: 1.5, roughness: 0.35, dispersion: 0.004 },
    water: { color: "#9cc9d8", glass: true, ior: 1.333, roughness: 0.02, dispersion: 0.002, water: true },
    ghost: { color: "#f1efe9", opacity: 0.3 },
    hot: { color: "#3b3634", metal: 0, roughness: 0.6, temperature: 1400 },
  };
  const ACCENTS = ["red", "orange", "green", "blue", "purple"];
  // In the "anatomy" look the anatomy names shade as tissue (other looks keep the diagram look,
  // so simple teaching figures stay simple). An object material can tune any of these.
  const TISSUE = {
    bone: { sss: 0.22, sssColor: "#c79a6a", wet: 0.08 }, enamel: { sss: 0.4, sssColor: "#d7d2c0", wet: 0.35 },
    cartilage: { sss: 0.75, sssColor: "#8fb1c4", wet: 0.65 }, muscle: { sss: 0.55, sssColor: "#9c2a22", wet: 0.45, sheen: 0.15 },
    tendon: { sss: 0.3, sssColor: "#c9a77a", wet: 0.35, sheen: 0.6 }, tissue: { sss: 0.6, sssColor: "#c9533f", wet: 0.5 },
    fat: { sss: 0.8, sssColor: "#e0a640", wet: 0.35 }, nerve: { sss: 0.45, sssColor: "#b8902d", wet: 0.35, sheen: 0.3 },
    artery: { sss: 0.5, sssColor: "#8a1c16", wet: 0.55 }, vein: { sss: 0.5, sssColor: "#2c3f7a", wet: 0.55 },
  };

  // A display color for a material color: an accent name, a material name, #hex, rgb(), or a
  // palette name. Accents on diagram materials are the pale tints of the page's subject
  // colors; on physical materials (paint) they are the subject colors themselves.
  function colorOf(c, physical) {
    const pal = (typeof window !== "undefined" && window.palette) || {};
    if (ACCENTS.includes(c)) { const p = hexRgb(pal[c] || "#888888"); return physical ? p : mixRgb(p, [1, 1, 1], 0.42); }
    if (MATERIALS[c]) return hexRgb(MATERIALS[c].color);
    return parseColor(c) ?? (pal[c] ? hexRgb(pal[c]) : hexRgb(MATERIALS.porcelain.color));
  }

  // Temperature: a number (kelvin) or a field along a local axis,
  // { axis: [0, 1, 0], stops: [[s, T], ...] } with s the distance along the axis (up to 4 stops).
  function tempField(t) {
    if (t == null || t === false) return null;
    if (typeof t === "number") return { axis: [0, 1, 0], stops: [[0, t]] };
    const stops = (Array.isArray(t) ? t : t.stops || []).slice(0, 4).map(s => [+s[0], +s[1]]).sort((a, b) => a[0] - b[0]);
    return stops.length ? { axis: v3.norm(t.axis || [0, 1, 0]), stops } : null;
  }
  const tempAt = (field, s) => {
    const S = field.stops;
    if (S.length === 1 || s <= S[0][0]) return S[0][1];
    for (let i = 1; i < S.length; i++) if (s <= S[i][0]) return S[i - 1][1] + (S[i][1] - S[i - 1][1]) * (s - S[i - 1][0]) / (S[i][0] - S[i - 1][0] || 1);
    return S[S.length - 1][1];
  };

  // Everything the renderer needs to know about how a node looks.
  function resolveMaterial(node, look) {
    // A light's own surface.
    if (node._light) return { name: "light", rgb: [1, 1, 1], physical: true, metal: 0, f0: [0, 0, 0], emissive: node._light, temp: null, opacity: 1, kind: "opaque", roughness: 1, anisotropy: 0, brush: 0, brushAxis: [0, 1, 0], clearcoat: 0, weave: false, heatShift: null, ior: 1.5, dispersion: 0, thickness: null, water: null, glow: true, sss: 0, sssColor: [0, 0, 0], sheen: 0, fibers: null, emitter: true, map: null, foliage: false };
    let m = node.material, name = null;
    const tissueOf = n => (look === "anatomy" && TISSUE[n] ? TISSUE[n] : {});
    if (typeof m === "string") { name = m; m = { ...(MATERIALS[m] ?? { color: m }), ...tissueOf(m) }; }
    else if (m && m.base) m = { ...(MATERIALS[m.base] || {}), ...tissueOf(m.base), ...m };
    m = { ...(m || {}) };
    // Tissue only shades as tissue in the anatomy look; elsewhere it's the diagram color.
    const tissue = (look === "anatomy" && (m.sss != null || m.wet != null || m.sheen != null)) || !!m.foliage;
    if (m.foliage) { m.sss ??= 0.45; m.sssColor ??= "#9fbf3a"; m.sheen ??= 0.12; m.wet ??= 0.04; }
    if (tissue) {
      const wet = clamp01(m.wet ?? 0.3);
      m.roughness ??= 0.72 - 0.4 * wet;
      m.clearcoat ??= wet * 0.85;
      m.metal ??= 0;
    }
    if (m.color == null) m.color = MATERIALS.porcelain.color;
    const temp = tempField(node.temperature ?? m.temperature);
    const physical = (m.metal != null && m.metal !== false) || m.roughness != null || !!m.glass || m.emissive != null || !!temp;
    const rgb = colorOf(node.color ?? m.color, physical);
    const metal = m.metal === true ? 1 : clamp01(+m.metal || 0);
    const f0 = metal ? (node.color == null && m.f0 ? m.f0 : toLinear(rgb)) : [0.04, 0.04, 0.04];
    let emissive = [0, 0, 0];
    if (m.emissive != null && m.emissive !== false) {
      const k = m.emissiveIntensity ?? 2;
      emissive = typeof m.emissive === "number" ? toLinear(rgb).map(v => v * m.emissive) : toLinear(Array.isArray(m.emissive) ? m.emissive : colorOf(m.emissive, true)).map(v => v * k);
    }
    const opacity = node.opacity < 1 ? node.opacity : m.opacity ?? 1;
    const brush = m.brush === "linear" ? 1 : 0;
    return {
      name, rgb, physical, metal, f0, emissive, temp, opacity,
      kind: opacity < 0.999 ? "ghost" : m.glass ? "glass" : "opaque",
      roughness: clamp01(m.roughness ?? (metal ? 0.3 : 0.5)),
      anisotropy: clamp01(m.anisotropy ?? 0),
      brush, brushAxis: v3.norm(m.brushAxis || [0, 1, 0]),
      clearcoat: clamp01(m.clearcoat ?? 0),
      weave: !!m.weave,
      heatShift: metal && temp ? (m.heatShift ?? 0) : null,
      ior: m.ior ?? 1.5, dispersion: m.dispersion ?? 0.008, thickness: m.thickness ?? null,
      water: m.water ? { ripples: m.ripples ?? 0.35, wavelength: m.wavelength ?? null, depth: m.depthColor ?? 0.5 } : null,
      glow: !!temp || emissive.some(v => v > 0),
      sss: tissue ? clamp01(m.sss ?? 0.4) : 0, sssColor: tissue ? colorOf(m.sssColor ?? "#b5463d", true) : [0, 0, 0],
      sheen: tissue ? clamp01(m.sheen ?? 0) : 0, fibers: tissue && m.fibers ? v3.norm(m.fibers === true ? [0, 1, 0] : m.fibers) : null,
      emitter: false, foliage: !!m.foliage,
      // A picture on the part: map (canvas, image, ImageData, or (u, v) => color), mapping
      // "sphere" (latitude and longitude), "planar" (local x-z), or "box"; mapRoughness: alpha is roughness.
      map: m.map ? { src: m.map, mapping: { sphere: 0, planar: 1, box: 2, project: 3 }[m.mapping ?? "sphere"] ?? 0, box: m.mapBox ?? [-0.5, -0.5, 1, 1], rough: !!m.mapRoughness, projector: m.projector ?? null } : null,
    };
  }

  // ---------- looks ----------
  // One word picks the whole light rig: the environment the metals reflect, the strength of
  // the camera-locked key, fill, and rim lights, shadows, outline weight, and bloom.
  //   studio   soft boxes on a neutral sweep, the default
  //   diagram  flatter and lighter, for teaching drawings with only a few real materials
  //   night    dark surround, strong rim light, glowing parts carry the picture
  //   outdoor  sky dome and a warm sun, harder shadows
  const LOOKS = {
    studio: { env: 0, key: 2.6, fill: 0.5, rim: 1.4, diffuse: 1, specular: 1, ink: 1, parts: 0.5, ground: 0.5, soft: 1, bloom: 0.9, exposure: 1, keyColor: [1, 0.97, 0.93], fillColor: [0.9, 0.94, 1] },
    diagram: { env: 0, key: 2.2, fill: 0.6, rim: 0.7, diffuse: 1.15, specular: 0.85, ink: 1, parts: 0.3, ground: 0.36, soft: 1.5, bloom: 0.6, exposure: 1.05, keyColor: [1, 0.98, 0.95], fillColor: [0.92, 0.95, 1] },
    night: { env: 1, key: 1.1, fill: 0.15, rim: 2.6, diffuse: 0.5, specular: 1, ink: 0.55, parts: 0.7, ground: 0.6, soft: 0.8, bloom: 1.4, exposure: 1, keyColor: [0.72, 0.8, 1], fillColor: [0.6, 0.7, 1] },
    outdoor: { env: 2, key: 3.4, fill: 0.55, rim: 0.4, diffuse: 0.9, specular: 1, ink: 0.65, parts: 0.65, ground: 0.6, soft: 0.45, bloom: 0.7, exposure: 0.95, keyColor: [1, 0.94, 0.84], fillColor: [0.72, 0.84, 1] },
    // Anatomy: a soft surgical studio; anatomy materials shade as tissue, light ink.
    anatomy: { env: 0, key: 2.3, fill: 0.8, rim: 0.9, diffuse: 1.05, specular: 0.9, ink: 0.45, parts: 0.55, ground: 0.45, soft: 1.3, bloom: 0.45, exposure: 1.05, keyColor: [1, 0.96, 0.92], fillColor: [0.92, 0.95, 1] },
    // Darkroom: nothing but the scene's own lights (scene.lights with a type and power) and sky,
    // on black. Shadows, bounced light, and haze are traced, so what you see is what the light does.
    darkroom: { env: 0, key: 0, fill: 0, rim: 0, diffuse: 0, specular: 0, ink: 0.4, parts: 0, ground: 0, soft: 1, bloom: 0.5, exposure: 0.15, keyColor: [1, 1, 1], fillColor: [1, 1, 1], room: true },
  };
  const lookOf = scene => LOOKS[scene.look] || LOOKS.studio;
  // Whether the page is dark, from the palette's background.
  function pageDark() {
    const pal = (typeof window !== "undefined" && window.palette) || {};
    const c = parseColor(pal.bg || pal.panel);
    return !!c && 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 0.5;
  }

  // ---------- adaptive quality ----------
  // Three tiers. While the view moves or an animation plays, the engine watches the time
  // between frames and steps down a tier when frames run long, back up when they're quick.
  // Still frames (and the page checker) always get the full shadow and volume quality;
  // particle counts follow the tier so a paused figure doesn't change its smoke. Systems
  // that measure, run on the CPU, or hold a fixed population (gas molecules) keep every slot.
  const TIERS = {
    low: { rank: 0, ss: 1, scale: 0.75, msaa: 4, shadow: 1024, particles: 0.35, steps: 22, bloom: true, vsteps: 36, vscale: 0.33 },
    medium: { rank: 1, ss: 2, scale: 1, msaa: 4, shadow: 1536, particles: 0.6, steps: 32, bloom: true, vsteps: 56, vscale: 0.5 },
    high: { rank: 2, ss: 3, scale: 1, msaa: 4, shadow: 2048, particles: 1, steps: 48, bloom: true, vsteps: 88, vscale: 0.5 },
  };
  const TIER_NAMES = ["low", "medium", "high"];
  const Q = { rank: null, ema: 16.7, last: 0, quickSince: 0, downAt: -1e9, forced: null };
  function startRank() {
    try {
      const coarse = matchMedia("(pointer: coarse)").matches;
      const small = Math.min(screen.width, screen.height) < 600;
      return coarse ? (small ? 0 : 1) : 2;
    } catch { return 2; }
  }
  const checking = () => typeof document !== "undefined" && document.documentElement.classList.contains("safis-checking");
  // Picks the tier for this frame. `moving` frames come in a stream (< 250 ms apart) or at
  // ss 1, which the page asks for while the reader drags on a dense screen. A caller that
  // knows better passes `cam.still` (the runtime does: true for the frame after a drag),
  // so the settled frame always comes back at full quality.
  function qualityFor(scene, cam, ss, now) {
    const force = cam.quality ?? scene.quality ?? Q.forced;
    const dt = now - (scene._lastFrame ?? -1e9);
    scene._lastFrame = now;
    const moving = cam.still != null ? !cam.still : dt < 250 || ss < 2;
    if (Q.rank == null) Q.rank = startRank();
    if (checking()) return { ...TIERS.high, name: "high", ss, moving: false };
    if (TIERS[force]) {
      const t = TIERS[force];
      return { ...t, name: force, ss: moving ? Math.min(ss, t.ss) : ss, scale: moving ? t.scale : 1, moving };
    }
    const hitch = typeof R !== "undefined" && R && R.hitch;
    if (hitch) R.hitch = false;
    if (moving && dt < 250 && !hitch) {
      Q.ema = Q.ema * 0.9 + Math.min(dt, 250) * 0.1;
      if (Q.ema > 30 && Q.rank > 0 && now - Q.downAt > 800) { Q.rank--; Q.downAt = now; Q.ema = 20; Q.quickSince = now; }
      else if (Q.ema < 18) {
        if (!Q.quickSince) Q.quickSince = now;
        if (Q.rank < 2 && now - Q.quickSince > 3000 && now - Q.downAt > 10000) { Q.rank++; Q.quickSince = now; }
      } else Q.quickSince = 0;
    }
    const name = TIER_NAMES[Q.rank], t = TIERS[name];
    if (!moving) return { ...t, name, ss, scale: 1, shadow: TIERS.high.shadow, steps: TIERS.high.steps, vsteps: TIERS.high.vsteps, vscale: TIERS.high.vscale, moving };
    return { ...t, name, ss: Math.min(ss, t.ss), moving };
  }

  // ---------- scene graph ----------
  class Node {
    constructor(meshArg = null, o = {}) {
      this.mesh = meshArg;
      this.children = [];
      this.parent = null;
      this.name = "";
      this.position = [0, 0, 0];
      this.rotation = [0, 0, 0];
      this.scale = 1;
      this.pivot = null;
      this.matrix = null;
      this.material = "porcelain";
      this.color = null;
      this.opacity = 1;
      this.temperature = null;
      this.visible = true;
      this.cut = true;
      this.highlight = false;
      this.pickable = true;
      this.set(o);
    }
    set(o = {}) {
      for (const [k, v] of Object.entries(o)) if (k !== "parent") this[k] = v;
      return this;
    }
    add(child, o) {
      const node = child instanceof Node ? child.set(o) : new Node(child, o);
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = this;
      this.children.push(node);
      return node;
    }
    group(o) { return this.add(null, o); }
    local() { return this.matrix ?? m4.compose(this.position, this.rotation, this.scale, this.pivot); }
    world() { return this.parent ? m4.multiply(this.parent.world(), this.local()) : this.local(); }
    // A point in this node's local coordinates, in world coordinates.
    toWorld(p) { return m4.apply(this.world(), p); }
    find(name) {
      if (this.name === name) return this;
      for (const c of this.children) { const f = c.find(name); if (f) return f; }
      return null;
    }
    traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
    scene() { let n = this; while (n.parent) n = n.parent; return n; }
  }

  class Scene extends Node {
    constructor(o = {}) {
      super(null, {});
      this.cutPlane = null;    // [nx, ny, nz, d]: removes points where n·p > d
      this.shadow = true;      // soft shadows on the ground and between parts
      this.light = "camera";   // "camera" (studio light that follows the view) or a world direction
      this.lighting = "soft";  // "soft" porcelain shading, or "sun" for a hard day/night terminator
      this.look = "studio";    // "studio", "diagram", "night", "outdoor"
      this.ink = 1;            // outline weight multiplier
      this.time = 0;           // seconds, for particles and plumes
      this.set(o);
    }
  }

  // ---------- random numbers shared with the shaders ----------
  // A 32-bit integer hash; the GLSL in the particle shaders is the same function, so a
  // particle's birth place, speed, and life come out the same on the CPU and the GPU.
  const hashU = x => {
    x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 0x7feb352d) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0; x = Math.imul(x, 0x846ca68b) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  };
  const rndU = (i, k, c, seed) => (hashU((Math.imul(i, 0x9E3779B1) ^ hashU((k + Math.imul(c, 0x632BE5AB) + seed) >>> 0)) >>> 0) >>> 8) / 16777216;
  const hash3 = (x, y, z, s) => (hashU((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ s) >>> 0) >>> 8) / 8388608 - 1;
  // Value noise with its gradient, [n, dn/dx, dn/dy, dn/dz] (Quilez); curl noise is built from three of these.
  function noised(x, y, z, s = 0) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
    const q = f => f * f * f * (f * (f * 6 - 15) + 10), dq = f => 30 * f * f * (f * (f - 2) + 1);
    const ux = q(fx), uy = q(fy), uz = q(fz), dx = dq(fx), dy = dq(fy), dz = dq(fz);
    const a = hash3(ix, iy, iz, s), b = hash3(ix + 1, iy, iz, s), c = hash3(ix, iy + 1, iz, s), d = hash3(ix + 1, iy + 1, iz, s);
    const e = hash3(ix, iy, iz + 1, s), f = hash3(ix + 1, iy, iz + 1, s), g = hash3(ix, iy + 1, iz + 1, s), h = hash3(ix + 1, iy + 1, iz + 1, s);
    const k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + g, k6 = a - b - e + f, k7 = -a + b + c - d + e - f - g + h;
    return [a + k1 * ux + k2 * uy + k3 * uz + k4 * ux * uy + k5 * uy * uz + k6 * uz * ux + k7 * ux * uy * uz,
      dx * (k1 + k4 * uy + k6 * uz + k7 * uy * uz), dy * (k2 + k5 * uz + k4 * ux + k7 * uz * ux), dz * (k3 + k6 * ux + k5 * uy + k7 * ux * uy)];
  }
  function curl(x, y, z) {
    const a = noised(x, y, z, 0), b = noised(x + 31.4, y + 17.2, z + 5.9, 0), c = noised(x - 11.3, y + 47.1, z + 23.7, 0);
    return [c[2] - b[3], a[3] - c[1], b[1] - a[2]];
  }

  // ---------- potential flow ----------
  // Two-dimensional ideal flow in the xy plane (extruded along z): uniform stream past a
  // cylinder, and past a Joukowski airfoil with the circulation that makes the flow leave
  // the trailing edge smoothly (the Kutta condition). The particle shaders carry the same
  // formulas, so tracers follow exactly these streamlines.
  const cx = {
    mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
    div: (a, b) => { const d = b[0] * b[0] + b[1] * b[1] || 1e-30; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; },
    sqrt: a => { const r = Math.hypot(a[0], a[1]), t = Math.atan2(a[1], a[0]) / 2, s = Math.sqrt(r); return [s * Math.cos(t), s * Math.sin(t)]; },
  };
  // A tube flow: axisymmetric stream layers between surfaces of revolution, sampled along the
  // axis (local y) at n stations from y0 every dy. Each station row is the five boundary radii
  // [c0, c1, b0, b1, x0]: core layer c0..c1, bypass b0..b1 (walls where c1 < b0 or b1 < x0), and
  // the outside air from x0 out (an optional sixth value scales the core's volume flow, for
  // gas that expands as it's heated). Each inner layer carries a fixed flux (q, as Q / pi); within a
  // layer the stream function is linear in r², so the axial speed is q / (b² - a²) and the
  // streamlines follow both walls exactly. matrix places the flow's frame in the world.
  function tubeSpec(o) {
    const rows = o.rows, n = rows.length, M = o.matrix ? Float32Array.from(o.matrix) : m4.identity();
    const data = new Float32Array(n * 2 * 4);
    rows.forEach((r, i) => { data.set([r[0], r[1], r[2], r[3]], i * 4); data.set([r[4], r[5] ?? 1, 0, 0], (n + i) * 4); });
    return { type: "tube", kind: 3, U: o.U0, U0: o.U0, y0: o.y0, dy: o.dy, n, rows, q: o.q, M, MI: m4.invert(M), data, center: [0, 0, 0], alpha: 0, S: 1, mu: [0, 0], a: 0, gamma: 0, mid: 0 };
  }
  function tubeAt(F, p) {
    const q = m4.apply(F.MI, p), y = q[1], r = Math.hypot(q[0], q[2]);
    const fi = (y - F.y0) / F.dy;
    if (fi < 0 || fi > F.n - 1) return m4.applyDir(F.M, [0, F.U0, 0]);
    const i = Math.min(F.n - 2, Math.floor(fi)), f = fi - i, A = F.rows[i], B = F.rows[i + 1];
    const v = A.map((a, k) => a + (B[k] - a) * f), d = A.map((a, k) => (B[k] - a) / F.dy);
    let a, b, da, db, Q;
    if (r < v[0] - 1e-6) return null;
    if (r <= v[1]) { a = v[0]; b = v[1]; da = d[0]; db = d[1]; Q = F.q[0] * (v[5] ?? 1); }
    else if (r < v[2]) return null;
    else if (r <= v[3]) { a = v[2]; b = v[3]; da = d[2]; db = d[3]; Q = F.q[1]; }
    else if (r < v[4]) return null;
    else { const uy = F.U0, ur = r > 1e-6 ? (uy * v[4] * d[4]) / r : 0; return m4.applyDir(F.M, [r > 1e-6 ? (ur * q[0]) / r : 0, uy, r > 1e-6 ? (ur * q[2]) / r : 0]); }
    const den = Math.max(b * b - a * a, 1e-9), uy = Q / den, eta = (r * r - a * a) / den;
    const ur = r > 1e-6 ? (uy * (a * da * (1 - eta) + b * db * eta)) / r : 0;
    return m4.applyDir(F.M, [r > 1e-6 ? (ur * q[0]) / r : 0, uy, r > 1e-6 ? (ur * q[2]) / r : 0]);
  }
  function flowSpec(o = {}) {
    if (o.kind === 3 || o.type === "tube") return o.kind === 3 ? o : tubeSpec(o);
    const type = o.type ?? (o.chord != null ? "airfoil" : o.radius != null ? "cylinder" : "uniform");
    const U = o.U ?? o.speed ?? 1, center = o.center ?? [0, 0, 0];
    if (type === "cylinder") {
      const R = o.radius ?? 1;
      return { type, kind: 1, U, center, R, gamma: o.circulation ?? 0, alpha: 0, S: 1, mu: [0, 0], a: R, mid: 0 };
    }
    if (type === "airfoil") {
      const eps = (o.thickness ?? 0.12) / 1.299, del = 2 * (o.camber ?? 0.04), alpha = o.alpha ?? 0;
      const mu = [-eps, del], a = Math.hypot(1 + eps, del), beta = Math.atan2(del, 1 + eps);
      const gamma = o.kutta === false ? 0 : 4 * Math.PI * a * U * Math.sin(alpha + beta);
      let x0 = Infinity, x1 = -Infinity;
      for (let i = 0; i < 360; i++) {
        const t = (i / 360) * Math.PI * 2, z = [mu[0] + a * Math.cos(t), mu[1] + a * Math.sin(t)];
        const w = [z[0], z[1]], inv = cx.div([1, 0], w);
        const X = w[0] + inv[0];
        x0 = Math.min(x0, X); x1 = Math.max(x1, X);
      }
      const chord = o.chord ?? 1;
      return { type, kind: 2, U, center, mu, a, gamma, alpha, S: chord / (x1 - x0), mid: (x0 + x1) / 2, beta, lift: 2 * Math.PI * Math.sin(alpha + beta) * (o.kutta === false ? 0 : 1), chord };
    }
    return { type: "uniform", kind: 0, U, center, alpha: 0, S: 1, mu: [0, 0], a: 0, gamma: 0, mid: 0 };
  }
  // Velocity at world point p, or null inside the body.
  function flowAt(F, p) {
    if (F.kind === 0) return [F.U, 0, 0];
    if (F.kind === 3) return tubeAt(F, p);
    const ca = Math.cos(F.alpha), sa = Math.sin(F.alpha);
    let x = (p[0] - F.center[0]) / F.S, y = (p[1] - F.center[1]) / F.S;
    let w;
    if (F.kind === 1) {
      const z = [x, y], r2 = x * x + y * y;
      if (r2 < F.R * F.R / (F.S * F.S)) return null;
      const R2 = F.R * F.R;
      const t = cx.div([R2, 0], cx.mul(z, z));
      const circ = cx.div([0, F.gamma / (2 * Math.PI)], z);
      w = [F.U * (1 - t[0]) + circ[0], -F.U * t[1] + circ[1]];
    } else {
      // into the airfoil's own frame: chord along x, free stream at angle alpha
      const xr = x * ca - y * sa, yr = x * sa + y * ca;
      const z = [xr + F.mid, yr];
      const s = cx.sqrt([z[0] * z[0] - z[1] * z[1] - 4, 2 * z[0] * z[1]]);
      const z1 = [(z[0] + s[0]) / 2, (z[1] + s[1]) / 2], z2 = [(z[0] - s[0]) / 2, (z[1] - s[1]) / 2];
      const d1 = Math.hypot(z1[0] - F.mu[0], z1[1] - F.mu[1]), d2 = Math.hypot(z2[0] - F.mu[0], z2[1] - F.mu[1]);
      const zeta = d1 >= d2 ? z1 : z2, dm = Math.max(d1, d2);
      if (dm < F.a * 1.002) return null;
      const zm = [zeta[0] - F.mu[0], zeta[1] - F.mu[1]];
      const e1 = [Math.cos(-F.alpha), Math.sin(-F.alpha)], e2 = [Math.cos(F.alpha), Math.sin(F.alpha)];
      const t = cx.div(cx.mul([F.a * F.a, 0], e2), cx.mul(zm, zm));
      const circ = cx.div([0, F.gamma / (2 * Math.PI)], zm);
      const dWdzeta = [F.U * (e1[0] - t[0]) + circ[0], F.U * (e1[1] - t[1]) + circ[1]];
      const dzdzeta = (() => { const iz = cx.div([1, 0], cx.mul(zeta, zeta)); return [1 - iz[0], -iz[1]]; })();
      const dw = cx.div(dWdzeta, dzdzeta);
      const u = dw[0], v = -dw[1];
      return [u * ca + v * sa, -u * sa + v * ca, 0];
    }
    return [w[0], -w[1], 0];
  }
  const flow = {
    spec: flowSpec,
    // A flow you can sample: { velocity(p), outline(n), lift, spec }.
    cylinder: (o = {}) => flowObject(flowSpec({ ...o, type: "cylinder" })),
    airfoil: (o = {}) => flowObject(flowSpec({ ...o, type: "airfoil" })),
    uniform: (o = {}) => flowObject(flowSpec({ ...o, type: "uniform" })),
    tube: (o = {}) => flowObject(flowSpec({ ...o, type: "tube" })),
  };
  function flowObject(F) {
    return {
      spec: F, lift: F.lift ?? 0, circulation: F.gamma,
      velocity: p => flowAt(F, p),
      // The body's outline in the xy plane, in world units around the flow's center, with
      // the angle of attack applied: ready for E3.mesh.extrude (which extrudes along z).
      outline(n = 96) {
        const pts = [];
        for (let i = 0; i < n; i++) {
          const t = (i / n) * Math.PI * 2;
          if (F.kind === 1) { pts.push([F.R * Math.cos(t), F.R * Math.sin(t)]); continue; }
          if (F.kind !== 2) continue;
          const z = [F.mu[0] + F.a * Math.cos(t), F.mu[1] + F.a * Math.sin(t)], inv = cx.div([1, 0], z);
          const xr = (z[0] + inv[0] - F.mid) * F.S, yr = (z[1] + inv[1]) * F.S;
          const ca = Math.cos(F.alpha), sa = Math.sin(F.alpha);
          pts.push([xr * ca + yr * sa, -xr * sa + yr * ca]);
        }
        // Joukowski points crowd at the trailing edge; drop near-duplicates for clean triangulation.
        return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-4 * (F.chord ?? 1));
      },
    };
  }

  // ---------- particles ----------
  // A particle system lives in the scene like any node. Each of `count` slots is reborn
  // every `life[1]` seconds at a fixed phase (golden-ratio spacing, so any prefix of the
  // slots is spread evenly in time); where and how fast it's born comes from the hash of
  // (seed, slot, generation). The state is stepped in fixed steps on a global time grid,
  // so the picture at time t depends only on the seed and t: the page checker and
  // screenshots see the same smoke every time. Set `time` (or scene.time) from the figure's state.
  // What the particles are made of sets how they move, from SI numbers scaled by `units` (world
  // units per meter: "m", "cm", "mm", or a number). Things that fall get gravity and the drag that
  // brings them to their terminal speed in still air (vt, m/s); bubbles do the same upward (rise).
  // Hot gas gets Archimedes' lift on a parcel at its birth temperature in air at 293 K,
  // g (T - Ta) / T, fading as it mixes and cools, against an entrainment drag (1/s). Eddies are
  // the air's own swirl [speed m/s, size m, change rate], so a stiff tracer like dust rides them.
  const UNITS = { m: 1, cm: 100, mm: 1000, km: 0.001, in: 39.37, ft: 3.281 };
  const MATTER = {
    smoke: { gas: true, style: "smoke", temperature: [600, 300], drag: 1.6, eddy: [0.9, 0.8, 0.35], life: [5, 9], size: [0.3, 2.4], opacity: 0.3, bounce: 0, friction: 0.05 },
    exhaust: { gas: true, style: "smoke", temperature: [1100, 320], drag: 0.9, eddy: [2.2, 3, 0.25], life: [6, 12], size: [1, 8], opacity: 0.26, bounce: 0, friction: 0.05 },
    steam: { gas: true, style: "smoke", temperature: [373, 295], drag: 2.5, eddy: [0.4, 0.3, 0.5], life: [1.5, 3.5], size: [0.04, 0.5], opacity: 0.35, color: "#f3f5f7", fade: [0.12, 0.65], bounce: 0, friction: 0.05 },
    fire: { gas: true, style: "fire", temperature: [1300, 700], drag: 3.5, eddy: [1, 0.15, 1.4], life: [0.4, 0.9], size: [0.08, 0.3], intensity: 0.55, bounce: 0, friction: 0.05 },
    dust: { vt: 0.3, style: "smoke", eddy: [0.6, 0.6, 0.3], life: [3, 7], size: [0.08, 1], opacity: 0.22, color: "#a8916f", bounce: 0, friction: 1 },
    mist: { vt: 0.25, style: "smoke", eddy: [0.4, 0.5, 0.4], life: [1.5, 3], size: [0.05, 0.4], opacity: 0.18, color: "#eef4f8", fade: [0.1, 0.6], bounce: 0, friction: 1 },
    sand: { vt: 2.5, style: "dot", eddy: [0.2, 0.3, 0.3], life: [1.2, 2.5], size: [0.006, 0.006], color: "#c4a26a", bounce: 0.15, friction: 0.85 },
    water: { vt: 5.5, style: "streak", eddy: [0.05, 0.3, 0.3], life: [0.8, 2], size: [0.012, 0.012], color: "#d4e9f7", bounce: 0.1, friction: 0.6 },
    rain: { vt: 8.5, style: "streak", life: [1.5, 3], size: [0.006, 0.006], color: "#bcd3e6", bounce: 0.02, friction: 0.95 },
    snow: { vt: 1, style: "dot", eddy: [0.8, 0.6, 0.5], life: [4, 8], size: [0.012, 0.012], color: "#ffffff", bounce: 0, friction: 1 },
    spark: { vt: 7, style: "spark", temperature: [2100, 900], life: [0.5, 1.4], size: [0.01, 0.006], bounce: 0.35, friction: 0.25 },
    ember: { vt: 1.5, lift: 1.8, style: "spark", temperature: [1250, 750], eddy: [0.5, 0.3, 0.6], life: [1.5, 3.5], size: [0.012, 0.008], bounce: 0.2, friction: 0.6 },
    bubble: { rise: 0.25, style: "sphere", eddy: [0.06, 0.02, 1], life: [2, 5], size: [0.004, 0.005], color: "#dff1fb", bounce: 0, friction: 0 },
    air: { drag: 20, style: "streak", eddy: [0.3, 1, 0.3], life: [1, 2], size: [0.004, 0.004], color: "#9fc3dd", bounce: 0.5, friction: 0 },
    // Dust motes hanging in a room (10 µm: Stokes settling of a few mm/s), carried by faint drafts;
    // seen only where a beam lights them. Pollen grains (25 µm) settle a little faster.
    motes: { vt: 0.004, style: "dot", eddy: [0.03, 0.35, 0.12], life: [30, 60], size: [0.0018, 0.0018], color: "#f4ecdc", bounce: 0, friction: 1 },
    pollen: { vt: 0.025, style: "dot", eddy: [0.15, 0.5, 0.2], life: [12, 24], size: [0.0025, 0.0025], color: "#f0d36a", bounce: 0, friction: 1 },
  };
  // New presets from a page script, checked so a typo fails loudly instead of drawing nothing.
  const MATERIAL_KEYS = ["base", "color", "metal", "roughness", "f0", "clearcoat", "anisotropy", "brush", "brushAxis", "emissive", "emissiveIntensity", "temperature", "opacity", "glass", "ior", "dispersion", "thickness", "water", "ripples", "wavelength", "depthColor", "sss", "sssColor", "wet", "sheen", "fibers", "weave", "heatShift", "map", "mapping", "mapBox", "mapRoughness", "foliage"];
  const MATTER_KEYS = ["base", "gas", "vt", "rise", "lift", "drag", "temperature", "eddy", "life", "size", "opacity", "color", "fade", "intensity", "style", "bounce", "friction"];
  const STYLES = ["smoke", "fire", "spark", "streak", "sphere", "dot"];
  function checkKeys(what, name, spec, keys) {
    if (typeof name !== "string" || !/^[a-z][a-zA-Z0-9-]*$/.test(name)) throw new Error(`${what}: name must be a lowercase word, got ${JSON.stringify(name)}`);
    if (!spec || typeof spec !== "object") throw new Error(`${what}("${name}"): the spec must be an object`);
    for (const k of Object.keys(spec)) if (!keys.includes(k)) throw new Error(`${what}("${name}"): unknown key "${k}"; allowed: ${keys.join(", ")}`);
  }
  function defineMaterial(name, spec) {
    checkKeys("E3.define.material", name, spec, MATERIAL_KEYS);
    if (spec.base && !MATERIALS[spec.base]) throw new Error(`E3.define.material("${name}"): unknown base "${spec.base}"; one of ${Object.keys(MATERIALS).join(", ")}`);
    for (const k of ["metal", "roughness", "clearcoat", "anisotropy", "opacity", "sss", "wet", "sheen"]) if (spec[k] != null && typeof spec[k] !== "boolean" && !(spec[k] >= 0 && spec[k] <= 1)) throw new Error(`E3.define.material("${name}"): ${k} must be between 0 and 1`);
    if (spec.ior != null && !(spec.ior >= 1 && spec.ior <= 3)) throw new Error(`E3.define.material("${name}"): ior must be between 1 and 3 (glass 1.5, water 1.333, diamond 2.42)`);
    const { base, ...rest } = spec;
    MATERIALS[name] = { ...(base ? MATERIALS[base] : {}), ...rest };
    if (MATERIALS[name].color == null) MATERIALS[name].color = MATERIALS.porcelain.color;
    return name;
  }
  function defineMatter(name, spec) {
    checkKeys("E3.define.matter", name, spec, MATTER_KEYS);
    const m = { ...(spec.base ? MATTER[spec.base] : {}), ...spec };
    if (spec.base && !MATTER[spec.base]) throw new Error(`E3.define.matter("${name}"): unknown base "${spec.base}"; one of ${Object.keys(MATTER).join(", ")}`);
    delete m.base;
    if (!STYLES.includes(m.style)) throw new Error(`E3.define.matter("${name}"): style must be one of ${STYLES.join(", ")}`);
    const motion = [m.gas ? "gas" : null, m.vt != null ? "vt" : null, m.rise != null ? "rise" : null].filter(Boolean);
    if (motion.length !== 1 && m.drag == null) throw new Error(`E3.define.matter("${name}"): say how it moves: vt (terminal fall speed, m/s), rise (steady rise speed, m/s), or gas: true with temperature [birth, end] K and drag (1/s)`);
    if (m.gas && !(Array.isArray(m.temperature) && m.temperature.length === 2)) throw new Error(`E3.define.matter("${name}"): a gas needs temperature: [birth K, end K]`);
    for (const k of ["life", "size"]) if (!(Array.isArray(m[k]) && m[k].length === 2 && m[k].every(x => x > 0))) throw new Error(`E3.define.matter("${name}"): ${k} must be [min, max], positive (life in s, size in m)`);
    m.bounce ??= 0; m.friction ??= 0.5;
    MATTER[name] = m;
    return name;
  }
  function matterPreset(o) {
    const P = MATTER[o.matter];
    if (!P) throw new Error("E3.particles: unknown matter " + JSON.stringify(o.matter) + "; one of " + Object.keys(MATTER).join(", "));
    const u = typeof o.units === "number" ? o.units : UNITS[o.units ?? "m"] ?? 1, G = 9.81;
    const forces = {}, opts = { style: P.style, life: P.life, size: P.size.map(s => s * u) };
    for (const k of ["temperature", "color", "opacity", "fade", "intensity"]) if (P[k] != null) opts[k] = P[k];
    if (P.vt != null) { forces.gravity = -G * u; forces.drag = G / P.vt; }
    else if (P.rise != null) { forces.gravity = G * u; forces.drag = G / P.rise; }
    else forces.drag = P.drag ?? 0;
    const T = o.temperature ?? P.temperature, T0 = Array.isArray(T) ? T[0] : T;
    if (P.gas && T0) forces.buoyancy = G * u * Math.max(0, (T0 - (o.ambient ?? 293)) / T0);
    if (P.lift) forces.buoyancy = G * u * P.lift;
    // Air's own swirl, except for tracers in a given flow: they show that flow's streamlines exactly.
    if (P.eddy && !(o.flow && o.matter === "air")) forces.turbulence = { strength: P.eddy[0] * u * Math.max(1, forces.drag), scale: P.eddy[1] * u, speed: P.eddy[2] };
    return { opts, forces, bounce: P.bounce ?? 0.2, friction: P.friction ?? 0.5 };
  }
  const PDEF = {
    count: 2000, seed: 1, life: [2, 4], step: 1 / 30, prewarm: true, style: "smoke",
    size: [0.2, 0.8], opacity: 0.6, fade: [0.12, 0.4], trail: 0.12, width: 0, intensity: 1, density: 1,
    temperature: [1900, 900], color: null, colorBy: null, range: [0, 1], soft: null, measure: false, glow: 0, segments: null, volume: null,
  };
  const STYLE_ID = { smoke: 0, fire: 1, spark: 2, streak: 3, sphere: 4, dot: 5 };
  class Particles extends Node {
    constructor(o = {}) {
      super(null, {});
      this.isParticles = true;
      this.pickable = false;
      this.cut = false;
      this.time = null;
      const M = o.matter ? matterPreset(o) : null;
      Object.assign(this, PDEF, M && M.opts, o);
      this.emitter = { shape: "point", ...(o.emitter || {}) };
      this.forces = M ? { ...M.forces, ...(o.forces || {}) } : o.forces || {};
      this.colliders = o.colliders || [];
      // A collider without its own bounce and friction takes the matter's: water splashes a
      // little and runs, dust and snow stay where they land, sparks skip.
      if (M) for (const c of this.colliders) { if (c.bounce == null) c.bounce = M.bounce; if (c.friction == null) c.friction = M.friction; }
      if (o.ground != null) this.colliders.push({ plane: [0, 1, 0, o.ground], bounce: M ? M.bounce : 0.2, friction: M ? M.friction : 0.5 });
      this._state = null;
      this._n = null;
      this.hits = [];
    }
    get lifeRange() { const L = this.life; return typeof L === "number" ? [L, L] : L; }
    get period() { const P = this.lifeRange[1]; return Number.isFinite(P) ? P : 0; }
    // Slot i's generation k and age at time t.
    slot(i, t) {
      const P = this.period;
      if (!P) return [0, t];
      const ph = ((i * 0.6180339887) % 1) * P, k = Math.floor((t - ph) / P);
      return [k, t - (ph + k * P)];
    }
    lifeOf(i, k) { const [a, b] = this.lifeRange; return Number.isFinite(b) ? a + (b - a) * rndU(i, k, 1, this.seed) : Infinity; }
    simTime(t) { return (t ?? 0) + (this.prewarm && this.period ? this.period : 0); }
    // Where slot i is born in generation k: position and velocity in world space.
    emit(i, k, M) {
      const E = this.emitter, s = this.seed, r = c => rndU(i, k, c, s);
      const dir = v3.norm(E.direction || [0, 1, 0]);
      const tmp = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = v3.norm(v3.cross(dir, tmp)), w = v3.cross(dir, u);
      const R = E.radius ?? 0.5, pos0 = E.position || [0, 0, 0];
      const lanes = E.rake | 0, lane = x => (lanes > 0 ? (Math.floor(x * lanes) + 0.5) / lanes : x);
      let p = [0, 0, 0], n = dir, radial = null;
      const shape = E.shape;
      if (shape === "disk" || shape === "cone" || shape === "ring") {
        const a = 2 * Math.PI * r(10), rr = shape === "ring" ? R + (E.thickness ?? 0) * (r(11) - 0.5) : R * Math.sqrt(r(11));
        radial = v3.add(v3.scale(u, Math.cos(a)), v3.scale(w, Math.sin(a)));
        p = v3.scale(radial, rr);
        if (shape === "cone") n = v3.norm(v3.add(dir, v3.scale(radial, Math.tan(E.angle ?? 0.4) * (R > 0 ? rr / R : 1))));
        if (shape === "ring" && E.along === "radial") n = radial;
      } else if (shape === "sphere") {
        const z = 2 * r(10) - 1, a = 2 * Math.PI * r(11), q = Math.sqrt(1 - z * z);
        n = [q * Math.cos(a), z, q * Math.sin(a)];
        p = v3.scale(n, E.surface ? R : R * Math.cbrt(r(12)));
      } else if (shape === "box") {
        const sz = E.size || [1, 1, 1];
        p = [(r(10) - 0.5) * sz[0], (lane(r(11)) - 0.5) * sz[1], (r(12) - 0.5) * sz[2]];
      } else if (shape === "line") {
        const a = E.from || [-0.5, 0, 0], b = E.to || [0.5, 0, 0];
        p = v3.sub(v3.lerp(a, b, lane(r(10))), pos0);
      } else if (shape === "mesh" && this._samples) {
        const S = this._samples, j = Math.min(S.length / 6 - 1, Math.floor(r(10) * S.length / 6));
        p = [S[j * 6], S[j * 6 + 1], S[j * 6 + 2]].map((v, q) => v - pos0[q]);
        n = [S[j * 6 + 3], S[j * 6 + 4], S[j * 6 + 5]];
      }
      p = v3.add(p, pos0);
      let d = E.along === "normal" ? n : shape === "cone" ? n : dir;
      const spread = E.spread ?? 0;
      if (spread > 0) {
        const ct = 1 - r(13) * (1 - Math.cos(spread)), st = Math.sqrt(Math.max(0, 1 - ct * ct)), a = 2 * Math.PI * r(14);
        const du = v3.norm(v3.cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), dw = v3.cross(d, du);
        d = v3.add(v3.scale(d, ct), v3.add(v3.scale(du, st * Math.cos(a)), v3.scale(dw, st * Math.sin(a))));
      }
      const sp = E.speed ?? 1, speed = Array.isArray(sp) ? sp[0] + (sp[1] - sp[0]) * r(15) : sp;
      let vel = v3.scale(d, speed);
      if (E.thermal) {
        const g = c => Math.sqrt(-2 * Math.log(Math.max(1e-7, r(c)))) * Math.cos(2 * Math.PI * r(c + 1));
        vel = v3.add(vel, v3.scale([g(16), g(18), g(20)], E.thermal));
      }
      const pw = m4.apply(M, p);
      const vw = m4.applyDir(M, vel);
      return [pw, vw];
    }
    // Area-weighted surface samples for the mesh emitter (local coordinates), made once.
    prepare() {
      const E = this.emitter;
      if (E.shape !== "mesh" || !E.mesh || this._samples) return;
      const m = E.mesh, P = m.positions, I = m.indices, nT = I.length / 3, area = new Float64Array(nT);
      let total = 0;
      for (let t = 0; t < nT; t++) {
        const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
        const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
        total += v3.len(v3.cross(e1, e2)) / 2;
        area[t] = total;
      }
      const N = 1024, S = new Float32Array(N * 6);
      for (let j = 0; j < N; j++) {
        const x = ((j + rndU(j, 0, 3, this.seed)) / N) * total;
        let lo = 0, hi = nT - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (area[mid] < x) lo = mid + 1; else hi = mid; }
        const a = I[lo * 3] * 3, b = I[lo * 3 + 1] * 3, c = I[lo * 3 + 2] * 3;
        let s = rndU(j, 0, 4, this.seed), t = rndU(j, 0, 5, this.seed);
        if (s + t > 1) { s = 1 - s; t = 1 - t; }
        for (let q = 0; q < 3; q++) S[j * 6 + q] = P[a + q] + (P[b + q] - P[a + q]) * s + (P[c + q] - P[a + q]) * t;
        const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
        const nn = v3.norm(v3.cross(e1, e2));
        S.set(nn, j * 6 + 3);
      }
      this._samples = S;
    }
    // Packed force and collider parameters, shared by the CPU and GPU integrators.
    params() {
      const f = this.forces;
      const g = f.gravity == null ? [0, 0, 0] : typeof f.gravity === "number" ? [0, f.gravity, 0] : f.gravity;
      const tb = f.turbulence == null ? null : typeof f.turbulence === "number" ? { strength: f.turbulence } : f.turbulence;
      const vx = f.vortex || null;
      const planes = [], spheres = [];
      this.colliders.forEach((c, idx) => {
        if (c.plane) { const n = v3.norm(c.plane.slice(0, 3)), L = v3.len(c.plane.slice(0, 3)) || 1; planes.push({ n, d: c.plane[3] / L, e: c.bounce ?? 0.3, fr: c.friction ?? 0, u: c.velocity ?? 0, idx }); }
        else if (c.sphere) spheres.push({ c: c.sphere.slice(0, 3), r: c.sphere[3], inside: c.inside ? -1 : 1, e: c.bounce ?? 0.3, fr: c.friction ?? 0, idx });
      });
      return {
        g, drag: f.drag ?? 0, wind: f.wind || [0, 0, 0],
        turb: tb ? [tb.strength ?? 1, 1 / (tb.scale ?? 1), tb.speed ?? 0.3] : [0, 1, 0],
        vortex: vx ? { c: vx.center || [0, 0, 0], a: v3.norm(vx.axis || [0, 1, 0]), s: vx.strength ?? 1, core: vx.core ?? 0.2, pull: vx.pull ?? 0 } : null,
        attractors: (f.attractors || []).slice(0, 4).map(a => ({ p: a.position, s: a.strength ?? 1, r: a.radius ?? 0.1 })),
        planes: planes.slice(0, 8), spheres: spheres.slice(0, 4),
        flow: this.flow ? flowSpec(this.flow) : null,
        kill: this.kill || null,
        buoyancy: f.buoyancy ?? 0,
      };
    }
    // The CPU integrator: the same steps as the transform-feedback shader. Used when there's
    // no WebGL (tests in Node), for small exact systems (`cpu: true`), and for `measure`.
    cpuStep(state, n, t, h, M, F) {
      const P = this.period;
      const hits = this._hitAcc;
      for (let i = 0; i < n; i++) {
        const o = i * 8;
        const [k, age] = this.slot(i, t);
        const life = this.lifeOf(i, k);
        let px = state[o], py = state[o + 1], pz = state[o + 2], vx = state[o + 4], vy = state[o + 5], vz = state[o + 6];
        let dtl = h;
        if (Math.floor(state[o + 3]) !== k) {
          if (age > h + 1e-9 && P) { state[o + 3] = k + 0.5; continue; } // born before this run began; it dies unseen
          const [pw, vw] = this.emit(i, k, M);
          [px, py, pz] = pw; [vx, vy, vz] = vw;
          state[o + 3] = k;
          dtl = Math.max(0, Math.min(age, h));
        }
        if (state[o + 3] !== k || age > life) continue;
        if (F.flow) {
          const v1 = flowAt(F.flow, [px, py, pz]);
          if (!v1) { state[o + 3] = k + 0.5; continue; }
          const v2 = flowAt(F.flow, [px + v1[0] * dtl * 0.5, py + v1[1] * dtl * 0.5, pz]) || v1;
          vx = v2[0]; vy = v2[1]; vz = v2[2];
          if (F.turb[0]) { const c = curl(px * F.turb[1], py * F.turb[1], pz * F.turb[1] + t * F.turb[2]); vx += c[0] * F.turb[0]; vy += c[1] * F.turb[0]; vz += c[2] * F.turb[0]; }
          px += vx * dtl; py += vy * dtl; pz += vz * dtl;
        } else {
          let ax = F.g[0], ay = F.g[1] + F.buoyancy * Math.max(0, 1 - age / life), az = F.g[2];
          if (F.turb[0]) { const c = curl(px * F.turb[1], py * F.turb[1], pz * F.turb[1] + t * F.turb[2]); ax += c[0] * F.turb[0]; ay += c[1] * F.turb[0]; az += c[2] * F.turb[0]; }
          if (F.vortex) {
            const V = F.vortex, r = [px - V.c[0], py - V.c[1], pz - V.c[2]], ra = v3.dot(r, V.a), rp = v3.sub(r, v3.scale(V.a, ra));
            const tng = v3.cross(V.a, rp), q = 1 / (v3.dot(rp, rp) + V.core * V.core);
            ax += V.s * tng[0] * q - V.pull * rp[0]; ay += V.s * tng[1] * q - V.pull * rp[1]; az += V.s * tng[2] * q - V.pull * rp[2];
          }
          for (const A of F.attractors) {
            const d = [A.p[0] - px, A.p[1] - py, A.p[2] - pz], q = A.s / Math.pow(v3.dot(d, d) + A.r * A.r, 1.5);
            ax += d[0] * q; ay += d[1] * q; az += d[2] * q;
          }
          const k = F.drag;
          if (k > 0) {
            // Drag solved exactly over the step, so stiff drag (dust, bubbles) stays stable: the
            // velocity relaxes at rate k toward the wind plus the other forces over k.
            const e = Math.exp(-k * dtl), f = (1 - e) / k;
            const tx = F.wind[0] + ax / k, ty = F.wind[1] + ay / k, tz = F.wind[2] + az / k;
            px += tx * dtl + (vx - tx) * f; py += ty * dtl + (vy - ty) * f; pz += tz * dtl + (vz - tz) * f;
            vx = tx + (vx - tx) * e; vy = ty + (vy - ty) * e; vz = tz + (vz - tz) * e;
          } else {
            vx += ax * dtl; vy += ay * dtl; vz += az * dtl;
            px += vx * dtl; py += vy * dtl; pz += vz * dtl;
          }
        }
        for (const C of F.planes) {
          const s = C.n[0] * px + C.n[1] * py + C.n[2] * pz - C.d;
          if (s >= 0) continue;
          px -= C.n[0] * s; py -= C.n[1] * s; pz -= C.n[2] * s;
          const vn = C.n[0] * vx + C.n[1] * vy + C.n[2] * vz - C.u;
          if (vn < 0) {
            const j = -(1 + C.e) * vn;
            vx += C.n[0] * j; vy += C.n[1] * j; vz += C.n[2] * j;
            if (C.fr) { const vn2 = C.n[0] * vx + C.n[1] * vy + C.n[2] * vz; vx -= (vx - C.n[0] * vn2) * C.fr; vy -= (vy - C.n[1] * vn2) * C.fr; vz -= (vz - C.n[2] * vn2) * C.fr; }
            if (hits) hits[C.idx] += j;
          }
        }
        for (const C of F.spheres) {
          const d = [px - C.c[0], py - C.c[1], pz - C.c[2]], L = v3.len(d) || 1e-9, s = (L - C.r) * C.inside;
          if (s >= 0) continue;
          const nn = v3.scale(d, C.inside / L);
          px -= nn[0] * s; py -= nn[1] * s; pz -= nn[2] * s;
          const vn = v3.dot(nn, [vx, vy, vz]);
          if (vn < 0) { const j = -(1 + C.e) * vn; vx += nn[0] * j; vy += nn[1] * j; vz += nn[2] * j; if (hits) hits[C.idx] += j; }
        }
        if (F.kill && (px < F.kill.min[0] || py < F.kill.min[1] || pz < F.kill.min[2] || px > F.kill.max[0] || py > F.kill.max[1] || pz > F.kill.max[2])) state[o + 3] = k + 0.5;
        state[o] = px; state[o + 1] = py; state[o + 2] = pz; state[o + 4] = vx; state[o + 5] = vy; state[o + 6] = vz;
      }
    }
    // Brings the state to time t (seconds). Returns true if anything was simulated.
    // stepFn(tEnd) runs one step on whatever integrator holds the state; reset() starts over.
    advanceWith(t, n, reset, stepFn) {
      // At least one step, so a system at time 0 (a paused figure, reduced motion) has been born.
      const h = this.step, te = this.simTime(t), target = Math.max(1, Math.floor(te / h + 1e-6)), P = this.period;
      const need = P ? Math.ceil(P / h) + 2 : 4000;
      // The picture at time t depends on the forces, colliders, and emitter too: when one changes
      // (a wind slider moved while paused), simulate again from the start.
      let sig = "";
      try { sig = JSON.stringify([this.forces, this.colliders, this.emitter, this.density]); } catch { sig = this._sig; }
      if (sig !== this._sig) { this._sig = sig; this._n = null; }
      if (this._n == null || target < this._n || target - this._n > need || this._count !== n) {
        this._n = P ? target - need : Math.max(0, target - need);
        this._count = n;
        reset();
      }
      while (this._n < target) { this._n++; stepFn(this._n * h); }
      this._t = this._n * h;
      return true;
    }
    // CPU simulation to time t; returns the state (8 floats per particle: x, y, z, generation, vx, vy, vz, 0).
    simulate(t = this.time ?? 0, n = this.count) {
      this.prepare();
      const M = this.world(), F = this.params(), h = this.step;
      if (!this._state || this._state.length !== this.count * 8) this._state = new Float32Array(this.count * 8);
      const S = this._state;
      const window_ = this.measureWindow ?? 0.5;
      this.advanceWith(t, n, () => { for (let i = 0; i < this.count; i++) S[i * 8 + 3] = -1e6; this._hitLog = []; }, tEnd => {
        this._hitAcc = this.measure ? new Float64Array(this.colliders.length) : null;
        this.cpuStep(S, n, tEnd, h, M, F);
        if (this._hitAcc) { this._hitLog.push(this._hitAcc); if (this._hitLog.length > Math.max(1, Math.round(window_ / h))) this._hitLog.shift(); }
      });
      if (this.measure && this._hitLog) {
        // Momentum delivered to each collider per second, averaged over the last `measureWindow` seconds.
        const L = this._hitLog, out = new Array(this.colliders.length).fill(0);
        for (const a of L) a.forEach((v, j) => (out[j] += v));
        this.hits = out.map(v => v / Math.max(1, L.length) / h);
      }
      return S;
    }
    // Live particles at the current state: [{ position, velocity, age, life }].
    alive() {
      const S = this._state, out = [];
      if (!S) return out;
      const tt = this._t ?? 0;
      for (let i = 0; i < this._count; i++) {
        const [k, age] = this.slot(i, tt), life = this.lifeOf(i, k);
        if (S[i * 8 + 3] !== k || age > life) continue;
        out.push({ position: [S[i * 8], S[i * 8 + 1], S[i * 8 + 2]], velocity: [S[i * 8 + 4], S[i * 8 + 5], S[i * 8 + 6]], age, life });
      }
      return out;
    }
  }

  // ---------- plume ----------
  // A rocket exhaust drawn as a ray-marched volume: hot core, Mach diamonds, turbulent
  // mixing layer, all emitting by temperature. Its local frame has the nozzle exit at the
  // origin and the flow running down -y. It also lights the scene around it.
  const FUELS = { kerosene: 0, rp1: 0, methane: 1, hydrogen: 2, solid: 3 };
  class Plume extends Node {
    constructor(o = {}) {
      super(null, {});
      this.isPlume = true;
      this.pickable = false;
      this.cut = false;
      this.time = null;
      Object.assign(this, { radius: 1, length: 8, throttle: 1, temperature: 2500, fuel: "kerosene", cells: 1.5, spread: 0.05, turbulence: 1, intensity: 1, light: 1, speed: 1, expansion: 0.8, impact: null, splash: 1, ground: 0, profile: null }, o);
      if (this.profile && o.cut == null) this.cut = true;
    }
    get lengthNow() { return this.profile ? this.profile[this.profile.length - 1][1] : this.length * (0.45 + 0.55 * clamp01(this.throttle)); }
    // Distance along the jet (local units) to the surface it hits: a number, or with
    // impact: true the plane y = ground in world space; 0 when it hits nothing.
    impactNow() {
      if (this.profile || !this.impact) return 0;
      if (typeof this.impact === "number") return this.impact;
      const W = this.world(), o = m4.apply(W, [0, 0, 0]), d = m4.applyDir(W, [0, -1, 0]), ws = Math.hypot(W[0], W[1], W[2]) || 1;
      const dn = v3.norm(d);
      if (dn[1] > -0.05) return 0;
      const dist = (o[1] - this.ground) / -dn[1] / ws;
      return dist > 0 && dist < this.lengthNow * 1.6 ? dist : 0;
    }
    get splashRadius() { return this.radius * 4.5 * this.splash * (0.6 + 0.4 * clamp01(this.throttle)); }
    // Exit pressure over ambient at the current throttle: a throttled engine runs over-expanded.
    get expansionNow() { return this.expansion * (0.35 + 0.65 * clamp01(this.throttle)); }
    // Point lights in world space that stand in for the plume's glow on nearby surfaces:
    // a strong one just below the exit (it lights the nozzle and the stand) and a softer
    // one down the plume for the ground and the smoke.
    glowLights() {
      if (!this.light || this.throttle <= 0 || this.profile) return [];
      const thr = clamp01(this.throttle), T = this.temperature * (0.7 + 0.3 * thr);
      const sc = this.world(), s = Math.hypot(sc[0], sc[1], sc[2]);
      const L = this.lengthNow, k = this.light * thr, imp = this.impactNow();
      const col = blackbody(T * 0.75);
      // With an impact, the second light sits in the splash and lights the pad and the cloud from below.
      return [
        { position: this.toWorld([0, -L * 0.12, 0]), color: col.map(v => v * k * 5), range: L * s * 0.6 },
        imp ? { position: this.toWorld([0, -imp * 0.96, 0]), color: blackbody(1900).map(v => v * k * 4), range: this.splashRadius * s * 1.6 }
            : { position: this.toWorld([0, -L * 0.6, 0]), color: col.map(v => v * k * 2.5), range: L * s * 1.1 },
      ];
    }
    glowLight() { return this.glowLights()[0] || null; }
  }

  // ---------- shaders ----------
  const G_COMMON = `
precision highp float;
precision highp int;
const float PI = 3.141592653589793;
vec3 toLin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }
// Khronos PBR Neutral: base colors stay true up to about 0.8, highlights roll off to white.
vec3 tonemap(vec3 c) {
  float x = min(c.r, min(c.g, c.b));
  float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c -= off;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < 0.76) return c;
  float np = 1.0 - 0.0576 / (peak - 0.52);
  c *= np / peak;
  float g = 1.0 - 1.0 / (0.15 * (peak - np) + 1.0);
  return mix(c, vec3(np), g);
}
vec3 blackbody(float T) {
  float t = clamp(T, 500.0, 40000.0) / 100.0;
  float r = t <= 66.0 ? 255.0 : 329.698727446 * pow(t - 60.0, -0.1332047592);
  float g = t <= 66.0 ? 99.4708025861 * log(t) - 161.1195681661 : 288.1221695283 * pow(t - 60.0, -0.0755148492);
  float b = t >= 66.0 ? 255.0 : (t <= 19.0 ? 0.0 : 138.5177312231 * log(t - 10.0) - 305.0447927307);
  return toLin(clamp(vec3(r, g, b) / 255.0, 0.0, 1.0));
}
float glowOf(float T) { float k = max(T - 720.0, 0.0) / 700.0; return k * k * k * 2.5; }
uint hashu(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float hash3(ivec3 p, uint s) { return float(hashu(uint(p.x) * 73856093u ^ uint(p.y) * 19349663u ^ uint(p.z) * 83492791u ^ s) >> 8) / 8388608.0 - 1.0; }
vec4 noised(vec3 x, uint s) {
  vec3 i = floor(x), f = x - i;
  ivec3 p = ivec3(i);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0), du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash3(p, s), b = hash3(p + ivec3(1, 0, 0), s), c = hash3(p + ivec3(0, 1, 0), s), d = hash3(p + ivec3(1, 1, 0), s);
  float e = hash3(p + ivec3(0, 0, 1), s), g = hash3(p + ivec3(1, 0, 1), s), h = hash3(p + ivec3(0, 1, 1), s), k = hash3(p + ivec3(1, 1, 1), s);
  float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + h, k6 = a - b - e + g, k7 = -a + b + c - d + e - g - h + k;
  return vec4(a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z,
    du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y));
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = x - i;
  ivec3 p = ivec3(i);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(p, 7u), hash3(p + ivec3(1, 0, 0), 7u), u.x), mix(hash3(p + ivec3(0, 1, 0), 7u), hash3(p + ivec3(1, 1, 0), 7u), u.x), u.y),
             mix(mix(hash3(p + ivec3(0, 0, 1), 7u), hash3(p + ivec3(1, 0, 1), 7u), u.x), mix(hash3(p + ivec3(0, 1, 1), 7u), hash3(p + ivec3(1, 1, 1), 7u), u.x), u.y), u.z);
}
float vnoise1(float x) { float i = floor(x), f = x - i; return mix(hash3(ivec3(int(i), 0, 0), 3u), hash3(ivec3(int(i) + 1, 0, 0), 3u), f * f * (3.0 - 2.0 * f)); }
vec3 curl(vec3 p) {
  vec4 a = noised(p, 0u), b = noised(p + vec3(31.4, 17.2, 5.9), 0u), c = noised(p + vec3(-11.3, 47.1, 23.7), 0u);
  return vec3(c.z - b.w, a.w - c.y, b.y - a.z);
}
// Linear view distance from a depth-buffer value.
uniform vec2 uNearFar; uniform float uOrtho;
float linDepth(float d) {
  if (uOrtho > 0.5) return uNearFar.x + d * (uNearFar.y - uNearFar.x);
  float z = d * 2.0 - 1.0;
  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
}`;

  // Studio environment lookups: a prefiltered radiance map (mip level = roughness) and an
  // irradiance map, both lat-long, turned with the camera so the soft boxes stay put.
  const G_ENV = `
uniform sampler2D uEnvSpec; uniform sampler2D uEnvIrr; uniform mat3 uEnvRot; uniform vec2 uEnvInfo;
vec2 envUv(vec3 d) { d = uEnvRot * d; return vec2(atan(d.x, -d.z) * (0.5 / PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI); }
vec3 envSpec(vec3 r, float rough) { return textureLod(uEnvSpec, envUv(r), rough * uEnvInfo.y).rgb * uEnvInfo.x; }
vec3 envDiff(vec3 n) { return textureLod(uEnvIrr, envUv(n), 0.0).rgb * uEnvInfo.x; }`;

  // Soft shadows from the key light: a blocker search sets the penumbra (contact-hardening),
  // then 16 rotated Poisson taps of hardware 2x2 PCF. Glass casts a lighter shadow of its own.
  const G_SHADOW = `
uniform highp sampler2DShadow uShadowCmp; uniform highp sampler2D uShadowRaw; uniform highp sampler2DShadow uShadowGlass;
uniform mat4 uShadowVP; uniform vec4 uShadowA; uniform vec4 uShadowB;
const vec2 DISK[16] = vec2[16](
  vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.094184101, -0.92938870), vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
  vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790));
float shadowAt(vec3 wp, vec3 n) {
  if (uShadowA.x < 0.5) return 1.0;
  vec4 sp = uShadowVP * vec4(wp + n * uShadowA.z, 1.0);
  vec3 p = sp.xyz / sp.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.y <= 0.0 || p.x >= 1.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float ang = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float ca = cos(ang), sa = sin(ang);
  mat2 rot = mat2(ca, sa, -sa, ca);
  float z = p.z - uShadowA.y;
  float blk = 0.0, cnt = 0.0;
  float d0 = texture(uShadowRaw, p.xy).r;
  if (d0 < z) { blk += d0; cnt += 1.0; }
  for (int i = 0; i < 16; i += 2) {
    float d = texture(uShadowRaw, p.xy + rot * DISK[i] * uShadowB.y).r;
    if (d < z) { blk += d; cnt += 1.0; }
  }
  float vis = 1.0;
  if (cnt > 0.0) {
    float r = clamp((z - blk / cnt) * uShadowB.z, uShadowB.x, uShadowB.y);
    float s = 0.0;
    for (int i = 0; i < 16; i++) s += texture(uShadowCmp, vec3(p.xy + rot * DISK[i] * r, z));
    vis = s / 16.0;
  }
  if (uShadowA.w > 0.0) {
    float g = 0.0;
    for (int i = 0; i < 8; i++) g += texture(uShadowGlass, vec3(p.xy + rot * DISK[i * 2 + 1] * uShadowB.x * 3.0, z));
    vis *= 1.0 - uShadowA.w * (1.0 - g / 8.0);
  }
  return vis;
}`;

  // Ray tracing against the scene's triangles: a bounding volume hierarchy in float textures
  // (two texels per node: min + first child or first triangle, max + triangle count; three per
  // triangle: a vertex + material, two edges + cut flag), walked with a small stack. Used for
  // the shadows of area lights, light bounced between surfaces, sky occlusion, and light shafts.
  const G_TRACE = `
uniform highp sampler2D uBvhN; uniform highp sampler2D uBvhT; uniform highp sampler2D uBvhM;
uniform ivec4 uBvh; uniform vec4 uBvhCut;
vec4 bvhN(int i) { return texelFetch(uBvhN, ivec2(i & 1023, i >> 10), 0); }
vec4 bvhT(int i) { return texelFetch(uBvhT, ivec2(i & 1023, i >> 10), 0); }
vec4 bvhM(int i) { return texelFetch(uBvhM, ivec2(i & 1023, i >> 10), 0); }
float boxHit(vec3 o, vec3 inv, vec3 lo, vec3 hi, float tmax) {
  vec3 a = (lo - o) * inv, b = (hi - o) * inv;
  vec3 mn = min(a, b), mx = max(a, b);
  float t0 = max(max(mn.x, mn.y), max(mn.z, 0.0)), t1 = min(min(mx.x, mx.y), min(mx.z, tmax));
  return t0 <= t1 ? t0 : 1e30;
}
// The nearest triangle along o + t d with 0 < t < tmax (any: the first one found). Returns t,
// or 1e30 for a miss; id is the triangle. Triangles of parts the section cut removed are skipped.
float trace(vec3 o, vec3 d, float tmax, bool any, out int id) {
  id = -1;
  if (uBvh.x == 0) return 1e30;
  vec3 dd = vec3(abs(d.x) < 1e-9 ? 1e-9 : d.x, abs(d.y) < 1e-9 ? 1e-9 : d.y, abs(d.z) < 1e-9 ? 1e-9 : d.z);
  vec3 inv = 1.0 / dd;
  float best = tmax;
  if (boxHit(o, inv, bvhN(0).xyz, bvhN(1).xyz, best) > 1e29) return 1e30;
  int stack[32];
  int sp = 0, ni = 0;
  for (int guard = 0; guard < 2048; guard++) {
    vec4 A = bvhN(2 * ni), B = bvhN(2 * ni + 1);
    int cnt = int(B.w);
    if (cnt > 0) {
      int first = int(A.w);
      for (int k = 0; k < 16; k++) {
        if (k >= cnt) break;
        int j = first + k;
        vec4 p0 = bvhT(3 * j), e1 = bvhT(3 * j + 1), e2 = bvhT(3 * j + 2);
        vec3 pv = cross(d, e2.xyz);
        float det = dot(e1.xyz, pv);
        if (abs(det) < 1e-14) continue;
        float id_ = 1.0 / det;
        vec3 tv = o - p0.xyz;
        float u = dot(tv, pv) * id_;
        if (u < 0.0 || u > 1.0) continue;
        vec3 qv = cross(tv, e1.xyz);
        float v = dot(d, qv) * id_;
        if (v < 0.0 || u + v > 1.0) continue;
        float t = dot(e2.xyz, qv) * id_;
        if (t <= 0.0 || t >= best) continue;
        if (e1.w > 0.5 && uBvh.w == 1 && dot(o + d * t, uBvhCut.xyz) > uBvhCut.w) continue;
        best = t; id = j;
        if (any) return t;
      }
    } else {
      int l = int(A.w), r = l + 1;
      float tl = boxHit(o, inv, bvhN(2 * l).xyz, bvhN(2 * l + 1).xyz, best);
      float tr = boxHit(o, inv, bvhN(2 * r).xyz, bvhN(2 * r + 1).xyz, best);
      if (tl < 1e29 && tr < 1e29) { ni = tl <= tr ? l : r; if (sp < 32) stack[sp++] = tl <= tr ? r : l; continue; }
      if (tl < 1e29) { ni = l; continue; }
      if (tr < 1e29) { ni = r; continue; }
    }
    if (sp == 0) break;
    ni = stack[--sp];
  }
  return id >= 0 ? best : 1e30;
}
bool blocked(vec3 o, vec3 d, float tmax) { int id; return trace(o, d, tmax, true, id) < 1e29; }
vec3 triNormal(int j) { return normalize(cross(bvhT(3 * j + 1).xyz, bvhT(3 * j + 2).xyz)); }
vec3 triAlbedo(int j) { return bvhM(int(bvhT(3 * j).w)).rgb; }`;

  // Physical lights: points, spheres, disks, and rectangles with a power in watts, sampled over
  // their area (soft shadows that harden as a light shrinks, exact inverse-square and cosine
  // falloff), a sky that surrounds the scene, and diffuse light bounced between surfaces.
  // uLA: position, type (0 point, 1 sphere, 2 disk, 3 rect); uLB: radiance (W/m²/sr; W/sr for a
  // point), radius; uLC, uLD: the half axes of a disk or rect (their cross product is the side
  // that emits), uLC.w two-sided. uRoom: light count, samples, bounces, frame. uSkyU: sky radiance,
  // kind (1 uniform, 2 the physical sky). uUnits: world units per meter.
  const G_LIGHTS = `
uniform vec4 uRoom; uniform vec4 uLA[8]; uniform vec4 uLB[8]; uniform vec4 uLC[8]; uniform vec4 uLD[8];
uniform vec4 uSkyU; uniform float uUnits; uniform float uTraceEps;
uint rngS;
float rnd() { rngS = rngS * 747796405u + 2891336453u; uint w = ((rngS >> ((rngS >> 28u) + 4u)) ^ rngS) * 277803737u; return float((w >> 22u) ^ w) / 4294967296.0; }
void rngInit(vec2 px, float frame) { rngS = hashu(uint(px.x) * 1973u + uint(px.y) * 9277u + uint(frame) * 26699u) | 1u; }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
// Low-discrepancy pairs, rotated per pixel, so a few samples already cover a light evenly.
vec2 lds(float n, vec2 px) { return fract(vec2(0.7548776662, 0.5698402910) * n + vec2(ign(px), ign(px + vec2(37.0, 17.0)))); }
// One sample of light i seen from x: unit direction l, distance, and the light arriving along it
// times its solid angle (irradiance per unit cosine, W/m²).
vec3 sampleLight(int i, vec3 x, vec2 r, out vec3 l, out float dist) {
  vec3 c = uLA[i].xyz;
  int type = int(uLA[i].w + 0.5);
  if (type == 0) {
    vec3 d = c - x; float r2 = max(dot(d, d), 1e-12);
    dist = sqrt(r2); l = d / dist;
    return uLB[i].rgb * uUnits * uUnits / r2;
  }
  if (type == 1) {
    float R = uLB[i].w; vec3 d = c - x; float d2 = dot(d, d), dl = sqrt(d2);
    l = d / max(dl, 1e-9); dist = 0.0;
    if (dl <= R * 1.0001) return vec3(0.0);
    float cmax = sqrt(max(0.0, 1.0 - R * R / d2));
    float ct = 1.0 - r.x * (1.0 - cmax), st = sqrt(max(0.0, 1.0 - ct * ct)), ph = 6.2831853 * r.y;
    vec3 t1 = normalize(cross(abs(l.x) > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), l)), t2 = cross(l, t1);
    l = normalize(t1 * (cos(ph) * st) + t2 * (sin(ph) * st) + l * ct);
    float b = dot(l, d); dist = b - sqrt(max(0.0, b * b - d2 + R * R));
    return uLB[i].rgb * (6.2831853 * (1.0 - cmax));
  }
  vec3 U = uLC[i].xyz, V = uLD[i].xyz, p;
  float area;
  if (type == 2) {
    vec2 q = 2.0 * r - 1.0, s;
    if (q.x == 0.0 && q.y == 0.0) s = vec2(0.0);
    else if (abs(q.x) > abs(q.y)) s = q.x * vec2(cos(0.7853982 * q.y / q.x), sin(0.7853982 * q.y / q.x));
    else s = q.y * vec2(cos(1.5707963 - 0.7853982 * q.x / q.y), sin(1.5707963 - 0.7853982 * q.x / q.y));
    p = c + U * s.x + V * s.y; area = PI * length(U) * length(V);
  } else { p = c + U * (2.0 * r.x - 1.0) + V * (2.0 * r.y - 1.0); area = 4.0 * length(U) * length(V); }
  vec3 n = normalize(cross(U, V));
  vec3 d = p - x; float d2 = max(dot(d, d), 1e-12);
  dist = sqrt(d2); l = d / dist;
  float cl = -dot(l, n);
  if (uLC[i].w > 0.5) cl = abs(cl);
  if (cl <= 0.0) return vec3(0.0);
  return uLB[i].rgb * cl * area / d2;
}
// What the sky sends along d: a uniform dome, or the physical sky.
vec3 skyRad(vec3 d);
vec3 cosDir(vec3 n, vec2 r) {
  float ph = 6.2831853 * r.x, s = sqrt(r.y);
  vec3 t1 = normalize(cross(abs(n.x) > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), n)), t2 = cross(n, t1);
  return normalize(t1 * (cos(ph) * s) + t2 * (sin(ph) * s) + n * sqrt(max(0.0, 1.0 - r.y)));
}
// Direct light from every light at x, with a shadow ray each: the irradiance a diffuse surface
// with normal n receives (W/m²). Used where the eye path bounces.
vec3 directAt(vec3 x, vec3 n, vec2 r) {
  vec3 e = vec3(0.0);
  int nl = int(uRoom.x + 0.5);
  for (int i = 0; i < 8; i++) {
    if (i >= nl) break;
    vec3 l; float dist;
    vec3 Lc = sampleLight(i, x, fract(r + float(i) * vec2(0.37, 0.61)), l, dist);
    float c = dot(n, l);
    if (c <= 0.0 || dot(Lc, Lc) <= 0.0) continue;
    if (blocked(x + n * uTraceEps, l, max(dist - 2.0 * uTraceEps, 0.0))) continue;
    e += Lc * c;
  }
  return e;
}
// Light scattered toward wo (unit, from x toward the eye) at a point in the air, per unit of
// scattering: each light's irradiance times the Henyey-Greenstein phase function with asymmetry g
// (dust and haze scatter forward, so a beam glows brightest when you look toward its light).
float hgPhase(float mu, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5)); }
vec3 scatterAt(vec3 x, vec3 wo, float g, vec2 r) {
  vec3 e = vec3(0.0);
  int nl = int(uRoom.x + 0.5);
  for (int i = 0; i < 8; i++) {
    if (i >= nl) break;
    vec3 l; float dist;
    vec3 Lc = sampleLight(i, x, fract(r + float(i) * vec2(0.37, 0.61)), l, dist);
    if (dot(Lc, Lc) <= 0.0) continue;
    if (blocked(x, l, max(dist - 2.0 * uTraceEps, 0.0))) continue;
    e += Lc * hgPhase(dot(-l, wo), g);
  }
  return e;
}`;

  // The sky: single scattering in a real atmosphere (Rayleigh for the blue, Mie for the haze
  // around the Sun, ozone for the deep blue of twilight), marched along the view ray with the
  // sunlight reaching each point attenuated on its way in; stars come out after sunset.
  const G_SKY = `
uniform vec3 uSunDir; uniform vec4 uSkyP; // sun intensity, haze (Mie multiplier), observer altitude (m), stars
const float RE_ = 6360e3, RA_ = 6460e3;
const vec3 BR_ = vec3(5.802e-6, 13.558e-6, 33.1e-6), BO_ = vec3(0.65e-6, 1.881e-6, 0.085e-6);
vec2 sphHit(vec3 o, vec3 d, float R) {
  float b = dot(o, d), c = dot(o, o) - R * R, h = b * b - c;
  if (h < 0.0) return vec2(1e30, -1e30);
  h = sqrt(h); return vec2(-b - h, -b + h);
}
vec3 extinctionAt(float h) {
  float r = exp(-h / 8000.0), m = exp(-h / 1200.0), oz = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0);
  return BR_ * r + vec3(4.4e-6 * uSkyP.y) * m + BO_ * oz;
}
vec3 atmosphere(vec3 d, vec3 sun) {
  vec3 o = vec3(0.0, RE_ + max(uSkyP.z, 1.0), 0.0);
  vec2 ta = sphHit(o, d, RA_), tg = sphHit(o, d, RE_);
  float tmax = ta.y;
  bool ground = tg.x > 0.0 && tg.x < 1e29;
  if (ground) tmax = tg.x;
  const int N = 16;
  float ds = tmax / float(N);
  vec3 odR = vec3(0.0), sumR = vec3(0.0), sumM = vec3(0.0);
  vec3 od = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = o + d * (ds * (float(i) + 0.5));
    float h = length(p) - RE_;
    float dr = exp(-h / 8000.0) * ds, dm = exp(-h / 1200.0) * ds;
    od += extinctionAt(h) * ds;
    vec2 ls = sphHit(p, sun, RA_), lg = sphHit(p, sun, RE_);
    if (lg.x > 0.0 && lg.x < 1e29) continue;
    float dl = ls.y / 8.0;
    vec3 odl = vec3(0.0);
    for (int j = 0; j < 8; j++) { float hl = length(p + sun * (dl * (float(j) + 0.5))) - RE_; odl += extinctionAt(hl) * dl; }
    vec3 att = exp(-(od + odl));
    sumR += att * dr; sumM += att * dm;
  }
  float mu = dot(d, sun), g = 0.76;
  float pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float pM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
  vec3 col = (sumR * BR_ * pR + sumM * 3.996e-6 * uSkyP.y * pM) * uSkyP.x;
  vec3 trans = exp(-od);
  if (!ground) col += trans * smoothstep(0.99996, 0.99999, mu) * uSkyP.x * 4.0;
  else col += trans * vec3(0.06, 0.055, 0.05) * max(sun.y, 0.0) * uSkyP.x * 0.12;
  if (uSkyP.w > 0.0 && !ground) {
    vec3 q = d * 420.0; vec3 c = floor(q);
    float h = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float star = step(0.9965, h) * smoothstep(0.42, 0.0, length(q - c - 0.5)) * (0.4 + 0.6 * fract(h * 97.0));
    col += vec3(star) * uSkyP.w * trans * smoothstep(-0.02, -0.12, sun.y);
  }
  return col;
}`;

  const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 aBend;  // grass: root (x, y, z), height fraction along the blade
layout(location=3) in vec2 aBlade; // grass: random number, blade length
uniform mat4 uModel, uViewProj;
uniform mat3 uNormalMat;
uniform vec4 uWind;  // grass: wind direction (x, z), bend at the steady wind, time
uniform vec4 uWind2; // grass: gust wavenumber, gust speed, flutter, on
uniform vec4 uPush;  // grass: a point (local) that pushes blades aside, radius
out vec3 vWorld; out vec3 vNormal; out vec3 vLocal; out vec3 vLocalN; out vec4 vBlade;
void main() {
  vec3 p = aPos, nrm = aNormal;
  vBlade = vec4(0.0);
  if (uWind2.w > 0.5) {
    // A blade bends as a cantilever: the tip moves most, the base not at all (deflection grows
    // with the square of the height), and the blade keeps its length, so its tip drops as it leans.
    float h = aBend.w, L = aBlade.y;
    vec3 root = aBend.xyz;
    vec2 dir = uWind.xy;
    float ph = dot(root.xz, dir) * uWind2.x - uWind.w * uWind2.y;
    float gust = 0.55 + 0.3 * sin(ph + aBlade.x * 0.7) + 0.15 * sin(ph * 2.3 + 1.7 + aBlade.x * 2.0);
    float flutter = sin(uWind.w * (5.0 + 4.0 * aBlade.x) + aBlade.x * 40.0) * uWind2.z;
    vec2 off = dir * (uWind.z * gust + flutter * uWind.z);
    if (uPush.w > 0.0) {
      vec2 q = root.xz - uPush.xz;
      float dq = length(q), k = 1.0 - smoothstep(uPush.w * 0.5, uPush.w * 1.2, dq);
      off += (dq > 1e-5 ? q / dq : vec2(1.0, 0.0)) * 1.4 * k * smoothstep(uPush.y - L, uPush.y, root.y + L);
    }
    float m = min(length(off), 1.45);
    off = m > 0.0 ? normalize(off) * m : off;
    vec3 rel = p - root;
    float along = clamp(dot(rel, vec3(0.0, 1.0, 0.0)), 0.0, L * 2.0);
    vec2 side = rel.xz;
    float ang = m * h * h * 1.1;
    vec2 od = m > 0.0 ? off / m : vec2(0.0);
    vec3 leaned = vec3(side.x, 0.0, side.y) + vec3(od.x, 0.0, od.y) * sin(ang) * along + vec3(0.0, cos(ang) * along, 0.0);
    p = root + leaned;
    nrm = normalize(nrm + vec3(od.x, 0.0, od.y) * sin(ang) * 0.6);
    vBlade = vec4(aBlade.x, h, 1.0, 0.0);
  }
  vec4 w = uModel * vec4(p, 1.0);
  vWorld = w.xyz;
  vNormal = uNormalMat * nrm;
  vLocal = p;
  vLocalN = nrm;
  gl_Position = uViewProj * w;
}`;

  // Depth only, for the shadow maps; it honors the section cut so cut-away parts cast nothing.
  const FS_DEPTH = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec4 uCut; uniform float uCutOn;
out vec4 o;
void main() {
  if (uCutOn > 0.5 && dot(vWorld, uCut.xyz) > uCut.w) discard;
  o = vec4(1.0);
}`;

  // Surface shading. Model 0 is the original porcelain look (wrap light, cool shade side,
  // a faint sheen), now with cast shadows; model 1 is physically based (GGX, Fresnel,
  // metalness, roughness, anisotropy for brushed metal, clear coat, temper colors and
  // black-body glow), lit by key, fill and rim lights, point lights, and the environment.
  // PBR color is tone mapped here, so diagram materials stay exactly as they were; glow
  // above 1.0 is what the bloom pass picks up.
  const G_SURFACE = `
uniform mat4 uModel;
uniform vec3 uColor; uniform vec3 uLight; uniform vec3 uEye;
vec3 gBase; float gRough; // the part's color and roughness here (uColor and uMat.z, varied by a texture map or per grass blade)
uniform float uSun;
uniform vec4 uMat; uniform vec3 uF0; uniform vec4 uBrush; uniform vec4 uDetail; uniform vec3 uEmit;
uniform vec4 uTissue; uniform vec3 uSssCol; // tissue: scattering, sheen, fibers on, _; scattered light color
uniform vec4 uTempAxis; uniform vec4 uTempS; uniform vec4 uTempT; uniform vec4 uHeat;
uniform vec3 uKeyCol; uniform vec3 uFillDir; uniform vec3 uFillCol; uniform vec3 uRimDir; uniform vec3 uRimCol;
uniform vec4 uPtPos[2]; uniform vec3 uPtCol[2];
uniform vec4 uLook;
float D_GGX(float NoH, float a) { float a2 = a * a; float f = (NoH * a2 - NoH) * NoH + 1.0; return a2 / (PI * f * f + 1e-7); }
float V_GGX(float NoV, float NoL, float a) { float a2 = a * a; float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2); float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2); return 0.5 / (gv + gl + 1e-7); }
float D_Aniso(float at, float ab, float XoH, float YoH, float NoH) { float a2 = at * ab; vec3 d = vec3(ab * XoH, at * YoH, a2 * NoH); float d2 = dot(d, d); float b2 = a2 / d2; return a2 * b2 * b2 / PI; }
float V_Aniso(float at, float ab, float XoV, float YoV, float XoL, float YoL, float NoV, float NoL) {
  float lv = NoL * length(vec3(at * XoV, ab * YoV, NoV)); float ll = NoV * length(vec3(at * XoL, ab * YoL, NoL)); return 0.5 / (lv + ll + 1e-7);
}
vec2 envBRDF(float NoV, float r) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022); const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 rr = r * c0 + c1; float a004 = min(rr.x * rr.x, exp2(-9.28 * NoV)) * rr.x + rr.y;
  return vec2(-1.04, 1.04) * a004 + rr.zw;
}
vec4 heatTint(float T) {
  float c = T - 273.15;
  vec3 col = mix(vec3(0.93, 0.86, 0.62), vec3(0.85, 0.66, 0.32), smoothstep(190.0, 240.0, c));
  col = mix(col, vec3(0.62, 0.38, 0.2), smoothstep(240.0, 260.0, c));
  col = mix(col, vec3(0.45, 0.22, 0.42), smoothstep(260.0, 278.0, c));
  col = mix(col, vec3(0.15, 0.2, 0.55), smoothstep(278.0, 295.0, c));
  col = mix(col, vec3(0.3, 0.5, 0.78), smoothstep(295.0, 320.0, c));
  col = mix(col, vec3(0.52, 0.55, 0.58), smoothstep(320.0, 380.0, c));
  col = mix(col, vec3(0.36, 0.35, 0.34), smoothstep(380.0, 600.0, c));
  return vec4(col, smoothstep(180.0, 230.0, c));
}
float temperatureAt(vec3 lp) {
  int n = int(uTempAxis.w + 0.5);
  float s = dot(lp, uTempAxis.xyz), T = uTempT.x;
  if (n > 1) T = mix(uTempT.x, uTempT.y, smoothstep(uTempS.x, uTempS.y, s));
  if (n > 2 && s > uTempS.y) T = mix(uTempT.y, uTempT.z, smoothstep(uTempS.y, uTempS.z, s));
  if (n > 3 && s > uTempS.z) T = mix(uTempT.z, uTempT.w, smoothstep(uTempS.z, uTempS.w, s));
  return T;
}
vec3 lightPBR(vec3 N, vec3 V, vec3 L, vec3 Lc, vec3 diff, vec3 f0, float a, vec3 X, vec3 Y, float aniso) {
  float NoL = dot(N, L);
  if (NoL <= 0.0) return vec3(0.0);
  vec3 H = normalize(V + L);
  float NoV = max(dot(N, V), 1e-4), NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);
  vec3 F = f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
  float DV;
  if (aniso > 0.0) {
    float at = max(a * (1.0 + aniso), 0.003), ab = max(a * (1.0 - aniso), 0.003);
    DV = D_Aniso(at, ab, dot(X, H), dot(Y, H), NoH) * V_Aniso(at, ab, dot(X, V), dot(Y, V), dot(X, L), dot(Y, L), NoV, NoL);
  } else DV = D_GGX(NoH, a) * V_GGX(NoV, NoL, a);
  return (diff * (1.0 - F) / PI + DV * F) * Lc * NoL;
}
// N, V: unit normal and view vector; wp: world position; lp, ln: local position and normal.
vec3 shadePBR(vec3 N, vec3 V, vec3 wp, vec3 lp, vec3 ln, float vis, out vec3 emission) {
  vec3 base = toLin(gBase);
  float metal = uMat.y, rough = clamp(gRough, 0.03, 1.0), cc = uMat.w;
  vec3 f0 = mix(vec3(0.04), uF0, metal);
  vec3 diff = base * (1.0 - metal);
  float aniso = uBrush.w;
  vec3 X = vec3(1.0, 0.0, 0.0), Y = vec3(0.0, 0.0, 1.0);
  vec3 org = (uModel * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  if (aniso > 0.0 || uDetail.y > 0.0) {
    vec3 A = normalize(mat3(uModel) * uBrush.xyz);
    vec3 T;
    if (uDetail.x < 0.5) {
      // turned: the grooves run around the axis, on the sides and on the end faces
      vec3 side = cross(A, N);
      vec3 rad = wp - org; rad -= A * dot(rad, A);
      T = length(side) > 0.3 ? normalize(side) : normalize(cross(A, normalize(rad + N * 1e-4)) + 1e-6);
    } else {
      T = A - N * dot(A, N);
      T = length(T) > 1e-3 ? normalize(T) : normalize(cross(N, vec3(0.0, 0.0, 1.0)) + vec3(1e-4));
    }
    Y = T; X = normalize(cross(N, T));
    if (uDetail.y > 0.0) {
      float s = dot(wp - org, X) * uDetail.y;
      float g = 0.55 * vnoise1(s) + 0.3 * vnoise1(s * 3.7 + 11.0) + 0.15 * vnoise1(s * 11.3 + 37.0);
      rough = clamp(rough * (1.0 + 0.4 * g), 0.03, 1.0);
      f0 *= 1.0 + 0.07 * g;
      // Muscle: fascicles show as fine light and dark stripes along the fibers.
      if (uTissue.z > 0.5) diff *= 0.8 + 0.2 * smoothstep(-0.4, 0.6, g + 0.35 * sin(s * 2.1));
    }
  }
  if (uDetail.z > 0.5) {
    // carbon fiber: a 2x2 twill of tows, each with its own fiber direction, under clear coat
    vec3 an = abs(normalize(ln));
    vec2 uv; vec3 ax, ay;
    if (an.x >= an.y && an.x >= an.z) { uv = lp.yz; ax = vec3(0.0, 1.0, 0.0); ay = vec3(0.0, 0.0, 1.0); }
    else if (an.y >= an.z) { uv = lp.xz; ax = vec3(1.0, 0.0, 0.0); ay = vec3(0.0, 0.0, 1.0); }
    else { uv = lp.xy; ax = vec3(1.0, 0.0, 0.0); ay = vec3(0.0, 1.0, 0.0); }
    vec2 q = uv * uDetail.w, c = floor(q), f = q - c;
    bool hz = mod(c.x + c.y, 4.0) < 2.0;
    vec3 fib = normalize(mat3(uModel) * (hz ? ax : ay));
    Y = normalize(fib - N * dot(fib, N) + 1e-5); X = normalize(cross(N, Y));
    float across = hz ? f.y : f.x, along = hz ? f.x : f.y;
    float edge = smoothstep(0.0, 0.18, across) * smoothstep(1.0, 0.82, across);
    diff *= 0.55 + 0.45 * edge * (0.75 + 0.25 * sin(along * PI));
    aniso = 0.75;
    rough = mix(0.55, 0.28, edge);
  }
  emission = uEmit;
  if (uTempAxis.w > 0.5) {
    float Tk = temperatureAt(lp);
    if (uHeat.x > 0.5) {
      // Oxide colors vary across a fired part: jitter the temperature by surface noise so the
      // bands mottle the way real heat tint does, and keep them muted.
      float span = max(abs(uTempS.y - uTempS.x), 1e-3);
      float nT = 0.6 * vnoise(lp * (7.0 / span)) + 0.4 * vnoise(lp * (19.0 / span) + 7.3);
      vec4 ht = heatTint(Tk - uHeat.y + 45.0 * nT);
      f0 = mix(f0, toLin(mix(ht.rgb, vec3(0.6), 0.45)), ht.a * 0.5);
      rough = mix(rough, max(rough, 0.5), smoothstep(620.0, 900.0, Tk - uHeat.y));
    }
    emission += blackbody(Tk) * glowOf(Tk);
  }
  float a = rough * rough;
  vec3 col = vec3(0.0);
  col += lightPBR(N, V, uLight, uKeyCol * vis, diff, f0, a, X, Y, aniso);
  if (uSun < 0.5) {
    col += lightPBR(N, V, uFillDir, uFillCol, diff, f0, a, X, Y, aniso);
    col += lightPBR(N, V, uRimDir, uRimCol, diff, f0, a, X, Y, aniso);
  }
  for (int i = 0; i < 2; i++) {
    if (uPtPos[i].w <= 0.0) continue;
    vec3 d = uPtPos[i].xyz - wp;
    float r2 = dot(d, d), att = 1.0 / (1.0 + r2 / (uPtPos[i].w * uPtPos[i].w));
    col += lightPBR(N, V, normalize(d), uPtCol[i] * att, diff, f0, a, X, Y, aniso);
  }
  // Tissue: light that enters scatters under the surface, so it wraps past the terminator tinted
  // by the blood and fat it passed through, glows through thin edges, and fuzzy fibers add sheen.
  if (uTissue.x > 0.0) {
    vec3 sc = toLin(uSssCol);
    float sssAmt = uTissue.x, w = 0.55 * sssAmt;
    for (int i = 0; i < 3; i++) {
      if (i > 0 && uSun > 0.5) break;
      vec3 L = i == 0 ? uLight : i == 1 ? uFillDir : uRimDir;
      vec3 Lc = i == 0 ? uKeyCol * mix(1.0, vis, 0.6) : i == 1 ? uFillCol : uRimCol;
      float ndl = dot(N, L), wrapped = clamp((ndl + w) / (1.0 + w), 0.0, 1.0);
      col += Lc * sc * (wrapped * wrapped - max(ndl, 0.0) * max(ndl, 0.0)) * sssAmt * base / PI * 1.6;
      col += Lc * sc * pow(clamp(dot(V, -(L + N * 0.35)), 0.0, 1.0), 4.0) * sssAmt * 0.22;
    }
    col += sc * envDiff(-N) * uLook.x * 0.18 * sssAmt;
    float NoV0 = max(dot(N, V), 0.0);
    col += uTissue.y * pow(1.0 - NoV0, 4.0) * (envDiff(N) * uLook.x + uKeyCol * vis * 0.25) * mix(base, vec3(1.0), 0.4) * 0.7;
  }
  float NoV = max(dot(N, V), 1e-4);
  vec3 Nb = N;
  if (aniso > 0.0) {
    vec3 at = cross(Y, V), anN = normalize(cross(at, Y) + 1e-6);
    Nb = normalize(mix(N, anN, aniso * clamp(3.0 * rough, 0.0, 0.9)));
  }
  vec2 ab = envBRDF(NoV, rough);
  float envK = uSun > 0.5 ? 0.06 : 1.0;
  col += (diff * envDiff(N) * uLook.x + envSpec(reflect(-V, Nb), rough) * (f0 * ab.x + ab.y) * uLook.y) * envK;
  if (cc > 0.0) {
    float Fc = (0.04 + 0.96 * pow(1.0 - NoV, 5.0)) * cc;
    col *= 1.0 - Fc;
    vec3 H = normalize(V + uLight);
    float sp = D_GGX(max(dot(N, H), 0.0), 0.04) * V_GGX(NoV, max(dot(N, uLight), 0.0), 0.04) * max(dot(N, uLight), 0.0);
    col += (envSpec(reflect(-V, N), 0.05) * uLook.y * envK + uKeyCol * vis * sp) * Fc;
  }
  return col;
}
vec3 shadeSoft(vec3 N, vec3 V, vec3 wp, float vis) {
  float ndl = dot(N, uLight);
  vec3 col;
  float sh = mix(1.0, vis, uHeat.w);
  if (uSun > 0.5) {
    float lit = smoothstep(-0.05, 0.25, ndl) * sh;
    col = gBase * (0.12 + 0.95 * lit * (0.55 + 0.45 * max(ndl, 0.0)));
  } else {
    float wrap = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
    wrap = wrap * wrap * (3.0 - 2.0 * wrap);
    vec3 cool = gBase * vec3(0.84, 0.86, 0.90);
    col = mix(cool, gBase, wrap * sh);
    col *= (0.92 + 0.08 * (0.5 + 0.5 * N.y)) * (1.0 - 0.1 * (1.0 - sh));
    vec3 H = normalize(uLight + V);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    col += vec3(pow(max(dot(N, H), 0.0), 40.0) * 0.06) * sh;
    col = mix(col, vec3(1.0), fres * 0.10);
  }
  for (int i = 0; i < 2; i++) {
    if (uPtPos[i].w <= 0.0) continue;
    vec3 d = uPtPos[i].xyz - wp;
    float r2 = dot(d, d), att = 1.0 / (1.0 + r2 / (uPtPos[i].w * uPtPos[i].w));
    col += gBase * uPtCol[i] * att * max(dot(N, normalize(d)), 0.0) * 0.3;
  }
  return col;
}`;

  // What the sky sends along a direction, for rays that leave the scene.
  const G_SKYRAD = `
vec3 skyRad(vec3 d) { return uSkyU.w > 1.5 ? atmosphere(d, uSunDir) * uSkyU.rgb : uSkyU.w > 0.5 ? uSkyU.rgb : vec3(0.0); }`;

  // Caustics under a simulated water surface (E3.water, see the water section): the map holds how
  // much the waves focus sunlight onto the floor, indexed by where that light entered a flat
  // surface. uCaustA: the map's world corner (x, z) and 1 / size; uCaustB: the water level, the
  // floor (world y), and the sideways shift of sunlight per unit depth; uCaustC: on, strength, the
  // Sun's angular radius (its disk blurs the lines more the deeper they fall).
  const G_CAUSTIC = `
uniform sampler2D uCaustic; uniform vec4 uCaustA; uniform vec4 uCaustB; uniform vec4 uCaustC;
uniform vec3 uCaustAbs; // the water's absorption per world unit (0: no water)
// Light reaching a point under the water has crossed dz / cos(refracted sun) of it on the way
// down (Beer-Lambert); applied before tone mapping, so a sunlit floor keeps its range.
vec3 waterTint(vec3 p) {
  float dz = uCaustB.x - p.y;
  if (dz <= 0.0 || uCaustAbs.g <= 0.0) return vec3(1.0);
  vec2 uv = (p.xz - uCaustA.xy) * uCaustA.zw;
  if (uv.x < -0.01 || uv.y < -0.01 || uv.x > 1.01 || uv.y > 1.01 || (uCaustC.w > 0.5 && length(uv - 0.5) > 0.51)) return vec3(1.0);
  return exp(-uCaustAbs * dz * sqrt(1.0 + dot(uCaustB.zw, uCaustB.zw)));
}
float causticAt(vec3 p) {
  if (uCaustC.x < 0.5) return 1.0;
  float dz = uCaustB.x - p.y;
  if (dz <= 0.0) return 1.0;
  vec2 uv = (p.xz - uCaustB.zw * dz - uCaustA.xy) * uCaustA.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  vec2 b = dz * uCaustC.z * uCaustA.zw;
  float c = (2.0 * texture(uCaustic, uv).r + texture(uCaustic, uv + vec2(b.x, 0.0)).r + texture(uCaustic, uv - vec2(b.x, 0.0)).r
           + texture(uCaustic, uv + vec2(0.0, b.y)).r + texture(uCaustic, uv - vec2(0.0, b.y)).r) / 6.0;
  return mix(1.0, c, sqrt(clamp(dz / max(uCaustB.x - uCaustB.y, 1e-4), 0.0, 1.0)) * uCaustC.y);
}`;

  const FS_MAIN = `#version 300 es
${G_COMMON}
${G_ENV}
${G_SHADOW}
${G_CAUSTIC}
${G_SURFACE}
${G_TRACE}
${G_LIGHTS}
${G_SKY}
${G_SKYRAD}
in vec3 vWorld; in vec3 vNormal; in vec3 vLocal; in vec3 vLocalN; in vec4 vBlade;
uniform vec4 uCut; uniform float uCutOn; uniform float uId; uniform vec3 uHighlight; uniform float uHighlightOn;
uniform float uHatch;
uniform vec4 uPart;   // two-sided, foliage, darkroom (only the scene's own lights), _
uniform sampler2D uMap; uniform vec4 uMapOn; // on, mapping (0 sphere, 1 planar, 2 box), alpha is roughness, _
uniform vec4 uMapBox; // planar and box mapping: origin (x, z) and size (x, z) in local units
uniform mat4 uMapVP;  // projector mapping: the projector's view-projection
uniform vec3 uMapProj; // and where it stands
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;
// Light from the scene's own lights (sampled over their area, with a shadow ray each), the sky
// (with a ray for whether it can be seen), and light bounced off other surfaces.
vec3 shadeLights(vec3 N, vec3 V, vec3 wp, vec3 diff, vec3 f0, float a) {
  vec3 sum = vec3(0.0);
  int spp = int(uRoom.y + 0.5), nb = int(uRoom.z + 0.5), nl = int(uRoom.x + 0.5);
  bool sky = uSkyU.w > 0.5;
  int depth = max(nb, sky ? 1 : 0);
  vec3 X = vec3(1.0, 0.0, 0.0), Y = vec3(0.0, 0.0, 1.0);
  for (int s = 0; s < 16; s++) {
    if (s >= spp) break;
    vec2 r = lds(uRoom.w * float(spp) + float(s), gl_FragCoord.xy);
    for (int i = 0; i < 8; i++) {
      if (i >= nl) break;
      vec3 l; float dist;
      vec3 Lc = sampleLight(i, wp, fract(r + float(i) * vec2(0.37, 0.61)), l, dist);
      if (dot(N, l) <= 0.0 || dot(Lc, Lc) <= 0.0) continue;
      if (blocked(wp + N * uTraceEps, l, max(dist - 2.0 * uTraceEps, 0.0))) continue;
      sum += lightPBR(N, V, l, Lc, diff, f0, a, X, Y, 0.0);
    }
    vec3 thr = diff, x = wp, nn = N;
    for (int b = 0; b < 6; b++) {
      if (b >= depth) break;
      vec3 d = cosDir(nn, b == 0 ? fract(r.yx + vec2(0.5)) : vec2(rnd(), rnd()));
      int id;
      float t = trace(x + nn * uTraceEps, d, 1e20, false, id);
      if (t > 1e29) { if (sky) sum += thr * skyRad(d); break; }
      if (b >= nb) break;
      vec3 y = x + nn * uTraceEps + d * t, ny = triNormal(id);
      if (dot(ny, d) > 0.0) ny = -ny;
      vec3 rho = triAlbedo(id);
      sum += thr * rho / PI * directAt(y, ny, vec2(rnd(), rnd()));
      thr *= rho; x = y; nn = ny;
    }
  }
  return sum / float(max(spp, 1));
}
void main() {
  if (uCutOn > 0.5 && dot(vWorld, uCut.xyz) > uCut.w) discard;
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing && uPart.x > 0.5) N = -N;
  else if (!gl_FrontFacing) {
    if (uCutOn < 0.5) discard;
    // Looking into a cut solid: this back face stands in for the section face. Its depth
    // stays where it is (so nearer surfaces still win); only the hatch is laid out on the
    // cut plane, where the view ray crosses it, so the lines stay straight and steady.
    vec3 dir = vWorld - uEye;
    float t = (uCut.w - dot(uEye, uCut.xyz)) / dot(dir, uCut.xyz);
    vec3 p = uEye + dir * t;
    vec3 n = uCut.xyz;
    vec3 a = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(n, a);
    float u = dot(p, normalize(a + b));
    float fw = max(fwidth(u), 1e-6);
    float d = abs(fract(u / uHatch + 0.5) - 0.5) * uHatch / fw;
    float line = 1.0 - smoothstep(0.35, 1.1, d);
    vec3 capc = uMat.x > 0.5 ? mix(uColor, vec3(0.86), 0.25 * uMat.y) : uColor;
    oColor = vec4(mix(capc * 0.93, capc * 0.5, line * 0.75), 1.0);
    oNormal = vec4(n * 0.5 + 0.5, uId);
    return;
  }
  gBase = uColor; gRough = uMat.z;
  if (uMapOn.x > 0.5) {
    // A picture on the part: latitude and longitude of the local direction (a globe), the
    // local x-z plane (a floor, a map), or the dominant axis (boxes).
    vec2 uv;
    vec3 q = vLocal;
    if (uMapOn.y < 0.5) { vec3 dn = normalize(q); uv = vec2(atan(dn.x, dn.z) / (2.0 * PI) + 0.5, acos(clamp(dn.y, -1.0, 1.0)) / PI); }
    else if (uMapOn.y < 1.5) uv = (q.xz - uMapBox.xy) / uMapBox.zw;
    else if (uMapOn.y > 2.5) { vec4 c = uMapVP * vec4(vWorld, 1.0); uv = c.w > 0.0 ? vec2(c.x, -c.y) / c.w * 0.5 + 0.5 : vec2(-1.0); }
    else { vec3 an = abs(vLocalN); uv = (an.x > an.y && an.x > an.z ? q.zy : an.y > an.z ? q.xz : q.xy) / uMapBox.zw; }
    vec2 gx = dFdx(uv), gy = dFdy(uv);
    if (uMapOn.y < 0.5) {
      // Longitude wraps around at the back; take its slope from the shifted copy there, so the
      // seam doesn't pick the smallest mip.
      vec2 hx = dFdx(vec2(fract(uv.x + 0.5), uv.y)), hy = dFdy(vec2(fract(uv.x + 0.5), uv.y));
      if (abs(hx.x) + abs(hy.x) < abs(gx.x) + abs(gy.x)) { gx.x = hx.x; gy.x = hy.x; }
    }
    vec4 tx = textureGrad(uMap, uv, gx, gy);
    // A projected picture only lands inside its frame.
    if (uMapOn.y > 2.5) {
      vec3 toP = uMapProj - vWorld;
      float dp = length(toP);
      bool outside = uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || dot(N, toP) <= 0.0;
      if (outside || blocked(vWorld + N * uTraceEps, toP / dp, dp - 2.0 * uTraceEps)) tx = vec4(1.0);
    }
    gBase = uColor * tx.rgb;
    if (uMapOn.z > 0.5) gRough = tx.a;
  }
  if (uPart.y > 0.5 && vBlade.z > 0.5) {
    // Grass: each blade a little different in hue and dryness, darker toward the root where
    // the blades shade each other, a lighter, drier tip.
    float rr = vBlade.x, h = vBlade.y;
    vec3 c = gBase * mix(vec3(0.82, 0.92, 0.7), vec3(1.12, 1.06, 0.8), fract(rr * 7.31));
    c = mix(c, vec3(0.62, 0.6, 0.36) * dot(gBase, vec3(0.6)), smoothstep(0.75, 1.0, h) * step(0.82, fract(rr * 3.7)) * 0.6);
    gBase = c * mix(0.32, 1.0, smoothstep(0.0, 0.55, h));
  }
  vec3 V = normalize(uEye - vWorld);
  float vis = shadowAt(vWorld, N) * causticAt(vWorld);
  vec3 col, glow = vec3(0.0);
  if (uMat.x > 1.5) {
    // A light's own surface: its radiance, so a dim light looks dim and a bright one white.
    // A bright colored bulb looks its color at full strength (like a camera), not white.
    vec3 e = uEmit * uLook.z;
    float pk = max(e.r, max(e.g, e.b));
    col = pk > 0.76 ? toSrgb(e / pk * mix(0.86, 1.0, smoothstep(1.0, 4.0, pk)) + vec3(0.14) * smoothstep(1.0, 8.0, pk) * (1.0 - e / pk)) : toSrgb(tonemap(e));
    glow = min(e, vec3(4.0)) * 0.1 * step(0.01, uLook.w);
    // The back of a one-sided panel or disk gives no light.
    if (!gl_FrontFacing && uPart.w < 0.5) { col = vec3(0.16); glow = vec3(0.0); }
  } else if (uPart.z > 0.5) {
    // A dark room lit only by the scene's lights and sky: diagram materials are ideal
    // diffuse (Lambertian) surfaces, physical ones keep their metal and gloss.
    vec3 base = toLin(gBase);
    float metal = uMat.x > 0.5 ? uMat.y : 0.0, rough = uMat.x > 0.5 ? clamp(gRough, 0.03, 1.0) : 1.0;
    vec3 f0 = uMat.x > 0.5 ? mix(vec3(0.04), uF0, metal) : vec3(0.0);
    vec3 lin = shadeLights(N, V, vWorld, base * (1.0 - metal), f0, rough * rough);
    if (uPart.y > 0.5) {
      vec3 back = vec3(0.0);
      int nl = int(uRoom.x + 0.5);
      for (int i = 0; i < 8; i++) {
        if (i >= nl) break;
        vec3 l; float dist;
        vec3 Lc = sampleLight(i, vWorld, vec2(0.5), l, dist);
        back += Lc * pow(max(dot(-V, l), 0.0), 3.0) * max(-dot(N, l), 0.0);
      }
      lin += back * base * 0.5;
    }
    col = toSrgb(tonemap((lin + uEmit) * uLook.z));
    glow = uEmit * uLook.w;
  } else if (uMat.x < 0.5) {
    col = shadeSoft(N, V, vWorld, vis);
    if (uRoom.x > 0.5) col = toSrgb(toLin(col) + shadeLights(N, V, vWorld, toLin(gBase), vec3(0.0), 1.0) * uLook.z);
    col = toSrgb(toLin(col) * waterTint(vWorld));
  } else {
    vec3 em;
    vec3 lin = shadePBR(N, V, vWorld, vLocal, vLocalN, vis, em);
    if (uRoom.x > 0.5) {
      float metal = uMat.y, rough = clamp(gRough, 0.03, 1.0);
      lin += shadeLights(N, V, vWorld, toLin(gBase) * (1.0 - metal), mix(vec3(0.04), uF0, metal), rough * rough);
    }
    col = toSrgb(tonemap((lin * waterTint(vWorld) + em) * uLook.z));
    glow = em * uLook.w;
  }
  if (uHighlightOn > 0.5) col = mix(col, uHighlight, 0.38);
  oColor = vec4(col + glow, 1.0);
  oNormal = vec4(N * 0.5 + 0.5, uId);
}`;

  const FS_GHOST = `#version 300 es
precision highp float;
in vec3 vWorld; in vec3 vNormal;
uniform vec3 uColor; uniform vec3 uEye; uniform vec3 uLight; uniform float uOpacity;
uniform vec4 uCut; uniform float uCutOn;
layout(location=0) out vec4 oColor;
void main() {
  if (uCutOn > 0.5 && dot(vWorld, uCut.xyz) > uCut.w) discard;
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vWorld);
  float facing = abs(dot(N, V));
  float rim = pow(1.0 - facing, 2.2);
  float a = clamp(uOpacity * (0.30 + 1.6 * rim), 0.0, 0.9);
  vec3 col = uColor * (0.85 + 0.15 * clamp(dot(N, uLight), 0.0, 1.0));
  col = mix(col, col * 0.55, rim * 0.6);
  oColor = vec4(col * a, a);
}`;

  // Glass: refracts the finished opaque picture behind it (with a little dispersion),
  // reflects the environment by Fresnel, absorbs a tint along its thickness, and writes
  // depth and normals so its edges get ink like any solid.
  const FS_GLASS = `#version 300 es
${G_COMMON}
${G_ENV}
in vec3 vWorld; in vec3 vNormal;
uniform vec3 uColor; uniform vec3 uEye; uniform vec3 uLight; uniform vec3 uKeyCol;
uniform vec4 uCut; uniform float uCutOn; uniform float uId; uniform vec3 uHighlight; uniform float uHighlightOn;
uniform sampler2D uScene; uniform vec2 uSceneInv; uniform vec2 uSceneSize;
uniform mat4 uViewProj; uniform vec4 uGlass; uniform vec4 uLook;
uniform vec4 uWater; // water: ripple strength, ripple wavelength (world), time, depth color
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;
vec2 screenOf(vec3 w) { vec4 c = uViewProj * vec4(w, 1.0); return (c.xy / c.w * 0.5 + 0.5) * uSceneSize; }
void main() {
  if (uCutOn > 0.5 && dot(vWorld, uCut.xyz) > uCut.w) discard;
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vWorld);
  if (uWater.x > 0.0 && N.y > 0.2) {
    // A water surface: three travelling swells and a finer chop tilt the normal; the tilts move
    // the refracted picture and break the sun's reflection into glints.
    vec2 q = vWorld.xz / max(uWater.y, 1e-6);
    float t = uWater.z;
    vec2 g = vec2(0.8, 0.6) * cos(dot(q, vec2(0.8, 0.6)) + t * 1.3)
           + vec2(-0.5, 0.86) * cos(dot(q, vec2(-0.5, 0.86)) * 1.7 + t * 1.9) * 0.55
           + vec2(0.24, -0.97) * cos(dot(q, vec2(0.24, -0.97)) * 2.9 + t * 2.7) * 0.3;
    g += vec2(vnoise(vec3(q * 3.1, t * 0.7)), vnoise(vec3(q * 3.1 + 11.0, t * 0.7))) * 0.35;
    N = normalize(N + vec3(-g.x, 0.0, -g.y) * uWater.x * 0.08 * N.y);
  }
  float NoV = clamp(dot(N, V), 0.0, 1.0);
  float ior = uGlass.x, thick = uGlass.y, disp = uGlass.z, rough = uGlass.w;
  float f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  float F = f0 + (1.0 - f0) * pow(1.0 - NoV, 5.0);
  vec2 here = gl_FragCoord.xy;
  vec3 behind = vec3(0.0), wsum = vec3(0.0); float behindA = 0.0;
  float tir = 0.0;
  // Dispersion: six wavelengths across the visible band, each bent by its own index and weighted
  // into RGB by a smooth response, so a fringe is a soft gradient rather than three hard copies.
  // Rough (frosted) glass spreads each sample over a small disk of what's behind.
  float ang = 6.2831853 * fract(52.9829189 * fract(dot(here, vec2(0.06711056, 0.00583715))));
  for (int i = 0; i < 6; i++) {
    float u = (float(i) + 0.5) / 6.0;
    float n = ior + (u - 0.5) * 2.0 * disp;
    vec3 Tr = refract(-V, N, 1.0 / n);
    if (dot(Tr, Tr) < 1e-6) { tir += 1.0; continue; }
    vec2 at = screenOf(vWorld + Tr * thick * (1.0 + 0.6 * (1.0 - NoV)));
    float a2 = ang + float(i) * 2.39996;
    at += vec2(cos(a2), sin(a2)) * rough * 28.0 * sqrt(u + 0.1);
    vec4 sm = texture(uScene, clamp(at, vec2(0.5), uSceneSize - 0.5) * uSceneInv);
    vec3 w = vec3(exp(-pow((u - 0.1) / 0.24, 2.0)), exp(-pow((u - 0.5) / 0.22, 2.0)), exp(-pow((u - 0.9) / 0.24, 2.0)));
    behind += sm.rgb * w; wsum += w;
    behindA += sm.a / 6.0;
  }
  behind /= max(wsum, vec3(1e-4));
  tir *= 3.0 / 6.0;
  // Absorption: a faint tint, stronger where the light crosses more glass (edges).
  // Water absorbs red first, so deeper water (or a longer path at a grazing angle) turns blue-green.
  vec3 tint = pow(clamp(uColor, 0.02, 1.0), vec3((0.6 + 1.6 * (1.0 - NoV)) * (1.0 + uWater.w)));
  float T = (1.0 - F) * (1.0 - tir / 3.0);
  vec3 R = reflect(-V, N);
  vec3 refl = envSpec(R, rough) * uLook.y;
  vec3 H = normalize(V + uLight);
  refl += uKeyCol * pow(max(dot(N, H), 0.0), 600.0) * 4.0;
  float Fr = mix(F, 1.0, tir / 3.0);
  vec3 reflD = toSrgb(tonemap(refl * uLook.z));
  vec3 col = behind * tint * T + reflD * Fr;
  float alpha = clamp(behindA * T + (1.0 - T * (0.55 + 0.45 * dot(tint, vec3(0.333)))), 0.0, 1.0);
  col = min(col, vec3(alpha + Fr));
  if (uHighlightOn > 0.5) col = mix(col, uHighlight * alpha, 0.3);
  oColor = vec4(col, max(alpha, Fr * 0.6));
  oNormal = vec4(N * 0.5 + 0.5, uId);
}`;

  // The ground: invisible except for the shadow it catches, a soft contact shadow right
  // under the model plus the cast shadow of the key light, fading out with distance.
  const VS_GROUND = `#version 300 es
uniform mat4 uViewProj; uniform vec3 uCenter; uniform float uHalf;
out vec3 vWorld;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vWorld = uCenter + vec3(c.x * uHalf, 0.0, c.y * uHalf);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}`;
  const FS_GROUND = `#version 300 es
${G_COMMON}
${G_SHADOW}
in vec3 vWorld;
uniform vec3 uCenter; uniform vec2 uRadii; uniform vec4 uGround;
out vec4 o;
void main() {
  vec2 q = (vWorld.xz - uCenter.xz) / uRadii;
  float blob = uGround.x * pow(1.0 - smoothstep(0.0, 1.0, length(q)), 1.7);
  float fade = 1.0 - smoothstep(0.55, 1.0, length(vWorld.xz - uCenter.xz) / uGround.z);
  float castS = (1.0 - shadowAt(vWorld, vec3(0.0, 1.0, 0.0))) * uGround.y * fade;
  float a = 1.0 - (1.0 - blob) * (1.0 - castS);
  o = vec4(0.0, 0.0, 0.0, a);
}`;

  const VS_FULL = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  // Composite: ink outlines from depth, normal, and part-id discontinuities over a filter
  // of the render pixels behind each output pixel (supersampled, or a smooth upscale at
  // reduced render scale), ambient occlusion, the effects layer, and bloom.
  const FS_COMPOSITE = `#version 300 es
${G_COMMON}
${G_TRACE}
${G_LIGHTS}
${G_SKY}
${G_SKYRAD}
uniform sampler2D uColor; uniform sampler2D uNormal; uniform sampler2D uDepth; uniform sampler2D uFx; uniform sampler2D uBloom;
uniform vec2 uInvSize; uniform float uStep; uniform float uInk;
uniform vec2 uScale; uniform int uTaps; uniform float uAo; uniform float uAoR;
uniform vec2 uFxInv; uniform vec2 uBloomInv; uniform vec4 uPost;
uniform mat3 uViewRot; uniform vec2 uTanHalf; uniform vec2 uSize;
uniform vec4 uShim[4]; uniform vec4 uShimR[4]; uniform int uShimN; uniform float uShimT;
uniform vec4 uBg;      // background: 0 none (the page shows through), 1 a color, 2 the sky; exposure
uniform vec3 uBgColor; uniform vec3 uEyeW;
uniform vec4 uHaze;    // scattering per meter, asymmetry g, steps, on
uniform vec4 uHazeBall; // where the haze is: center, radius
uniform vec3 uHazeCol;
out vec4 o;
// Light scattered by haze along the view ray, up to the first surface: the beams from each
// light (blocked where something stands in its way) and how much of what's behind gets through.
vec3 hazeMarch(vec3 eye, vec3 dir, float tmax, vec2 px, out float T) {
  T = 1.0;
  vec3 oc = eye - uHazeBall.xyz;
  float b = dot(oc, dir), c = dot(oc, oc) - uHazeBall.w * uHazeBall.w, h = b * b - c;
  if (h <= 0.0) return vec3(0.0);
  h = sqrt(h);
  float t0 = max(-b - h, 0.0), t1 = min(-b + h, tmax);
  if (t1 <= t0) return vec3(0.0);
  int n = int(uHaze.z + 0.5);
  float dt = (t1 - t0) / float(n), sig = uHaze.x / uUnits;
  float j = fract(ign(px) + uRoom.w * 0.6180339);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    vec3 p = eye + dir * (t0 + (float(i) + j) * dt);
    vec2 r = lds(uRoom.w * float(n) + float(i), px);
    sum += T * sig * dt * scatterAt(p, -dir, uHaze.y, r);
    T *= exp(-sig * dt);
  }
  return sum * uHazeCol;
}
// Heat shimmer: hot gas bends the light from what's behind it. Each zone is a tapered capsule
// in output pixels (start, end; radius at each end, strength in pixels); noise drifting along
// it offsets where the scene behind is read, so solids seen through the jet waver.
vec2 shimmer(vec2 p) {
  vec2 off = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= uShimN) break;
    vec2 a = uShim[i].xy, ab = uShim[i].zw - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    float r = mix(uShimR[i].x, uShimR[i].y, t), d = length(p - (a + ab * t));
    float m = (1.0 - smoothstep(r * 0.35, r, d)) * smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.7, 1.0, t));
    if (m <= 0.0) continue;
    vec2 dir = ab / max(length(ab), 1e-4);
    vec3 q = vec3((p - dir * uShimT * r * 2.5) / max(r * 0.3, 1.0), uShimT * 3.0);
    off += vec2(vnoise(q), vnoise(q + 19.7)) * uShimR[i].z * m;
  }
  return off;
}
vec4 shade(vec2 px) {
  vec4 c0 = texture(uColor, px * uInvSize);
  c0.rgb = min(c0.rgb, vec3(c0.a));
  vec4 n0 = texture(uNormal, px * uInvSize);
  float d0 = linDepth(texture(uDepth, px * uInvSize).r);
  bool bg0 = n0.a < 0.5 / 255.0;
  float edge = 0.0;
  float inkDepth = bg0 ? 1e20 : d0;
  vec3 inkSrc = bg0 ? vec3(0.45) : c0.rgb / max(c0.a, 1e-3);
  const vec2 offs[8] = vec2[8](vec2(1, 0), vec2(-1, 0), vec2(0, 1), vec2(0, -1),
                               vec2(0.71, 0.71), vec2(-0.71, 0.71), vec2(0.71, -0.71), vec2(-0.71, -0.71));
  for (int i = 0; i < 8; i++) {
    vec2 q = (px + offs[i] * uStep) * uInvSize;
    vec4 n1 = texture(uNormal, q);
    bool bg1 = n1.a < 0.5 / 255.0;
    float d1 = linDepth(texture(uDepth, q).r);
    float e = 0.0;
    if (bg0 != bg1) e = 1.0;
    else if (!bg0) {
      if (abs(n0.a - n1.a) > 0.5 / 255.0) e = 0.85;
      float dd = abs(d0 - d1) / max(min(d0, d1), 1e-4);
      e = max(e, smoothstep(0.012, 0.035, dd) * 0.85);
      float nd = 1.0 - dot(n0.xyz * 2.0 - 1.0, n1.xyz * 2.0 - 1.0);
      e = max(e, smoothstep(0.10, 0.32, nd) * 0.5);
    }
    // Water (id 255) draws no ink on its own waves or against the sky at the horizon.
    bool w0 = n0.a > 254.5 / 255.0, w1 = n1.a > 254.5 / 255.0;
    if ((w0 || bg0) && (w1 || bg1)) e = 0.0;
    if (e > 0.0 && !bg1 && d1 < inkDepth) {
      vec4 c1 = texture(uColor, q);
      inkDepth = d1;
      inkSrc = min(c1.rgb / max(c1.a, 1e-3), vec3(1.0));
    }
    edge = max(edge, e);
  }
  // Ink is a darker shade of the surface it outlines, so colored parts get colored lines.
  vec3 ink = pow(inkSrc, vec3(1.35)) * 0.40;
  float a = clamp(edge * uInk, 0.0, 1.0);
  return vec4(ink * a, a) + c0 * (1.0 - a);
}
// View-space position of a render pixel.
vec3 viewPos(vec2 px, float d) {
  vec2 ndc = px / uSize * 2.0 - 1.0;
  return uOrtho > 0.5 ? vec3(ndc * uTanHalf, -d) : vec3(ndc * uTanHalf * d, -d);
}
// Ambient occlusion: a normal-oriented hemisphere test against the depth buffer, 16 taps
// on a fixed spiral (no noise, so nothing to blur), with a range check so far-off
// surfaces don't darken what's in front of them.
float occlusion(vec2 px) {
  vec4 n0 = texture(uNormal, px * uInvSize);
  if (n0.a < 0.5 / 255.0 || n0.a > 254.5 / 255.0) return 1.0;
  float d0 = linDepth(texture(uDepth, px * uInvSize).r);
  vec3 P = viewPos(px, d0), N = normalize(uViewRot * (n0.xyz * 2.0 - 1.0));
  float rpx = uOrtho > 0.5 ? uAoR / (2.0 * uTanHalf.y) * uSize.y : uAoR / (2.0 * uTanHalf.y * d0) * uSize.y;
  rpx = clamp(rpx, 2.0, uSize.y * 0.08);
  float occ = 0.0;
  for (int i = 0; i < 16; i++) {
    float f = (float(i) + 0.5) / 16.0;
    float ang = float(i) * 2.39996323;
    vec2 q = px + vec2(cos(ang), sin(ang)) * rpx * sqrt(f);
    vec4 nq = texture(uNormal, q * uInvSize);
    if (nq.a < 0.5 / 255.0) continue;
    vec3 Q = viewPos(q, linDepth(texture(uDepth, q * uInvSize).r));
    vec3 v = Q - P;
    float L = length(v);
    float h = max(dot(N, v) / max(L, 1e-5) - 0.12, 0.0);
    occ += h * (1.0 - smoothstep(uAoR * 0.6, uAoR * 1.6, L));
  }
  return 1.0 - uAo * clamp(occ / 16.0 * 2.2, 0.0, 1.0);
}
void main() {
  vec2 o0 = floor(gl_FragCoord.xy);
  vec2 o1 = uShimN > 0 ? o0 + shimmer(o0 + 0.5) : o0;
  vec4 sum = vec4(0.0);
  float N = float(uTaps);
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
    if (i < uTaps && j < uTaps) sum += shade((o1 + (vec2(float(i), float(j)) + 0.5) / N) * uScale);
  }
  vec4 sc = sum / (N * N);
  if (uAo > 0.0) sc.rgb *= occlusion((o1 + 0.5) * uScale);
  vec4 res = sc;
  // World direction of this output pixel's view ray.
  vec2 ndc = (o0 + 0.5) / (uSize / uScale) * 2.0 - 1.0;
  vec3 wdir = normalize(transpose(uViewRot) * (uOrtho > 0.5 ? vec3(0.0, 0.0, -1.0) : vec3(ndc * uTanHalf, -1.0)));
  if (uBg.x > 0.5) {
    vec3 bgc = uBg.x > 1.5 ? toSrgb(tonemap(skyRad(wdir) * uBg.y)) : uBgColor;
    res = vec4(res.rgb + bgc * (1.0 - res.a), 1.0);
  }
  if (uPost.x > 0.5) {
    vec4 fx = texture(uFx, (o0 + 0.5) * uFxInv);
    res = vec4(min(fx.rgb, vec3(1.0)) + res.rgb * (1.0 - fx.a), fx.a + res.a * (1.0 - fx.a));
  }
  if (uHaze.w > 0.5) {
    vec4 nc = texture(uNormal, (o1 + 0.5) * uScale * uInvSize);
    float dz = nc.a < 0.5 / 255.0 ? 1e20 : linDepth(texture(uDepth, (o1 + 0.5) * uScale * uInvSize).r);
    float tmax = dz > 1e19 ? 1e20 : dz / max(dot(wdir, transpose(uViewRot) * vec3(0.0, 0.0, -1.0)), 1e-3);
    float T;
    vec3 sc2 = hazeMarch(uEyeW, wdir, tmax, o0, T);
    res.rgb = toSrgb(min(toLin(res.rgb) * T + tonemap(sc2 * uBg.y), vec3(1.0)));
    res.a = max(res.a, 1.0 - T);
  }
  if (uPost.y > 0.0) {
    vec3 b = texture(uBloom, (o0 + 0.5) * uBloomInv).rgb * uPost.y;
    res.rgb += b;
  }
  res.a = clamp(max(res.a, max(res.r, max(res.g, res.b))), 0.0, 1.0);
  float dz = (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
  res.rgb = clamp(res.rgb + dz * step(0.002, res.a), 0.0, res.a);
  o = res;
}`;

  // Copies a traced view's running average to the canvas.
  const FS_PRESENT = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
out vec4 o;
void main() { o = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0); }`;

  // Bloom: pick out what's brighter than its own coverage (glowing parts, fire, plumes),
  // halve it down a chain, and add it back up with a tent filter.
  const FS_BLOOM_EXTRACT = `#version 300 es
precision highp float;
uniform sampler2D uColor; uniform sampler2D uFx; uniform vec2 uColorInv; uniform vec2 uColorScale; uniform vec2 uFxInv; uniform float uFxOn;
out vec4 o;
vec3 over(vec4 c) { return max(c.rgb - vec3(c.a), 0.0); }
void main() {
  vec2 p = gl_FragCoord.xy * 2.0;
  vec3 s = vec3(0.0);
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 q = p + vec2(float(i), float(j)) - 0.5;
    s += over(texture(uColor, q * uColorScale * uColorInv));
    if (uFxOn > 0.5) s += over(texture(uFx, q * uFxInv)) * 0.8;
  }
  o = vec4(min(s * 0.25, vec3(16.0)), 1.0);
}`;
  const FS_DOWN = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uSrcInv;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy * 2.0;
  vec3 s = texture(uSrc, (p + vec2(-1.0, -1.0)) * uSrcInv).rgb + texture(uSrc, (p + vec2(1.0, -1.0)) * uSrcInv).rgb
         + texture(uSrc, (p + vec2(-1.0, 1.0)) * uSrcInv).rgb + texture(uSrc, (p + vec2(1.0, 1.0)) * uSrcInv).rgb;
  s = s * 0.5 + texture(uSrc, p * uSrcInv).rgb * 2.0;
  o = vec4(s / 4.0, 1.0);
}`;
  const FS_UP = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uSrcInv; uniform float uWeight;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy * 0.5;
  vec3 s = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    float w = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0);
    s += texture(uSrc, (p + vec2(float(i), float(j)) * 0.75) * uSrcInv).rgb * w;
  }
  o = vec4(s / 16.0 * uWeight, 1.0);
}`;

  // The procedural environment, made once per look and page theme: soft boxes around a
  // neutral sweep (studio), a dark room with cool rim strips (night), or a sky (outdoor).
  const FS_ENV = `#version 300 es
${G_COMMON}
${G_SKY}
uniform vec2 uSize; uniform int uKind; uniform float uDark; uniform vec3 uSun; uniform float uOutScale;
out vec4 o;
float softbox(vec3 d, vec3 c, vec3 up, vec2 size, float soft) {
  float k = dot(d, c);
  if (k <= 0.05) return 0.0;
  vec3 u = normalize(up - c * dot(up, c)), v = cross(c, u);
  vec2 q = vec2(dot(d, v), dot(d, u)) / k;
  vec2 e = abs(q) - size;
  float dist = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
  return 1.0 - smoothstep(-soft, soft, dist);
}
vec3 env(vec3 d) {
  float y = d.y;
  if (uKind == 3) return atmosphere(normalize(vec3(d.x, max(d.y, -0.2), d.z)), normalize(uSun));
  if (uKind == 2) {
    vec3 zen = vec3(0.16, 0.32, 0.72), hor = vec3(0.78, 0.84, 0.92), gnd = vec3(0.26, 0.24, 0.21);
    if (uDark > 0.5) { zen *= 0.35; hor *= 0.35; gnd *= 0.4; }
    vec3 col = y > 0.0 ? mix(hor, zen, pow(y, 0.55)) * 1.3 : mix(hor * 0.75, gnd, smoothstep(0.0, 0.2, -y));
    float s = max(dot(d, uSun), 0.0);
    col += vec3(1.0, 0.9, 0.75) * (pow(s, 1200.0) * 60.0 + pow(s, 24.0) * 0.6);
    return col;
  }
  if (uKind == 1) {
    vec3 col = y > 0.0 ? mix(vec3(0.016, 0.018, 0.026), vec3(0.03, 0.035, 0.05), y) : vec3(0.008, 0.008, 0.01);
    col += vec3(0.55, 0.65, 1.0) * 3.2 * softbox(d, normalize(vec3(-0.85, 0.2, -0.5)), vec3(0, 1, 0), vec2(0.06, 0.7), 0.04);
    col += vec3(0.55, 0.65, 1.0) * 2.6 * softbox(d, normalize(vec3(0.85, 0.25, -0.45)), vec3(0, 1, 0), vec2(0.06, 0.7), 0.04);
    col += vec3(0.7, 0.75, 0.9) * 0.9 * softbox(d, normalize(vec3(0.05, 1.0, 0.1)), vec3(0, 0, 1), vec2(0.5, 0.3), 0.15);
    return col;
  }
  vec3 wall = uDark > 0.5 ? vec3(0.05, 0.052, 0.058) : vec3(0.54, 0.55, 0.57);
  vec3 ceilc = uDark > 0.5 ? vec3(0.03, 0.032, 0.036) : vec3(0.42, 0.43, 0.45);
  vec3 flo = uDark > 0.5 ? vec3(0.018, 0.018, 0.02) : vec3(0.2, 0.2, 0.205);
  vec3 col = y > 0.0 ? mix(wall, ceilc, smoothstep(0.0, 0.9, y)) : mix(wall * 0.8, flo, smoothstep(0.0, 0.18, -y));
  col += (uDark > 0.5 ? 0.04 : 0.18) * exp(-abs(y) * 22.0);
  float bright = uDark > 0.5 ? 0.8 : 1.0;
  col += vec3(1.0, 0.97, 0.93) * 7.0 * bright * softbox(d, normalize(vec3(-0.5, 0.62, 0.6)), vec3(0, 1, 0), vec2(0.36, 0.26), 0.05);
  col += vec3(1.0, 0.99, 0.97) * 3.0 * bright * softbox(d, normalize(vec3(0.15, 1.0, 0.2)), vec3(0, 0, 1), vec2(0.55, 0.32), 0.08);
  col += vec3(0.93, 0.96, 1.0) * 1.5 * bright * softbox(d, normalize(vec3(0.92, 0.12, 0.38)), vec3(0, 1, 0), vec2(0.28, 0.5), 0.12);
  col += vec3(1.0) * 4.5 * bright * softbox(d, normalize(vec3(-0.78, 0.18, -0.6)), vec3(0, 1, 0), vec2(0.06, 0.62), 0.03);
  col += vec3(1.0) * 3.5 * bright * softbox(d, normalize(vec3(0.8, 0.28, -0.52)), vec3(0, 1, 0), vec2(0.06, 0.62), 0.03);
  return col;
}
vec3 dirOf(vec2 uv) {
  float ph = (uv.x - 0.5) * 2.0 * PI, th = uv.y * PI;
  return vec3(sin(th) * sin(ph), cos(th), -sin(th) * cos(ph));
}
void main() { o = vec4(env(dirOf(gl_FragCoord.xy / uSize)) * uOutScale, 1.0); }`;

  // Prefilters the environment for one roughness (GGX importance sampling, reading lower
  // mips of the source for wide lobes so small bright boxes don't sparkle), or, with
  // uMode 1, convolves it with a cosine lobe for diffuse light.
  const FS_PREFILTER = `#version 300 es
${G_COMMON}
uniform sampler2D uSrc; uniform vec2 uSize; uniform float uRough; uniform int uMode; uniform float uSrcW; uniform float uScale;
out vec4 o;
vec3 dirOf(vec2 uv) { float ph = (uv.x - 0.5) * 2.0 * PI, th = uv.y * PI; return vec3(sin(th) * sin(ph), cos(th), -sin(th) * cos(ph)); }
vec2 uvOf(vec3 d) { return vec2(atan(d.x, -d.z) * (0.5 / PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI); }
vec2 hamm(uint i, uint n) { uint b = i; b = (b << 16u) | (b >> 16u); b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u); b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u); b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u); b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u); return vec2(float(i) / float(n), float(b) * 2.3283064365386963e-10); }
void main() {
  vec3 N = dirOf(gl_FragCoord.xy / uSize);
  vec3 up = abs(N.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tx = normalize(cross(up, N)), ty = cross(N, tx);
  vec3 sum = vec3(0.0); float w = 0.0;
  const uint S = 96u;
  float texel = 4.0 * PI / (uSrcW * uSrcW * 0.5);
  if (uMode == 1) {
    for (uint i = 0u; i < S; i++) {
      vec2 xi = hamm(i, S);
      float ph = 2.0 * PI * xi.y, ct = sqrt(1.0 - xi.x), st = sqrt(xi.x);
      vec3 L = tx * (st * cos(ph)) + ty * (st * sin(ph)) + N * ct;
      float pdf = ct / PI;
      float lod = clamp(0.5 * log2(1.0 / (float(S) * pdf * texel)) + 1.0, 0.0, 8.0);
      sum += textureLod(uSrc, uvOf(L), lod).rgb;
      w += 1.0;
    }
    o = vec4(sum / w * uScale, 1.0);
    return;
  }
  float a = uRough * uRough;
  for (uint i = 0u; i < S; i++) {
    vec2 xi = hamm(i, S);
    float ph = 2.0 * PI * xi.y, ct = sqrt((1.0 - xi.x) / (1.0 + (a * a - 1.0) * xi.x)), st = sqrt(1.0 - ct * ct);
    vec3 H = tx * (st * cos(ph)) + ty * (st * sin(ph)) + N * ct;
    vec3 L = 2.0 * dot(N, H) * H - N;
    float NoL = dot(N, L);
    if (NoL <= 0.0) continue;
    float a2 = a * a, f = (ct * a2 - ct) * ct + 1.0, D = a2 / (PI * f * f);
    float pdf = D * 0.25 + 1e-4;
    float lod = uRough < 0.02 ? 0.0 : clamp(0.5 * log2(1.0 / (float(S) * pdf * texel)) + 1.0, 0.0, 8.0);
    sum += textureLod(uSrc, uvOf(L), lod).rgb * NoL;
    w += NoL;
  }
  o = vec4(sum / max(w, 1e-4) * uScale, 1.0);
}`;

  // ---------- particle shaders ----------
  // Shared slot bookkeeping: generation, age, life, and hashed randoms per (slot, generation).
  const G_SLOT = `
uniform uint uSeed; uniform vec4 uLife;
float rnd(int i, float k, uint c) { return float(hashu(uint(i) * 0x9E3779B1u ^ hashu(uint(int(k)) + c * 0x632BE5ABu + uSeed)) >> 8) / 16777216.0; }
void slotAt(int i, float t, float P, out float k, out float age) {
  if (P <= 0.0) { k = 0.0; age = t; return; }
  float ph = fract(float(i) * 0.6180339887) * P;
  k = floor((t - ph) / P);
  age = t - (ph + k * P);
}
float lifeOf(int i, float k) { return uLife.y <= 0.0 ? 1e9 : mix(uLife.x, uLife.y, rnd(i, k, 1u)); }`;

  // Flow fields, the same formulas as E3.flow: uniform, cylinder, Joukowski airfoil.
  const G_FLOW = `
uniform vec4 uFlowA; uniform vec4 uFlowB; uniform vec4 uFlowC;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) { float d = max(dot(b, b), 1e-30); return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d; }
vec2 csqrt(vec2 a) { float r = length(a), t = atan(a.y, a.x) * 0.5; return sqrt(r) * vec2(cos(t), sin(t)); }
uniform highp sampler2D uFlowTex; uniform vec4 uFlowD; uniform vec4 uFlowE; uniform mat4 uFlowM; uniform mat4 uFlowMI;
// Tube flow (kind 3): boundary radii by station in uFlowTex (row 0: c0 c1 b0 b1, row 1: x0),
// uFlowD: y0, dy, stations, outside speed; uFlowE: core and bypass flux (Q / pi).
vec4 tubeFlow(vec3 pw) {
  vec3 q = (uFlowMI * vec4(pw, 1.0)).xyz;
  float r = length(q.xz), fi = (q.y - uFlowD.x) / uFlowD.y;
  int n = int(uFlowD.z + 0.5);
  if (fi < 0.0 || fi > float(n - 1)) return vec4(mat3(uFlowM) * vec3(0.0, uFlowD.w, 0.0), 1.0);
  int i = min(n - 2, int(floor(fi)));
  float f = fi - float(i);
  vec4 A = texelFetch(uFlowTex, ivec2(i, 0), 0), B = texelFetch(uFlowTex, ivec2(i + 1, 0), 0);
  vec2 ra = texelFetch(uFlowTex, ivec2(i, 1), 0).xy, rb = texelFetch(uFlowTex, ivec2(i + 1, 1), 0).xy;
  float xa = ra.x, xb = rb.x, heat = mix(ra.y, rb.y, f);
  vec4 v = mix(A, B, f), d = (B - A) / uFlowD.y;
  float x0 = mix(xa, xb, f), dx0 = (xb - xa) / uFlowD.y;
  float a, b, da, db, Q, uy, ur;
  if (r < v.x - 1e-4) return vec4(0.0);
  if (r <= v.y) { a = v.x; b = v.y; da = d.x; db = d.y; Q = uFlowE.x * heat; }
  else if (r < v.z) return vec4(0.0);
  else if (r <= v.w) { a = v.z; b = v.w; da = d.z; db = d.w; Q = uFlowE.y; }
  else if (r < x0) return vec4(0.0);
  else { uy = uFlowD.w; ur = r > 1e-4 ? uy * x0 * dx0 / r : 0.0; vec3 lv = vec3(r > 1e-4 ? ur * q.x / r : 0.0, uy, r > 1e-4 ? ur * q.z / r : 0.0); return vec4(mat3(uFlowM) * lv, 1.0); }
  float den = max(b * b - a * a, 1e-6);
  uy = Q / den;
  float eta = (r * r - a * a) / den;
  ur = r > 1e-4 ? uy * (a * da * (1.0 - eta) + b * db * eta) / r : 0.0;
  vec3 lv = vec3(r > 1e-4 ? ur * q.x / r : 0.0, uy, r > 1e-4 ? ur * q.z / r : 0.0);
  return vec4(mat3(uFlowM) * lv, 1.0);
}
// uFlowA: kind, U, alpha, S. uFlowB: center xyz, mid. uFlowC: mu.x, mu.y, a, gamma. Returns w = 0 inside the body.
vec4 flowAt(vec3 p) {
  int kind = int(uFlowA.x + 0.5);
  float U = uFlowA.y;
  if (kind == 0) return vec4(U, 0.0, 0.0, 1.0);
  if (kind == 3) return tubeFlow(p);
  float al = uFlowA.z, ca = cos(al), sa = sin(al);
  vec2 x = (p.xy - uFlowB.xy) / uFlowA.w;
  float g = uFlowC.w / (2.0 * PI);
  if (kind == 1) {
    float R = uFlowC.z;
    if (dot(x, x) < R * R) return vec4(0.0);
    vec2 t = cdiv(vec2(R * R, 0.0), cmul(x, x));
    vec2 w = vec2(U * (1.0 - t.x), -U * t.y) + cdiv(vec2(0.0, g), x);
    return vec4(w.x, -w.y, 0.0, 1.0);
  }
  vec2 z = vec2(x.x * ca - x.y * sa + uFlowB.w, x.x * sa + x.y * ca);
  vec2 s = csqrt(vec2(z.x * z.x - z.y * z.y - 4.0, 2.0 * z.x * z.y));
  vec2 z1 = (z + s) * 0.5, z2 = (z - s) * 0.5, mu = uFlowC.xy;
  float d1 = length(z1 - mu), d2 = length(z2 - mu);
  vec2 ze = d1 >= d2 ? z1 : z2;
  if (max(d1, d2) < uFlowC.z * 1.002) return vec4(0.0);
  vec2 zm = ze - mu;
  vec2 t = cdiv(cmul(vec2(uFlowC.z * uFlowC.z, 0.0), vec2(cos(al), sin(al))), cmul(zm, zm));
  vec2 dW = U * (vec2(cos(al), -sin(al)) - t) + cdiv(vec2(0.0, g), zm);
  vec2 iz = cdiv(vec2(1.0, 0.0), cmul(ze, ze));
  vec2 dw = cdiv(dW, vec2(1.0 - iz.x, -iz.y));
  float u = dw.x, v = -dw.y;
  return vec4(u * ca + v * sa, -u * sa + v * ca, 0.0, 1.0);
}`;

  // One fixed step of the particle simulation, run by transform feedback.
  const VS_PUPDATE = `#version 300 es
${G_COMMON}
${G_SLOT}
${G_FLOW}
layout(location=0) in vec4 aP; layout(location=1) in vec4 aV;
out vec4 oP; out vec4 oV;
uniform float uT; uniform float uH; uniform mat4 uEmitM;
uniform vec4 uEm0; uniform vec4 uEm1; uniform vec4 uEm2; uniform vec4 uEm3; uniform vec4 uEm4;
uniform highp sampler2D uSamples;
uniform vec4 uGrav; uniform vec4 uWind; uniform vec4 uTurb; uniform vec4 uVortA; uniform vec4 uVortB; uniform vec4 uVortC;
uniform vec4 uAttr[4]; uniform vec4 uAttrR; uniform int uNAttr;
uniform vec4 uPlane[8]; uniform vec4 uPlaneB[8]; uniform int uNPlane;
uniform vec4 uSph[4]; uniform vec4 uSphB[4]; uniform int uNSph;
uniform vec4 uKillMin; uniform vec4 uKillMax;
// uEm0: shape, radius, thickness/angle, rake lanes. uEm1: position xyz, spread. uEm2: direction xyz, speed0.
// uEm3: speed1, thermal, along (0 dir, 1 normal, 2 radial), surface. uEm4: size xyz (box) or line end xyz, nSamples.
void emit(int i, float k, out vec3 p, out vec3 v) {
  float shape = uEm0.x, R = uEm0.y;
  vec3 dir = normalize(uEm2.xyz);
  vec3 tmp = abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(dir, tmp)), w = cross(dir, u);
  float lanes = uEm0.w;
  vec3 n = dir; p = vec3(0.0);
  if (shape > 0.5 && shape < 3.5) { // 1 disk, 2 ring, 3 cone
    float a = 6.2831853 * rnd(i, k, 10u);
    float rr = shape > 1.5 && shape < 2.5 ? R + uEm0.z * (rnd(i, k, 11u) - 0.5) : R * sqrt(rnd(i, k, 11u));
    vec3 radial = u * cos(a) + w * sin(a);
    p = radial * rr;
    if (shape > 2.5) n = normalize(dir + radial * tan(uEm0.z) * (R > 0.0 ? rr / R : 1.0));
    if (shape > 1.5 && shape < 2.5 && uEm3.z > 1.5) n = radial;
  } else if (shape > 3.5 && shape < 4.5) { // sphere
    float z = 2.0 * rnd(i, k, 10u) - 1.0, a = 6.2831853 * rnd(i, k, 11u), q = sqrt(1.0 - z * z);
    n = vec3(q * cos(a), z, q * sin(a));
    p = n * (uEm3.w > 0.5 ? R : R * pow(rnd(i, k, 12u), 1.0 / 3.0));
  } else if (shape > 4.5 && shape < 5.5) { // box
    float ry = rnd(i, k, 11u);
    if (lanes > 0.5) ry = (floor(ry * lanes) + 0.5) / lanes;
    p = (vec3(rnd(i, k, 10u), ry, rnd(i, k, 12u)) - 0.5) * uEm4.xyz;
  } else if (shape > 5.5 && shape < 6.5) { // line from position to end
    float t = rnd(i, k, 10u);
    if (lanes > 0.5) t = (floor(t * lanes) + 0.5) / lanes;
    p = (uEm4.xyz - uEm1.xyz) * t;
  } else if (shape > 6.5) { // mesh samples
    int j = min(int(uEm4.w) - 1, int(rnd(i, k, 10u) * uEm4.w));
    p = texelFetch(uSamples, ivec2(j % 1024, (j / 1024) * 2), 0).xyz - uEm1.xyz;
    n = texelFetch(uSamples, ivec2(j % 1024, (j / 1024) * 2 + 1), 0).xyz;
  }
  p += uEm1.xyz;
  vec3 d = (uEm3.z > 0.5 || (shape > 2.5 && shape < 3.5)) ? n : dir;
  float spread = uEm1.w;
  if (spread > 0.0) {
    float ct = 1.0 - rnd(i, k, 13u) * (1.0 - cos(spread)), st = sqrt(max(0.0, 1.0 - ct * ct)), a = 6.2831853 * rnd(i, k, 14u);
    vec3 du = normalize(cross(d, abs(d.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), dw = cross(d, du);
    d = d * ct + du * st * cos(a) + dw * st * sin(a);
  }
  v = d * mix(uEm2.w, uEm3.x, rnd(i, k, 15u));
  if (uEm3.y > 0.0) {
    vec3 gs;
    for (int c = 0; c < 3; c++) gs[c] = sqrt(-2.0 * log(max(1e-7, rnd(i, k, uint(16 + c * 2))))) * cos(6.2831853 * rnd(i, k, uint(17 + c * 2)));
    v += gs * uEm3.y;
  }
  p = (uEmitM * vec4(p, 1.0)).xyz;
  v = mat3(uEmitM) * v;
}
void main() {
  int i = gl_VertexID;
  float k, age;
  slotAt(i, uT, uLife.y, k, age);
  float life = lifeOf(i, k);
  vec3 p = aP.xyz, v = aV.xyz;
  float gen = aP.w, hit = 0.0, h = uH;
  if (floor(gen) != k) {
    if (age > uH + 1e-5 && uLife.y > 0.0) { oP = vec4(p, k + 0.5); oV = vec4(v, 0.0); return; }
    emit(i, k, p, v);
    gen = k;
    h = clamp(age, 0.0, uH);
  }
  if (gen != k || age > life) { oP = vec4(p, gen); oV = vec4(v, 0.0); return; }
  if (uFlowA.x > -0.5) {
    vec4 f1 = flowAt(p);
    if (f1.w < 0.5) { oP = vec4(p, k + 0.5); oV = vec4(v, 0.0); return; }
    vec4 f2 = flowAt(p + f1.xyz * h * 0.5);
    v = f2.w > 0.5 ? f2.xyz : f1.xyz;
    if (uTurb.x > 0.0) v += curl(p * uTurb.y + vec3(0.0, 0.0, uT * uTurb.z)) * uTurb.x;
    p += v * h;
  } else {
    vec3 acc = uGrav.xyz;
    acc.y += uWind.w * max(0.0, 1.0 - age / life);
    if (uTurb.x > 0.0) acc += curl(p * uTurb.y + vec3(0.0, 0.0, uT * uTurb.z)) * uTurb.x;
    if (uVortC.y > 0.5) {
      vec3 r = p - uVortA.xyz, ax = uVortB.xyz;
      vec3 rp = r - ax * dot(r, ax);
      acc += uVortA.w * cross(ax, rp) / (dot(rp, rp) + uVortB.w * uVortB.w) - rp * uVortC.x;
    }
    for (int j = 0; j < 4; j++) {
      if (j >= uNAttr) break;
      vec3 d = uAttr[j].xyz - p;
      acc += d * uAttr[j].w / pow(dot(d, d) + uAttrR[j] * uAttrR[j], 1.5);
    }
    float kd = uGrav.w;
    if (kd > 0.0) {
      float e = exp(-kd * h), f = (1.0 - e) / kd;
      vec3 vt = uWind.xyz + acc / kd;
      p += vt * h + (v - vt) * f;
      v = vt + (v - vt) * e;
    } else {
      v += acc * h;
      p += v * h;
    }
  }
  for (int j = 0; j < 8; j++) {
    if (j >= uNPlane) break;
    vec3 n = uPlane[j].xyz;
    float s = dot(n, p) - uPlane[j].w;
    if (s >= 0.0) continue;
    p -= n * s;
    float vn = dot(n, v) - uPlaneB[j].z;
    if (vn < 0.0) {
      float jj = -(1.0 + uPlaneB[j].x) * vn;
      v += n * jj;
      if (uPlaneB[j].y > 0.0) { float vn2 = dot(n, v); v -= (v - n * vn2) * uPlaneB[j].y; }
      hit += jj;
    }
  }
  for (int j = 0; j < 4; j++) {
    if (j >= uNSph) break;
    vec3 d = p - uSph[j].xyz;
    float L = max(length(d), 1e-9), sg = uSphB[j].y, s = (L - uSph[j].w) * sg;
    if (s >= 0.0) continue;
    vec3 n = d * (sg / L);
    p -= n * s;
    float vn = dot(n, v);
    if (vn < 0.0) { float jj = -(1.0 + uSphB[j].x) * vn; v += n * jj; hit += jj; }
  }
  if (uKillMin.w > 0.5 && (any(lessThan(p, uKillMin.xyz)) || any(greaterThan(p, uKillMax.xyz)))) gen = k + 0.5;
  oP = vec4(p, gen);
  oV = vec4(v, hit);
}`;
  const FS_NULL = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }`;

  // Particle sprites. Styles: 0 smoke (soft lit puffs), 1 fire (additive, black-body color
  // over life), 2 spark (additive streaks), 3 streak (tracer dashes along the velocity),
  // 4 sphere (lit balls with depth and ink, drawn with the solids), 5 dot (flat discs).
  const VS_PARTICLE = `#version 300 es
${G_COMMON}
${G_SLOT}
${G_FLOW}
layout(location=0) in vec4 aP; layout(location=1) in vec4 aV;
uniform mat4 uViewProj; uniform vec3 uEye; uniform vec3 uCamR; uniform vec3 uCamU;
uniform vec4 uTime; uniform vec4 uSize; uniform int uStyle; uniform vec4 uShape;
uniform vec4 uSlab; uniform vec2 uSlabZ; uniform vec3 uSlabEye; uniform vec2 uPxW;
out vec2 vUv; out float vAge; out float vRnd; out vec3 vWorld; out vec3 vCenter; out float vSize; out vec3 vVel; out float vCov;
flat out int vAlive;
// uPxW: world size of one output pixel, per unit of distance (perspective) and flat (orthographic).
// uShape: trail (seconds of path behind the head), width (world units, 0 = from size), ribbon segments, part shadow.
// uSlab: camera forward (w = 0 for no slab); uSlabZ: the depth range this draw keeps.
void main() {
  int i = gl_InstanceID;
  float k, age;
  slotAt(i, uTime.x, uLife.y, k, age);
  float life = lifeOf(i, k);
  float r = rnd(i, k, 7u);
  vAlive = 0; vCov = 1.0;
  vUv = vec2(0.0); vAge = 0.0; vRnd = r; vWorld = vec3(0.0); vCenter = vec3(0.0); vSize = 0.0; vVel = vec3(0.0);
  if (aP.w != k || age < 0.0 || age > life || r > uTime.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vAlive = 1;
  float dtR = uTime.y - uTime.x;
  vec3 p = aP.xyz + aV.xyz * dtR;
  if (dot(uSlab.xyz, uSlab.xyz) > 0.5) {
    float z = dot(p - uSlabEye, uSlab.xyz);
    if (z < uSlabZ.x || z >= uSlabZ.y) { vAlive = 0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  }
  age += dtR;
  float t01 = uLife.y <= 0.0 ? 0.0 : clamp(age / life, 0.0, 1.0);
  float size = mix(uSize.x, uSize.y, sqrt(t01)) * (1.0 + uSize.z * (rnd(i, k, 8u) - 0.5));
  vAge = t01; vCenter = p; vSize = size; vVel = aV.xyz;
  vec3 w;
  if (uStyle == 2 || uStyle == 3) {
    // A ribbon of vertex pairs along the path the particle just travelled. Tracers in a
    // flow walk the field backwards, so the ribbon bends with its streamline (and curls
    // around a wing); everything else trails straight back along its velocity. The
    // ribbon is no longer than the particle's age, so nothing shows before its birth.
    int segs = max(int(uShape.z), 1);
    int seg = gl_VertexID >> 1;
    float side = float(gl_VertexID & 1) * 2.0 - 1.0;
    float u = float(seg) / float(segs);
    float sp = length(aV.xyz);
    vec3 dir = sp > 1e-5 ? aV.xyz / sp : uCamU;
    float trailT = max(uShape.x, 1e-4);
    float back = min(u * trailT, age);
    float h = seg > 0 ? back / float(seg) : trailT / float(segs);
    vec3 q = p, tang = dir;
    if (uFlowA.x > -0.5) {
      vec3 vv = aV.xyz;
      for (int st = 0; st < 24; st++) {
        if (st >= seg) break;
        vec4 f = flowAt(q);
        vv = f.w > 0.5 ? f.xyz : vv;
        q -= vv * h;
      }
      vec4 fb = flowAt(q);
      vec3 vt = fb.w > 0.5 ? fb.xyz : vv;
      tang = length(vt) > 1e-7 ? normalize(vt) : dir;
    } else {
      q = p - dir * sp * back;
    }
    vec3 toEye = normalize(uEye - q);
    vec3 sideV = cross(tang, toEye);
    sideV = length(sideV) > 1e-5 ? normalize(sideV) : uCamR;
    float wd = uShape.y > 0.0 ? uShape.y : size * 0.3;
    // Never thinner than about 1.5 output pixels: a thinner ribbon is drawn at that width
    // and faded by the share of it it really covers, so it stays smooth instead of breaking up.
    float px = uPxW.x * length(uEye - q) + uPxW.y, wMin = 1.5 * px;
    vCov = min(1.0, wd / wMin);
    wd = max(wd, wMin);
    float taper = uStyle == 3 ? (1.0 - 0.75 * u) * smoothstep(0.0, 0.08, 1.0 - u) : 1.0 - 0.7 * u;
    w = q + sideV * side * wd * 0.5 * taper;
    vUv = vec2(side, u);
  } else {
    vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
    float ang = uStyle == 0 ? r * 6.2831853 + age * (r - 0.5) * 0.6 : 0.0;
    vec2 rc = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * c;
    float s = uStyle == 4 ? size * 1.25 : size * 0.5;
    // A dot smaller than a pixel (a dust mote, a grain far away) draws a pixel wide, fainter by its coverage.
    if (uStyle == 5) { float px = uPxW.x * length(uEye - p) + uPxW.y, sm = max(s, 0.9 * px); vCov = (s / sm) * (s / sm); s = sm; }
    w = p + (uCamR * rc.x + uCamU * rc.y) * s;
    vUv = uStyle == 4 ? c : rc;
    if (uStyle == 0) vUv = c;
  }
  vWorld = w;
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

  const FS_PARTICLE = `#version 300 es
${G_COMMON}
${G_ENV}
${G_SHADOW}
${G_TRACE}
${G_LIGHTS}
in vec2 vUv; in float vAge; in float vRnd; in vec3 vWorld; in vec3 vCenter; in float vSize; in vec3 vVel; in float vCov;
flat in int vAlive;
uniform int uStyle; uniform vec4 uShape; uniform vec3 uEye; uniform vec3 uCamR; uniform vec3 uCamU; uniform mat4 uView;
uniform sampler2D uDepth; uniform vec2 uDepthScale;
uniform vec3 uColA; uniform vec3 uColB; uniform vec4 uColorBy; uniform vec4 uHeatP; uniform vec4 uFade;
uniform vec3 uLight; uniform vec3 uKeyCol; uniform vec4 uPtPos[2]; uniform vec3 uPtCol[2]; uniform vec4 uLook;
uniform vec4 uPRoom; // physical lights on, dark room (only those lights), dust asymmetry g
out vec4 o;
vec3 colorAt() {
  float t = uColorBy.x > 1.5 ? clamp((length(vVel) - uColorBy.y) / max(uColorBy.z - uColorBy.y, 1e-6), 0.0, 1.0) : (uColorBy.x > 0.5 ? vAge : 0.0);
  return mix(uColA, uColB, t);
}
void main() {
  if (vAlive == 0) discard;
  float sceneZ = linDepth(texture(uDepth, gl_FragCoord.xy * uDepthScale).r);
  float fragZ = -(uView * vec4(vWorld, 1.0)).z;
  if (fragZ > sceneZ) discard;
  float soft = clamp((sceneZ - fragZ) / max(uFade.z, 1e-5), 0.0, 1.0);
  float life = smoothstep(0.0, max(uFade.x, 1e-4), vAge) * (1.0 - smoothstep(1.0 - max(uFade.y, 1e-4), 1.0, vAge));
  float d2 = dot(vUv, vUv);
  if (uStyle == 0) {
    // Smoke: a puff of two noise octaves, lit as a small volume. Density toward the light
    // self-shadows the puff (bright on the lit side, dark underneath), the scene's shadow
    // map darkens smoke under the machine, and when the light is behind the puff its thin
    // edges glow (forward scattering). Hot soot (glow > 0) emits by black-body color and
    // cools along its life, so fire turns into smoke in one system.
    vec3 sd = vec3(vRnd * 13.0, vRnd * 7.0, vRnd * 29.0);
    float n1 = vnoise(vec3(vUv * 1.8 + sd.x, sd.y + vAge * 1.5));
    float n2 = vnoise(vec3(vUv * 3.9 + sd.z, sd.x + vAge * 2.3)) * 0.5;
    float puff = smoothstep(1.0, 0.12, d2 + 0.45 * n1 + 0.22 * n2);
    float a = puff * life * soft * uFade.w;
    if (a < 0.002) discard;
    vec3 toEye = normalize(uEye - vCenter);
    vec3 nrm = normalize(uCamR * vUv.x + uCamU * vUv.y + toEye * sqrt(max(1.0 - d2, 0.05)));
    vec2 uvL = vUv + vec2(dot(uLight, uCamR), dot(uLight, uCamU)) * 0.55;
    float dL = smoothstep(1.0, 0.12, dot(uvL, uvL) + 0.45 * vnoise(vec3(uvL * 1.8 + sd.x, sd.y + vAge * 1.5)));
    float selfSh = 1.0 - 0.55 * dL * puff;
    float vis = mix(1.0, shadowAt(vCenter, vec3(0.0, 1.0, 0.0)), uShape.w);
    float mu = max(dot(-toEye, uLight), 0.0);
    float fwd = mu * mu * mu * mu * (1.0 - puff) * 1.6;
    vec3 alb = toLin(colorAt());
    float ndl = max(dot(nrm, uLight), 0.0);
    vec3 lit = envDiff(nrm) * uLook.x * (1.0 - 0.25 * puff)
             + uKeyCol * ((0.25 + 0.75 * ndl) * selfSh + fwd) * vis / PI;
    for (int i = 0; i < 2; i++) {
      if (uPtPos[i].w <= 0.0) continue;
      vec3 d = uPtPos[i].xyz - vCenter;
      float att = 1.0 / (1.0 + dot(d, d) / (uPtPos[i].w * uPtPos[i].w));
      vec3 ld = normalize(d);
      // Smoke between the camera and a flame glows with the light passing through it.
      float through = pow(max(dot(-toEye, ld), 0.0), 4.0) * (1.0 - 0.7 * puff) * 2.5;
      lit += uPtCol[i] * att * (0.4 + 0.6 * max(dot(nrm, ld), 0.0) + through) / PI;
    }
    if (uPRoom.y > 0.5) lit = vec3(0.0);
    if (uPRoom.x > 0.5) lit += scatterAt(vCenter, toEye, 0.35, lds(uRoom.w, gl_FragCoord.xy)) * (0.45 + 0.55 * selfSh) * 4.0;
    float T = mix(uHeatP.x, uHeatP.y, vAge);
    vec3 emit = blackbody(T) * glowOf(T) * uHeatP.w * (0.6 + 0.4 * puff);
    vec3 col = toSrgb(tonemap(alb * lit * uLook.z + emit));
    o = vec4(col * a + emit * a * uLook.w * 0.15, a);
  } else if (uStyle == 1 || uStyle == 2) {
    float T = mix(uHeatP.x, uHeatP.y, vAge);
    vec3 e = blackbody(T) * glowOf(T) * uHeatP.z;
    float shape = uStyle == 1 ? pow(max(1.0 - d2, 0.0), 1.5) * (0.75 + 0.25 * vnoise(vec3(vUv * 2.5, vRnd * 9.0 + vAge * 3.0)))
                              : (1.0 - vUv.x * vUv.x) * (1.0 - vUv.y) * (1.0 - vUv.y);
    float a = shape * life * soft * (uStyle == 2 ? vCov : 1.0);
    if (a < 0.002) discard;
    vec3 c = toSrgb(tonemap(e)) * a;
    o = vec4(c + e * a * uLook.w * 0.15, 0.0);
  } else if (uStyle == 3) {
    // Air tracer: a thin ribbon with a brighter core, fading toward its tail.
    float ax = abs(vUv.x);
    float across = 1.0 - smoothstep(0.3, 1.0, ax);
    float core = 1.0 - smoothstep(0.0, 0.55, ax);
    float along = (1.0 - vUv.y) * (1.0 - 0.5 * vUv.y);
    float a = across * along * life * uFade.w * vCov;
    if (a < 0.003) discard;
    vec3 c = colorAt();
    o = vec4(mix(c, mix(c, vec3(1.0), 0.35), core) * a, a);
  } else {
    float edge = 1.0 - smoothstep(0.8, 1.0, sqrt(d2));
    float a = edge * life * uFade.w;
    if (a < 0.003) discard;
    if (uPRoom.x > 0.5) {
      a = min(1.0, a * (0.25 + 0.75 * vCov) * 1.0);
      // Dust in a beam: each mote scatters the light that reaches it (none in shadow), mostly
      // forward, so motes glitter when you look toward the light and vanish outside the beam.
      vec3 E = scatterAt(vCenter, normalize(uEye - vCenter), uPRoom.z, lds(uRoom.w + vRnd * 97.0, vec2(vRnd * 4096.0, 0.0))) * 4.0;
      vec3 c = toSrgb(tonemap(toLin(colorAt()) * E * uLook.z * (uPRoom.y > 0.5 ? 1.0 : 0.6)));
      if (uPRoom.y < 0.5) c = max(c, colorAt() * 0.5);
      float k = uPRoom.y > 0.5 ? clamp(max(c.r, max(c.g, c.b)) * 1.6, 0.0, 1.0) : 1.0;
      o = vec4(c * a * k, a * k);
      return;
    }
    o = vec4(colorAt() * a, a);
  }
}`;

  // Sphere particles are drawn with the solids: an exact ray-sphere hit per pixel, porcelain
  // shading, real depth, and a part id, so molecules get ink outlines and occlude properly.
  const FS_PSPHERE = `#version 300 es
${G_COMMON}
${G_SHADOW}
in vec2 vUv; in float vAge; in float vRnd; in vec3 vWorld; in vec3 vCenter; in float vSize; in vec3 vVel;
flat in int vAlive;
uniform vec3 uEye; uniform mat4 uViewProj; uniform vec3 uLight; uniform float uId; uniform float uOrthoCam; uniform vec3 uCamF;
uniform vec3 uColA; uniform vec3 uColB; uniform vec4 uColorBy; uniform float uPartShadow;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;
void main() {
  if (vAlive == 0) discard;
  vec3 ro = uOrthoCam > 0.5 ? vWorld - uCamF * 1e3 : uEye;
  vec3 rd = uOrthoCam > 0.5 ? uCamF : normalize(vWorld - uEye);
  vec3 oc = ro - vCenter;
  float b = dot(oc, rd), c = dot(oc, oc) - vSize * vSize, h = b * b - c;
  if (h < 0.0) discard;
  float t = -b - sqrt(h);
  vec3 P = ro + rd * t, N = normalize(P - vCenter), V = -rd;
  float tc = uColorBy.x > 1.5 ? clamp((length(vVel) - uColorBy.y) / max(uColorBy.z - uColorBy.y, 1e-6), 0.0, 1.0) : 0.0;
  vec3 base = mix(uColA, uColB, tc);
  float vis = mix(1.0, shadowAt(P, N), uPartShadow);
  float ndl = dot(N, uLight);
  float wrap = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
  wrap = wrap * wrap * (3.0 - 2.0 * wrap);
  vec3 col = mix(base * vec3(0.84, 0.86, 0.90), base, wrap * vis);
  col *= 0.92 + 0.08 * (0.5 + 0.5 * N.y);
  col += vec3(pow(max(dot(N, normalize(uLight + V)), 0.0), 40.0) * 0.08) * vis;
  col = mix(col, vec3(1.0), pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0) * 0.1);
  vec4 clip = uViewProj * vec4(P, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
  oColor = vec4(col, 1.0);
  oNormal = vec4(N * 0.5 + 0.5, uId);
}`;

  // The plume: march the view ray through a cylinder around the jet, stopping at the first
  // solid (read from the depth buffer), adding emission and absorbing along the way.
  const FS_PLUME = `#version 300 es
${G_COMMON}
in vec3 vWorld;
uniform mat4 uInvModel; uniform vec3 uEye; uniform mat4 uView; uniform vec3 uCamF;
uniform sampler2D uDepth; uniform vec2 uDepthScale;
uniform vec4 uP0; uniform vec4 uP1; uniform vec4 uP2; uniform vec4 uP3; uniform vec4 uP4; uniform vec4 uLook;
uniform vec4 uProf[24]; uniform vec4 uCut;
out vec4 o;
// uP0: exit radius, length, bound radius, time. uP1: throttle, cell length, core T, steps.
// uP2: spread, turbulence, intensity, fuel. uP3: world-to-local scale, flow speed, expansion, _.
// uP4: distance to the surface the jet hits (0 = none), splash radius, inner-flame stations, _.
// uProf: inner flame stations (radius, distance from the origin, temperature).
float fbm(vec3 x) { return 0.55 * vnoise(x) + 0.3 * vnoise(x * 2.03 + 17.0) + 0.15 * vnoise(x * 4.1 + 41.0); }
// Emission by temperature, normalized so 2500 K gives 1 and compressed so the cooler tail
// of the plume still shows instead of the exit alone blowing out.
vec3 emitAt(float T) { return blackbody(T) * pow(glowOf(T) / 35.5, 0.6); }
// Radius and temperature of the inner flame at distance s from its origin (-1 past the end).
float profAt(float s, out float T) {
  int n = int(uP4.z + 0.5);
  vec4 a = uProf[0];
  T = a.z;
  if (s <= a.y) return a.x;
  for (int i = 1; i < 24; i++) {
    if (i >= n) break;
    vec4 b = uProf[i];
    if (s <= b.y) { float f = (s - a.y) / max(b.y - a.y, 1e-6); T = mix(a.z, b.z, f); return mix(a.x, b.x, f); }
    a = b;
  }
  T = a.z;
  return -1.0;
}
// The burning gas inside a chamber and nozzle: it fills the duct to its wall, hottest in the
// middle, cooling as it expands; seen through a section cut.
vec3 flameField(vec3 q, out float sigma) {
  float s = -q.y, r = length(q.xz), T;
  float R = profAt(s, T);
  sigma = 0.0;
  if (R <= 0.0) return vec3(0.0);
  vec3 nq = vec3(q.x, q.y + uP0.w * uP3.y, q.z) / max(uP0.x, 1e-6) * 1.8;
  float n = uP2.y > 0.0 ? fbm(nq) : 0.5;
  float rr = r / max(R, 1e-6);
  float body = smoothstep(1.0, 0.86, rr + 0.1 * (n - 0.5));
  float Tl = T * (1.0 - 0.22 * rr * rr) * (0.93 + 0.14 * n);
  sigma = body * 0.04;
  return emitAt(Tl) * body * uP2.z * uP1.x * 0.3;
}
vec3 field(vec3 q, out float sigma) {
  float r0 = uP0.x, L = uP0.y, lam = uP1.y, thr = uP1.x, ex = uP3.z;
  float s = -q.y, r = length(q.xz);
  float imp = uP4.x;
  sigma = 0.0;
  if (imp > 0.0 && s > imp) return vec3(0.0);
  // A jet that hits a surface keeps its strength down to it.
  if (imp > 0.0) L = max(L, imp * 1.5);
  // Mean radius: the spreading jet, pushed out (under-expanded) or necked in
  // (over-expanded) by the exit pressure, settling back over a few cells.
  float R = r0 * (1.0 + uP2.x * s / r0);
  R *= 1.0 + 0.4 * (ex - 1.0) * smoothstep(0.0, lam * 0.6, s) * exp(-s / (lam * 3.0));
  // Near the surface the jet slows and bulges (the stagnation bubble).
  float nearImp = imp > 0.0 ? smoothstep(imp - 2.5 * r0, imp, s) : 0.0;
  R *= 1.0 + 1.4 * nearImp * nearImp;
  float cells = s / lam;
  float ripple = 0.1 + 0.22 * min(abs(ex - 1.0), 1.0);
  R *= 1.0 - ripple * (0.5 + 0.5 * cos(6.2831853 * cells)) * exp(-s / (lam * 4.0));
  // The mixing layer: eddies grow with distance and the layer thickens.
  float grow = 1.0 + 0.6 * s / L;
  float turb = uP2.y * smoothstep(0.0, lam * 1.5, s) * (0.6 + 0.4 * s / L);
  vec3 nq = vec3(q.x, q.y + uP0.w * uP3.y, q.z) / (r0 * grow) * 1.4;
  float n = turb > 0.001 ? fbm(nq) : 0.0;
  float rr = r / R + turb * n * 0.45;
  float body = smoothstep(1.08, 0.5, rr) * smoothstep(0.0, 0.08 * r0, s);
  float fade = 1.0 - smoothstep(0.55 * L, L, s);
  float T = uP1.z * (0.62 + 0.38 * exp(-s / (L * 0.5))) * (1.0 - 0.3 * smoothstep(0.35, 1.0, rr));
  // Shock diamonds: strong when the exit pressure is off ambient, faint when matched.
  float diaGain = clamp(0.3 + 1.4 * abs(ex - 1.0), 0.3, 1.0);
  // Only the two cells nearest this point can contribute (each is a narrow Gaussian).
  float dia = 0.0, rr2 = pow(r / (0.38 * R), 2.0);
  float kc = floor(s / lam - 0.62);
  for (int j = 0; j < 2; j++) {
    float k = kc + float(j);
    if (k < 0.0 || k > 6.0) continue;
    float dk = (s - (k + 0.62) * lam) / (0.14 * lam);
    dia += exp(-dk * dk - rr2) * pow(0.74, k);
  }
  dia *= diaGain;
  float coreLen = lam * 0.85;
  float core = s < coreLen ? exp(-pow(r / (0.8 * r0 * (1.0 - s / coreLen) + 1e-3), 2.0)) : 0.0;
  int fuel = int(uP2.w + 0.5);
  vec3 bb = emitAt(T);
  vec3 tint = fuel == 1 ? vec3(0.55, 0.62, 1.0) : fuel == 2 ? vec3(0.75, 0.62, 1.0) : vec3(1.0);
  float bodyGain = fuel == 2 ? 0.1 : fuel == 1 ? 0.4 : 1.0;
  vec3 e = bb * body * fade * bodyGain * mix(vec3(1.0), tint, 0.6);
  vec3 hot = emitAt(T * 1.25);
  e += hot * dia * (fuel == 2 ? 1.2 : 0.8) * fade * mix(vec3(1.0), tint, 0.5);
  e += hot * core * 1.2 * mix(vec3(1.0), tint, 0.7);
  // Afterburning: fuel-rich exhaust meets air in the shear layer and burns as a slightly
  // wider, cooler, ragged orange sheath that starts a cell or so downstream.
  float R2 = R * 1.3 * (1.0 + 0.6 * s / L);
  float n3 = turb > 0.001 ? fbm(nq * 0.6 + vec3(7.0, 0.0, 3.0)) : 0.0;
  float sheath = smoothstep(1.2, 0.55, r / R2 + 0.6 * n3) * (1.0 - body) * smoothstep(lam * 0.9, lam * 2.5, s) * fade;
  float Ta = 1600.0 + 250.0 * n3;
  float abGain = fuel == 3 ? 1.1 : fuel == 1 ? 0.45 : fuel == 2 ? 0.1 : 0.85;
  e += emitAt(Ta) * sheath * abGain * 0.35;
  // Soot: kerosene and solid exhaust absorb; hydrogen and methane are nearly clear.
  float soot = fuel == 0 ? 0.35 : fuel == 3 ? 0.8 : 0.08;
  sigma = (body * soot + sheath * soot * 0.5) * fade * (0.6 + 0.4 * smoothstep(0.3 * L, L, s));
  // Splash: the flow turns along the surface as a hot, thin, ragged sheet that cools outward.
  if (imp > 0.0) {
    float above = imp - s, Rs = uP4.y;
    float n4 = turb > 0.001 ? fbm(vec3(q.x, q.z, uP0.w * uP3.y * 0.6) / r0 * 0.9) : 0.5;
    float hs = r0 * (0.35 + 0.5 * smoothstep(0.0, Rs, r));
    float sheet = exp(-pow(above / max(hs, 1e-3), 2.0)) * (1.0 - smoothstep(Rs * (0.55 + 0.45 * n4), Rs, r)) * step(0.0, above);
    float Ts = 2100.0 - 900.0 * smoothstep(0.0, Rs, r) + 200.0 * n4;
    e += emitAt(Ts) * sheet * (fuel == 2 ? 0.25 : 1.0) * 0.6 / max(uP2.z * thr * 0.55, 1e-4) * thr;
    sigma += sheet * soot * 0.9;
  }
  return e * uP2.z * thr * 0.55;
}
void main() {
  vec3 rdw = normalize(vWorld - uEye);
  vec3 eye = uEye;
  if (uOrtho > 0.5) { rdw = uCamF; eye = vWorld - rdw * dot(vWorld - uEye, rdw); }
  vec3 ro = (uInvModel * vec4(eye, 1.0)).xyz;
  vec3 rd = mat3(uInvModel) * rdw;
  float Rb = uP0.z, L = uP0.y;
  float a = dot(rd.xz, rd.xz), b = 2.0 * dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - Rb * Rb;
  float t0 = -1e9, t1 = 1e9;
  if (a > 1e-9) {
    float disc = b * b - 4.0 * a * c;
    if (disc < 0.0) discard;
    float sq = sqrt(disc);
    t0 = (-b - sq) / (2.0 * a); t1 = (-b + sq) / (2.0 * a);
  } else if (c > 0.0) discard;
  if (abs(rd.y) > 1e-9) {
    float ya = (0.0 - ro.y) / rd.y, yb = (-L - ro.y) / rd.y;
    t0 = max(t0, min(ya, yb)); t1 = min(t1, max(ya, yb));
  } else if (ro.y > 0.0 || ro.y < -L) discard;
  t0 = max(t0, 0.0);
  float sceneZ = linDepth(texture(uDepth, gl_FragCoord.xy * uDepthScale).r);
  float dz = uOrtho > 0.5 ? 1.0 : dot(rdw, uCamF);
  float tScene = uOrtho > 0.5 ? sceneZ - dot(eye - uEye, uCamF) : sceneZ / max(dz, 1e-4);
  t1 = min(t1, tScene);
  if (t1 <= t0) discard;
  int steps = int(uP1.w);
  float dt = (t1 - t0) / float(steps);
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 E = vec3(0.0); float Tr = 1.0;
  float scale = uP3.x;
  // Low-frequency flicker of the whole flame, from the time alone (deterministic).
  float flick = 1.0 + 0.08 * vnoise1(uP0.w * 14.0) + 0.04 * vnoise1(uP0.w * 37.0 + 5.0);
  for (int i = 0; i < 96; i++) {
    if (i >= steps || Tr < 0.01) break;
    float t = t0 + (float(i) + jit) * dt;
    vec3 q = ro + rd * t;
    if (length(q.xz) > Rb) continue;
    if (dot(uCut.xyz, eye + rdw * t) > uCut.w) continue;
    float sig;
    vec3 e = uP4.z > 0.5 ? flameField(q, sig) : field(q, sig);
    float ds = dt * scale / uP0.x;
    E += Tr * e * flick * ds;
    Tr *= exp(-sig * ds);
  }
  float alpha = 1.0 - Tr;
  vec3 col = toSrgb(tonemap(E * uLook.z));
  o = vec4(col + E * uLook.w * 0.12, alpha);
}`;

  // ---------- volumetric media (smoke, dust, steam, fire) ----------
  // A particle system with `volume` set is drawn as a continuous medium instead of sprites.
  // Each frame its particles are splatted into a 3D grid (R: density, G: hot density), a
  // second grid stores how much key light reaches each cell, and the view ray is marched
  // through the grid at part resolution: billowy detail noise erodes the edges, light
  // scatters toward the eye with a two-lobed phase, flames light it with falloff and
  // occlusion, young soot glows by black-body color, and a depth-aware upsample puts the
  // result in the effects layer without halos around solid parts.
  const VS_VSPLAT = `#version 300 es
${G_COMMON}
${G_SLOT}
layout(location=0) in vec4 aP; layout(location=1) in vec4 aV;
uniform vec4 uTime; uniform vec4 uSize; uniform vec4 uFade; uniform vec3 uVolMin; uniform vec3 uDims;
uniform float uVoxel; uniform float uSlice; uniform float uPtMax; uniform vec4 uVHeat;
out float vRv; out float vDz; out float vPs; out float vW; out float vHot;
// uFade: fade in, fade out, mass scale (count / drawn), density. uVHeat: glow, hot share of life, thinning, _.
void main() {
  int i = gl_VertexID;
  float k, age;
  slotAt(i, uTime.x, uLife.y, k, age);
  float life = lifeOf(i, k);
  float r = rnd(i, k, 7u);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0;
  vRv = 1.0; vDz = 0.0; vPs = 1.0; vW = 0.0; vHot = 0.0;
  if (aP.w != k || age < 0.0 || age > life || r > uTime.w) return;
  float dtR = uTime.y - uTime.x;
  vec3 p = aP.xyz + aV.xyz * dtR;
  age += dtR;
  float t01 = uLife.y <= 0.0 ? 0.0 : clamp(age / life, 0.0, 1.0);
  float size = mix(uSize.x, uSize.y, sqrt(t01)) * (1.0 + uSize.z * (rnd(i, k, 8u) - 0.5));
  vec3 g = (p - uVolMin) / uVoxel;
  float rv = max(size * 0.5 / uVoxel, 0.8);
  float dz = g.z - (uSlice + 0.5);
  if (abs(dz) >= rv) return;
  float rc = sqrt(rv * rv - dz * dz);
  float ps = min(2.0 * rc + 2.0, uPtMax);
  float fade = smoothstep(0.0, max(uFade.x, 1e-4), t01) * (1.0 - smoothstep(1.0 - max(uFade.y, 1e-4), 1.0, t01));
  // A puff thins as it grows (the same smoke spread over more volume); each is a little denser or thinner.
  float grow = uSize.x / max(size, 1e-6);
  vW = uFade.w * uFade.z * fade * mix(0.5, 1.5, rnd(i, k, 9u)) * pow(grow, uVHeat.z);
  vHot = uVHeat.x * (1.0 - smoothstep(0.0, max(uVHeat.y, 1e-3), t01));
  vRv = rv; vDz = dz; vPs = ps;
  gl_Position = vec4(g.xy / uDims.xy * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = ps;
}`;
  const FS_VSPLAT = `#version 300 es
precision highp float;
in float vRv; in float vDz; in float vPs; in float vW; in float vHot;
out vec4 o;
void main() {
  vec2 off = (gl_PointCoord * 2.0 - 1.0) * (vPs * 0.5);
  float q = 1.0 - (dot(off, off) + vDz * vDz) / (vRv * vRv);
  if (q <= 0.0) discard;
  float w = vW * q * q;
  o = vec4(w, w * vHot, 0.0, 0.0);
}`;
  // Key light reaching each cell: march toward the light through the coarse density.
  const FS_VLIGHT = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D uDens;
uniform vec3 uLDims; uniform float uSlice; uniform vec3 uLDelta; uniform float uSigmaStep; uniform int uLSteps;
uniform vec4 uPt0; uniform vec4 uPt1; uniform float uSigma; // point lights in grid coordinates (w > 0: on)
out vec4 o;
float march(vec3 p, vec3 d, int n, float sig) {
  float tau = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    if (any(lessThan(p, vec3(0.0))) || any(greaterThan(p, vec3(1.0)))) break;
    tau += (1.0 - exp(-1.5 * textureLod(uDens, p, 1.0).r)) * sig;
    p += d;
  }
  return exp(-tau);
}
// R: key light reaching the cell; G, B: the share of each point light (a flame) that does.
// The point lights are marched in 12 steps straight to the light, so a cell behind smoke darkens.
float toPoint(vec3 p, vec4 L) {
  if (L.w <= 0.0) return 1.0;
  vec3 d = (L.xyz - p) / 12.0;
  return march(p + d * 0.5, d, 12, uSigma * L.w / 12.0);
}
void main() {
  vec3 p = vec3(gl_FragCoord.xy, uSlice + 0.5) / uLDims;
  o = vec4(march(p + uLDelta * 0.5, uLDelta, uLSteps, uSigmaStep), toPoint(p, uPt0), toPoint(p, uPt1), 1.0);
}`;
  const FS_VMARCH = `#version 300 es
${G_COMMON}
${G_ENV}
precision highp sampler3D;
uniform sampler3D uDens; uniform sampler3D uLightVol; uniform sampler3D uNoise;
uniform sampler2D uDepth; uniform vec2 uDepthMap;
uniform mat4 uInvVP; uniform vec3 uEye; uniform vec3 uCamF; uniform vec2 uVSize;
uniform vec3 uVolMin; uniform vec3 uVolSize; uniform float uVoxel;
uniform vec2 uSlabZ; uniform int uSteps; uniform vec4 uCut;
uniform vec4 uMed;    // extinction at full coverage (per world unit), erosion, detail frequency, ambient occlusion
uniform vec4 uMed2;   // shadow strength, powder, flame occlusion, emission-only (fire)
uniform vec3 uFlow; uniform vec3 uFlow2; uniform vec3 uAlbedo;
uniform vec3 uLight; uniform vec3 uKeyCol; uniform vec4 uPtPos[2]; uniform vec3 uPtCol[2]; uniform vec4 uLook;
uniform vec4 uHeatT;  // hot temperature, cool temperature, intensity, glow
out vec4 o;
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5); }
float cover(float d) { return 1.0 - exp(-1.5 * d); }
void main() {
  vec2 ndc = gl_FragCoord.xy / uVSize * 2.0 - 1.0;
  vec4 a = uInvVP * vec4(ndc, -1.0, 1.0), b = uInvVP * vec4(ndc, 1.0, 1.0);
  vec3 pn = a.xyz / a.w, pf = b.xyz / b.w;
  vec3 ro, rd; float zPerT, z0;
  if (uOrtho > 0.5) { ro = pn; rd = normalize(pf - pn); zPerT = 1.0; z0 = dot(pn - uEye, uCamF); }
  else { ro = uEye; rd = normalize(pf - uEye); zPerT = max(dot(rd, uCamF), 1e-4); z0 = 0.0; }
  vec3 inv = 1.0 / (abs(rd) + 1e-9) * sign(rd + 1e-12);
  vec3 ta = (uVolMin - ro) * inv, tb = (uVolMin + uVolSize - ro) * inv;
  vec3 tmn = min(ta, tb), tmx = max(ta, tb);
  float t0 = max(max(tmn.x, tmn.y), tmn.z), t1 = min(min(tmx.x, tmx.y), tmx.z);
  float sceneZ = linDepth(texture(uDepth, gl_FragCoord.xy * uDepthMap).r);
  t0 = max(t0, max((uSlabZ.x - z0) / zPerT, 0.0));
  t1 = min(t1, min((sceneZ - z0) / zPerT, (uSlabZ.y - z0) / zPerT));
  if (t1 <= t0) { o = vec4(0.0); return; }
  float ds = max((t1 - t0) / float(uSteps), uVoxel * 0.45);
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float Tr = 1.0; vec3 C = vec3(0.0), Ce = vec3(0.0);
  float cosT = dot(rd, uLight);
  float phase = mix(hg(cosT, -0.25), hg(cosT, 0.6), 0.6);
  vec3 envUp = envDiff(vec3(0.0, 1.0, 0.0)) * uLook.x, envDn = envDiff(vec3(0.0, -1.0, 0.0)) * uLook.x;
  float t = t0 + jit * ds;
  for (int i = 0; i < 192; i++) {
    if (t > t1 || Tr < 0.01) break;
    vec3 p = ro + rd * t;
    float tNow = t;
    t += ds;
    if (dot(uCut.xyz, p) > uCut.w) continue;
    vec3 uvw = (p - uVolMin) / uVolSize;
    // Level 0 always: at the box's silhouette neighboring rays enter far apart, the screen-space
    // derivatives jump, and an automatic level would read the whole grid's average as a seam.
    vec2 dh = textureLod(uDens, uvw, 0.0).rg;
    // Empty space: if the coarse grid is empty here too, stride ahead three steps.
    if (dh.r < 0.003) { if (textureLod(uDens, uvw, 2.0).r < 0.002) t += 2.0 * ds; continue; }
    float cov = cover(dh.r);
    // Detail: billows eat into the thin edges, much less into the dense core.
    float nz = textureLod(uNoise, p * uMed.z + uFlow, 0.0).r * 0.62 + textureLod(uNoise, p * (uMed.z * 2.71) + uFlow2, 0.0).r * 0.38;
    float e = uMed.y * (1.0 - 0.7 * cov);
    float d = clamp((cov - (1.0 - nz) * e) / max(1.0 - (1.0 - nz) * e, 1e-3), 0.0, 1.0);
    float sigma = d * uMed.x;
    if (sigma <= 0.0) continue;
    float heat = clamp(dh.g / max(dh.r, 1e-4), 0.0, 1.0);
    float T = mix(uHeatT.y, uHeatT.x, heat);
    vec3 em = blackbody(T) * glowOf(T) * uHeatT.z * uHeatT.w * heat * (0.55 + 0.45 * nz);
    vec3 S = vec3(0.0);
    if (uMed2.w < 0.5) {
      // Single scattering plus a cheap multiple-scattering term, so thick smoke isn't black inside.
      vec4 lv = textureLod(uLightVol, uvw, 0.0);
      float tl = lv.r;
      float sh = mix(1.0, max(tl, pow(tl, 0.25) * 0.55), uMed2.x);
      float ao = exp(-textureLod(uDens, uvw, 2.0).r * uMed.w);
      float powder = mix(1.0, 1.0 - exp(-5.0 * d), uMed2.y);
      vec3 Ld = uKeyCol * sh * phase * powder / PI;
      vec3 La = mix(envDn * 0.5, envUp, clamp(0.3 + 0.7 * uvw.y, 0.0, 1.0)) * ao;
      vec3 Lp = vec3(0.0);
      for (int j = 0; j < 2; j++) {
        if (uPtPos[j].w <= 0.0) continue;
        vec3 dv = uPtPos[j].xyz - p;
        float d2 = dot(dv, dv), rr = uPtPos[j].w * uPtPos[j].w;
        float att = rr / (rr + d2); att *= att;
        float tp = j == 0 ? lv.g : lv.b;
        float occ = max(tp, pow(tp, 0.25) * 0.5);
        Lp += uPtCol[j] * att * occ * (0.35 + 0.65 * ao) * 1.5 / PI;
      }
      S = uAlbedo * (Ld + La + Lp);
    }
    float tr = exp(-sigma * ds), w = Tr * (1.0 - tr);
    C += w * (S + em);
    Ce += w * em;
    Tr *= tr;
  }
  float alpha = 1.0 - Tr;
  if (alpha < 0.002) { o = vec4(0.0); return; }
  vec3 col = toSrgb(tonemap(C / alpha * uLook.z)) * alpha;
  o = vec4(col + Ce * uLook.w * 0.15, alpha);
}`;
  // Depth-aware upsample of a part-resolution effect into the effects layer.
  const FS_VUP = `#version 300 es
${G_COMMON}
uniform sampler2D uV; uniform sampler2D uDepth; uniform vec2 uDepthScale; uniform vec2 uRatio; uniform vec2 uVMax;
out vec4 o;
void main() {
  vec2 hp = gl_FragCoord.xy * uRatio - 0.5;
  vec2 b = floor(hp), f = hp - b;
  float zc = linDepth(texture(uDepth, gl_FragCoord.xy * uDepthScale).r);
  vec4 acc = vec4(0.0), best = vec4(0.0);
  float wsum = 0.0, bestD = 1e30;
  for (int j = 0; j < 4; j++) {
    vec2 o2 = vec2(float(j & 1), float(j >> 1));
    vec2 ti = clamp(b + o2, vec2(0.0), uVMax);
    float zt = linDepth(texture(uDepth, (ti + 0.5) / uRatio * uDepthScale).r);
    float bw = (o2.x > 0.5 ? f.x : 1.0 - f.x) * (o2.y > 0.5 ? f.y : 1.0 - f.y);
    float dz = abs(zc - zt) / max(zc, 1e-4);
    float w = bw * exp(-dz * 50.0) + 1e-6;
    vec4 s = texelFetch(uV, ivec2(ti), 0);
    acc += s * w; wsum += w;
    if (dz < bestD) { bestD = dz; best = s; }
  }
  o = wsum > 1e-3 ? acc / wsum : best;
}`;


  // ---------- light transport ----------
  // Lights with a shape and a power (watts) light the scene the way real ones do: brightness
  // falls off with the square of the distance and the cosine of the angle, shadows soften as a
  // light grows and harden as it shrinks, and light bounces between surfaces. Shadows, bounces,
  // sky occlusion, and light shafts are traced against the scene's triangles (a BVH).
  const unitsOf = u => (typeof u === "number" && u > 0 ? u : UNITS[u] ?? 1);
  const LIGHT_TYPE = { point: 0, sphere: 1, disk: 2, rect: 3, sun: 4 };
  // The old { position, color, intensity, range } lights stay the studio's soft point lights; a
  // light is physical once it says what it is (type) or how strong it is (power).
  const isPhysical = p => !!p && (p.type != null || p.power != null);
  // Half-axes of a disk or rect: U x V points the way it shines. Default: facing down.
  function lightAxes(p) {
    let U = [1, 0, 0], V = [0, 0, 1];
    const n = p.normal ?? (p.target ? v3.sub(p.target, p.position ?? [0, 0, 0]) : null);
    if (p.rotation) { const M = m4.compose([0, 0, 0], p.rotation, 1); U = v3.norm(m4.applyDir(M, U)); V = v3.norm(m4.applyDir(M, V)); }
    else if (n) {
      const nn = v3.norm(n), t = Math.abs(nn[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
      U = v3.norm(v3.cross(t, nn)); V = v3.cross(nn, U);
    }
    return [U, V];
  }
  // The sunlight that gets through the air at this elevation, as a color (relative to space).
  function sunTransmittance(dir, haze = 1) {
    const RE = 6360e3, RA = 6460e3, o = [0, RE + 2, 0], d = v3.norm(dir);
    const b = v3.dot(o, d), c = v3.dot(o, o) - RA * RA, tmax = -b + Math.sqrt(Math.max(0, b * b - c));
    const cg = v3.dot(o, o) - RE * RE, hg = b * b - cg;
    if (hg > 0 && -b - Math.sqrt(hg) > 0) return [0, 0, 0];
    const od = [0, 0, 0], N = 48, ds = tmax / N;
    for (let i = 0; i < N; i++) {
      const pnt = v3.add(o, v3.scale(d, ds * (i + 0.5))), h = v3.len(pnt) - RE;
      const r = Math.exp(-h / 8000), m = Math.exp(-h / 1200) * 4.4e-6 * haze, oz = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
      const br = [5.802e-6, 13.558e-6, 33.1e-6], bo = [0.65e-6, 1.881e-6, 0.085e-6];
      for (let k = 0; k < 3; k++) od[k] += (br[k] * r + m + bo[k] * oz) * ds;
    }
    return od.map(v => Math.exp(-v));
  }
  // scene.sky: true, or { sun: [x, y, z] or { elevation, azimuth } in degrees, haze, intensity,
  // altitude, stars } for the physical sky, or { color, intensity } for light coming evenly from
  // every direction (a white sky, an overcast day, the inside of a lamp shade).
  function skyOf(scene) {
    const s = scene.sky;
    if (!s) return null;
    const o = s === true ? {} : s;
    if (o.color != null && o.sun == null) return { kind: 1, rgb: toLinear(colorOf(o.color, true)).map(v => v * (o.intensity ?? 1)), o };
    let sun = o.sun ?? (Array.isArray(scene.light) ? scene.light : [0.3, 0.6, 0.5]);
    if (!Array.isArray(sun)) {
      const el = (sun.elevation ?? 30) * Math.PI / 180, az = (sun.azimuth ?? 0) * Math.PI / 180;
      sun = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
    }
    sun = v3.norm(sun);
    return { kind: 2, sun, haze: o.haze ?? 1, intensity: o.intensity ?? 1, altitude: o.altitude ?? 2, stars: o.stars ?? 1, o };
  }
  function lightRig(scene, addSun = false) {
    const units = unitsOf(scene.units);
    const list = (scene.lights || []).filter(p => isPhysical(p) && p.on !== false).map(p => {
      const type = p.type ?? (p.size ? "rect" : p.radius ? "sphere" : "point");
      // The color sets how the power splits across red, green, and blue; the power stays the power.
      const c0 = toLinear(colorOf(p.color ?? "#ffffff", true));
      const mean = (c0[0] + c0[1] + c0[2]) / 3 || 1;
      const col = c0.map(v => v / mean);
      const P = p.power ?? 100, R = p.radius ?? 0, pos = p.position ?? [0, 0, 0], two = !!p.twoSided;
      let U = [0, 0, 0], V = [0, 0, 0], rad, t = LIGHT_TYPE[type] ?? 0, area = 0;
      if (t === 1 && !(R > 0)) t = 0;
      if (t === 0) rad = P / (4 * Math.PI);
      else if (t === 1) { const Rm = R / units; rad = P / (4 * Math.PI * Math.PI * Rm * Rm); }
      else if (t === 4) rad = P;
      else {
        const [Uh, Vh] = lightAxes(p);
        const sz = t === 2 ? [R * 2, R * 2] : Array.isArray(p.size) ? p.size : [p.size ?? 1, p.size ?? 1];
        U = v3.scale(Uh, sz[0] / 2); V = v3.scale(Vh, sz[1] / 2);
        area = (t === 2 ? Math.PI / 4 : 1) * sz[0] * sz[1];
        rad = P / (Math.PI * area / (units * units)) / (two ? 2 : 1);
      }
      const dir = t === 4 ? v3.norm(p.direction ?? p.position ?? [0, 1, 0]) : null;
      return { p, t, position: dir ?? pos, radius: t === 4 ? (p.angle ?? 0.0047) : R, U, V, two, rgb: col.map(v => v * rad), radiance: rad, color: col, area };
    });
    const sky = skyOf(scene);
    // A physical sky brings its Sun: a disc half a degree across, as bright as the air lets it be.
    if (addSun && sky && sky.kind === 2 && sky.sun[1] > -0.02 && scene.sky.sunLight !== false && list.length < 8) {
      const tr = sunTransmittance(sky.sun, sky.haze), E = 3.2 * sky.intensity;
      list.push({ p: { visible: false }, t: 4, position: sky.sun, radius: 0.0047, U: [0, 0, 0], V: [0, 0, 0], two: false, rgb: tr.map(v => v * E), radiance: E, color: tr, area: 0, sun: true });
    }
    return list.slice(0, 8);
  }
  // Meshes that show each light (a glowing ball, disk, or panel), rebuilt when the light moves.
  function lightItems(rig, bounds) {
    const out = [];
    for (const L of rig) {
      const p = L.p;
      if (p.visible === false || L.t === 4 || (L.t === 0 && !p.visible)) continue;
      const key = [L.t, L.position, L.radius, L.U, L.V, p.size, p.visible].flat().join(",");
      if (!p._show || p._show.key !== key) {
        let m;
        if (L.t <= 1) m = transformMesh(mesh.sphere(L.t === 1 ? L.radius : (typeof p.visible === "number" ? p.visible : (bounds?.radius ?? 1) * 0.012), { segments: 24 }), m4.translation(L.position));
        else {
          const pts = [], seg = L.t === 2 ? 48 : 4;
          for (let i = 0; i < seg; i++) {
            const a = L.t === 2 ? (i / seg) * Math.PI * 2 : (i + 0.5) * Math.PI / 2;
            const ca = L.t === 2 ? Math.cos(a) : Math.sign(Math.cos(a)), sa = L.t === 2 ? Math.sin(a) : Math.sign(Math.sin(a));
            pts.push(v3.add(L.position, v3.add(v3.scale(L.U, ca), v3.scale(L.V, sa))));
          }
          const P = [...L.position, ...pts.flat()], I = [];
          for (let i = 0; i < seg; i++) I.push(0, 1 + i, 1 + ((i + 1) % seg));
          const n = v3.norm(v3.cross(L.U, L.V)), N = [];
          for (let i = 0; i <= seg; i++) N.push(...n);
          m = makeMesh(new Float32Array(P), new Float32Array(N), new Uint32Array(I));
        }
        p._show = { key, node: new Node(m, { name: p.name ?? "light", castShadow: false, trace: false, cut: false, twoSided: true, pickable: p.pickable ?? true }) };
      }
      const node = p._show.node;
      node._light = L.rgb;
      node.light = p;
      const b = node.mesh.bounds;
      out.push({ node, world: m4.identity(), center: b.center, radius: b.radius });
    }
    return out;
  }

  // The scene's triangles in world space, in a bounding volume hierarchy (binned surface area
  // heuristic, at most 16 triangles a leaf), kept on the scene until something moves.
  const meshIds = new WeakMap();
  let meshSeq = 0;
  const meshId = m => { let i = meshIds.get(m); if (!i) meshIds.set(m, (i = ++meshSeq)); return i; };
  // The split itself: a binned surface area heuristic over nt triangles given their bounds (lo,
  // hi) and centroids, at most 16 triangles a leaf. It names nothing outside itself, so the pick
  // worker can run it from its source.
  function bvhSplit(lo, hi, cen, nt) {
    const idx = new Uint32Array(nt);
    for (let i = 0; i < nt; i++) idx[i] = i;
    const nodes = new Float32Array(Math.max(2, 2 * nt) * 8);
    let count = 1;
    const box = (s, e, arr0, arr1) => {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = s; i < e; i++) { const j = idx[i] * 3; for (let d = 0; d < 3; d++) { if (arr0[j + d] < mn[d]) mn[d] = arr0[j + d]; if (arr1[j + d] > mx[d]) mx[d] = arr1[j + d]; } }
      return [mn, mx];
    };
    const area = (mn, mx) => { const x = mx[0] - mn[0], y = mx[1] - mn[1], z = mx[2] - mn[2]; return x > -1 ? 2 * (x * y + y * z + z * x) : 0; };
    const stack = nt ? [[0, 0, nt]] : [];
    if (!nt) nodes.set([0, 0, 0, 0, 0, 0, 0, 0]);
    const BINS = 12;
    while (stack.length) {
      const [ni, s, e] = stack.pop();
      const [mn, mx] = box(s, e, lo, hi);
      nodes.set([mn[0], mn[1], mn[2], s, mx[0], mx[1], mx[2], e - s], ni * 8);
      const n = e - s;
      if (n <= 2) continue;
      const [cmn, cmx] = box(s, e, cen, cen);
      let axis = 0;
      for (let d = 1; d < 3; d++) if (cmx[d] - cmn[d] > cmx[axis] - cmn[axis]) axis = d;
      const ext = cmx[axis] - cmn[axis];
      let mid = -1;
      if (ext > 1e-12) {
        const cnt = new Array(BINS).fill(0), bmn = [], bmx = [];
        for (let b = 0; b < BINS; b++) { bmn.push([Infinity, Infinity, Infinity]); bmx.push([-Infinity, -Infinity, -Infinity]); }
        const binOf = j => Math.min(BINS - 1, Math.floor(((cen[j * 3 + axis] - cmn[axis]) / ext) * BINS));
        for (let i = s; i < e; i++) {
          const j = idx[i], b = binOf(j);
          cnt[b]++;
          for (let d = 0; d < 3; d++) { bmn[b][d] = Math.min(bmn[b][d], lo[j * 3 + d]); bmx[b][d] = Math.max(bmx[b][d], hi[j * 3 + d]); }
        }
        let best = Infinity, split = -1;
        for (let k = 1; k < BINS; k++) {
          const a0 = [Infinity, Infinity, Infinity], a1 = [-Infinity, -Infinity, -Infinity], b0 = [Infinity, Infinity, Infinity], b1 = [-Infinity, -Infinity, -Infinity];
          let nl = 0, nr = 0;
          for (let b = 0; b < BINS; b++) {
            const L = b < k, t0 = L ? a0 : b0, t1 = L ? a1 : b1;
            if (!cnt[b]) continue;
            if (L) nl += cnt[b]; else nr += cnt[b];
            for (let d = 0; d < 3; d++) { t0[d] = Math.min(t0[d], bmn[b][d]); t1[d] = Math.max(t1[d], bmx[b][d]); }
          }
          if (!nl || !nr) continue;
          const cost = nl * area(a0, a1) + nr * area(b0, b1);
          if (cost < best) { best = cost; split = k; }
        }
        const leafCost = n * area(mn, mx);
        if (split > 0 && (best < leafCost || n > 16)) {
          let i = s, j = e - 1;
          while (i <= j) { if (binOf(idx[i]) < split) i++; else { const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; j--; } }
          mid = i;
        } else if (n <= 16) continue;
      } else if (n <= 16) continue;
      if (mid <= s || mid >= e) mid = (s + e) >> 1;
      const l = count;
      count += 2;
      nodes[ni * 8 + 3] = l; nodes[ni * 8 + 7] = 0;
      stack.push([l, s, mid], [l + 1, mid, e]);
    }
    return { idx, nodes, count };
  }
  function buildBVH(list, matOf) {
    let nt = 0;
    for (const it of list) nt += it.node.mesh.indices.length / 3;
    const V0 = new Float32Array(nt * 3), E1 = new Float32Array(nt * 3), E2 = new Float32Array(nt * 3);
    const lo = new Float32Array(nt * 3), hi = new Float32Array(nt * 3), cen = new Float32Array(nt * 3);
    const matI = new Int32Array(nt), cutF = new Uint8Array(nt), itemI = new Int32Array(nt), mats = [];
    let t = 0;
    list.forEach((it, ii) => {
      const m = matOf(it), alb = toLinear(m.rgb), Wm = it.world, P = it.node.mesh.positions, I = it.node.mesh.indices;
      mats.push(alb[0], alb[1], alb[2], m.metal || 0);
      const wp = new Float32Array(P.length);
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        wp[i] = Wm[0] * x + Wm[4] * y + Wm[8] * z + Wm[12];
        wp[i + 1] = Wm[1] * x + Wm[5] * y + Wm[9] * z + Wm[13];
        wp[i + 2] = Wm[2] * x + Wm[6] * y + Wm[10] * z + Wm[14];
      }
      for (let k = 0; k < I.length; k += 3, t++) {
        const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
        for (let d = 0; d < 3; d++) {
          const A = wp[a + d], B = wp[b + d], C = wp[c + d];
          V0[t * 3 + d] = A; E1[t * 3 + d] = B - A; E2[t * 3 + d] = C - A;
          lo[t * 3 + d] = Math.min(A, B, C); hi[t * 3 + d] = Math.max(A, B, C); cen[t * 3 + d] = (A + B + C) / 3;
        }
        matI[t] = ii; cutF[t] = it.node.cut ? 1 : 0; itemI[t] = ii;
      }
    });
    const { idx, nodes, count } = bvhSplit(lo, hi, cen, nt);
    const tris = new Float32Array(Math.max(1, nt) * 12);
    const triItem = new Int32Array(nt);
    for (let k = 0; k < nt; k++) {
      const j = idx[k];
      tris.set([V0[j * 3], V0[j * 3 + 1], V0[j * 3 + 2], matI[j], E1[j * 3], E1[j * 3 + 1], E1[j * 3 + 2], cutF[j], E2[j * 3], E2[j * 3 + 1], E2[j * 3 + 2], 0], k * 12);
      triItem[k] = itemI[j];
    }
    return { nodes: nodes.subarray(0, count * 8), tris, mats: new Float32Array(mats.length ? mats : [0, 0, 0, 0]), nNodes: count, nTris: nt, triItem, list };
  }
  // A ray against one triangle (a corner and two edges), Moller-Trumbore, without allocating:
  // the distance along the ray, or Infinity for a miss.
  function rayTri(ox, oy, oz, dx, dy, dz, ax, ay, az, e1x, e1y, e1z, e2x, e2y, e2z, eps) {
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -eps && det < eps) return Infinity;
    const tx = ox - ax, ty = oy - ay, tz = oz - az, u = (tx * px + ty * py + tz * pz) / det;
    if (u < 0 || u > 1) return Infinity;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) / det;
    if (v < 0 || u + v > 1) return Infinity;
    return (e2x * qx + e2y * qy + e2z * qz) / det;
  }
  // The nearest triangle of a BVH the ray hits with tmin < t < tmax that ok(j, t) accepts (any:
  // the first one found): its index, with its t in walkT, or -1.
  const walkStack = [];
  let walkT = Infinity;
  function bvhNearest(N, T, o, d, tmin, tmax, any, eps, ok) {
    const ox = o[0], oy = o[1], oz = o[2], dx = d[0], dy = d[1], dz = d[2];
    const ix = 1 / (Math.abs(dx) < 1e-12 ? 1e-12 : dx), iy = 1 / (Math.abs(dy) < 1e-12 ? 1e-12 : dy), iz = 1 / (Math.abs(dz) < 1e-12 ? 1e-12 : dz);
    const boxT = (i, best) => {
      const b = i * 8;
      let a = (N[b] - ox) * ix, c = (N[b + 4] - ox) * ix, t0 = Math.max(0, Math.min(a, c)), t1 = Math.min(best, Math.max(a, c));
      a = (N[b + 1] - oy) * iy; c = (N[b + 5] - oy) * iy; t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
      a = (N[b + 2] - oz) * iz; c = (N[b + 6] - oz) * iz; t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
      return t0 <= t1 ? t0 : Infinity;
    };
    let best = tmax, hit = -1, sp = 0;
    walkT = Infinity;
    if (boxT(0, best) === Infinity) return -1;
    walkStack[sp++] = 0;
    while (sp) {
      const ni = walkStack[--sp], cnt = N[ni * 8 + 7];
      if (cnt > 0) {
        const first = N[ni * 8 + 3];
        for (let j = first; j < first + cnt; j++) {
          const q = j * 12, t = rayTri(ox, oy, oz, dx, dy, dz, T[q], T[q + 1], T[q + 2], T[q + 4], T[q + 5], T[q + 6], T[q + 8], T[q + 9], T[q + 10], eps);
          if (!(t > tmin) || t >= best || (ok && !ok(j, t))) continue;
          best = t; hit = j;
          if (any) break;
        }
        if (any && hit >= 0) break;
      } else {
        const l = N[ni * 8 + 3], r = l + 1, tl = boxT(l, best), tr = boxT(r, best);
        if (tl <= tr) { if (tr < Infinity) walkStack[sp++] = r; if (tl < Infinity) walkStack[sp++] = l; }
        else { if (tl < Infinity) walkStack[sp++] = l; if (tr < Infinity) walkStack[sp++] = r; }
      }
    }
    if (hit >= 0) walkT = best;
    return hit;
  }
  // The same walk as the shader's trace(), on the CPU: { t, point, normal, node } or null.
  function traceCPU(B, o, d, tmax = Infinity, any = false, cut = null) {
    if (!B || !B.nTris) return null;
    const T = B.tris;
    const ok = cut ? (j, t) => !(T[j * 12 + 7] > 0.5 && (o[0] + d[0] * t) * cut[0] + (o[1] + d[1] * t) * cut[1] + (o[2] + d[2] * t) * cut[2] > cut[3]) : null;
    const hit = bvhNearest(B.nodes, T, o, d, 1e-9, tmax, any, 1e-14, ok);
    if (hit < 0) return null;
    const best = walkT, q = hit * 12;
    let n = v3.norm(v3.cross([T[q + 4], T[q + 5], T[q + 6]], [T[q + 8], T[q + 9], T[q + 10]]));
    if (v3.dot(n, d) > 0) n = v3.scale(n, -1);
    return { t: best, point: v3.add(o, v3.scale(d, best)), normal: n, node: B.list[B.triItem[hit]]?.node ?? null };
  }

  // Picking (view.pick, view.hidden: hover, labels a part hides) walks a BVH of each big mesh in
  // its own space. A worker builds it once the mesh has held still for a moment, so the page never
  // waits on a build; until then picks test every triangle, without allocating. Both give the
  // same hit.
  function meshTree(P, I, split) {
    const nt = I.length / 3, lo = new Float32Array(nt * 3), hi = new Float32Array(nt * 3), cen = new Float32Array(nt * 3), tri = new Float32Array(nt * 9);
    for (let t = 0; t < nt; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      for (let d = 0; d < 3; d++) {
        const A = P[a + d], B = P[b + d], C = P[c + d];
        tri[t * 9 + d] = A; tri[t * 9 + 3 + d] = B - A; tri[t * 9 + 6 + d] = C - A;
        lo[t * 3 + d] = Math.min(A, B, C); hi[t * 3 + d] = Math.max(A, B, C); cen[t * 3 + d] = (A + B + C) / 3;
      }
    }
    const { idx, nodes, count } = split(lo, hi, cen, nt), tris = new Float32Array(Math.max(1, nt) * 12);
    for (let k = 0; k < nt; k++) { const j = idx[k] * 9, q = k * 12; for (let d = 0; d < 3; d++) { tris[q + d] = tri[j + d]; tris[q + 4 + d] = tri[j + 3 + d]; tris[q + 8 + d] = tri[j + 6 + d]; } }
    return { nodes: nodes.slice(0, count * 8), tris, nTris: nt };
  }
  const pickTrees = new WeakMap(), treeJobs = new Map();
  let treeWorker, treeSeq = 0;
  function startTreeWorker() {
    if (treeWorker !== undefined) return treeWorker;
    treeWorker = null;
    try {
      const src = `const split = ${bvhSplit}; const tree = ${meshTree};
onmessage = e => { const t = tree(e.data.P, e.data.I, split); postMessage({ id: e.data.id, tree: t }, [t.nodes.buffer, t.tris.buffer]); };`;
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      w.onmessage = e => { const done = treeJobs.get(e.data.id); treeJobs.delete(e.data.id); if (done) done(e.data.tree); };
      w.onerror = () => { treeWorker = null; treeJobs.clear(); };
      treeWorker = w;
    } catch { treeWorker = null; }
    return treeWorker;
  }
  function pickTree(mesh) {
    const nt = mesh.indices.length / 3;
    if (nt < 1024) return null;
    const v = mesh.version ?? 0, now = typeof performance !== "undefined" ? performance.now() : Date.now();
    let e = pickTrees.get(mesh);
    if (!e || e.version !== v) pickTrees.set(mesh, (e = { version: v, since: now, tree: null, asked: false }));
    if (e.tree || e.asked) return e.tree;
    const done = tree => { if (pickTrees.get(mesh) === e) e.tree = tree; };
    if (typeof Worker === "undefined") { e.asked = true; done(meshTree(mesh.positions, mesh.indices, bvhSplit)); return e.tree; }
    if (now - e.since < 250) return null;   // a mesh that changes every frame never gets one
    e.asked = true;
    const w = startTreeWorker();
    if (w) { const id = ++treeSeq; treeJobs.set(id, done); w.postMessage({ id, P: Float32Array.from(mesh.positions), I: Uint32Array.from(mesh.indices) }); }
    return null;
  }
  // The scene's BVH, rebuilt only when a traced part moves, changes, or comes and goes.
  function traceOf(scene, items, matOf) {
    const list = items.filter(it => it.node.trace !== false && it.node.castShadow !== false && !it.node._light && matOf(it).kind === "opaque");
    let key = "";
    for (const it of list) {
      key += meshId(it.node.mesh) + "." + (it.node.mesh.version ?? 0) + (it.node.cut ? "c" : "") + ":" + matOf(it).rgb.join(",") + ":";
      for (let k = 0; k < 16; k++) key += (Math.round(it.world[k] * 1e5) / 1e5) + ",";
      key += "|";
    }
    let Tr = scene._trace;
    if (!Tr || Tr.key !== key) {
      if (Tr && Tr.gpu && R && Tr.gpu.gl === R.gl) for (const t of [Tr.gpu.nodes, Tr.gpu.tris, Tr.gpu.mats]) R.gl.deleteTexture(t);
      Tr = scene._trace = { key, bvh: buildBVH(list, matOf), gpu: null };
    }
    return Tr;
  }
  function floatTex(data, texels) {
    const { gl } = R;
    const h = Math.max(1, Math.ceil(texels / 1024)), buf = new Float32Array(1024 * h * 4);
    buf.set(data.subarray(0, Math.min(data.length, buf.length)));
    const t = texture(1024, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1024, h, gl.RGBA, gl.FLOAT, buf);
    return t;
  }
  function traceGPU(Tr) {
    if (Tr.gpu && Tr.gpu.gl === R.gl) return Tr.gpu;
    const B = Tr.bvh;
    Tr.gpu = { gl: R.gl, nodes: floatTex(B.nodes, B.nNodes * 2), tris: floatTex(B.tris, Math.max(1, B.nTris) * 3), mats: floatTex(B.mats, B.mats.length / 4) };
    return Tr.gpu;
  }
  const dummyFloat = () => R.dummyFloat || (R.dummyFloat = floatTex(new Float32Array(4), 1));
  function bindTrace(gpu) {
    const { gl } = R;
    gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, gpu ? gpu.nodes : dummyFloat());
    gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, gpu ? gpu.tris : dummyFloat());
    gl.activeTexture(gl.TEXTURE14); gl.bindTexture(gl.TEXTURE_2D, gpu ? gpu.mats : dummyFloat());
    gl.activeTexture(gl.TEXTURE0);
  }

  // Pictures on parts (material.map): a canvas, image, ImageData, or a function (u, v) -> color
  // painted once into a 1024 x 512 canvas. Uploaded once per source, with mipmaps.
  const mapCache = new WeakMap();
  const imgCache = new Map();
  function mapCanvas(src) {
    // { lazy: () => canvas } is painted the first time it's drawn (the Earth's map).
    if (src && src.lazy) return src.canvas || (src.canvas = src.lazy());
    // A URL or data URL loads as an image; figures redraw once it arrives.
    if (typeof src === "string") {
      let e = imgCache.get(src);
      if (!e) {
        const img = new Image();
        e = { img, ready: false };
        img.onload = () => { e.ready = true; if (typeof window !== "undefined") window.dispatchEvent(new Event("safis:redraw")); };
        img.onerror = () => console.error(`E3: couldn't load the map image ${src.slice(0, 60)}`);
        img.src = src;
        imgCache.set(src, e);
      }
      return e.ready ? e.img : null;
    }
    if (src && src.tagName === "IMG" && !(src.complete && src.naturalWidth)) { src.addEventListener("load", () => window.dispatchEvent(new Event("safis:redraw")), { once: true }); return null; }
    if (typeof src !== "function") return src;
    let c = mapCache.get(src);
    if (c && c.canvas) return c.canvas;
    const W = 1024, H = 512, cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
    const ctx = cv.getContext("2d"), img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = src((x + 0.5) / W, (y + 0.5) / H);
      const rgb = Array.isArray(v) ? v : colorOf(v, true);
      const k = (y * W + x) * 4;
      img.data[k] = rgb[0] * 255; img.data[k + 1] = rgb[1] * 255; img.data[k + 2] = rgb[2] * 255; img.data[k + 3] = (rgb[3] ?? 1) * 255;
    }
    ctx.putImageData(img, 0, 0);
    mapCache.set(src, { canvas: cv });
    return cv;
  }
  const strKeys = new Map();
  function mapTexture(src) {
    const { gl } = R;
    let key = src;
    if (typeof src === "string") { key = strKeys.get(src); if (!key) strKeys.set(src, (key = { url: src })); }
    let e = mapCache.get(key);
    const ver = src && src.version;
    if (e && e.tex && e.gl === gl && e.ver === ver) return e.tex;
    const img = mapCanvas(src);
    if (!img) return R.dummyMap || (R.dummyMap = (() => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255])); return t; })());
    const tex = (e && e.gl === gl && e.tex) || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (img && img.data && img.width) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, img.width, img.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.data instanceof Uint8ClampedArray ? new Uint8Array(img.data.buffer) : img.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const ext = gl.getExtension("EXT_texture_filter_anisotropic");
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    mapCache.set(key, { ...(mapCache.get(key) || {}), tex, gl, ver });
    return tex;
  }

  // A slide projector for mapping "project": the picture is cast from `position` toward `target`
  // through a frustum `fov` degrees tall (aspect from `aspect`, default the picture's), onto whatever
  // it lands on, the way a projector lights a wall or a model.
  function projectorVP(pr) {
    const view = m4.lookAt(pr.position, pr.target ?? [0, 0, 0], pr.up ?? [0, 1, 0]);
    return m4.multiply(m4.perspective(((pr.fov ?? 30) * Math.PI) / 180, pr.aspect ?? 1.5, 0.01, 1e6), view);
  }

  // The Earth: an equirectangular picture of land and sea from the maps kit's coastlines (when
  // Geo is on the page), with ice at the poles; the sea is glossy (alpha holds roughness), so the
  // Sun glints off it. Returns a canvas for material.map with mapping "sphere".
  let earthCanvas = null;
  function earthMap(o = {}) {
    if (earthCanvas && !o.redraw) return earthCanvas;
    const W = 2048, H = 1024;
    const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
    const ctx = cv.getContext("2d");
    const sea = o.sea ?? "#1d4f7a", land = o.land ?? "#7c8d55", dry = o.dry ?? "#b39b6b", ice = o.ice ?? "#eef2f4";
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2a5a80"); g.addColorStop(0.5, sea); g.addColorStop(1, "#2a5a80");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const X = lon => (lon + 180) / 360 * W, Y = lat => (90 - lat) / 180 * H;
    const Geo = typeof window !== "undefined" ? window.Geo : null;
    const lg = ctx.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0.0, "#e8ecef"); lg.addColorStop(0.12, "#8d8f78"); lg.addColorStop(0.22, land); lg.addColorStop(0.36, dry);
    lg.addColorStop(0.5, "#5f7a3c"); lg.addColorStop(0.64, dry); lg.addColorStop(0.75, land); lg.addColorStop(0.86, "#8d8f78"); lg.addColorStop(1, ice);
    if (Geo && Geo.countries) {
      ctx.fillStyle = lg;
      for (const c of Geo.countries) for (const poly of c.polygons || []) {
        ctx.beginPath();
        for (const ring of poly) {
          // Unwrap longitudes so a ring that crosses the date line stays whole, and close a
          // ring that goes all the way around (Antarctica) along the pole.
          const pts = []; let prev = null, off = 0;
          for (const [lon, lat] of ring) { if (prev != null && Math.abs(lon + off - prev) > 180) off += prev > lon + off ? 360 : -360; pts.push([lon + off, lat]); prev = lon + off; }
          const span = Math.max(...pts.map(q => q[0])) - Math.min(...pts.map(q => q[0]));
          for (const shift of [-360, 0, 360]) {
            pts.forEach(([lon, lat], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(lon + shift), Y(lat)));
            if (span > 350) { const last = pts[pts.length - 1], first = pts[0], pole = first[1] < 0 ? -90 : 90; ctx.lineTo(X(last[0] + shift), Y(pole)); ctx.lineTo(X(first[0] + shift), Y(pole)); }
            ctx.closePath();
          }
        }
        ctx.fill("evenodd");
      }
    }
    // Polar ice and sea ice.
    ctx.fillStyle = ice;
    ctx.fillRect(0, 0, W, H * 0.035);
    ctx.fillRect(0, H * 0.94, W, H * 0.06);
    // Roughness in alpha: glossy sea, rough land.
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      const isSea = b > r + 25 && b > gg;
      d[i + 3] = isSea ? 80 : 225;
    }
    ctx.putImageData(img, 0, 0);
    earthCanvas = cv;
    return cv;
  }
  // E3.earth({ radius, atmosphere }): a group with the globe (north up, longitude 0 toward +z,
  // east toward +x) and a thin glow of air at its rim.
  function earth(o = {}) {
    const r = o.radius ?? 1;
    const g = new Node(null, { name: o.name ?? "earth" });
    const ball = g.add(mesh.sphere(r, { segments: o.segments ?? 96 }), { name: "globe", material: { color: "#ffffff", metal: 0, roughness: 0.6, map: { lazy: () => earthMap(o) }, mapping: "sphere", mapRoughness: true } });
    if (o.atmosphere !== false) g.add(mesh.sphere(r * 1.018, { segments: 64 }), { name: "air", material: { color: "#8fb8ff", opacity: 0.22 }, pickable: false, castShadow: false, trace: false });
    g.globe = ball;
    // A point on the surface at a latitude and longitude (degrees), in the group's coordinates.
    g.at = (lat, lon, h = 0) => { const a = lat * Math.PI / 180, b = lon * Math.PI / 180, R = r + h; return [R * Math.cos(a) * Math.sin(b), R * Math.sin(a), R * Math.cos(a) * Math.cos(b)]; };
    return g;
  }

  // The Moon: a procedural map with the near side's real maria in their places (Imbrium,
  // Serenitatis, Tranquillitatis, Crisium, Fecunditatis, Nubium, Procellarum), highland craters,
  // and the bright ray systems of Tycho and Copernicus; or pass `map` (an equirectangular photo, a
  // data URL) for the real thing. Longitude 0 (the center of the near side) faces +z.
  let moonCanvas = null;
  function moonMap() {
    if (moonCanvas) return moonCanvas;
    const W = 1024, H = 512;
    const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
    const ctx = cv.getContext("2d"), img = ctx.createImageData(W, H), d = img.data;
    // [lat, lon, radius (deg), darkness]
    const MARIA = [[34, -16, 10, 1], [27, 18, 7, 1], [8, 31, 8, 0.95], [17, 59, 4.5, 1], [-5, 52, 6, 0.85], [-21, -17, 6, 0.8], [20, -58, 11, 0.9], [5, -48, 12, 0.85], [-10, -35, 7, 0.8],
      [-13, 8, 3.5, 0.6], [-25, -40, 5, 0.75], [-15, 35, 4, 0.75], [10, 2, 4, 0.7], [45, 3, 4, 0.6], [56, 0, 4, 0.55],
      [30, -35, 8, 0.85], [12, -30, 7, 0.85], [-5, -25, 6, 0.75], [18, 10, 4, 0.8], [2, 20, 5, 0.85], [-2, 40, 4, 0.75], [40, -50, 6, 0.75], [-30, -20, 3.5, 0.6]];
    const RAYS = [[-43.3, -11.4, 1.0, 35], [9.6, -20.1, 0.65, 18], [8.1, -38, 0.45, 12], [-8.9, 61.1, 0.3, 10], [23.7, -47.4, 0.4, 10]];
    const unit = (la, lo) => { const a = la * Math.PI / 180, b = lo * Math.PI / 180; return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)]; };
    const MU = MARIA.map(m => unit(m[0], m[1])), RU = RAYS.map(m => unit(m[0], m[1]));
    const angU = (P, U) => Math.acos(Math.min(1, Math.max(-1, P[0] * U[0] + P[1] * U[1] + P[2] * U[2]))) * 180 / Math.PI;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const lat = 90 - (y + 0.5) / H * 180, lon = (x + 0.5) / W * 360 - 180;
      const P = unit(lat, lon);
      // Warp the maria's edges with noise, so they're ragged lowlands, not discs.
      const wv = noised(P[0] * 4, P[1] * 4, P[2] * 4)[0] * 1.6 + noised(P[0] * 11, P[1] * 11, P[2] * 11)[0] * 0.8;
      let mare = 0;
      for (let m = 0; m < MARIA.length; m++) { const [, , r, k] = MARIA[m], dd = angU(P, MU[m]) + wv * r * 0.4; mare = Math.max(mare, k * (1 - Math.min(1, Math.max(0, (dd - r * 0.7) / (r * 0.6))))); }
      const fine = noised(P[0] * 40, P[1] * 40, P[2] * 40)[0], mid = noised(P[0] * 12, P[1] * 12, P[2] * 12)[0];
      let v = (0.74 + 0.07 * mid + 0.05 * fine) * (1 - mare) + (0.36 + 0.05 * mid + 0.03 * fine) * mare;
      // Rays: thin bright streaks thrown out from young craters, patchy along their length.
      for (let m = 0; m < RAYS.length; m++) {
        const [, , k, len] = RAYS[m], dd = angU(P, RU[m]);
        if (dd > len * 1.3) continue;
        const U = RU[m], t1 = v3.norm(v3.cross(Math.abs(U[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], U)), t2 = v3.cross(U, t1);
        const az = Math.atan2(v3.dot(P, t2), v3.dot(P, t1));
        const lane = (az / (Math.PI * 2) + 0.5) * 70, li = Math.floor(lane), f = lane - li;
        const w = rndU(li, m, 3, 5), w2 = rndU(li + 1, m, 3, 5);
        const streak = Math.pow(Math.max(0, (w * (1 - f) + w2 * f) - 0.55) * 2.2, 2) * (0.6 + 0.4 * noised(P[0] * 25, P[1] * 25, P[2] * 25 + m)[0]);
        v += k * (0.45 * Math.exp(-dd / 1.2) + 0.32 * streak * Math.exp(-dd / (len * 0.45)) * Math.min(1, dd / 1.5));
      }
      const q = (y * W + x) * 4;
      d[q] = d[q + 1] = d[q + 2] = Math.min(255, Math.max(0, v * 235)); d[q + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Craters: many small, few large; a slightly darker floor and a bright rim, faint at full Moon.
    for (let i = 0; i < 1400; i++) {
      const la = Math.asin(2 * rndU(i, 2, 0, 9) - 1) * 180 / Math.PI, lo = rndU(i, 3, 0, 9) * 360 - 180, r = 0.15 + 2.4 * Math.pow(rndU(i, 1, 0, 9), 4);
      const cx = (lo + 180) / 360 * W, cy = (90 - la) / 180 * H, rx = r / 360 * W / Math.max(0.25, Math.cos(la * Math.PI / 180)), ry = r / 180 * H;
      ctx.fillStyle = `rgba(0,0,0,${0.06 + 0.05 * rndU(i, 4, 0, 9)})`; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.1 + 0.12 * rndU(i, 5, 0, 9)})`; ctx.lineWidth = Math.max(0.5, ry * 0.22); ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    }
    moonCanvas = cv;
    return cv;
  }
  function moon(o = {}) {
    const r = o.radius ?? 1;
    const g = new Node(null, { name: o.name ?? "moon" });
    g.globe = g.add(mesh.sphere(r, { segments: o.segments ?? 96 }), { name: "moon surface", material: { color: "#ffffff", metal: 0, roughness: 0.95, map: o.map ?? { lazy: moonMap }, mapping: "sphere" } });
    g.at = (lat, lon, h = 0) => { const a = lat * Math.PI / 180, b = lon * Math.PI / 180, R = r + h; return [R * Math.cos(a) * Math.sin(b), R * Math.sin(a), R * Math.cos(a) * Math.cos(b)]; };
    return g;
  }

  // Grass: thousands of tapered, curved blades rooted on a patch, each bending in the wind as a
  // cantilever (gusts roll across the patch as waves, each blade flutters at its own rate) and
  // pushed aside by anything that walks through. Blade sizes default to a lawn: 6 to 14 cm tall,
  // 3 to 5 mm wide, in the units of `units`.
  function grass(o = {}) {
    const units = unitsOf(o.units ?? "m");
    const size = Array.isArray(o.size) ? o.size : [o.size ?? 0.4 * units, o.size ?? 0.4 * units];
    const count = Math.max(1, Math.round(o.count ?? Math.min(24000, 9000 * (size[0] * size[1]) / (0.16 * units * units))));
    const hR = o.height ?? [0.06 * units, 0.14 * units], wR = o.width ?? [0.003 * units, 0.005 * units];
    const S = 4, seed = o.seed ?? 3, ground = o.ground ?? (() => 0);
    const vpb = 2 * S + 1, tpb = 2 * S - 1;
    const P = new Float32Array(count * vpb * 3), N = new Float32Array(count * vpb * 3), Bd = new Float32Array(count * vpb * 4), Bl = new Float32Array(count * vpb * 2);
    const I = new Uint32Array(count * tpb * 3);
    const rnd = (i, k) => rndU(i, k, 0, seed);
    // Roots on a jittered grid, so the patch fills evenly without rows.
    const cols = Math.ceil(Math.sqrt(count * size[0] / size[1])), rows = Math.ceil(count / cols);
    for (let b = 0; b < count; b++) {
      const gx = b % cols, gz = Math.floor(b / cols);
      const x = ((gx + rnd(b, 1)) / cols - 0.5) * size[0], z = ((gz + rnd(b, 2)) / rows - 0.5) * size[1], y = ground(x, z);
      const L = hR[0] + (hR[1] - hR[0]) * Math.pow(rnd(b, 3), 0.8), w = wR[0] + (wR[1] - wR[0]) * rnd(b, 4);
      const face = rnd(b, 5) * Math.PI * 2, leanA = rnd(b, 6) * Math.PI * 2, lean = 0.15 + 0.5 * rnd(b, 7) ** 1.5;
      const side = [Math.cos(face), 0, Math.sin(face)], ld = [Math.cos(leanA), 0, Math.sin(leanA)];
      const r = rnd(b, 8);
      for (let k = 0; k <= S; k++) {
        const h = k / S, bend = lean * h * h;
        const c = [x + ld[0] * Math.sin(bend) * L * h, y + Math.cos(bend) * L * h, z + ld[2] * Math.sin(bend) * L * h];
        const half = k === S ? 0 : (w / 2) * (1 - Math.pow(h, 1.6));
        const tan = v3.norm([ld[0] * Math.sin(bend * 2 + 1e-3), Math.cos(bend * 2), ld[2] * Math.sin(bend * 2 + 1e-3)]);
        let fn = v3.norm(v3.cross(side, tan));
        if (fn[1] < 0) fn = v3.scale(fn, -1);
        const verts = k === S ? [c] : [v3.add(c, v3.scale(side, -half)), v3.add(c, v3.scale(side, half))];
        verts.forEach((pt, j) => {
          const vi = b * vpb + (k === S ? 2 * S : 2 * k + j);
          P.set(pt, vi * 3);
          const curl = k === S ? 0 : (j ? 0.35 : -0.35);
          N.set(v3.norm(v3.add(fn, v3.scale(side, curl))), vi * 3);
          Bd.set([x, y, z, h], vi * 4);
          Bl.set([r, L], vi * 2);
        });
      }
      let t = b * tpb * 3;
      const v = k => b * vpb + k;
      for (let k = 0; k < S - 1; k++) { I.set([v(2 * k), v(2 * k + 1), v(2 * k + 3), v(2 * k), v(2 * k + 3), v(2 * k + 2)], t); t += 6; }
      I.set([v(2 * S - 2), v(2 * S - 1), v(2 * S)], t);
    }
    const m = makeMesh(P, N, I);
    m.extra = { 2: [Bd, 4], 3: [Bl, 2] };
    const g = new Node(null, { name: o.name ?? "grass" });
    const blades = g.add(m, { name: "blades", material: o.material ?? { color: o.color ?? "#5f8a2f", metal: 0, roughness: 0.55, foliage: true }, twoSided: true, trace: false, pickable: o.pickable ?? true });
    blades._grass = g;
    g.blades = blades;
    if (o.soil !== false) g.add(mesh.box(size[0], o.soilDepth ?? 0.03 * units, size[1], { round: 0.004 * units }), { name: "soil", position: [0, -(o.soilDepth ?? 0.03 * units) / 2, 0], material: { color: o.soilColor ?? "#4b3526", metal: 0, roughness: 0.95 } });
    // Wind in m/s along wind direction [x, z]; the bend grows with the dynamic pressure (v²).
    g.wind = o.wind ?? 3;
    g.windDirection = o.windDirection ?? [1, 0.25];
    g.units = units;
    g.push = null; // [x, y, z, radius] in the group's coordinates: something parting the grass
    return g;
  }

  // How big a light looks from a point on a surface: its solid angle (steradians), the share of it
  // weighted by the cosine (the projected solid angle, which sets the irradiance), and two meshes
  // for drawing it: the light's outline projected onto a hemisphere of `radius` around the point,
  // and that patch flattened onto the hemisphere's base (where its area / (pi r²) is the share of
  // light the point gets).
  function solidAngle(point, normal, light, o = {}) {
    const n = v3.norm(normal), r = o.radius ?? 1, units = 1;
    const L = lightRig({ lights: [{ power: 1, ...light }], units })[0];
    const ring = [];
    const K = 48;
    if (L.t <= 1) {
      const d = v3.sub(L.position, point), dl = v3.len(d), w = v3.scale(d, 1 / dl), sa = Math.min(1, (L.radius || dl * 0.01) / dl), ca = Math.sqrt(1 - sa * sa);
      const t1 = v3.norm(v3.cross(Math.abs(w[0]) > 0.5 ? [0, 1, 0] : [1, 0, 0], w)), t2 = v3.cross(w, t1);
      for (let i = 0; i < K; i++) { const a = (i / K) * Math.PI * 2; ring.push(v3.norm(v3.add(v3.scale(w, ca), v3.add(v3.scale(t1, sa * Math.cos(a)), v3.scale(t2, sa * Math.sin(a)))))); }
    } else {
      for (let i = 0; i < K; i++) {
        let u, v;
        if (L.t === 2) { const a = (i / K) * Math.PI * 2; u = Math.cos(a); v = Math.sin(a); }
        else { const s = (i / K) * 4, e = Math.floor(s), f = s - e; [u, v] = [[-1 + 2 * f, -1], [1, -1 + 2 * f], [1 - 2 * f, 1], [-1, 1 - 2 * f]][e]; }
        ring.push(v3.norm(v3.sub(v3.add(L.position, v3.add(v3.scale(L.U, u), v3.scale(L.V, v))), point)));
      }
    }
    // Clip to the hemisphere above the surface: a direction below the horizon is pushed onto it.
    const up = d => { const h = v3.dot(d, n); return h >= 0 ? d : v3.norm(v3.sub(d, v3.scale(n, h))); };
    const dirs = ring.map(up);
    const c = v3.norm(dirs.reduce((a, d) => v3.add(a, d), [0, 0, 0]));
    // Integrate over the patch as a fan of thin spherical triangles (subdivided), for both measures.
    let omega = 0, proj = 0;
    const tri = (a, b, cc) => { const ab = v3.cross(a, b), num = v3.dot(ab, cc), den = 1 + v3.dot(a, b) + v3.dot(b, cc) + v3.dot(cc, a); return 2 * Math.atan2(Math.abs(num), den); };
    for (let i = 0; i < K; i++) {
      const a = dirs[i], b = dirs[(i + 1) % K];
      for (let j = 0; j < 8; j++) {
        const p0 = v3.norm(v3.lerp(c, a, j / 8)), p1 = v3.norm(v3.lerp(c, a, (j + 1) / 8)), q0 = v3.norm(v3.lerp(c, b, j / 8)), q1 = v3.norm(v3.lerp(c, b, (j + 1) / 8));
        for (const [x, y, z] of [[p0, p1, q1], [p0, q1, q0]]) {
          const w = tri(x, y, z), m = v3.norm(v3.add(v3.add(x, y), z));
          omega += w; proj += w * Math.max(0, v3.dot(m, n));
        }
      }
    }
    // The patch as a mesh: rings from the center direction out to the outline, on the sphere
    // ("cap") or dropped onto the base ("flat").
    const fan = mode => {
      const RINGS = 8, P = [], N = [], I = [];
      const at = d => { const q = mode === "flat" ? v3.sub(d, v3.scale(n, v3.dot(d, n))) : d; return v3.add(point, v3.scale(q, r)); };
      P.push(...at(c)); N.push(...n);
      for (let j = 1; j <= RINGS; j++) for (let i = 0; i < K; i++) { const d = v3.norm(v3.lerp(c, dirs[i], j / RINGS)); P.push(...at(d)); N.push(...(mode === "flat" ? n : d)); }
      const id = (j, i) => (j === 0 ? 0 : 1 + (j - 1) * K + (i % K));
      for (let j = 0; j < RINGS; j++) for (let i = 0; i < K; i++) {
        if (j === 0) I.push(0, id(1, i), id(1, i + 1), 0, id(1, i + 1), id(1, i));
        else I.push(id(j, i), id(j + 1, i), id(j + 1, i + 1), id(j, i), id(j + 1, i + 1), id(j, i + 1), id(j, i), id(j + 1, i + 1), id(j + 1, i), id(j, i), id(j, i + 1), id(j + 1, i + 1));
      }
      return makeMesh(new Float32Array(P), new Float32Array(N), new Uint32Array(I));
    };
    return { omega, projected: proj, share: proj / Math.PI, cap: fan("cap"), disk: fan("flat"), outline: dirs.map(d => v3.add(point, v3.scale(d, r))), flat: dirs.map(d => v3.add(point, v3.scale(v3.sub(d, v3.scale(n, v3.dot(d, n))), r))) };
  }

  // Rays from a light, traced through the scene: [{ from, to, hit: { point, normal, node } | null }].
  // For drawing photons as lines and marking where they land (view.project each end).
  function photons(scene, light, o = {}) {
    const items = collect(scene), mats = new Map();
    const matOf = it => { let m = mats.get(it.node); if (!m) mats.set(it.node, (m = resolveMaterial(it.node, scene.look))); return m; };
    const Tr = traceOf(scene, items, matOf);
    const n = o.count ?? 200, seed = o.seed ?? 1, far = o.length ?? sceneBounds(items).radius * 4;
    const pos = light.position ?? [0, 0, 0], out = [];
    const dir0 = o.direction ? v3.norm(o.direction) : null, cone = o.cone ?? Math.PI;
    for (let i = 0; i < n; i++) {
      // Evenly spread directions (a Fibonacci sphere), or within a cone around `direction`.
      const u = (i + 0.5) / n, phi = i * 2.399963229728653 + seed;
      const cz = dir0 ? 1 - u * (1 - Math.cos(cone)) : 1 - 2 * u, sz = Math.sqrt(Math.max(0, 1 - cz * cz));
      let d = [Math.cos(phi) * sz, Math.sin(phi) * sz, cz];
      if (dir0) { const t1 = v3.norm(v3.cross(Math.abs(dir0[0]) > 0.5 ? [0, 1, 0] : [1, 0, 0], dir0)), t2 = v3.cross(dir0, t1); d = v3.add(v3.add(v3.scale(t1, d[0]), v3.scale(t2, d[1])), v3.scale(dir0, d[2])); }
      let from = pos;
      if (light.radius && !o.fromCenter) from = v3.add(pos, v3.scale(d, light.radius));
      const h = traceCPU(Tr.bvh, from, d, far);
      out.push({ from, to: h ? h.point : v3.add(from, v3.scale(d, far)), dir: d, hit: h });
    }
    return out;
  }

  // ---------- WebGL renderer ----------
  let R = null;
  // Both shaders compile and link before anything asks how it went, so the driver can work on
  // them together instead of finishing each one while the page waits; the status (and the
  // failing shader's log) is read only once, after the link.
  function compile(gl, vs, fs, varyings) {
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const p = gl.createProgram(), v = make(gl.VERTEX_SHADER, vs), f = make(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    if (varyings) gl.transformFeedbackVaryings(p, varyings, gl.SEPARATE_ATTRIBS);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      for (const s of [v, f]) if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
    }
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const loc = gl.getUniformLocation(p, info.name);
      const entry = { loc, type: info.type, size: info.size };
      u[info.name] = entry;
      if (info.name.endsWith("[0]")) u[info.name.slice(0, -3)] = entry;
    }
    return { p, u };
  }
  // Sets a uniform by name from a number or array, whatever its GLSL type; unused names are ignored.
  function setU(P, name, v) {
    const e = P.u[name];
    if (!e || v == null) return;
    const { gl } = R, l = e.loc;
    switch (e.type) {
      case gl.FLOAT: e.size > 1 ? gl.uniform1fv(l, v) : gl.uniform1f(l, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(l, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(l, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(l, v); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(l, false, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(l, false, v); break;
      case gl.UNSIGNED_INT: gl.uniform1ui(l, v >>> 0); break;
      case gl.INT_VEC4: gl.uniform4iv(l, v); break;
      default: gl.uniform1i(l, v | 0);
    }
  }
  const setAll = (P, o) => { for (const k in o) setU(P, k, o[k]); };

  const PROGRAMS = {
    main: () => [VS, FS_MAIN], depth: () => [VS, FS_DEPTH], ghost: () => [VS, FS_GHOST], glass: () => [VS, FS_GLASS],
    ground: () => [VS_GROUND, FS_GROUND], composite: () => [VS_FULL, FS_COMPOSITE],
    extract: () => [VS_FULL, FS_BLOOM_EXTRACT], down: () => [VS_FULL, FS_DOWN], up: () => [VS_FULL, FS_UP],
    env: () => [VS_FULL, FS_ENV], prefilter: () => [VS_FULL, FS_PREFILTER], present: () => [VS_FULL, FS_PRESENT],
    pupdate: () => [VS_PUPDATE, FS_NULL, ["oP", "oV"]], particle: () => [VS_PARTICLE, FS_PARTICLE], psphere: () => [VS_PARTICLE, FS_PSPHERE],
    plume: () => [VS, FS_PLUME],
    vsplat: () => [VS_VSPLAT, FS_VSPLAT], vlight: () => [VS_FULL, FS_VLIGHT], vmarch: () => [VS_FULL, FS_VMARCH], vup: () => [VS_FULL, FS_VUP],
  };
  // Programs compile the first time a frame needs them, so a page without particles never pays for them.
  // Compiling a program (or allocating a big target) makes a slow frame that says nothing about the
  // device; R.hitch tells the quality tiers to ignore it.
  const prog = name => R.prog[name] || ((R.hitch = true), (R.prog[name] = compile(R.gl, ...PROGRAMS[name]())));

  // One WebGL context serves every figure. It renders into an OffscreenCanvas and each
  // frame is handed over with transferToImageBitmap(), which is exact; reading a shared
  // WebGL canvas with drawImage() can return a stale buffer in some browsers.
  function renderer() {
    if (R) return R;
    const offscreen = typeof OffscreenCanvas !== "undefined";
    const canvas = offscreen ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: !offscreen, depth: true });
    if (!gl) throw new Error("this figure needs WebGL 2, which this browser doesn't provide");
    const hdr = !!gl.getExtension("EXT_color_buffer_float");
    R = {
      canvas, gl, offscreen, hdr, prog: {}, env: new Map(), cw: 0, ch: 0,
      maxSamples: Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0),
      ptMax: (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1],
      empty: gl.createVertexArray(),
      main: null, msaa: null, scene: null, fx: null, bloom: [], shadow: {},
    };
    R.colorFmt = hdr ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
    const sampler = (cmp, filter) => {
      const s = gl.createSampler();
      gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, filter);
      gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, filter);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (cmp) { gl.samplerParameteri(s, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.samplerParameteri(s, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL); }
      return s;
    };
    R.sCmp = sampler(true, gl.LINEAR);
    R.sRaw = sampler(false, gl.NEAREST);
    R.dummyDepth = texture(1, 1, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
    R.dummyColor = texture(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    // After a lost context (a GPU reset, or the browser reclaiming it) the next frame makes a new
    // one; every figure redraws then, since the frames they were showing may never have finished.
    if (canvas.addEventListener) canvas.addEventListener("webglcontextlost", e => {
      e.preventDefault(); R = null;
      if (typeof window !== "undefined") setTimeout(() => window.dispatchEvent(new Event("safis:redraw")), 250);
    });
    return R;
  }

  function texture(w, h, internal, format, type, filter, levels = 1) {
    const { gl } = R;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (levels > 1) gl.texStorage2D(gl.TEXTURE_2D, levels, internal, w, h);
    else gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function framebuffer(colors, depth) {
    const { gl } = R;
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    colors.forEach((c, i) => {
      if (c.rb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.RENDERBUFFER, c.rb);
      else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, c.tex || c, c.level ?? 0);
    });
    if (depth) {
      if (depth.rb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth.rb);
      else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    }
    gl.drawBuffers(colors.length ? colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i) : [gl.NONE]);
    if (!colors.length) gl.readBuffer(gl.NONE);
    return fb;
  }
  const drop = (list, del) => list.forEach(x => x && del(x));

  // Render targets grow to the largest figure and are shared; each frame uses a corner.
  function targets(W, H, Wo, Ho, samples, needScene) {
    const { gl } = R;
    const [ci, cf, ct] = R.colorFmt;
    let M = R.main;
    if (!M || M.w < W || M.h < H) {
      if (M) { gl.deleteFramebuffer(M.fb); drop([M.color, M.normal, M.depth], t => gl.deleteTexture(t)); }
      const w = Math.max(W, M?.w ?? 0), h = Math.max(H, M?.h ?? 0);
      M = R.main = { w, h };
      M.color = texture(w, h, ci, cf, ct, gl.LINEAR);
      M.normal = texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
      M.depth = texture(w, h, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
      M.fb = framebuffer([M.color, M.normal], M.depth);
      if (R.scene) { gl.deleteFramebuffer(R.scene.fb); gl.deleteTexture(R.scene.tex); R.scene = null; }
    }
    if (needScene && (!R.scene || R.scene.w < M.w || R.scene.h < M.h)) {
      if (R.scene) { gl.deleteFramebuffer(R.scene.fb); gl.deleteTexture(R.scene.tex); }
      const tex = texture(M.w, M.h, ci, cf, ct, gl.LINEAR);
      R.scene = { w: M.w, h: M.h, tex, fb: framebuffer([tex]) };
    }
    if (samples > 1) {
      let S = R.msaa;
      if (!S || S.w < W || S.h < H || S.samples !== samples) {
        if (S) { gl.deleteFramebuffer(S.fb); drop([S.color, S.normal, S.depth], x => gl.deleteRenderbuffer(x.rb)); }
        const w = Math.max(W, S?.w ?? 0), h = Math.max(H, S?.h ?? 0);
        const rb = fmt => { const r = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, w, h); return { rb: r }; };
        S = R.msaa = { w, h, samples, color: rb(ci), normal: rb(gl.RGBA8), depth: rb(gl.DEPTH_COMPONENT24) };
        S.fb = framebuffer([S.color, S.normal], S.depth);
      }
    }
    let F = R.fx;
    if (!F || F.w < Wo || F.h < Ho) {
      if (F) { gl.deleteFramebuffer(F.fb); gl.deleteTexture(F.tex); }
      const w = Math.max(Wo, F?.w ?? 0), h = Math.max(Ho, F?.h ?? 0);
      const tex = texture(w, h, ci, cf, ct, gl.LINEAR);
      F = R.fx = { w, h, tex, fb: framebuffer([tex]) };
    }
    if (R.cw < Wo || R.ch < Ho) {
      R.cw = Math.max(R.cw, Wo); R.ch = Math.max(R.ch, Ho);
      R.canvas.width = R.cw; R.canvas.height = R.ch;
    }
  }
  function bloomTargets(Wo, Ho) {
    const { gl } = R;
    const [ci, cf, ct] = R.colorFmt;
    let w = Math.ceil(Wo / 2), h = Math.ceil(Ho / 2);
    const out = [];
    for (let i = 0; i < 5 && w >= 4 && h >= 4; i++) {
      let L = R.bloom[i];
      if (!L || L.w < w || L.h < h) {
        if (L) { gl.deleteFramebuffer(L.fb); gl.deleteTexture(L.tex); }
        const tw = Math.max(w, L?.w ?? 0), th = Math.max(h, L?.h ?? 0);
        const tex = texture(tw, th, ci, cf, ct, gl.LINEAR);
        L = R.bloom[i] = { w: tw, h: th, tex, fb: framebuffer([tex]) };
      }
      out.push({ ...L, vw: w, vh: h });
      w = Math.ceil(w / 2); h = Math.ceil(h / 2);
    }
    return out;
  }

  // The environment for a look and theme, made on the GPU the first time it's needed:
  // a 512x256 lat-long source, then six prefiltered roughness levels and an irradiance map.
  function environment(kind, dark, sun, sky = null) {
    const key = `${kind}|${dark ? 1 : 0}|${kind >= 2 ? sun.map(v => v.toFixed(2)).join(",") : ""}|${sky ? [sky.haze, sky.intensity, sky.altitude].join(",") : ""}`;
    // A physical sky changes with the Sun; keep only the last few.
    if (kind === 3 && R.env.size > 24) for (const [k, E0] of R.env) if (k.startsWith("3|")) { R.gl.deleteTexture(E0.spec); R.gl.deleteTexture(E0.irr); R.env.delete(k); break; }
    let E = R.env.get(key);
    if (E) return E;
    const { gl } = R;
    const [ci, cf, ct] = R.colorFmt;
    const enc = R.hdr ? 1 : 1 / 8;
    const src = texture(512, 256, ci, cf, ct, gl.LINEAR, 9);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    let fb = framebuffer([src]);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.viewport(0, 0, 512, 256);
    const pe = prog("env");
    gl.useProgram(pe.p);
    setAll(pe, { uSize: [512, 256], uKind: kind, uDark: dark ? 1 : 0, uSun: sun, uOutScale: enc, uSunDir: sun, uSkyP: sky ? [20 * sky.intensity, sky.haze, sky.altitude, 0] : [20, 1, 2, 0] });
    gl.bindVertexArray(R.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.deleteFramebuffer(fb);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    const LEVELS = 6;
    const spec = texture(256, 128, ci, cf, ct, gl.LINEAR, LEVELS);
    gl.bindTexture(gl.TEXTURE_2D, spec);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    const irr = texture(64, 32, ci, cf, ct, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, irr);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    const pf = prog("prefilter");
    gl.useProgram(pf.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    setAll(pf, { uSrc: 0, uSrcW: 512, uScale: 1 });
    for (let l = 0; l <= LEVELS; l++) {
      const isIrr = l === LEVELS;
      const w = isIrr ? 64 : 256 >> l, h = isIrr ? 32 : 128 >> l;
      fb = framebuffer([isIrr ? irr : { tex: spec, level: l }]);
      gl.viewport(0, 0, w, h);
      setAll(pf, { uSize: [w, h], uRough: l / (LEVELS - 1), uMode: isIrr ? 1 : 0 });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.deleteFramebuffer(fb);
    }
    gl.deleteTexture(src);
    gl.bindVertexArray(null);
    E = { spec, irr, scale: 1 / enc, lod: LEVELS - 1 };
    R.env.set(key, E);
    return E;
  }

  function shadowMaps(size, glass) {
    const { gl } = R;
    const S = R.shadow;
    const make = () => {
      const t = texture(size, size, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
      return { tex: t, fb: framebuffer([], t) };
    };
    if (S.size !== size) {
      if (S.main) { gl.deleteFramebuffer(S.main.fb); gl.deleteTexture(S.main.tex); }
      if (S.glass) { gl.deleteFramebuffer(S.glass.fb); gl.deleteTexture(S.glass.tex); }
      S.main = make(); S.glass = null; S.size = size;
    }
    if (glass && !S.glass) S.glass = make();
    return S;
  }

  function upload(m) {
    const { gl } = R;
    if (m._gpu && m._gpu.gl === gl && m._gpu.version === m.version) return m._gpu;
    if (m._gpu && m._gpu.gl === gl) { gl.deleteVertexArray(m._gpu.vao); m._gpu.buffers.forEach(b => gl.deleteBuffer(b)); }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = (target, data) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
    const bp = buf(gl.ARRAY_BUFFER, m.positions);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const bn = buf(gl.ARRAY_BUFFER, m.normals);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const extra = [];
    // Extra per-vertex attributes (grass blades: root and height, random number and length).
    for (const [loc, [data, size]] of Object.entries(m.extra || {})) {
      extra.push(buf(gl.ARRAY_BUFFER, data));
      gl.enableVertexAttribArray(+loc);
      gl.vertexAttribPointer(+loc, size, gl.FLOAT, false, 0, 0);
    }
    const bi = buf(gl.ELEMENT_ARRAY_BUFFER, m.indices);
    gl.bindVertexArray(null);
    m._gpu = { gl, vao, buffers: [bp, bn, bi, ...extra], count: m.indices.length, version: m.version };
    return m._gpu;
  }

  // Collects visible mesh nodes with world matrices and world-space bounds, and the
  // particle systems and plumes, which draw themselves.
  function collect(scene) {
    const items = [], fx = [];
    const walk = (node, parentM) => {
      if (!node.visible) return;
      const world = m4.multiply(parentM, node.local());
      if (node.isParticles || node.isPlume) fx.push({ node, world, center: m4.apply(world, [0, 0, 0]) });
      else if (node.mesh && node.mesh.indices.length) {
        const b = node.mesh.bounds;
        const c = m4.apply(world, b.center);
        const sx = Math.hypot(world[0], world[1], world[2]), sy = Math.hypot(world[4], world[5], world[6]), sz = Math.hypot(world[8], world[9], world[10]);
        items.push({ node, world, center: c, radius: b.radius * Math.max(sx, sy, sz) });
      }
      for (const c of node.children) walk(c, world);
    };
    walk(scene, m4.identity());
    items.fx = fx;
    return items;
  }

  function sceneBounds(items) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const it of items) {
      const b = it.node.mesh.bounds;
      for (let i = 0; i < 8; i++) {
        const p = m4.apply(it.world, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
      }
    }
    if (!items.length) return { min: [-1, -1, -1], max: [1, 1, 1], center: [0, 0, 0], radius: 1 };
    const center = v3.lerp(min, max, 0.5);
    return { min, max, center, radius: Math.max(1e-3, v3.dist(min, max) / 2) };
  }

  const orbitDir = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];

  // Frames the scene's bounding box as seen from one direction: centers it and
  // finds the distance (or ortho half-height) at which it fills `margin` of the view.
  function frameFit(bounds, dir, fov, aspect, margin, fixedTarget) {
    const z = v3.norm(dir);
    let x = v3.cross([0, 1, 0], z);
    if (v3.len(x) < 1e-6) x = v3.cross([0, 0, 1], z);
    x = v3.norm(x);
    const y = v3.cross(z, x);
    const corners = [];
    for (let i = 0; i < 8; i++) corners.push([i & 1 ? bounds.max[0] : bounds.min[0], i & 2 ? bounds.max[1] : bounds.min[1], i & 4 ? bounds.max[2] : bounds.min[2]]);
    let target = fixedTarget;
    if (!target) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        const r = v3.sub(c, bounds.center), px = v3.dot(r, x), py = v3.dot(r, y);
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      target = v3.add(bounds.center, v3.add(v3.scale(x, (x0 + x1) / 2), v3.scale(y, (y0 + y1) / 2)));
    }
    const t = Math.tan(fov / 2);
    let distance = 0, half = 0;
    for (const c of corners) {
      const r = v3.sub(c, target), vx = Math.abs(v3.dot(r, x)), vy = Math.abs(v3.dot(r, y)), vz = v3.dot(r, z);
      half = Math.max(half, vy / margin, vx / (aspect * margin));
      if (fov > 0) distance = Math.max(distance, vz + vx / (t * aspect * margin), vz + vy / (t * margin));
    }
    if (!(fov > 0)) distance = bounds.radius * 4;
    return { target, distance: Math.max(distance, bounds.radius * 0.5), half: Math.max(half, 1e-3) };
  }

  // Camera from orbit angles. yaw/pitch match g.view3d: positive pitch looks from above.
  // Unless distance (and target) are given, the scene is framed once from the first
  // view and that framing is kept, so turning the view doesn't make it zoom in and out.
  function camera(cam, scene, bounds, aspect) {
    // A lens's focal length (mm, on a 36 x 24 mm sensor) sets the field of view when no fov is given.
    const fovDeg = cam.fov ?? (cam.focal ? (2 * Math.atan(12 / cam.focal) * 180) / Math.PI : 28);
    const fov = (fovDeg * Math.PI) / 180;
    const yaw = cam.yaw ?? -0.6, pitch = cam.pitch ?? 0.4;
    const dir = orbitDir(yaw, pitch);
    const margin = cam.margin ?? 0.86;
    let target = cam.target, distance = cam.distance, half = cam.half;
    if (distance == null || target == null || (!(fov > 0) && half == null)) {
      const key = `${aspect.toFixed(2)}|${fovDeg}|${margin}|${cam.target ? cam.target.join(",") : "auto"}`;
      if (cam.fit === "always" || !scene._fit || scene._fit.key !== key) {
        scene._fit = { key, ...frameFit(bounds, cam.fitFrom ? orbitDir(cam.fitFrom.yaw, cam.fitFrom.pitch) : dir, fov, aspect, margin, cam.target) };
      }
      target = target ?? scene._fit.target;
      distance = distance ?? scene._fit.distance;
      half = half ?? scene._fit.half;
    }
    const zoom = cam.zoom ?? 1;
    if (fov > 0) distance /= zoom;
    const eye = v3.add(target, v3.scale(dir, distance));
    const view = m4.lookAt(eye, target, [0, 1, 0]);
    const reach = v3.dist(target, bounds.center) + bounds.radius * (cam.reach ?? 1);
    const near = Math.max(distance - reach * 1.5, distance * 0.02), far = distance + reach * 1.5;
    let proj, worldPerPx, tanHalf;
    if (fov > 0) {
      proj = m4.perspective(fov, aspect, near, far);
      worldPerPx = 2 * distance * Math.tan(fov / 2);
      tanHalf = [Math.tan(fov / 2) * aspect, Math.tan(fov / 2)];
    } else {
      const hh = half / zoom;
      proj = m4.ortho(-hh * aspect, hh * aspect, -hh, hh, near, far);
      worldPerPx = 2 * hh;
      tanHalf = [hh * aspect, hh];
    }
    const forward = v3.norm(v3.sub(target, eye));
    return { eye, target, view, proj, vp: m4.multiply(proj, view), near, far, ortho: !(fov > 0), worldPerPx, distance, tanHalf, forward };
  }

  // Camera-locked light directions (view space to world), or the scene's fixed key.
  function lightDir(scene, cam) {
    if (Array.isArray(scene.light)) return v3.norm(scene.light);
    const inv = m4.invert(cam.view);
    return v3.norm(m4.applyDir(inv, [-0.45, 0.75, 0.55]));
  }
  const viewToWorld = (cam, d) => v3.norm(m4.applyDir(m4.invert(cam.view), d));

  // ---------- particles on the GPU ----------
  // Transform feedback ping-pongs two buffer sets: each step reads one and writes the other.
  function particleGPU(sys, n) {
    const { gl } = R;
    let G = sys._gpu;
    if (G && G.gl === gl && G.count === sys.count) return G;
    const count = sys.count;
    G = sys._gpu = { gl, count, sets: [], cur: 0 };
    for (let s = 0; s < 2; s++) {
      const p = gl.createBuffer(), v = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, p); gl.bufferData(gl.ARRAY_BUFFER, count * 16, gl.DYNAMIC_COPY);
      gl.bindBuffer(gl.ARRAY_BUFFER, v); gl.bufferData(gl.ARRAY_BUFFER, count * 16, gl.DYNAMIC_COPY);
      const vao = divisor => {
        const a = gl.createVertexArray();
        gl.bindVertexArray(a);
        gl.bindBuffer(gl.ARRAY_BUFFER, p); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, divisor);
        gl.bindBuffer(gl.ARRAY_BUFFER, v); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, divisor);
        gl.bindVertexArray(null);
        return a;
      };
      G.sets.push({ p, v, update: vao(0), draw: vao(1) });
    }
    G.tf = gl.createTransformFeedback();
    if (sys._samples) {
      const S = sys._samples, N = S.length / 6, rows = Math.ceil(N / 1024) * 2, data = new Float32Array(1024 * rows * 4);
      for (let j = 0; j < N; j++) {
        const x = j % 1024, y = Math.floor(j / 1024) * 2;
        data.set([S[j * 6], S[j * 6 + 1], S[j * 6 + 2], 1], (y * 1024 + x) * 4);
        data.set([S[j * 6 + 3], S[j * 6 + 4], S[j * 6 + 5], 0], ((y + 1) * 1024 + x) * 4);
      }
      G.samples = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, G.samples);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1024, rows, 0, gl.RGBA, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      G.nSamples = N;
    }
    return G;
  }
  // A buffer the CPU integrator's state is copied into each frame, laid out like the GPU's.
  function particleCPUBuffer(sys) {
    const { gl } = R;
    let G = sys._cpuGpu;
    if (G && G.gl === gl && G.count === sys.count) return G;
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, sys.count * 32, gl.DYNAMIC_DRAW);
    const a = gl.createVertexArray();
    gl.bindVertexArray(a);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(1, 1);
    const pts = gl.createVertexArray();
    gl.bindVertexArray(pts);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
    G = sys._cpuGpu = { gl, count: sys.count, buffer: b, draw: a, points: pts };
    return G;
  }
  const SHAPE_ID = { point: 0, disk: 1, ring: 2, cone: 3, sphere: 4, box: 5, line: 6, mesh: 7 };
  function emitterUniforms(sys) {
    const E = sys.emitter, sp = E.speed ?? 1, s = Array.isArray(sp) ? sp : [sp, sp];
    const along = E.along === "normal" ? 1 : E.along === "radial" ? 2 : 0;
    const pos = E.position || [0, 0, 0];
    const end = E.shape === "line" ? (E.to || [0.5, 0, 0]) : E.size || [1, 1, 1];
    const start = E.shape === "line" ? (E.from || pos) : pos;
    return {
      uEm0: [SHAPE_ID[E.shape] ?? 0, E.radius ?? 0.5, E.shape === "cone" ? (E.angle ?? 0.4) : (E.thickness ?? 0), E.rake | 0],
      uEm1: [...start, E.spread ?? 0],
      uEm2: [...(E.direction || [0, 1, 0]), s[0]],
      uEm3: [s[1], E.thermal ?? 0, along, E.surface ? 1 : 0],
      uEm4: [...end, sys._samples ? sys._samples.length / 6 : 0],
    };
  }
  // Flow-field uniforms; a tube flow's station table goes to texture unit 11 as a float texture.
  function flowUniforms(fl) {
    const u = {
      uFlowA: fl ? [fl.kind, fl.U, fl.alpha, fl.S] : [-1, 0, 0, 1],
      uFlowB: fl ? [...fl.center, fl.mid] : [0, 0, 0, 0],
      uFlowC: fl ? [fl.mu[0], fl.mu[1], fl.kind === 1 ? fl.R : fl.a, fl.gamma] : [0, 0, 0, 0],
      uFlowTex: 11,
    };
    const { gl } = R;
    gl.activeTexture(gl.TEXTURE11);
    if (fl && fl.kind === 3) {
      if (!fl._tex || fl._texGl !== gl) {
        fl._texGl = gl;
        fl._tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, fl._tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, fl.n, 2, 0, gl.RGBA, gl.FLOAT, fl.data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      } else gl.bindTexture(gl.TEXTURE_2D, fl._tex);
      Object.assign(u, { uFlowD: [fl.y0, fl.dy, fl.n, fl.U0], uFlowE: [fl.q[0], fl.q[1], 0, 0], uFlowM: fl.M, uFlowMI: fl.MI });
    } else gl.bindTexture(gl.TEXTURE_2D, R.dummyFloat || (R.dummyFloat = (() => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 2, 0, gl.RGBA, gl.FLOAT, new Float32Array(8)); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; })()));
    gl.activeTexture(gl.TEXTURE0);
    return u;
  }
  function forceUniforms(F) {
    const u = {
      uGrav: [...F.g, F.drag], uWind: [...F.wind, F.buoyancy], uTurb: [...F.turb, 0],
      uVortA: F.vortex ? [...F.vortex.c, F.vortex.s] : [0, 0, 0, 0], uVortB: F.vortex ? [...F.vortex.a, F.vortex.core] : [0, 1, 0, 0.2],
      uVortC: [F.vortex ? F.vortex.pull : 0, F.vortex ? 1 : 0, 0, 0],
      uNAttr: F.attractors.length, uNPlane: F.planes.length, uNSph: F.spheres.length,
      uKillMin: F.kill ? [...F.kill.min, 1] : [0, 0, 0, 0], uKillMax: F.kill ? [...F.kill.max, 0] : [0, 0, 0, 0],
      ...flowUniforms(F.flow),
    };
    const attr = new Float32Array(16), attrR = [0.1, 0.1, 0.1, 0.1];
    F.attractors.forEach((a, j) => { attr.set([...a.p, a.s], j * 4); attrR[j] = a.r; });
    const pl = new Float32Array(32), plb = new Float32Array(32);
    F.planes.forEach((c, j) => { pl.set([...c.n, c.d], j * 4); plb.set([c.e, c.fr, c.u, 0], j * 4); });
    const sp = new Float32Array(16), spb = new Float32Array(16);
    F.spheres.forEach((c, j) => { sp.set([...c.c, c.r], j * 4); spb.set([c.e, c.inside, 0, 0], j * 4); });
    return Object.assign(u, { uAttr: attr, uAttrR: attrR, uPlane: pl, uPlaneB: plb, uSph: sp, uSphB: spb });
  }
  // Brings a system to its time, on the GPU unless it asked for the CPU (or measures hits).
  function stepParticles(sys, n) {
    const t = sys.time ?? sys.scene().time ?? 0;
    sys.prepare();
    // Which integrator holds the state (webgpu section); a change starts the state over.
    const be = sys.cpu || sys.measure || backendOf(sys) === "cpu" ? "cpu" : xStepParticles(sys, -1) ? "webgpu" : "tf";
    if (sys._xm !== be) { sys._xm = be; sys._n = null; if (be !== "webgpu" && sys._x) { sys._x.destroy(); sys._x = null; sys._state = null; } }
    if (be === "cpu") { sys.simulate(t, n); sys._mode = "cpu"; return; }
    if (be === "webgpu" && xStepParticles(sys, n, t)) { sys._mode = "cpu"; return; }
    sys._mode = "gpu";
    const { gl } = R;
    const G = particleGPU(sys, n);
    const P = prog("pupdate");
    const M = sys.world(), F = sys.params(), h = sys.step;
    let ready = false;
    const setup = () => {
      if (ready) return;
      ready = true;
      gl.useProgram(P.p);
      setAll(P, { uSeed: sys.seed, uLife: [sys.lifeRange[0], sys.period, 0, 0], uH: h, uEmitM: M, ...emitterUniforms(sys), ...forceUniforms(F) });
      if (G.samples) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.samples); setU(P, "uSamples", 0); }
      else { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.dummyColor); setU(P, "uSamples", 0); }
    };
    sys.advanceWith(t, n, () => {
      const init = new Float32Array(G.count * 4);
      for (let i = 0; i < G.count; i++) init[i * 4 + 3] = -1e6;
      for (const s of G.sets) { gl.bindBuffer(gl.ARRAY_BUFFER, s.p); gl.bufferSubData(gl.ARRAY_BUFFER, 0, init); gl.bindBuffer(gl.ARRAY_BUFFER, s.v); gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(G.count * 4)); }
      G.cur = 0;
    }, tEnd => {
      setup();
      const src = G.sets[G.cur], dst = G.sets[1 - G.cur];
      setU(P, "uT", tEnd);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindVertexArray(src.update);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, G.tf);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, dst.p);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, dst.v);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, n);
      gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.bindVertexArray(null);
      G.cur = 1 - G.cur;
    });
  }
  // The draw VAO holding the current state, and the time that state is at.
  function particleSource(sys) {
    if (sys._mode === "cpu") {
      const G = particleCPUBuffer(sys), { gl } = R;
      // Upload only a state that changed since the last draw (a frame draws a system several times).
      const key = `${sys._t}|${sys._n}|${sys._count}|${sys._sig}`;
      if (G.src !== sys._state || G.key !== key) { gl.bindBuffer(gl.ARRAY_BUFFER, G.buffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, sys._state); G.src = sys._state; G.key = key; }
      return G.draw;
    }
    return sys._gpu.sets[sys._gpu.cur].draw;
  }
  function particleColors(sys) {
    const c = sys.color ?? (sys.style === "smoke" ? (pageDark() ? "#9a9894" : "#c9c6c0") : sys.style === "streak" ? "blue" : sys.style === "sphere" ? "porcelain" : "ink");
    const pal = (typeof window !== "undefined" && window.palette) || {};
    const one = x => (ACCENTS.includes(x) ? hexRgb(pal[x] || "#888888") : colorOf(x === "ink" ? (pal.ink || "#222222") : x, true));
    const [a, b] = Array.isArray(c) ? c.map(one) : [one(c), one(c)];
    const by = sys.colorBy === "speed" ? 2 : sys.colorBy === "life" || Array.isArray(c) ? 1 : 0;
    return { uColA: a, uColB: b, uColorBy: [by, ...(sys.range || [0, 1]), 0] };
  }

  // ---------- webgpu ----------
  // WebGPU compute for particles. With a WebGPU device, a system steps in a compute shader: each
  // slot is its own thread and runs a whole run of fixed steps in one dispatch (slots never
  // interact), with the same physics, hashes, and time grid as the transform-feedback shader
  // above, so the same seed gives the same picture within float rounding. WebGL2 still draws the
  // particles: the state comes back without stalling (mapAsync) and is uploaded into the buffer
  // the CPU integrator uses, so what's drawn is the newest state back from the GPU, a frame
  // behind its clock while it runs (_t says which time it is); when nothing steps after a copy
  // lands, a redraw is asked for, so a still frame settles on exactly time t.
  // E3.backend says what particles step on: "webgpu", "webgl2" (transform feedback), or "cpu";
  // setting it forces one ("auto" undoes it), as do ?backend= in the URL, window.SAFIS_BACKEND,
  // and a system's own `backend` option. Systems that measure collider hits stay on the CPU.
  // Detection runs once per page and is shared with the effects kit (window.__safisGPU).
  const GPUX = (typeof window !== "undefined" ? (window.__safisGPU ||= (() => {
    const S = { device: null, soft: false, state: "none", error: null, epoch: 0, force: null, errors: [], name: "", ready: Promise.resolve() };
    try {
      const m = /[?&]backend=(webgpu|webgl2|cpu)\b/.exec((typeof location !== "undefined" && location.search) || "");
      S.force = (m && m[1]) || (["webgpu", "webgl2", "cpu"].includes(window.SAFIS_BACKEND) ? window.SAFIS_BACKEND : null);
    } catch {}
    const gpu = typeof navigator !== "undefined" ? navigator.gpu : null;
    const redraw = () => { try { window.dispatchEvent(new Event("safis:redraw")); } catch {} };
    S.start = () => {
      if (!gpu || S.state === "pending" || S.state === "ready") return S.ready;
      S.state = "pending";
      return (S.ready = (async () => {
        try {
          const a = await gpu.requestAdapter({ powerPreference: "high-performance" });
          if (!a) throw new Error("no WebGPU adapter");
          const i = a.info || {};
          S.name = [i.vendor, i.architecture, i.description].filter(Boolean).join(" ");
          S.soft = !!a.isFallbackAdapter || /swiftshader|llvmpipe|software|basic render/i.test(S.name);
          const L = a.limits, d = await a.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: L.maxStorageBufferBindingSize, maxBufferSize: L.maxBufferSize } });
          d.lost.then(r => { if (S.device === d) { S.device = null; S.state = "lost"; S.error = r.message; S.epoch++; redraw(); } });
          d.addEventListener?.("uncapturederror", e => { if (S.errors.length < 20) S.errors.push(String(e.error?.message ?? e)); });
          S.device = d; S.state = "ready"; S.epoch++;
        } catch (e) { S.state = "failed"; S.error = String((e && e.message) || e); }
        redraw();
      })());
    };
    S.use = force => (S.device && (force === "webgpu" || !S.soft) ? S.device : null);
    S.steps = 0;
    S.settle = (get = () => S.steps) => { const at = get(), raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : f => setTimeout(f, 16); raf(() => raf(() => { if (get() === at) redraw(); })); };
    if (S.force !== "webgl2" && S.force !== "cpu") S.start();
    return S;
  })()) : { use: () => null, start: () => Promise.resolve(), state: "none", force: null, errors: [], steps: 0 });
  let e3Force = null, xBad = false;
  const backendOf = sys => sys.backend ?? e3Force ?? GPUX.force;
  // The integrator as compute: G_SLOT, G_FLOW, and VS_PUPDATE above, in WGSL. St holds two vec4
  // per slot (position and generation, velocity and hits), T the end times of the steps to run.
  const WGSL_PARTICLES = `
struct U { n: i32, steps: i32, seed: u32, nattr: i32, nplane: i32, nsph: i32, kill: i32, pad: i32,
  life: vec4<f32>, h: vec4<f32>, emitM: mat4x4<f32>, em0: vec4<f32>, em1: vec4<f32>, em2: vec4<f32>, em3: vec4<f32>, em4: vec4<f32>,
  grav: vec4<f32>, wind: vec4<f32>, turb: vec4<f32>, vortA: vec4<f32>, vortB: vec4<f32>, vortC: vec4<f32>, attr: array<vec4<f32>, 4>, attrR: vec4<f32>,
  plane: array<vec4<f32>, 8>, planeB: array<vec4<f32>, 8>, sph: array<vec4<f32>, 4>, sphB: array<vec4<f32>, 4>, killMin: vec4<f32>, killMax: vec4<f32>,
  flowA: vec4<f32>, flowB: vec4<f32>, flowC: vec4<f32>, flowD: vec4<f32>, flowE: vec4<f32>, flowM: mat4x4<f32>, flowMI: mat4x4<f32> }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> St: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> T: array<f32>;
@group(0) @binding(3) var<storage, read> Sm: array<f32>;
@group(0) @binding(4) var<storage, read> Tb: array<vec4<f32>>;
const PI = 3.141592653589793;
fn hashu(x0: u32) -> u32 { var x = x0; x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
fn hash3(p: vec3<i32>, s: u32) -> f32 { return f32(hashu((u32(p.x) * 73856093u) ^ (u32(p.y) * 19349663u) ^ (u32(p.z) * 83492791u) ^ s) >> 8u) / 8388608.0 - 1.0; }
fn noised(x: vec3<f32>, s: u32) -> vec4<f32> {
  let i = floor(x); let f = x - i; let p = vec3<i32>(i);
  let uu = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let a = hash3(p, s); let b = hash3(p + vec3<i32>(1, 0, 0), s); let c = hash3(p + vec3<i32>(0, 1, 0), s); let d = hash3(p + vec3<i32>(1, 1, 0), s);
  let e = hash3(p + vec3<i32>(0, 0, 1), s); let g = hash3(p + vec3<i32>(1, 0, 1), s); let h = hash3(p + vec3<i32>(0, 1, 1), s); let k = hash3(p + vec3<i32>(1, 1, 1), s);
  let k1 = b - a; let k2 = c - a; let k3 = e - a; let k4 = a - b - c + d; let k5 = a - c - e + h; let k6 = a - b - e + g; let k7 = -a + b + c - d + e - g - h + k;
  return vec4<f32>(a + k1 * uu.x + k2 * uu.y + k3 * uu.z + k4 * uu.x * uu.y + k5 * uu.y * uu.z + k6 * uu.z * uu.x + k7 * uu.x * uu.y * uu.z,
    du * vec3<f32>(k1 + k4 * uu.y + k6 * uu.z + k7 * uu.y * uu.z, k2 + k5 * uu.z + k4 * uu.x + k7 * uu.z * uu.x, k3 + k6 * uu.x + k5 * uu.y + k7 * uu.x * uu.y));
}
fn curl(p: vec3<f32>) -> vec3<f32> {
  let a = noised(p, 0u); let b = noised(p + vec3<f32>(31.4, 17.2, 5.9), 0u); let c = noised(p + vec3<f32>(-11.3, 47.1, 23.7), 0u);
  return vec3<f32>(c.z - b.w, a.w - c.y, b.y - a.z);
}
fn rnd(i: i32, k: f32, c: u32) -> f32 { return f32(hashu((u32(i) * 0x9E3779B1u) ^ hashu(u32(i32(k)) + c * 0x632BE5ABu + u.seed)) >> 8u) / 16777216.0; }
fn lifeOf(i: i32, k: f32) -> f32 { if (u.life.y <= 0.0) { return 1e9; } return mix(u.life.x, u.life.y, rnd(i, k, 1u)); }
fn m3(m: mat4x4<f32>) -> mat3x3<f32> { return mat3x3<f32>(m[0].xyz, m[1].xyz, m[2].xyz); }
fn cmul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> { return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
fn cdiv(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> { let d = max(dot(b, b), 1e-30); return vec2<f32>(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d; }
fn csqrt(a: vec2<f32>) -> vec2<f32> { let r = length(a); let t = atan2(a.y, a.x) * 0.5; return sqrt(r) * vec2<f32>(cos(t), sin(t)); }
fn tubeFlow(pw: vec3<f32>) -> vec4<f32> {
  let q = (u.flowMI * vec4<f32>(pw, 1.0)).xyz; let M = m3(u.flowM);
  let r = length(q.xz); let fi = (q.y - u.flowD.x) / u.flowD.y; let n = i32(u.flowD.z + 0.5);
  if (fi < 0.0 || fi > f32(n - 1)) { return vec4<f32>(M * vec3<f32>(0.0, u.flowD.w, 0.0), 1.0); }
  let i = min(n - 2, i32(floor(fi))); let f = fi - f32(i);
  let A = Tb[i]; let B = Tb[i + 1]; let ra = Tb[n + i].xy; let rb = Tb[n + i + 1].xy;
  let heat = mix(ra.y, rb.y, f); let v = mix(A, B, f); let d = (B - A) / u.flowD.y; let x0 = mix(ra.x, rb.x, f); let dx0 = (rb.x - ra.x) / u.flowD.y;
  var a: f32; var b: f32; var da: f32; var db: f32; var Q: f32;
  if (r < v.x - 1e-4) { return vec4<f32>(0.0); }
  if (r <= v.y) { a = v.x; b = v.y; da = d.x; db = d.y; Q = u.flowE.x * heat; }
  else if (r < v.z) { return vec4<f32>(0.0); }
  else if (r <= v.w) { a = v.z; b = v.w; da = d.z; db = d.w; Q = u.flowE.y; }
  else if (r < x0) { return vec4<f32>(0.0); }
  else { let uy = u.flowD.w; let ur = select(0.0, uy * x0 * dx0 / r, r > 1e-4); let lv = vec3<f32>(select(0.0, ur * q.x / r, r > 1e-4), uy, select(0.0, ur * q.z / r, r > 1e-4)); return vec4<f32>(M * lv, 1.0); }
  let den = max(b * b - a * a, 1e-6); let uy = Q / den; let eta = (r * r - a * a) / den;
  let ur = select(0.0, uy * (a * da * (1.0 - eta) + b * db * eta) / r, r > 1e-4);
  return vec4<f32>(M * vec3<f32>(select(0.0, ur * q.x / r, r > 1e-4), uy, select(0.0, ur * q.z / r, r > 1e-4)), 1.0);
}
fn flowAt(p: vec3<f32>) -> vec4<f32> {
  let kind = i32(u.flowA.x + 0.5); let Uf = u.flowA.y;
  if (kind == 0) { return vec4<f32>(Uf, 0.0, 0.0, 1.0); }
  if (kind == 3) { return tubeFlow(p); }
  let al = u.flowA.z; let ca = cos(al); let sa = sin(al);
  let x = (p.xy - u.flowB.xy) / u.flowA.w; let g = u.flowC.w / (2.0 * PI);
  if (kind == 1) {
    let R = u.flowC.z;
    if (dot(x, x) < R * R) { return vec4<f32>(0.0); }
    let t = cdiv(vec2<f32>(R * R, 0.0), cmul(x, x)); let w = vec2<f32>(Uf * (1.0 - t.x), -Uf * t.y) + cdiv(vec2<f32>(0.0, g), x);
    return vec4<f32>(w.x, -w.y, 0.0, 1.0);
  }
  let z = vec2<f32>(x.x * ca - x.y * sa + u.flowB.w, x.x * sa + x.y * ca);
  let s = csqrt(vec2<f32>(z.x * z.x - z.y * z.y - 4.0, 2.0 * z.x * z.y));
  let z1 = (z + s) * 0.5; let z2 = (z - s) * 0.5; let mu = u.flowC.xy; let d1 = length(z1 - mu); let d2 = length(z2 - mu);
  let ze = select(z2, z1, d1 >= d2);
  if (max(d1, d2) < u.flowC.z * 1.002) { return vec4<f32>(0.0); }
  let zm = ze - mu;
  let t = cdiv(cmul(vec2<f32>(u.flowC.z * u.flowC.z, 0.0), vec2<f32>(cos(al), sin(al))), cmul(zm, zm));
  let dW = Uf * (vec2<f32>(cos(al), -sin(al)) - t) + cdiv(vec2<f32>(0.0, g), zm);
  let iz = cdiv(vec2<f32>(1.0, 0.0), cmul(ze, ze)); let dw = cdiv(dW, vec2<f32>(1.0 - iz.x, -iz.y));
  let uu = dw.x; let vv = -dw.y;
  return vec4<f32>(uu * ca + vv * sa, -uu * sa + vv * ca, 0.0, 1.0);
}
fn emit(i: i32, k: f32, po: ptr<function, vec3<f32>>, vo: ptr<function, vec3<f32>>) {
  let shape = u.em0.x; let R = u.em0.y; let dir = normalize(u.em2.xyz);
  let tmp = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(dir.y) < 0.9);
  let uu = normalize(cross(dir, tmp)); let w = cross(dir, uu); let lanes = u.em0.w;
  var n = dir; var p = vec3<f32>(0.0);
  if (shape > 0.5 && shape < 3.5) {
    let a = 6.2831853 * rnd(i, k, 10u);
    var rr = R * sqrt(rnd(i, k, 11u));
    if (shape > 1.5 && shape < 2.5) { rr = R + u.em0.z * (rnd(i, k, 11u) - 0.5); }
    let radial = uu * cos(a) + w * sin(a);
    p = radial * rr;
    if (shape > 2.5) { n = normalize(dir + radial * tan(u.em0.z) * select(1.0, rr / R, R > 0.0)); }
    if (shape > 1.5 && shape < 2.5 && u.em3.z > 1.5) { n = radial; }
  } else if (shape > 3.5 && shape < 4.5) {
    let z = 2.0 * rnd(i, k, 10u) - 1.0; let a = 6.2831853 * rnd(i, k, 11u); let q = sqrt(1.0 - z * z);
    n = vec3<f32>(q * cos(a), z, q * sin(a));
    p = n * select(R * pow(rnd(i, k, 12u), 1.0 / 3.0), R, u.em3.w > 0.5);
  } else if (shape > 4.5 && shape < 5.5) {
    var ry = rnd(i, k, 11u);
    if (lanes > 0.5) { ry = (floor(ry * lanes) + 0.5) / lanes; }
    p = (vec3<f32>(rnd(i, k, 10u), ry, rnd(i, k, 12u)) - 0.5) * u.em4.xyz;
  } else if (shape > 5.5 && shape < 6.5) {
    var t = rnd(i, k, 10u);
    if (lanes > 0.5) { t = (floor(t * lanes) + 0.5) / lanes; }
    p = (u.em4.xyz - u.em1.xyz) * t;
  } else if (shape > 6.5) {
    let j = min(i32(u.em4.w) - 1, i32(rnd(i, k, 10u) * u.em4.w));
    p = vec3<f32>(Sm[j * 6], Sm[j * 6 + 1], Sm[j * 6 + 2]) - u.em1.xyz;
    n = vec3<f32>(Sm[j * 6 + 3], Sm[j * 6 + 4], Sm[j * 6 + 5]);
  }
  p += u.em1.xyz;
  var d = dir;
  if (u.em3.z > 0.5 || (shape > 2.5 && shape < 3.5)) { d = n; }
  let spread = u.em1.w;
  if (spread > 0.0) {
    let ct = 1.0 - rnd(i, k, 13u) * (1.0 - cos(spread)); let st = sqrt(max(0.0, 1.0 - ct * ct)); let a = 6.2831853 * rnd(i, k, 14u);
    let du = normalize(cross(d, select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(d.y) < 0.9))); let dw = cross(d, du);
    d = d * ct + du * st * cos(a) + dw * st * sin(a);
  }
  var v = d * mix(u.em2.w, u.em3.x, rnd(i, k, 15u));
  if (u.em3.y > 0.0) {
    var gs: vec3<f32>;
    for (var c = 0u; c < 3u; c++) { gs[c] = sqrt(-2.0 * log(max(1e-7, rnd(i, k, 16u + c * 2u)))) * cos(6.2831853 * rnd(i, k, 17u + c * 2u)); }
    v += gs * u.em3.y;
  }
  *po = (u.emitM * vec4<f32>(p, 1.0)).xyz;
  *vo = m3(u.emitM) * v;
}
@compute @workgroup_size(64) fn pstep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = i32(gid.x); if (i >= u.n) { return; }
  var A = St[i * 2]; var B = St[i * 2 + 1];
  for (var s = 0; s < u.steps; s++) {
    let tT = T[s]; let P = u.life.y;
    var k = 0.0; var age = tT;
    if (P > 0.0) { let ph = fract(f32(i) * 0.6180339887) * P; k = floor((tT - ph) / P); age = tT - (ph + k * P); }
    let life = lifeOf(i, k);
    var p = A.xyz; var v = B.xyz; var gen = A.w; var hit = 0.0; var h = u.h.x;
    if (floor(gen) != k) {
      if (age > u.h.x + 1e-5 && P > 0.0) { A = vec4<f32>(p, k + 0.5); B = vec4<f32>(v, 0.0); continue; }
      emit(i, k, &p, &v); gen = k; h = clamp(age, 0.0, u.h.x);
    }
    if (gen != k || age > life) { A = vec4<f32>(p, gen); B = vec4<f32>(v, 0.0); continue; }
    if (u.flowA.x > -0.5) {
      let f1 = flowAt(p);
      if (f1.w < 0.5) { A = vec4<f32>(p, k + 0.5); B = vec4<f32>(v, 0.0); continue; }
      let f2 = flowAt(p + f1.xyz * h * 0.5);
      v = select(f1.xyz, f2.xyz, f2.w > 0.5);
      if (u.turb.x > 0.0) { v += curl(p * u.turb.y + vec3<f32>(0.0, 0.0, tT * u.turb.z)) * u.turb.x; }
      p += v * h;
    } else {
      var acc = u.grav.xyz;
      acc.y += u.wind.w * max(0.0, 1.0 - age / life);
      if (u.turb.x > 0.0) { acc += curl(p * u.turb.y + vec3<f32>(0.0, 0.0, tT * u.turb.z)) * u.turb.x; }
      if (u.vortC.y > 0.5) { let r = p - u.vortA.xyz; let ax = u.vortB.xyz; let rp = r - ax * dot(r, ax); acc += u.vortA.w * cross(ax, rp) / (dot(rp, rp) + u.vortB.w * u.vortB.w) - rp * u.vortC.x; }
      for (var j = 0; j < u.nattr; j++) { let d = u.attr[j].xyz - p; acc += d * u.attr[j].w / pow(dot(d, d) + u.attrR[j] * u.attrR[j], 1.5); }
      let kd = u.grav.w;
      if (kd > 0.0) { let e = exp(-kd * h); let f = (1.0 - e) / kd; let vt = u.wind.xyz + acc / kd; p += vt * h + (v - vt) * f; v = vt + (v - vt) * e; }
      else { v += acc * h; p += v * h; }
    }
    for (var j = 0; j < u.nplane; j++) {
      let n = u.plane[j].xyz; let sd = dot(n, p) - u.plane[j].w;
      if (sd >= 0.0) { continue; }
      p -= n * sd;
      let vn = dot(n, v) - u.planeB[j].z;
      if (vn < 0.0) { let jj = -(1.0 + u.planeB[j].x) * vn; v += n * jj; if (u.planeB[j].y > 0.0) { let vn2 = dot(n, v); v -= (v - n * vn2) * u.planeB[j].y; } hit += jj; }
    }
    for (var j = 0; j < u.nsph; j++) {
      let d = p - u.sph[j].xyz; let L = max(length(d), 1e-9); let sg = u.sphB[j].y; let sd = (L - u.sph[j].w) * sg;
      if (sd >= 0.0) { continue; }
      let n = d * (sg / L); p -= n * sd;
      let vn = dot(n, v);
      if (vn < 0.0) { let jj = -(1.0 + u.sphB[j].x) * vn; v += n * jj; hit += jj; }
    }
    if (u.kill > 0 && (any(p < u.killMin.xyz) || any(p > u.killMax.xyz))) { gen = k + 0.5; }
    A = vec4<f32>(p, gen); B = vec4<f32>(v, hit);
  }
  St[i * 2] = A; St[i * 2 + 1] = B;
}`;
  // A system's WebGPU state: the slots, the uniforms, the steps queued since the last flush,
  // and the copy coming back. Made per device and count; mesh samples and tube tables ride along.
  function xParticles(sys, d) {
    const N = sys.count, mk = (size, usage, data) => { const b = d.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }); if (data) d.queue.writeBuffer(b, 0, data); return b; };
    const ST = GPUBufferUsage.STORAGE, TC = 2048;
    const mod = d.createShaderModule({ code: WGSL_PARTICLES });
    mod.getCompilationInfo?.().then(info => { const e = info.messages.filter(m => m.type === "error"); if (e.length) { xBad = true; GPUX.errors.push(`particles: ${e[0].message} (line ${e[0].lineNum})`); } }).catch(() => {});
    const pipe = d.createComputePipeline({ layout: "auto", compute: { module: mod, entryPoint: "pstep" } });
    const X = { d, count: N, pipe, state: mk(N * 32, ST), T: mk(TC * 4, ST), U: mk(1024, GPUBufferUsage.UNIFORM), Sm: mk(16, ST), Tb: mk(16, ST), stage: d.createBuffer({ size: N * 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
      pend: [], reset: false, busy: false, again: false, shown: null, shownT: 0, shownN: 0, groups: null, samples: null, table: null, ab: new ArrayBuffer(1024) };
    X.group = () => {
      const S = sys._samples, F = sys.flow ? flowSpec(sys.flow) : null, tab = F && F.kind === 3 ? F.data : null;
      if (S !== X.samples) { X.samples = S; X.Sm.destroy(); X.Sm = mk(S ? S.byteLength : 16, ST, S || null); X.groups = null; }
      if (tab !== X.table) { X.table = tab; X.Tb.destroy(); X.Tb = mk(tab ? tab.byteLength : 16, ST, tab || null); X.groups = null; }
      return (X.groups ||= d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [X.U, X.state, X.T, X.Sm, X.Tb].map((buffer, binding) => ({ binding, resource: { buffer } })) }));
    };
    // Uniforms from the system now: its emitter and forces packed as the transform feedback's.
    X.uniforms = (n, steps) => {
      const f = new Float32Array(X.ab), I = new Int32Array(X.ab), U32 = new Uint32Array(X.ab), F = sys.params(), E = emitterUniforms(sys);
      f.fill(0);
      I.set([n, steps], 0); U32[2] = sys.seed >>> 0; I.set([F.attractors.length, F.planes.length, F.spheres.length, F.kill ? 1 : 0], 3);
      f.set([sys.lifeRange[0], sys.period, 0, 0], 8); f[12] = sys.step; f.set(sys.world(), 16);
      f.set(E.uEm0, 32); f.set(E.uEm1, 36); f.set(E.uEm2, 40); f.set(E.uEm3, 44); f.set(E.uEm4, 48);
      f.set([...F.g, F.drag], 52); f.set([...F.wind, F.buoyancy], 56); f.set([...F.turb, 0], 60);
      if (F.vortex) { f.set([...F.vortex.c, F.vortex.s], 64); f.set([...F.vortex.a, F.vortex.core], 68); f.set([F.vortex.pull, 1, 0, 0], 72); } else f.set([0, 1, 0, 0.2], 68);
      F.attractors.forEach((a, j) => { f.set([...a.p, a.s], 76 + j * 4); f[92 + j] = a.r; });
      for (let j = F.attractors.length; j < 4; j++) f[92 + j] = 0.1;
      F.planes.forEach((c, j) => { f.set([...c.n, c.d], 96 + j * 4); f.set([c.e, c.fr, c.u, 0], 128 + j * 4); });
      F.spheres.forEach((c, j) => { f.set([...c.c, c.r], 160 + j * 4); f.set([c.e, c.inside, 0, 0], 176 + j * 4); });
      if (F.kill) { f.set([...F.kill.min, 1], 192); f.set([...F.kill.max, 0], 196); }
      const fl = F.flow;
      f.set(fl ? [fl.kind, fl.U, fl.alpha, fl.S] : [-1, 0, 0, 1], 200);
      if (fl) { f.set([...fl.center, fl.mid], 204); f.set([fl.mu[0], fl.mu[1], fl.kind === 1 ? fl.R : fl.a, fl.gamma], 208); }
      if (fl && fl.kind === 3) { f.set([fl.y0, fl.dy, fl.n, fl.U0], 212); f.set([fl.q[0], fl.q[1], 0, 0], 216); f.set(fl.M, 220); f.set(fl.MI, 236); }
      d.queue.writeBuffer(X.U, 0, X.ab);
    };
    // Runs the queued steps: one dispatch per 2048 steps, every slot looping through them.
    X.flush = n => {
      if (X.reset) { X.reset = false; const s0 = new Float32Array(N * 8); for (let i = 0; i < N; i++) s0[i * 8 + 3] = -1e6; d.queue.writeBuffer(X.state, 0, s0); }
      const g = X.group();
      while (X.pend.length) {
        const run = X.pend.splice(0, TC);
        X.uniforms(n, run.length);
        d.queue.writeBuffer(X.T, 0, new Float32Array(run));
        const e = d.createCommandEncoder(), p = e.beginComputePass();
        p.setPipeline(pipe); p.setBindGroup(0, g); p.dispatchWorkgroups(Math.ceil(n / 64)); p.end();
        d.queue.submit([e.finish()]);
        GPUX.steps++; X.runs = (X.runs || 0) + 1;
      }
    };
    // The copy back: one in flight; when it lands it becomes what's drawn.
    X.mirror = (t, n) => {
      if (X.busy) { X.again = [t, n]; return; }
      X.busy = true;
      const e = d.createCommandEncoder();
      e.copyBufferToBuffer(X.state, 0, X.stage, 0, N * 32);
      d.queue.submit([e.finish()]);
      X.stage.mapAsync(GPUMapMode.READ).then(() => {
        X.shown = new Float32Array(X.stage.getMappedRange().slice(0)); X.stage.unmap();
        X.shownT = t; X.shownN = n; X.busy = false;
        if (sys._x === X) { sys._state = X.shown; sys._t = t; sys._count = n; }
        if (X.again) { const [a, b] = X.again; X.again = false; X.mirror(a, b); } else { GPUX.settle(() => X.runs); const w = X.waiting || []; X.waiting = []; w.forEach(r => r()); }
      }).catch(() => { X.busy = false; });
    };
    X.sync = () => (X.busy ? new Promise(r => (X.waiting ||= []).push(r)) : Promise.resolve());
    X.destroy = () => { for (const b of [X.state, X.T, X.U, X.Sm, X.Tb, X.stage]) try { b.destroy(); } catch {} };
    return X;
  }
  // Steps a system on WebGPU when it should be; returns false to leave it to transform feedback.
  // The drawn state is the newest copy back (sys._state, at time sys._t).
  // n = -1 only asks whether it should.
  function xStepParticles(sys, n, t) {
    const f = backendOf(sys), d = f !== "webgl2" && f !== "cpu" && !xBad ? GPUX.use(f) : null;
    if (n < 0) return !!d;
    if (!d) return false;
    let X = sys._x;
    if (!X || X.d !== d || X.count !== sys.count) { if (X) X.destroy(); X = sys._x = xParticles(sys, d); X.n = null; }
    // The clock's bookkeeping (steps taken, settings, count, time) is the WebGPU state's own, so
    // transform feedback can keep its own and draw the frames before the first copy is back.
    const swap = () => { for (const k of ["_n", "_sig", "_count", "_t"]) { const v = sys[k]; sys[k] = X[k]; X[k] = v; } };
    let stepped = false;
    swap();
    try { sys.advanceWith(t, n, () => { X.pend = []; X.reset = true; }, tEnd => { X.pend.push(tEnd); stepped = true; }); } finally { swap(); }
    if (stepped || X.reset) { X.flush(n); X.mirror(X._t, n); }
    else if (!X.shown && !X.busy) X.mirror(X._t, n);
    if (!X.shown) return false;
    sys._state = X.shown; sys._t = X.shownT; sys._count = X.shownN;
    return true;
  }

  // ---------- volumetric media on the GPU ----------
  // `volume: true` (or options) on a "smoke" or "fire" system draws it as a medium (see the shaders).
  //   density   extinction scale [1]             erosion  how much billow noise eats the edges [0.6]
  //   detail    noise frequency, per world unit  flow     velocity the detail drifts with (default: wind and rise)
  //   ambient   occlusion of sky light [0.8]     shadow   key-light self-shadowing [1]
  //   powder    dark edges toward the light [0.5] occlusion  how much smoke hides flames behind it [0.25]
  //   hot       share of life the soot glows [0.3; fire 1]   thin  how fast a puff thins as it grows [1]
  //   resolution  cells along the longest side   bounds  [[x0, y0, z0], [x1, y1, z1]] (default: found by simulating)
  //   albedo    smoke color (default warm grey)
  const VDEF = { density: 1, erosion: 0.6, detail: null, flow: null, ambient: 0.8, shadow: 1, powder: 0.5, occlusion: 0.25, hot: null, thin: 1, resolution: null, bounds: null, albedo: null };
  const volumeOpts = sys => (sys.volume && (sys.style === "smoke" || sys.style === "fire") ? { ...VDEF, ...(sys.volume === true ? {} : sys.volume) } : null);
  const sizePair = sys => (Array.isArray(sys.size) ? sys.size : [sys.size, sys.size]);
  const volumeSigma = (sys, V) => (V.density * 8) / Math.max(1e-9, (sizePair(sys)[0] + sizePair(sys)[1]) / 2) * (sys.style === "fire" ? 0.35 : 1);
  // Tileable billow noise (inverted Worley, three octaves), 32³, made once.
  function noise3() {
    if (R.noise3) return R.noise3;
    const { gl } = R, N = 32, val = new Float32Array(N * N * N);
    for (const [c, w, salt] of [[4, 0.55, 1], [8, 0.3, 2], [16, 0.15, 3]]) {
      const pts = new Float32Array(c * c * c * 3);
      for (let i = 0; i < c * c * c; i++) for (let a = 0; a < 3; a++) pts[i * 3 + a] = rndU(i, salt, 40 + a, 9);
      const cs = N / c, wrap = v => ((v % c) + c) % c;
      for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const px = (x + 0.5) / cs, py = (y + 0.5) / cs, pz = (z + 0.5) / cs;
        const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
        let best = 9;
        for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const ix = cx + dx, iy = cy + dy, iz = cz + dz, j = (wrap(iz) * c + wrap(iy)) * c + wrap(ix);
          const fx = ix + pts[j * 3] - px, fy = iy + pts[j * 3 + 1] - py, fz = iz + pts[j * 3 + 2] - pz;
          best = Math.min(best, fx * fx + fy * fy + fz * fz);
        }
        val[(z * N + y) * N + x] += w * (1 - Math.min(1, Math.sqrt(best)));
      }
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of val) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const data = new Uint8Array(val.length);
    for (let i = 0; i < val.length; i++) data[i] = Math.round(((val[i] - lo) / (hi - lo || 1)) * 255);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, N, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.generateMipmap(gl.TEXTURE_3D);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT);
    R.noise3 = t;
    return t;
  }
  // The world box the medium lives in: given, or found by running a sample of the system on the
  // CPU over two lifetimes and padding by the largest puff. Cached until the system changes.
  function volumeBounds(sys, V) {
    if (V.bounds) return V.bounds;
    const W = sys.world();
    const key = JSON.stringify([sys.emitter, sys.forces, sys.colliders, sys.life, sys.size, sys.seed, Array.from(W)]);
    if (sys._vbKey === key) return sys._vb;
    const probe = new Particles({ count: 320, seed: sys.seed, life: sys.life, step: 1 / 15, prewarm: false, emitter: sys.emitter, forces: sys.forces, colliders: sys.colliders, kill: sys.kill, cpu: true });
    probe.matrix = W;
    const P = probe.period || 4, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const f of [0.35, 0.7, 1.05, 1.4, 1.75, 2.1]) {
      probe.simulate(P * f);
      for (const a of probe.alive()) for (let k = 0; k < 3; k++) { if (a.position[k] < min[k]) min[k] = a.position[k]; if (a.position[k] > max[k]) max[k] = a.position[k]; }
    }
    const pad = Math.max(...sizePair(sys)) * 0.55;
    if (!(min[0] <= max[0])) { const c = m4.apply(W, sys.emitter.position || [0, 0, 0]); for (let k = 0; k < 3; k++) { min[k] = c[k] - pad * 4; max[k] = c[k] + pad * 4; } }
    for (let k = 0; k < 3; k++) { const e = (max[k] - min[k]) * 0.06 + pad; min[k] -= e; max[k] += e; }
    sys._vbKey = key;
    sys._vb = [min, max];
    return sys._vb;
  }
  // Cubic cells over the box; the cell count along the longest side follows the device's tier.
  function volumeLayout(sys, V) {
    const [min, max] = volumeBounds(sys, V);
    const ext = [0, 1, 2].map(k => Math.max(1e-6, max[k] - min[k]));
    // Detail comes from the billow noise, not the grid, so a coarse grid looks nearly the same and
    // costs far less (the splat and light passes run once per slice).
    if (sys._vres == null) sys._vres = V.resolution ?? [36, 48, 60][Q.rank ?? startRank()];
    const voxel = Math.max(...ext) / sys._vres;
    const dims = ext.map(e => Math.max(4, Math.ceil(e / voxel)));
    const size = dims.map(d => d * voxel);
    return { dims, voxel, size, min: [0, 1, 2].map(k => (min[k] + max[k]) / 2 - size[k] / 2) };
  }
  function volumeGrid(sys, dims) {
    const { gl } = R;
    let G = sys._vg;
    if (G && G.gl === gl && G.dims.join() === dims.join()) return G;
    if (G && G.gl === gl) { gl.deleteTexture(G.dens); gl.deleteTexture(G.light); gl.deleteFramebuffer(G.fb); }
    const tex3 = (d, fmt, levels) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, t);
      gl.texStorage3D(gl.TEXTURE_3D, levels, fmt, d[0], d[1], d[2]);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
      return t;
    };
    const ld = dims.map(v => Math.max(4, Math.ceil(v / 2)));
    R.hitch = true;
    G = sys._vg = { gl, dims, ld, dens: tex3(dims, gl.RG16F, Math.floor(Math.log2(Math.max(...dims))) + 1), light: tex3(ld, gl.RGBA16F, 1), fb: gl.createFramebuffer() };
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.fb);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, G.dens, 0, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { R.volBad = true; return null; }
    return G;
  }
  function particlePoints(sys) {
    if (sys._mode === "cpu") { particleSource(sys); return sys._cpuGpu.points; }
    return sys._gpu.sets[sys._gpu.cur].update;
  }
  // Splats the particles into the density grid slice by slice, then fills the light grid.
  function prepareVolume(sys, V, lay, L, sceneTime, pts) {
    const { gl } = R;
    const G = volumeGrid(sys, lay.dims);
    if (!G) return false;
    const [nx, ny, nz] = lay.dims;
    const t = sys._t ?? 0, tr = sys.simTime(sys.time ?? sceneTime ?? 0);
    const sz = sizePair(sys), fade = Array.isArray(sys.fade) ? sys.fade : [sys.fade, sys.fade];
    const fire = sys.style === "fire";
    const P = prog("vsplat");
    gl.useProgram(P.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.fb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, nx, ny);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    setAll(P, {
      uTime: [t, Math.max(t, Math.min(tr, t + sys.step)), 0, sys.density], uLife: [sys.lifeRange[0], sys.period, 0, 0], uSeed: sys.seed,
      uSize: [sz[0], sz[1], sys.sizeJitter ?? 0.5, 0], uFade: [fade[0], fade[1], sys.count / Math.max(1, sys._drawN), sys.opacity],
      uVolMin: lay.min, uDims: lay.dims, uVoxel: lay.voxel, uPtMax: R.ptMax,
      uVHeat: [fire ? Math.max(1, sys.glow) : sys.glow, V.hot ?? (fire ? 1 : 0.3), V.thin, 0],
    });
    gl.bindVertexArray(particlePoints(sys));
    for (let z = 0; z < nz; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, G.dens, 0, z);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      setU(P, "uSlice", z);
      gl.drawArrays(gl.POINTS, 0, sys._drawN);
    }
    gl.disable(gl.BLEND);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, G.light, 0, 0);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_3D, G.dens);
    gl.generateMipmap(gl.TEXTURE_3D);
    const PL = prog("vlight");
    gl.useProgram(PL.p);
    const [lx, ly, lz] = G.ld, diag = Math.hypot(...lay.size), ds = Math.max(lay.voxel * 1.5, diag / 60);
    // Point lights in grid coordinates; w carries the light's distance through the grid in world units.
    const pt = j => { if (!pts || !pts[j]) return [0, 0, 0, 0]; const g = pts[j].position.map((v, k) => (v - lay.min[k]) / lay.size[k]); return [...g, 1]; };
    const sig = volumeSigma(sys, V);
    setAll(PL, { uDens: 8, uLDims: G.ld, uLDelta: L.map((v, k) => (v * ds) / lay.size[k]), uSigmaStep: sig * ds, uLSteps: Math.min(64, Math.ceil(diag / ds)), uPt0: pt(0), uPt1: pt(1), uSigma: sig * diag * (V.occlusion ?? 0.25) * 2 });
    gl.viewport(0, 0, lx, ly);
    gl.bindVertexArray(R.empty);
    for (let z = 0; z < lz; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, G.light, 0, z);
      setU(PL, "uSlice", z);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    return true;
  }
  // The part-resolution buffer volumes are marched into; grows like the other targets.
  function volBuffer(w, h) {
    const { gl } = R;
    let B = R.vbuf;
    if (!B || B.w < w || B.h < h) {
      if (B) { gl.deleteFramebuffer(B.fb); gl.deleteTexture(B.tex); }
      const W = Math.max(w, B?.w ?? 0), H = Math.max(h, B?.h ?? 0);
      // Creating a texture binds it to the active unit; use unit 0, which every pass rebinds,
      // so the scene depth on unit 2 isn't replaced mid-pass.
      gl.activeTexture(gl.TEXTURE0);
      const tex = texture(W, H, ...R.colorFmt, gl.NEAREST);
      B = R.vbuf = { w: W, h: H, tex, fb: framebuffer([tex]) };
    }
    return B;
  }
  const volumeColor = (sys, V) => toLinear(colorOf(sys.color ?? V.albedo ?? (sys.style === "fire" ? "#333333" : "#d6d0c6"), true));

  // ---------- render ----------
  let E3stats = null;
  // Renders the scene into the shared WebGL canvas; returns a view for projection and picking.
  // outScale: output pixels per CSS pixel (the screen's density). ss: supersampling
  // factor (1 to 3); the frame is rendered ss times larger and filtered down in the
  // composite pass, so the result can be copied to the page 1:1 with no resampling.
  // For the page checker and screenshots, a traced view is refined to its final look in one call.
  function render(scene, cam, cssW, cssH, outScale, ss) {
    let view = renderFrame(scene, cam, cssW, cssH, outScale, ss);
    for (let k = 0; view.converging && checking() && k < 16; k++) {
      if (view.source.image.close) view.source.image.close();
      view = renderFrame(scene, cam, cssW, cssH, outScale, ss);
    }
    return view;
  }
  // GPU memory held for one scene (its refinement buffer, its BVH textures) goes back when the
  // scene hasn't drawn for a while: a long page keeps only what's on screen. They're rebuilt
  // on the scene's next frame.
  const live = new Set();
  function trimIdle(now) {
    if (now - (R.lastTrim ?? 0) < 4000) return;
    R.lastTrim = now;
    const { gl } = R;
    for (const sc of live) {
      if (now - (sc._usedAt ?? 0) < 20000) continue;
      const A = sc._acc;
      if (A && A.tex && A.gl === gl) { gl.deleteFramebuffer(A.fb); gl.deleteTexture(A.tex); A.tex = A.fb = null; A.n = 0; A.sig = null; }
      const Tr = sc._trace;
      if (Tr && Tr.gpu && Tr.gpu.gl === gl) { for (const t of [Tr.gpu.nodes, Tr.gpu.tris, Tr.gpu.mats]) gl.deleteTexture(t); Tr.gpu = null; }
      live.delete(sc);
    }
  }
  function renderFrame(scene, cam = {}, cssW, cssH, outScale = 1, ss = 2) {
    renderer();
    {
      const t = typeof performance !== "undefined" ? performance.now() : Date.now();
      scene._usedAt = t; live.add(scene); trimIdle(t);
    }
    const { gl } = R;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const q = qualityFor(scene, cam, Math.max(1, Math.min(3, Math.round(ss))), now);
    ss = q.ss;
    const Wo = Math.max(1, Math.round(cssW * outScale)), Ho = Math.max(1, Math.round(cssH * outScale));
    const W = Math.max(1, Math.round(Wo * ss * q.scale)), H = Math.max(1, Math.round(Ho * ss * q.scale));
    const scale = (W / Wo) * outScale;
    const items = collect(scene);
    const fxNodes = items.fx;
    const look = lookOf(scene), dark = pageDark();
    // Physical lights (and in the darkroom, the physical sky's Sun) and the shapes that show them.
    const room = !!look.room, sky = skyOf(scene);
    const rig = lightRig(scene, room);
    items.push(...lightItems(rig, scene._bounds));
    const bounds = sceneBounds(items);
    scene._bounds = bounds;
    let C = camera(cam, scene, bounds, cssW / cssH);
    const physSky = sky && sky.kind === 2 && !room;
    const L = physSky ? sky.sun : lightDir(scene, C);
    // cutPlane: [nx, ny, nz, d], { normal, offset }, or { facing: "camera", at, offset, level, follow }:
    // a cut through `at` (default the scene's center) that opens the side facing the viewer when
    // it is switched on, then stays fixed to the model like a real cutaway, so turning the model
    // doesn't re-slice it. follow: true re-faces the camera every frame; level: false lets the cut
    // tilt with the view instead of staying upright.
    const cpo = scene.cutPlane;
    if (!cpo || cpo.facing !== "camera") scene._cutFace = null;
    const cut = !cpo ? null : Array.isArray(cpo) ? cpo : cpo.facing === "camera" ? (() => {
      const at = cpo.at ?? bounds.center;
      let n = scene._cutFace;
      if (!n || cpo.follow) {
        const d = v3.sub(C.eye, C.target);
        n = scene._cutFace = v3.norm(cpo.level === false ? d : [d[0], 0, d[2]]);
      }
      return [...n, v3.dot(n, at) + (cpo.offset ?? 0)];
    })() : [...cpo.normal, cpo.offset ?? 0];
    const cutN = cut ? v3.norm(cut.slice(0, 3)) : null;
    const cutV = cut ? [...cutN, cut[3] / v3.len(cut.slice(0, 3))] : [0, 1, 0, 1e9];
    const hatch = (C.worldPerPx / cssH) * 7;
    const pal = (typeof window !== "undefined" && window.palette) || {};
    const hiDefault = hexRgb(pal.orange || "#d9800f");

    const mats = new Map();
    const matOf = it => { let m = mats.get(it.node); if (!m) mats.set(it.node, (m = resolveMaterial(it.node, scene.look))); return m; };
    const opaque = items.filter(it => matOf(it).kind === "opaque");
    const glassItems = items.filter(it => matOf(it).kind === "glass");
    // A glass part that wholly contains another solid is a container (a jar, a tank, a cylinder
    // around a piston): thin walls, so what's inside isn't bent into doubled copies. Prisms, lenses
    // and blocks keep refracting as solid glass. An explicit material thickness always wins.
    const worldBox = it => {
      const b = it.node.mesh.bounds, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < 8; i++) { const p = m4.apply(it.world, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); } }
      return [min, max];
    };
    for (const g of glassItems) {
      const [gmin, gmax] = worldBox(g);
      // Water in a glass counts as contents too (a tumbler of water, a tank).
      g.container = items.some(it => it !== g && (matOf(it).kind !== "glass" || (matOf(it).water && !matOf(g).water)) && (() => { const [a, b] = worldBox(it); return [0, 1, 2].every(k => a[k] >= gmin[k] - 1e-6 && b[k] <= gmax[k] + 1e-6); })());
    }
    const ghosts = items.filter(it => matOf(it).kind === "ghost").sort((a, b) => v3.dist(b.center, C.eye) - v3.dist(a.center, C.eye));
    opaque.concat(glassItems).forEach((it, i) => { it.id = ((i * 97) % 254) + 1; });

    // Environment, its turn with the camera, and the light rig.
    const fwd = v3.sub(C.eye, C.target);
    let ez = v3.norm([fwd[0], 0, fwd[2]]);
    if (!Number.isFinite(ez[0]) || v3.len([fwd[0], 0, fwd[2]]) < 1e-6) ez = [0, 0, 1];
    const ex = v3.norm(v3.cross([0, 1, 0], ez));
    const envRot = new Float32Array([ex[0], 0, ez[0], ex[1], 1, ez[1], ex[2], 0, ez[2]]);
    const sunEnv = [v3.dot(L, ex), L[1], v3.dot(L, ez)];
    const env = physSky ? environment(3, dark, sunEnv, sky) : environment(look.env, dark, sunEnv);
    const sunTr = physSky ? sunTransmittance(sky.sun, sky.haze) : null;
    const kc = (sunTr ? sunTr.map(v => v * 1.15 * sky.intensity) : look.keyColor).map(v => v * look.key), fc = look.fillColor.map(v => v * look.fill), rc = [1, 1, 1].map(v => v * look.rim);
    const fillDir = viewToWorld(C, [0.8, 0.1, 0.55]), rimDir = viewToWorld(C, [0.25, 0.5, -0.85]);
    const points = [];
    for (const f of fxNodes) if (f.node.isPlume) points.push(...f.node.glowLights());
    for (const p of scene.lights || []) points.push({ position: p.position, color: colorOf(p.color || "#ffffff", true).map(v => (v ** 2.2) * (p.intensity ?? 1)), range: p.range ?? bounds.radius });
    const ptPos = new Float32Array(8), ptCol = new Float32Array(6);
    points.slice(0, 2).forEach((p, i) => { ptPos.set([...p.position, p.range], i * 4); ptCol.set(p.color, i * 3); });
    const hasGlow = items.some(it => matOf(it).glow) || fxNodes.some(f => f.node.isPlume || (f.node.isParticles && (f.node.style === "fire" || f.node.style === "spark" || (f.node.style === "smoke" && f.node.glow > 0))));
    const bloomK = (scene.bloom === false ? 0 : typeof scene.bloom === "number" ? scene.bloom : look.bloom) * (R.hdr && q.bloom ? 1 : 0);
    const exposure = (scene.exposure ?? 1) * look.exposure;
    const lookU = [look.diffuse, look.specular, exposure, bloomK > 0 ? 0.12 : 0];
    const envU = { uEnvSpec: 3, uEnvIrr: 4, uEnvRot: envRot, uEnvInfo: [env.scale, env.lod] };
    const bindEnv = () => {
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, env.spec);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, env.irr);
    };

    // Particles step before anything is drawn (sphere particles draw with the solids).
    const tierFrac = q.particles;
    for (const f of fxNodes) if (f.node.isParticles) {
      const sys = f.node, exact = sys.quality === false || sys.measure || sys.cpu || !Number.isFinite(sys.lifeRange[1]);
      const n = Math.max(1, Math.min(sys.count, Math.ceil(sys.count * (exact ? 1 : tierFrac))));
      sys._drawN = n;
      stepParticles(sys, n);
    }
    // Water (E3.water): advance each simulated surface to this frame's time and redraw its caustics.
    const waterIts = R.hdr ? glassItems.filter(it => it.node._water) : [];
    for (const it of waterIts) { const wg = it.node._water, t = wg.time ?? scene.time ?? 0; wg._now = t; waterStep(wg, t, L); }
    const causticU = waterCausticU(waterIts, L);
    const spheres = fxNodes.filter(f => f.node.isParticles && f.node.style === "sphere");
    // Volumetric systems splat into their grids now, before anything reads them.
    for (const f of fxNodes) {
      const sys = f.node;
      if (!sys.isParticles) continue;
      sys._volLay = null;
      const V = R.hdr && !R.volBad ? volumeOpts(sys) : null;
      if (!V) continue;
      const lay = volumeLayout(sys, V);
      if (prepareVolume(sys, V, lay, L, scene.time, points)) sys._volLay = lay;
    }

    // Grass: the wind's steady bend grows with its dynamic pressure (v squared), gusts roll across
    // the patch at the wind's speed (wavelength about 3 m), and each blade flutters on its own.
    const grassU = node => {
      const gr = node._grass;
      if (!gr) return { uWind: [0, 0, 0, 0], uWind2: [0, 0, 0, 0], uPush: [0, 0, 0, 0] };
      const v = Math.max(0, gr.wind ?? 0), d = v3.norm([gr.windDirection?.[0] ?? 1, 0, gr.windDirection?.[1] ?? 0]), k = (2 * Math.PI) / (3 * (gr.units ?? 1));
      return { uWind: [d[0], d[2], Math.min(1.4, (v / 7) ** 2), scene.time ?? 0], uWind2: [k, k * Math.max(v, 0.5), 0.05 + 0.04 * Math.min(1, v / 5), 1], uPush: gr.push || [0, 0, 0, 0] };
    };
    // Shadow maps from the key light, fitted around the scene.
    const sh = scene.shadow === false || room ? null : typeof scene.shadow === "object" ? scene.shadow : {};
    const shadowOn = !!sh && sh.cast !== false && items.length > 0;
    let shadowU = { uShadowA: [0, 0, 0, 0], uShadowB: [0, 0, 0, 0], uShadowVP: m4.identity(), uShadowCmp: 5, uShadowRaw: 6, uShadowGlass: 7 };
    let SM = null;
    if (shadowOn) {
      const size = q.shadow;
      SM = shadowMaps(size, glassItems.length > 0);
      let Ls = L.slice();
      if (Ls[1] < 0.3) Ls = v3.norm([Ls[0], 0.3 + (0.3 - Ls[1]) * 0.2, Ls[2]]);
      const ext = bounds.radius * 1.35, ctr = bounds.center;
      const lv = m4.lookAt(v3.add(ctr, v3.scale(Ls, bounds.radius * 3)), ctr, Math.abs(Ls[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0]);
      const lp = m4.ortho(-ext, ext, -ext, ext, bounds.radius * 0.5, bounds.radius * 5.5);
      const vp = m4.multiply(lp, lv);
      const depthRange = bounds.radius * 5;
      const texelW = (2 * ext) / size;
      const soft = (sh.softness ?? 1) * look.soft;
      const lightAngle = 0.045 * soft;
      shadowU = {
        uShadowVP: vp,
        uShadowA: [1, (texelW * 0.8) / depthRange, texelW * 1.6, glassItems.length ? 0.55 : 0],
        uShadowB: [1.2 / size, Math.min(0.06, (0.012 + 0.02 * soft)), (depthRange * Math.tan(lightAngle)) / (2 * ext), 0],
        uShadowCmp: 5, uShadowRaw: 6, uShadowGlass: 7,
      };
      const P = prog("depth");
      gl.useProgram(P.p);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
      setAll(P, { uViewProj: vp, uCut: cutV });
      const pass = (fb, list) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.viewport(0, 0, size, size);
        gl.clearBufferfv(gl.DEPTH, 0, [1]);
        for (const it of list) {
          if (it.node.castShadow === false) continue;
          const g = upload(it.node.mesh);
          setAll(P, { uModel: it.world, uCutOn: cut && it.node.cut ? 1 : 0, ...grassU(it.node) });
          gl.bindVertexArray(g.vao);
          gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
        }
      };
      pass(SM.main.fb, opaque);
      if (glassItems.length) pass(SM.glass.fb, glassItems);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindVertexArray(null);
    }
    const bindShadow = () => {
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, SM ? SM.main.tex : R.dummyDepth); gl.bindSampler(5, R.sCmp);
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, SM ? SM.main.tex : R.dummyDepth); gl.bindSampler(6, R.sRaw);
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, SM && SM.glass ? SM.glass.tex : R.dummyDepth); gl.bindSampler(7, R.sCmp);
    };
    const unbindSamplers = () => { for (const u of [5, 6, 7]) gl.bindSampler(u, null); };

    const samples = q.moving && ss === 1 && q.scale >= 1 && R.maxSamples > 1 ? Math.min(q.msaa, R.maxSamples) : 0;
    // What this frame ran at, for the harness and for pages that report it.
    E3stats = { tier: q.name, moving: q.moving, ss, scale: q.scale, samples, size: [W, H], out: [Wo, Ho], triangles: items.reduce((n, it) => n + (it.node.mesh ? it.node.mesh.indices.length / 3 : 0), 0), particles: fxNodes.filter(f => f.node.isParticles).reduce((n, f) => n + (f.node._drawN || 0), 0), plumes: fxNodes.filter(f => f.node.isPlume).length };
    scene.stats = E3stats;
    targets(W, H, Wo, Ho, samples, glassItems.length > 0);
    const target = samples ? R.msaa.fb : R.main.fb;
    const partShadow = shadowOn ? (sh.parts ?? 1) * look.parts : 0;

    // Traced light: the scene's BVH, the lights, and how many frames of this exact view have been
    // averaged so far (area lights, sky, bounces, and haze are sampled, so still frames refine).
    const skyLit = !!(sky && room);
    const hazeO = scene.haze && rig.length ? (typeof scene.haze === "number" ? { density: scene.haze } : scene.haze) : null;
    // A projector's picture is blocked by whatever stands in its way, so projector mapping traces too.
    const projecting = items.some(it => matOf(it).map?.projector);
    const Tr = rig.length || skyLit || projecting ? traceOf(scene, items, matOf) : null;
    const gpuT = Tr ? traceGPU(Tr) : null;
    const LA = new Float32Array(32), LB = new Float32Array(32), LC = new Float32Array(32), LD = new Float32Array(32);
    rig.forEach((l, i) => { LA.set([...l.position, l.t], i * 4); LB.set([...l.rgb, l.radius], i * 4); LC.set([...l.U, l.two ? 1 : 0], i * 4); LD.set([...l.V, 0], i * 4); });
    const bounces = Tr ? Math.max(0, Math.min(6, Math.round(scene.bounces ?? 0))) : 0;
    // Depth of field: a lens of focal length `focal` (mm) at f-number `fNumber` has an aperture f/N
    // across; each frame looks through a different point of it, sheared so the plane at `focus`
    // stays put, and the average blurs everything off that plane by its real circle of confusion.
    // `aperture` (diameter, world units) overrides f/N, for a teaching figure that exaggerates the blur.
    const lens = (cam.fNumber > 0 || cam.aperture > 0) && !C.ortho ? { f: cam.focal ?? 50, N: cam.fNumber ?? 2, F: cam.focus ?? C.distance, D: cam.aperture } : null;
    const stochastic = (!!Tr && (rig.some(l => l.t !== 0) || skyLit || bounces > 0 || !!hazeO)) || !!lens;
    const checkNow = checking();
    let accN = 0;
    if (stochastic) {
      let sig = `${Wo}x${Ho}|${dark}|${exposure}|${scene.time ?? 0}|${bounces}|${JSON.stringify(scene.haze ?? 0)}|${JSON.stringify(scene.sky ?? 0)}|${Array.from(C.vp, v => v.toFixed(5))}|${cutV}|${Array.from(LA)}|${Array.from(LB)}|${Array.from(LC)}|${Array.from(LD)}|${Tr ? Tr.key : ""}|${lens ? [lens.f, lens.N, lens.F, lens.D] : ""}|`;
      for (const it of items) sig += meshId(it.node.mesh) + (it.node.highlight ? "h" : "") + (it.node.color ?? "") + (it.node.opacity ?? 1) + Array.from(it.world, v => v.toFixed(4)) + ";";
      // Particles count too: their settings (a wind moved while paused) change the picture.
      for (const f of fxNodes) { if (f.node.isParticles) { try { f.node._accSig ??= ""; sig += JSON.stringify([f.node.forces, f.node.emitter, f.node.density, f.node.opacity, f.node.time]); } catch {} } else sig += (f.node.time ?? "") + (f.node.throttle ?? "") + ","; }
      const A = scene._acc;
      accN = A && A.sig === sig && !q.moving ? A.n + 1 : 0;
      scene._acc = { ...(A || {}), sig, n: accN };
    }
    // Samples per pixel per frame: one while moving or bouncing (each bounce is another ray), more for the checker.
    const spp = q.moving ? 1 : checkNow ? 4 : bounces > 0 || hazeO ? 1 : 2;
    const C0 = C;
    if (lens && accN > 0) {
      const A = lens.D > 0 ? lens.D / 2 : (lens.f / lens.N / 2000) * unitsOf(scene.units);
      const n = accN - 1, u = (0.7548776662 * n + 0.5) % 1, w = (0.5698402910 * n + 0.5) % 1;
      const r = Math.sqrt(u) * A, a = w * Math.PI * 2, ox = r * Math.cos(a), oy = r * Math.sin(a);
      const view = m4.multiply(m4.translation([-ox, -oy, 0]), C.view), proj = new Float32Array(C.proj);
      proj[8] -= (proj[0] * ox) / lens.F; proj[9] -= (proj[5] * oy) / lens.F;
      const inv = m4.invert(C.view), eye = m4.apply(inv, [ox, oy, 0]);
      C = { ...C, view, proj, vp: m4.multiply(proj, view), eye };
    }
    const traceU = {
      uBvhN: 12, uBvhT: 13, uBvhM: 14, uBvh: [Tr && Tr.bvh.nTris ? 1 : 0, Tr ? Tr.bvh.nNodes : 0, Tr ? Tr.bvh.nTris : 0, cut ? 1 : 0], uBvhCut: cutV,
      uRoom: [Tr ? rig.length : 0, spp, bounces, accN], uLA: LA, uLB: LB, uLC: LC, uLD: LD,
      uSkyU: skyLit ? (sky.kind === 1 ? [...sky.rgb, 1] : [1, 1, 1, 2]) : [0, 0, 0, 0],
      uUnits: unitsOf(scene.units), uTraceEps: bounds.radius * 2e-4,
      uSunDir: sky && sky.kind === 2 ? sky.sun : [0, 1, 0], uSkyP: sky && sky.kind === 2 ? [20 * sky.intensity, sky.haze, sky.altitude, sky.stars] : [20, 1, 2, 0],
    };
    bindTrace(gpuT);
    const common = {
      uViewProj: C.vp, uEye: C.eye, uLight: L, uCut: cutV, uSun: scene.lighting === "sun" ? 1 : 0, uHatch: hatch,
      uKeyCol: kc, uFillDir: fillDir, uFillCol: fc, uRimDir: rimDir, uRimCol: rc, uPtPos: ptPos, uPtCol: ptCol, uLook: lookU,
      uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0,
      ...envU, ...shadowU, ...traceU, ...causticU,
    };

    // Opaque pass: color, normal + part id, depth.
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, W, H);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    bindEnv();
    bindShadow();
    gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, causticU.tex); gl.activeTexture(gl.TEXTURE0);
    const drawSurface = (P, it, m) => {
      if (waterIts.includes(it)) {
        drawWater(it, { common, C, L, q, time: it.node._water._now, sceneInv: [1 / R.scene.w, 1 / R.scene.h], sceneSize: [W, H], lit: causticU.node, pageBg: physSky || scene.background ? [0, 0, 0, 0] : [...(parseColor(pal.bg || pal.panel) || (dark ? [0.1, 0.1, 0.1] : [1, 1, 1])).slice(0, 3), 1] });
        gl.useProgram(P.p);
        return;
      }
      const g = upload(it.node.mesh);
      const cutOn = cut && it.node.cut ? 1 : 0;
      if (cutOn || it.node.twoSided) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
      gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, m.map ? mapTexture(m.map.src) : R.dummyColor); gl.activeTexture(gl.TEXTURE0);
      const r = it.node.mesh.bounds.radius || 1, wr = it.radius || 1;
      const bb = it.node.mesh.bounds, sc = wr / r, minSide = Math.max(1e-6, Math.min(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) * sc);
      const T = m.temp;
      const tS = [0, 0, 0, 0], tT = [0, 0, 0, 0];
      if (T) T.stops.forEach(([s, t], j) => { tS[j] = s; tT[j] = t; });
      for (let j = T ? T.stops.length : 0; j < 4; j++) { tS[j] = (tS[j - 1] ?? 0) + 1; tT[j] = tT[j - 1] ?? 0; }
      const hl = it.node.highlight;
      setAll(P, {
        uModel: it.world, uNormalMat: m4.normalMatrix(it.world), uColor: m.rgb, uId: it.id / 255, uCutOn: cutOn,
        uMat: [m.physical ? 1 : 0, m.metal, m.roughness, m.clearcoat], uF0: m.f0,
        // Muscle fibers run along `fibers`: a linear grain with a little anisotropy and fine stripes.
        uBrush: m.fibers ? [...m.fibers, Math.max(m.anisotropy, 0.3)] : [...m.brushAxis, m.anisotropy],
        uDetail: m.fibers ? [1, 140 / wr, 0, 9 / r] : [m.brush, m.anisotropy > 0 ? 70 / wr : 0, m.weave ? 1 : 0, 9 / r],
        uTissue: [m.sss, m.sheen, m.fibers ? 1 : 0, 0], uSssCol: m.sssColor,
        uEmit: m.emissive, uTempAxis: [...(T ? T.axis : [0, 1, 0]), T ? T.stops.length : 0], uTempS: tS, uTempT: tT,
        uHeat: [m.heatShift != null ? 1 : 0, m.heatShift ?? 0, 0, partShadow],
        uHighlightOn: hl ? 1 : 0, uHighlight: typeof hl === "string" ? hexRgb(pal[hl] || hl) : hiDefault,
        // Water's refraction depth is its real depth (the box's smallest side), not its size.
        uOpacity: m.opacity, uGlass: [m.ior, m.thickness ?? (m.water ? minSide * 0.6 : it.container ? minSide * 0.03 : wr * 0.9), m.dispersion, m.roughness],
        uWater: m.water ? [m.water.ripples, m.water.wavelength ?? wr * 0.12, scene.time ?? 0, m.water.depth] : [0, 1, 0, 0],
        uMat: [m.emitter ? 2 : m.physical ? 1 : 0, m.metal, m.roughness, m.clearcoat],
        uPart: [it.node.twoSided ? 1 : 0, m.foliage ? 1 : 0, room ? 1 : 0, it.node.light && it.node.light.twoSided ? 1 : 0],
        uMap: 15, uMapOn: m.map ? [1, m.map.mapping, m.map.rough ? 1 : 0, 0] : [0, 0, 0, 0], uMapBox: m.map ? m.map.box : [0, 0, 1, 1],
        uMapVP: m.map && m.map.projector ? projectorVP(m.map.projector) : m4.identity(), uMapProj: m.map && m.map.projector ? m.map.projector.position : [0, 0, 0],
        ...grassU(it.node),
      });
      gl.bindVertexArray(g.vao);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
    };
    if (opaque.length) {
      const P = prog("main");
      gl.useProgram(P.p);
      setAll(P, { ...common, uEnvSpec: 3, uEnvIrr: 4 });
      for (const it of opaque) drawSurface(P, it, matOf(it));
    }
    gl.disable(gl.CULL_FACE);
    if (spheres.length) {
      const P = prog("psphere");
      gl.useProgram(P.p);
      const camR = viewToWorld(C, [1, 0, 0]), camU = viewToWorld(C, [0, 1, 0]);
      // The particle vertex shader also declares the flow table; point it at a harmless texture.
      setAll(P, { ...common, uCamR: camR, uCamU: camU, uCamF: C.forward, uOrthoCam: C.ortho ? 1 : 0, uPartShadow: partShadow, ...flowUniforms(null) });
      spheres.forEach((f, j) => {
        const sys = f.node, t = sys._t ?? 0, tr = sys.simTime(sys.time ?? scene.time ?? 0);
        const sz = Array.isArray(sys.size) ? sys.size : [sys.size, sys.size];
        setAll(P, {
          uTime: [t, Math.max(t, Math.min(tr, t + sys.step)), 0, sys.density], uLife: [sys.lifeRange[0], sys.period, 0, 0], uSeed: sys.seed,
          uSize: [sz[0], sz[1], sys.sizeJitter ?? 0, 0], uStyle: 4, uShape: [sys.trail, sys.width, 0, 0], uId: (250 - j) / 255,
          ...particleColors(sys),
        });
        gl.bindVertexArray(particleSource(sys));
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sys._drawN);
      });
    }

    // Ground shadow: a contact shadow plus the key light's cast shadow, on an invisible floor.
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    if (sh && sh.ground !== false && items.length && !waterIts.some(it => it.node._water.basin || it.node._water.mode === "ocean")) {
      const ext = [(bounds.max[0] - bounds.min[0]) / 2, (bounds.max[2] - bounds.min[2]) / 2];
      const k = sh.scale ?? 1.25;
      const P = prog("ground");
      gl.useProgram(P.p);
      setAll(P, {
        ...shadowU, uViewProj: C.vp, uHalf: bounds.radius * 4,
        uCenter: [bounds.center[0], sh.y ?? bounds.min[1] - bounds.radius * 0.01, bounds.center[2]],
        uRadii: [Math.max(ext[0], ext[1] * 0.35) * k, Math.max(ext[1], ext[0] * 0.35) * k],
        uGround: [sh.opacity ?? 0.16, shadowOn ? (sh.strength ?? look.ground) * (dark ? 0.75 : 1) : 0, bounds.radius * 2.2, 0],
      });
      gl.bindVertexArray(R.empty);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Glass refracts the opaque picture, so take a copy of it first.
    if (glassItems.length) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, R.scene.fb);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      if (waterIts.length) waterDepthCopy(target, W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      const P = prog("glass");
      gl.useProgram(P.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.scene.tex);
      setAll(P, { ...common, uScene: 0, uSceneInv: [1 / R.scene.w, 1 / R.scene.h], uSceneSize: [W, H] });
      // Water held in a glass is drawn first; the glass then refracts a fresh copy that includes it,
      // so a tumbler shows its water instead of only the nearer pane.
      const held = glassItems.filter(it => matOf(it).water && glassItems.some(g => g !== it && g.container && !matOf(g).water));
      const rest = glassItems.filter(it => !held.includes(it)).sort((a, b) => v3.dist(b.center, C.eye) - v3.dist(a.center, C.eye));
      for (const it of held) drawSurface(P, it, matOf(it));
      if (held.length) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, R.scene.fb);
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      }
      for (const it of rest) drawSurface(P, it, matOf(it));
      gl.disable(gl.CULL_FACE);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
      gl.enable(gl.BLEND);
      gl.depthMask(false);
    }
    if (ghosts.length) {
      const P = prog("ghost");
      gl.useProgram(P.p);
      setAll(P, { uViewProj: C.vp, uEye: C.eye, uLight: L, uCut: cutV });
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      for (const it of ghosts) {
        const m = matOf(it), g = upload(it.node.mesh);
        setAll(P, { uModel: it.world, uNormalMat: m4.normalMatrix(it.world), uColor: m.rgb, uOpacity: m.opacity, uCutOn: cut && it.node.cut ? 1 : 0 });
        gl.bindVertexArray(g.vao);
        gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
      }
      gl.disable(gl.CULL_FACE);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    unbindSamplers();

    // MSAA: resolve color, normals and depth into the textures the later passes read.
    if (samples) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, R.msaa.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, R.main.fb);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1]);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, R.main.fb);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
    }

    // Effects layer at output resolution: plumes and sprite particles, back to front,
    // depth-tested by hand against the solids' depth buffer.
    // Sprites and plumes sort per node, back to front. A plume splits every particle system
    // into the sprites behind its midplane (drawn before it) and those in front (after it),
    // so smoke wraps around the flame instead of sitting on top of it.
    const plumeNodes = fxNodes.filter(f => f.node.isPlume);
    const plumeDepth = f => v3.dot(v3.sub(f.node.toWorld([0, -f.node.lengthNow * 0.5, 0]), C.eye), C.forward);
    const fxDraw = [];
    const sprites = fxNodes.filter(f => f.node.isParticles && f.node.style !== "sphere");
    if (plumeNodes.length) {
      const cuts = plumeNodes.map(f => ({ f, z: plumeDepth(f) })).sort((a, b) => b.z - a.z);
      let far = Infinity;
      for (const c of cuts) {
        for (const sp of sprites) fxDraw.push({ ...sp, slab: [c.z, far] });
        fxDraw.push(c.f);
        far = c.z;
      }
      for (const sp of sprites) fxDraw.push({ ...sp, slab: [-Infinity, far] });
    } else fxDraw.push(...sprites.sort((a, b) => v3.dist(b.center, C.eye) - v3.dist(a.center, C.eye)));
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.fx.fb);
    gl.viewport(0, 0, Wo, Ho);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    if (fxDraw.length) {
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      bindEnv();
      bindShadow();
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.main.depth);
      const depthScale = [(W / Wo) / R.main.w, (H / Ho) / R.main.h];
      const camR = viewToWorld(C, [1, 0, 0]), camU = viewToWorld(C, [0, 1, 0]);
      for (const f of fxDraw) {
        const node = f.node;
        if (node.isPlume) {
          // Marched into the part-resolution buffer, then upsampled by depth into the effects layer.
          const Wv = Math.max(1, Math.round(Wo * q.vscale)), Hv = Math.max(1, Math.round(Ho * q.vscale));
          const VB = volBuffer(Wv, Hv);
          gl.bindFramebuffer(gl.FRAMEBUFFER, VB.fb);
          gl.viewport(0, 0, Wv, Hv);
          gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.main.depth);
          const P = prog("plume");
          gl.useProgram(P.p);
          const prof = node.profile, Lp = node.lengthNow, thr = clamp01(node.throttle), imp = node.impactNow();
          const r0 = prof ? Math.max(...prof.map(st => st[0])) : node.radius;
          let Rb = prof ? r0 * 1.04 : r0 * (1 + node.spread * Lp / r0) * 1.7;
          if (imp) Rb = Math.max(Rb, node.splashRadius * 1.05);
          const proxy = R.unitCyl || (R.unitCyl = transformMesh(mesh.cylinder(1, 1, { segments: 28 }), m4.translation([0, -0.5, 0])));
          const g = upload(proxy);
          const ws = Math.hypot(f.world[0], f.world[1], f.world[2]) || 1;
          const profU = new Float32Array(96);
          if (prof) prof.slice(0, 24).forEach((st, i) => profU.set([st[0], st[1], st[2] ?? node.temperature, 0], i * 4));
          setAll(P, {
            uModel: m4.multiply(f.world, m4.scaling([Rb, Lp * 1.02, Rb])), uViewProj: C.vp, uNormalMat: m4.normalMatrix(f.world),
            uInvModel: m4.invert(f.world), uEye: C.eye, uView: C.view, uCamF: C.forward, uDepth: 2, uDepthScale: [(depthScale[0] * Wo) / Wv, (depthScale[1] * Ho) / Hv],
            uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0, uLook: lookU,
            uP0: [r0, Lp, Rb, node.time ?? scene.time ?? 0], uP1: [thr, node.cells * 2 * r0 * Math.sqrt(0.4 + 0.6 * thr) * Math.sqrt(Math.max(0.2, node.expansionNow)), node.temperature, q.steps],
            uP2: [node.spread, node.turbulence, node.intensity, FUELS[node.fuel] ?? 0], uP3: [1 / ws, node.speed * r0 * 6, node.expansionNow, 0],
            uP4: [imp, node.splashRadius, prof ? Math.min(24, prof.length) : 0, 0], uProf: profU,
            uCut: node.cut && cut ? cutV : [0, 1, 0, 1e30],
          });
          gl.disable(gl.BLEND);
          gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
          gl.bindVertexArray(g.vao);
          gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
          gl.disable(gl.CULL_FACE); gl.cullFace(gl.BACK);
          gl.bindFramebuffer(gl.FRAMEBUFFER, R.fx.fb);
          gl.viewport(0, 0, Wo, Ho);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          const PU = prog("vup");
          gl.useProgram(PU.p);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, VB.tex);
          setAll(PU, { uV: 0, uDepth: 2, uDepthScale: depthScale, uRatio: [Wv / Wo, Hv / Ho], uVMax: [Wv - 1, Hv - 1], uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0 });
          gl.bindVertexArray(R.empty);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          continue;
        }
        if (node.isParticles && node._volLay) {
          const sys = node, V = volumeOpts(sys), lay = sys._volLay, G = sys._vg;
          const Wv = Math.max(1, Math.round(Wo * q.vscale)), Hv = Math.max(1, Math.round(Ho * q.vscale));
          const VB = volBuffer(Wv, Hv);
          gl.bindFramebuffer(gl.FRAMEBUFFER, VB.fb);
          gl.viewport(0, 0, Wv, Hv);
          gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
          gl.disable(gl.BLEND);
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.main.depth);
          const P = prog("vmarch");
          gl.useProgram(P.p);
          gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_3D, G.dens);
          gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_3D, G.light);
          gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_3D, noise3());
          const time = sys.time ?? scene.time ?? 0, sz = sizePair(sys), detail = V.detail ?? 1 / (((sz[0] + sz[1]) / 2) * 1.6);
          const Fo = sys.forces || {}, wind = Fo.wind || [0, 0, 0], rise = ((Fo.buoyancy || 0) / Math.max(Fo.drag || 1, 0.2)) * 0.5;
          const vel = V.flow ?? [wind[0] * 0.7, wind[1] * 0.7 + rise, wind[2] * 0.7];
          const temps = Array.isArray(sys.temperature) ? sys.temperature : [sys.temperature, sys.temperature];
          const fire = sys.style === "fire";
          setAll(P, {
            ...envU, uDens: 8, uLightVol: 9, uNoise: 10, uDepth: 2, uDepthMap: [(depthScale[0] * Wo) / Wv, (depthScale[1] * Ho) / Hv],
            uInvVP: m4.invert(C.vp), uEye: C.eye, uCamF: C.forward, uVSize: [Wv, Hv], uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0,
            uVolMin: lay.min, uVolSize: lay.size, uVoxel: lay.voxel, uSteps: q.vsteps,
            uSlabZ: f.slab ? [Math.max(f.slab[0], -1e30), Math.min(f.slab[1], 1e30)] : [-1e30, 1e30],
            uCut: sys.cut && cut ? cutV : [0, 1, 0, 1e30],
            uMed: [volumeSigma(sys, V), V.erosion, detail, V.ambient], uMed2: [V.shadow, V.powder, V.occlusion, fire ? 1 : 0],
            uFlow: vel.map(v => -v * time * detail), uFlow2: vel.map((v, k) => -v * time * detail * 3.4 + [0.31, 0.57 + time * 0.04, 0.13][k]),
            uAlbedo: volumeColor(sys, V), uLight: L, uKeyCol: kc, uPtPos: ptPos, uPtCol: ptCol, uLook: lookU,
            uHeatT: [temps[0], temps[1], sys.intensity, fire ? Math.max(1, sys.glow) : sys.glow],
          });
          gl.bindVertexArray(R.empty);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindFramebuffer(gl.FRAMEBUFFER, R.fx.fb);
          gl.viewport(0, 0, Wo, Ho);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          const PU = prog("vup");
          gl.useProgram(PU.p);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, VB.tex);
          setAll(PU, { uV: 0, uDepth: 2, uDepthScale: depthScale, uRatio: [Wv / Wo, Hv / Ho], uVMax: [Wv - 1, Hv - 1], uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0 });
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          continue;
        }
        const sys = node, P = prog("particle");
        gl.useProgram(P.p);
        const t = sys._t ?? 0, tr = sys.simTime(sys.time ?? scene.time ?? 0);
        const ribbon = sys.style === "streak" || sys.style === "spark";
        const segs = ribbon ? Math.max(1, Math.min(24, sys.segments ?? (sys.style === "streak" ? 10 : 2))) : 1;
        const F = sys.params();
        const sz = Array.isArray(sys.size) ? sys.size : [sys.size, sys.size];
        const fade = Array.isArray(sys.fade) ? sys.fade : [sys.fade, sys.fade];
        const temps = Array.isArray(sys.temperature) ? sys.temperature : [sys.temperature, sys.temperature];
        setAll(P, {
          ...envU, uViewProj: C.vp, uView: C.view, uEye: C.eye, uCamR: camR, uCamU: camU, uDepth: 2, uDepthScale: depthScale,
          uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0, uLight: L, uKeyCol: kc, uPtPos: ptPos, uPtCol: ptCol, uLook: lookU,
          uTime: [t, Math.max(t, Math.min(tr, t + sys.step)), 0, sys.density], uLife: [sys.lifeRange[0], sys.period, 0, 0], uSeed: sys.seed,
          uSize: [sz[0], sz[1], sys.sizeJitter ?? 0.5, 0], uStyle: STYLE_ID[sys.style] ?? 0, uShape: [sys.trail, sys.width, segs, partShadow],
          uPxW: C.ortho ? [0, (2 * C.tanHalf[1]) / Ho] : [(2 * C.tanHalf[1]) / Ho, 0],
          uFade: [fade[0], fade[1], sys.soft ?? bounds.radius * 0.04, sys.opacity],
          uHeatP: [temps[0], temps[1], sys.intensity, sys.glow],
          uSlab: f.slab ? [...C.forward, 0] : [0, 0, 0, 0], uSlabZ: f.slab ? [Math.max(f.slab[0], -1e30), Math.min(f.slab[1], 1e30)] : [-1e30, 1e30], uSlabEye: C.eye,
          ...flowUniforms(F.flow),
          ...shadowU,
          ...particleColors(sys),
          ...traceU, uPRoom: [Tr && rig.length ? 1 : 0, room ? 1 : 0, sys.scatter ?? 0.6, 0],
        });
        gl.bindVertexArray(particleSource(sys));
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, ribbon ? 2 * (segs + 1) : 4, sys._drawN);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      unbindSamplers();
    }

    // Bloom from whatever glows.
    let bloomTex = null, bloomInv = [0, 0];
    if (bloomK > 0 && hasGlow) {
      const levels = bloomTargets(Wo, Ho);
      if (levels.length) {
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
        gl.bindVertexArray(R.empty);
        const Px = prog("extract");
        gl.useProgram(Px.p);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.main.color);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.fx.tex);
        setAll(Px, { uColor: 0, uFx: 1, uColorInv: [1 / R.main.w, 1 / R.main.h], uColorScale: [W / Wo, H / Ho], uFxInv: [1 / R.fx.w, 1 / R.fx.h], uFxOn: fxDraw.length ? 1 : 0 });
        for (const Lv of levels) { gl.bindFramebuffer(gl.FRAMEBUFFER, Lv.fb); gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); }
        gl.bindFramebuffer(gl.FRAMEBUFFER, levels[0].fb);
        gl.viewport(0, 0, levels[0].vw, levels[0].vh);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const Pd = prog("down");
        gl.useProgram(Pd.p);
        gl.activeTexture(gl.TEXTURE0);
        for (let i = 1; i < levels.length; i++) {
          gl.bindTexture(gl.TEXTURE_2D, levels[i - 1].tex);
          setAll(Pd, { uSrc: 0, uSrcInv: [1 / levels[i - 1].w, 1 / levels[i - 1].h] });
          gl.bindFramebuffer(gl.FRAMEBUFFER, levels[i].fb);
          gl.viewport(0, 0, levels[i].vw, levels[i].vh);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        const Pu = prog("up");
        gl.useProgram(Pu.p);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        for (let i = levels.length - 1; i > 0; i--) {
          gl.bindTexture(gl.TEXTURE_2D, levels[i].tex);
          setAll(Pu, { uSrc: 0, uSrcInv: [1 / levels[i].w, 1 / levels[i].h], uWeight: 1 });
          gl.bindFramebuffer(gl.FRAMEBUFFER, levels[i - 1].fb);
          gl.viewport(0, 0, levels[i - 1].vw, levels[i - 1].vh);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.disable(gl.BLEND);
        bloomTex = levels[0].tex;
        bloomInv = [0.5 / levels[0].w, 0.5 / levels[0].h];
      }
    }

    // Composite with ink outlines into the canvas, or, while a traced view refines, into its
    // running average (each new frame weighted 1/(n+1)), which is then copied to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, R.cw, R.ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    let AC = null;
    if (stochastic) {
      AC = scene._acc;
      if (!AC.tex || AC.gl !== gl || AC.w < Wo || AC.h < Ho) {
        if (AC.tex && AC.gl === gl) { gl.deleteFramebuffer(AC.fb); gl.deleteTexture(AC.tex); }
        const [ci, cf, ct] = R.colorFmt;
        AC.w = Math.max(Wo, AC.gl === gl ? AC.w || 0 : 0); AC.h = Math.max(Ho, AC.gl === gl ? AC.h || 0 : 0);
        AC.tex = texture(AC.w, AC.h, ci, cf, ct, gl.NEAREST); AC.fb = framebuffer([AC.tex]); AC.gl = gl;
        accN = 0; AC.n = 0;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, AC.fb);
    }
    gl.viewport(0, 0, Wo, Ho);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    if (AC) {
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, 1 / (accN + 1));
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    }
    // Background: the darkroom's black (or scene.background), the physical sky, or the page.
    const bgO = scene.background;
    let bgMode = 0, bgColor = [0, 0, 0];
    if (bgO != null && bgO !== "none" && bgO !== false) { bgMode = 1; bgColor = colorOf(bgO, true); }
    else if (bgO == null && sky && (sky.kind === 2 || room)) bgMode = 2;
    else if (bgO == null && room) bgMode = 1;
    const cp = prog("composite");
    gl.useProgram(cp.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.main.color);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.main.normal);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.main.depth);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, R.fx.tex);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, bloomTex || R.fx.tex);
    const v = C.view;
    // Shimmer zones: behind every lit plume, plus any in scene.shimmer ({ from, to, radius: [r0, r1], strength }).
    const shimU = new Float32Array(16), shimR = new Float32Array(16);
    let shimN = 0;
    const toPx = w => { const c = m4.project(C.vp, w); return [(c[0] * 0.5 + 0.5) * Wo, (c[1] * 0.5 + 0.5) * Ho]; };
    const pxPerWorld = w => { const d = C.ortho ? 1 : Math.max(v3.dot(v3.sub(w, C.eye), C.forward), C.near); return Ho / (2 * C.tanHalf[1] * d); };
    const zone = (a, b, ra, rb, k) => {
      if (shimN >= 4) return;
      const A = toPx(a), B = toPx(b);
      shimU.set([...A, ...B], shimN * 4);
      shimR.set([ra * pxPerWorld(a), rb * pxPerWorld(b), k, 0], shimN * 4);
      shimN++;
    };
    for (const f of fxNodes) {
      const n = f.node;
      if (!n.isPlume || n.profile || !(n.throttle > 0) || n.shimmer === false) continue;
      const ws = Math.hypot(f.world[0], f.world[1], f.world[2]) || 1, Lp = n.lengthNow, imp = n.impactNow();
      const end = imp ? imp : Lp * 1.35;
      zone(n.toWorld([0, -Lp * 0.15, 0]), n.toWorld([0, -end, 0]), n.radius * ws * 1.8, (imp ? n.splashRadius : n.radius * 4) * ws, 2.2 * clamp01(n.throttle));
    }
    for (const z of scene.shimmer || []) {
      const r = Array.isArray(z.radius) ? z.radius : [z.radius ?? 1, z.radius ?? 1];
      zone(z.from, z.to, r[0], r[1], z.strength ?? 2);
    }
    setAll(cp, {
      uShim: shimU, uShimR: shimR, uShimN: shimN, uShimT: scene.time ?? 0,
      uColor: 0, uNormal: 1, uDepth: 2, uFx: 3, uBloom: 4,
      uInvSize: [1 / R.main.w, 1 / R.main.h], uScale: [W / Wo, H / Ho], uTaps: Math.max(1, Math.min(3, Math.round(W / Wo))),
      uStep: Math.max(0.75, 0.62 * scale * (scene.ink ?? 1)), uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0,
      uInk: scene.ink === 0 ? 0 : 0.9 * look.ink,
      uAo: scene.ao === false ? 0 : typeof scene.ao === "number" ? scene.ao : 0.5, uAoR: bounds.radius * 0.09,
      uFxInv: [1 / R.fx.w, 1 / R.fx.h], uBloomInv: bloomInv, uPost: [fxDraw.length ? 1 : 0, bloomTex ? bloomK : 0, 0, 0],
      uViewRot: new Float32Array([v[0], v[1], v[2], v[4], v[5], v[6], v[8], v[9], v[10]]), uTanHalf: C.tanHalf, uSize: [W, H],
      ...traceU,
      uBg: [bgMode, exposure, 0, 0], uBgColor: bgColor, uEyeW: C.eye,
      uSkyU: bgMode === 2 && !skyLit && sky ? [1, 1, 1, 2] : traceU.uSkyU,
      uHaze: hazeO ? [hazeO.density ?? 0.05, hazeO.g ?? hazeO.anisotropy ?? 0.5, q.moving ? 10 : 20, 1] : [0, 0, 0, 0],
      uHazeBall: hazeO ? [...(hazeO.center ?? bounds.center), hazeO.radius ?? bounds.radius * 1.6] : [0, 0, 0, 1], uHazeCol: hazeO ? toLinear(colorOf(hazeO.color ?? "#ffffff", true)) : [1, 1, 1],
    });
    gl.bindVertexArray(R.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (AC) {
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, Wo, Ho);
      const pp = prog("present");
      gl.useProgram(pp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, AC.tex);
      setAll(pp, { uSrc: 0 });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);

    const image = R.offscreen ? R.canvas.transferToImageBitmap() : R.canvas;
    const view = makeView(scene, items, C0, cssW, cssH, cut ? cutV : null, { image, sx: 0, sy: R.ch - Ho, sw: Wo, sh: Ho });
    view.quality = q.name;
    // A traced view refines over the next still frames; the runtime asks for them while this is true.
    view.converging = stochastic && !q.moving && accN + 1 < (scene.samples ?? (checkNow ? (lens ? 40 : 16) : lens ? 72 : 48));
    view.frames = stochastic ? accN + 1 : 1;
    view.trace = (o, d, tmax) => (Tr ? traceCPU(Tr.bvh, o, v3.norm(d), tmax ?? Infinity, false, cut ? cutV : null) : null);
    return view;
  }

  function makeView(scene, items, C, w, h, cut, source) {
    const invVP = m4.invert(C.vp);
    const project = p => {
      const q = m4.project(C.vp, p);
      return [(q[0] * 0.5 + 0.5) * w, (1 - (q[1] * 0.5 + 0.5)) * h, q[3]];
    };
    const ray = ([x, y]) => {
      const nx = (x / w) * 2 - 1, ny = 1 - (y / h) * 2;
      const a = m4.project(invVP, [nx, ny, -1]), b = m4.project(invVP, [nx, ny, 1]);
      return { origin: a.slice(0, 3), dir: v3.norm(v3.sub(b.slice(0, 3), a.slice(0, 3))) };
    };
    function pick(p, { ghosts = false } = {}) {
      const { origin, dir } = ray(p);
      let best = null;
      for (const it of items) {
        const node = it.node;
        if (!node.pickable) continue;
        const mat = resolveMaterial(node);
        if (!ghosts && mat.opacity < 0.5) continue;
        // bounding sphere
        const oc = v3.sub(origin, it.center), bq = v3.dot(oc, dir), cq = v3.dot(oc, oc) - it.radius * it.radius;
        if (bq * bq - cq < 0) continue;
        const inv = m4.invert(it.world);
        const o = m4.apply(inv, origin), d = m4.applyDir(inv, dir);
        // The ray's parameter is the same in the mesh's space as in the world's (dir is a unit
        // vector), so a hit beyond the best so far can be skipped; the world distance decides.
        const tmax = best ? best.distance * (1 + 1e-6) + 1e-9 : Infinity;
        const at = tt => m4.apply(it.world, [o[0] + d[0] * tt, o[1] + d[1] * tt, o[2] + d[2] * tt]);
        const cutAway = cut && node.cut ? tt => v3.dot(at(tt), cut.slice(0, 3)) > cut[3] : null;
        const P = node.mesh.positions, I = node.mesh.indices, tree = pickTree(node.mesh);
        let tt = Infinity;
        if (tree) { if (bvhNearest(tree.nodes, tree.tris, o, d, 0, tmax, false, 1e-12, cutAway && ((j, t) => !cutAway(t))) >= 0) tt = walkT; }
        else {
          let lim = tmax;
          for (let k = 0; k < I.length; k += 3) {
            const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3, ax = P[a], ay = P[a + 1], az = P[a + 2];
            const t = rayTri(o[0], o[1], o[2], d[0], d[1], d[2], ax, ay, az, P[b] - ax, P[b + 1] - ay, P[b + 2] - az, P[c] - ax, P[c + 1] - ay, P[c + 2] - az, 1e-12);
            if (!(t > 0) || t >= lim || (cutAway && cutAway(t))) continue;
            lim = tt = t;
          }
        }
        if (tt === Infinity) continue;
        const world = at(tt), dist = v3.dist(world, origin);
        if (!best || dist < best.distance) best = { node, point: world, distance: dist };
      }
      return best;
    }
    return {
      project,
      ray,
      pick,
      // The section cut this frame used, [nx, ny, nz, d] with a unit normal (n·p > d is removed), or null.
      cut: cut ? [...v3.norm(cut.slice(0, 3)), cut[3] / v3.len(cut.slice(0, 3))] : null,
      // False for a point the section cut removed.
      kept: p => !cut || v3.dot(cut.slice(0, 3), p) <= cut[3],
      // True when something opaque sits between the camera and p. `self` (a node, or its name) is
      // what the point belongs to: a label anchored inside a solid part isn't hidden by that part.
      hidden(p, self = null) {
        const s = project(p), hit = pick([s[0], s[1]]);
        if (!hit) return false;
        if (self) for (let n = hit.node; n; n = n.parent) if (n === self || n.name === self) return false;
        return hit.distance < v3.dist(ray([s[0], s[1]]).origin, p) - 1e-3 * C.distance;
      },
      eye: C.eye,
      target: C.target,
      width: w,
      height: h,
      source,
    };
  }
  // ---------- water ----------
  // E3.water: a simulated water surface (a pool's ripples or the open sea), drawn as a grid
  // displaced by the simulation and shaded as water: Fresnel (n = 1.333) between reflection (the
  // sky or studio, plus screen-space reflections of the scene) and refraction of what's below
  // (marched against the depth buffer, so a submerged part bends at the surface), Beer–Lambert
  // absorption along the real path through the water (down to the floor and back up), light
  // scattered back out of the water, sun glints, foam on breaking crests and at the shore, and
  // caustics on the floor and on anything under the surface.
  //
  // Both modes are linear wave fields solved exactly in Fourier space, so each wave travels at the
  // speed its wavelength gives it, ω² = (g k + (σ/ρ) k³) tanh(k h):
  // - pool: the field on the pool [0, w] x [0, d] is mirrored to a 2w x 2d period, which makes the
  //   walls reflect (zero slope at the wall: cosine modes). Every mode is a damped oscillator
  //   advanced exactly in time (no step-size limit); drops and moving objects add their analytic
  //   spectra; one inverse FFT per frame gives the height and both slopes. Damping is water's
  //   viscosity, 2νk² (Lamb), plus `damping` (surface films and the walls).
  // - ocean: Tessendorf's statistical sea: a Phillips spectrum for the wind, scaled so the
  //   significant wave height is the fully developed sea's (Pierson–Moskowitz, Hs = 0.21 U²/g),
  //   random amplitudes and phases from `seed`, each mode turning at ω(k); choppy horizontal
  //   displacement; a long and a short cascade so near water has detail and far water no repeat.
  const WG = 9.81, WSIGMA = 0.0728 / 998.2, WNU = 1.0e-6;
  // Absorption and backscattering per meter in R, G, B. Pure water absorbs red far more than blue
  // (Pope & Fry 1997: 0.34 /m at 650 nm, 0.064 at 560, 0.0092 at 450); its own scattering is weak
  // and bluish (Morel 1974, about λ^-4.3). The sea adds a little particle scattering; a pond adds
  // dissolved plant matter (CDOM, which absorbs blue) and silt.
  const WATER_BODIES = {
    clear: { absorb: [0.45, 0.07, 0.015], scatter: [0.0009, 0.0018, 0.0042] },
    sea: { absorb: [0.46, 0.075, 0.032], scatter: [0.0035, 0.0055, 0.0085] },
    pond: { absorb: [0.7, 0.32, 0.95], scatter: [0.035, 0.045, 0.03] },
  };
  // The dispersion relation of water waves (capillary-gravity, finite depth): ω(k) in rad/s for
  // k in rad/m and depth in m.
  function waterOmega(k, depth = Infinity, tension = true) {
    const th = Number.isFinite(depth) ? Math.tanh(Math.min(k * depth, 20)) : 1;
    return Math.sqrt(Math.max(0, (WG * k + (tension ? WSIGMA * k * k * k : 0)) * th));
  }
  // Inverse FFT, Stockham radix 2 (self-sorting): the same butterflies as FS_WFFT, for tests and the CPU field.
  function waterIfft1(re, im) {
    const N = re.length;
    let ar = Float64Array.from(re), ai = Float64Array.from(im), br = new Float64Array(N), bi = new Float64Array(N);
    for (let Ns = 1; Ns < N; Ns *= 2) {
      for (let o = 0; o < N; o++) {
        const r = o % (2 * Ns), b = Math.floor(o / (2 * Ns)), k = r % Ns, j = b * Ns + k, s = r < Ns ? 1 : -1;
        const a = (Math.PI * k) / Ns, c = Math.cos(a), sn = Math.sin(a), xr = ar[j + N / 2], xi = ai[j + N / 2];
        br[o] = ar[j] + s * (c * xr - sn * xi); bi[o] = ai[j] + s * (c * xi + sn * xr);
      }
      [ar, br] = [br, ar]; [ai, bi] = [bi, ai];
    }
    return [ar, ai];
  }
  function waterIfft2(re, im, N) {
    const R2 = Float64Array.from(re), I2 = Float64Array.from(im);
    for (let pass = 0; pass < 2; pass++) for (let a = 0; a < N; a++) {
      const r = new Float64Array(N), i = new Float64Array(N);
      for (let b = 0; b < N; b++) { const idx = pass ? b * N + a : a * N + b; r[b] = R2[idx]; i[b] = I2[idx]; }
      const [orr, oi] = waterIfft1(r, i);
      for (let b = 0; b < N; b++) { const idx = pass ? b * N + a : a * N + b; R2[idx] = orr[b]; I2[idx] = oi[b]; }
    }
    return [R2, I2];
  }
  // Index layout: element (x, z) of an N x N array is at z * N + x, mode m = x < N/2 ? x : x - N.
  const wMode = (x, N) => (x < N / 2 ? x : x - N);

  function water(o = {}) {
    const units = unitsOf(o.units ?? "m");
    const ocean = o.mode === "ocean";
    const sz = o.size ?? (ocean ? 400 : 2) * units;
    const g = new Node(null, { name: o.name ?? "water" });
    Object.assign(g, {
      isWater: true, mode: ocean ? "ocean" : "pool", units,
      size: Array.isArray(sz) ? [sz[0], sz[1]] : [sz, sz],
      depth: o.depth ?? (ocean ? 1000 : 1.5) * units,
      shape: o.shape === "round" ? "round" : "square",
      resolution: o.resolution ?? null,
      seed: o.seed ?? 1, tension: o.tension !== false,
      damping: o.damping ?? (ocean ? 0 : 0.12),
      wind: o.wind ?? 8, windDirection: o.windDirection ?? [1, 0.35], waveHeight: o.waveHeight ?? null,
      choppy: o.choppy ?? 1, patch: o.patch ?? null,
      body: o.body ?? (ocean ? "sea" : "clear"), absorb: o.absorb ?? null, scatter: o.scatter ?? null,
      foam: o.foam ?? (ocean ? 1 : 0), shore: o.shore ?? 0, caustics: o.caustics ?? !ocean, reflections: o.reflections !== false,
      rain: o.rain ?? 0, objects: o.objects ?? [], time: o.time ?? null,
      ripples: o.ripples ?? 0, rippleLength: o.rippleLength ?? null,
      meniscus: o.meniscus === true ? {} : o.meniscus ?? null,
      drops: [],
    });
    const [w, d] = g.size;
    // The node's mesh is a coarse copy of the surface (and, for a pool, its sides) for bounds and
    // picking; the drawn grid is finer and follows the quality tier.
    const surf = g.add(waterGrid(g, ocean ? 48 : 40, false), {
      name: "surface", material: { base: "water", ...(o.material || {}) }, castShadow: false, trace: false, pickable: o.pickable ?? true,
    });
    surf._water = g;
    g.surface = surf;
    if (!ocean && o.basin !== false && g.shape === "square") poolBasin(g, o);
    // A drop: a crater of radius r and depth amp (negative: a dip with a raised rim) at `point`,
    // [x, z] in the water's own coordinates (its center is 0, 0) or a world point [x, y, z].
    g.drop = (point, opt = {}) => {
      let x, z;
      if (point.length >= 3) { const c = g.toWorld([0, 0, 0]); x = point[0] - c[0]; z = point[2] - c[2]; }
      else [x, z] = point;
      g.drops.push({ x, z, r: opt.r ?? 0.02 * units, amp: opt.amp ?? -0.004 * units, t: opt.time ?? g._now ?? 0, shape: opt.shape === "bump" ? 1 : 0 });
      return g;
    };
    g.clear = () => { g.drops.length = 0; if (g._wgpu) g._wgpu.t = null; return g; };
    // The pool's height (world units) at local x, z and time t, from every drop so far (CPU, for tests and labels).
    g.heightAt = (x, z, t) => waterPoolLine(g, [[x, z]], t ?? g._now ?? 0)[0];
    return g;
  }
  // The water's drawn surface: an (n+1)² grid (denser near the middle at sea, a disk for a round
  // glass) and, for a pool, its sides down to the floor, so the water reads as a body from the side.
  function waterGrid(g, n, far) {
    const [w, d] = g.size, ocean = g.mode === "ocean", round = g.shape === "round";
    const P = [], N = [], I = [];
    const vert = (p, nn) => { P.push(...p); N.push(...nn); return P.length / 3 - 1; };
    const tri = (a, b, c, up) => {
      const A = P.slice(a * 3, a * 3 + 3), B = P.slice(b * 3, b * 3 + 3), C = P.slice(c * 3, c * 3 + 3);
      const nn = v3.cross(v3.sub(B, A), v3.sub(C, A));
      if (v3.dot(nn, up) < 0) I.push(a, c, b); else I.push(a, b, c);
    };
    const at = (u, v) => {
      if (round) {
        // Concentric square-to-disk map (Shirley and Chiu), so cells stay even.
        let r, a;
        if (Math.abs(u) > Math.abs(v)) { r = u; a = (Math.PI / 4) * (v / (u || 1)); } else { r = v; a = Math.PI / 2 - (Math.PI / 4) * (u / (v || 1)); }
        return [r * Math.cos(a) * w / 2, 0, r * Math.sin(a) * d / 2];
      }
      if (ocean) return [Math.sign(u) * Math.abs(u) ** 1.6 * w / 2, 0, Math.sign(v) * Math.abs(v) ** 1.6 * d / 2];
      return [u * w / 2, 0, v * d / 2];
    };
    if (far) {
      // Rings beyond the grid out toward the horizon, matching the grid's edge vertex for vertex.
      const loop = s => { const out = []; for (let k = 0; k < 4 * n; k++) { const side = Math.floor(k / n), f = (k % n) / n * 2 - 1; const [u, v] = [[f, -1], [1, f], [-f, 1], [-1, -f]][side]; const p = at(u, v); out.push([p[0] * s, 0, p[2] * s]); } return out; };
      let prev = loop(1).map(p => vert(p, [0, 1, 0]));
      for (let s = 1.5; s < 400; s *= 1.5) {
        const cur = loop(s).map(p => vert(p, [0, 1, 0]));
        for (let k = 0; k < cur.length; k++) { const k1 = (k + 1) % cur.length; tri(prev[k], prev[k1], cur[k1], [0, 1, 0]); tri(prev[k], cur[k1], cur[k], [0, 1, 0]); }
        prev = cur;
      }
      return makeMesh(new Float32Array(P), new Float32Array(N), new Uint32Array(I));
    }
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) vert(at((i / n) * 2 - 1, (j / n) * 2 - 1), [0, 1, 0]);
    const id = (i, j) => j * (n + 1) + i;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { tri(id(i, j), id(i, j + 1), id(i + 1, j), [0, 1, 0]); tri(id(i + 1, j), id(i, j + 1), id(i + 1, j + 1), [0, 1, 0]); }
    if (!ocean) {
      // The sides: the edge of the grid (top, following the surface) down to the floor.
      const edge = [];
      for (let i = 0; i < n; i++) edge.push([i, 0]);
      for (let j = 0; j < n; j++) edge.push([n, j]);
      for (let i = n; i > 0; i--) edge.push([i, n]);
      for (let j = n; j > 0; j--) edge.push([0, j]);
      const ring = edge.map(([i, j]) => ({ p: at((i / n) * 2 - 1, (j / n) * 2 - 1) }));
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k], b = ring[(k + 1) % ring.length];
        // Each quad gets its own vertices so a square's corners stay sharp.
        const flat = Math.abs(a.p[0] - b.p[0]) < 1e-9 ? [Math.sign(a.p[0]), 0, 0] : [0, 0, Math.sign(a.p[2])];
        const na = round ? v3.norm([a.p[0], 0, a.p[2]]) : flat, nb = round ? v3.norm([b.p[0], 0, b.p[2]]) : flat;
        const t0 = vert(a.p, na), t1 = vert(b.p, nb), b0 = vert([a.p[0], -g.depth, a.p[2]], na), b1 = vert([b.p[0], -g.depth, b.p[2]], nb);
        const mid = v3.lerp(a.p, b.p, 0.5), outward = round ? v3.norm([mid[0], 0, mid[2]]) : flat;
        tri(t0, b0, t1, outward); tri(t1, b0, b1, outward);
      }
      // The bottom, so a glass of water seen from below is closed.
      const c0 = vert([0, -g.depth, 0], [0, -1, 0]);
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k].p, b = ring[(k + 1) % ring.length].p;
        tri(c0, vert([a[0], -g.depth, a[2]], [0, -1, 0]), vert([b[0], -g.depth, b[2]], [0, -1, 0]), [0, -1, 0]);
      }
    }
    return makeMesh(new Float32Array(P), new Float32Array(N), new Uint32Array(I));
  }
  // A swimming pool's tiled shell: floor and walls of glazed tile with grout lines, a dark lane
  // line down the floor, and a stone coping around the top, a little above the water.
  function poolBasin(g, o) {
    const [w, d] = g.size, D = g.depth, u = g.units, t = 0.12 * u, free = o.freeboard ?? 0.1 * u, tile = o.tile ?? 0.125 * u;
    const tiles = (cols, rows, lane) => {
      if (typeof document === "undefined") return null;
      const px = Math.max(8, Math.min(64, Math.floor(1536 / Math.max(cols, rows))));
      const c = document.createElement("canvas"); c.width = cols * px; c.height = rows * px;
      const x = c.getContext("2d");
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const r = rndU(i + 1, j + 1, 7, 3), v = Math.round(206 + r * 14);
        x.fillStyle = `rgb(${v - 6},${v},${v + 2})`; x.fillRect(i * px, j * px, px, px);
      }
      if (lane) { x.fillStyle = "#1f3046"; const lw = Math.max(2, Math.round(0.25 * u / tile)) * px; x.fillRect(Math.round(cols / 2) * px - lw / 2, px * 2, lw, (rows - 4) * px); }
      x.fillStyle = "#7d8a91";
      const gw = Math.max(1, px * 0.09);
      for (let i = 0; i <= cols; i++) x.fillRect(i * px - gw / 2, 0, gw, rows * px);
      for (let j = 0; j <= rows; j++) x.fillRect(0, j * px - gw / 2, cols * px, gw);
      return c;
    };
    const tileMat = (map, mapping, box) => ({ color: "#ffffff", metal: 0, roughness: 0.22, clearcoat: 0.6, ...(map ? { map, mapping, mapBox: box } : {}) });
    const nx = Math.ceil(w / tile), nz = Math.ceil(d / tile);
    const floorMap = tiles(nx, nz, true);
    g.add(mesh.box(w, t, d), { name: "pool floor", position: [0, -D - t / 2, 0], material: tileMat(floorMap, "planar", [-w / 2, -d / 2, nx * tile, nz * tile]) });
    // Walls: meshes shifted so their local coordinates start at 0, which "box" mapping tiles from.
    const H = D + free, span = Math.max(w, d) + 2 * t, K = Math.ceil(Math.max(span, H) / tile) + 1;
    const wallMap = tiles(K, K, false);
    const wall = (sx, sz, px, pz, name) => g.add(mesh.transform(mesh.box(sx, H, sz), m4.translation([sx / 2, H / 2, sz / 2])), { name, position: [px - sx / 2, -D, pz - sz / 2], material: tileMat(wallMap, "box", [0, 0, K * tile, K * tile]) });
    wall(t, d + 2 * t, -w / 2 - t / 2, 0, "pool wall");
    wall(t, d + 2 * t, w / 2 + t / 2, 0, "pool wall");
    wall(w, t, 0, -d / 2 - t / 2, "pool wall");
    wall(w, t, 0, d / 2 + t / 2, "pool wall");
    if (o.coping !== false) {
      const cw = 0.3 * u, ch = 0.05 * u, stone = { color: "#d9d3c7", metal: 0, roughness: 0.8 };
      g.add(mesh.box(w + 2 * cw - 0.06 * u, ch, cw, { round: ch * 0.3 }), { name: "coping", position: [0, free + ch / 2, -(d / 2 + cw / 2 - 0.03 * u)], material: stone });
      g.add(mesh.box(w + 2 * cw - 0.06 * u, ch, cw, { round: ch * 0.3 }), { name: "coping", position: [0, free + ch / 2, d / 2 + cw / 2 - 0.03 * u], material: stone });
      g.add(mesh.box(cw, ch, d - 0.06 * u, { round: ch * 0.3 }), { name: "coping", position: [-(w / 2 + cw / 2 - 0.03 * u), free + ch / 2, 0], material: stone });
      g.add(mesh.box(cw, ch, d - 0.06 * u, { round: ch * 0.3 }), { name: "coping", position: [w / 2 + cw / 2 - 0.03 * u, free + ch / 2, 0], material: stone });
    }
    // A paved deck around it, so the pool sits in the ground rather than on it.
    const deck = o.deck ?? 1.2 * u;
    if (deck > 0) {
      const ch = o.coping !== false ? 0.05 * u : 0, top = free + ch - 0.005 * u, bot = -D - t, hh = top - bot, X = w / 2 + t, Z = d / 2 + t;
      const pave = { color: "#cdc6b8", metal: 0, roughness: 0.85 };
      g.add(mesh.box(2 * (X + deck), hh, deck), { name: "deck", position: [0, bot + hh / 2, -(Z + deck / 2)], material: pave, pickable: false });
      g.add(mesh.box(2 * (X + deck), hh, deck), { name: "deck", position: [0, bot + hh / 2, Z + deck / 2], material: pave, pickable: false });
      g.add(mesh.box(deck, hh, 2 * Z), { name: "deck", position: [-(X + deck / 2), bot + hh / 2, 0], material: pave, pickable: false });
      g.add(mesh.box(deck, hh, 2 * Z), { name: "deck", position: [X + deck / 2, bot + hh / 2, 0], material: pave, pickable: false });
    }
    // The water traces its own basin (refraction shows floor the walls hide from a dry view).
    g.basin = floorMap ? { floor: floorMap, wall: wallMap, floorBox: [-w / 2, -d / 2, nx * tile, nz * tile], wallPeriod: K * tile, t } : true;
  }

  // Sim size: the pool's cells across (the FFT is twice that, for the mirror), the sea's FFT size.
  const waterRes = g => g.resolution ?? (startRank() >= 2 ? 256 : 128);
  // The pool's drops as spectra, all in meters: drop i at (s, t) from the pool's corner.
  function waterDropsSI(g, list, tNow) {
    const u = g.units, [w, d] = g.size;
    return list.map(dp => ({ s: (dp.x + w / 2) / u, t: (dp.z + d / 2) / u, r: dp.r / u, amp: dp.amp / u, tau: tNow - dp.t, shape: dp.shape }));
  }
  // Rain: deterministic drops, slot k falls at (k + jitter) / rate seconds somewhere on the surface.
  function waterRain(g, t0, t1) {
    const out = [], rate = g.rain;
    if (!(rate > 0) || t1 <= t0) return out;
    const [w, d] = g.size, u = g.units;
    for (let k = Math.max(0, Math.floor(t0 * rate) - 1); k <= Math.ceil(t1 * rate) && out.length < 512; k++) {
      const tk = (k + rndU(k, 0, 11, g.seed)) / rate;
      if (tk <= t0 || tk > t1) continue;
      const s = 0.4 + 0.6 * rndU(k, 3, 11, g.seed);
      out.push({ x: (rndU(k, 1, 11, g.seed) - 0.5) * w, z: (rndU(k, 2, 11, g.seed) - 0.5) * d, r: 0.006 * u * s, amp: -0.0015 * u * s, t: tk, shape: 0 });
    }
    return out;
  }
  // Wind ripples on a pool: rms height `ripples` (world units) spread over waves from about
  // `rippleLength` x 3 down to 40% of it. Returns [scale, k0, k1] for FS_WPOOL (and the CPU mirror).
  function waterAmbient(g, N) {
    const rms = (g.ripples ?? 0) / g.units;
    if (!(rms > 0)) return [0, 1, 1];
    const lam = (g.rippleLength ?? 0.08 * g.units) / g.units, k0 = (2 * Math.PI) / (lam * 3), k1 = (2 * Math.PI) / (lam / 2.5);
    const key = `${N}|${g.size}|${lam}`;
    if (g._ambKey !== key) {
      const [w, d] = g.size.map(v => v / g.units);
      let sum = 0;
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const kx = (Math.PI * wMode(x, N)) / w, kz = (Math.PI * wMode(z, N)) / d, k = Math.hypot(kx, kz);
        if (k > 0) sum += k ** -4 * Math.exp(-((k0 / k) ** 2) - (k / k1) ** 2);
      }
      g._ambKey = key; g._ambSum = sum;
    }
    return [rms / Math.sqrt(Math.max(g._ambSum, 1e-30)), k0, k1];
  }
  // How long a drop matters: after this its waves are below a thousandth of their start.
  const waterWindow = g => Math.min(120, Math.log(1000) / Math.max(g.damping, 0.02));
  // CPU mirror of the pool's spectrum and FFT: the height (world units) at points [[x, z], ...]
  // at time t. For tests; the GPU path keeps the spectrum and advances it every frame instead.
  function waterPoolLine(g, pts, t) {
    const R = Math.min(waterRes(g), 128), N = 2 * R, [w0, d0] = g.size, u = g.units, w = w0 / u, d = d0 / u, H = g.depth / u;
    const drops = waterDropsSI(g, g.drops.concat(waterRain(g, Math.max(0, t - waterWindow(g)), t)).filter(dp => dp.t <= t), t);
    const re = new Float64Array(N * N), im = new Float64Array(N * N), amb = waterAmbient(g, N);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const kx = (Math.PI * wMode(x, N)) / w, kz = (Math.PI * wMode(z, N)) / d, k = Math.hypot(kx, kz);
      const om = waterOmega(k, H, g.tension), gam = 2 * WNU * k * k + g.damping;
      let h = 0;
      if (amb[0] > 0 && k > 0) {
        const S = k ** -4 * Math.exp(-((amb[1] / k) ** 2) - (k / amb[2]) ** 2);
        const hh = hashU((Math.imul(Math.abs(wMode(x, N)), 7919) + Math.imul(Math.abs(wMode(z, N)), 104729) + g.seed * 9973) >>> 0);
        h += amb[0] * Math.sqrt(2 * S) * Math.cos(om * t + ((hh >>> 8) / 16777216) * 2 * Math.PI);
      }
      for (const dp of drops) {
        const rr = dp.r * dp.r, kr = k * k * rr / 4;
        const D = dp.amp * Math.PI * rr * (dp.shape ? 1 : kr) * Math.exp(-kr) * Math.cos(kx * dp.s) * Math.cos(kz * dp.t) / (w * d);
        h += D * Math.cos(om * dp.tau) * Math.exp(-gam * dp.tau);
      }
      re[z * N + x] = h;
    }
    const [fr] = waterIfft2(re, im, N);
    // Bilinear on the cell grid: sample j sits at s = j * w / R.
    return pts.map(([x, z]) => {
      const fx = Math.max(0, Math.min(R, ((x + w0 / 2) / w0) * R)), fz = Math.max(0, Math.min(R, ((z + d0 / 2) / d0) * R));
      const i0 = Math.min(R - 1, Math.floor(fx)), j0 = Math.min(R - 1, Math.floor(fz)), a = fx - i0, b = fz - j0;
      const v = (i, j) => fr[j * N + i];
      return u * ((v(i0, j0) * (1 - a) + v(i0 + 1, j0) * a) * (1 - b) + (v(i0, j0 + 1) * (1 - a) + v(i0 + 1, j0 + 1) * a) * b);
    });
  }
  // The sea: cascades, each a square patch L meters across carrying the band of wavenumbers
  // [k0, k1). The long one sets the swell, the short one (an irrational fraction of it, so the two
  // never repeat together) the chop.
  function oceanSetup(g) {
    const N = waterRes(g), U = Math.max(0.5, g.wind), Lw = (U * U) / WG;
    const kp = 0.877 * 0.877 * WG / (U * U);           // Pierson–Moskowitz peak wavenumber
    const L0 = g.patch ? g.patch / g.units : Math.max(60, 5.5 * (2 * Math.PI / kp));
    const L1 = L0 / 17.3;
    const kNy0 = (Math.PI * N) / L0, kNy1 = (Math.PI * N) / L1;
    const kSplit = kNy0 * 0.45;
    const cas = [{ L: L0, k0: 0, k1: kSplit }, { L: L1, k0: kSplit, k1: kNy1 * 0.6 }];
    const wd = v3.norm([g.windDirection[0], 0, g.windDirection[1]]);
    const small = Lw / 3000;
    const raw = cas.map((c, ci) => {
      const h0 = new Float32Array(N * N * 4), amp = new Float64Array(N * N * 2);
      const dk = (2 * Math.PI) / c.L;
      // Phillips spectrum P(k) = exp(-1/(kL)²) / k⁴ |k̂·ŵ|², waves against the wind cut down,
      // the shortest waves rolled off; Gaussian amplitudes (Box–Muller) from the seed.
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const kx = wMode(x, N) * dk, kz = wMode(z, N) * dk, k = Math.hypot(kx, kz);
        let P = 0;
        if (k > 1e-9 && k >= c.k0 && k < c.k1) {
          const cw = (kx * wd[0] + kz * wd[2]) / k;
          P = (Math.exp(-1 / ((k * Lw) ** 2)) / k ** 4) * cw * cw * (cw < 0 ? 0.15 : 1) * Math.exp(-((k * small) ** 2)) * dk * dk;
        }
        const i = z * N + x, s = g.seed * 7 + ci * 131;
        const u1 = Math.max(1e-12, rndU(i, 0, s, 17)), u2 = rndU(i, 1, s, 17), u3 = Math.max(1e-12, rndU(i, 2, s, 17)), u4 = rndU(i, 3, s, 17);
        const m1 = Math.sqrt(-2 * Math.log(u1)), m2 = Math.sqrt(-2 * Math.log(u3));
        const a = Math.sqrt(P / 2);
        amp[i * 2] = a * m1 * Math.cos(2 * Math.PI * u2);
        amp[i * 2 + 1] = a * m2 * Math.sin(2 * Math.PI * u4);
      }
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const i = z * N + x, j = ((N - z) % N) * N + ((N - x) % N);
        h0.set([amp[i * 2], amp[i * 2 + 1], amp[j * 2], -amp[j * 2 + 1]], i * 4);
      }
      return { ...c, h0, dk };
    });
    // Scale every cascade together so the sea's significant height Hs = 4 σ is the fully developed
    // sea's for this wind, 0.21 U² / g, unless waveHeight says otherwise.
    let varH = 0, varS = 0;
    for (const c of raw) for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = (z * N + x) * 4, e = c.h0[i] ** 2 + c.h0[i + 1] ** 2 + c.h0[i + 2] ** 2 + c.h0[i + 3] ** 2;
      varH += e; varS += e * ((wMode(x, N) * c.dk) ** 2 + (wMode(z, N) * c.dk) ** 2);
    }
    const Hs = g.waveHeight != null ? g.waveHeight / g.units : (0.21 * U * U) / WG;
    const sc = Hs / 4 / Math.sqrt(Math.max(varH, 1e-30));
    for (const c of raw) for (let i = 0; i < c.h0.length; i++) c.h0[i] *= sc;
    // Waves too short for either cascade still tilt the surface: Cox and Munk (1954) measured the
    // sea's total mean square slope, 0.003 + 0.00512 U; what the cascades don't resolve becomes roughness.
    const resolved = varS * sc * sc;
    const cm = 0.003 + 0.00512 * U;
    return { N, cas: raw, Hs, msSlope: cm, subSlope: Math.max(0.0015, cm - resolved), resolvedSlope: resolved, key: `${N}|${U}|${g.windDirection}|${g.waveHeight}|${g.seed}|${g.patch}|${g.units}` };
  }
  // CPU mirror of the ocean's spectrum at time t (FS_WOCEAN), height only, in meters: for tests.
  function oceanHeightField(g, t, ci = 0) {
    const S = g._ocean && g._ocean.key === oceanSetup.keyOf(g) ? g._ocean : (g._ocean = oceanSetup(g));
    const c = S.cas[ci], N = S.N, H = g.depth / g.units;
    const re = new Float64Array(N * N), im = new Float64Array(N * N);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x, k = Math.hypot(wMode(x, N), wMode(z, N)) * c.dk, om = waterOmega(k, H, g.tension);
      const cs = Math.cos(om * t), sn = Math.sin(om * t), h = c.h0.subarray(i * 4, i * 4 + 4);
      re[i] = h[0] * cs - h[1] * sn + h[2] * cs + h[3] * sn;
      im[i] = h[0] * sn + h[1] * cs - h[2] * sn + h[3] * cs;
    }
    return { N, L: c.L, h: waterIfft2(re, im, N)[0], cascade: c, setup: S };
  }
  oceanSetup.keyOf = g => `${waterRes(g)}|${Math.max(0.5, g.wind)}|${g.windDirection}|${g.waveHeight}|${g.seed}|${g.patch}|${g.units}`;

  // ---------- water on the GPU ----------
  const FS_WPOOL = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uState;
uniform vec4 uP0;  // FFT size, pool width and length (m), time step (s)
uniform vec4 uP1;  // depth (m), surface tension on, damping (1/s), world units per meter
uniform vec4 uDrop[32];  // s, t (m from the pool's corner), radius (m), amplitude (m)
uniform vec4 uDropT[32]; // seconds since the drop, shape (0 crater, 1 bump)
uniform int uDropN;
uniform vec4 uAmb; // wind ripples: amplitude scale, long and short cutoff (rad/m), time
uniform uint uSeed;
layout(location=0) out vec4 oState;
layout(location=1) out vec4 oSpec;
uint hashu(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float omegaOf(float k) { float th = uP1.x > 0.0 ? tanh(min(k * uP1.x, 20.0)) : 1.0; return sqrt(max((9.81 * k + uP1.y * 7.293e-5 * k * k * k) * th, 0.0)); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int N = int(uP0.x + 0.5);
  int mx = p.x < N / 2 ? p.x : p.x - N, mz = p.y < N / 2 ? p.y : p.y - N;
  float kx = 3.14159265 * float(mx) / uP0.y, kz = 3.14159265 * float(mz) / uP0.z, k = length(vec2(kx, kz));
  float om = omegaOf(k), gam = 2.0e-6 * k * k + uP1.z;
  vec4 s = texelFetch(uState, p, 0);
  float h = s.x, v = s.y, dt = uP0.w;
  // Each mode is a damped oscillator; advance it exactly.
  if (dt > 0.0) {
    float c = cos(om * dt), sn = sin(om * dt), e = exp(-gam * dt);
    float h2 = om > 1e-6 ? h * c + v / om * sn : h + v * dt;
    float v2 = v * c - h * om * sn;
    h = h2 * e; v = v2 * e;
  }
  // Drops: the spectrum of a crater (1 - r²/a²) exp(-r²/a²) (or a plain bump) and its mirror images
  // in the walls, already advanced by the time since it fell.
  for (int i = 0; i < 32; i++) {
    if (i >= uDropN) break;
    vec4 d = uDrop[i], d2 = uDropT[i];
    float rr = d.z * d.z, kr = k * k * rr * 0.25;
    float D = d.w * 3.14159265 * rr * (d2.y > 0.5 ? 1.0 : kr) * exp(-kr) * cos(kx * d.x) * cos(kz * d.y) / (uP0.y * uP0.z);
    float e = exp(-gam * d2.x);
    h += D * cos(om * d2.x) * e; v -= D * om * sin(om * d2.x) * e;
  }
  oState = vec4(h, v, 0.0, 0.0);
  // Wind ripples: every standing mode in a band of short waves (k^-4 between the cutoffs) at a
  // fixed amplitude and a hashed phase, turning at its own ω; they never die, and are the same
  // at the same time.
  if (uAmb.x > 0.0 && k > 0.0) {
    float S = pow(k, -4.0) * exp(-pow(uAmb.y / k, 2.0) - pow(k / uAmb.z, 2.0));
    uint hh = hashu(uint(abs(mx)) * 7919u + uint(abs(mz)) * 104729u + uSeed);
    h += uAmb.x * sqrt(2.0 * S) * cos(om * uAmb.w + float(hh >> 8) / 16777216.0 * 6.2831853);
  }
  // Height and slopes in one complex FFT: (h + i dh/dx, dh/dz); the Nyquist row has no slope.
  float sx = mx == -N / 2 ? 0.0 : kx, sz = mz == -N / 2 ? 0.0 : kz;
  oSpec = vec4(h * uP1.w - sx * h, 0.0, 0.0, sz * h);
}`;

  const FS_WOCEAN = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uH0;
uniform vec4 uO0; // FFT size, patch (m), time (s), depth (m)
uniform vec4 uO1; // choppiness, world units per meter, surface tension on
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 iz(vec2 a) { return vec2(-a.y, a.x); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int N = int(uO0.x + 0.5);
  int mx = p.x < N / 2 ? p.x : p.x - N, mz = p.y < N / 2 ? p.y : p.y - N;
  float dk = 6.28318531 / uO0.y, kx = float(mx) * dk, kz = float(mz) * dk, k = length(vec2(kx, kz));
  float th = tanh(min(k * uO0.w, 20.0));
  float om = sqrt(max((9.81 * k + uO1.z * 7.293e-5 * k * k * k) * th, 0.0));
  vec4 h0 = texelFetch(uH0, p, 0);
  float ph = mod(om * uO0.z, 6.28318531);
  vec2 e = vec2(cos(ph), sin(ph));
  vec2 ht = cmul(h0.xy, e) + cmul(h0.zw, vec2(e.x, -e.y));
  float ik = k > 1e-8 ? 1.0 / k : 0.0, lam = uO1.x, u = uO1.y;
  if (mx == -N / 2) kx = 0.0;
  if (mz == -N / 2) kz = 0.0;
  vec2 H = ht * u, Dx = iz(ht) * (kx * ik * lam * u), Dz = iz(ht) * (kz * ik * lam * u);
  vec2 hx = iz(ht) * kx, hz = iz(ht) * kz;
  vec2 Dxx = -ht * (kx * kx * ik * lam), Dzz = -ht * (kz * kz * ik * lam), Dxz = -ht * (kx * kz * ik * lam);
  // Two real fields per complex FFT: A + iB transforms to a + ib when A and B are Hermitian.
  o0 = vec4(H + iz(Dx), Dz + iz(hx));
  o1 = vec4(hz + iz(Dxx), Dzz + iz(Dxz));
}`;

  // One pass of an inverse FFT (Stockham radix 2, self-sorting) along x or z, on two complex
  // numbers per texel (and a second texture when TWO).
  const fsWfft = two => `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uSrc0;${two ? " uniform sampler2D uSrc1;" : ""}
uniform vec4 uF; // size, half-size of this stage's butterflies, direction (0 x, 1 z)
layout(location=0) out vec4 o0;${two ? "\nlayout(location=1) out vec4 o1;" : ""}
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int N = int(uF.x + 0.5), Ns = int(uF.y + 0.5);
  int o = uF.z < 0.5 ? p.x : p.y;
  int r = o % (2 * Ns), k = r % Ns, j = (o / (2 * Ns)) * Ns + k;
  float sg = r < Ns ? 1.0 : -1.0;
  ivec2 q0 = p, q1 = p;
  if (uF.z < 0.5) { q0.x = j; q1.x = j + N / 2; } else { q0.y = j; q1.y = j + N / 2; }
  float a = 3.14159265358979 * float(k) / float(Ns);
  vec2 w = vec2(cos(a), sin(a));
  vec4 a0 = texelFetch(uSrc0, q0, 0), a1 = texelFetch(uSrc0, q1, 0);
  o0 = vec4(a0.xy + sg * cmul(w, a1.xy), a0.zw + sg * cmul(w, a1.zw));${two ? `
  vec4 b0 = texelFetch(uSrc1, q0, 0), b1 = texelFetch(uSrc1, q1, 0);
  o1 = vec4(b0.xy + sg * cmul(w, b1.xy), b0.zw + sg * cmul(w, b1.zw));` : ""}
}`;

  // The FFT's output as the maps the surface reads: A = displacement (x, y, z) and the Jacobian
  // (below 1 where the sea folds: foam); B = slopes and their squares, mipmapped, so a distant
  // pixel reads the mean slope and its variance (roughness from the waves it can't resolve).
  const FS_WFIN = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uF0; uniform sampler2D uF1;
uniform vec4 uFin; // mode (0 pool, 1 ocean)
layout(location=0) out vec4 oA;
layout(location=1) out vec4 oB;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uF0, p, 0);
  if (uFin.x < 0.5) { oA = vec4(0.0, a.x, 0.0, 1.0); oB = vec4(a.y, a.z, a.y * a.y, a.z * a.z); return; }
  vec4 b = texelFetch(uF1, p, 0); // a = (h, Dx, Dz, dh/dx), b = (dh/dz, dDx/dx, dDz/dz, dDx/dz)
  float J = (1.0 + b.y) * (1.0 + b.z) - b.w * b.w;
  vec2 s = vec2(a.w / max(1.0 + b.y, 0.3), b.x / max(1.0 + b.z, 0.3));
  oA = vec4(a.y, a.x, a.z, J);
  oB = vec4(s, s * s);
}`;

  // Caustics: sunlight refracted through every cell of the simulated surface lands on the floor;
  // the light a cell carries is spread over the area it lands on, so the brightness there is the
  // ratio of the cell's area to its image's (energy is conserved). Drawn additively, so where
  // several cells fold onto one spot their light adds up: the bright lines.
  const VS_WCAUST = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uWA0; uniform sampler2D uWB0;
uniform vec4 uWM0; // local x, z to map uv
uniform vec4 uC0;  // half width, half length, depth (world), cells per side
uniform vec3 uC1;  // toward the sun
out vec2 vOld; out vec2 vNew;
void main() {
  int n = int(uC0.w + 0.5);
  int tri = gl_VertexID / 3, c = gl_VertexID % 3, cell = tri / 2;
  ivec2 o = tri % 2 == 0 ? (c == 0 ? ivec2(0, 0) : c == 1 ? ivec2(1, 0) : ivec2(0, 1)) : (c == 0 ? ivec2(1, 0) : c == 1 ? ivec2(1, 1) : ivec2(0, 1));
  vec2 gp = (vec2(float(cell % n), float(cell / n)) + vec2(o)) / float(n);
  vec2 xz = (gp * 2.0 - 1.0) * uC0.xy;
  vec2 uv = xz * uWM0.xy + uWM0.zw;
  float h = textureLod(uWA0, uv, 0.0).y;
  vec2 s = textureLod(uWB0, uv, 0.0).xy;
  vec3 t = refract(-uC1, normalize(vec3(-s.x, 1.0, -s.y)), 0.75), t0 = refract(-uC1, vec3(0.0, 1.0, 0.0), 0.75);
  vec2 hit = xz + t.xz * (h + uC0.z) / max(-t.y, 1e-3);
  vec2 q = hit - t0.xz * uC0.z / max(-t0.y, 1e-3);
  vOld = xz; vNew = q;
  gl_Position = vec4(q / uC0.xy, 0.0, 1.0);
}`;
  const FS_WCAUST = `#version 300 es
precision highp float;
in vec2 vOld; in vec2 vNew;
out vec4 o;
void main() {
  vec2 a = dFdx(vOld), b = dFdy(vOld), c = dFdx(vNew), d = dFdy(vNew);
  float A0 = abs(a.x * b.y - a.y * b.x), A1 = abs(c.x * d.y - c.y * d.x);
  o = vec4(min(A0 / max(A1, 1e-20), 24.0), 0.0, 0.0, 1.0);
}`;

  // The surface: the grid displaced by the maps (both cascades at sea). The far rings fade the
  // displacement out and are pinned inside the far plane so the sea reaches the horizon.
  const VS_WATER = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel, uViewProj;
uniform sampler2D uWA0; uniform sampler2D uWA1;
uniform vec4 uWM0; uniform vec4 uWM1; // local x, z to map uv, per cascade
uniform vec4 uWV; // cascades, fade start, fade end (local distance), far rings
uniform vec4 uWD; // depth (world; the sides and bottom follow it), meniscus height and length, round radius
out vec3 vWorld; out vec3 vLocal; out vec2 vUv0; out vec2 vUv1; out float vSide; out vec3 vN;
void main() {
  vec3 p = aPos;
  if (p.y < -1e-5) p.y = -uWD.x;
  vUv0 = p.xz * uWM0.xy + uWM0.zw;
  vUv1 = p.xz * uWM1.xy + uWM1.zw;
  bool side = abs(aNormal.y) < 0.5;
  float fade = 1.0 - smoothstep(uWV.y, uWV.z, length(p.xz));
  if (p.y > -1e-5 && aNormal.y > -0.5) {
    vec3 d = textureLod(uWA0, vUv0, 0.0).xyz;
    if (uWV.x > 1.5) d += textureLod(uWA1, vUv1, 0.0).xyz;
    if (side) d.xz = vec2(0.0);
    p += d * fade;
    // A meniscus: water climbs a wetted wall, falling off over the capillary length.
    if (uWD.y > 0.0) p.y += uWD.y * exp(-max(uWD.w - length(p.xz), 0.0) / uWD.z);
  }
  vLocal = p;
  vSide = side ? 1.0 : aNormal.y < -0.5 ? 2.0 : 0.0;
  vec4 w = uModel * vec4(p, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(uModel) * aNormal);
  gl_Position = uViewProj * w;
  if (uWV.w > 0.5) gl_Position.z = min(gl_Position.z, gl_Position.w * 0.99999);
}`;

  const FS_WATER = `#version 300 es
${G_COMMON}
${G_ENV}
${G_SHADOW}
in vec3 vWorld; in vec3 vLocal; in vec2 vUv0; in vec2 vUv1; in float vSide; in vec3 vN;
uniform vec3 uEye; uniform vec3 uLight; uniform vec3 uKeyCol; uniform vec4 uLook;
uniform mat4 uViewProj; uniform vec3 uCamF;
uniform sampler2D uScene; uniform sampler2D uDepthC; uniform vec2 uSceneInv; uniform vec2 uSceneSize;
uniform sampler2D uWA0; uniform sampler2D uWB0; uniform sampler2D uWA1; uniform sampler2D uWB1;
uniform vec4 uW0;   // level (world y), depth (world), world units per meter, cascades
uniform vec4 uW1;   // half width, half length, round, sea
uniform vec3 uAbs;  // absorption per world unit
uniform vec3 uSca;  // backscattering per world unit
uniform vec4 uW2;   // unresolved mean square slope, foam, time, shore foam width (world)
uniform vec3 uOrigin; // the water's center at its level (world)
uniform vec3 uSunW; // sunlight's direction under a flat surface (pointing down)
uniform vec4 uW3;   // reflections on, march steps, highlight, the main shader already dimmed what's under it
uniform vec4 uWM0; uniform vec4 uWM1; uniform vec4 uWD;
uniform sampler2D uFloorMap; uniform sampler2D uWallMap; uniform sampler2D uCaust2;
uniform vec4 uBasin;  // traced basin on, wall tile period, wall thickness, caustics on
uniform vec4 uBasin2; // floor map box: origin x, z, size x, z
uniform vec3 uFillDir; uniform vec3 uFillCol;
uniform vec4 uPageBg; // the page's color behind the figure, on
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;
const float ETA = 1.333;
vec2 pxOf(vec3 p) { vec4 c = uViewProj * vec4(p, 1.0); return (c.xy / c.w * 0.5 + 0.5) * uSceneSize; }
float viewZ(vec3 p) { return dot(p - uEye, uCamF); }
float sceneZ(vec2 px) { return linDepth(texture(uDepthC, px * uSceneInv).r); }
vec4 sceneAt(vec2 px) { return texture(uScene, clamp(px, vec2(0.5), uSceneSize - 0.5) * uSceneInv); }
// March a ray against the depth buffer of what's already drawn; returns the distance to the first
// surface it meets (refined by bisection), or -1. Steps grow with distance (fine near the start);
// passing far behind something (more than a step deep) is not a hit, so a thin part doesn't smear.
float march(vec3 o, vec3 d, float tmax, int n, float jit) {
  float t0 = 0.0, tp = 0.0;
  for (int i = 0; i < 48; i++) {
    if (i >= n) break;
    float f = (float(i) + jit) / float(n), t = tmax * f * f;
    vec3 p = o + d * t;
    vec2 px = pxOf(p);
    if (px.x < 0.0 || px.y < 0.0 || px.x > uSceneSize.x || px.y > uSceneSize.y || viewZ(p) < 0.0) return -1.0;
    float dz = viewZ(p) - sceneZ(px);
    if (dz > 0.0) {
      if (dz < (t - tp) * 1.5 + 0.004 * viewZ(p)) {
        for (int j = 0; j < 6; j++) { float tm = 0.5 * (t0 + t); vec3 q = o + d * tm; if (viewZ(q) > sceneZ(pxOf(q))) t = tm; else t0 = tm; }
        return t;
      }
    } else t0 = t;
    tp = t;
  }
  return -1.0;
}
// Where a ray inside the water leaves its volume (local coordinates): the floor or the sides.
float exitT(vec3 p, vec3 d) {
  float t = 1e20;
  if (d.y < -1e-6) t = (-uW0.y - p.y) / d.y;
  if (uW1.w > 0.5) return t;
  if (uW1.z > 0.5) {
    float a = dot(d.xz, d.xz), b = dot(p.xz, d.xz), c = dot(p.xz, p.xz) - uW1.x * uW1.x;
    if (a > 1e-9) t = min(t, (-b + sqrt(max(b * b - a * c, 0.0))) / a);
  } else {
    if (abs(d.x) > 1e-6) t = min(t, ((d.x > 0.0 ? uW1.x : -uW1.x) - p.x) / d.x);
    if (abs(d.z) > 1e-6) t = min(t, ((d.z > 0.0 ? uW1.y : -uW1.y) - p.z) / d.z);
  }
  return max(t, 0.0);
}
vec2 slopeAt(vec2 uv0, vec2 uv1, out float var) {
  vec4 b = texture(uWB0, uv0);
  vec2 s = b.xy;
  var = max(b.z - b.x * b.x, 0.0) + max(b.w - b.y * b.y, 0.0);
  if (uW0.w > 1.5) { vec4 c = texture(uWB1, uv1); s += c.xy; var += max(c.z - c.x * c.x, 0.0) + max(c.w - c.y * c.y, 0.0); }
  return s;
}
// Light inside the water: what the sun and sky put in just under the surface.
vec3 downwell() { return uKeyCol * max(uLight.y, 0.0) * 0.97 + envDiff(vec3(0.0, 1.0, 0.0)) * uLook.x; }
// Backscattered light along a view path of length L inside the water (linear, before exposure):
// light at depth z has come down through z / cos(sun) of water, so the deeper the dimmer.
vec3 inscatter(float L, float dy) {
  vec3 ext = uAbs + uSca + uAbs * (abs(dy) / max(-uSunW.y, 0.25));
  return uSca / max(ext, vec3(1e-6)) * (1.0 - exp(-ext * L)) * downwell() / PI;
}
vec3 disp(vec3 lin) { return tonemap(lin * uLook.z); }
// The pool's own tiled basin at local point p (on its floor or a wall), lit as the main shader
// lights it: the Sun through the water (its shadows, the caustics on the floor, the water it came
// down through) and the sky. Returns display-linear color.
vec3 basinAt(vec3 p) {
  vec3 Nb; vec2 uv; bool floorHit = p.y < -uW0.y + 1e-3 * uW0.z;
  vec3 tx;
  if (floorHit) { Nb = vec3(0.0, 1.0, 0.0); uv = (p.xz - uBasin2.xy) / uBasin2.zw; tx = texture(uFloorMap, uv).rgb; }
  else if (abs(abs(p.x) - uW1.x) < abs(abs(p.z) - uW1.y)) { Nb = vec3(-sign(p.x), 0.0, 0.0); uv = vec2(p.z + uW1.y + uBasin.z, p.y + uW0.y) / uBasin.y; tx = texture(uWallMap, uv).rgb; }
  else { Nb = vec3(0.0, 0.0, -sign(p.z)); uv = vec2(p.x + uW1.x, p.y + uW0.y) / uBasin.y; tx = texture(uWallMap, uv).rgb; }
  vec3 alb = toLin(tx);
  vec3 wp = uOrigin + p;
  float dz = max(-p.y, 0.0);
  float cosI = max(dot(Nb, -uSunW), 0.0);
  float sh = shadowAt(wp, Nb);
  float ca = 1.0;
  if (uBasin.w > 0.5) {
    vec2 q = (p.xz - uSunW.xz / max(-uSunW.y, 1e-3) * dz + uW1.xy) / (2.0 * uW1.xy);
    if (q.x >= 0.0 && q.y >= 0.0 && q.x <= 1.0 && q.y <= 1.0) ca = mix(1.0, texture(uCaust2, q).r, sqrt(clamp(dz / uW0.y, 0.0, 1.0)));
  }
  vec3 down = exp(-uAbs * dz / max(-uSunW.y, 0.25));
  // Under the water the beam is narrower by cos(incidence) / cos(refraction), so a wall facing it
  // gets that much more per area; the floor gets exactly what it would dry (L.y).
  vec3 lin = alb / PI * uKeyCol * cosI * sh * ca * max(uLight.y, 0.0) / max(-uSunW.y, 0.05);
  lin += alb * envDiff(Nb) * uLook.x + alb / PI * uFillCol * max(dot(Nb, uFillDir), 0.0);
  return disp(lin * down);
}
void main() {
  vec3 V = normalize(uEye - vWorld);
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  int steps = int(uW3.y + 0.5);
  vec3 lp = vWorld - uOrigin; // local (the water is never turned)
  float var = 0.0;
  vec3 N;
  if (vSide > 0.5) N = normalize(vN);
  else {
    vec2 s = slopeAt(vUv0, vUv1, var);
    if (uWD.y > 0.0) { float r = length(lp.xz); s += lp.xz / max(r, 1e-6) * uWD.y / uWD.z * exp(-max(uWD.w - r, 0.0) / uWD.z); }
    N = normalize(vec3(-s.x, 1.0, -s.y));
  }
  bool under = vSide < 0.5 && uEye.y < vWorld.y && !gl_FrontFacing;
  // Rough where the waves are too small to draw: the unresolved slopes plus what a pixel averages.
  float a2 = clamp(uW2.x + var, 1e-5, 0.5), alpha = sqrt(a2);
  vec3 colL; float alphaOut; float foam = 0.0;
  vec3 Lsun = uLight;
  float vis = shadowAt(vWorld, vec3(0.0, 1.0, 0.0));
  if (under) {
    // From below: light from the air comes through inside Snell's window; outside it the surface
    // is a mirror (total internal reflection) showing the water below.
    N = -N;
    float c = dot(N, V);
    vec3 T = refract(-V, N, ETA);
    vec3 deep = disp(inscatter(1e4, 1.0));
    if (dot(T, T) < 1e-6) { colL = deep; }
    else {
      float F = 0.02 + 0.98 * pow(1.0 - abs(dot(T, N)), 5.0);
      colL = mix(disp(envSpec(T, alpha) * uLook.y), deep, F);
    }
    alphaOut = 1.0;
  } else {
    float NoV = dot(N, V);
    if (NoV < 0.02) { N = normalize(N + V * (0.02 - NoV)); NoV = 0.02; }
    float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
    // Reflection: the sky or studio, with the scene where a reflected ray finds it on screen.
    vec3 Rd = reflect(-V, N);
    if (vSide < 0.5 && Rd.y < 0.01) Rd = normalize(vec3(Rd.x, 0.01 + (0.01 - Rd.y) * 0.5, Rd.z));
    // A blurred lookup is a cone around Rd; keep it above the horizon, which is where the light
    // reflected by the sea comes from (below it is more sea).
    float er = clamp(sqrt(alpha) * 1.2, 0.0, 1.0);
    vec3 Re = vSide < 0.5 ? normalize(vec3(Rd.x, max(Rd.y, er * 0.35), Rd.z)) : Rd;
    vec3 refl = disp(envSpec(Re, er) * uLook.y);
    if (uW3.x > 0.5) {
      float tr = march(vWorld + N * 1e-3 * uW0.z, Rd, length(uEye - vWorld) * 1.5, steps, jit);
      if (tr > 0.0) {
        vec2 px = pxOf(vWorld + Rd * tr);
        vec4 sc = sceneAt(px);
        vec2 e = min(px, uSceneSize - px) / (uSceneSize * 0.08);
        float k = sc.a * clamp(min(e.x, e.y), 0.0, 1.0);
        refl = mix(refl, toLin(sc.rgb / max(sc.a, 1e-3)), k);
      }
    }
    // Refraction: march the bent ray through the water to what it meets, and absorb along the
    // whole path the light took: down from the surface to that point, then up to the eye.
    vec3 T = refract(-V, N, 1.0 / ETA);
    vec3 refr; float refrA;
    float tOut = exitT(lp, T), Lw;
    vec3 P;
    vec4 bh;
    bool fromBelow = false;
    if (vSide > 0.5 && T.y > 1e-4 && (-lp.y) / T.y < tOut) {
      // Seen through a side: the ray rises to the surface. Inside Snell's window it leaves into the
      // air; outside, the surface reflects it back down, silver from below.
      float tt = -lp.y / T.y;
      vec3 ps = lp + T * tt;
      float v2;
      vec2 s2 = slopeAt(ps.xz * uWM0.xy + uWM0.zw, ps.xz * uWM1.xy + uWM1.zw, v2);
      vec3 Ns = -normalize(vec3(-s2.x, 1.0, -s2.y));
      vec3 To = refract(T, Ns, ETA);
      fromBelow = true;
      if (dot(To, To) < 1e-6) {
        vec3 T2 = reflect(T, Ns);
        float t2 = exitT(ps, T2);
        float th = march(uOrigin + ps, T2, t2, steps, jit);
        float tl = th > 0.0 ? th : t2;
        P = uOrigin + ps + T2 * tl;
        bh = sceneAt(pxOf(P));
        Lw = tt + tl;
      } else {
        P = uOrigin + ps;
        bh = vec4(toSrgb(disp(envSpec(To, 0.05) * uLook.y)), 1.0);
        Lw = tt;
      }
    } else {
      float th = march(vWorld, T, min(tOut, 1e5) * 1.05, steps, jit);
      Lw = th > 0.0 ? min(th, tOut) : tOut;
      P = vWorld + T * Lw;
      if (uBasin.x > 0.5 && (th <= 0.0 || th > tOut * 0.97)) {
        // The ray reaches the basin: trace it there instead of reading the screen.
        bh = vec4(toSrgb(basinAt(lp + T * tOut)), 1.0);
        fromBelow = true; // basinAt already dimmed the light on its way down
      } else {
        vec2 pp = pxOf(P);
        // If where the ray ends is hidden on screen by something nearer, read what lies straight
        // behind this pixel instead (screen-space refraction can't see behind things).
        if (th <= 0.0 && Lw < 1e4 && sceneZ(pp) < viewZ(P) - 0.05 * Lw) pp = gl_FragCoord.xy;
        bh = Lw < 1e4 ? sceneAt(pp) : vec4(0.0);
      }
    }
    float below = max(uOrigin.y - P.y, 0.0);
    float Ld = fromBelow || uW3.w > 0.5 ? 0.0 : below / max(-uSunW.y, 0.25);
    vec3 Tr = exp(-uAbs * (Lw + Ld));
    vec3 S = disp(inscatter(Lw, T.y));
    float tA = dot(Tr, vec3(0.3333));
    vec3 bl = toLin(bh.rgb / max(bh.a, 1e-3));
    // Where nothing is drawn behind (a glass on an empty page), what the reader sees behind the
    // water is the page: refract the page itself, so the glass around it bends a white (or dark)
    // backdrop instead of dimming a transparent one. Past the critical angle where the ray leaves,
    // it reflects back inside instead, and that edge goes dark, as in a real glass.
    if (bh.a < 0.999 && uW1.w < 0.5 && Lw < 1e4 && uPageBg.w > 0.5) {
      vec3 pl = P - uOrigin, Ne;
      if (pl.y < -uW0.y + 1e-3 * uW0.z) Ne = vec3(0.0, -1.0, 0.0);
      else if (uW1.z > 0.5) Ne = normalize(vec3(pl.x, 0.0, pl.z));
      else Ne = abs(abs(pl.x) - uW1.x) < abs(abs(pl.z) - uW1.y) ? vec3(sign(pl.x), 0.0, 0.0) : vec3(0.0, 0.0, sign(pl.z));
      vec3 Tx = refract(T, -Ne, ETA);
      vec3 page = toLin(uPageBg.rgb);
      vec3 room = dot(Tx, Tx) < 1e-6 ? page * 0.55 : page;
      bl = bh.a > 0.0 ? mix(room, bl, bh.a) : room;
      bh.a = 1.0;
    }
    refr = bl * bh.a * Tr + S;
    refrA = bh.a * tA + (1.0 - tA);
    // Foam: where the sea nearly folds over (the Jacobian of the choppy displacement drops toward
    // 0.7: crests steep enough to break) and where the water thins at a shore, broken up by noise.
    if (uW2.y > 0.0 && uW1.w > 0.5) {
      float J = texture(uWA0, vUv0).w + (uW0.w > 1.5 ? texture(uWA1, vUv1).w - 1.0 : 0.0);
      float nz = vnoise(vec3(lp.xz * (2.5 / uW0.z), uW2.z * 0.15)) * 0.6 + vnoise(vec3(lp.xz * (9.0 / uW0.z), uW2.z * 0.3)) * 0.4;
      foam = clamp((0.78 - J) * 4.0 * uW2.y + nz * 0.6 - 0.2, 0.0, 1.0) * step(J, 0.95);
      // Foam is a lace of bubbles, not a sheet: thin it with finer noise.
      float lace = vnoise(vec3(lp.xz * (22.0 / uW0.z), uW2.z * 0.5)) * 0.5 + 0.5;
      foam *= mix(0.25, 1.0, smoothstep(0.25, 0.75, lace));
    }
    if (uW2.w > 0.0) {
      float th = below;
      float nz = vnoise(vec3(lp.xz * (4.0 / uW0.z), uW2.z * 0.4));
      foam = max(foam, clamp((1.0 - th / uW2.w) * (0.7 + 0.6 * nz) - 0.25, 0.0, 1.0));
    }
    // Glints: the sun's own reflection, a sharp GGX lobe at the roughness of the small waves
    // (never sharper than the Sun's disk, 0.27° across), hidden where something shades the water.
    vec3 H = normalize(V + Lsun);
    float NoL = dot(N, Lsun), NoH = max(dot(N, H), 0.0);
    float ag = max(alpha, 0.006), ag2 = ag * ag;
    float Dg = ag2 / (PI * pow(NoH * NoH * (ag2 - 1.0) + 1.0, 2.0));
    float Gv = 0.5 / max(NoV * sqrt(ag2 + (1.0 - ag2) * NoL * NoL) + max(NoL, 0.0) * sqrt(ag2 + (1.0 - ag2) * NoV * NoV), 1e-4);
    float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    vec3 glint = NoL > 0.0 ? uKeyCol * Dg * Gv * Fh * NoL * vis : vec3(0.0);
    colL = refr * (1.0 - F) + refl * F;
    alphaOut = refrA * (1.0 - F) + F;
    vec3 foamC = disp((uKeyCol * max(dot(N, Lsun), 0.0) * vis + envDiff(N) * uLook.x) * 0.85 / PI * 1.6);
    colL = mix(colL, foamC, foam);
    alphaOut = mix(alphaOut, 1.0, foam);
    colL += disp(glint) * (1.0 - foam);
  }
  vec3 c = toSrgb(colL / max(alphaOut, 1e-3)) * alphaOut;
  if (uW3.z > 0.5) c = mix(c, vec3(0.85, 0.5, 0.1) * alphaOut, 0.3);
  oColor = vec4(min(c, vec3(alphaOut)), alphaOut);
  oNormal = vec4((under ? -N : N) * 0.5 + 0.5, 1.0);
}`;
  Object.assign(PROGRAMS, {
    wpool: () => [VS_FULL, FS_WPOOL], wocean: () => [VS_FULL, FS_WOCEAN], wfft1: () => [VS_FULL, fsWfft(false)], wfft2: () => [VS_FULL, fsWfft(true)],
    wfin: () => [VS_FULL, FS_WFIN], wcaust: () => [VS_WCAUST, FS_WCAUST], water: () => [VS_WATER, FS_WATER],
  });

  // GPU state for one water node: the spectrum (pool), the FFT's ping-pong targets, the maps the
  // surface reads, and the caustic map. Rebuilt when the resolution or the sea's spectrum changes.
  function waterGPU(g) {
    const { gl } = R;
    const ocean = g.mode === "ocean", res = waterRes(g), N = ocean ? res : 2 * res;
    const key = `${g.mode}|${res}`;
    let G = g._wgpu;
    if (G && G.gl === gl && G.key === key) return G;
    if (G && G.gl === gl) waterFree(G);
    const F32 = filter => texture(N, N, gl.RGBA32F, gl.RGBA, gl.FLOAT, filter ?? gl.NEAREST);
    const levels = Math.floor(Math.log2(N)) + 1;
    const map = () => { const t = texture(N, N, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, levels); if (ocean) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT); } return t; };
    const two = ocean;
    const ping = () => { const t = two ? [F32(), F32()] : [F32()]; return { t, fb: framebuffer(t) }; };
    G = { gl, key, N, res, ocean, two, t: null, applied: new Set(), rainT: null, objPrev: new Map() };
    G.fft = [ping(), ping()];
    G.spec = ping();
    const nc = ocean ? 2 : 1;
    G.cas = [];
    for (let c = 0; c < nc; c++) {
      const A = map(), B = map();
      G.cas.push({ A, B, fb: framebuffer([{ tex: A }, { tex: B }]) });
    }
    if (!ocean) {
      const s0 = F32(), s1 = F32();
      G.state = [{ t: s0, fb: framebuffer([s0, G.spec.t[0]]) }, { t: s1, fb: framebuffer([s1, G.spec.t[0]]) }];
      G.cur = 0;
      const C = Math.min(1024, res * 2);
      G.caust = { size: C, tex: texture(C, C, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR) };
      G.caust.fb = framebuffer([G.caust.tex]);
    } else G.h0 = [F32(), F32()].map(t => ({ t, fb: null }));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    g._wgpu = G;
    return G;
  }
  function waterFree(G) {
    const { gl } = R;
    const tex = [];
    for (const p of [...G.fft, G.spec]) { gl.deleteFramebuffer(p.fb); tex.push(...p.t); }
    for (const c of G.cas) { gl.deleteFramebuffer(c.fb); tex.push(c.A, c.B); }
    if (G.state) for (const s of G.state) { gl.deleteFramebuffer(s.fb); tex.push(s.t); }
    if (G.caust) { gl.deleteFramebuffer(G.caust.fb); tex.push(G.caust.tex); }
    if (G.h0) for (const h of G.h0) tex.push(h.t);
    tex.forEach(t => gl.deleteTexture(t));
  }
  // A full-screen pass into fb (size n), sampling `tex` on units 0, 1, ...
  function wPass(name, fb, n, uniforms, tex = []) {
    const { gl } = R;
    const P = prog(name);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, n, n);
    gl.useProgram(P.p);
    tex.forEach((t, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); });
    setAll(P, uniforms);
    gl.bindVertexArray(R.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // Inverse 2D FFT of G.spec (one or two textures) through the ping-pong targets; returns the result.
  function waterFFT(G) {
    const N = G.N;
    let src = G.spec.t, k = 0;
    for (let dir = 0; dir < 2; dir++) for (let Ns = 1; Ns < N; Ns *= 2) {
      const dst = G.fft[k++ & 1];
      wPass(G.two ? "wfft2" : "wfft1", dst.fb, N, { uSrc0: 0, uSrc1: 1, uF: [N, Ns, dir, 0] }, src);
      src = dst.t;
    }
    return src;
  }
  // Advance the water to time t on the GPU. Returns true when the maps changed.
  function waterStep(g, t, L) {
    const { gl } = R;
    const G = waterGPU(g);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(false);
    let changed = false;
    if (G.ocean) {
      const S = g._ocean && g._ocean.key === oceanSetup.keyOf(g) ? g._ocean : (g._ocean = oceanSetup(g));
      if (G.h0key !== S.key) {
        S.cas.forEach((c, i) => { gl.bindTexture(gl.TEXTURE_2D, G.h0[i].t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G.N, G.N, gl.RGBA, gl.FLOAT, c.h0); });
        G.h0key = S.key; G.t = null;
      }
      const ck = `${g.choppy}|${g.depth}|${g.tension}`;
      if (G.t !== t || G.ck !== ck) {
        S.cas.forEach((c, i) => {
          wPass("wocean", G.spec.fb, G.N, { uH0: 0, uO0: [G.N, c.L, t, g.depth / g.units], uO1: [g.choppy, g.units, g.tension ? 1 : 0, 0] }, [G.h0[i].t]);
          const out = waterFFT(G);
          wPass("wfin", G.cas[i].fb, G.N, { uF0: 0, uF1: 1, uFin: [1, 0, 0, 0] }, out);
          gl.bindTexture(gl.TEXTURE_2D, G.cas[i].A); gl.generateMipmap(gl.TEXTURE_2D);
          gl.bindTexture(gl.TEXTURE_2D, G.cas[i].B); gl.generateMipmap(gl.TEXTURE_2D);
        });
        G.t = t; G.ck = ck; changed = true;
      }
    } else {
      // Rewinding (or the first frame) starts over from still water a little before t and replays
      // the drops since: the field is a sum of exactly advanced modes, so the result is the same.
      if (G.t == null || t < G.t - 1e-9) {
        for (const s of G.state) { gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]); gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]); }
        G.t = Math.max(0, t - waterWindow(g)); G.applied.clear(); G.rainT = G.t; G.objPrev.clear(); G.fresh = true;
        if (G.t === t) G.t = t - 1e-6;
      }
      const win = t - waterWindow(g);
      const src = g.drops.filter(dp => dp.t <= t && dp.t >= win && !G.applied.has(dp));
      src.forEach(dp => G.applied.add(dp));
      src.push(...waterRain(g, G.rainT ?? G.t, t));
      G.rainT = t;
      // Objects in the water push it aside: each frame the change in the volume each one holds
      // below the level leaves as waves (and the level rises by what they displace).
      for (const ob of g.objects || []) {
        const node = ob.node || ob;
        if (!node.mesh) continue;
        const wm = node.world(), c = m4.apply(wm, node.mesh.bounds.center), sc = Math.hypot(wm[0], wm[1], wm[2]);
        const r = ob.radius ?? node.mesh.bounds.radius * sc;
        const o = g.toWorld([0, 0, 0]), lx = c[0] - o[0], ly = c[1] - o[1], lz = c[2] - o[2];
        const hc = Math.max(0, Math.min(2 * r, r - ly));
        const V = (Math.PI * hc * hc * (3 * r - hc)) / 3;
        const a = Math.max(Math.sqrt(Math.max(r * r - ly * ly, 0)), 0.45 * r);
        const now = { x: lx, z: lz, r: a, amp: V > 0 ? V / (Math.PI * a * a) : 0 };
        const prev = G.objPrev.get(node);
        if (prev && (Math.abs(prev.x - now.x) + Math.abs(prev.z - now.z) + Math.abs(prev.amp - now.amp) + Math.abs(prev.r - now.r) > 1e-7 * g.units)) {
          if (prev.amp) src.push({ ...prev, amp: prev.amp, t, shape: 1 });
          if (now.amp) src.push({ ...now, amp: -now.amp, t, shape: 1 });
        }
        G.objPrev.set(node, now);
      }
      if (G.t !== t || src.length || G.fresh || G.ak !== `${g.ripples}|${g.rippleLength}`) {
        G.ak = `${g.ripples}|${g.rippleLength}`;
        const [w, d] = g.size, u = g.units;
        const si = waterDropsSI(g, src, t);
        const P1 = [g.depth / u, g.tension ? 1 : 0, g.damping, u];
        const amb = waterAmbient(g, G.N);
        let dt = t - G.t;
        for (let b = 0; b === 0 || b < si.length; b += 32) {
          const batch = si.slice(b, b + 32), D = new Float32Array(128), DT = new Float32Array(128);
          batch.forEach((q, i) => { D.set([q.s, q.t, q.r, q.amp], i * 4); DT.set([Math.max(0, q.tau), q.shape, 0, 0], i * 4); });
          const from = G.state[G.cur], to = G.state[1 - G.cur];
          wPass("wpool", to.fb, G.N, { uState: 0, uP0: [G.N, w / u, d / u, dt], uP1: P1, uDrop: D, uDropT: DT, uDropN: batch.length, uAmb: [...amb, t], uSeed: g.seed * 9973 }, [from.t]);
          G.cur = 1 - G.cur; dt = 0;
        }
        const out = waterFFT(G);
        wPass("wfin", G.cas[0].fb, G.N, { uF0: 0, uF1: 1, uFin: [0, 0, 0, 0] }, [out[0], out[0]]);
        gl.bindTexture(gl.TEXTURE_2D, G.cas[0].B); gl.generateMipmap(gl.TEXTURE_2D);
        G.t = t; G.fresh = false; changed = true;
      }
    }
    // Caustics from this surface and this sun.
    const lk = L.map(v => v.toFixed(4)).join(",");
    if (G.caust && g.caustics && (changed || G.lk !== lk) && L[1] > 0.05) {
      const [w, d] = g.size, n = Math.min(G.res, 384);
      gl.bindFramebuffer(gl.FRAMEBUFFER, G.caust.fb);
      gl.viewport(0, 0, G.caust.size, G.caust.size);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      const P = prog("wcaust");
      gl.useProgram(P.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.cas[0].A);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.cas[0].B);
      setAll(P, { uWA0: 0, uWB0: 1, uWM0: waterMapU(g, G, 0), uC0: [w / 2, d / 2, g.depth, n], uC1: L });
      gl.bindVertexArray(R.empty);
      gl.drawArrays(gl.TRIANGLES, 0, n * n * 6);
      gl.disable(gl.BLEND);
      G.lk = lk; G.caustOn = true;
    } else if (G.caust && !(L[1] > 0.05)) G.caustOn = false;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    return changed;
  }
  // Local x, z to map uv: the pool's cell j sits at x = -w/2 + j w/R (texel center (j + 0.5)/N);
  // the sea's patch tiles (REPEAT).
  function waterMapU(g, G, c) {
    const [w, d] = g.size;
    if (!G.ocean) { const N = G.N, R0 = G.res; return [R0 / (w * N), R0 / (d * N), (R0 / 2 + 0.5) / N, (R0 / 2 + 0.5) / N]; }
    const S = g._ocean, L = S.cas[c].L * g.units;
    return [1 / L, 1 / L, 0.5 / G.N, 0.5 / G.N];
  }
  // Uniforms for light under the water in the main shader: the first water body dims and tints
  // what lies under it by the water the light came down through, and a pool lights its floor
  // with its caustics.
  function waterCausticU(list, L) {
    const off = { uCaustic: 9, uCaustA: [0, 0, 1, 1], uCaustB: [0, 0, 0, 0], uCaustC: [0, 0, 0, 0], uCaustAbs: [0, 0, 0], tex: R.dummyColor, node: null };
    const it = list[0];
    if (!it) return off;
    const g = it.node._water, [w, d] = g.size, o = m4.apply(it.world, [0, 0, 0]), G = g._wgpu;
    const t0 = refractV(v3.scale(L[1] > 0.05 ? L : [0, 1, 0], -1), [0, 1, 0], 0.75);
    const on = !!(G && G.caust && G.caustOn && g.caustics);
    return {
      uCaustic: 9, uCaustA: [o[0] - w / 2, o[2] - d / 2, 1 / w, 1 / d],
      uCaustB: [o[1], o[1] - g.depth, t0[0] / Math.max(-t0[1], 1e-3), t0[2] / Math.max(-t0[1], 1e-3)],
      uCaustC: [on ? 1 : 0, typeof g.caustics === "number" ? g.caustics : 1, 0.0047, g.shape === "round" ? 1 : 0],
      uCaustAbs: waterAbsorb(g),
      tex: on ? G.caust.tex : R.dummyColor, node: g,
    };
  }
  const waterAbsorb = g => ((g.absorb || (WATER_BODIES[g.body] || WATER_BODIES.clear).absorb)).map(v => v / g.units);
  function refractV(I, N, eta) {
    const c = v3.dot(N, I), k = 1 - eta * eta * (1 - c * c);
    return k < 0 ? [0, 0, 0] : v3.sub(v3.scale(I, eta), v3.scale(N, eta * c + Math.sqrt(k)));
  }
  // Draws one water surface in the glass pass (the opaque picture and its depth are on units 0 and 1).
  function drawWater(it, ctx) {
    const { gl } = R;
    const g = it.node._water, G = g._wgpu, ocean = g.mode === "ocean";
    const q = ctx.q;
    // The drawn grid follows the quality tier.
    const n = ocean ? (q.name === "low" ? 96 : q.name === "medium" ? 160 : 256) : Math.max(32, Math.min(G.res, q.name === "low" ? G.res / 4 : q.name === "medium" ? G.res / 2 : G.res));
    g._grids = g._grids || {};
    const grid = g._grids[n] || (g._grids[n] = waterGrid(g, n, false));
    const P = prog("water");
    gl.useProgram(P.p);
    const body = WATER_BODIES[g.body] || WATER_BODIES.clear, u = g.units;
    const ab = waterAbsorb(g), sc = (g.scatter || body.scatter).map(v => v / u);
    const o = m4.apply(it.world, [0, 0, 0]);
    const S = ocean ? g._ocean : null;
    const t0 = refractV(v3.scale(ctx.L, -1), [0, 1, 0], 0.75);
    G.cas.forEach((c, i) => {
      gl.activeTexture(gl.TEXTURE8 + i * 2); gl.bindTexture(gl.TEXTURE_2D, c.A);
      gl.activeTexture(gl.TEXTURE9 + i * 2); gl.bindTexture(gl.TEXTURE_2D, c.B);
    });
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.wdepth.tex);
    const bs = typeof g.basin === "object" && g.shape === "square" ? g.basin : null;
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bs ? mapTexture(bs.floor) : R.dummyColor);
    gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, bs ? mapTexture(bs.wall) : R.dummyColor);
    // The pool (one cascade) has units 10 and 11 free; its caustic map goes on 10.
    const cOn = !!(G.caust && G.caustOn && g.caustics);
    if (G.cas.length === 1) { gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, cOn ? G.caust.tex : R.dummyColor); }
    gl.activeTexture(gl.TEXTURE0);
    const nc = G.cas.length;
    const wm0 = waterMapU(g, G, 0), wm1 = nc > 1 ? waterMapU(g, G, 1) : wm0;
    const half = [g.size[0] / 2, g.size[1] / 2];
    setAll(P, {
      ...ctx.common, uScene: 0, uDepthC: 1, uSceneInv: ctx.sceneInv, uSceneSize: ctx.sceneSize, uCamF: ctx.C.forward,
      uWA0: 8, uWB0: 9, uWA1: nc > 1 ? 10 : 8, uWB1: nc > 1 ? 11 : 9, uWM0: wm0, uWM1: wm1,
      uFloorMap: 2, uWallMap: 15, uCaust2: nc > 1 ? 2 : 10,
      uBasin: [bs ? 1 : 0, bs ? bs.wallPeriod : 1, bs ? bs.t : 0, cOn ? 1 : 0], uBasin2: bs ? bs.floorBox : [0, 0, 1, 1],
      uModel: it.world,
      uW0: [o[1], g.depth, u, nc], uW1: [half[0], half[1], g.shape === "round" ? 1 : 0, ocean ? 1 : 0],
      uAbs: ab, uSca: sc,
      uW2: [ocean ? S.subSlope : 2e-5 * (g.rain > 0 ? 4 : 1), g.foam, ctx.time, g.shore ? g.shore : 0],
      uOrigin: o, uSunW: t0,
      uPageBg: ctx.pageBg,
      uWD: [g.depth, g.meniscus ? g.meniscus.height ?? 0.0031 * u : 0, g.meniscus ? g.meniscus.length ?? 0.0027 * u : 1, half[0]],
      uW3: [g.reflections ? 1 : 0, q.moving ? (q.name === "low" ? 8 : q.name === "medium" ? 12 : 14) : 24, it.node.highlight ? 1 : 0, ctx.lit === g ? 1 : 0],
      uWV: [nc, ocean ? half[0] * 0.7 : 1e30, ocean ? half[0] * 2.5 : 2e30, 0],
    });
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    // A pool's top is seen from both sides (from under water), its sides only from outside.
    const draw = (m, far) => {
      const gg = upload(m);
      setU(P, "uWV", [nc, ocean ? half[0] * 0.7 : 1e30, ocean ? half[0] * 2.5 : 2e30, far ? 1 : 0]);
      gl.bindVertexArray(gg.vao);
      gl.drawElements(gl.TRIANGLES, gg.count, gl.UNSIGNED_INT, 0);
    };
    if (!ocean && ctx.C.eye[1] < o[1]) gl.disable(gl.CULL_FACE);
    draw(grid, false);
    if (ocean && g.horizon !== false) { g._fars = g._fars || {}; draw(g._fars[n] || (g._fars[n] = waterGrid(g, n, true)), true); }
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }
  // A depth copy of the opaque picture, which the water marches its rays against.
  function waterDepthCopy(src, W, H) {
    const { gl } = R;
    let D = R.wdepth;
    if (!D || D.w < R.main.w || D.h < R.main.h) {
      if (D) { gl.deleteFramebuffer(D.fb); gl.deleteTexture(D.tex); }
      D = R.wdepth = { w: R.main.w, h: R.main.h, tex: texture(R.main.w, R.main.h, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST) };
      D.fb = framebuffer([], D.tex);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, D.fb);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
  }

  // ---------- chemistry ----------
  // Covalent radius (Å) for bond lengths and ball sizes, van der Waals radius for space-filling,
  // and a color that reads well in the porcelain style.
  const ELEMENTS = {
    H: { cov: 0.31, vdw: 1.2, color: "#f5f3ee" }, C: { cov: 0.76, vdw: 1.7, color: "#5b5b61" },
    N: { cov: 0.71, vdw: 1.55, color: "#7d9bd8" }, O: { cov: 0.66, vdw: 1.52, color: "#e07a6e" },
    F: { cov: 0.57, vdw: 1.47, color: "#9fd18f" }, Cl: { cov: 1.02, vdw: 1.75, color: "#8fcf7c" },
    Br: { cov: 1.2, vdw: 1.85, color: "#b7685a" }, I: { cov: 1.39, vdw: 1.98, color: "#9a6fbf" },
    S: { cov: 1.05, vdw: 1.8, color: "#ead36a" }, P: { cov: 1.07, vdw: 1.8, color: "#ec9f5a" },
    Na: { cov: 1.66, vdw: 2.27, color: "#b49be0" }, K: { cov: 2.03, vdw: 2.75, color: "#a58ad6" },
    Mg: { cov: 1.41, vdw: 1.73, color: "#9fcf86" }, Ca: { cov: 1.76, vdw: 2.31, color: "#c9c9c0" },
    Fe: { cov: 1.32, vdw: 2.0, color: "#d0874f" }, Zn: { cov: 1.22, vdw: 1.39, color: "#9ea7c4" },
    Cu: { cov: 1.32, vdw: 1.4, color: "#cf8a5c" }, Si: { cov: 1.11, vdw: 2.1, color: "#d8c49a" },
    Li: { cov: 1.28, vdw: 1.82, color: "#c79be0" }, He: { cov: 0.28, vdw: 1.4, color: "#dff3f3" },
  };

  // atoms: [["O", [x, y, z]], ...] in ångström; bonds: [[i, j, order], ...].
  // style: "ball" (ball-and-stick) or "space" (space-filling).
  function molecule(atoms, bonds = [], { style = "ball", scale = 1, name = "molecule" } = {}) {
    const g = new Node(null, { name });
    const cache = new Map();
    const sphereFor = r => { const k = r.toFixed(3); if (!cache.has(k)) cache.set(k, mesh.sphere(r, { segments: 20 })); return cache.get(k); };
    atoms.forEach(([el, pos], i) => {
      const e = ELEMENTS[el] || { cov: 0.75, vdw: 1.7, color: "#cccccc" };
      const r = (style === "space" ? e.vdw : Math.max(0.22, e.cov * 0.42)) * scale;
      g.add(sphereFor(r), { position: v3.scale(pos, scale), color: e.color, name: `${el}${i + 1}`, data: { atom: i, element: el } });
    });
    if (style !== "space") {
      for (const [i, j, order = 1] of bonds) {
        const a = v3.scale(atoms[i][1], scale), b = v3.scale(atoms[j][1], scale);
        const dir = v3.sub(b, a), len = v3.len(dir);
        const side = v3.norm(v3.cross(dir, Math.abs(dir[1]) < 0.9 * len ? [0, 1, 0] : [1, 0, 0]));
        const r = 0.09 * scale * (order > 1 ? 0.75 : 1);
        const offsets = order === 1 ? [0] : order === 2 ? [-0.11, 0.11] : [-0.18, 0, 0.18];
        for (const off of offsets) {
          const sh = v3.scale(side, off * scale);
          const m = mesh.transform(mesh.cylinder(r, len, { segments: 14 }),
            m4.multiply(m4.translation(v3.add(v3.lerp(a, b, 0.5), sh)), m4.alignY(dir)));
          g.add(m, { material: "porcelain", name: `bond ${i + 1}-${j + 1}`, data: { bond: [i, j, order] } });
        }
      }
    }
    return g;
  }

  // ---------- science and math builders ----------
  // Height field y = f(x, z) over x: [x0, x1], z: [z0, z1]. The engine is y-up, so the
  // math picture z = f(x, y) stands on the floor here: pass f(x, z) and read y as height.
  // Non-finite values leave holes. Both sides are drawn, so it can be seen from below.
  function surfaceSoup(f, { x = [-1, 1], z = [-1, 1], n = 48, nz = n, keep = null } = {}) {
    const soup = new Soup(), back = new Soup();
    const pt = (i, j) => { const px = x[0] + ((x[1] - x[0]) * i) / n, pz = z[0] + ((z[1] - z[0]) * j) / nz; return [px, f(px, pz), pz]; };
    const P = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= n; i++) P.push(pt(i, j));
    const at = (i, j) => P[j * (n + 1) + i];
    const tri = (a, b, c) => {
      if (![a, b, c].every(q => Number.isFinite(q[1]))) return;
      if (keep && !keep((a[1] + b[1] + c[1]) / 3)) return;
      soup.tri(a, b, c);
      back.tri(a, c, b);
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < n; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      tri(a, d, c);
      tri(a, c, b);
    }
    return { soup, back, P };
  }
  mesh.surface = (f, o = {}) => {
    const { soup, back } = surfaceSoup(f, o);
    if (o.doubleSided !== false) soup.p.push(...back.p);
    return finish(soup, { crease: o.crease ?? 60 });
  };
  // The same surface cut into `bands` meshes by height, from range [lo, hi] (default: the
  // surface's own span). Color each band (E3.ramp) and the outlines between bands read as
  // contour lines. Returns { meshes, levels } with levels[k] the band's lower edge.
  mesh.surfaceBands = (f, o = {}) => {
    const { P } = surfaceSoup(f, { ...o, keep: () => false });
    const ys = P.map(q => q[1]).filter(Number.isFinite);
    const [lo, hi] = o.range ?? [Math.min(...ys), Math.max(...ys)];
    const K = o.bands ?? 8, step = (hi - lo) / K || 1;
    const n = o.n ?? 48, nz = o.nz ?? n, x = o.x ?? [-1, 1], z = o.z ?? [-1, 1];
    const at = (i, j) => P[j * (n + 1) + i];
    // Each triangle is clipped to every band it crosses, so band edges follow the
    // exact level curves (smooth contours) instead of stepping from triangle to triangle.
    const clip = (poly, level, keepAbove) => {
      const out = [];
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k], q = poly[(k + 1) % poly.length];
        const pin = keepAbove ? p[1] >= level : p[1] < level, qin = keepAbove ? q[1] >= level : q[1] < level;
        if (pin) out.push(p);
        if (pin !== qin) { const t = (level - p[1]) / (q[1] - p[1]); out.push([p[0] + (q[0] - p[0]) * t, level, p[2] + (q[2] - p[2]) * t]); }
      }
      return out;
    };
    const soups = Array.from({ length: K }, () => new Soup());
    const add = (a, b, c) => {
      if (![a, b, c].every(q => Number.isFinite(q[1]))) return;
      for (let k = 0; k < K; k++) {
        let poly = [a, b, c];
        if (k > 0) poly = clip(poly, lo + k * step, true);
        if (k < K - 1 && poly.length) poly = clip(poly, lo + (k + 1) * step, false);
        for (let t = 1; t + 1 < poly.length; t++) {
          soups[k].tri(poly[0], poly[t], poly[t + 1]);
          if (o.doubleSided !== false) soups[k].tri(poly[0], poly[t + 1], poly[t]);
        }
      }
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < n; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      add(a, d, c);
      add(a, c, b);
    }
    // Normals come from the whole surface, so shading doesn't break at the band edges.
    const fn = (px, pz) => { const e = 1e-4 * ((x[1] - x[0]) + (z[1] - z[0])); const nx = -(f(px + e, pz) - f(px - e, pz)) / (2 * e), nzz = -(f(px, pz + e) - f(px, pz - e)) / (2 * e); return v3.norm([nx, 1, nzz]); };
    const meshes = soups.map(soup => {
      const m = finish(soup, { crease: o.crease ?? 60 });
      for (let i = 0; i < m.positions.length; i += 3) {
        const nrm = fn(m.positions[i], m.positions[i + 2]), flip = m.normals[i + 1] < 0 ? -1 : 1;
        m.normals[i] = nrm[0] * flip; m.normals[i + 1] = nrm[1] * flip; m.normals[i + 2] = nrm[2] * flip;
      }
      return m;
    });
    return { meshes, levels: Array.from({ length: K }, (_, k) => lo + k * step), range: [lo, hi] };
  };
  // Parametric surface fn(u, v) -> [x, y, z] over u: [u0, u1], v: [v0, v1] (a sphere, a torus,
  // a Möbius strip, a saddle). wrapU / wrapV join the seams of closed surfaces.
  mesh.parametric = (fn, { u = [0, 1], v = [0, 1], nu = 48, nv = 32, wrapU = false, wrapV = false, doubleSided = true, crease = 60 } = {}) => {
    const soup = new Soup();
    const cols = wrapU ? nu : nu + 1, rows = wrapV ? nv : nv + 1;
    const P = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) P.push(fn(u[0] + ((u[1] - u[0]) * i) / nu, v[0] + ((v[1] - v[0]) * j) / nv));
    const at = (i, j) => P[(j % rows) * cols + (i % cols)];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      soup.quad(a, b, c, d);
      if (doubleSided) soup.quad(a, d, c, b);
    }
    return finish(soup, { crease });
  };
  // Arrows for a vector field: one per point, length |v| * scale (capped at maxLength).
  mesh.glyphs = (points, vectors, { scale = 1, radius = null, maxLength = Infinity, minLength = 1e-6 } = {}) => {
    const parts = [];
    points.forEach((p, i) => {
      const v = vectors[i], len = Math.min(v3.len(v) * scale, maxLength);
      if (!(len > minLength)) return;
      parts.push(mesh.arrow(p, v3.add(p, v3.scale(v3.norm(v), len)), { radius: radius ?? len * 0.05, segments: 10 }));
    });
    return parts.length ? mergeMeshes(...parts) : mesh.custom([], []);
  };
  // A curve in space as a round wire (orbits, trajectories, field lines). Short curves get dots at the ends.
  mesh.polyline = (points, r, { segments = 12, dots = false } = {}) => {
    const wire = mesh.tube(points, r, { segments });
    if (!dots) return wire;
    return mergeMeshes(wire, transformMesh(mesh.sphere(r * 2.2, { segments: 14 }), m4.translation(points[0])), transformMesh(mesh.sphere(r * 2.2, { segments: 14 }), m4.translation(points[points.length - 1])));
  };

  // Color between palette stops for t in [0, 1], read from the page's palette at call time
  // (call it in draw so it follows dark mode). Stops are palette or material names or hex.
  function ramp(t, stops = ["blue", "porcelain", "red"]) {
    const pal = window.palette || {};
    const rgb = c => hexRgb(pal[c] || MATERIALS[c]?.color || c);
    t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
    const c = mixRgb(rgb(stops[k]), rgb(stops[k + 1]), f);
    return "#" + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
  }

  // Axes for a 3D plot: an ink arrow per axis over its range, tick marks every `ticks` units,
  // and optionally a floor grid. Adds nodes to `scene` (or `group`), returns { nodes, labels }
  // where labels are [{ at: [x, y, z], text, axis }] to draw with view.project and g.text.
  // Ranges are in world units, y up: x: [x0, x1], y: [y0, y1], z: [z0, z1].
  function axes3(scene, { x = [-1, 1], y = [0, 1], z = [-1, 1], ticks = 1, radius = null, origin = [0, 0, 0], grid = false, names = { x: "x", y: "y", z: "z" }, format = v => String(+v.toFixed(3)) } = {}) {
    const span = Math.max(x[1] - x[0], y[1] - y[0], z[1] - z[0]), r = radius ?? span * 0.006;
    const T = typeof ticks === "number" ? { x: ticks, y: ticks, z: ticks } : ticks;
    const axes = { x: [[1, 0, 0], x], y: [[0, 1, 0], y], z: [[0, 0, 1], z] };
    const nodes = [], labels = [];
    for (const [name, [dir, [a, b]]] of Object.entries(axes)) {
      if (a === b) continue;
      const from = v3.add(origin, v3.scale(dir, a)), to = v3.add(origin, v3.scale(dir, b + span * 0.06));
      const parts = [mesh.arrow(from, to, { radius: r, head: r * 7, headRadius: r * 2.6, segments: 12 })];
      const step = T[name];
      if (step) for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) {
        if (Math.abs(v) < 1e-9) continue;
        const p = v3.add(origin, v3.scale(dir, v)), side = name === "y" ? [1, 0, 0] : [0, 1, 0];
        parts.push(mesh.transform(mesh.cylinder(r * 0.8, span * 0.025, { segments: 8 }), m4.multiply(m4.translation(p), m4.alignY(side))));
        labels.push({ at: v3.add(p, v3.scale(name === "y" ? [-1, 0, 0] : [0, -1, 0], span * 0.05)), text: format(v), axis: name, tick: true });
      }
      nodes.push(scene.add(mergeMeshes(...parts), { material: "graphite", name: `${name} axis`, pickable: false, cut: false }));
      labels.push({ at: v3.add(origin, v3.scale(dir, b + span * 0.12)), text: names[name], axis: name, tick: false });
    }
    if (grid) {
      const lines = [], step = T.x || T.z || 1;
      for (let v = Math.ceil(x[0] / step) * step; v <= x[1] + 1e-9; v += step) lines.push(mesh.tube([[v, origin[1], z[0]], [v, origin[1], z[1]]], r * 0.35, { segments: 6 }));
      for (let v = Math.ceil(z[0] / step) * step; v <= z[1] + 1e-9; v += step) lines.push(mesh.tube([[x[0], origin[1], v], [x[1], origin[1], v]], r * 0.35, { segments: 6 }));
      nodes.push(scene.add(mergeMeshes(...lines), { material: "paper", name: "grid", pickable: false, cut: false }));
    }
    return { nodes, labels };
  }

  window.E3 = {
    v3, m4, mesh, smooth, triangulate, inset,
    scene: o => new Scene(o),
    node: (m, o) => new Node(m, o),
    particles: o => new Particles(o),
    // The matter presets E3.particles({ matter }) draws on, for reading their numbers.
    matter: MATTER,
    // Add a material or a particle matter from a page: E3.define.material("ice", { base: "glass", ior: 1.31 }).
    define: { material: defineMaterial, matter: defineMatter },
    // Light: the Earth, a lawn, photons from a light traced through a scene, the Sun's color.
    earth, earthMap, moon, grass, photons,
    // Water: a simulated pool or sea (see the water section); E3.water.omega(k, depth) is the dispersion relation.
    water: Object.assign(water, { omega: waterOmega, bodies: WATER_BODIES }),
    trace(scene, origin, dir, tmax) {
      const items = collect(scene), mats = new Map();
      const matOf = it => { let m = mats.get(it.node); if (!m) mats.set(it.node, (m = resolveMaterial(it.node, scene.look))); return m; };
      return traceCPU(traceOf(scene, items, matOf).bvh, origin, v3.norm(dir), tmax ?? Infinity);
    },
    sunlight: dir => toHex(sunTransmittance(dir).map(v => Math.min(1, v) ** (1 / 2.2))),
    solidAngle,
    units: UNITS,
    plume: o => new Plume(o),
    Node, Scene, Particles, Plume,
    flow,
    render,
    molecule, ELEMENTS, MATERIALS, LOOKS,
    ramp, axes3,
    // Black-body color at T kelvin as #hex (display), its glow in engine units, and the temper color of hot steel.
    blackbody: T => toHex(blackbody(T).map(v => v ** (1 / 2.2))),
    glow: glowOf,
    heatTint: (T, shift = 0) => { const h = heatTint(T, shift); return { color: toHex(h.color), amount: h.amount }; },
    // Adaptive quality: E3.quality.tier is the current tier; E3.quality.force("low" | "medium" | "high" | null).
    quality: {
      get tier() { return TIER_NAMES[Q.rank ?? startRank()]; },
      force(name) { Q.forced = TIERS[name] ? name : null; },
      tiers: TIERS,
    },
    // True when the page is dark (from the palette's background): pick a look by it, in draw.
    get dark() { return pageDark(); },
    get canvas() { return R && R.canvas; },
    // The last frame's tier, supersampling, MSAA samples, size, and triangle and particle counts.
    get stats() { return E3stats; },
    available() { try { renderer(); return true; } catch { return false; } },
    // What particles step on: "webgpu", "webgl2" (transform feedback), or "cpu". Set it to force one ("auto" undoes it).
    get backend() { const f = e3Force ?? GPUX.force; return f === "cpu" || typeof document === "undefined" ? "cpu" : f !== "webgl2" && !xBad && GPUX.use(f) ? "webgpu" : "webgl2"; },
    set backend(v) { e3Force = ["webgpu", "webgl2", "cpu"].includes(v) ? v : null; if (e3Force === "webgpu") GPUX.start(); },
    // The WebGPU device ({ state, name, soft, error, errors, ready }) and sync(system): resolves once a system's copy back has landed.
    get webgpu() { return { state: GPUX.state, name: GPUX.name, soft: GPUX.soft, error: GPUX.error, errors: GPUX.errors, ready: GPUX.ready, sync: sys => (sys && sys._x ? sys._x.sync() : Promise.resolve()) }; },
    // For tests: the pure functions the shaders mirror.
    _: { resolveMaterial, hashU, rndU, noised, curl, flowAt, flowSpec, blackbody, glowOf, heatTint, tempAt, tempField, qualityFor, Q, TIERS, parseColor, pageDark, LOOKS, buildBVH, traceCPU, bvhSplit, meshTree, bvhNearest, rayTri, walkT: () => walkT, lightRig, sunTransmittance, skyOf, waterOmega, waterIfft1, waterIfft2, waterPoolLine, oceanSetup, oceanHeightField, WATER_BODIES },
  };
})();
