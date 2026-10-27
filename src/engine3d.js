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

  // ---------- WebGL renderer ----------
  const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel, uViewProj;
uniform mat3 uNormalMat;
out vec3 vWorld; out vec3 vNormal;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = uNormalMat * aNormal;
  gl_Position = uViewProj * w;
}`;

  const FS_MAIN = `#version 300 es
precision highp float;
in vec3 vWorld; in vec3 vNormal;
uniform vec3 uColor; uniform float uMetal; uniform vec3 uLight; uniform vec3 uEye;
uniform vec4 uCut; uniform float uCutOn; uniform float uId; uniform vec3 uHighlight; uniform float uHighlightOn;
uniform float uSun; uniform float uHatch; uniform mat4 uViewProj;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;
void main() {
  if (uCutOn > 0.5 && dot(vWorld, uCut.xyz) > uCut.w) discard;
  if (!gl_FrontFacing) {
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
    vec3 cap = uColor * 0.93;
    oColor = vec4(mix(cap, uColor * 0.5, line * 0.75), 1.0);
    oNormal = vec4(n * 0.5 + 0.5, uId);
    return;
  }
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - vWorld);
  float ndl = dot(N, uLight);
  vec3 col;
  if (uSun > 0.5) {
    float lit = smoothstep(-0.05, 0.25, ndl);
    col = uColor * (0.12 + 0.95 * lit * (0.55 + 0.45 * max(ndl, 0.0)));
  } else {
    float wrap = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
    wrap = wrap * wrap * (3.0 - 2.0 * wrap);
    vec3 cool = uColor * vec3(0.84, 0.86, 0.90);
    col = mix(cool, uColor, wrap);
    col *= 0.92 + 0.08 * (0.5 + 0.5 * N.y);
  }
  vec3 H = normalize(uLight + V);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  if (uMetal > 0.5) {
    float env = smoothstep(-0.4, 0.8, reflect(-V, N).y);
    float spec = pow(max(dot(N, H), 0.0), 50.0);
    col = uColor * (0.62 + 0.38 * clamp(ndl * 0.5 + 0.5, 0.0, 1.0)) * (0.78 + 0.32 * env) + vec3(1.0, 0.97, 0.9) * spec * 0.55;
  } else if (uSun < 0.5) {
    col += vec3(pow(max(dot(N, H), 0.0), 40.0) * 0.06);
    col = mix(col, vec3(1.0), fres * 0.10);
  }
  if (uHighlightOn > 0.5) col = mix(col, uHighlight, 0.38);
  oColor = vec4(col, 1.0);
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

  const VS_SHADOW = `#version 300 es
uniform mat4 uViewProj; uniform vec3 uCenter; uniform vec2 uRadii;
out vec2 vUv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vUv = c;
  gl_Position = uViewProj * vec4(uCenter + vec3(c.x * uRadii.x, 0.0, c.y * uRadii.y), 1.0);
}`;
  const FS_SHADOW = `#version 300 es
precision highp float;
in vec2 vUv; uniform float uOpacity;
layout(location=0) out vec4 oColor;
void main() {
  float d = length(vUv);
  float a = uOpacity * pow(1.0 - smoothstep(0.0, 1.0, d), 1.7);
  oColor = vec4(0.0, 0.0, 0.0, a);
}`;

  const VS_FULL = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
  // Composite: ink outlines from depth, normal, and part-id discontinuities, then a box
  // filter over uSS x uSS render pixels per output pixel (the engine supersamples itself).
  const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uColor; uniform sampler2D uNormal; uniform sampler2D uDepth;
uniform vec2 uInvSize; uniform float uStep; uniform vec2 uNearFar; uniform float uOrtho; uniform float uInk;
uniform int uSS; uniform float uAo; uniform float uAoR;
out vec4 o;
float lin(float d) {
  if (uOrtho > 0.5) return uNearFar.x + d * (uNearFar.y - uNearFar.x);
  float z = d * 2.0 - 1.0;
  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
}
vec4 shade(vec2 px) {
  vec4 c0 = texture(uColor, px * uInvSize);
  vec4 n0 = texture(uNormal, px * uInvSize);
  float d0 = lin(texture(uDepth, px * uInvSize).r);
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
    float d1 = lin(texture(uDepth, q).r);
    float e = 0.0;
    if (bg0 != bg1) e = 1.0;
    else if (!bg0) {
      if (abs(n0.a - n1.a) > 0.5 / 255.0) e = 0.85;
      float dd = abs(d0 - d1) / max(min(d0, d1), 1e-4);
      e = max(e, smoothstep(0.012, 0.035, dd) * 0.85);
      float nd = 1.0 - dot(n0.xyz * 2.0 - 1.0, n1.xyz * 2.0 - 1.0);
      e = max(e, smoothstep(0.10, 0.32, nd) * 0.5);
    }
    if (e > 0.0 && !bg1 && d1 < inkDepth) {
      vec4 c1 = texture(uColor, q);
      inkDepth = d1;
      inkSrc = c1.rgb / max(c1.a, 1e-3);
    }
    edge = max(edge, e);
  }
  // Ink is a darker shade of the surface it outlines, so colored parts get colored lines.
  vec3 ink = pow(inkSrc, vec3(1.35)) * 0.40;
  float a = clamp(edge * uInk, 0.0, 1.0);
  return vec4(ink * a, a) + c0 * (1.0 - a);
}
// Ambient occlusion from the depth buffer: surfaces with nearer surfaces close around
// them (the crease between two packed atoms, the inside of a socket) get a little darker,
// which is what makes a crowded model read as solid shapes rather than flat discs.
float occlusion(vec2 px) {
  vec4 n0 = texture(uNormal, px * uInvSize);
  if (n0.a < 0.5 / 255.0) return 1.0;
  float d0 = lin(texture(uDepth, px * uInvSize).r);
  // A fixed two-ring kernel (no per-pixel noise, so no grain to blur away).
  float occ = 0.0, wsum = 0.0;
  for (int ring = 1; ring <= 2; ring++) {
    float r = uAoR * float(ring) * 0.5;
    for (int i = 0; i < 10; i++) {
      float a = (float(i) + 0.5 * float(ring)) * 0.6283185;
      vec2 q = (px + vec2(cos(a), sin(a)) * r) * uInvSize;
      float w = ring == 1 ? 1.0 : 0.6;
      wsum += w;
      if (texture(uNormal, q).a < 0.5 / 255.0) continue;
      float dz = (d0 - lin(texture(uDepth, q).r)) / d0;
      occ += w * smoothstep(0.002, 0.02, dz) * (1.0 - smoothstep(0.05, 0.12, dz));
    }
  }
  return 1.0 - uAo * clamp(occ / wsum * 1.4, 0.0, 1.0);
}
void main() {
  vec2 base = floor(gl_FragCoord.xy) * float(uSS);
  vec4 sum = vec4(0.0);
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
    if (i < uSS && j < uSS) sum += shade(base + vec2(float(i), float(j)) + 0.5);
  }
  o = sum / float(uSS * uSS);
  if (uAo > 0.0) o.rgb *= occlusion(base + float(uSS) * 0.5);
}`;

  let R = null;
  function compile(gl, vs, fs) {
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  // One WebGL context serves every figure. It renders into an OffscreenCanvas and each
  // frame is handed over with transferToImageBitmap(), which is exact; reading a shared
  // WebGL canvas with drawImage() can return a stale buffer in some browsers.
  function renderer() {
    if (R) return R;
    const offscreen = typeof OffscreenCanvas !== "undefined";
    const canvas = offscreen ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: !offscreen, depth: true });
    if (!gl) throw new Error("this figure needs WebGL 2, which this browser doesn't provide");
    R = {
      canvas, gl, offscreen, fw: 0, fh: 0,
      main: compile(gl, VS, FS_MAIN),
      ghost: compile(gl, VS, FS_GHOST),
      shadow: compile(gl, VS_SHADOW, FS_SHADOW),
      composite: compile(gl, VS_FULL, FS_COMPOSITE),
      empty: gl.createVertexArray(),
    };
    canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); R = null; });
    return R;
  }

  function targets(w, h) {
    const { gl } = R;
    if (R.fbo && R.fw >= w && R.fh >= h) return;
    const fw = Math.max(w, R.fw), fh = Math.max(h, R.fh);
    if (R.fbo) { gl.deleteFramebuffer(R.fbo); [R.tColor, R.tNormal, R.tDepth].forEach(t => gl.deleteTexture(t)); }
    const tex = (internal, format, type) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, fw, fh, 0, format, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    R.tColor = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    R.tNormal = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    R.tDepth = tex(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    R.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, R.tColor, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, R.tNormal, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, R.tDepth, 0);
    R.fw = fw;
    R.fh = fh;
    R.canvas.width = fw;
    R.canvas.height = fh;
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
    const bi = buf(gl.ELEMENT_ARRAY_BUFFER, m.indices);
    gl.bindVertexArray(null);
    m._gpu = { gl, vao, buffers: [bp, bn, bi], count: m.indices.length, version: m.version };
    return m._gpu;
  }

  // Collects visible mesh nodes with world matrices and world-space bounds.
  function collect(scene) {
    const items = [];
    const walk = (node, parentM) => {
      if (!node.visible) return;
      const world = m4.multiply(parentM, node.local());
      if (node.mesh && node.mesh.indices.length) {
        const b = node.mesh.bounds;
        const c = m4.apply(world, b.center);
        const sx = Math.hypot(world[0], world[1], world[2]), sy = Math.hypot(world[4], world[5], world[6]), sz = Math.hypot(world[8], world[9], world[10]);
        items.push({ node, world, center: c, radius: b.radius * Math.max(sx, sy, sz) });
      }
      for (const c of node.children) walk(c, world);
    };
    walk(scene, m4.identity());
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
    const fovDeg = cam.fov ?? 28;
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
    const reach = v3.dist(target, bounds.center) + bounds.radius;
    const near = Math.max(distance - reach * 1.5, distance * 0.02), far = distance + reach * 1.5;
    let proj, worldPerPx;
    if (fov > 0) {
      proj = m4.perspective(fov, aspect, near, far);
      worldPerPx = 2 * distance * Math.tan(fov / 2);
    } else {
      const hh = half / zoom;
      proj = m4.ortho(-hh * aspect, hh * aspect, -hh, hh, near, far);
      worldPerPx = 2 * hh;
    }
    return { eye, target, view, proj, vp: m4.multiply(proj, view), near, far, ortho: !(fov > 0), worldPerPx, distance };
  }

  function lightDir(scene, cam) {
    if (Array.isArray(scene.light)) return v3.norm(scene.light);
    const inv = m4.invert(cam.view);
    return v3.norm(m4.applyDir(inv, [-0.45, 0.75, 0.55]));
  }

  // Renders the scene into the shared WebGL canvas; returns a view for projection and picking.
  // outScale: output pixels per CSS pixel (the screen's density). ss: supersampling
  // factor (1 to 3); the frame is rendered ss times larger and filtered down in the
  // composite pass, so the result can be copied to the page 1:1 with no resampling.
  function render(scene, cam = {}, cssW, cssH, outScale = 1, ss = 2) {
    renderer();
    const { gl } = R;
    ss = Math.max(1, Math.min(3, Math.round(ss)));
    const Wo = Math.max(1, Math.round(cssW * outScale)), Ho = Math.max(1, Math.round(cssH * outScale));
    const W = Wo * ss, H = Ho * ss, scale = outScale * ss;
    targets(W, H);
    const items = collect(scene);
    const bounds = sceneBounds(items);
    const C = camera(cam, scene, bounds, cssW / cssH);
    const L = lightDir(scene, C);
    const cut = scene.cutPlane ? (Array.isArray(scene.cutPlane) ? scene.cutPlane : [...scene.cutPlane.normal, scene.cutPlane.offset ?? 0]) : null;
    const cutN = cut ? v3.norm(cut.slice(0, 3)) : null;
    const cutV = cut ? [...cutN, cut[3] / v3.len(cut.slice(0, 3))] : [0, 1, 0, 1e9];
    const hatch = (C.worldPerPx / cssH) * 7;

    gl.bindFramebuffer(gl.FRAMEBUFFER, R.fbo);
    gl.viewport(0, 0, W, H);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    const mats = new Map();
    const matOf = it => { let m = mats.get(it.node); if (!m) mats.set(it.node, (m = resolveMaterial(it.node))); return m; };
    const pal = window.palette || {};
    const hiDefault = hexRgb(pal.orange || "#d9800f");

    // Opaque pass
    const { main } = R;
    gl.useProgram(main.p);
    gl.uniformMatrix4fv(main.u.uViewProj, false, C.vp);
    gl.uniform3fv(main.u.uLight, L);
    gl.uniform3fv(main.u.uEye, C.eye);
    gl.uniform4fv(main.u.uCut, cutV);
    gl.uniform1f(main.u.uSun, scene.lighting === "sun" ? 1 : 0);
    gl.uniform1f(main.u.uHatch, hatch);
    const opaque = items.filter(it => matOf(it).opacity >= 0.999);
    opaque.forEach((it, i) => {
      const m = matOf(it), g = upload(it.node.mesh);
      it.id = ((i * 97) % 254) + 1;
      const cutOn = cut && it.node.cut ? 1 : 0;
      if (cutOn) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
      gl.uniformMatrix4fv(main.u.uModel, false, it.world);
      gl.uniformMatrix3fv(main.u.uNormalMat, false, m4.normalMatrix(it.world));
      gl.uniform3fv(main.u.uColor, m.rgb);
      gl.uniform1f(main.u.uMetal, m.metal ? 1 : 0);
      gl.uniform1f(main.u.uId, it.id / 255);
      gl.uniform1f(main.u.uCutOn, cutOn);
      const hl = it.node.highlight;
      gl.uniform1f(main.u.uHighlightOn, hl ? 1 : 0);
      gl.uniform3fv(main.u.uHighlight, typeof hl === "string" ? hexRgb(pal[hl] || hl) : hiDefault);
      gl.bindVertexArray(g.vao);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
    });
    gl.bindVertexArray(null);
    gl.disable(gl.CULL_FACE);

    // Ground shadow and see-through parts only touch the color buffer.
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    if (scene.shadow && items.length) {
      const s = typeof scene.shadow === "object" ? scene.shadow : {};
      const ext = [(bounds.max[0] - bounds.min[0]) / 2, (bounds.max[2] - bounds.min[2]) / 2];
      const k = s.scale ?? 1.25;
      gl.useProgram(R.shadow.p);
      gl.uniformMatrix4fv(R.shadow.u.uViewProj, false, C.vp);
      gl.uniform3fv(R.shadow.u.uCenter, [bounds.center[0], s.y ?? bounds.min[1] - bounds.radius * 0.01, bounds.center[2]]);
      gl.uniform2fv(R.shadow.u.uRadii, [Math.max(ext[0], ext[1] * 0.35) * k, Math.max(ext[1], ext[0] * 0.35) * k]);
      gl.uniform1f(R.shadow.u.uOpacity, s.opacity ?? 0.16);
      gl.bindVertexArray(R.empty);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    const ghosts = items.filter(it => matOf(it).opacity < 0.999)
      .sort((a, b) => v3.dist(b.center, C.eye) - v3.dist(a.center, C.eye));
    if (ghosts.length) {
      const { ghost } = R;
      gl.useProgram(ghost.p);
      gl.uniformMatrix4fv(ghost.u.uViewProj, false, C.vp);
      gl.uniform3fv(ghost.u.uEye, C.eye);
      gl.uniform3fv(ghost.u.uLight, L);
      gl.uniform4fv(ghost.u.uCut, cutV);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      for (const it of ghosts) {
        const m = matOf(it), g = upload(it.node.mesh);
        gl.uniformMatrix4fv(ghost.u.uModel, false, it.world);
        gl.uniformMatrix3fv(ghost.u.uNormalMat, false, m4.normalMatrix(it.world));
        gl.uniform3fv(ghost.u.uColor, m.rgb);
        gl.uniform1f(ghost.u.uOpacity, m.opacity);
        gl.uniform1f(ghost.u.uCutOn, cut && it.node.cut ? 1 : 0);
        gl.bindVertexArray(g.vao);
        gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
      }
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(null);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // Composite with ink outlines into the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, R.fw, R.fh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.viewport(0, 0, Wo, Ho);
    gl.disable(gl.DEPTH_TEST);
    const cp = R.composite;
    gl.useProgram(cp.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.tColor); gl.uniform1i(cp.u.uColor, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.tNormal); gl.uniform1i(cp.u.uNormal, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.tDepth); gl.uniform1i(cp.u.uDepth, 2);
    gl.uniform2fv(cp.u.uInvSize, [1 / R.fw, 1 / R.fh]);
    gl.uniform1f(cp.u.uStep, Math.max(0.75, 0.62 * scale * (scene.ink ?? 1)));
    gl.uniform2fv(cp.u.uNearFar, [C.near, C.far]);
    gl.uniform1f(cp.u.uOrtho, C.ortho ? 1 : 0);
    gl.uniform1f(cp.u.uInk, scene.ink === 0 ? 0 : 0.9);
    gl.uniform1i(cp.u.uSS, ss);
    gl.uniform1f(cp.u.uAo, scene.ao === false ? 0 : typeof scene.ao === "number" ? scene.ao : 0.5);
    gl.uniform1f(cp.u.uAoR, 9 * scale);
    gl.bindVertexArray(R.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);

    const image = R.offscreen ? R.canvas.transferToImageBitmap() : R.canvas;
    return makeView(scene, items, C, cssW, cssH, cut ? cutV : null, { image, sx: 0, sy: R.fh - Ho, sw: Wo, sh: Ho });
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
        const P = node.mesh.positions, I = node.mesh.indices;
        for (let t = 0; t < I.length; t += 3) {
          const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
          const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
          const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
          const pv = v3.cross(d, e2), det = v3.dot(e1, pv);
          if (Math.abs(det) < 1e-12) continue;
          const tv = [o[0] - P[a], o[1] - P[a + 1], o[2] - P[a + 2]];
          const u = v3.dot(tv, pv) / det;
          if (u < 0 || u > 1) continue;
          const qv = v3.cross(tv, e1), v = v3.dot(d, qv) / det;
          if (v < 0 || u + v > 1) continue;
          const tt = v3.dot(e2, qv) / det;
          if (tt <= 0) continue;
          const local = v3.add(o, v3.scale(d, tt));
          const world = m4.apply(it.world, local);
          if (cut && node.cut && v3.dot(world, cut.slice(0, 3)) > cut[3]) continue;
          const dist = v3.dist(world, origin);
          if (!best || dist < best.distance) best = { node, point: world, distance: dist };
        }
      }
      return best;
    }
    return {
      project,
      ray,
      pick,
      // True when something opaque sits between the camera and p.
      hidden(p) {
        const s = project(p), hit = pick([s[0], s[1]]);
        return !!hit && hit.distance < v3.dist(ray([s[0], s[1]]).origin, p) - 1e-3 * C.distance;
      },
      eye: C.eye,
      target: C.target,
      width: w,
      height: h,
      source,
    };
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
    Node, Scene,
    render,
    molecule, ELEMENTS, MATERIALS,
    ramp, axes3,
    get canvas() { return R && R.canvas; },
    available() { try { renderer(); return true; } catch { return false; } },
  };
})();
