/* E3: a small WebGL2 engine for explainer figures.
   Surfaces are shaded like matte porcelain and outlined in ink, the way a
   technical illustration is drawn. It does section cuts with hatched caps,
   see-through parts, a soft ground shadow, and CPU picking.
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

  // ---------- materials ----------
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
    brass: { color: "#d1a650", metal: true },
    gold: { color: "#e0b94f", metal: true },
    copper: { color: "#cf8a5c", metal: true },
    steel: { color: "#bfc3ca", metal: true },
    graphite: { color: "#4a4a50" },
    glass: { color: "#dfe8ee", opacity: 0.28 },
    water: { color: "#a8cbe6", opacity: 0.45 },
  };
  const ACCENTS = ["red", "orange", "green", "blue", "purple"];

  const hexRgb = hex => {
    const h = String(hex).replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function resolveMaterial(node) {
    let m = node.material;
    if (typeof m === "string") m = MATERIALS[m] ?? (ACCENTS.includes(m) ? { color: m } : { color: m });
    m = { ...MATERIALS.porcelain, ...(m || {}) };
    let color = node.color ?? m.color;
    let rgb;
    const pal = window.palette || {};
    if (ACCENTS.includes(color)) rgb = mixRgb(hexRgb(pal[color] || "#888888"), [1, 1, 1], 0.42);
    else if (MATERIALS[color]) rgb = hexRgb(MATERIALS[color].color);
    else if (/^#/.test(color)) rgb = hexRgb(color);
    else if (pal[color]) rgb = hexRgb(pal[color]);
    else rgb = hexRgb(MATERIALS.porcelain.color);
    return { rgb, metal: !!m.metal, opacity: node.opacity < 1 ? node.opacity : m.opacity ?? 1 };
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
  }

  class Scene extends Node {
    constructor(o = {}) {
      super(null, {});
      this.cutPlane = null;    // [nx, ny, nz, d]: removes points where n·p > d
      this.shadow = true;      // soft contact shadow under the scene
      this.light = "camera";   // "camera" (studio light that follows the view) or a world direction
      this.lighting = "soft";  // "soft" porcelain shading, or "sun" for a hard day/night terminator
      this.ink = 1;            // outline weight multiplier
      this.set(o);
    }
  }

  window.E3 = {
    v3, m4, mesh, smooth, triangulate, inset,
    scene: o => new Scene(o),
    node: (m, o) => new Node(m, o),
    Node, Scene, MATERIALS,
  };
})();
