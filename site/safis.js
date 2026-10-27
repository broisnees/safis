
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
    paint: { color: "#b8322a", metal: 0, roughness: 0.45, clearcoat: 1 },
    glass: { color: "#eef4f4", glass: true, ior: 1.5, roughness: 0.03 },
    water: { color: "#a8cbe6", opacity: 0.45 },
    ghost: { color: "#f1efe9", opacity: 0.3 },
    hot: { color: "#3b3634", metal: 0, roughness: 0.6, temperature: 1400 },
  };
  const ACCENTS = ["red", "orange", "green", "blue", "purple"];

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
  function resolveMaterial(node) {
    let m = node.material, name = null;
    if (typeof m === "string") { name = m; m = MATERIALS[m] ?? { color: m }; }
    else if (m && m.base) m = { ...(MATERIALS[m.base] || {}), ...m };
    m = { ...(m || {}) };
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
      ior: m.ior ?? 1.5, dispersion: m.dispersion ?? 0.012, thickness: m.thickness ?? null,
      glow: !!temp || emissive.some(v => v > 0),
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
  // particle counts follow the tier so a paused figure doesn't change its smoke.
  const TIERS = {
    low: { rank: 0, ss: 1, scale: 0.75, msaa: 4, shadow: 1024, particles: 0.35, steps: 22, bloom: true },
    medium: { rank: 1, ss: 2, scale: 1, msaa: 4, shadow: 1536, particles: 0.6, steps: 32, bloom: true },
    high: { rank: 2, ss: 3, scale: 1, msaa: 4, shadow: 2048, particles: 1, steps: 48, bloom: true },
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
  // ss 1, which the page asks for while the reader drags on a dense screen.
  function qualityFor(scene, cam, ss, now) {
    const force = cam.quality ?? scene.quality ?? Q.forced;
    const dt = now - (scene._lastFrame ?? -1e9);
    scene._lastFrame = now;
    const moving = dt < 250 || ss < 2;
    if (Q.rank == null) Q.rank = startRank();
    if (checking()) return { ...TIERS.high, name: "high", ss, moving: false };
    if (TIERS[force]) {
      const t = TIERS[force];
      return { ...t, name: force, ss: moving ? Math.min(ss, t.ss) : ss, scale: moving ? t.scale : 1, moving };
    }
    if (moving && dt < 250) {
      Q.ema = Q.ema * 0.9 + Math.min(dt, 250) * 0.1;
      if (Q.ema > 30 && Q.rank > 0 && now - Q.downAt > 800) { Q.rank--; Q.downAt = now; Q.ema = 20; Q.quickSince = now; }
      else if (Q.ema < 18) {
        if (!Q.quickSince) Q.quickSince = now;
        if (Q.rank < 2 && now - Q.quickSince > 3000 && now - Q.downAt > 10000) { Q.rank++; Q.quickSince = now; }
      } else Q.quickSince = 0;
    }
    const name = TIER_NAMES[Q.rank], t = TIERS[name];
    if (!moving) return { ...t, name, ss, scale: 1, shadow: TIERS.high.shadow, steps: TIERS.high.steps, moving };
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
  function flowSpec(o = {}) {
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
  const PDEF = {
    count: 2000, seed: 1, life: [2, 4], step: 1 / 30, prewarm: true, style: "smoke",
    size: [0.2, 0.8], opacity: 0.6, fade: [0.12, 0.4], trail: 0.12, width: 0, intensity: 1, density: 1,
    temperature: [1900, 900], color: null, colorBy: null, range: [0, 1], soft: null, measure: false,
  };
  const STYLE_ID = { smoke: 0, fire: 1, spark: 2, streak: 3, sphere: 4, dot: 5 };
  class Particles extends Node {
    constructor(o = {}) {
      super(null, {});
      this.isParticles = true;
      this.pickable = false;
      this.cut = false;
      this.time = null;
      Object.assign(this, PDEF, o);
      this.emitter = { shape: "point", ...(o.emitter || {}) };
      this.forces = o.forces || {};
      this.colliders = o.colliders || [];
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
          let ax = F.g[0] + F.drag * (F.wind[0] - vx), ay = F.g[1] + F.drag * (F.wind[1] - vy) + F.buoyancy * Math.max(0, 1 - age / life), az = F.g[2] + F.drag * (F.wind[2] - vz);
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
          vx += ax * dtl; vy += ay * dtl; vz += az * dtl;
          px += vx * dtl; py += vy * dtl; pz += vz * dtl;
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
      const h = this.step, te = this.simTime(t), target = Math.floor(te / h + 1e-6), P = this.period;
      const need = P ? Math.ceil(P / h) + 2 : 4000;
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
      Object.assign(this, { radius: 1, length: 8, throttle: 1, temperature: 2500, fuel: "kerosene", cells: 1.5, spread: 0.05, turbulence: 1, intensity: 1, light: 1, speed: 1 }, o);
    }
    get lengthNow() { return this.length * (0.45 + 0.55 * clamp01(this.throttle)); }
    // A point light in world space that stands in for the plume's glow on nearby surfaces.
    glowLight() {
      if (!this.light || this.throttle <= 0) return null;
      const T = this.temperature * (0.7 + 0.3 * clamp01(this.throttle));
      const at = this.toWorld([0, -this.lengthNow * 0.3, 0]);
      const k = this.light * clamp01(this.throttle) * 2.2;
      const sc = this.world(), s = Math.hypot(sc[0], sc[1], sc[2]);
      return { position: at, color: blackbody(T * 0.75).map(v => v * k), range: this.lengthNow * s * 0.9 };
    }
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

  const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel, uViewProj;
uniform mat3 uNormalMat;
out vec3 vWorld; out vec3 vNormal; out vec3 vLocal; out vec3 vLocalN;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = uNormalMat * aNormal;
  vLocal = aPos;
  vLocalN = aNormal;
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
uniform float uSun;
uniform vec4 uMat; uniform vec3 uF0; uniform vec4 uBrush; uniform vec4 uDetail; uniform vec3 uEmit;
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
  vec3 base = toLin(uColor);
  float metal = uMat.y, rough = clamp(uMat.z, 0.03, 1.0), cc = uMat.w;
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
      vec4 ht = heatTint(Tk - uHeat.y);
      f0 = mix(f0, toLin(mix(ht.rgb, vec3(0.6), 0.3)), ht.a * 0.7);
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
    col = uColor * (0.12 + 0.95 * lit * (0.55 + 0.45 * max(ndl, 0.0)));
  } else {
    float wrap = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
    wrap = wrap * wrap * (3.0 - 2.0 * wrap);
    vec3 cool = uColor * vec3(0.84, 0.86, 0.90);
    col = mix(cool, uColor, wrap * sh);
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
    col += uColor * uPtCol[i] * att * max(dot(N, normalize(d)), 0.0) * 0.3;
  }
  return col;
}`;

  const FS_MAIN = `#version 300 es
${G_COMMON}
${G_ENV}
${G_SHADOW}
${G_SURFACE}
in vec3 vWorld; in vec3 vNormal; in vec3 vLocal; in vec3 vLocalN;
uniform vec4 uCut; uniform float uCutOn; uniform float uId; uniform vec3 uHighlight; uniform float uHighlightOn;
uniform float uHatch;
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
    vec3 capc = uMat.x > 0.5 ? mix(uColor, vec3(0.86), 0.25 * uMat.y) : uColor;
    oColor = vec4(mix(capc * 0.93, capc * 0.5, line * 0.75), 1.0);
    oNormal = vec4(n * 0.5 + 0.5, uId);
    return;
  }
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - vWorld);
  float vis = shadowAt(vWorld, N);
  vec3 col, glow = vec3(0.0);
  if (uMat.x < 0.5) col = shadeSoft(N, V, vWorld, vis);
  else {
    vec3 em;
    vec3 lin = shadePBR(N, V, vWorld, vLocal, vLocalN, vis, em);
    col = toSrgb(tonemap((lin + em) * uLook.z));
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
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;
vec2 screenOf(vec3 w) { vec4 c = uViewProj * vec4(w, 1.0); return (c.xy / c.w * 0.5 + 0.5) * uSceneSize; }
void main() {
  if (uCutOn > 0.5 && dot(vWorld, uCut.xyz) > uCut.w) discard;
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vWorld);
  float NoV = clamp(dot(N, V), 0.0, 1.0);
  float ior = uGlass.x, thick = uGlass.y, disp = uGlass.z, rough = uGlass.w;
  float f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  float F = f0 + (1.0 - f0) * pow(1.0 - NoV, 5.0);
  vec2 here = gl_FragCoord.xy;
  vec3 behind = vec3(0.0); float behindA = 0.0;
  float tir = 0.0;
  for (int c = 0; c < 3; c++) {
    float n = ior + (float(c) - 1.0) * disp;
    vec3 Tr = refract(-V, N, 1.0 / n);
    if (dot(Tr, Tr) < 1e-6) { tir += 1.0; continue; }
    // Where the bent ray leaves the body, approximately, and the opaque picture there.
    vec2 at = screenOf(vWorld + Tr * thick * (1.0 + 0.6 * (1.0 - NoV)));
    vec4 s = texture(uScene, clamp(at, vec2(0.5), uSceneSize - 0.5) * uSceneInv);
    behind[c] = s[c];
    behindA += s.a / 3.0;
  }
  // Absorption: a faint tint, stronger where the light crosses more glass (edges).
  vec3 tint = pow(clamp(uColor, 0.02, 1.0), vec3(0.6 + 1.6 * (1.0 - NoV)));
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
uniform sampler2D uColor; uniform sampler2D uNormal; uniform sampler2D uDepth; uniform sampler2D uFx; uniform sampler2D uBloom;
uniform vec2 uInvSize; uniform float uStep; uniform float uInk;
uniform vec2 uScale; uniform int uTaps; uniform float uAo; uniform float uAoR;
uniform vec2 uFxInv; uniform vec2 uBloomInv; uniform vec4 uPost;
uniform mat3 uViewRot; uniform vec2 uTanHalf; uniform vec2 uSize;
out vec4 o;
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
  if (n0.a < 0.5 / 255.0) return 1.0;
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
  vec4 sum = vec4(0.0);
  float N = float(uTaps);
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
    if (i < uTaps && j < uTaps) sum += shade((o0 + (vec2(float(i), float(j)) + 0.5) / N) * uScale);
  }
  vec4 sc = sum / (N * N);
  if (uAo > 0.0) sc.rgb *= occlusion((o0 + 0.5) * uScale);
  vec4 res = sc;
  if (uPost.x > 0.5) {
    vec4 fx = texture(uFx, (o0 + 0.5) * uFxInv);
    res = vec4(min(fx.rgb, vec3(1.0)) + sc.rgb * (1.0 - fx.a), fx.a + sc.a * (1.0 - fx.a));
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
// uFlowA: kind, U, alpha, S. uFlowB: center xyz, mid. uFlowC: mu.x, mu.y, a, gamma. Returns w = 0 inside the body.
vec4 flowAt(vec3 p) {
  int kind = int(uFlowA.x + 0.5);
  float U = uFlowA.y;
  if (kind == 0) return vec4(U, 0.0, 0.0, 1.0);
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
    vec3 acc = uGrav.xyz + uGrav.w * (uWind.xyz - v);
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
    v += acc * h;
    p += v * h;
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
layout(location=0) in vec4 aP; layout(location=1) in vec4 aV;
uniform mat4 uViewProj; uniform vec3 uEye; uniform vec3 uCamR; uniform vec3 uCamU;
uniform vec4 uTime; uniform vec4 uSize; uniform int uStyle; uniform vec4 uShape;
out vec2 vUv; out float vAge; out float vRnd; out vec3 vWorld; out vec3 vCenter; out float vSize; out vec3 vVel;
flat out int vAlive;
void main() {
  int i = gl_InstanceID;
  float k, age;
  slotAt(i, uTime.x, uLife.y, k, age);
  float life = lifeOf(i, k);
  float r = rnd(i, k, 7u);
  vAlive = 0;
  vUv = vec2(0.0); vAge = 0.0; vRnd = r; vWorld = vec3(0.0); vCenter = vec3(0.0); vSize = 0.0; vVel = vec3(0.0);
  if (aP.w != k || age < 0.0 || age > life || r > uTime.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vAlive = 1;
  float dtR = uTime.y - uTime.x;
  vec3 p = aP.xyz + aV.xyz * dtR;
  age += dtR;
  float t01 = uLife.y <= 0.0 ? 0.0 : clamp(age / life, 0.0, 1.0);
  float size = mix(uSize.x, uSize.y, sqrt(t01)) * (1.0 + uSize.z * (rnd(i, k, 8u) - 0.5));
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vUv = c; vAge = t01; vCenter = p; vSize = size; vVel = aV.xyz;
  vec3 w;
  if (uStyle == 2 || uStyle == 3) {
    vec3 v = aV.xyz; float sp = length(v);
    vec3 dir = sp > 1e-5 ? v / sp : uCamU;
    float len = max(sp * uShape.x, size);
    vec3 side = cross(dir, normalize(uEye - p));
    side = length(side) > 1e-5 ? normalize(side) : uCamR;
    float wd = uShape.y > 0.0 ? uShape.y : size * 0.3;
    w = p + dir * (c.y * 0.5 - 0.5) * len + side * c.x * wd * 0.5;
  } else {
    float ang = uStyle == 0 ? r * 6.2831853 + age * (r - 0.5) * 0.6 : 0.0;
    vec2 rc = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * c;
    float s = uStyle == 4 ? size * 1.25 : size * 0.5;
    w = p + (uCamR * rc.x + uCamU * rc.y) * s;
    if (uStyle == 4) vUv = c;
  }
  vWorld = w;
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

  const FS_PARTICLE = `#version 300 es
${G_COMMON}
${G_ENV}
in vec2 vUv; in float vAge; in float vRnd; in vec3 vWorld; in vec3 vCenter; in float vSize; in vec3 vVel;
flat in int vAlive;
uniform int uStyle; uniform vec4 uShape; uniform vec3 uEye; uniform vec3 uCamR; uniform vec3 uCamU; uniform mat4 uView;
uniform sampler2D uDepth; uniform vec2 uDepthScale;
uniform vec3 uColA; uniform vec3 uColB; uniform vec4 uColorBy; uniform vec4 uHeatP; uniform vec4 uFade;
uniform vec3 uLight; uniform vec3 uKeyCol; uniform vec4 uPtPos[2]; uniform vec3 uPtCol[2]; uniform vec4 uLook;
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
    float n = vnoise(vec3(vUv * 1.8 + vRnd * 13.0, vRnd * 7.0 + vAge * 1.5));
    float puff = smoothstep(1.0, 0.15, d2 + 0.45 * n);
    float a = puff * life * soft * uFade.w;
    if (a < 0.002) discard;
    vec3 toEye = normalize(uEye - vCenter);
    vec3 nrm = normalize(uCamR * vUv.x + uCamU * vUv.y + toEye * sqrt(max(1.0 - d2, 0.05)));
    vec3 alb = toLin(colorAt());
    vec3 lit = envDiff(nrm) * uLook.x + uKeyCol * (0.35 + 0.65 * max(dot(nrm, uLight), 0.0)) / PI;
    for (int i = 0; i < 2; i++) {
      if (uPtPos[i].w <= 0.0) continue;
      vec3 d = uPtPos[i].xyz - vCenter;
      float att = 1.0 / (1.0 + dot(d, d) / (uPtPos[i].w * uPtPos[i].w));
      lit += uPtCol[i] * att * (0.4 + 0.6 * max(dot(nrm, normalize(d)), 0.0)) / PI;
    }
    vec3 col = toSrgb(tonemap(alb * lit * uLook.z));
    o = vec4(col * a, a);
  } else if (uStyle == 1 || uStyle == 2) {
    float T = mix(uHeatP.x, uHeatP.y, vAge);
    vec3 e = blackbody(T) * glowOf(T) * uHeatP.z;
    float shape = uStyle == 1 ? pow(max(1.0 - d2, 0.0), 1.5) * (0.75 + 0.25 * vnoise(vec3(vUv * 2.5, vRnd * 9.0 + vAge * 3.0)))
                              : (1.0 - vUv.x * vUv.x) * smoothstep(-1.0, 0.4, vUv.y);
    float a = shape * life * soft;
    if (a < 0.002) discard;
    vec3 c = toSrgb(tonemap(e)) * a;
    o = vec4(c + e * a * uLook.w * 0.15, 0.0);
  } else if (uStyle == 3) {
    float across = 1.0 - smoothstep(0.35, 1.0, abs(vUv.x));
    float along = smoothstep(-1.0, 0.6, vUv.y);
    float a = across * along * life * uFade.w;
    if (a < 0.003) discard;
    o = vec4(colorAt() * a, a);
  } else {
    float edge = 1.0 - smoothstep(0.8, 1.0, sqrt(d2));
    float a = edge * life * uFade.w;
    if (a < 0.003) discard;
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
uniform vec4 uP0; uniform vec4 uP1; uniform vec4 uP2; uniform vec4 uP3; uniform vec4 uLook;
out vec4 o;
// uP0: exit radius, length, bound radius, time. uP1: throttle, cell length, core T, steps.
// uP2: spread, turbulence, intensity, fuel. uP3: world-to-local scale, flow speed, _, _.
float fbm(vec3 x) { return 0.55 * vnoise(x) + 0.3 * vnoise(x * 2.03 + 17.0) + 0.15 * vnoise(x * 4.1 + 41.0); }
vec3 field(vec3 q, out float sigma) {
  float r0 = uP0.x, L = uP0.y, lam = uP1.y, thr = uP1.x;
  float s = -q.y, r = length(q.xz);
  float R = r0 * (1.0 + uP2.x * s / r0);
  float cells = s / lam;
  R *= 1.0 - 0.12 * (0.5 + 0.5 * cos(6.2831853 * cells)) * exp(-s / (lam * 4.0));
  float turb = uP2.y * smoothstep(0.0, lam * 2.5, s);
  vec3 nq = vec3(q.x, q.y + uP0.w * uP3.y, q.z) / r0 * 1.4;
  float n = turb > 0.001 ? fbm(nq) : 0.0;
  float rr = r / R + turb * n * 0.45;
  float body = smoothstep(1.08, 0.5, rr) * smoothstep(0.0, 0.08 * r0, s);
  float fade = 1.0 - smoothstep(0.55 * L, L, s);
  float T = uP1.z * (0.5 + 0.5 * exp(-s / (L * 0.35))) * (1.0 - 0.3 * smoothstep(0.35, 1.0, rr));
  float dia = 0.0;
  for (int k = 0; k < 7; k++) {
    float sk = (float(k) + 0.62) * lam;
    float dk = (s - sk) / (0.14 * lam);
    dia += exp(-dk * dk - pow(r / (0.38 * R), 2.0)) * pow(0.74, float(k));
  }
  float coreLen = lam * 0.85;
  float core = s < coreLen ? exp(-pow(r / (0.8 * r0 * (1.0 - s / coreLen) + 1e-3), 2.0)) : 0.0;
  int fuel = int(uP2.w + 0.5);
  vec3 bb = blackbody(T) * glowOf(T);
  vec3 tint = fuel == 1 ? vec3(0.55, 0.62, 1.0) : fuel == 2 ? vec3(0.75, 0.62, 1.0) : vec3(1.0);
  float bodyGain = fuel == 2 ? 0.08 : fuel == 1 ? 0.35 : 1.0;
  vec3 e = bb * body * fade * bodyGain * mix(vec3(1.0), tint, 0.6);
  vec3 hot = blackbody(T * 1.35) * glowOf(T * 1.35);
  e += hot * dia * (fuel == 2 ? 0.9 : 0.55) * fade * mix(vec3(1.0), tint, 0.5);
  e += hot * core * 0.9 * mix(vec3(1.0), tint, 0.7);
  sigma = body * fade * (fuel == 0 ? 0.35 : 0.08) * (0.6 + 0.4 * smoothstep(0.3 * L, L, s));
  return e * uP2.z * thr * 0.16;
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
  for (int i = 0; i < 96; i++) {
    if (i >= steps || Tr < 0.01) break;
    float t = t0 + (float(i) + jit) * dt;
    vec3 q = ro + rd * t;
    if (length(q.xz) > Rb) continue;
    float sig;
    vec3 e = field(q, sig);
    float ds = dt * scale / uP0.x;
    E += Tr * e * ds;
    Tr *= exp(-sig * ds);
  }
  float alpha = 1.0 - Tr;
  vec3 col = toSrgb(tonemap(E * uLook.z));
  o = vec4(col + E * uLook.w * 0.12, alpha);
}`;

  // ---------- WebGL renderer ----------
  let R = null;
  function compile(gl, vs, fs, varyings) {
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
    if (varyings) gl.transformFeedbackVaryings(p, varyings, gl.SEPARATE_ATTRIBS);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
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
      default: gl.uniform1i(l, v | 0);
    }
  }
  const setAll = (P, o) => { for (const k in o) setU(P, k, o[k]); };

  const PROGRAMS = {
    main: () => [VS, FS_MAIN], depth: () => [VS, FS_DEPTH], ghost: () => [VS, FS_GHOST], glass: () => [VS, FS_GLASS],
    ground: () => [VS_GROUND, FS_GROUND], composite: () => [VS_FULL, FS_COMPOSITE],
    extract: () => [VS_FULL, FS_BLOOM_EXTRACT], down: () => [VS_FULL, FS_DOWN], up: () => [VS_FULL, FS_UP],
    env: () => [VS_FULL, FS_ENV], prefilter: () => [VS_FULL, FS_PREFILTER],
    pupdate: () => [VS_PUPDATE, FS_NULL, ["oP", "oV"]], particle: () => [VS_PARTICLE, FS_PARTICLE], psphere: () => [VS_PARTICLE, FS_PSPHERE],
    plume: () => [VS, FS_PLUME],
  };
  // Programs compile the first time a frame needs them, so a page without particles never pays for them.
  const prog = name => R.prog[name] || (R.prog[name] = compile(R.gl, ...PROGRAMS[name]()));

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
    if (canvas.addEventListener) canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); R = null; });
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
  function environment(kind, dark, sun) {
    const key = `${kind}|${dark ? 1 : 0}|${kind === 2 ? sun.map(v => v.toFixed(2)).join(",") : ""}`;
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
    setAll(pe, { uSize: [512, 256], uKind: kind, uDark: dark ? 1 : 0, uSun: sun, uOutScale: enc });
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
    const bi = buf(gl.ELEMENT_ARRAY_BUFFER, m.indices);
    gl.bindVertexArray(null);
    m._gpu = { gl, vao, buffers: [bp, bn, bi], count: m.indices.length, version: m.version };
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
    gl.bindVertexArray(null);
    G = sys._cpuGpu = { gl, count: sys.count, buffer: b, draw: a };
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
  function forceUniforms(F) {
    const u = {
      uGrav: [...F.g, F.drag], uWind: [...F.wind, F.buoyancy], uTurb: [...F.turb, 0],
      uVortA: F.vortex ? [...F.vortex.c, F.vortex.s] : [0, 0, 0, 0], uVortB: F.vortex ? [...F.vortex.a, F.vortex.core] : [0, 1, 0, 0.2],
      uVortC: [F.vortex ? F.vortex.pull : 0, F.vortex ? 1 : 0, 0, 0],
      uNAttr: F.attractors.length, uNPlane: F.planes.length, uNSph: F.spheres.length,
      uKillMin: F.kill ? [...F.kill.min, 1] : [0, 0, 0, 0], uKillMax: F.kill ? [...F.kill.max, 0] : [0, 0, 0, 0],
      uFlowA: F.flow ? [F.flow.kind, F.flow.U, F.flow.alpha, F.flow.S] : [-1, 0, 0, 1],
      uFlowB: F.flow ? [...F.flow.center, F.flow.mid] : [0, 0, 0, 0],
      uFlowC: F.flow ? [F.flow.mu[0], F.flow.mu[1], F.flow.kind === 1 ? F.flow.R : F.flow.a, F.flow.gamma] : [0, 0, 0, 0],
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
    if (sys.cpu || sys.measure) { sys.simulate(t, n); sys._mode = "cpu"; return; }
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
      gl.bindBuffer(gl.ARRAY_BUFFER, G.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sys._state);
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

  // ---------- render ----------
  // Renders the scene into the shared WebGL canvas; returns a view for projection and picking.
  // outScale: output pixels per CSS pixel (the screen's density). ss: supersampling
  // factor (1 to 3); the frame is rendered ss times larger and filtered down in the
  // composite pass, so the result can be copied to the page 1:1 with no resampling.
  function render(scene, cam = {}, cssW, cssH, outScale = 1, ss = 2) {
    renderer();
    const { gl } = R;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const q = qualityFor(scene, cam, Math.max(1, Math.min(3, Math.round(ss))), now);
    ss = q.ss;
    const Wo = Math.max(1, Math.round(cssW * outScale)), Ho = Math.max(1, Math.round(cssH * outScale));
    const W = Math.max(1, Math.round(Wo * ss * q.scale)), H = Math.max(1, Math.round(Ho * ss * q.scale));
    const scale = (W / Wo) * outScale;
    const items = collect(scene);
    const fxNodes = items.fx;
    const bounds = sceneBounds(items);
    const C = camera(cam, scene, bounds, cssW / cssH);
    const look = lookOf(scene), dark = pageDark();
    const L = lightDir(scene, C);
    const cut = scene.cutPlane ? (Array.isArray(scene.cutPlane) ? scene.cutPlane : [...scene.cutPlane.normal, scene.cutPlane.offset ?? 0]) : null;
    const cutN = cut ? v3.norm(cut.slice(0, 3)) : null;
    const cutV = cut ? [...cutN, cut[3] / v3.len(cut.slice(0, 3))] : [0, 1, 0, 1e9];
    const hatch = (C.worldPerPx / cssH) * 7;
    const pal = (typeof window !== "undefined" && window.palette) || {};
    const hiDefault = hexRgb(pal.orange || "#d9800f");

    const mats = new Map();
    const matOf = it => { let m = mats.get(it.node); if (!m) mats.set(it.node, (m = resolveMaterial(it.node))); return m; };
    const opaque = items.filter(it => matOf(it).kind === "opaque");
    const glassItems = items.filter(it => matOf(it).kind === "glass");
    const ghosts = items.filter(it => matOf(it).kind === "ghost").sort((a, b) => v3.dist(b.center, C.eye) - v3.dist(a.center, C.eye));
    opaque.concat(glassItems).forEach((it, i) => { it.id = ((i * 97) % 254) + 1; });

    // Environment, its turn with the camera, and the light rig.
    const fwd = v3.sub(C.eye, C.target);
    let ez = v3.norm([fwd[0], 0, fwd[2]]);
    if (!Number.isFinite(ez[0]) || v3.len([fwd[0], 0, fwd[2]]) < 1e-6) ez = [0, 0, 1];
    const ex = v3.norm(v3.cross([0, 1, 0], ez));
    const envRot = new Float32Array([ex[0], 0, ez[0], ex[1], 1, ez[1], ex[2], 0, ez[2]]);
    const sunEnv = [v3.dot(L, ex), L[1], v3.dot(L, ez)];
    const env = environment(look.env, dark, sunEnv);
    const kc = look.keyColor.map(v => v * look.key), fc = look.fillColor.map(v => v * look.fill), rc = [1, 1, 1].map(v => v * look.rim);
    const fillDir = viewToWorld(C, [0.8, 0.1, 0.55]), rimDir = viewToWorld(C, [0.25, 0.5, -0.85]);
    const points = [];
    for (const f of fxNodes) if (f.node.isPlume) { const gl_ = f.node.glowLight(); if (gl_) points.push(gl_); }
    for (const p of scene.lights || []) points.push({ position: p.position, color: colorOf(p.color || "#ffffff", true).map(v => (v ** 2.2) * (p.intensity ?? 1)), range: p.range ?? bounds.radius });
    const ptPos = new Float32Array(8), ptCol = new Float32Array(6);
    points.slice(0, 2).forEach((p, i) => { ptPos.set([...p.position, p.range], i * 4); ptCol.set(p.color, i * 3); });
    const hasGlow = items.some(it => matOf(it).glow) || fxNodes.some(f => f.node.isPlume || (f.node.isParticles && (f.node.style === "fire" || f.node.style === "spark")));
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
      const sys = f.node, n = Math.max(1, Math.min(sys.count, Math.ceil(sys.count * (sys.quality === false ? 1 : tierFrac))));
      sys._drawN = n;
      stepParticles(sys, n);
    }
    const spheres = fxNodes.filter(f => f.node.isParticles && f.node.style === "sphere");

    // Shadow maps from the key light, fitted around the scene.
    const sh = scene.shadow === false ? null : typeof scene.shadow === "object" ? scene.shadow : {};
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
          setAll(P, { uModel: it.world, uCutOn: cut && it.node.cut ? 1 : 0 });
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
    targets(W, H, Wo, Ho, samples, glassItems.length > 0);
    const target = samples ? R.msaa.fb : R.main.fb;
    const partShadow = shadowOn ? (sh.parts ?? 1) * look.parts : 0;
    const common = {
      uViewProj: C.vp, uEye: C.eye, uLight: L, uCut: cutV, uSun: scene.lighting === "sun" ? 1 : 0, uHatch: hatch,
      uKeyCol: kc, uFillDir: fillDir, uFillCol: fc, uRimDir: rimDir, uRimCol: rc, uPtPos: ptPos, uPtCol: ptCol, uLook: lookU,
      uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0,
      ...envU, ...shadowU,
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
    const drawSurface = (P, it, m) => {
      const g = upload(it.node.mesh);
      const cutOn = cut && it.node.cut ? 1 : 0;
      if (cutOn) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
      const r = it.node.mesh.bounds.radius || 1, wr = it.radius || 1;
      const T = m.temp;
      const tS = [0, 0, 0, 0], tT = [0, 0, 0, 0];
      if (T) T.stops.forEach(([s, t], j) => { tS[j] = s; tT[j] = t; });
      for (let j = T ? T.stops.length : 0; j < 4; j++) { tS[j] = (tS[j - 1] ?? 0) + 1; tT[j] = tT[j - 1] ?? 0; }
      const hl = it.node.highlight;
      setAll(P, {
        uModel: it.world, uNormalMat: m4.normalMatrix(it.world), uColor: m.rgb, uId: it.id / 255, uCutOn: cutOn,
        uMat: [m.physical ? 1 : 0, m.metal, m.roughness, m.clearcoat], uF0: m.f0,
        uBrush: [...m.brushAxis, m.anisotropy], uDetail: [m.brush, m.anisotropy > 0 ? 70 / wr : 0, m.weave ? 1 : 0, 9 / r],
        uEmit: m.emissive, uTempAxis: [...(T ? T.axis : [0, 1, 0]), T ? T.stops.length : 0], uTempS: tS, uTempT: tT,
        uHeat: [m.heatShift != null ? 1 : 0, m.heatShift ?? 0, 0, partShadow],
        uHighlightOn: hl ? 1 : 0, uHighlight: typeof hl === "string" ? hexRgb(pal[hl] || hl) : hiDefault,
        uOpacity: m.opacity, uGlass: [m.ior, m.thickness ?? wr * 0.9, m.dispersion, m.roughness],
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
      setAll(P, { ...common, uCamR: camR, uCamU: camU, uCamF: C.forward, uOrthoCam: C.ortho ? 1 : 0, uPartShadow: partShadow });
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
    if (sh && sh.ground !== false && items.length) {
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
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      const P = prog("glass");
      gl.useProgram(P.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.scene.tex);
      setAll(P, { ...common, uScene: 0, uSceneInv: [1 / R.scene.w, 1 / R.scene.h], uSceneSize: [W, H] });
      for (const it of glassItems.sort((a, b) => v3.dist(b.center, C.eye) - v3.dist(a.center, C.eye))) drawSurface(P, it, matOf(it));
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
    const fxDraw = fxNodes.filter(f => f.node.isPlume || (f.node.isParticles && f.node.style !== "sphere"))
      .sort((a, b) => v3.dist(b.center, C.eye) - v3.dist(a.center, C.eye));
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.fx.fb);
    gl.viewport(0, 0, Wo, Ho);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    if (fxDraw.length) {
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      bindEnv();
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.main.depth);
      const depthScale = [(W / Wo) / R.main.w, (H / Ho) / R.main.h];
      const camR = viewToWorld(C, [1, 0, 0]), camU = viewToWorld(C, [0, 1, 0]);
      for (const f of fxDraw) {
        const node = f.node;
        if (node.isPlume) {
          const P = prog("plume");
          gl.useProgram(P.p);
          const Lp = node.lengthNow, r0 = node.radius, thr = clamp01(node.throttle);
          const Rb = r0 * (1 + node.spread * Lp / r0) * 1.7;
          const proxy = R.unitCyl || (R.unitCyl = transformMesh(mesh.cylinder(1, 1, { segments: 28 }), m4.translation([0, -0.5, 0])));
          const g = upload(proxy);
          const ws = Math.hypot(f.world[0], f.world[1], f.world[2]) || 1;
          setAll(P, {
            uModel: m4.multiply(f.world, m4.scaling([Rb, Lp * 1.02, Rb])), uViewProj: C.vp, uNormalMat: m4.normalMatrix(f.world),
            uInvModel: m4.invert(f.world), uEye: C.eye, uView: C.view, uCamF: C.forward, uDepth: 2, uDepthScale: depthScale,
            uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0, uLook: lookU,
            uP0: [r0, Lp, Rb, node.time ?? scene.time ?? 0], uP1: [thr, node.cells * 2 * r0 * Math.sqrt(0.4 + 0.6 * thr), node.temperature, q.steps],
            uP2: [node.spread, node.turbulence, node.intensity, FUELS[node.fuel] ?? 0], uP3: [1 / ws, node.speed * r0 * 6, 0, 0],
          });
          gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
          gl.bindVertexArray(g.vao);
          gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
          gl.disable(gl.CULL_FACE); gl.cullFace(gl.BACK);
          continue;
        }
        const sys = node, P = prog("particle");
        gl.useProgram(P.p);
        const t = sys._t ?? 0, tr = sys.simTime(sys.time ?? scene.time ?? 0);
        const sz = Array.isArray(sys.size) ? sys.size : [sys.size, sys.size];
        const fade = Array.isArray(sys.fade) ? sys.fade : [sys.fade, sys.fade];
        const temps = Array.isArray(sys.temperature) ? sys.temperature : [sys.temperature, sys.temperature];
        setAll(P, {
          ...envU, uViewProj: C.vp, uView: C.view, uEye: C.eye, uCamR: camR, uCamU: camU, uDepth: 2, uDepthScale: depthScale,
          uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0, uLight: L, uKeyCol: kc, uPtPos: ptPos, uPtCol: ptCol, uLook: lookU,
          uTime: [t, Math.max(t, Math.min(tr, t + sys.step)), 0, sys.density], uLife: [sys.lifeRange[0], sys.period, 0, 0], uSeed: sys.seed,
          uSize: [sz[0], sz[1], sys.sizeJitter ?? 0.5, 0], uStyle: STYLE_ID[sys.style] ?? 0, uShape: [sys.trail, sys.width, 0, 0],
          uFade: [fade[0], fade[1], sys.soft ?? bounds.radius * 0.04, sys.opacity],
          uHeatP: [temps[0], temps[1], sys.intensity, 0],
          ...particleColors(sys),
        });
        gl.bindVertexArray(particleSource(sys));
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sys._drawN);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
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

    // Composite with ink outlines into the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, R.cw, R.ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.viewport(0, 0, Wo, Ho);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const cp = prog("composite");
    gl.useProgram(cp.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.main.color);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.main.normal);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.main.depth);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, R.fx.tex);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, bloomTex || R.fx.tex);
    const v = C.view;
    setAll(cp, {
      uColor: 0, uNormal: 1, uDepth: 2, uFx: 3, uBloom: 4,
      uInvSize: [1 / R.main.w, 1 / R.main.h], uScale: [W / Wo, H / Ho], uTaps: Math.max(1, Math.min(3, Math.round(W / Wo))),
      uStep: Math.max(0.75, 0.62 * scale * (scene.ink ?? 1)), uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0,
      uInk: scene.ink === 0 ? 0 : 0.9 * look.ink,
      uAo: scene.ao === false ? 0 : typeof scene.ao === "number" ? scene.ao : 0.5, uAoR: bounds.radius * 0.09,
      uFxInv: [1 / R.fx.w, 1 / R.fx.h], uBloomInv: bloomInv, uPost: [fxDraw.length ? 1 : 0, bloomTex ? bloomK : 0, 0, 0],
      uViewRot: new Float32Array([v[0], v[1], v[2], v[4], v[5], v[6], v[8], v[9], v[10]]), uTanHalf: C.tanHalf, uSize: [W, H],
    });
    gl.bindVertexArray(R.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);

    const image = R.offscreen ? R.canvas.transferToImageBitmap() : R.canvas;
    const view = makeView(scene, items, C, cssW, cssH, cut ? cutV : null, { image, sx: 0, sy: R.ch - Ho, sw: Wo, sh: Ho });
    view.quality = q.name;
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
    particles: o => new Particles(o),
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
    get canvas() { return R && R.canvas; },
    available() { try { renderer(); return true; } catch { return false; } },
    // For tests: the pure functions the shaders mirror.
    _: { resolveMaterial, hashU, rndU, noised, curl, flowAt, flowSpec, blackbody, glowOf, heatTint, tempAt, tempField, qualityFor, Q, TIERS, parseColor, pageDark, LOOKS },
  };
})();

;

/* E3.parts: parametric machine parts and assemblies for E3 figures.
   Everything is built in millimeters on E3's axes: y is up, and anything round
   turns about y (the way E3.mesh.lathe does). Parts come back as meshes or as
   group nodes with named children; assemblies add pose(), explode(), labels(),
   notes, and attachment points. It uses only E3's public API.
   Reference: references/parts3d.md in the skill. */
(() => {
  "use strict";
  const E3 = window.E3;
  if (!E3 || !E3.mesh || E3.parts) return;
  const { v3, m4, mesh } = E3;
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mul = (...ms) => ms.reduce((a, b) => m4.multiply(a, b));
  const T = p => m4.translation(p);
  const RX = a => m4.rotationX(a), RY = a => m4.rotationY(a), RZ = a => m4.rotationZ(a);
  const SC = s => m4.scaling(typeof s === "number" ? [s, s, s] : s);
  const xf = (m, ...ms) => mesh.transform(m, mul(...ms));
  const merge = (...ms) => { const l = ms.flat(Infinity).filter(Boolean); return l.length ? mesh.merge(...l) : null; };
  // Cylindrical point in E3's lathe convention: angle a counterclockwise seen from +y.
  const cyl = (r, a, y) => [r * Math.cos(a), y, -r * Math.sin(a)];
  // Turns a part built along y so its axis runs along x or z.
  const ALONG = { x: RZ(-Math.PI / 2), y: m4.identity(), z: RX(Math.PI / 2) };

  // ---------- triangle soup ----------
  // Builders emit triangles; build() welds them with E3's crease rule. Closed solids are
  // flipped as a whole if they came out inside out, so callers only need consistent winding.
  class Soup {
    constructor() { this.p = []; }
    tri(a, b, c) {
      if (v3.dist(a, b) < 1e-7 || v3.dist(b, c) < 1e-7 || v3.dist(c, a) < 1e-7) return;
      this.p.push(a, b, c);
    }
    quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
    // A planar 2D polygon mapped into 3D by fn, wound so its normal points along dir.
    cap(poly, fn, dir, holes = []) {
      for (const t of E3.triangulate(poly, holes)) {
        const P = t.map(fn);
        const n = v3.cross(v3.sub(P[1], P[0]), v3.sub(P[2], P[0]));
        if (v3.dot(n, dir) >= 0) this.tri(P[0], P[1], P[2]); else this.tri(P[0], P[2], P[1]);
      }
    }
    build({ crease = 35, closed = true } = {}) {
      let p = this.p;
      if (closed) {
        let vol = 0;
        for (let i = 0; i < p.length; i += 3) vol += v3.dot(p[i], v3.cross(p[i + 1], p[i + 2]));
        if (vol < 0) { p = p.slice(); for (let i = 0; i < p.length; i += 3) { const t = p[i + 1]; p[i + 1] = p[i + 2]; p[i + 2] = t; } }
      }
      return mesh.custom(p, p.map((_, i) => i), { crease });
    }
  }

  // Turns a closed mesh inside out (the inner skin of a hollow casing).
  function flip(m) {
    const c = mesh.merge(m);
    for (let i = 0; i < c.normals.length; i++) c.normals[i] = -c.normals[i];
    for (let i = 0; i < c.indices.length; i += 3) { const t = c.indices[i + 1]; c.indices[i + 1] = c.indices[i + 2]; c.indices[i + 2] = t; }
    return c;
  }

  // ---------- 2D profiles ----------
  const area2 = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const circle2 = (r, n = 32, cx = 0, cy = 0, a0 = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(a0 + (i / n) * TAU), cy + r * Math.sin(a0 + (i / n) * TAU)]);
  const arc2 = (cx, cy, r, a0, a1, n = 8) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  function roundRect2(w, h, r = 0, n = 5, cx = 0, cy = 0) {
    r = Math.min(r, w / 2 - 1e-6, h / 2 - 1e-6);
    if (r <= 0) return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
    const x = w / 2 - r, y = h / 2 - r;
    return [
      ...arc2(cx + x, cy - y, r, -Math.PI / 2, 0, n), ...arc2(cx + x, cy + y, r, 0, Math.PI / 2, n),
      ...arc2(cx - x, cy + y, r, Math.PI / 2, Math.PI, n), ...arc2(cx - x, cy - y, r, Math.PI, Math.PI * 1.5, n),
    ];
  }
  function hull2(pts) {
    const p = pts.map(q => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length > 1 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }
  // Rounds the corners of a polyline. Points are [x, y] or [x, y, r], r being that corner's fillet radius.
  function fillet(pts, { closed = false, steps = 6 } = {}) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const P = pts[i], r = P[2] || 0;
      if (!r || (!closed && (i === 0 || i === n - 1))) { out.push([P[0], P[1]]); continue; }
      const A = pts[(i - 1 + n) % n], B = pts[(i + 1) % n];
      let ux = A[0] - P[0], uy = A[1] - P[1], wx = B[0] - P[0], wy = B[1] - P[1];
      const la = Math.hypot(ux, uy), lb = Math.hypot(wx, wy);
      ux /= la; uy /= la; wx /= lb; wy /= lb;
      const th = Math.acos(clamp(ux * wx + uy * wy, -1, 1));
      if (th < 1e-3 || th > Math.PI - 1e-3) { out.push([P[0], P[1]]); continue; }
      let t = r / Math.tan(th / 2), rr = r;
      const tmax = 0.5 * Math.min(la, lb);
      if (t > tmax) { t = tmax; rr = t * Math.tan(th / 2); }
      const bx = ux + wx, by = uy + wy, bl = Math.hypot(bx, by), d = rr / Math.sin(th / 2);
      const C = [P[0] + (bx / bl) * d, P[1] + (by / bl) * d];
      const a0 = Math.atan2(P[1] + uy * t - C[1], P[0] + ux * t - C[0]);
      let da = Math.atan2(P[1] + wy * t - C[1], P[0] + wx * t - C[0]) - a0;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      const k = Math.max(2, Math.ceil((steps * Math.abs(da)) / (Math.PI / 2)));
      for (let s = 0; s <= k; s++) { const a = a0 + (da * s) / k; out.push([C[0] + rr * Math.cos(a), C[1] + rr * Math.sin(a)]); }
    }
    return out;
  }
  // Offsets an open 2D polyline sideways by d (positive: to the left of travel).
  function offset2(pts, d) {
    const n = pts.length;
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
      return [p[0] - (ty / l) * d, p[1] + (tx / l) * d];
    });
  }
  // Samples y(x) or r(y) style polylines at even arc length.
  function resample(pts, n) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = L[L.length - 1], out = [];
    let j = 0;
    for (let k = 0; k <= n; k++) {
      const s = (total * k) / n;
      while (j < pts.length - 2 && L[j + 1] < s) j++;
      const t = (s - L[j]) / (L[j + 1] - L[j] || 1);
      out.push([lerp(pts[j][0], pts[j + 1][0], t), lerp(pts[j][1], pts[j + 1][1], t)]);
    }
    return out;
  }

  // ---------- revolve ----------
  // Revolves a profile [[r, y], ...] about y. loop: the profile is a closed outline (a wall
  // with thickness). arc < 2π leaves a wedge open, with flat caps on the cut faces.
  function revolve(profile, { segments = 64, arc = TAU, start = 0, loop = false, crease = 35, caps = true } = {}) {
    let pr = profile.map(p => [Math.max(0, p[0]), p[1]]);
    const n = pr.length, poles = pr[0][0] < 1e-9 && pr[n - 1][0] < 1e-9;
    if ((loop || poles) && area2(pr) < 0) pr = pr.reverse();
    const full = arc >= TAU - 1e-6;
    const ang = j => start + (arc * j) / segments;
    const at = (i, j) => { const [r, y] = pr[i % n]; return cyl(r, ang(j), y); };
    const S = new Soup();
    const rows = loop ? n : n - 1;
    for (let i = 0; i < rows; i++) for (let j = 0; j < segments; j++) {
      const j1 = full ? (j + 1) % segments : j + 1;
      S.quad(at(i, j), at(i, j1), at(i + 1, j1), at(i + 1, j));
    }
    if (!full && caps && (loop || poles)) {
      for (const [a, sgn] of [[start, -1], [start + arc, 1]]) {
        const dir = v3.scale([-Math.sin(a), 0, -Math.cos(a)], sgn);
        S.cap(pr, ([r, y]) => cyl(r, a, y), dir);
      }
    }
    return S.build({ crease, closed: loop || poles });
  }
  // ---------- paths and tubes ----------
  function frames(path, closed = false) {
    const n = path.length, Tg = [], N = [], B = [];
    for (let i = 0; i < n; i++) {
      const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      Tg.push(v3.norm(v3.sub(b, a)));
    }
    let Nv = v3.norm(v3.cross(Tg[0], Math.abs(Tg[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    for (let i = 0; i < n; i++) {
      if (i) { Nv = v3.sub(Nv, v3.scale(Tg[i], v3.dot(Nv, Tg[i]))); Nv = v3.len(Nv) < 1e-9 ? N[i - 1] : v3.norm(Nv); }
      N.push(Nv);
      B.push(v3.cross(Tg[i], Nv));
    }
    return { T: Tg, N, B };
  }
  // A tube along a path: solid, or hollow when ri > 0 (pipes show a ring when cut).
  // ro may be a function of t in [0, 1].
  function tubeShell(path, ro, ri = 0, { segments = 20, crease = 60, closed = false } = {}) {
    const { T: Tg, N, B } = frames(path, closed), n = path.length;
    const rad = typeof ro === "function" ? ro : () => ro, irad = typeof ri === "function" ? ri : () => ri;
    const ring = (i, r) => Array.from({ length: segments }, (_, j) => {
      const a = (j / segments) * TAU;
      return v3.add(path[i], v3.add(v3.scale(N[i], r * Math.cos(a)), v3.scale(B[i], r * Math.sin(a))));
    });
    const O = path.map((_, i) => ring(i, rad(i / (n - 1))));
    const I = (typeof ri === "function" || ri > 0) ? path.map((_, i) => ring(i, irad(i / (n - 1)))) : null;
    const S = new Soup();
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % n;
      for (let j = 0; j < segments; j++) {
        const k = (j + 1) % segments;
        S.quad(O[i][j], O[i][k], O[i1][k], O[i1][j]);
        if (I) S.quad(I[i][j], I[i1][j], I[i1][k], I[i][k]);
      }
    }
    if (!closed) {
      for (const [i, start] of [[0, true], [n - 1, false]]) {
        for (let j = 0; j < segments; j++) {
          const k = (j + 1) % segments;
          if (I) { if (start) S.quad(O[i][j], I[i][j], I[i][k], O[i][k]); else S.quad(O[i][j], O[i][k], I[i][k], I[i][j]); }
          else if (start) S.tri(path[i], O[i][k], O[i][j]);
          else S.tri(path[i], O[i][j], O[i][k]);
        }
      }
    }
    return S.build({ crease, closed: true });
  }
  // Straight runs through the given points, joined by true circular bends of radius `bend`
  // (shrunk where a run is too short to fit it).
  function route(points, bend = 50) {
    const out = [points[0]], n = points.length;
    for (let i = 1; i < n - 1; i++) {
      const A = points[i - 1], P = points[i], Bq = points[i + 1];
      const d0 = v3.norm(v3.sub(P, A)), d1 = v3.norm(v3.sub(Bq, P));
      const cos = clamp(v3.dot(d0, d1), -1, 1), th = Math.acos(cos);
      if (th < 1e-3) { out.push(P); continue; }
      let R = typeof bend === "function" ? bend(i) : bend;
      const room = Math.min(v3.dist(A, P) * (i === 1 ? 0.95 : 0.5), v3.dist(P, Bq) * (i === n - 2 ? 0.95 : 0.5));
      let t = R * Math.tan(th / 2);
      if (t > room) { t = room; R = t / Math.tan(th / 2); }
      const S0 = v3.sub(P, v3.scale(d0, t)), nIn = v3.norm(v3.sub(d1, v3.scale(d0, cos))), C = v3.add(S0, v3.scale(nIn, R));
      const steps = Math.max(3, Math.ceil(th / (7 * DEG)));
      for (let s = 0; s <= steps; s++) {
        const f = (th * s) / steps;
        out.push(v3.add(C, v3.add(v3.scale(nIn, -R * Math.cos(f)), v3.scale(d0, R * Math.sin(f)))));
      }
    }
    out.push(points[n - 1]);
    return out;
  }
  const pathLength = p => p.reduce((s, q, i) => (i ? s + v3.dist(p[i - 1], q) : 0), 0);
  // Point and tangent at arc length s along a polyline.
  function along(path, s, closed = false) {
    const n = path.length, segs = closed ? n : n - 1;
    let total = 0;
    const L = [];
    for (let i = 0; i < segs; i++) { const l = v3.dist(path[i], path[(i + 1) % n]); L.push(l); total += l; }
    if (closed) s = ((s % total) + total) % total; else s = clamp(s, 0, total);
    for (let i = 0; i < segs; i++) {
      if (s <= L[i] || i === segs - 1) {
        const a = path[i], b = path[(i + 1) % n], t = L[i] ? clamp(s / L[i], 0, 1) : 0;
        return { at: v3.lerp(a, b, t), dir: v3.norm(v3.sub(b, a)) };
      }
      s -= L[i];
    }
    return { at: path[0], dir: [1, 0, 0] };
  }
  // Placement matrix: local origin at p, local +y along dir.
  const aim = (p, dir) => mul(T(p), m4.alignY(dir));

  // ---------- part nodes and assemblies ----------
  const MATERIALS = new Set(["porcelain", "ceramic", "steel", "brushed", "aluminum", "titanium", "copper", "brass", "inconel", "carbon", "rubber", "paint", "glass", "ghost", "hot", "graphite", "paper", "gold"]);
  // Picks a part's material: o.materials[role] wins, o.plain turns every metal to porcelain.
  function matFor(o, role, fallback) {
    const m = (o.materials && o.materials[role]) || fallback;
    if (o.plain && m !== "glass" && m !== "ghost" && !(o.materials && o.materials[role])) return "porcelain";
    return m;
  }
  const NODE_KEYS = new Set(["name", "position", "rotation", "scale", "pivot", "matrix", "material", "color", "opacity", "visible", "cut", "highlight", "pickable"]);
  function nodeOpts(o) { const r = {}; for (const k in o) if (NODE_KEYS.has(k)) r[k] = o[k]; return r; }
  // A group node for a multi-part part (a flange with its bolts, a bearing).
  function group(name, kids = []) {
    const g = E3.node(null, { name });
    for (const [m, o] of kids) if (m) g.add(m, nodeOpts(o));
    return g;
  }

  // An assembly: a group node that knows its named parts, how they come apart, where
  // their labels go, and how its moving parts are driven.
  function assembly(name, o = {}) {
    const root = E3.node(null, { name });
    const parts = {}, notes = {}, labels = [], exploding = [];
    let ex = 0;
    root.parts = parts;
    root.notes = notes;
    root.info = {};
    root.ports = {};
    // Adds a part. opts: node options plus explode [x, y, z] (offset at explode 1, in the
    // parent's frame), label (text, or { text, at } with at in the part's own frame),
    // note (one line for readouts), parent (a node in this assembly).
    root.part = (nameOrMesh, m, opts = {}) => {
      if (typeof nameOrMesh !== "string") { opts = m || {}; m = nameOrMesh; nameOrMesh = opts.name || ""; }
      const parent = opts.parent || root;
      const node = parent.add(m, { ...nodeOpts(opts), name: nameOrMesh });
      if (nameOrMesh && !parts[nameOrMesh]) parts[nameOrMesh] = node;
      if (opts.note && nameOrMesh) notes[nameOrMesh] = opts.note;
      if (opts.explode) { node._ex = opts.explode; node._home = (opts.position || [0, 0, 0]).slice(); exploding.push(node); }
      if (opts.label) {
        const L = typeof opts.label === "string" ? { text: opts.label } : opts.label;
        labels.push({ node, text: L.text, at: L.at || null, color: L.color });
      }
      return node;
    };
    const nodeGroup = root.group.bind(root);
    root.group = (gname, opts = {}) => (typeof gname === "string" ? root.part(gname, null, opts) : nodeGroup(gname));
    // Moves a part's resting place (for parts the pose drives), keeping the explode offset.
    root.home = (node, p) => { node._home = p.slice(); if (!node._ex) node.position = p.slice(); else node.position = v3.add(p, v3.scale(node._ex, ex)); };
    root.homeMatrix = (node, M) => { node._m0 = M; node.matrix = node._ex ? mul(T(v3.scale(node._ex, ex)), M) : M; };
    root.explode = (t = 0) => {
      ex = t;
      for (const n of exploding) {
        const off = v3.scale(n._ex, t);
        if (n._m0) n.matrix = mul(T(off), n._m0);
        else n.position = v3.add(n._home, off);
      }
      return root;
    };
    Object.defineProperty(root, "exploded", { get: () => ex });
    // Label anchors in world coordinates: [{ text, at, color, node }]. Hidden parts are skipped.
    root.labels = () => {
      const out = [];
      for (const L of labels) {
        let vis = true;
        for (let n = L.node; n; n = n.parent) if (!n.visible) { vis = false; break; }
        if (!vis) continue;
        let at = L.at;
        if (!at) {
          const b = L.node.mesh ? L.node.mesh.bounds : null;
          at = b ? b.center : [0, 0, 0];
        }
        out.push({ text: L.text, at: L.node.toWorld(at), color: L.color, node: L.node });
      }
      return out;
    };
    // A port is a circular opening: { center, normal, radius } in world coordinates.
    // root.portLocal(name) gives the same port in the assembly's own frame (for building on it).
    const portData = {};
    const rel = node => { let Mx = m4.identity(); for (let n = node; n && n !== root; n = n.parent) Mx = mul(n.local(), Mx); return Mx; };
    root.portLocal = pname => {
      const d = portData[pname], Mx = rel(d.node);
      return { center: m4.apply(Mx, d.center), normal: v3.norm(m4.applyDir(Mx, d.normal)), radius: d.radius, ...d.extra };
    };
    root.port = (pname, node, center, normal, radius, extra = {}) => {
      portData[pname] = { node, center, normal, radius, extra };
      Object.defineProperty(root.ports, pname, {
        enumerable: true,
        get() {
          const W = node.world();
          return { center: m4.apply(W, center), normal: v3.norm(m4.applyDir(W, normal)), radius: radius * Math.hypot(W[0], W[1], W[2]), ...extra };
        },
      });
      if (!(pname in root)) Object.defineProperty(root, pname, { get: () => root.ports[pname] });
    };
    root.pose = state => { if (root.onPose) root.onPose(state || {}); return root; };
    return root;
  }
  // Highlights the parts named in `names` (or matching a predicate); handy with hover and g.lit.
  function highlight(root, test) {
    const f = typeof test === "function" ? test : n => n && (Array.isArray(test) ? test.includes(n) : n === test);
    root.traverse(n => { if (n !== root) n.highlight = !!f(n.name, n); });
  }

  // ---------- fasteners ----------
  const hexagon = (s, a0 = Math.PI / 6) => circle2(s / Math.sqrt(3), 6, 0, 0, a0);
  // A plate outline (xy, with holes) extruded to thickness t, lying flat: y from y0 to y0 + t.
  function plate(outline, t, { holes = [], bevel = 0, y0 = 0, bevelSegments = 2 } = {}) {
    return xf(mesh.extrude(outline, t, { holes, bevel, bevelSegments }), T([0, y0 + t / 2, 0]), RX(-Math.PI / 2));
  }
  // Hex bolt: the head's bearing face sits at y = 0, head up, shank down to y = -length.
  function bolt(o = {}) {
    const d = o.d ?? o.diameter ?? 10, L = o.length ?? 4 * d, s = o.across ?? 1.6 * d, k = o.head ?? 0.65 * d;
    const seg = o.segments ?? 18;
    const head = plate(hexagon(s), k, { bevel: 0.1 * d, bevelSegments: o.lite ? 1 : 2 });
    const r = d / 2, prof = [[0, 0.3 * k], [r, 0.3 * k]];
    const thread = o.thread ?? true, tl = Math.min(L - 0.5 * d, o.threadLength ?? Math.max(2 * d, L * 0.6));
    const p = o.pitch ?? 0.15 * d;
    if (thread && L > 2 * d) {
      prof.push([r, -(L - tl)]);
      for (let y = -(L - tl); y > -L + 1.5 * p; y -= p) prof.push([r * 0.9, y - p * 0.5], [r, y - p]);
    }
    prof.push([r, -L + 0.12 * d], [r - 0.12 * d, -L], [0, -L]);
    return merge(head, revolve(prof, { segments: seg }));
  }
  // Hex nut sitting on y = 0, up to its height.
  function nut(o = {}) {
    const d = o.d ?? o.diameter ?? 10, s = o.across ?? 1.6 * d, m = o.height ?? 0.8 * d;
    return plate(hexagon(s), m, { holes: [circle2(d * 0.5, o.lite ? 8 : 16)], bevel: 0.1 * d, bevelSegments: o.lite ? 1 : 2 });
  }
  function washer(o = {}) {
    const d = o.d ?? o.diameter ?? 10, t = o.thickness ?? 0.18 * d;
    return revolve([[0.54 * d, 0], [d, 0], [d, t], [0.54 * d, t]], { loop: true, segments: o.segments ?? 24 });
  }
  // n bolts on a circle in the xz plane at height y (heads up), with nuts `grip` below.
  function boltCircle(n, radius, o = {}) {
    const d = o.d ?? 8, grip = o.grip ?? 2 * d, a0 = o.start ?? Math.PI / n;
    const b = bolt({ d, length: o.length ?? grip + d * 1.3, thread: o.thread ?? false, segments: o.segments ?? 10, lite: true });
    const nt = o.nuts === false ? null : xf(nut({ d, lite: true }), T([0, -grip - 0.8 * d, 0]));
    const one = merge(b, nt);
    const out = [];
    for (let i = 0; i < n; i++) { const a = a0 + (i / n) * TAU; out.push(xf(one, T(cyl(radius, a, o.y ?? 0)), RY(a))); }
    return merge(out);
  }

  // ---------- flange ----------
  // Weld-neck flange on a pipe of outer radius `pipe`. The mating face is at y = 0 and
  // the flange runs down the pipe (toward -y). Proportions follow ASME B16.5 class 150.
  function flange(o = {}) {
    const rp = o.pipe ?? o.radius ?? 30, ri = o.bore ?? rp * 0.88;
    const R = o.outer ?? Math.max(rp * 2, rp + 30), t = o.thickness ?? Math.max(6, rp * 0.42);
    const n = o.bolts ?? (rp > 120 ? 16 : rp > 70 ? 12 : 8), rb = o.boltCircle ?? (R + Math.max(rp * 1.15, rp + 6)) / 2;
    const hr = o.hole ?? Math.max(2.5, Math.min((R - rp) * 0.17, (Math.PI * rb) / n * 0.32));
    const holes = [circle2(ri, 32)];
    for (let i = 0; i < n; i++) { const a = Math.PI / n + (i / n) * TAU; holes.push(circle2(hr, 10, rb * Math.cos(a), rb * Math.sin(a))); }
    const body = xf(mesh.extrude(circle2(R, 48), t, { holes, bevel: t * 0.12, bevelSegments: 1 }), T([0, -t / 2, 0]), RX(-Math.PI / 2));
    const neckL = o.neck ?? t * 1.6, rh = Math.max(rp * 1.18, rp + 4);
    const neck = revolve(fillet([[ri, -t + 0.5], [rh, -t + 0.5], [rh, -t - neckL * 0.15, rh * 0.06], [rp, -t - neckL], [ri, -t - neckL]], { steps: 2 }), { loop: true, segments: 32 });
    const face = revolve([[ri, -0.3], [rp * 1.45, -0.3], [rp * 1.45, t * 0.06], [ri, t * 0.06]], { loop: true, segments: 32 });
    const m = merge(body, neck, face);
    m.flange = { radius: R, thickness: t, bolts: n, boltCircle: rb, hole: hr, bore: ri };
    return m;
  }

  // ---------- pipe ----------
  // A pipe through 3D points with true bends, hollow, with a flange and bolts at each end.
  // Returns a group: pipe, flanges, bolts. group.path is the centerline; group.ends the ends.
  function pipe(points, o = {}) {
    const r = o.radius ?? 25, w = o.wall ?? Math.max(1.2, r * 0.12), bend = o.bend ?? r * 3;
    const path = route(points, bend);
    const g = group(o.name ?? "pipe");
    g.add(tubeShell(path, r, r - w, { segments: o.segments ?? 24 }), { name: o.name ?? "pipe", material: o.material ?? "brushed" });
    const n = path.length;
    const ends = [
      { at: path[0], dir: v3.norm(v3.sub(path[0], path[1])) },
      { at: path[n - 1], dir: v3.norm(v3.sub(path[n - 1], path[n - 2])) },
    ];
    const which = o.flanges === false ? [] : o.flanges === "start" ? [0] : o.flanges === "end" ? [1] : [0, 1];
    const fl = [], bl = [];
    for (const e of which) {
      const f = flange({ pipe: r, bore: r - w, ...(o.flange || {}) });
      const M = aim(ends[e].at, ends[e].dir);
      fl.push(mesh.transform(f, M));
      if (o.bolts !== false) {
        const info = f.flange, d = Math.max(3, info.hole * 1.6);
        bl.push(mesh.transform(boltCircle(info.bolts, info.boltCircle, { d, grip: info.thickness * 2, y: info.thickness }), mul(M, RX(Math.PI))));
      }
    }
    if (fl.length) g.add(merge(fl), { name: `${o.name ?? "pipe"} flange`, material: o.flangeMaterial ?? "steel" });
    if (bl.length) g.add(merge(bl), { name: `${o.name ?? "pipe"} bolts`, material: o.boltMaterial ?? "steel" });
    g.path = path;
    g.ends = ends;
    g.length = pathLength(path);
    return g;
  }

  // ---------- small parts ----------
  // L bracket: base plate on y = 0 along +x, upright plate at x = 0, inner fillet, gusset, holes.
  function bracket(o = {}) {
    const w = o.width ?? 60, h = o.height ?? 70, l = o.depth ?? 70, t = o.thickness ?? 6, hr = o.hole ?? Math.max(2.5, w * 0.07);
    const rr = Math.min(w, l) * 0.12;
    const base = xf(mesh.extrude(roundRect2(l, w, rr, 4, l / 2, 0), t, { holes: [circle2(hr, 16, l * 0.68, w * 0.27), circle2(hr, 16, l * 0.68, -w * 0.27)], bevel: t * 0.15 }), T([0, t / 2, 0]), RX(-Math.PI / 2));
    const up = xf(mesh.extrude(roundRect2(w, h, rr, 4, 0, h / 2), t, { holes: [circle2(hr, 16, w * 0.27, h * 0.68), circle2(hr, 16, -w * 0.27, h * 0.68)], bevel: t * 0.15 }), T([t / 2, 0, 0]), RY(Math.PI / 2));
    const rf = t * 1.2;
    const fil = mesh.extrude([[t - 0.3, t - 0.3], [t + rf, t - 0.3], ...arc2(t + rf, t + rf, rf, -Math.PI / 2, -Math.PI, 6).slice(1, -1), [t - 0.3, t + rf]], w * 0.98);
    const parts = [base, up, fil];
    if (o.gusset !== false) parts.push(mesh.extrude([[t - 0.3, t - 0.3], [l * 0.62, t - 0.3], [t - 0.3, h * 0.62]], t * 0.8, { bevel: t * 0.12 }));
    return merge(parts);
  }

  // Ball bearing on y = 0..width: inner ring, outer ring, balls, cage (a group).
  function bearing(o = {}) {
    const ri = o.bore ?? 20, ro = o.outer ?? ri * 1.9, w = o.width ?? (ro - ri) * 0.75;
    const rp = (ri + ro) / 2, rb = o.ball ?? Math.min((ro - ri) * 0.28, w * 0.42), n = o.balls ?? Math.max(7, Math.floor((TAU * rp) / (rb * 2.7)));
    const c = Math.min(w, ro - ri) * 0.07, rho = rb * 1.04, sh = rb * 0.62;
    const dy = Math.sqrt(rho * rho - sh * sh), al = Math.atan2(dy, sh);
    const rIn = rp - sh, rOut = rp + sh;
    const innerP = fillet([[ri, 0, c], [rIn, 0, c * 0.6], [rIn, w / 2 - dy], ...arc2(rp, w / 2, rho, Math.PI + al, Math.PI - al, 10).slice(1, -1), [rIn, w / 2 + dy], [rIn, w, c * 0.6], [ri, w, c]], { closed: true, steps: 3 });
    const outerP = fillet([[rOut, 0, c * 0.6], [ro, 0, c], [ro, w, c], [rOut, w, c * 0.6], [rOut, w / 2 + dy], ...arc2(rp, w / 2, rho, al, -al, 10).slice(1, -1), [rOut, w / 2 - dy]], { closed: true, steps: 3 });
    const ball = mesh.sphere(rb, { segments: o.ballSegments ?? 8 });
    const balls = merge(Array.from({ length: n }, (_, i) => xf(ball, T(cyl(rp, (i / n) * TAU, w / 2)))));
    const cw = rb * 0.22;
    const cage = revolve([[rp - cw, w / 2 - rb * 1.02], [rp + cw, w / 2 - rb * 1.02], [rp + cw, w / 2 - rb * 0.8], [rp - cw, w / 2 - rb * 0.8]], { loop: true, segments: 48 });
    const g = group(o.name ?? "bearing", [
      [revolve(outerP, { loop: true, segments: o.segments ?? 64 }), { name: "outer ring", material: o.material ?? "steel" }],
      [revolve(innerP, { loop: true, segments: o.segments ?? 64 }), { name: "inner ring", material: o.material ?? "steel" }],
      [balls, { name: "balls", material: o.material ?? "steel" }],
      [cage, { name: "cage", material: "brass" }],
    ]);
    g.info = { bore: ri, outer: ro, width: w, balls: n, ball: rb, pitch: rp };
    return g;
  }

  // Stepped shaft along y from y = 0: steps [[length, diameter], ...], chamfered ends,
  // filleted shoulders, optional bore (hollow shafts nest inside each other).
  function shaft(o = {}) {
    const steps = o.steps ?? [[40, 30], [120, 40], [30, 50], [80, 40]];
    const bore = (o.bore ?? 0) / 2, fr = o.fillet ?? 1.5;
    const ch = o.chamfer ?? Math.min(1.5, steps[0][1] * 0.04);
    const r0 = steps[0][1] / 2, pts = [[bore, 0], [r0 - ch, 0], [r0, ch]];
    let y = 0;
    steps.forEach(([len, dia], i) => {
      const r = dia / 2;
      y += len;
      const next = steps[i + 1];
      if (!next) { pts.push([r, y - ch], [r - ch, y], [bore, y]); return; }
      const rn = next[1] / 2;
      if (rn > r + 1e-6) pts.push([r, y, fr], [rn - ch, y], [rn, y + ch]);
      else if (rn < r - 1e-6) pts.push([r, y - ch], [r - ch, y], [rn, y, fr]);
    });
    const m = revolve(fillet(pts, { steps: 3 }), { loop: bore > 0, segments: o.segments ?? 40 });
    m.shaft = { length: y };
    return m;
  }

  // Helical compression spring along y from 0 to length, with closed ends.
  function spring(o = {}) {
    const R = o.radius ?? 15, w = o.wire ?? R * 0.16, L = o.length ?? 60, coils = o.coils ?? 7, closed = o.closedEnds ?? true;
    const pts = [], steps = Math.round(coils * 28);
    const endTurn = closed ? 0.9 : 0, active = coils - 2 * endTurn;
    const free = L - w * (closed ? 2 * endTurn + 1 : 1);
    for (let i = 0; i <= steps; i++) {
      const c = (i / steps) * coils;
      let y;
      if (c < endTurn) y = w / 2 + c * w;
      else if (c > coils - endTurn) y = L - w / 2 - (coils - c) * w;
      else y = w / 2 + endTurn * w + ((c - endTurn) / active) * free;
      pts.push(cyl(R, c * TAU, y));
    }
    return tubeShell(pts, w / 2, 0, { segments: 10, crease: 70 });
  }

  // E3's spur gear (axis y, centered on y = 0), with an optional raised hub.
  function gear(o = {}) {
    const g = mesh.gear(o);
    if (!o.hubRadius) return g;
    const t = o.thickness ?? 2, hl = o.hubLength ?? t * 1.6, bore = o.hole ?? 0;
    const hub = revolve([[bore, -hl / 2], [o.hubRadius, -hl / 2], [o.hubRadius, hl / 2], [bore, hl / 2]], { loop: bore > 0, segments: 40 });
    return merge(g, hub);
  }

  // A strut between two points with rod-end fittings (frames, trusses, links).
  function strut(a, b, o = {}) {
    const r = o.radius ?? 8, L = v3.dist(a, b), e = o.end ?? r * 1.7;
    const body = revolve(fillet([[0, e * 0.8], [r * 0.8, e * 0.8], [r, e * 1.5, r * 0.5], [r, L - e * 1.5, r * 0.5], [r * 0.8, L - e * 0.8], [0, L - e * 0.8]], { steps: 2 }), { segments: 12 });
    const eye = xf(mesh.torus(e * 0.62, e * 0.36, { segments: 14, tube: 6 }), RX(Math.PI / 2));
    return mesh.transform(merge(body, eye, xf(eye, T([0, L, 0]))), aim(a, v3.sub(b, a)));
  }

  // Housing: a hollow rounded box (outer skin and an inner skin), for gearboxes and covers.
  function housing(o = {}) {
    const w = o.width ?? 200, h = o.height ?? 150, d = o.depth ?? 120, t = o.wall ?? 8, r = o.round ?? t * 1.5;
    const outer = mesh.box(w, h, d, { round: r, segments: 3 });
    if (o.solid) return outer;
    const inner = flip(mesh.box(w - 2 * t, h - 2 * t, d - 2 * t, { round: Math.max(0, r - t), segments: 2 }));
    return merge(outer, inner);
  }

  // Coil spring, bellows, and cable bundle helpers ----------
  // Cable harness: a bundle of wires along a smooth path, with ties and end connectors.
  function harness(points, o = {}) {
    const wires = o.wires ?? 7, wr = o.wire ?? 2, ties = o.ties ?? 6;
    const path = E3.smooth(points, { steps: o.steps ?? 10 });
    const { T: Tg, N, B } = frames(path);
    const L = pathLength(path);
    const slots = [[0, 0]];
    for (let k = 0; slots.length < wires; k++) { const ring = 1 + Math.floor(k / 6), a = ((k % 6) / 6) * TAU + ring * 0.3; slots.push([ring * 2.05 * wr, a]); }
    const lay = o.lay ?? 1 / 120;
    let s = 0;
    const S = [0];
    for (let i = 1; i < path.length; i++) S.push((s += v3.dist(path[i - 1], path[i])));
    const wireMeshes = slots.map(([rr, a]) => tubeShell(path.map((p, i) => {
      const ang = a + S[i] * lay * TAU;
      return v3.add(p, v3.add(v3.scale(N[i], rr * Math.cos(ang)), v3.scale(B[i], rr * Math.sin(ang))));
    }), wr, 0, { segments: 8 }));
    const R = (slots.length > 1 ? slots[slots.length - 1][0] : 0) + wr;
    const tieRing = revolve([[R + 0.2, -wr * 0.7], [R + wr * 0.7, -wr * 0.7], [R + wr * 0.7, wr * 0.7], [R + 0.2, wr * 0.7]], { loop: true, segments: 16 });
    const tieM = [];
    for (let k = 1; k <= ties; k++) {
      const { at, dir } = along(path, (L * k) / (ties + 1));
      tieM.push(mesh.transform(tieRing, aim(at, dir)));
    }
    const conn = revolve(fillet([[0, -R * 2.6], [R * 1.5, -R * 2.6], [R * 1.5, -R * 1.2, 0.5], [R * 1.9, -R * 1.2, 0.5], [R * 1.9, 0, 0.5], [R * 1.2, R * 1.4, R * 0.4], [R * 1.05, R * 2.8], [0, R * 2.8]]), { segments: 24 });
    const ends = [
      mesh.transform(conn, aim(path[0], v3.scale(Tg[0], 1))),
      mesh.transform(conn, aim(path[path.length - 1], v3.scale(Tg[path.length - 1], -1))),
    ];
    const g = group(o.name ?? "harness", [
      [merge(wireMeshes), { name: "wires", material: o.material ?? "rubber" }],
      [ties ? merge(tieM) : null, { name: "ties", material: "graphite" }],
      [o.connectors === false ? null : merge(ends), { name: "connectors", material: "brushed" }],
    ]);
    g.path = path;
    return g;
  }

  // ---------- rocket parts ----------
  // Rao's thrust-optimized bell: initial and exit wall angles from his charts for an 80% bell.
  const RAO = { eps: [4, 5, 10, 20, 30, 40, 50, 100], tn: [21.5, 23, 26.3, 28.8, 30, 31, 31.5, 33.5], te: [14, 13, 11, 9, 8.5, 8, 7.5, 7] };
  function raoAngles(eps) {
    const L = Math.log(clamp(eps, 4, 100)), xs = RAO.eps.map(Math.log);
    let i = 0;
    while (i < xs.length - 2 && L > xs[i + 1]) i++;
    const t = (L - xs[i]) / (xs[i + 1] - xs[i]);
    return { thetaN: lerp(RAO.tn[i], RAO.tn[i + 1], t), thetaE: lerp(RAO.te[i], RAO.te[i + 1], t) };
  }
  // Gas-side contour of a bell from the throat (y = 0) down to the exit (y = -length):
  // a 0.382 Rt arc out of the throat, then a parabola (quadratic Bezier) to the exit lip.
  function bellContour(o = {}) {
    const Rt = o.throat ?? 100, eps = o.expansion ?? 16, f = o.lengthFraction ?? 0.8;
    const Re = Math.sqrt(eps) * Rt, R1 = 0.382 * Rt, ang = raoAngles(eps);
    const tn = (o.thetaN ?? ang.thetaN) * DEG, te = (o.thetaE ?? ang.thetaE) * DEG;
    const Ln = (f * (Re - Rt + R1 * (1 / Math.cos(15 * DEG) - 1))) / Math.tan(15 * DEG);
    const pts = [], na = o.arcSteps ?? 8, nb = o.steps ?? 40;
    for (let k = 0; k <= na; k++) { const a = (tn * k) / na; pts.push([R1 * Math.sin(a), Rt + R1 * (1 - Math.cos(a))]); }
    const N = pts[pts.length - 1], E = [Ln, Re], m1 = Math.tan(tn), m2 = Math.tan(te);
    const c1 = N[1] - m1 * N[0], c2 = E[1] - m2 * E[0];
    const Q = [(c2 - c1) / (m1 - m2), (m1 * c2 - m2 * c1) / (m1 - m2)];
    for (let k = 1; k <= nb; k++) {
      const t = k / nb, u = 1 - t;
      pts.push([u * u * N[0] + 2 * u * t * Q[0] + t * t * E[0], u * u * N[1] + 2 * u * t * Q[1] + t * t * E[1]]);
    }
    const points = pts.map(([x, r]) => [r, -x]);
    // Radius at height y (y from 0 down to -length).
    const radiusAt = y => {
      if (y >= 0) return Rt;
      for (let i = 1; i < points.length; i++) if (points[i][1] <= y) { const a = points[i - 1], b = points[i]; return lerp(a[0], b[0], (y - a[1]) / (b[1] - a[1])); }
      return Re;
    };
    return { points, radiusAt, throat: Rt, exit: Re, length: Ln, thetaN: tn / DEG, thetaE: te / DEG, expansion: eps };
  }
  // A ring hugging a revolved surface: inner side follows rAt(y) from y0 to y1, `h` proud of it.
  function collar(rAt, y0, y1, h, { segments = 96, round = 0.3, embed = 0.6, steps = 4 } = {}) {
    const n = Math.max(2, steps), lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    const inner = Array.from({ length: n + 1 }, (_, i) => { const y = lerp(lo, hi, i / n); return [rAt(y) - embed, y]; });
    const top = Math.max(...inner.map(p => p[0])) + embed + h, rr = Math.min(h, hi - lo) * round;
    const prof = fillet([...inner, [top, hi, rr], [top, lo, rr]], { closed: true, steps: 3 });
    return revolve(prof, { loop: true, segments });
  }

  // Bell nozzle with an optional regeneratively cooled tube wall, an inlet manifold where
  // the tubes end, hat-band stiffeners, and an exit lip. Throat at y = 0, exit at y = -length.
  // Returns a group (wall, tubes, manifold, stiffeners, lip) with .contour and .exit.
  function bellNozzle(o = {}) {
    const C = bellContour(o), Rt = C.throat, t = o.wall ?? Math.max(1.5, Rt * 0.05), seg = o.segments ?? 96;
    const inner = C.points;
    const outer = inner.map(([r, y]) => [r + t * (1 + 0.6 * clamp(1 + y / C.length, 0, 1)), y]);
    const rOut = y => { const r = C.radiusAt(y); return r + t * (1 + 0.6 * clamp(1 + y / C.length, 0, 1)); };
    const wallM = revolve([...inner, ...outer.reverse()], { loop: true, segments: o.wallSegments ?? 80 });
    const g = group(o.name ?? "nozzle", [[wallM, { name: "nozzle wall", material: o.material ?? "inconel" }]]);
    const tubes = o.tubes ?? { count: 96, from: 0.05, to: 0.55 };
    let manifoldY = null;
    if (tubes) {
      const N = tubes.count ?? 96, k = 4, cols = N * k, rows = tubes.rows ?? 28;
      const y0 = -C.length * (tubes.from ?? 0.05), y1 = -C.length * (tubes.to ?? 0.55);
      const S = new Soup(), O = [], I = [];
      for (let i = 0; i <= rows; i++) {
        const y = lerp(y0, y1, i / rows), base = rOut(y), rt = (Math.PI * base) / N;
        const ring = [], iring = [];
        for (let j = 0; j < cols; j++) {
          const u = (j % k) / k, h = Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
          ring.push(cyl(base + rt * (0.12 + 0.88 * h), (j / cols) * TAU, y));
        }
        for (let j = 0; j < N; j++) iring.push(cyl(base - 0.4, (j / N) * TAU, y));
        O.push(ring); I.push(iring);
      }
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) { const j1 = (j + 1) % cols; S.quad(O[i][j], O[i][j1], O[i + 1][j1], O[i + 1][j]); }
        for (let j = 0; j < N; j++) { const j1 = (j + 1) % N; S.quad(I[i][j], I[i + 1][j], I[i + 1][j1], I[i][j1]); }
      }
      // End rings: zip the corrugated outer ring to the coarse inner ring.
      for (const [i, sg] of [[0, 1], [rows, -1]]) {
        for (let j = 0; j < N; j++) {
          const j1 = (j + 1) % N;
          for (let q = 0; q < k; q++) {
            const a = O[i][j * k + q], b = O[i][(j * k + q + 1) % cols];
            if (sg > 0) S.tri(I[i][j], b, a); else S.tri(I[i][j], a, b);
          }
          if (sg > 0) S.tri(I[i][j], I[i][j1], O[i][(j1 * k) % cols]); else S.tri(I[i][j], O[i][(j1 * k) % cols], I[i][j1]);
        }
      }
      g.add(S.build({ crease: 50 }), { name: "regen tubes", material: o.tubeMaterial ?? o.material ?? "inconel" });
      manifoldY = y1;
      const mh = Rt * 0.16;
      const man = collar(y => rOut(y) + (Math.PI * rOut(y)) / N, y1 + mh * 0.2, y1 - mh * 1.4, mh, { segments: seg });
      const top = collar(rOut, y0 + Rt * 0.12, y0 - Rt * 0.02, Rt * 0.08, { segments: seg });
      g.add(merge(man, top), { name: "manifold", material: o.manifoldMaterial ?? "steel" });
    }
    const bands = o.stiffeners ?? 2, below = manifoldY ?? -C.length * 0.3, sm = [];
    for (let b = 1; b <= bands; b++) {
      const y = lerp(below, -C.length, b / (bands + 1));
      sm.push(collar(rOut, y + Rt * 0.035, y - Rt * 0.035, Rt * 0.05, { segments: seg }));
    }
    sm.push(collar(rOut, -C.length + Rt * 0.09, -C.length, Rt * 0.06, { segments: seg, embed: 0.3 }));
    g.add(merge(sm), { name: "stiffeners", material: o.material ?? "inconel" });
    g.contour = C;
    g.outerRadiusAt = rOut;
    g.manifoldY = manifoldY;
    g.exit = { center: [0, -C.length, 0], normal: [0, -1, 0], radius: C.exit };
    return g;
  }

  // Combustion chamber from the injector face (top) to the throat (y = 0): cylinder, a
  // 1.5 Rt arc into the throat, a straight convergence, and a bolted flange on top.
  // Chamber length follows L* (characteristic length, mm) when no cylinder length is given.
  function combustionChamber(o = {}) {
    const Rt = o.throat ?? 100, cr = o.contraction ?? 3, Rc = Rt * Math.sqrt(cr), th = (o.convergence ?? 30) * DEG;
    const tw = o.wall ?? Rt * 0.11, Lstar = o.lstar ?? 1000;
    const pts = [];
    for (let k = 0; k <= 8; k++) { const f = (th * k) / 8; pts.push([Rt + 1.5 * Rt * (1 - Math.cos(f)), 1.5 * Rt * Math.sin(f)]); }
    const e = pts[pts.length - 1], yK = e[1] + (Rc - e[0]) / Math.tan(th);
    const At = Math.PI * Rt * Rt, Ac = Math.PI * Rc * Rc, hc = (Rc - Rt) / Math.tan(th);
    const Vconv = (Math.PI / 3) * hc * (Rc * Rc + Rc * Rt + Rt * Rt);
    const Lcyl = o.cylinder ?? Math.max(0.4 * Rc, (Lstar * At - Vconv) / Ac);
    const top = yK + Lcyl;
    const inner = fillet([...pts, [Rc, yK, Rc * 0.7], [Rc, top]], { steps: 8 });
    const outer = inner.map(([r, y]) => [r + tw, y]);
    const fw = o.flangeWidth ?? Rc * 0.32, fh = o.flangeHeight ?? Rt * 0.22;
    const prof = fillet([...inner, [Rc + tw + fw, top, 1.5], [Rc + tw + fw, top - fh, 1.5], [Rc + tw, top - fh * 2.2, fh * 0.6], ...outer.slice(0, -1).reverse().filter(p => p[1] < top - fh * 2.2)], { closed: true, steps: 4 });
    const g = group(o.name ?? "combustion chamber", [[revolve(prof, { loop: true, segments: o.segments ?? 96 }), { name: "chamber", material: o.material ?? "inconel" }]]);
    const nb = o.bolts ?? 24, d = Math.max(4, fh * 0.45);
    g.add(boltCircle(nb, Rc + tw + fw * 0.55, { d, y: top, grip: fh * 2, nuts: false }), { name: "chamber bolts", material: "steel" });
    g.info = { throat: Rt, chamberRadius: Rc, top, cylinder: Lcyl, flangeRadius: Rc + tw + fw, flangeHeight: fh, wall: tw };
    g.radiusAt = y => { for (let i = 1; i < inner.length; i++) if (inner[i][1] >= y) { const a = inner[i - 1], b = inner[i]; return lerp(a[0], b[0], (y - a[1]) / (b[1] - a[1] || 1)) + tw; } return Rc + tw; };
    return g;
  }

  // Injector plate: a disc whose face (y = 0, facing down) carries rings of coaxial
  // elements. The body runs from y = 0 up to the thickness. Returns a group (plate, elements).
  function injectorPlate(o = {}) {
    const Rc = o.radius ?? 170, R = o.outer ?? Rc * 1.4, t = o.thickness ?? Rc * 0.14, pitch = o.pitch ?? Rc * 0.115;
    const rings = o.rings ?? Math.max(2, Math.round(Rc / pitch) - 1), er = o.element ?? pitch * 0.22;
    const body = revolve(fillet([[0, 0], [Rc, 0], [Rc + 2, -1.2], [R, -1.2, 1], [R, t, 1.5], [0, t]], { steps: 3 }), { segments: o.segments ?? 96 });
    const post = revolve([[0, -0.8], [er, -0.8], [er, 1], [0, 1]], { segments: 10 });
    const sleeve = revolve([[er * 1.2, -0.4], [er * 1.6, -0.4], [er * 1.6, 1], [er * 1.2, 1]], { loop: true, segments: 10 });
    const posts = [xf(post, T([0, 0, 0]))], sleeves = o.sleeves ? [xf(sleeve, T([0, 0, 0]))] : [];
    for (let k = 1; k <= rings; k++) {
      const r = (Rc * 0.9 * k) / rings, n = Math.max(6, Math.round((TAU * r) / pitch));
      for (let i = 0; i < n; i++) { const p = cyl(r, (i + (k % 2) * 0.5) / n * TAU, 0); posts.push(xf(post, T(p))); if (o.sleeves) sleeves.push(xf(sleeve, T(p))); }
    }
    const g = group(o.name ?? "injector", [
      [body, { name: "injector plate", material: o.material ?? "copper" }],
      [sleeves.length ? merge(sleeves) : null, { name: "injector elements", material: "steel" }],
      [merge(posts), { name: "orifices", material: "graphite" }],
    ]);
    g.info = { elements: posts.length, radius: Rc, outer: R, thickness: t };
    return g;
  }

  // Centrifugal impeller with backswept vanes on a hub; the back face sits on y = 0 and the
  // eye faces +y. exitAngle is the vane angle from the tangent at the tip (degrees).
  function impeller(o = {}) {
    const R2 = o.radius ?? 80, R1 = o.eye ?? R2 * 0.45, nb = o.vanes ?? 6, b2 = o.width ?? R2 * 0.14;
    const beta = (o.exitAngle ?? 24) * DEG, tb = o.back ?? R2 * 0.07, H = o.length ?? R2 * 0.62, Rn = R1 * 0.42, tv = o.vane ?? R2 * 0.045;
    const hubY = r => tb + H * Math.pow(clamp((R2 - r) / (R2 - Rn), 0, 1), 2.2);
    const prof = [[0, 0], [R2 - 1, 0], [R2, 1], [R2, tb]];
    for (let i = 1; i <= 16; i++) { const r = lerp(R2, Rn, i / 16); prof.push([r, hubY(r)]); }
    prof.push(...arc2(0, hubY(Rn), Rn, 0, Math.PI / 2, 6).slice(1));
    const hub = revolve(prof, { segments: o.segments ?? 64 });
    const S = new Soup(), st = 18, r0 = R1 * 0.92;
    const tipH = r => lerp(R1 * 0.95, b2, Math.pow((r - r0) / (R2 - r0), 0.7));
    const vane = (phase, rs) => {
      const rings = [];
      for (let i = 0; i <= st; i++) {
        const r = lerp(rs, R2, i / st), phi = phase - Math.log(r / R1) / Math.tan(beta) * (o.sweep ?? 1);
        const da = tv / 2 / r, yh = hubY(r) - 1.5, yt = hubY(r) + tipH(r);
        rings.push([cyl(r, phi - da, yh), cyl(r, phi + da, yh), cyl(r, phi + da, yt), cyl(r, phi - da, yt)]);
      }
      for (let i = 0; i < st; i++) for (let q = 0; q < 4; q++) { const q1 = (q + 1) % 4; S.quad(rings[i][q], rings[i + 1][q], rings[i + 1][q1], rings[i][q1]); }
      S.quad(rings[0][0], rings[0][1], rings[0][2], rings[0][3]);
      S.quad(rings[st][3], rings[st][2], rings[st][1], rings[st][0]);
    };
    for (let k = 0; k < nb; k++) {
      vane((k / nb) * TAU, r0);
      if (o.splitters !== false) vane(((k + 0.5) / nb) * TAU, (R1 + R2) / 2);
    }
    const m = merge(hub, S.build({ crease: 40 }));
    m.impeller = { radius: R2, eye: R1, vanes: nb, height: hubY(Rn) + Rn, tipWidth: b2, hubY, tipY: r => hubY(r) + tipH(clamp(r, r0, R2)), back: tb };
    return m;
  }

  // Volute (spiral casing) around an impeller of radius `radius`, centered on y, discharging
  // along -z from the +x side. Section area grows linearly with angle. Hollow.
  function volute(o = {}) {
    const R2 = o.radius ?? 80, R3 = o.base ?? R2 * 1.12, r0 = o.start ?? R2 * 0.12, r1 = o.end ?? R2 * 0.4, yc = o.y ?? 0, t = o.wall ?? R2 * 0.05;
    const Ld = o.discharge ?? R2 * 1.6, path = [], rs = [], n = 64;
    for (let i = 0; i <= n; i++) {
      const a = 0.35 + ((TAU - 0.35) * i) / n, r = Math.sqrt(lerp(r0 * r0, r1 * r1, (a - 0.35) / (TAU - 0.35)));
      path.push(cyl(R3 + r * 0.75, a, yc)); rs.push(r);
    }
    const end = path[path.length - 1];
    for (let i = 1; i <= 8; i++) { path.push(v3.add(end, [0, 0, (-Ld * i) / 8])); rs.push(r1 * (1 + 0.18 * (i / 8))); }
    const N = path.length - 1, rr = t2 => { const f = t2 * N, i = Math.min(N - 1, Math.floor(f)); return lerp(rs[i], rs[i + 1], f - i); };
    const m = tubeShell(path, rr, t2 => rr(t2) - t, { segments: o.segments ?? 22 });
    m.volute = { exit: { center: path[N], normal: [0, 0, -1], radius: rs[N] }, outer: R3 + r1 * 1.75 };
    return m;
  }

  // Gimbal: a universal joint. upper yoke (fixed), cross (turns for pitch about x), lower
  // yoke (turns for yaw about z, carries the engine). Pivot at the origin.
  function gimbal(o = {}) {
    const s = o.size ?? 50, t = s * 0.28;
    const ear = (w, h, hole) => mesh.extrude([...arc2(0, 0, w / 2, Math.PI, TAU, 10), [w / 2, h], [-w / 2, h]], t, { holes: [circle2(hole, 20)], bevel: t * 0.15 });
    const up = xf(ear(s * 1.15, s * 1.5, s * 0.34), RX(Math.PI));
    const upper = merge(
      revolve(fillet([[0, s * 1.3], [s * 1.7, s * 1.3, s * 0.1], [s * 1.7, s * 1.75, s * 0.12], [0, s * 1.75]]), { segments: 48 }),
      xf(up, T([s * 1.15, 0, 0]), RY(Math.PI / 2)), xf(up, T([-s * 1.15, 0, 0]), RY(Math.PI / 2)),
    );
    const low = ear(s * 1.15, s * 1.5, s * 0.34);
    const lower = merge(
      revolve(fillet([[0, -s * 1.75], [s * 1.7, -s * 1.75, s * 0.12], [s * 1.7, -s * 1.3, s * 0.1], [0, -s * 1.3]]), { segments: 48 }),
      xf(low, T([0, 0, s * 1.15]), RX(Math.PI)), xf(low, T([0, 0, -s * 1.15]), RX(Math.PI)),
    );
    const pin = mesh.cylinder(s * 0.32, s * 3.1, { segments: 24 });
    const cross = merge(mesh.box(s * 1.25, s * 1.25, s * 1.25, { round: s * 0.18 }), xf(pin, RZ(Math.PI / 2)), xf(pin, RX(Math.PI / 2)));
    const g = E3.node(null, { name: o.name ?? "gimbal" });
    g.add(upper, { name: "gimbal upper yoke", material: o.material ?? "steel" });
    const c = g.add(cross, { name: "gimbal cross", material: o.material ?? "steel" });
    const l = c.add(lower, { name: "gimbal lower yoke", material: o.material ?? "steel" });
    g.cross = c; g.lower = l;
    g.set2 = (pitch = 0, yaw = 0) => { c.rotation = [pitch, 0, 0]; l.rotation = [0, 0, yaw]; return g; };
    g.info = { size: s, top: s * 1.75, bottom: -s * 1.75 };
    return g;
  }

  // Linear actuator (hydraulic or electromechanical): barrel, rod, clevis eyes.
  // span(a, b) stretches it between two points in its parent's frame.
  function actuator(o = {}) {
    const bore = o.bore ?? 30, Lc = o.length ?? 320, stroke = o.stroke ?? Math.min(110, Lc * 0.4);
    const Lb = Lc * 0.72, Lr = stroke + Lc * 0.32, e = bore * 0.42;
    const eye = merge(xf(mesh.torus(e * 0.75, e * 0.32, { segments: 24, tube: 10 }), RX(Math.PI / 2)), xf(mesh.cylinder(e * 0.45, e * 0.9, { segments: 16 }), RX(Math.PI / 2)));
    const rb = bore * 0.62;
    const barrel = merge(
      revolve(fillet([[0, e * 0.9], [rb * 0.7, e * 0.9], [rb * 0.78, e * 1.6, 2], [rb, e * 1.7, 2], [rb, Lb * 0.94, 3], [rb * 0.92, Lb, 2], [bore * 0.36, Lb + 2], [0, Lb + 2]]), { segments: 32 }),
      revolve([[rb - 0.5, Lb * 0.3], [rb + bore * 0.08, Lb * 0.3], [rb + bore * 0.08, Lb * 0.36], [rb - 0.5, Lb * 0.36]], { loop: true, segments: 32 }),
      xf(mesh.cylinder(bore * 0.12, bore * 0.4, { segments: 12 }), T([rb + bore * 0.15, Lb * 0.75, 0]), RZ(Math.PI / 2)),
      eye,
    );
    const rod = merge(revolve([[0, 0], [bore * 0.24, 0], [bore * 0.24, Lr - e * 1.4], [bore * 0.33, Lr - e * 1.1], [bore * 0.33, Lr - e * 0.8], [0, Lr - e * 0.8]], { segments: 24 }), xf(eye, T([0, Lr, 0])));
    const g = E3.node(null, { name: o.name ?? "actuator" });
    const bN = g.add(barrel, { name: `${o.name ?? "actuator"} barrel`, material: o.material ?? "steel" });
    const rN = g.add(rod, { name: `${o.name ?? "actuator"} rod`, material: o.rodMaterial ?? "brushed" });
    g.barrel = bN; g.rod = rN;
    g.span = (a, b) => {
      const d = v3.dist(a, b);
      g.matrix = aim(a, v3.sub(b, a));
      rN.position = [0, d - Lr, 0];
      g.extension = (d - Lc) / stroke;
      return g;
    };
    g.span([0, 0, 0], [0, Lc, 0]);
    g.info = { length: Lc, stroke, bore };
    return g;
  }

  // Propellant tank: cylinder with elliptical domes (dome height = ratio x radius), as a
  // hollow shell, with weld lands and ports. Centered on y = 0.
  function tank(o = {}) {
    const R = o.radius ?? 400, L = o.length ?? 800, k = o.dome ?? 1 / Math.SQRT2, t = o.wall ?? Math.max(2, R * 0.012), seg = o.segments ?? 72;
    const shell = (Rr, kk) => {
      const pts = [];
      for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * (i / 16); pts.push([Rr * Math.cos(a), -L / 2 + kk * Math.sin(a)]); }
      for (let i = 0; i <= 16; i++) { const a = (Math.PI / 2) * (i / 16); pts.push([Rr * Math.cos(a), L / 2 + kk * Math.sin(a)]); }
      return pts;
    };
    const out = shell(R, k * R), inn = shell(R - t, k * R - t).reverse();
    const body = revolve([...out, ...inn], { loop: true, segments: seg });
    const land = y => revolve(fillet([[R - 1, y - t * 4], [R + t * 0.8, y - t * 3, t * 0.8], [R + t * 0.8, y + t * 3, t * 0.8], [R - 1, y + t * 4]]), { loop: true, segments: seg });
    const rp = o.port ?? R * 0.12, top = L / 2 + k * R, bot = -L / 2 - k * R;
    const boss = y => revolve(fillet([[0, y - rp * 0.6 * Math.sign(y)], [rp * 1.6, y - rp * 0.3 * Math.sign(y), rp * 0.2], [rp * 1.6, y + rp * 0.25 * Math.sign(y)], [0, y + rp * 0.25 * Math.sign(y)]]), { loop: false, segments: 32 });
    const g = group(o.name ?? "tank", [
      [body, { name: "tank", material: o.material ?? "aluminum" }],
      [merge(land(-L / 2), land(L / 2), ...(o.rings ? Array.from({ length: o.rings }, (_, i) => land(lerp(-L / 2, L / 2, (i + 1) / (o.rings + 1)))) : [])), { name: "weld lands", material: o.material ?? "aluminum" }],
      [merge(boss(top), boss(bot)), { name: "ports", material: "steel" }],
    ]);
    g.info = { radius: R, length: L, height: L + 2 * k * R, volume: Math.PI * R * R * L + (4 / 3) * Math.PI * R * R * k * R };
    g.ports = { top: { center: [0, top + rp * 0.25, 0], normal: [0, 1, 0], radius: rp }, bottom: { center: [0, bot - rp * 0.25, 0], normal: [0, -1, 0], radius: rp } };
    return g;
  }

  // ---------- turbomachinery parts ----------
  // NACA 4-digit section (m camber, p camber position, t thickness, all fractions of chord),
  // closed trailing edge, cosine spacing: a loop of 2n points, TE -> upper -> LE -> lower.
  function nacaMPT(m, p, t, n = 16) {
    const f = x => {
      const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
      let yc = 0, dy = 0;
      if (m > 0 && p > 0) {
        if (x < p) { yc = (m / (p * p)) * (2 * p * x - x * x); dy = ((2 * m) / (p * p)) * (p - x); }
        else { yc = (m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x * x); dy = ((2 * m) / (1 - p) ** 2) * (p - x); }
      }
      const th = Math.atan(dy);
      return { xu: x - yt * Math.sin(th), yu: yc + yt * Math.cos(th), xl: x + yt * Math.sin(th), yl: yc - yt * Math.cos(th) };
    };
    const P = Array.from({ length: n + 1 }, (_, i) => f((1 - Math.cos((Math.PI * i) / n)) / 2));
    const pts = [];
    for (let i = n; i >= 0; i--) pts.push([P[i].xu, P[i].yu]);
    for (let i = 1; i < n; i++) pts.push([P[i].xl, P[i].yl]);
    return pts;
  }
  function naca(code = "2412", n = 16) {
    const s = String(code).padStart(4, "0");
    return nacaMPT(+s[0] / 100, +s[1] / 10, +s.slice(2) / 100, n);
  }
  // A value that varies along the span: a number, [root, ..., tip] (piecewise linear), or s => value.
  const spanVal = (v, s) => {
    if (typeof v === "function") return v(s);
    if (!Array.isArray(v)) return v;
    if (v.length === 1) return v[0];
    const f = clamp(s, 0, 1) * (v.length - 1), i = Math.min(v.length - 2, Math.floor(f));
    return lerp(v[i], v[i + 1], f - i);
  };
  const centroid = pts => v3.scale(pts.reduce((a, p) => v3.add(a, p), [0, 0, 0]), 1 / pts.length);
  // Lofts NACA sections into a closed blade. sec(s) -> { m, p, t, chord, angle, dx, dz, pivot };
  // map(X, s, Z) places a section point: X chordwise (axial), Z across, s the span fraction.
  function loft(sec, map, { stations = 9, n = 14, hand = 1 } = {}) {
    const rings = [], flat = [];
    for (let k = 0; k < stations; k++) {
      const s = k / (stations - 1), q = sec(s), ca = Math.cos(q.angle), sa = Math.sin(q.angle);
      const loop = nacaMPT(q.m, q.p ?? 0.4, q.t, n).map(([x, y]) => {
        const xx = (x - (q.pivot ?? 0.4)) * q.chord, yy = y * q.chord;
        return [xx * ca - yy * sa + (q.dx || 0), hand * (-xx * sa - yy * ca) + (q.dz || 0)];
      });
      flat.push(loop);
      rings.push(loop.map(([X, Z]) => map(X, s, Z)));
    }
    const m = rings[0].length, S = new Soup();
    for (let k = 0; k < stations - 1; k++) for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      S.quad(rings[k][j], rings[k][j1], rings[k + 1][j1], rings[k + 1][j]);
    }
    // Caps must run their edges against the sides': backward along the root ring, forward
    // along the tip ring. E3.triangulate returns counterclockwise triangles, so check the
    // section's own winding to know which way they run. build() then turns the whole
    // closed blade outward.
    for (const [k, forward] of [[0, false], [stations - 1, true]]) {
      const s = k / (stations - 1), ccw = area2(flat[k]) > 0, fn = ([X, Z]) => map(X, s, Z);
      for (const [p, q, r] of E3.triangulate(flat[k])) {
        if (ccw === forward) S.tri(fn(p), fn(q), fn(r)); else S.tri(fn(p), fn(r), fn(q));
      }
    }
    return S.build({ crease: 45, closed: true });
  }

  // A single blade standing on y = 0 (span up +y, chord along x). twist is the section
  // angle from the x axis at root and tip (degrees); thickness and camber are fractions of chord.
  function blade(o = {}) {
    const span = o.span ?? 200, chord = o.chord ?? [80, 50], twist = o.twist ?? [10, 40];
    const thick = o.thickness ?? (o.airfoil ? null : [0.12, 0.06]), camber = o.camber ?? [0.04, 0.02];
    const codes = o.airfoil ? (Array.isArray(o.airfoil) ? o.airfoil : [o.airfoil, o.airfoil]) : null;
    const dig = (c, i) => { const s = String(c).padStart(4, "0"); return [+s[0] / 100, +s[1] / 10, +s.slice(2) / 100][i]; };
    const sec = s => ({
      m: codes ? lerp(dig(codes[0], 0), dig(codes[codes.length - 1], 0), s) : spanVal(camber, s),
      p: codes ? lerp(dig(codes[0], 1), dig(codes[codes.length - 1], 1), s) || 0.4 : 0.4,
      t: codes ? lerp(dig(codes[0], 2), dig(codes[codes.length - 1], 2), s) : spanVal(thick, s),
      chord: spanVal(chord, s), angle: spanVal(twist, s) * DEG, dx: spanVal(o.sweep ?? 0, s), dz: spanVal(o.lean ?? 0, s), pivot: o.pivot ?? 0.4,
    });
    const m = loft(sec, (X, s, Z) => [X, s * span, Z], { stations: o.stations ?? 9, n: o.points ?? 16, hand: o.hand ?? 1 });
    m.blade = { span };
    return m;
  }

  // n blades around the y axis between hub and tip radii, stacked at y = o.y. Blades follow
  // the hub and casing (hubSlope, tipSlope = dr/dy) and twist from root to tip. Returns a
  // group: blades, disk (optional), shroud (optional).
  function rotorStage(o = {}) {
    const n = o.blades ?? 24, hub = o.hub ?? 100, tip = o.tip ?? 200, y0 = o.y ?? 0, h = tip - hub;
    const embed = o.embed ?? Math.max(0.6, h * 0.05), hs = o.hubSlope ?? 0, ts = o.tipSlope ?? 0;
    const sec = s => ({
      m: spanVal(o.camber ?? [0.05, 0.03], s), p: 0.45, t: spanVal(o.thickness ?? [0.1, 0.05], s),
      chord: spanVal(o.chord ?? [h * 0.6, h * 0.5], s), angle: spanVal(o.stagger ?? o.twist ?? [30, 55], s) * DEG,
      dx: spanVal(o.sweep ?? 0, s), dz: spanVal(o.lean ?? 0, s), pivot: o.pivot ?? 0.45,
    });
    const map = (X, s, Z) => {
      const R = lerp(hub + hs * X - embed, tip + ts * X - (o.clearance ?? 0), s);
      return cyl(R, Z / R, y0 + X);
    };
    const one = loft(sec, map, { stations: o.stations ?? 3, n: o.points ?? 6, hand: o.hand ?? 1 });
    const a0 = o.phase ?? 0;
    const g = E3.node(null, { name: o.name ?? "rotor" });
    g.add(merge(Array.from({ length: n }, (_, k) => xf(one, RY(a0 + (k / n) * TAU)))), { name: o.bladeName ?? `${o.name ?? "rotor"} blades`, material: o.material ?? "titanium" });
    const cx = spanVal(o.chord ?? [h * 0.6, h * 0.5], 0) * 0.55;
    if (o.disk !== false) {
      const w = o.diskWidth ?? cx * 1.3, bore = o.bore ?? hub * 0.35, rim = hub - Math.max(1, h * 0.03);
      const prof = fillet([[bore, y0 - w * 0.45], [bore + w * 0.3, y0 - w * 0.45, w * 0.1], [lerp(bore, rim, 0.45), y0 - w * 0.14, w * 0.25], [rim * 0.86, y0 - w * 0.14, w * 0.2], [rim * 0.86, y0 - w * 0.5, w * 0.05], [rim, y0 - w * 0.5, w * 0.05], [rim, y0 + w * 0.5, w * 0.05], [rim * 0.86, y0 + w * 0.5, w * 0.05], [rim * 0.86, y0 + w * 0.14, w * 0.2], [lerp(bore, rim, 0.45), y0 + w * 0.14, w * 0.25], [bore + w * 0.3, y0 + w * 0.45, w * 0.1], [bore, y0 + w * 0.45]], { closed: true, steps: 3 });
      g.add(revolve(prof, { loop: true, segments: o.segments ?? 64 }), { name: `${o.name ?? "rotor"} disk`, material: o.diskMaterial ?? o.material ?? "titanium" });
    }
    if (o.shroud) {
      const w = cx * 1.6, t = Math.max(1, h * 0.06);
      g.add(revolve([[tip - t * 0.6, y0 - w / 2], [tip + t * 0.4, y0 - w / 2], [tip + t * 0.4 + ts * w, y0 + w / 2], [tip - t * 0.6 + ts * w, y0 + w / 2]], { loop: true, segments: o.segments ?? 96 }), { name: `${o.name ?? "rotor"} shroud`, material: o.material ?? "inconel" });
    }
    g.info = { blades: n, hub, tip, y: y0 };
    return g;
  }

  // Stator stage: vanes between an inner and an outer band (y = o.y).
  function statorStage(o = {}) {
    const n = o.vanes ?? 30, inner = o.inner ?? 100, outer = o.outer ?? 200, y0 = o.y ?? 0, h = outer - inner;
    const chord = o.chord ?? h * 0.55, emb = Math.max(0.8, h * 0.06), is = o.innerSlope ?? 0, os = o.outerSlope ?? 0;
    const sec = s => ({ m: spanVal(o.camber ?? 0.05, s), p: 0.4, t: spanVal(o.thickness ?? 0.08, s), chord: spanVal(chord, s), angle: spanVal(o.stagger ?? -20, s) * DEG, dx: 0, dz: 0, pivot: 0.5 });
    const map = (X, s, Z) => { const R = lerp(inner + is * X - emb, outer + os * X + emb, s); return cyl(R, Z / R, y0 + X); };
    const one = loft(sec, map, { stations: o.stations ?? 2, n: o.points ?? 6, hand: o.hand ?? -1 });
    const g = E3.node(null, { name: o.name ?? "stator" });
    g.add(merge(Array.from({ length: n }, (_, k) => xf(one, RY((o.phase ?? 0) + (k / n) * TAU)))), { name: o.vaneName ?? `${o.name ?? "stator"} vanes`, material: o.material ?? "titanium" });
    const cw = spanVal(chord, 0.5) * 0.62, t = Math.max(1, h * 0.05);
    const band = (r, sl, sgn) => {
      const at = y => r + sl * (y - y0);
      return revolve([[at(y0 - cw), y0 - cw], [at(y0 - cw) + sgn * t, y0 - cw], [at(y0 + cw) + sgn * t, y0 + cw], [at(y0 + cw), y0 + cw]], { loop: true, segments: o.segments ?? 96 });
    };
    if (o.bands !== false) g.add(merge(band(inner, is, -1), o.outerBand === false ? null : band(outer, os, 1)), { name: `${o.name ?? "stator"} bands`, material: o.bandMaterial ?? o.material ?? "titanium" });
    g.info = { vanes: n, inner, outer, y: y0 };
    return g;
  }

  // Spinner (nose cone) with its tip at y = 0 and its base (radius R) at y = length.
  function spinner(o = {}) {
    const R = o.radius ?? 250, L = o.length ?? R * 1.35, shape = o.shape ?? "ogive", n = 28, pts = [[0, 0]];
    const rho = (R * R + L * L) / (2 * R);
    for (let i = 1; i <= n; i++) {
      const y = (L * i) / n;
      let r;
      if (shape === "cone") r = R * Math.min(1, (y / L) * 1.04);
      else if (shape === "ellipse") r = R * Math.sqrt(1 - (1 - y / L) ** 2);
      else r = Math.sqrt(Math.max(0, rho * rho - (L - y) ** 2)) + R - rho;
      pts.push([r, y]);
    }
    const back = o.back ?? R * 0.12;
    pts.push([R, L + back], [R * 0.6, L + back], [0, L + back]);
    const m = revolve(pts, { segments: o.segments ?? 64 });
    m.spinner = { radius: R, length: L };
    return m;
  }

  // Nacelle as a revolved wall: inlet lip, diffuser to the fan case, a pocket the fan case
  // fills, the bypass duct, and a boat tail to the fan nozzle. Fan face at y = 0, flow +y.
  // arc/start leave a wedge open (a cutaway).
  function nacelleProfile(o = {}) {
    const Rf = o.fan ?? 900, Rc = o.caseInner ?? Rf * 1.006, Rco = o.caseOuter ?? Rf * 1.075;
    const yH = o.inlet ?? -Rf * 0.86, Rh = o.highlight ?? Rf * 1.045, Rth = o.throat ?? Rf * 0.965;
    const Rmax = o.max ?? Rf * 1.18, yMax = o.maxAt ?? yH + Rf * 0.62, yE = o.exit ?? Rf * 1.75, RE = o.exitRadius ?? Rf * 0.9;
    const yCF = o.caseFront ?? -Rf * 0.32, yCR = o.caseRear ?? Rf * 0.52, ductR = o.duct ?? Rf * 0.985, te = o.trailing ?? Rf * 0.006;
    const ai = o.lipLength ?? Rf * 0.13, bi = Rh - Rth, k = o.forebody ?? 2.3;
    const outer = [];
    for (let i = 0; i <= 28; i++) { const u = i / 28; outer.push([Rh + (Rmax - Rh) * Math.pow(1 - Math.pow(1 - u, k), 1 / k), yH + (yMax - yH) * u]); }
    for (let i = 1; i <= 28; i++) { const u = i / 28; outer.push([Rmax - (Rmax - RE) * Math.pow(u, 1.7), yMax + (yE - yMax) * u]); }
    const inner = [];
    for (let i = 1; i <= 10; i++) { const a = Math.PI + (Math.PI / 2) * (i / 10); inner.push([Rh + bi * Math.sin(a), yH + ai + ai * Math.cos(a)]); }
    const yT = yH + ai;
    for (let i = 1; i <= 14; i++) { const u = i / 14; inner.push([Rth + ((Rc - Rth) * (1 - Math.cos(Math.PI * u))) / 2, yT + (yCF - yT) * u]); }
    inner.push([Rco, yCF], [Rco, yCR], [ductR, yCR]);
    for (let i = 1; i <= 20; i++) { const u = i / 20; inner.push([ductR - (ductR - (RE - te)) * Math.pow(u, 1.8), yCR + (yE - te * 3 - yCR) * u]); }
    const loop = [...outer, ...inner.reverse()];
    return { loop, Rf, Rc, Rco, yCF, yCR, ductR, yE, RE, te, yH, Rh, Rmax };
  }
  function nacelle(o = {}) {
    const P = nacelleProfile(o);
    const m = revolve(P.loop, { loop: true, segments: o.segments ?? 128, arc: o.arc ?? TAU, start: o.start ?? 0 });
    m.nacelle = P;
    return m;
  }

  // ---------- plumbing extras ----------
  // Bellows (flex joint) along y from 0 to length: a convoluted tube with plain cuffs.
  function bellows(o = {}) {
    const r = o.radius ?? 25, L = o.length ?? 60, n = o.convolutions ?? 8, h = o.depth ?? r * 0.18, t = o.wall ?? Math.max(0.8, r * 0.05);
    const cuff = L * 0.14, pts = [[r, 0], [r, cuff]];
    for (let i = 0; i <= n * 6; i++) { const u = i / (n * 6), y = cuff + u * (L - 2 * cuff); pts.push([r + h * 0.5 * (1 - Math.cos(u * n * TAU)), y]); }
    pts.push([r, L]);
    const inner = pts.map(([rr, y]) => [rr - t, y]).reverse();
    return revolve([...pts, ...inner], { loop: true, segments: o.segments ?? 32, crease: 70 });
  }
  // Inline ball valve on a pipe of radius `pipe`, flow along y, centered on y = 0, with its
  // actuator on +x. Returns a group: valve body, valve actuator.
  function valve(o = {}) {
    const rp = o.pipe ?? 25, L = o.length ?? rp * 4.2, rb = rp * 1.55;
    const body = revolve(fillet([[rp * 0.88, -L / 2], [rp * 1.25, -L / 2], [rp * 1.25, -L * 0.36, 2], [rb, -L * 0.2, rp * 0.4], [rb, L * 0.2, rp * 0.4], [rp * 1.25, L * 0.36, 2], [rp * 1.25, L / 2], [rp * 0.88, L / 2]]), { loop: true, segments: 40 });
    const fl = flange({ pipe: rp * 1.25, bore: rp * 0.88 });
    const bonnet = xf(revolve(fillet([[0, rb * 0.6], [rp * 0.5, rb * 0.6], [rp * 0.5, rb * 1.25, 2], [rp * 0.8, rb * 1.3, 2], [rp * 0.8, rb * 1.45], [0, rb * 1.45]]), { segments: 24 }), RZ(-Math.PI / 2));
    const act = xf(mesh.box(rp * 1.4, rp * 2.2, rp * 1.8, { round: rp * 0.25 }), T([rb * 1.45 + rp * 0.7, 0, 0]));
    const g = group(o.name ?? "valve", [
      [merge(body, xf(fl, T([0, L / 2, 0])), xf(fl, T([0, -L / 2, 0]), RX(Math.PI)), bonnet), { name: o.name ?? "valve", material: o.material ?? "steel" }],
      [act, { name: `${o.name ?? "valve"} actuator`, material: o.actuatorMaterial ?? "porcelain" }],
    ]);
    g.info = { length: L };
    return g;
  }

  // ---------- turbopump ----------
  // Impeller, casing (front cover, back plate, inlet neck) and volute for a centrifugal
  // pump, impeller axis y, back face on y = 0. Shared by turbopump() and pump().
  function pumpCasing(o = {}) {
    const R2 = o.radius ?? 75;
    const imp = impeller({ radius: R2, vanes: o.vanes ?? 6, exitAngle: o.exitAngle ?? 24 }), I = imp.impeller;
    const c = R2 * 0.04, tc = R2 * 0.075, Ri = I.eye * 1.08, R3 = R2 * 1.12, r0 = R2 * 0.12, rs = R2 * 0.2, tb2 = R2 * 0.12;
    const yTip = r => I.tipY(Math.min(r, R2));
    const yIn = I.height + R2 * (o.neck ?? 0.5);
    const shIn = [], shOut = [];
    for (let i = 0; i <= 12; i++) { const r = lerp(Ri, R2 + c, i / 12); shIn.push([r, yTip(r) + c]); }
    for (let i = 0; i <= 12; i++) { const r = lerp(R2 + c, Ri + tc, i / 12); shOut.push([r, yTip(r) + c + tc]); }
    const casing = revolve(fillet([[Ri, yIn], ...shIn, [R3, yTip(R2) + c, 2], [R3, -c, 2], [rs, -c], [rs, -c - tb2], [R3 + r0 * 0.6, -c - tb2, 3], [R3 + r0 * 0.6, yTip(R2) + c + tc, 4], ...shOut, [Ri + tc, yIn]], { closed: true, steps: 3 }), { loop: true, segments: 72 });
    const yc = (I.back + yTip(R2)) / 2;
    const vol = volute({ radius: R2, base: R3, y: yc, start: r0, end: R2 * 0.36, wall: tc * 0.8, discharge: o.discharge });
    const ex = vol.volute.exit;
    const inFl = flange({ pipe: Ri + tc, bore: Ri });
    const disFl = flange({ pipe: ex.radius, bore: ex.radius - tc * 0.8 });
    return { imp, I, c, tc, Ri, R3, yIn, yc, casing, vol, ex, inFl, disFl, tb2 };
  }

  // A turbine-driven centrifugal pump on one shaft: axial inlet on top, impeller and volute,
  // bearing housing, turbine below with its hot-gas manifold and exhaust. Origin: the
  // impeller's back face. pose({ spin }) turns the rotor (impeller, shaft, turbine).
  function turbopump(o = {}) {
    const R2 = o.impeller ?? 75, A = assembly(o.name ?? "turbopump", o), M = (r, f) => matFor(o, r, f);
    const CP = pumpCasing({ radius: R2, vanes: o.vanes ?? 6, exitAngle: o.exitAngle ?? 24 });
    const { imp, I, c, tc, Ri, yIn, casing, vol, ex, inFl, disFl, tb2 } = CP;
    const hx = [2.6 * R2, 0, 0];
    A.part("pump housing", merge(casing, vol), { material: M("housing", "aluminum"), explode: [0, 2.6 * R2, 0], label: { text: "volute", at: v3.add(ex.center, [0, 0, R2 * 0.5]) }, note: "the spiral casing slows the flow leaving the impeller and turns speed into pressure" });
    A.part("pump flanges", merge(xf(inFl, T([0, yIn, 0])), mesh.transform(disFl, aim(ex.center, ex.normal))), { material: M("flange", "steel"), explode: [0, 2.6 * R2, 0] });
    const rotor = A.group("rotor");
    A.rotor = rotor;
    A.part("impeller", imp, { parent: rotor, material: M("impeller", "aluminum"), explode: [0, 1.4 * R2, 0], label: { text: "impeller", at: [R2 * 0.8, I.tipY(R2 * 0.8), 0] }, note: "backswept vanes fling the propellant outward and raise its pressure" });
    const yT = -2.35 * R2, yB = yT - 0.28 * R2, yTop = I.height * 0.55, Ls = yTop - yB;
    const sh = shaft({ steps: [[0.32 * R2, 0.26 * R2], [0.32 * R2, 0.36 * R2], [Ls - 1.6 * R2, 0.32 * R2], [0.32 * R2, 0.36 * R2], [0.64 * R2, 0.26 * R2]], segments: 24 });
    A.part("shaft", xf(sh, T([0, yB, 0])), { parent: rotor, material: M("shaft", "steel"), label: { text: "shaft", at: [0, yT + R2 * 0.9, 0] }, note: "one shaft carries the turbine and the impeller, so they turn together" });
    const br = { bore: 0.18 * R2, outer: 0.34 * R2, width: 0.26 * R2 };
    const yb1 = yB + 0.35 * R2, yb2 = yTop - 0.94 * R2;
    A.part("lower bearing", bearing({ ...br, name: "lower bearing" }), { position: [0, yb1, 0], explode: [0, -0.9 * R2, 0] });
    A.part("upper bearing", bearing({ ...br, name: "upper bearing" }), { position: [0, yb2, 0], explode: [0, 0.75 * R2, 0], label: { text: "bearing", at: [br.outer, br.width / 2, 0] }, note: "ball bearings hold the spinning shaft centered in its housing" });
    const hT = -c - tb2, hB = yT + 0.46 * R2;
    const bh = revolve(fillet([[br.outer, hT], [0.62 * R2, hT], [0.62 * R2, hT - 0.07 * R2, 1], [0.42 * R2, hT - 0.16 * R2, 0.06 * R2], [0.42 * R2, hB + 0.16 * R2, 0.06 * R2], [0.62 * R2, hB + 0.07 * R2, 1], [0.62 * R2, hB], [br.outer, hB]], { closed: true, steps: 3 }), { loop: true, segments: 48 });
    const ribs = Array.from({ length: 4 }, (_, k) => xf(mesh.box(0.2 * R2, hT - hB - 0.3 * R2, 0.05 * R2, { round: 0.5 }), RY((k / 4) * TAU + Math.PI / 4), T([0.48 * R2, (hT + hB) / 2, 0])));
    A.part("bearing housing", merge(bh, ribs), { material: M("bearingHousing", "steel"), explode: hx, label: { text: "bearing housing", at: [0.42 * R2, (hT + hB) / 2, 0] }, note: "holds both bearings and keeps hot turbine gas away from the cold pump" });
    const turb = rotorStage({ name: "turbine", blades: o.turbineBlades ?? 56, hub: 0.6 * R2, tip: 0.8 * R2, y: yT, chord: [0.17 * R2], stagger: [0], camber: [0.13], thickness: [0.16], hand: -1, shroud: true, diskWidth: 0.24 * R2, bore: 0.14 * R2, material: M("turbine", "inconel") });
    A.part("turbine rotor", turb, { parent: rotor, explode: [0, -1.25 * R2, 0], label: { text: "turbine", at: [0.8 * R2, yT, 0] }, note: "hot gas from the gas generator pushes on these blades and spins the shaft" });
    const nz = statorStage({ name: "turbine nozzle", vanes: 26, inner: 0.6 * R2, outer: 0.8 * R2, y: yT + 0.21 * R2, chord: 0.15 * R2, stagger: 58, camber: 0.08, thickness: 0.14, material: M("turbine", "inconel") });
    A.part("turbine nozzle", nz, { explode: [0, -1.75 * R2, 0], note: "fixed vanes that aim the hot gas at the turbine blades" });
    const yEx = yT - 0.95 * R2, tw = tc;
    const th = revolve(fillet([[0.4 * R2, yT + 0.38 * R2], [0.82 * R2, yT + 0.38 * R2, 3], [0.82 * R2, yT - 0.12 * R2, 4], [0.5 * R2, yT - 0.62 * R2, 6], [0.5 * R2, yEx], [0.5 * R2 + tw, yEx], [0.5 * R2 + tw, yT - 0.62 * R2 + tw * 0.4, 6], [0.82 * R2 + tw, yT - 0.12 * R2 + tw * 0.4, 4], [0.82 * R2 + tw, yT + 0.38 * R2 + tw, 3], [0.4 * R2, yT + 0.38 * R2 + tw]], { closed: true, steps: 3 }), { loop: true, segments: 64 });
    const yM = yT + 0.3 * R2, rM = 0.9 * R2, rt = 0.17 * R2;
    const man = xf(mesh.torus(rM, rt, { segments: 64, tube: 14 }), T([0, yM, 0]));
    const inlet = tubeShell([cyl(rM, Math.PI / 2, yM), cyl(rM + 0.7 * R2, Math.PI / 2, yM)], rt, 0, { segments: 20 });
    const tin = { center: cyl(rM + 0.7 * R2, Math.PI / 2, yM), normal: [0, 0, -1], radius: rt };
    const tinFl = mesh.transform(flange({ pipe: rt, bore: rt * 0.85 }), aim(tin.center, tin.normal));
    const exFl = xf(flange({ pipe: 0.5 * R2 + tw, bore: 0.5 * R2 }), T([0, yEx, 0]), RX(Math.PI));
    A.part("turbine housing", merge(th, man, inlet), { material: M("turbineHousing", "inconel"), explode: [0, -2.5 * R2, 0], label: { text: "turbine housing", at: cyl(rM + rt, Math.PI / 4, yM) }, note: "a ring manifold spreads the hot gas evenly around the turbine" });
    A.part("turbine flanges", merge(tinFl, exFl), { material: M("flange", "steel"), explode: [0, -2.5 * R2, 0] });
    A.port("inlet", A, [0, yIn, 0], [0, 1, 0], Ri);
    A.port("discharge", A, ex.center, ex.normal, ex.radius);
    A.port("turbineInlet", A, tin.center, tin.normal, rt);
    A.port("exhaust", A, [0, yEx, 0], [0, -1, 0], 0.5 * R2);
    A.info = { impeller: R2, top: yIn, bottom: yEx, volute: vol.volute.outer, flange: inFl.flange, yc: CP.yc };
    A.onPose = s => { if (s.spin != null) rotor.rotation = [0, s.spin, 0]; };
    return A;
  }

  // ---------- rocket engine ----------
  // A gas-generator cycle engine: bell nozzle with regen tubes, chamber, injector, LOX dome,
  // gimbal with two actuators, two turbopumps, a gas generator, feed lines with bellows,
  // valves, turbine exhaust ducts, harness, and a thrust frame. The nozzle exit is at y = 0.
  // pose({ pitch, yaw, spin, fuelSpin }) gimbals the engine (radians) and spins the pumps.
  function rocketEngine(o = {}) {
    const A = assembly(o.name ?? "rocket engine", o), M = (r, f) => matFor(o, r, f);
    const Rt = o.throat ?? 110, eps = o.expansion ?? 16;
    const noz = bellNozzle({ throat: Rt, expansion: eps, steps: 28, segments: 72, tubes: o.tubes === false ? false : { count: o.tubeCount ?? 84, from: 0.04, to: 0.5 }, material: M("nozzle", "inconel"), tubeMaterial: M("tubes", "inconel"), manifoldMaterial: M("manifold", "steel") });
    const C = noz.contour, yT = C.length, Ln = C.length;
    const ch = combustionChamber({ throat: Rt, contraction: o.contraction ?? 3, material: M("chamber", "inconel") });
    const CI = ch.info, Rc = CI.chamberRadius, top = yT + CI.top, Rfl = CI.flangeRadius;
    const eng = A.group("engine");
    A.engine = eng;
    const H = top + Rc * 0.6;
    A.part("nozzle", noz, { parent: eng, position: [0, yT, 0], explode: [0, -0.32 * H, 0], label: { text: "nozzle", at: [0, -Ln * 0.82, 0] }, note: `a bell that expands the gas ${eps} times in area, turning pressure into speed` });
    A.part("combustion chamber", ch, { parent: eng, position: [0, yT, 0], label: { text: "combustion chamber", at: [Rc + CI.wall, CI.top * 0.6, 0] }, note: "propellants burn here at high pressure; the throat below sets the flow" });
    const inj = injectorPlate({ radius: Rc, outer: Rfl, thickness: Rc * 0.13, material: M("injector", "steel") });
    const ti = inj.info.thickness;
    A.part("injector", inj, { parent: eng, position: [0, top, 0], explode: [0, 0.14 * H, 0], label: { text: "injector", at: [Rfl, ti / 2, 0] }, note: "hundreds of small elements spray and mix fuel and oxidizer" });
    // LOX dome: an elliptical shell over the injector with a side inlet and a gimbal boss.
    const fh = CI.flangeHeight * 1.1, hd = Rc * 0.55, tw = CI.wall * 0.8, domeY = top + ti;
    const outArc = Array.from({ length: 17 }, (_, i) => { const a = (Math.PI / 2) * (i / 16); return [(Rc + tw) * Math.cos(a), fh + hd * Math.sin(a)]; });
    const inArc = Array.from({ length: 17 }, (_, i) => { const a = (Math.PI / 2) * (1 - i / 16); return [Rc * Math.cos(a), fh + (hd - tw) * Math.sin(a)]; });
    const dome = revolve(fillet([[Rc, 0], [Rfl, 0, 1], [Rfl, fh, 1.5], ...outArc, ...inArc, [Rc, 0]].filter((p, i, a) => i === 0 || v3.dist([p[0], p[1], 0], [a[i - 1][0], a[i - 1][1], 0]) > 1e-6).slice(0, -1), { closed: true, steps: 3 }), { loop: true, segments: 72 });
    const portY = fh + hd * 0.42, portR = Rc * 0.16, portX = (Rc + tw) * Math.cos(Math.asin(0.42)) - 6;
    const stub = tubeShell([[portX, portY, 0], [Rfl + Rc * 0.08, portY, 0]], portR, portR * 0.85, { segments: 24 });
    const stubFl = mesh.transform(flange({ pipe: portR, bore: portR * 0.85 }), aim([Rfl + Rc * 0.08, portY, 0], [1, 0, 0]));
    const boss = revolve(fillet([[0, fh + hd - 8], [Rc * 0.36, fh + hd - 14, 4], [Rc * 0.36, fh + hd + 10, 2], [0, fh + hd + 10]]), { segments: 48 });
    const domeBolts = boltCircle(24, (Rc + tw + Rfl) / 2 + 2, { d: Math.max(4, fh * 0.42), y: fh, grip: fh + ti + CI.flangeHeight, nuts: true });
    A.part("LOX dome", merge(dome, stub, boss), { parent: eng, position: [0, domeY, 0], material: M("dome", "steel"), explode: [0, 0.24 * H, 0], label: { text: "oxidizer dome", at: [Rc * 0.5, fh + hd * 0.9, 0] }, note: "a manifold that spreads liquid oxygen across the back of the injector" });
    A.part("dome flanges", merge(stubFl, domeBolts), { parent: eng, position: [0, domeY, 0], material: M("flange", "steel"), explode: [0, 0.24 * H, 0] });
    const apex = domeY + fh + hd + 10;
    // Gimbal and frame.
    const s = o.gimbalSize ?? Rc * 0.24, pivot = apex + 1.75 * s;
    const gim = gimbal({ size: s, material: M("gimbal", "steel") });
    A.part("gimbal", gim, { position: [0, pivot, 0], explode: [0, 0.34 * H, 0], label: { text: "gimbal", at: [s * 1.3, 0, 0] }, note: "a universal joint: the whole engine tilts on it to steer the rocket" });
    A.gimbalNode = gim;
    const yF = pivot + 1.75 * s + Rc * 1.15, RF = Rc * 1.9;
    const ring = revolve(fillet([[RF - Rc * 0.13, yF - Rc * 0.09, 2], [RF + Rc * 0.13, yF - Rc * 0.09, 2], [RF + Rc * 0.13, yF + Rc * 0.09, 2], [RF - Rc * 0.13, yF + Rc * 0.09, 2]], { closed: true }), { loop: true, segments: 96 });
    const struts = [], plateY = pivot + 1.55 * s;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + Math.PI / 6, p = cyl(s * 1.45, a, plateY);
      for (const d of [-0.36, 0.36]) struts.push(strut(p, cyl(RF, a + d, yF - Rc * 0.09), { radius: Rc * 0.045 }));
    }
    const actA = [Math.PI / 4, (3 * Math.PI) / 4];
    const lugs = actA.map(a => xf(mesh.box(Rc * 0.22, Rc * 0.2, Rc * 0.22, { round: 3 }), T(cyl(RF, a, yF - Rc * 0.17))));
    A.part("thrust frame", merge(ring, struts, lugs), { material: M("frame", "titanium"), explode: [0, 0.48 * H, 0], label: { text: "thrust frame", at: cyl(RF + Rc * 0.13, Math.PI * 1.75, yF) }, note: "carries the thrust into the rocket; the engine hangs from it" });
    // Actuator brackets on the chamber, actuators from the frame to them.
    const attachY = top - CI.cylinder * 0.45 - yT * 0 , attachR = Rc + CI.wall + Rc * 0.24;
    const brk = actA.map(a => merge(xf(mesh.box(Rc * 0.28, Rc * 0.34, Rc * 0.12, { round: 3 }), T(cyl(Rc + CI.wall + Rc * 0.1, a, attachY)), RY(a)), xf(mesh.box(Rc * 0.12, Rc * 0.24, Rc * 0.22, { round: 2 }), T(cyl(attachR, a, attachY)), RY(a))));
    A.part("actuator brackets", merge(brk), { parent: eng, material: M("chamber", "inconel") });
    const anchors = actA.map(a => cyl(RF, a, yF - Rc * 0.24)), attach = actA.map(a => cyl(attachR, a, attachY));
    const Lc = v3.dist(anchors[0], attach[0]), acts = [];
    actA.forEach((a, i) => {
      const act = actuator({ name: i ? "yaw actuator" : "pitch actuator", bore: Rc * 0.17, length: Lc - Rc * 0.25, stroke: Rc * 0.5, material: M("actuator", "steel"), rodMaterial: "brushed" });
      acts.push(A.part(i ? "yaw actuator" : "pitch actuator", act, { label: { text: i ? "actuator" : "actuator", at: [0, Lc * 0.4, 0] }, note: "pushes or pulls on the chamber to tilt the engine" }));
    });
    // Turbopumps: oxidizer at +x, fuel at -x (turned half a turn so its discharge faces +z).
    const R2 = o.pumpSize ?? Rc * 0.5;
    const yP = yT + CI.top * 0.5, pR = Rc + CI.wall + R2 * 1.9;
    const ox = turbopump({ name: "oxidizer turbopump", impeller: R2, materials: o.materials, plain: o.plain });
    const fu = turbopump({ name: "fuel turbopump", impeller: R2 * 0.92, materials: o.materials, plain: o.plain });
    A.part("oxidizer turbopump", ox, { parent: eng, position: [pR, yP, 0], explode: [0.3 * H, 0, 0], label: { text: "oxidizer pump", at: [R2 * 1.2, R2 * 0.3, R2 * 0.6] }, note: "pumps liquid oxygen up to chamber pressure" });
    A.part("fuel turbopump", fu, { parent: eng, position: [-pR, yP, 0], rotation: [0, Math.PI, 0], explode: [-0.3 * H, 0, 0], label: { text: "fuel pump", at: [R2 * 1.2, R2 * 0.3, R2 * 0.6] }, note: "pumps fuel, which cools the nozzle on its way to the injector" });
    A.pumps = [ox, fu];
    A.shafts = [ox.rotor, fu.rotor];
    // Positions in engine coordinates of points on the pumps.
    const at = (pump, p, flipX) => v3.add(flipX ? [-p[0], p[1], -p[2]] : p, [flipX ? -pR : pR, yP, 0]);
    const lp = (pump, name, flipX) => at(pump, pump.portLocal(name).center, flipX);
    const oxEx = lp(ox, "discharge"), fuEx = lp(fu, "discharge", true);
    const pr = R2 * 0.36 * 1.18;
    // Oxidizer discharge to the dome inlet, through the main oxidizer valve.
    const domePort = [Rfl + Rc * 0.08, domeY + portY, 0];
    const oxPipe = pipe([oxEx, v3.add(oxEx, [0, 0, -R2 * 0.6]), [oxEx[0], domeY + portY, oxEx[2] - R2 * 0.6], [oxEx[0], domeY + portY, 0], domePort.map((v, i) => (i === 0 ? v + 0.01 : v))], { radius: pr, bend: pr * 2.4, name: "oxidizer line", material: M("pipe", "brushed"), flanges: false });
    A.part("oxidizer line", oxPipe, { parent: eng, explode: [0.18 * H, 0.04 * H, 0], label: { text: "oxidizer line", at: [oxEx[0], (oxEx[1] + domeY + portY) / 2, oxEx[2] - R2 * 0.6] }, note: "high-pressure oxidizer from the pump to the dome" });
    // Fuel discharge down to the regen manifold on the nozzle.
    const mY = yT + noz.manifoldY - Rt * 0.07, mR = noz.outerRadiusAt(noz.manifoldY) + Rt * 0.2;
    const fuelIn = [-(mR + Rt * 0.35), mY, 0];
    const stubM = tubeShell([[-(mR - 4), mY, 0], fuelIn], pr, pr * 0.85, { segments: 24 });
    A.part("manifold inlet", merge(stubM, mesh.transform(flange({ pipe: pr, bore: pr * 0.85 }), aim(fuelIn, [-1, 0, 0]))), { parent: eng, material: M("manifold", "steel"), explode: [0, -0.32 * H, 0] });
    const fuPipe = pipe([fuEx, v3.add(fuEx, [0, 0, R2 * 0.7]), [fuEx[0] - R2 * 0.3, mY + R2, fuEx[2] + R2 * 0.7], [fuelIn[0] - R2 * 0.3, mY, fuEx[2] + R2 * 0.7], [fuelIn[0] - R2 * 0.3, mY, 0], fuelIn], { radius: pr, bend: pr * 2.6, name: "fuel line", material: M("pipe", "brushed"), flanges: "end" });
    A.part("fuel line", fuPipe, { parent: eng, explode: [-0.18 * H, -0.1 * H, 0], label: { text: "fuel line", at: [fuEx[0] - R2 * 0.3, (fuEx[1] + mY) / 2, fuEx[2] + R2 * 0.7] }, note: "fuel runs to the nozzle manifold, then up through the tubes to cool the wall" });
    // Main valves sit on the vertical runs.
    const mov = valve({ pipe: pr, name: "main oxidizer valve" });
    A.part("main oxidizer valve", mov, { parent: eng, position: [oxEx[0], (oxEx[1] + domeY + portY) / 2 + R2 * 0.2, oxEx[2] - R2 * 0.6], rotation: [0, -Math.PI / 2, 0], explode: [0.18 * H, 0.04 * H, 0], label: "main oxidizer valve", note: "opens to start the engine and closes to shut it down" });
    const mfv = valve({ pipe: pr, name: "main fuel valve" });
    A.part("main fuel valve", mfv, { parent: eng, position: [fuEx[0] - R2 * 0.3 * 0.5, lerp(fuEx[1], mY + R2, 0.45), fuEx[2] + R2 * 0.7], rotation: [0, Math.PI / 2, 0], explode: [-0.18 * H, -0.1 * H, 0], label: "main fuel valve", note: "lets fuel through to the cooling tubes" });
    // Gas generator at -z, feeding both turbines.
    const gR = Rc + CI.wall + R2 * 1.25, tinO = lp(ox, "turbineInlet"), tinF = lp(fu, "turbineInlet", true);
    const gy = tinO[1] + R2 * 1.1, gr = R2 * 0.42;
    const gg = revolve(fillet([[0, gy + gr * 2.6], [gr * 0.5, gy + gr * 2.6, 2], [gr, gy + gr * 2.1, gr * 0.5], [gr, gy + gr * 0.2, 3], [gr * 0.55, gy - gr * 0.6, 3], [gr * 0.55, gy - gr * 1.2], [0, gy - gr * 1.2]]), { segments: 40 });
    const ggN = A.part("gas generator", xf(gg, T([0, 0, -gR])), { parent: eng, material: M("gasGenerator", "inconel"), explode: [0, 0, -0.32 * H], label: { text: "gas generator", at: [gr, gy + gr, -gR] }, note: "burns a little propellant fuel-rich to make the gas that drives the turbines" });
    const ggOut = [0, gy - gr * 1.2, -gR], rd = R2 * 0.17;
    const ducts = [tinO, tinF].map(tp => pipe([ggOut, [0, tp[1], -gR], [tp[0] * 0.55, tp[1], -gR], [tp[0], tp[1], tp[2] - R2 * 0.55], v3.add(tp, [0, 0, -0.01])], { radius: rd, bend: rd * 2.5, name: "hot gas duct", material: M("hotDuct", "inconel"), flanges: "end" }));
    A.part("hot gas ducts", ducts[0], { parent: eng, explode: [0, 0, -0.22 * H] });
    A.part("hot gas ducts 2", ducts[1], { parent: eng, explode: [0, 0, -0.22 * H] });
    // Turbine exhaust: a duct from each turbine down beside the nozzle, ending in a small flared exit.
    const exs = [];
    for (const [pump, flipX] of [[ox, false], [fu, true]]) {
      const e = lp(pump, "exhaust", flipX), sgn = flipX ? -1 : 1, er = pump.portLocal("exhaust").radius + R2 * 0.075;
      const yEnd = yT - Ln * 0.42, xEnd = sgn * (noz.outerRadiusAt(-Ln * 0.42) + er * 2.6);
      const p = pipe([e, [e[0], e[1] - R2 * 0.6, 0], [xEnd, yEnd + R2 * 1.2, 0], [xEnd, yEnd, 0]], { radius: er, bend: er * 3, flanges: "start", name: "turbine exhaust", material: M("exhaust", "inconel") });
      const flare = revolve(fillet([[er - 1.5, 0], [er, 0], [er * 1.6, -er * 1.4, 3], [er * 1.6 - 2, -er * 1.4], [er - 3.5, 0]].map(q => [q[0], q[1]])), { loop: true, segments: 40 });
      exs.push(p, flare);
      A.part(flipX ? "fuel turbine exhaust" : "oxidizer turbine exhaust", p, { parent: eng, explode: [sgn * 0.3 * H, 0, 0], label: flipX ? undefined : { text: "turbine exhaust", at: [xEnd, yEnd + R2, 0] }, note: "spent turbine gas dumps overboard here" });
      A.part(flipX ? "fuel exhaust exit" : "oxidizer exhaust exit", flare, { parent: eng, position: [xEnd, yEnd, 0], material: M("exhaust", "inconel"), explode: [sgn * 0.3 * H, 0, 0] });
    }
    // Feed lines from the vehicle interface (top) to the pump inlets, each with a bellows.
    const feeds = [];
    for (const [pump, flipX, nm] of [[ox, false, "oxidizer feed"], [fu, true, "fuel feed"]]) {
      const pin = lp(pump, "inlet", flipX), r = pump.portLocal("inlet").radius + R2 * 0.075;
      const yb = yF - Rc * 0.1, bl = Rc * 0.4;
      const p = pipe([pin, [pin[0], yb - bl - R2 * 0.05, 0]], { radius: r, flanges: "start", name: nm, material: M("pipe", "brushed") });
      const bel = bellows({ radius: r * 1.02, length: bl, convolutions: 9 });
      const topFl = flange({ pipe: r, bore: r * 0.85 });
      const node = A.part(nm, p, { parent: eng, explode: [(flipX ? -1 : 1) * 0.3 * H, 0.1 * H, 0], label: { text: flipX ? "fuel inlet" : "oxidizer inlet", at: [pin[0], yb - bl * 1.6, 0] }, note: "propellant arrives from the tank through this line" });
      A.part(`${nm} bellows`, merge(xf(bel, T([pin[0], yb - bl, 0])), xf(topFl, T([pin[0], yb, 0]))), { parent: eng, material: M("bellows", "steel"), explode: [(flipX ? -1 : 1) * 0.3 * H, 0.14 * H, 0] });
      feeds.push(node);
      A.port(flipX ? "fuelInlet" : "oxidizerInlet", eng, [pin[0], yb, 0], [0, 1, 0], r);
    }
    // A small harness from the frame down to the gas generator igniter.
    const hz = harness([[0, yF - Rc * 0.2, -RF * 0.8], [0, pivot, -Rc * 1.5], [R2 * 0.3, gy + gr * 4, -gR - R2 * 0.3], [0, gy + gr * 2.65, -gR]], { wires: 7, wire: Math.max(1.2, Rc * 0.012), ties: 5 });
    A.part("harness", hz, { parent: eng, explode: [0, 0.1 * H, -0.3 * H], note: "wires for the igniter and the valve sensors" });
    A.port("nozzleExit", A.parts["nozzle"], [0, -Ln, 0], [0, -1, 0], C.exit);
    A.info = { throat: Rt, exit: C.exit, expansion: eps, nozzleLength: Ln, chamberRadius: Rc, height: yF + Rc * 0.1, pivot, thetaN: C.thetaN, thetaE: C.thetaE };
    const st = { pitch: 0, yaw: 0, spin: 0, fuelSpin: null };
    A.gimbal = { pitch: 0, yaw: 0, range: o.gimbalRange ?? 6 * DEG };
    A.onPose = p => {
      Object.assign(st, p);
      const lim = A.gimbal.range, pitch = clamp(st.pitch, -lim, lim), yaw = clamp(st.yaw, -lim, lim);
      A.gimbal.pitch = pitch; A.gimbal.yaw = yaw;
      const Mg = mul(T([0, pivot, 0]), RX(pitch), RZ(yaw), T([0, -pivot, 0]));
      eng.matrix = Mg;
      gim.set2(pitch, yaw);
      const e = A.exploded, fOff = [0, 0.48 * H * e, 0];
      acts.forEach((act, i) => act.span(v3.add(anchors[i], fOff), m4.apply(Mg, attach[i])));
      ox.pose({ spin: st.spin });
      fu.pose({ spin: st.fuelSpin ?? st.spin * 1.35 });
    };
    const baseExplode = A.explode;
    A.explode = t => { baseExplode(t); A.onPose({}); return A; };
    A.onPose({});
    return A;
  }

  // ---------- turbofan ----------
  // A two-spool high-bypass turbofan, axis along +x (flow left to right), fan face at x = 0.
  // Static casings can be shown with a quarter cut away; the low spool (spinner, fan,
  // booster, LP shaft, LP turbine) and the high spool (HP compressor, HP shaft, HP turbine)
  // turn independently. pose({ low, high }) sets their angles in radians.
  function turbofan(o = {}) {
    const A = assembly(o.name ?? "turbofan", o), M = (r, f) => matFor(o, r, f);
    const Rf = o.fanRadius ?? 900, k = Rf / 900;
    const cutStart = o.cutStart ?? Math.PI * 1.5, cutArc = TAU * 0.75;
    // The engine is modeled about local y (flow +y) and turned so local y becomes world x.
    const axis = A.group("axis", { matrix: RZ(-Math.PI / 2) });
    const cases = [];
    // A static revolved part, built whole and with the cutaway wedge removed.
    const shell = (name, profile, opts = {}) => {
      const g = A.part(name, null, { parent: opts.parent || axis, explode: opts.explode, label: opts.label, note: opts.note });
      const full = g.add(revolve(profile, { loop: true, segments: opts.segments ?? 96 }), { name, material: opts.material });
      const cut = g.add(revolve(profile, { loop: true, segments: Math.round((opts.segments ?? 96) * 0.75), arc: cutArc, start: cutStart }), { name, material: opts.material, visible: false });
      cases.push([full, cut]);
      return g;
    };
    const low = A.group("low spool", { parent: axis }), high = A.group("high spool", { parent: axis });
    A.spools = { low, high };
    // ---- flowpath (mm at a 900 mm fan radius) ----
    const s = v => v * k;
    // Core flowpath stations: [y, hub, tip].
    const core = [[300, 338, 440], [360, 345, 432], [640, 352, 410], [720, 300, 365], [800, 232, 300], [840, 222, 292], [1340, 222, 244], [1390, 230, 250]].map(r => r.map(s));
    const coreAt = (y, i) => { for (let j = 1; j < core.length; j++) if (core[j][0] >= y) { const a = core[j - 1], b = core[j]; return lerp(a[i], b[i], (y - a[0]) / (b[0] - a[0])); } return core[core.length - 1][i]; };
    const hubAt = y => coreAt(y, 1), tipAt = y => coreAt(y, 2);
    // ---- nacelle and fan case ----
    const P = nacelleProfile({ fan: Rf });
    shell("nacelle", P.loop, { material: M("nacelle", "porcelain"), segments: 128, explode: [0, -s(1500), 0], label: { text: "nacelle", at: cyl(P.Rmax, Math.PI * 0.62, s(-100)) }, note: "the smooth outer cowl; its lip and inlet slow the air before the fan" });
    const caseProf = fillet([[P.Rc, P.yCF], [P.Rco, P.yCF], [P.Rco, P.yCR], [P.ductR, P.yCR], [P.ductR, s(260), s(30)], [P.Rc, s(200), s(20)]], { steps: 3 });
    shell("fan case", caseProf, { material: M("fanCase", "aluminum"), segments: 128, explode: [0, -s(1500), 0], label: { text: "fan case", at: cyl(P.Rc, Math.PI * 0.85, s(-150)) }, note: "a thick ring around the fan that would contain a broken blade" });
    // ---- spinner, fan, fan disk ----
    const hubR = s(275), yS = s(-420);
    const sp = spinner({ radius: hubR, length: s(380), shape: "ellipse", back: s(10) });
    A.part("spinner", sp, { parent: low, position: [0, yS, 0], material: M("spinner", "porcelain"), explode: [0, -s(1100), 0], label: { text: "spinner", at: [hubR * 0.5, s(200), 0] }, note: "a nose cone that guides air smoothly onto the fan blade roots" });
    const fanHub = revolve(fillet([[0, s(-40)], [hubR, s(-40)], [s(300), s(80), s(80)], [s(338), s(240)], [s(338), s(300)], [s(120), s(300)], [s(120), s(200)], [0, s(200)]], { steps: 4 }), { segments: 96 });
    A.part("fan disk", fanHub, { parent: low, material: M("fanDisk", "titanium"), explode: [0, -s(900), 0], note: "holds the fan blades by their dovetail roots" });
    const fan = rotorStage({
      name: "fan", blades: o.fanBlades ?? 18, hub: s(292), tip: Rf - s(3), y: s(40), hubSlope: 0.18, embed: s(14),
      chord: [s(300), s(380), s(445)], stagger: [24, 44, 61], camber: [0.075, 0.05, 0.028], thickness: [0.1, 0.06, 0.032],
      sweep: t => s(70) * t * t, lean: t => s(-30) * t * t, stations: 13, points: 16, disk: false, material: M("fanBlades", "titanium"),
    });
    A.part("fan", fan, { parent: low, explode: [0, -s(900), 0], label: { text: "fan blades", at: cyl(Rf * 0.75, Math.PI * 0.3, s(60)) }, note: `${o.fanBlades ?? 18} wide-chord blades; the fan makes most of the thrust` });
    // ---- splitter, core cowl, OGVs ----
    const yE = P.yE, cowl = [];
    for (let i = 0; i <= 30; i++) { const u = i / 30, y = lerp(s(300), s(2420), u); cowl.push([s(440) + s(125) * Math.sin(Math.min(1, u / 0.3) * Math.PI / 2) - s(150) * sstep(0.3, 1, u), y]); }
    const cowlIn = cowl.slice(3).map(([r, y]) => [r - s(16), y]).reverse();
    const splitIn = [[tipAt(s(640)) + 1, s(640)], [tipAt(s(360)) + 1, s(360)], [s(434), s(304)]];
    shell("core cowl", fillet([...cowl, [cowl[30][0] - s(14), s(2420)], ...cowlIn.filter(p => p[1] > s(700)), [s(400), s(700)], ...splitIn], { closed: false, steps: 2 }), { material: M("coreCowl", "porcelain"), segments: 96, explode: [0, s(250), 0], label: { text: "core cowl", at: cyl(s(560), Math.PI * 0.7, s(1200)) }, note: "the inner wall of the bypass duct; the core engine is inside it" });
    const cowlR = y => { for (let i = 1; i < cowl.length; i++) if (cowl[i][1] >= y) return lerp(cowl[i - 1][0], cowl[i][0], (y - cowl[i - 1][1]) / (cowl[i][1] - cowl[i - 1][1])); return cowl[30][0]; };
    const ogv = statorStage({ name: "outlet guide vanes", vanes: o.ogvs ?? 44, inner: cowlR(s(640)), outer: P.ductR, y: s(640), chord: s(170), stagger: -8, camber: 0.06, thickness: 0.08, innerSlope: (cowlR(s(700)) - cowlR(s(580))) / s(120), bands: false, material: M("ogv", "aluminum") });
    A.part("outlet guide vanes", ogv, { parent: axis, explode: [0, s(250), 0], label: { text: "outlet guide vanes", at: cyl(s(760), Math.PI * 0.25, s(640)) }, note: "fixed vanes that straighten the swirling bypass air" });
    // ---- booster (low-pressure compressor) ----
    const boost = [];
    [[360, 64, "s"], [410, 52, "r"], [455, 72, "s"], [500, 56, "r"], [545, 76, "s"], [590, 60, "r"], [630, 80, "s"]].forEach(([y, n, kind], i) => {
      const yy = s(y), hb = hubAt(yy), tp = tipAt(yy), sl = (tipAt(yy + 10) - tipAt(yy - 10)) / 20, hl = (hubAt(yy + 10) - hubAt(yy - 10)) / 20;
      if (kind === "r") boost.push(A.part(`booster rotor ${i}`, rotorStage({ name: "booster", blades: n, hub: hb, tip: tp - 1.5, y: yy, chord: [s(42), s(38)], stagger: [35, 48], hubSlope: hl, tipSlope: sl, diskWidth: s(30), bore: s(150), material: M("compressor", "titanium") }), { parent: low, explode: [0, -s(500), 0] }));
      else boost.push(A.part(`booster stator ${i}`, statorStage({ name: "booster stator", vanes: n, inner: hb, outer: tp, y: yy, chord: s(36), stagger: -25, innerSlope: hl, outerSlope: sl, material: M("compressor", "titanium") }), { parent: axis, explode: [0, -s(500), 0] }));
    });
    A.parts["booster"] = boost[1];
    A.part("booster label", null, { parent: axis, label: { text: "booster", at: cyl(s(400), Math.PI * 0.75, s(500)) }, note: "a few low-pressure compressor stages on the fan shaft" });
    // ---- core casings: transition duct, HPC case, combustor case, turbine case ----
    const caseIn = [], caseT = s(14);
    for (let i = 0; i <= 24; i++) { const y = lerp(s(640), s(1390), i / 24); caseIn.push([tipAt(y) + 1, y]); }
    shell("compressor case", [...caseIn, ...caseIn.slice().reverse().map(([r, y]) => [r + caseT, y])], { material: M("compressorCase", "steel"), segments: 80, explode: [0, s(120), 0], note: "the casing around the compressor; its inner wall sits just clear of the blade tips" });
    // Flanges and a bleed manifold on the HP compressor case.
    const cf = [s(830), s(1050), s(1250)].map(y => collar(yy => tipAt(yy) + caseT, y - s(8), y + s(8), s(16), { segments: 72 }));
    const bleed = xf(mesh.torus(tipAt(s(1150)) + caseT + s(28), s(20), { segments: 72, tube: 12 }), T([0, s(1150), 0]));
    A.part("case flanges", merge(cf, bleed), { parent: axis, material: M("compressorCase", "steel"), explode: [0, s(120), 0] });
    // Inner wall of the transition duct (static).
    const ductIn = []; for (let i = 0; i <= 12; i++) { const y = lerp(s(640), s(820), i / 12); ductIn.push([hubAt(y) - 1, y]); }
    shell("transition duct", [...ductIn, ...ductIn.slice().reverse().map(([r, y]) => [r - s(12), y])], { material: M("compressorCase", "steel"), segments: 72, explode: [0, s(120), 0] });
    // ---- HP compressor ----
    const hpcN = [38, 44, 50, 56, 60, 64, 68, 72, 76];
    hpcN.forEach((n, i) => {
      const yr = s(850 + i * 54), ys = yr + s(27), sl = (tipAt(yr + 10) - tipAt(yr - 10)) / 20;
      A.part(`hpc rotor ${i + 1}`, rotorStage({ name: "high-pressure compressor", blades: n, hub: hubAt(yr), tip: tipAt(yr) - 1, y: yr, chord: [s(30 - i * 1.4), s(26 - i * 1.2)], stagger: [38, 52], tipSlope: sl, diskWidth: s(22), bore: s(118), material: M("compressor", "titanium") }), { parent: high, explode: [0, s(120), 0] });
      A.part(`hpc stator ${i + 1}`, statorStage({ name: "hpc stator", vanes: Math.round(n * 1.3), inner: hubAt(ys), outer: tipAt(ys), y: ys, chord: s(24 - i), stagger: -28, outerSlope: sl, material: M("compressor", "titanium") }), { parent: axis, explode: [0, s(120), 0] });
    });
    A.parts["high-pressure compressor"] = A.parts["hpc rotor 1"];
    const drum = []; for (let i = 0; i <= 10; i++) { const y = lerp(s(830), s(1330), i / 10); drum.push([hubAt(y) - s(1.5), y]); }
    A.part("hpc drum", revolve([...drum, ...drum.slice().reverse().map(([r, y]) => [r - s(8), y])], { loop: true, segments: 72 }), { parent: high, material: M("compressor", "titanium"), explode: [0, s(120), 0] });
    A.part("hpc label", null, { parent: axis, label: { text: "high-pressure compressor", at: cyl(s(260), Math.PI * 0.75, s(1100)) }, note: "nine stages squeeze the core air about 20 times" });
    // ---- combustor ----
    const yC0 = s(1400), yC1 = s(1640);
    shell("combustor case", fillet([[s(250), yC0 - s(20)], [s(372), s(1440), s(30)], [s(372), yC1 + s(20), s(10)], [s(330), yC1 + s(40)], [s(330) - s(12), yC1 + s(40)], [s(360), yC1 + s(20)], [s(360), s(1450), s(20)], [s(250), yC0 - s(8)]], { closed: true, steps: 3 }), { material: M("combustorCase", "steel"), explode: [0, s(300), 0], note: "the pressure casing around the combustor" });
    const step = (r0, r1, sgn) => { const pts = []; for (let i = 0; i < 6; i++) { const y = lerp(s(1440), yC1, i / 6), y2 = lerp(s(1440), yC1, (i + 1) / 6), r = lerp(r0, r1, i / 6), r2 = lerp(r0, r1, (i + 1) / 6); pts.push([r, y], [r2 + sgn * s(4), y2 - s(6)], [r2, y2 - s(2)]); } return pts; };
    const outerLiner = step(s(322), s(302), 1), innerLiner = step(s(232), s(258), -1);
    const linerT = s(4);
    A.part("combustor", merge(
      revolve([...outerLiner, ...outerLiner.slice().reverse().map(([r, y]) => [r + linerT, y])], { loop: true, segments: 72, crease: 50 }),
      revolve([...innerLiner, ...innerLiner.slice().reverse().map(([r, y]) => [r - linerT, y])], { loop: true, segments: 72, crease: 50 }),
      revolve(fillet([[s(232), s(1440)], [s(250), s(1405), s(14)], [s(305), s(1405), s(14)], [s(322), s(1440)], [s(322) + linerT, s(1440)], [s(305), s(1405) - linerT, s(14)], [s(250), s(1405) - linerT, s(14)], [s(232) - linerT, s(1440)]], { closed: true, steps: 3 }), { loop: true, segments: 96 }),
    ), { parent: axis, material: M("combustor", "inconel"), explode: [0, s(300), 0], label: { text: "combustor", at: cyl(s(320), Math.PI * 0.75, s(1540)) }, note: "an annular chamber where fuel burns in the compressed air" });
    const nozzleStem = revolve(fillet([[0, 0], [s(14), 0], [s(14), s(70)], [s(9), s(80)], [s(9), s(118)], [s(16), s(122)], [s(16), s(134)], [0, s(134)]]), { segments: 14 });
    const nzz = Array.from({ length: o.fuelNozzles ?? 20 }, (_, i) => xf(nozzleStem, RY((i / (o.fuelNozzles ?? 20)) * TAU), T([s(395), s(1415), 0]), RZ(Math.PI / 2 + 0.25)));
    A.part("fuel nozzles", merge(nzz), { parent: axis, material: M("fuelNozzles", "steel"), explode: [0, s(300), 0], label: { text: "fuel nozzles", at: cyl(s(380), Math.PI * 0.62, s(1420)) }, note: "spray fuel into the front of the combustor" });
    // ---- turbines ----
    const turb = [[1655, 255, 300, "s", 40], [1695, 255, 302, "r", 72], [1740, 258, 312, "s", 44], [1780, 258, 318, "r", 76]];
    turb.forEach(([y, h, t, kind, n], i) => {
      const yy = s(y);
      if (kind === "r") A.part(`hpt rotor ${i}`, rotorStage({ name: "high-pressure turbine", blades: n, hub: s(h), tip: s(t) - 1, y: yy, chord: [s(30), s(28)], stagger: [-30, -40], camber: [0.12, 0.1], thickness: [0.16, 0.12], hand: -1, diskWidth: s(34), bore: s(110), material: M("turbine", "inconel") }), { parent: high, explode: [0, s(450), 0] });
      else A.part(`hpt nozzle ${i}`, statorStage({ name: "hpt nozzle", vanes: n, inner: s(h), outer: s(t), y: yy, chord: s(30), stagger: 40, camber: 0.12, thickness: 0.18, hand: 1, material: M("turbine", "inconel") }), { parent: axis, explode: [0, s(450), 0] });
    });
    A.parts["high-pressure turbine"] = A.parts["hpt rotor 1"];
    A.part("hpt label", null, { parent: axis, label: { text: "high-pressure turbine", at: cyl(s(300), Math.PI * 0.8, s(1720)) }, note: "two stages that drive the compressor through the HP shaft" });
    const lptHub = y => lerp(s(265), s(300), (y - s(1830)) / s(450)), lptTip = y => lerp(s(335), s(455), (y - s(1830)) / s(450));
    for (let i = 0; i < 5; i++) {
      const ys = s(1840 + i * 90), yr = ys + s(45), tsl = (lptTip(s(100)) - lptTip(0)) / s(100);
      A.part(`lpt nozzle ${i + 1}`, statorStage({ name: "lpt nozzle", vanes: 70 + i * 6, inner: lptHub(ys), outer: lptTip(ys), y: ys, chord: s(36), stagger: 38, camber: 0.1, thickness: 0.14, hand: 1, innerSlope: (lptHub(s(100)) - lptHub(0)) / s(100), outerSlope: tsl, material: M("turbine", "inconel") }), { parent: axis, explode: [0, s(700), 0] });
      A.part(`lpt rotor ${i + 1}`, rotorStage({ name: "low-pressure turbine", blades: 80 + i * 8, hub: lptHub(yr), tip: lptTip(yr) - 2, y: yr, chord: [s(34), s(30)], stagger: [-32, -46], camber: [0.1, 0.08], thickness: [0.12, 0.08], hand: -1, tipSlope: tsl, shroud: true, diskWidth: s(30), bore: s(70), material: M("turbine", "inconel") }), { parent: low, explode: [0, s(700), 0] });
    }
    A.parts["low-pressure turbine"] = A.parts["lpt rotor 1"];
    A.part("lpt label", null, { parent: axis, label: { text: "low-pressure turbine", at: cyl(lptTip(s(2100)), Math.PI * 0.8, s(2100)) }, note: "five stages that drive the fan through the LP shaft" });
    const tcase = []; for (let i = 0; i <= 16; i++) { const y = lerp(s(1640), s(2330), i / 16); tcase.push([(y < s(1820) ? s(322) + (y - s(1640)) * 0.05 : lptTip(y)) + 2, y]); }
    shell("turbine case", [...tcase, ...tcase.slice().reverse().map(([r, y]) => [r + s(14), y])], { material: M("turbineCase", "inconel"), segments: 96, explode: [0, s(600), 0], note: "the casing around both turbines" });
    // Turbine rear frame struts and the exhaust plug.
    const trf = statorStage({ name: "turbine rear frame", vanes: 12, inner: s(300), outer: s(460), y: s(2330), chord: s(60), stagger: 0, camber: 0, thickness: 0.16, material: M("turbineCase", "inconel") });
    A.part("turbine rear frame", trf, { parent: axis, explode: [0, s(850), 0] });
    const plug = revolve([[0, s(2860)], ...Array.from({ length: 16 }, (_, i) => { const u = 1 - i / 15; return [s(300) * Math.pow(u, 0.8), lerp(s(2300), s(2860), 1 - u)]; }).reverse().reverse(), [s(300), s(2300)], [0, s(2300)]].sort((a, b) => b[1] - a[1]).map(p => p), { segments: 72 });
    A.part("exhaust cone", plug, { parent: axis, material: M("exhaustCone", "inconel"), explode: [0, s(950), 0], label: { text: "exhaust cone", at: [s(150), s(2600), 0] }, note: "the plug that shapes the hot core exhaust" });
    // ---- shafts and bearings ----
    const lpS = shaft({ steps: [[s(200), s(110)], [s(2150), s(90)], [s(100), s(110)]], bore: s(60), segments: 32 });
    A.part("LP shaft", xf(lpS, T([0, s(150), 0])), { parent: low, material: M("shaft", "steel"), label: { text: "LP shaft", at: [0, s(1900), s(55)] }, note: "the inner shaft: LP turbine to fan, turning slower" });
    const hpS = shaft({ steps: [[s(60), s(236)], [s(940), s(200)], [s(60), s(220)]], bore: s(150), segments: 40 });
    A.part("HP shaft", xf(hpS, T([0, s(800), 0])), { parent: high, material: M("shaft", "steel"), label: { text: "HP shaft", at: [0, s(1450), s(100)] }, note: "the outer, hollow shaft: HP turbine to compressor, turning faster" });
    for (const [y, bore, outer, nm] of [[260, 55, 85, "No. 1 bearing"], [770, 118, 150, "No. 3 bearing"], [2250, 55, 85, "No. 5 bearing"]]) A.part(nm, bearing({ bore: s(bore), outer: s(outer), width: s(24), name: nm, segments: 40, ballSegments: 6 }), { parent: axis, position: [0, s(y), 0], explode: [0, y < 1000 ? -s(300) : s(600), 0] });
    // ---- pylon mounts, test stand ----
    const fwdMount = cyl(P.Rco, Math.PI, s(380)), aftMount = cyl(lptTip(s(2330)) + s(16), Math.PI, s(2330));
    A.mounts = { forward: () => axis.toWorld(fwdMount), aft: () => axis.toWorld(aftMount) };
    const lugs = merge(xf(mesh.box(s(70), s(60), s(90), { round: s(6) }), T(v3.add(fwdMount, [s(-20), 0, 0]))), xf(mesh.box(s(70), s(50), s(80), { round: s(6) }), T(v3.add(aftMount, [s(-20), 0, 0]))));
    A.part("engine mounts", lugs, { parent: axis, material: M("mount", "steel"), explode: [0, s(250), 0], note: "the forward and aft mounts take the thrust into the pylon" });
    // Accessory plumbing on the core: two pipes and a harness along the compressor case.
    const ra = y => tipAt(y) + caseT + s(45);
    const pipeA = pipe([cyl(ra(s(860)), Math.PI * 0.35, s(860)), cyl(ra(s(1150)), Math.PI * 0.35, s(1150)), cyl(s(330), Math.PI * 0.33, s(1700)), cyl(s(345), Math.PI * 0.33, s(2050))], { radius: s(10), bend: s(40), flanges: false, name: "bleed pipe", material: M("pipe", "brushed") });
    A.part("bleed pipe", pipeA, { parent: axis, explode: [0, s(250), 0] });
    const hz = harness([cyl(ra(s(850)), Math.PI * 1.18, s(850)), cyl(ra(s(1100)) + s(5), Math.PI * 1.2, s(1100)), cyl(s(400), Math.PI * 1.22, s(1500)), cyl(s(395), Math.PI * 1.2, s(1900))], { wires: 7, wire: s(2.4), ties: 6 });
    A.part("harness", hz, { parent: axis, explode: [0, s(250), 0], note: "sensor and control wiring" });
    if (o.testStand || o.pylon) {
      const top = P.Rmax, bx0 = s(-500), bx1 = s(2600), beamY = top + s(520);
      const st = A.group("test stand");
      const pyl = mesh.extrude([[s(150), top - s(40)], [s(1500), top - s(40)], [s(2300), lptTip(s(2330)) + s(10)], [s(2300), beamY - s(60)], [s(150), beamY - s(60)]], s(170), { bevel: s(20) });
      A.part("pylon", pyl, { parent: st, material: M("pylon", "porcelain"), label: { text: "pylon", at: [s(800), top + s(200), s(85)] }, note: "carries the engine's thrust and weight into the wing, or here the stand" });
      if (o.testStand) {
        const ground = -top - s(700);
        const col = (x, z) => xf(mesh.box(s(110), beamY - ground, s(110), { round: s(6) }), T([x, (beamY + ground) / 2, z]));
        const frame = merge(
          xf(mesh.box(bx1 - bx0, s(140), s(240), { round: s(8) }), T([(bx0 + bx1) / 2, beamY, 0])),
          col(bx0 + s(100), s(1050)), col(bx0 + s(100), s(-1050)), col(bx1 - s(100), s(1050)), col(bx1 - s(100), s(-1050)),
          xf(mesh.box(s(110), s(110), s(2210), { round: s(6) }), T([bx0 + s(100), beamY, 0])), xf(mesh.box(s(110), s(110), s(2210), { round: s(6) }), T([bx1 - s(100), beamY, 0])),
          strut([bx0 + s(100), ground + s(200), s(1050)], [bx0 + s(100), beamY - s(80), s(150)], { radius: s(26) }), strut([bx0 + s(100), ground + s(200), s(-1050)], [bx0 + s(100), beamY - s(80), s(-150)], { radius: s(26) }),
          strut([bx1 - s(100), ground + s(200), s(1050)], [bx1 - s(100), beamY - s(80), s(150)], { radius: s(26) }), strut([bx1 - s(100), ground + s(200), s(-1050)], [bx1 - s(100), beamY - s(80), s(-150)], { radius: s(26) }),
        );
        A.part("stand frame", frame, { parent: st, material: M("stand", "porcelain"), note: "a thrust stand: the engine hangs from a beam that measures its pull" });
        A.part("stand base", xf(mesh.box(bx1 - bx0 + s(400), s(60), s(2600), { round: s(10) }), T([(bx0 + bx1) / 2, ground - s(30), 0])), { parent: st, material: M("ground", "concrete") });
      }
    }
    // ---- ports ----
    A.port("inlet", axis, [0, P.yH, 0], [0, -1, 0], P.Rh);
    A.port("fanFace", axis, [0, s(-60), 0], [0, -1, 0], Rf, { inner: hubR });
    A.port("fanNozzle", axis, [0, yE, 0], [0, 1, 0], P.RE - P.te, { inner: cowlR(yE) });
    A.port("nozzle", axis, [0, s(2420), 0], [0, 1, 0], cowl[30][0] - s(16), { inner: s(300) * Math.pow(1 - (s(2420) - s(2300)) / s(560), 0.8) });
    const bypassArea = Math.PI * (P.ductR ** 2 - s(440) ** 2), coreArea = Math.PI * (s(440) ** 2 - s(338) ** 2);
    A.info = { fanRadius: Rf, hubRadius: hubR, splitter: s(440), coreHub: s(338), bypassArea, coreArea, bypassRatio: bypassArea / coreArea, length: s(2860) - P.yH, fanBlades: o.fanBlades ?? 18, maxRadius: P.Rmax };
    A.cutaway = (on = true) => { for (const [f, c] of cases) { f.visible = !on; c.visible = !!on; } return A; };
    if (o.cutaway) A.cutaway(true);
    A.onPose = p => { if (p.low != null) low.rotation = [0, p.low, 0]; if (p.high != null) high.rotation = [0, p.high, 0]; };
    return A;
  }

  // ---------- belts and chains ----------
  // A closed belt path around circles [{ c: [x, y], r, cw }] taken in travel order; cw: true
  // wraps clockwise (seen from +z). Returns { points (closed polyline, xy), length, arcs }.
  function beltPath(circles, { step = 4 } = {}) {
    const n = circles.length, tang = [];
    for (let i = 0; i < n; i++) {
      const A0 = circles[i], B0 = circles[(i + 1) % n];
      const d = [B0.c[0] - A0.c[0], B0.c[1] - A0.c[1]], L = Math.hypot(d[0], d[1]), e = [d[0] / L, d[1] / L], ep = [-e[1], e[0]];
      let best = null;
      for (const sa of [1, -1]) for (const sb of [1, -1]) {
        const cosA = (sa * A0.r - sb * B0.r) / L;
        if (Math.abs(cosA) > 1) continue;
        for (const sg of [1, -1]) {
          const sinA = sg * Math.sqrt(1 - cosA * cosA), nrm = [e[0] * cosA + ep[0] * sinA, e[1] * cosA + ep[1] * sinA];
          const pa = [A0.c[0] + sa * A0.r * nrm[0], A0.c[1] + sa * A0.r * nrm[1]], pb = [B0.c[0] + sb * B0.r * nrm[0], B0.c[1] + sb * B0.r * nrm[1]];
          const t = [pb[0] - pa[0], pb[1] - pa[1]];
          const vel = (C, p, cw) => { const rx = p[0] - C.c[0], ry = p[1] - C.c[1]; return cw ? [ry, -rx] : [-ry, rx]; };
          const va = vel(A0, pa, A0.cw), vb = vel(B0, pb, B0.cw);
          if (va[0] * t[0] + va[1] * t[1] > 0 && vb[0] * t[0] + vb[1] * t[1] > 0) best = { pa, pb };
        }
      }
      tang.push(best || { pa: A0.c, pb: B0.c });
    }
    const pts = [], arcs = [];
    let length = 0;
    for (let i = 0; i < n; i++) {
      const C = circles[i], arrive = tang[(i - 1 + n) % n].pb, leave = tang[i].pa;
      const a0 = Math.atan2(arrive[1] - C.c[1], arrive[0] - C.c[0]);
      let da = Math.atan2(leave[1] - C.c[1], leave[0] - C.c[0]) - a0;
      if (C.cw) { while (da > 0) da -= TAU; } else { while (da < 0) da += TAU; }
      const m = Math.max(2, Math.ceil((Math.abs(da) * C.r) / step));
      for (let k = 0; k < m; k++) { const a = a0 + (da * k) / m; pts.push([C.c[0] + C.r * Math.cos(a), C.c[1] + C.r * Math.sin(a)]); }
      arcs.push({ start: length, angle: Math.abs(da) });
      length += Math.abs(da) * C.r;
      const L = Math.hypot(tang[i].pb[0] - leave[0], tang[i].pb[1] - leave[1]);
      const m2 = Math.max(1, Math.ceil(L / (step * 6)));
      for (let k = 0; k < m2; k++) pts.push([lerp(leave[0], tang[i].pb[0], k / m2), lerp(leave[1], tang[i].pb[1], k / m2)]);
      length += L;
    }
    return { points: pts, length, arcs, tangents: tang };
  }
  // A belt (flat band) along a closed xy path at z = 0: width along z, thickness outward.
  function belt(path2, { width = 20, thickness = 4 } = {}) {
    const P = path2.map(([x, y]) => [x, y, 0]), n = P.length, S = new Soup();
    let area = 0;
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const sgn = area > 0 ? 1 : -1;
    const ring = P.map((p, i) => {
      const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
      const nx = (ty / l) * sgn, ny = (-tx / l) * sgn;
      return [[p[0], p[1], -width / 2], [p[0] + nx * thickness, p[1] + ny * thickness, -width / 2], [p[0] + nx * thickness, p[1] + ny * thickness, width / 2], [p[0], p[1], width / 2]];
    });
    for (let i = 0; i < n; i++) { const A0 = ring[i], B0 = ring[(i + 1) % n]; for (let q = 0; q < 4; q++) { const q1 = (q + 1) % 4; S.quad(A0[q], B0[q], B0[q1], A0[q1]); } }
    return S.build({ crease: 50 });
  }

  // ---------- piston engine ----------
  // An inline four-stroke engine with double overhead cams and two valves per cylinder.
  // Crank axis along x at the origin, cylinders up (+y). Defaults are a 2.0 L inline four
  // (86 x 86 mm, 143 mm rods). pose({ crank }) sets the crank angle in radians; pistons,
  // rods, cams, and valves follow, with the cams at half crank speed.
  function pistonEngine(o = {}) {
    const A = assembly(o.name ?? "piston engine", o), M = (r, f) => matFor(o, r, f);
    const n = o.cylinders ?? 4, B = o.bore ?? 86, Sk = o.stroke ?? 86, L = o.rod ?? Sk * 1.66, r = Sk / 2;
    const pitch = o.spacing ?? B * 1.12, ch = B * 0.36, X = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * pitch);
    const FO = { 1: [1], 2: [1, 2], 3: [1, 3, 2], 4: [1, 3, 4, 2], 5: [1, 2, 4, 5, 3], 6: [1, 5, 3, 6, 2, 4] }[n] || Array.from({ length: n }, (_, i) => i + 1);
    const firing = o.firingOrder ?? FO;
    const phase = X.map((_, i) => ((firing.indexOf(i + 1) * 720) / n) * DEG);
    const pinA = phase.map(p => -p);
    const yDeck = r + L + ch + 0.6, Hh = B * 0.95, yHead = yDeck + Hh, len = n * pitch + B * 0.32, W = B * 1.5;
    const yBlock0 = L - r - B * 0.3, yRail = -r - B * 0.55;
    // Block with bores, open crankcase, bulkheads, oil pan.
    const bores = X.map(x => circle2(B / 2, 48, x, 0));
    A.part("block", plate(roundRect2(len, W, B * 0.12, 4), yDeck - yBlock0, { holes: bores, y0: yBlock0, bevelSegments: 1 }), { material: M("block", "aluminum"), explode: [0, 0, 0], label: { text: "cylinder block", at: [X[0] - pitch * 0.4, (yDeck + yBlock0) / 2, W / 2] }, note: `${n} cylinders, ${B} mm across, bored straight through the block` });
    const cw = W * 1.12, inner = roundRect2(len - B * 0.16, cw - B * 0.16, B * 0.06, 3);
    const bulk = X.concat(X[n - 1] + pitch).map(x0 => x0 - pitch / 2).map(x => xf(mesh.extrude([[-cw / 2 + 2, yBlock0 + 1], [-cw / 2 + 2, yRail + 6], [-B * 0.42, yRail + 6], [-B * 0.42, -B * 0.32], [B * 0.42, -B * 0.32], [B * 0.42, yRail + 6], [cw / 2 - 2, yRail + 6], [cw / 2 - 2, yBlock0 + 1]], B * 0.16, { holes: [circle2(B * 0.31, 32, 0, 0)], bevel: 1 }), T([x, 0, 0]), RY(-Math.PI / 2)));
    A.part("crankcase", merge(plate(roundRect2(len, cw, B * 0.1, 4), yBlock0 - yRail, { holes: [inner], y0: yRail, bevelSegments: 1 }), bulk), { material: M("block", "aluminum"), label: { text: "crankcase", at: [X[n - 1] + pitch * 0.4, (yRail + yBlock0) / 2, cw / 2] }, note: "the lower block; bulkheads carry the main bearings" });
    const pan = merge(plate(roundRect2(len - 8, cw - 8, B * 0.1, 4), B * 0.55, { holes: [roundRect2(len - 18, cw - 18, B * 0.06, 3)], y0: yRail - B * 0.55, bevelSegments: 1 }), plate(roundRect2(len - 8, cw - 8, B * 0.1, 4), 3, { y0: yRail - B * 0.55 - 3, bevel: 1, bevelSegments: 1 }));
    A.part("oil pan", pan, { material: M("pan", "steel"), explode: [0, -B * 1.6, 0], label: { text: "oil pan", at: [0, yRail - B * 0.3, (cw - 8) / 2] }, note: "holds the oil the crank splashes and the pump draws up" });
    // Head and cam cover.
    A.part("cylinder head", xf(mesh.box(len, Hh, W * 0.98, { round: B * 0.05 }), T([0, yDeck + Hh / 2 + 0.3, 0])), { material: M("head", "aluminum"), explode: [0, B * 1.4, 0], label: { text: "cylinder head", at: [X[0] - pitch * 0.4, yDeck + Hh * 0.5, W * 0.49] }, note: "closes the cylinders; holds the valves, ports, and spark plugs" });
    // Valves: pent-roof, intake on +z, exhaust on -z, tilted 20 degrees.
    const tilt = (o.valveAngle ?? 20) * DEG, vz = B * 0.24;
    const dI = [0, Math.cos(tilt), Math.sin(tilt)], dE = [0, Math.cos(tilt), -Math.sin(tilt)];
    const seatY = yDeck + 1.2, Lv = Hh + B * 0.2, rb = B * 0.2, lift = o.valveLift ?? B * 0.11, half = 66 * DEG;
    const valveMesh = rv => revolve(fillet([[0, 0], [rv, 0], [rv, 1.2], [rv - 2.2, 3.4, 1], [B * 0.045, rv * 0.95, rv * 0.5], [B * 0.045, Lv - 6], [B * 0.036, Lv - 5], [B * 0.036, Lv - 3], [B * 0.045, Lv - 2], [B * 0.045, Lv], [0, Lv]], { steps: 3 }), { segments: 24 });
    const vI = valveMesh(B * 0.21), vE = valveMesh(B * 0.18);
    const rs = B * 0.13, springL = Hh * 0.42;
    const spr = spring({ radius: rs, wire: B * 0.035, length: springL, coils: 6.5 });
    const bucketH = B * 0.24, bucketR = B * 0.16;
    const bucket = revolve(fillet([[0, 0], [bucketR - 1, 0], [bucketR, 1], [bucketR, bucketH - 1], [bucketR - 1, bucketH], [0, bucketH]]), { segments: 24 });
    const retainer = revolve([[B * 0.045, 0], [rs + 2, 0], [rs + 2, 2], [B * 0.08, 6], [B * 0.045, 6]], { loop: true, segments: 20 });
    const camAxis = d => v3.add([0, seatY, 0], v3.scale(d, Lv + bucketH + rb + 1));
    const camI = v3.add(camAxis(dI), [0, 0, vz]), camE = v3.add(camAxis(dE), [0, 0, -vz]);
    // Cam lobe outline, nose toward +y in the (y, z) plane, made convex.
    const lobe2 = hull2(Array.from({ length: 96 }, (_, i) => {
      const a = (i / 96) * TAU, d = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      const rr = rb + (d < half ? lift * Math.pow(0.5 + 0.5 * Math.cos((Math.PI * d) / half), 1.3) : 0);
      return [rr * Math.cos(a), rr * Math.sin(a)];
    }));
    const lobeMesh = (beta, x) => xf(mesh.extrude(lobe2.map(([y, z]) => [z * Math.cos(beta) + y * Math.sin(beta), y * Math.cos(beta) - z * Math.sin(beta)]), B * 0.17, { bevel: 0.8, bevelSegments: 1 }), T([x, 0, 0]), RY(-Math.PI / 2));
    // Nose angle: the lobe points at its follower (along -d) at the peak of its event.
    const peakE = 255 * DEG, peakI = 465 * DEG;
    const follow = d => Math.atan2(-d[2], -d[1]);
    const cams = [], valves = [];
    const camShaftMesh = (center, d, peak) => {
      const parts = [xf(mesh.cylinder(B * 0.14, len + B * 0.3, { segments: 20 }), RZ(Math.PI / 2))];
      X.forEach((x, i) => {
        parts.push(lobeMesh(follow(d) - (phase[i] + peak) / 2, x));
        parts.push(xf(mesh.cylinder(B * 0.19, B * 0.12, { segments: 24 }), T([x + pitch / 2, 0, 0]), RZ(Math.PI / 2)));
      });
      return merge(parts);
    };
    const lobeLift = (psi, d) => {
      const fa = follow(d);
      let m = -Infinity;
      for (const [y, z] of lobe2) { const a = Math.atan2(z, y) + psi, rr = Math.hypot(y, z); m = Math.max(m, rr * Math.cos(a - fa)); }
      return Math.max(0, m - rb);
    };
    for (const [nm, c, d, peak, vm, side] of [["intake camshaft", camI, dI, peakI, vI, 1], ["exhaust camshaft", camE, dE, peakE, vE, -1]]) {
      const cam = A.part(nm, camShaftMesh(c, d, peak), { position: c, material: M("cam", "steel"), explode: [0, B * 2.6, side * B * 0.5], label: { text: side > 0 ? "camshaft" : "camshaft", at: [X[n - 1] + pitch * 0.25, 0, 0] }, note: "lobes open each valve once every two turns of the crank" });
      cams.push({ node: cam, d, center: c });
      X.forEach((x, i) => {
        const seat = [x, seatY, side * vz], Mv = aim(seat, d);
        const v = A.part(`${side > 0 ? "intake" : "exhaust"} valve ${i + 1}`, vm, { material: M(side > 0 ? "intakeValve" : "exhaustValve", "steel"), explode: [0, B * 1.4, 0], label: i === 0 ? (side > 0 ? "intake valve" : "exhaust valve") : undefined, note: side > 0 ? "lets the fuel-air mixture in" : "lets the burned gas out" });
        const sp = A.part(`valve spring ${side}${i}`, spr, { material: M("spring", "steel"), explode: [0, B * 1.4, 0] });
        const bk = A.part(`bucket ${side}${i}`, merge(bucket, xf(retainer, T([0, -B * 0.06, 0]))), { material: M("tappet", "steel"), explode: [0, B * 2, 0] });
        valves.push({ v, sp, bk, Mv, d, i, side, cam: cams.length - 1 });
      });
    }
    A.part("cam cover", xf(housing({ width: len - 4, height: B * 0.62, depth: W * 0.98, wall: 3.5, round: B * 0.1 }), T([0, yHead + B * 0.31, 0])), { material: M("cover", "porcelain"), explode: [0, B * 3.6, 0], label: { text: "cam cover", at: [X[n - 1], yHead + B * 0.62, 0] }, note: "keeps the oil in around the cams" });
    // Spark plugs between the cams.
    const plug = revolve(fillet([[0, 0], [B * 0.05, 0], [B * 0.05, B * 0.25], [B * 0.08, B * 0.27], [B * 0.08, B * 0.36], [B * 0.06, B * 0.4], [B * 0.055, B * 0.72, 2], [B * 0.04, B * 0.95], [B * 0.025, B * 1.0], [0, B * 1.0]], { steps: 2 }), { segments: 20 });
    A.part("spark plugs", merge(X.map(x => xf(plug, T([x, yDeck + 1, 0])))), { material: M("sparkPlug", "ceramic"), explode: [0, B * 3, 0], label: { text: "spark plug", at: [X[0], yDeck + B * 0.9, 0] }, note: "fires the mixture just before the piston reaches the top" });
    // Crankshaft: mains, pins, webs with counterweights, snout, flange.
    const rm = B * 0.3, rp = B * 0.25, pinW = B * 0.26, webT = B * 0.19;
    const web2 = hull2([...circle2(rp + B * 0.1, 24, 0, r), ...circle2(rm + B * 0.08, 24, 0, 0), ...arc2(0, 0, r * 1.38, -Math.PI / 2 - 1.15, -Math.PI / 2 + 1.15, 16)].map(([zz, yy]) => [zz, yy]));
    const webM = (ang, x) => xf(mesh.extrude(web2.map(([zz, yy]) => [zz * Math.cos(ang) + yy * Math.sin(ang), yy * Math.cos(ang) - zz * Math.sin(ang)]), webT, { bevel: 1.2, bevelSegments: 1 }), T([x, 0, 0]), RY(-Math.PI / 2));
    const cyx = (rad, x0, x1, at = [0, 0]) => xf(mesh.cylinder(rad, x1 - x0, { segments: 28 }), T([(x0 + x1) / 2, at[0], at[1]]), RZ(Math.PI / 2));
    const crankParts = [];
    X.forEach((x, i) => {
      const a = pinA[i], py = r * Math.cos(a), pz = r * Math.sin(a);
      crankParts.push(cyx(rp, x - pinW / 2 - 1, x + pinW / 2 + 1, [py, pz]), webM(-a, x - pinW / 2 - webT / 2), webM(-a, x + pinW / 2 + webT / 2));
      crankParts.push(cyx(rm, x - pitch / 2 - B * 0.12, x - pinW / 2 - webT + 1));
    });
    crankParts.push(cyx(rm, X[n - 1] + pinW / 2 + webT - 1, X[n - 1] + pitch / 2 + B * 0.12));
    const xF = X[0] - pitch / 2 - B * 0.12, xR = X[n - 1] + pitch / 2 + B * 0.12;
    crankParts.push(cyx(B * 0.2, xF - B * 0.9, xF + 1), cyx(B * 0.55, xR - 1, xR + B * 0.12));
    const crank = A.part("crankshaft", merge(crankParts), { material: M("crank", "steel"), explode: [0, -B * 0.9, 0], label: { text: "crankshaft", at: [X[0] - pitch / 2, -rm, 0] }, note: "turns the pistons' up-and-down push into rotation" });
    // Flywheel, front pulley, timing sprockets and belt.
    const fly = merge(xf(gear({ teeth: 120, module: B * 0.03, thickness: B * 0.14, hole: B * 0.2 }), RZ(Math.PI / 2)), xf(revolve(fillet([[B * 0.2, -B * 0.12], [B * 1.6, -B * 0.12, 2], [B * 1.6, B * 0.05, 2], [B * 0.8, B * 0.05, 4], [B * 0.6, B * 0.18, 4], [B * 0.2, B * 0.18]], { closed: true, steps: 2 }), { loop: true, segments: 64 }), RZ(Math.PI / 2)));
    A.part("flywheel", fly, { parent: crank, position: [xR + B * 0.3, 0, 0], material: M("flywheel", "steel"), explode: [B * 1.2, 0, 0], label: { text: "flywheel", at: [0, B * 1.4, 0] }, note: "a heavy disc that smooths the four separate power pulses" });
    const xS = xF - B * 0.35, zc = B * 0.03 * 21 / 2;
    const tooth = B * 0.03 * 1.06;
    const crankSp = xf(gear({ teeth: 21, module: tooth, thickness: B * 0.2, hole: B * 0.15 }), RZ(Math.PI / 2));
    A.part("crank sprocket", crankSp, { parent: crank, position: [xS, 0, 0], material: M("sprocket", "steel"), explode: [-B * 1, 0, 0] });
    const pulley = revolve(fillet([[B * 0.15, 0], [B * 0.85, 0, 1], [B * 0.85, B * 0.3, 1], [B * 0.15, B * 0.3]].concat([]), { closed: true }), { loop: true, segments: 48 });
    const grooves = Array.from({ length: 5 }, (_, k) => revolve([[B * 0.8, B * (0.05 + k * 0.05)], [B * 0.86, B * (0.07 + k * 0.05)], [B * 0.8, B * (0.09 + k * 0.05)], [B * 0.78, B * (0.07 + k * 0.05)]], { loop: true, segments: 48 }));
    A.part("crank pulley", xf(merge(pulley, grooves), T([xS - B * 0.5, 0, 0]), RZ(Math.PI / 2)), { parent: crank, material: M("pulley", "steel"), explode: [-B * 1.6, 0, 0], label: { text: "crank pulley", at: [xS - B * 0.65, B * 0.85, 0] }, note: "drives the alternator and water pump belt" });
    const camSp = xf(gear({ teeth: 42, module: tooth, thickness: B * 0.2, hole: B * 0.15 }), RZ(Math.PI / 2));
    const rsp = (42 * tooth) / 2, rcs = (21 * tooth) / 2;
    cams.forEach(c => A.part("cam sprocket", camSp, { parent: c.node, position: [xS - c.center[0], 0, 0], material: M("sprocket", "steel"), explode: [-B, 0, 0] }));
    const idler = [B * 0.0, (yDeck + yHead) * 0.45];
    const bp = beltPath([
      { c: [0, 0], r: rcs, cw: false },
      { c: [camE[2], camE[1]], r: rsp, cw: false },
      { c: [camI[2], camI[1]], r: rsp, cw: false },
      { c: [B * 0.9, idler[1]], r: B * 0.32, cw: true },
    ]);
    // The path above is in (z, y); turn it into a band in the yz plane at the sprocket face.
    const beltM = xf(belt(bp.points, { width: B * 0.22, thickness: B * 0.05 }), T([xS, 0, 0]), RY(-Math.PI / 2));
    A.part("timing belt", beltM, { material: M("belt", "rubber"), explode: [-B * 2.2, 0, 0], label: { text: "timing belt", at: [xS, (yDeck) * 0.6, B * 0.6] }, note: "keeps the cams turning at exactly half the crank's speed" });
    A.part("belt tensioner", xf(revolve(fillet([[B * 0.05, -B * 0.13], [B * 0.32, -B * 0.13, 2], [B * 0.32, B * 0.13, 2], [B * 0.05, B * 0.13]], { closed: true }), { loop: true, segments: 40 }), T([xS, idler[1], -B * 0.9]), RZ(Math.PI / 2)), { material: M("pulley", "steel"), explode: [-B * 2.2, 0, 0] });
    // Pistons, rings, wrist pins, and rods.
    const Rp = B / 2 - 0.25, sk = B * 0.32;
    const pistonProf = [[0, ch], [Rp - 1.2, ch], [Rp, ch - 1.2]];
    for (const [g0, g1] of [[ch - 5, ch - 7], [ch - 10, ch - 12], [ch - 15, ch - 18]]) pistonProf.push([Rp, g0], [Rp - 3.5, g0], [Rp - 3.5, g1], [Rp, g1]);
    pistonProf.push([Rp, -sk + 1], [Rp - 1, -sk], [Rp - 4, -sk], [Rp - 4, ch - 8, 3], [0, ch - 8]);
    const pistonM = revolve(fillet(pistonProf, { steps: 2 }), { segments: 48 });
    const ringM = merge([[ch - 5, ch - 7], [ch - 10, ch - 12], [ch - 15, ch - 18]].map(([a, b]) => revolve([[Rp - 3.2, b + 0.1], [Rp - 0.05, b + 0.1], [Rp - 0.05, a - 0.1], [Rp - 3.2, a - 0.1]], { loop: true, segments: 48 })));
    const wristR = B * 0.12;
    const wrist = xf(mesh.cylinder(wristR, B * 0.78, { segments: 20 }), RZ(Math.PI / 2));
    const Rb = B * 0.42, Rs = B * 0.2, wb = B * 0.32, wt = B * 0.2;
    const rodShape = fillet([...arc2(0, 0, Rb, Math.PI + 0.45, TAU - 0.45, 14), [Rb * 0.9, Rb * 0.6], [wb / 2, Rb * 1.15, 6], [wt / 2, L - Rs * 1.1, 6], ...arc2(0, L, Rs, -0.3, Math.PI + 0.3, 12), [-wt / 2, L - Rs * 1.1, 6], [-wb / 2, Rb * 1.15, 6], [-Rb * 0.9, Rb * 0.6]], { closed: true, steps: 3 });
    const rodM = merge(
      xf(mesh.extrude(rodShape, pinW - 1.5, { holes: [circle2(rp + 0.4, 32), circle2(wristR + 0.3, 24, 0, L)], bevel: 1.2, bevelSegments: 1 }), RY(-Math.PI / 2)),
      xf(mesh.cylinder(B * 0.05, Rb * 1.5, { segments: 10 }), T([0, -Rb * 0.2, Rb * 0.78])), xf(mesh.cylinder(B * 0.05, Rb * 1.5, { segments: 10 }), T([0, -Rb * 0.2, -Rb * 0.78])),
    );
    const pistons = [], rods = [];
    X.forEach((x, i) => {
      const pn = A.part(`piston ${i + 1}`, merge(pistonM, wrist), { material: M("piston", "aluminum"), explode: [0, B * 4.2, 0], label: i === n - 1 ? "piston" : undefined, note: "pushed down by the burning gas; four strokes make one cycle" });
      A.part(`piston rings ${i + 1}`, ringM, { parent: pn, material: M("rings", "steel") });
      pistons.push(pn);
      rods.push(A.part(`connecting rod ${i + 1}`, rodM, { material: M("rod", "steel"), label: i === n - 1 ? "connecting rod" : undefined, note: "links the piston to the crank pin" }));
    });
    A.cylinders = X.map((x, i) => ({ x, firing: firing.indexOf(i + 1) + 1, phase: phase[i], bore: B, deck: yDeck }));
    A.port("output", crank, [xR + B * 0.42, 0, 0], [1, 0, 0], B * 1.6);
    A.info = { cylinders: n, bore: B, stroke: Sk, rod: L, displacement: (Math.PI / 4) * B * B * Sk * n / 1000, firingOrder: firing, compressionHeight: ch, deck: yDeck };
    const state = { crank: 0 };
    A.onPose = p => {
      if (p.crank != null) state.crank = p.crank;
      const th = state.crank;
      crank.rotation = [th, 0, 0];
      X.forEach((x, i) => {
        const a = th + pinA[i], py = r * Math.cos(a), pz = r * Math.sin(a);
        const yp = py + Math.sqrt(L * L - pz * pz);
        A.home(pistons[i], [x, yp, 0]);
        A.homeMatrix(rods[i], mul(T([x, py, pz]), RX(Math.atan2(-pz, yp - py))));
      });
      cams.forEach(c => { c.node.rotation = [th / 2, 0, 0]; });
      for (const q of valves) {
        const l = lobeLift(th / 2, q.d);
        const Mv = mul(T(v3.scale(q.d, -l)), q.Mv);
        A.homeMatrix(q.v, Mv);
        A.homeMatrix(q.bk, mul(Mv, T([0, Lv, 0])));
        const top = Lv - B * 0.06 - l, bottom = Hh * 0.38;
        A.homeMatrix(q.sp, mul(q.Mv, T([0, bottom, 0]), SC([1, (top - bottom) / springL, 1])));
      }
    };
    const baseExplode = A.explode;
    A.explode = t => { baseExplode(t); A.onPose({}); return A; };
    A.onPose({});
    A.lift = (cyl, which, crankAngle) => lobeLift(crankAngle / 2, which === "intake" ? dI : dE);
    return A;
  }

  // ---------- exports ----------
  E3.parts = {
    // profiles and geometry helpers
    revolve, fillet, roundRect: roundRect2, circle: circle2, arc: arc2, hull: hull2, offset: offset2, resample,
    route, tube: tubeShell, frames, along, aim, flip, Soup, naca, nacaMPT, loft, bellContour, raoAngles, collar,
    // parts
    bolt, nut, washer, boltCircle, flange, pipe, bracket, bearing, shaft, spring, gear, strut, housing, harness,
    bellows, valve, bellNozzle, combustionChamber, injectorPlate, impeller, volute, gimbal, actuator, tank,
    blade, rotorStage, statorStage, spinner, nacelle, nacelleProfile,
    // assemblies
    assembly, highlight, turbopump, rocketEngine, turbofan, pistonEngine, beltPath, belt,
    materials: [...MATERIALS],
  };
})();

;

/* TeX for explainer pages. A small TeX subset becomes MathML in prose
   (<span class="tex"> inline, <div class="tex"> display) and is drawn straight
   onto figure canvases with g.tex(). Reference: references/math.md in the skill. */
(() => {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const PALETTE = ["ink", "muted", "faint", "brass", "red", "orange", "green", "blue", "purple"];

  // ---------- symbols ----------
  const GREEK = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η",
    theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", varkappa: "ϰ", lambda: "λ", mu: "μ", nu: "ν",
    xi: "ξ", omicron: "ο", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς",
    tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  };
  const GREEK_UP = { Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω" };
  const REL = {
    lt: "<", gt: ">", le: "≤", leq: "≤", ge: "≥", geq: "≥", leqslant: "⩽", geqslant: "⩾", ne: "≠", neq: "≠",
    approx: "≈", sim: "∼", simeq: "≃", cong: "≅", equiv: "≡", propto: "∝", ll: "≪", gg: "≫", asymp: "≍", doteq: "≐",
    to: "→", gets: "←", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐",
    Leftrightarrow: "⇔", implies: "⟹", impliedby: "⟸", iff: "⟺", mapsto: "↦", longrightarrow: "⟶",
    longleftarrow: "⟵", longleftrightarrow: "⟷", Longrightarrow: "⟹", Longleftarrow: "⟸", uparrow: "↑",
    downarrow: "↓", updownarrow: "↕", rightleftharpoons: "⇌", rightharpoonup: "⇀", leftharpoonup: "↼",
    in: "∈", notin: "∉", ni: "∋", subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇",
    parallel: "∥", perp: "⊥", mid: "∣", vdash: "⊢", colon: ":",
  };
  const BIN = {
    pm: "±", mp: "∓", times: "×", cdot: "⋅", div: "÷", ast: "∗", star: "⋆", circ: "∘", bullet: "∙",
    cup: "∪", cap: "∩", wedge: "∧", land: "∧", vee: "∨", lor: "∨", oplus: "⊕", ominus: "⊖", otimes: "⊗",
    odot: "⊙", setminus: "∖",
  };
  const ORD = {
    infty: "∞", partial: "∂", nabla: "∇", hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ", aleph: "ℵ", wp: "℘",
    emptyset: "∅", varnothing: "∅", forall: "∀", exists: "∃", nexists: "∄", neg: "¬", lnot: "¬",
    angle: "∠", triangle: "△", square: "□", Box: "□", degree: "°", prime: "′", ldots: "…", dots: "…",
    cdots: "⋯", vdots: "⋮", ddots: "⋱", top: "⊤", bot: "⊥", dagger: "†", ddagger: "‡", S: "§", P: "¶",
    "#": "#", "%": "%", "&": "&", $: "$", _: "_",
  };
  const OPEN = { langle: "⟨", lfloor: "⌊", lceil: "⌈", lbrace: "{", lbrack: "[", lvert: "|", lVert: "‖", "{": "{" };
  const CLOSE = { rangle: "⟩", rfloor: "⌋", rceil: "⌉", rbrace: "}", rbrack: "]", rvert: "|", rVert: "‖", "}": "}" };
  const DELIM = {
    "(": "(", ")": ")", "[": "[", "]": "]", "|": "|", "/": "/", "<": "⟨", ">": "⟩", ".": "",
    "\\{": "{", "\\}": "}", "\\|": "‖", "\\vert": "|", "\\Vert": "‖", "\\uparrow": "↑", "\\downarrow": "↓",
  };
  for (const [k, v] of Object.entries({ ...OPEN, ...CLOSE })) DELIM["\\" + k] = v;
  const BIGOP = { sum: "∑", prod: "∏", coprod: "∐", bigcup: "⋃", bigcap: "⋂", bigvee: "⋁", bigwedge: "⋀", bigoplus: "⨁", bigotimes: "⨂", int: "∫", iint: "∬", iiint: "∭", oint: "∮" };
  const INTEGRAL = new Set(["∫", "∬", "∭", "∮"]);
  const FN = new Set("sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh coth log ln lg exp deg dim ker hom arg sgn".split(" "));
  const LIMOP = { lim: "lim", liminf: "lim inf", limsup: "lim sup", max: "max", min: "min", sup: "sup", inf: "inf", det: "det", gcd: "gcd", Pr: "Pr", argmax: "arg max", argmin: "arg min" };
  const ACCENT = {
    // Spacing accents (U+02C6 and friends) center over the letter; combining ones drift left.
    vec: ["→", false], hat: ["ˆ", false], widehat: ["\u0302", true], bar: ["\u00af", false],
    overline: ["\u203e", true], dot: ["\u02d9", false], ddot: ["\u00a8", false], tilde: ["\u02dc", false],
    widetilde: ["\u02dc", false], check: ["ˇ", false], breve: ["\u02d8", false], acute: ["\u00b4", false],
    grave: ["`", false], overrightarrow: ["→", true], overleftarrow: ["←", true], overleftrightarrow: ["↔", true],
  };
  const BRACE = {
    overbrace: ["⏞", true], underbrace: ["⏟", false], overparen: ["⏜", true], underparen: ["⏝", false],
    overbracket: ["⎴", true], underbracket: ["⎵", false],
  };
  const ARROW_CLASS = { "→": "r", "←": "l", "↔": "lr", "⇌": "eq", "↦": "map", "⇒": "r2", "⇐": "l2" };
  const OVERARROW = { overrightarrow: "r", overleftarrow: "l", overleftrightarrow: "lr" };
  const XARROW = { xrightarrow: "→", xleftarrow: "←", xRightarrow: "⇒", xLeftarrow: "⇐", xleftrightarrow: "↔", xrightleftharpoons: "⇌", xmapsto: "↦" };
  const SPACE = { ",": 3 / 18, ":": 4 / 18, ">": 4 / 18, ";": 5 / 18, " ": 6 / 18, "!": -3 / 18, quad: 1, qquad: 2, enspace: 0.5, thinspace: 3 / 18, medspace: 4 / 18, thickspace: 5 / 18 };
  const VARIANT = {
    mathrm: "normal", mathup: "normal", mathsf: "normal", mathtt: "normal", mathit: "italic", mathbf: "bold",
    boldsymbol: "bolditalic", bm: "bolditalic", mathcal: "script", mathscr: "script", mathbb: "double",
  };
  const TEXT = { text: null, textrm: null, textup: null, textnormal: null, mbox: null, hbox: null, textit: "it", textbf: "bf", textsf: null, texttt: null };
  const BIG = { big: 1.2, Big: 1.8, bigg: 2.4, Bigg: 3 };
  const ENV = {
    matrix: [null, null], smallmatrix: [null, null], pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["{", "}"],
    vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"], cases: ["{", null], rcases: [null, "}"], array: [null, null],
    aligned: [null, null], align: [null, null], "align*": [null, null], split: [null, null],
    gathered: [null, null], gather: [null, null], "gather*": [null, null],
  };
  const NEGATE = { "=": "≠", "<": "≮", ">": "≯", "≤": "≰", "≥": "≱", "∈": "∉", "⊂": "⊄", "⊆": "⊈", "≡": "≢", "∼": "≁", "≈": "≉", "∃": "∄" };

  const RELCH = new Set([..."=<>:", ...Object.values(REL)]);
  const BINCH = new Set([..."+−∗", ...Object.values(BIN)]);

  // ---------- math alphanumerics (U+1D400 block, plus letters that live elsewhere) ----------
  const HOLES = {
    italic: { h: 0x210e },
    script: { B: 0x212c, E: 0x2130, F: 0x2131, H: 0x210b, I: 0x2110, L: 0x2112, M: 0x2133, R: 0x211b, e: 0x212f, g: 0x210a, o: 0x2134 },
    double: { C: 0x2102, H: 0x210d, N: 0x2115, P: 0x2119, Q: 0x211a, R: 0x211d, Z: 0x2124 },
  };
  const LATIN = { bold: 0x1d400, italic: 0x1d434, bolditalic: 0x1d468, script: 0x1d49c, double: 0x1d538 };
  const DIGIT = { bold: 0x1d7ce, double: 0x1d7d8 };
  const GREEK_AT = { italic: [0x1d6e2, 0x1d6fc], bolditalic: [0x1d71c, 0x1d736] }; // capital Alpha, small alpha
  const GREEK_EXTRA = { 0x2202: 25, 0x3f5: 26, 0x3d1: 27, 0x3f0: 28, 0x3d5: 29, 0x3f1: 30, 0x3d6: 31 };
  function styleChar(ch, variant) {
    const c = ch.codePointAt(0);
    const hole = HOLES[variant]?.[ch];
    if (hole) return String.fromCodePoint(hole);
    const L = LATIN[variant];
    if (L != null && c >= 65 && c <= 90) return String.fromCodePoint(L + c - 65);
    if (L != null && c >= 97 && c <= 122) return String.fromCodePoint(L + 26 + c - 97);
    const D = DIGIT[variant];
    if (D != null && c >= 48 && c <= 57) return String.fromCodePoint(D + c - 48);
    const G = GREEK_AT[variant];
    if (G) {
      if (c >= 0x391 && c <= 0x3a9) return String.fromCodePoint(G[0] + c - 0x391);
      if (c >= 0x3b1 && c <= 0x3c9) return String.fromCodePoint(G[1] + c - 0x3b1);
      if (c === 0x2207) return String.fromCodePoint(G[0] + 25);
      if (c in GREEK_EXTRA) return String.fromCodePoint(G[1] + GREEK_EXTRA[c]);
    }
    return ch;
  }
  const styleText = (s, variant) => [...s].map(ch => styleChar(ch, variant)).join("");
  // Letters a single-letter <mi> would italicize (MathML's math-auto), so the canvas matches.
  const autoItalic = ch => /^[A-Za-zα-ωϑϕϖϰϱϵ]$/u.test(ch);

  // ---------- parser: TeX source -> tree ----------
  class TexError extends Error {}
  const fail = msg => { throw new TexError(msg); };
  const row = c => ({ t: "row", c });

  function parse(src) {
    const s = String(src);
    let i = 0;
    let tag = null;
    const CMD = /\\([A-Za-z]+\*?|[^A-Za-z])/y;

    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const peekName = () => { CMD.lastIndex = i; const m = CMD.exec(s); return m ? m[1] : null; };
    const readName = () => {
      CMD.lastIndex = i;
      const m = CMD.exec(s);
      i = CMD.lastIndex;
      if (/^[A-Za-z]/.test(m[1])) ws();
      return m[1];
    };
    const close = () => { ws(); if (s[i] !== "}") fail(i < s.length ? `expected "}" but found "${s[i]}"` : 'missing "}"'); i++; };

    // The raw text of a {...} group, braces balanced.
    function raw() {
      ws();
      if (s[i] !== "{") fail("expected {");
      let depth = 0;
      const start = i + 1;
      for (; i < s.length; i++) {
        if (s[i] === "\\") { i++; continue; }
        if (s[i] === "{") depth++;
        else if (s[i] === "}" && --depth === 0) { i++; return s.slice(start, i - 1); }
      }
      fail('missing "}"');
    }
    // An optional [...] argument, parsed as math.
    function optional() {
      ws();
      if (s[i] !== "[") return null;
      let depth = 0;
      const start = i + 1;
      for (i++; i < s.length; i++) {
        if (s[i] === "{") depth++;
        else if (s[i] === "}") depth--;
        else if (s[i] === "]" && depth === 0) { i++; return parse(s.slice(start, i - 1)).node; }
      }
      fail('missing "]"');
    }

    function argument() {
      ws();
      if (i >= s.length || s[i] === "}" || s[i] === "&") fail("missing argument");
      if (s[i] === "{") { i++; const c = expr(); close(); return row(c); }
      // A single token: TeX reads x^23 as x^{2}3.
      if (/\d/.test(s[i])) return { t: "mn", v: s[i++] };
      return atom() ?? row([]);
    }

    function expr() {
      const list = [];
      for (;;) {
        ws();
        if (i >= s.length) break;
        const ch = s[i];
        if (ch === "}" || ch === "&") break;
        if (ch === "\\") {
          const name = peekName();
          if (name === "\\" || name === "right" || name === "end" || name === "cr") break;
        }
        if (ch === "^" || ch === "_") {
          i++;
          const base = list.pop() ?? row([]);
          list.push(attach(base, ch === "^" ? "sup" : "sub", argument()));
          continue;
        }
        if (ch === "'") {
          // Primes sit beside the letter (the font draws them raised), so f'^2 puts the 2 after the prime.
          let n = 0;
          while (s[i] === "'") { n++; i++; }
          const base = list.pop() ?? row([]);
          list.push(row([base, { t: "mo", v: ["′", "″", "‴"][Math.min(n, 3) - 1], cls: "ord" }]));
          continue;
        }
        const node = atom(list);
        if (node) list.push(node);
      }
      return list;
    }

    function attach(base, slot, arg) {
      if (base.t === "brace" && (slot === "sup") === base.over) return { t: "limit", base, [slot]: arg };
      if (base.t === "scripts") {
        if (!base[slot]) return { ...base, [slot]: arg };
        fail(slot === "sup" ? "double superscript" : "double subscript");
      }
      return { t: "scripts", base, [slot]: arg, limits: !!base.limits };
    }

    function limitsFlag(node) {
      ws();
      const name = peekName();
      if (name === "limits" || name === "nolimits") { readName(); node.limits = name === "limits"; }
      return node;
    }

    function delimiter() {
      ws();
      let key = s[i];
      if (key === "\\") { CMD.lastIndex = i; key = "\\" + CMD.exec(s)[1]; }
      if (!(key in DELIM)) fail(`"${key ?? "end"}" isn't a delimiter`);
      i += key.length;
      if (/^\\[A-Za-z]/.test(key)) ws();
      return DELIM[key];
    }

    function variant(node, v) {
      const walk = n => {
        if (n.t === "mi") return { ...n, variant: v, normal: false };
        if (n.t === "mn") return v === "bold" || v === "double" ? { ...n, variant: v } : n;
        if (n.t === "row") {
          const c = [];
          for (const k of n.c.map(walk)) {
            const last = c[c.length - 1];
            // \mathrm{kg} is one word, not k times g.
            if (k.t === "mi" && last && last.t === "mi") c[c.length - 1] = { ...last, v: last.v + k.v };
            else c.push(k);
          }
          return { ...n, c };
        }
        if (n.t === "scripts") return { ...n, base: walk(n.base) };
        if (n.t === "color" || n.t === "style") return { ...n, body: walk(n.body) };
        return n;
      };
      return walk(node);
    }

    function text(style) {
      const body = raw();
      const parts = [];
      // Math inside text: \text{for all $x$}.
      body.split(/(\$[^$]*\$)/).forEach(p => {
        if (!p) return;
        if (p.startsWith("$") && p.endsWith("$") && p.length > 1) parts.push(parse(p.slice(1, -1)).node);
        else parts.push({ t: "text", v: p.replace(/\\([{}$%&#_ ])/g, "$1").replace(/~/g, "\u00a0"), style });
      });
      return parts.length === 1 ? parts[0] : row(parts);
    }

    function environment(name) {
      if (!(name in ENV)) fail(`unknown environment "${name}"`);
      let cols = null;
      if (name === "array") cols = raw().replace(/[^lcr]/g, "").split("");
      const rows = table();
      ws();
      if (peekName() !== "end") fail(`missing \\end{${name}}`);
      readName();
      const end = raw();
      if (end !== name) fail(`\\begin{${name}} ended by \\end{${end}}`);
      const kind = name.startsWith("align") || name === "split" ? "aligned"
        : name.startsWith("gather") ? "gathered"
        : name.endsWith("cases") ? "cases"
        : name === "array" ? "array" : name === "smallmatrix" ? "smallmatrix" : "matrix";
      const [open, close] = ENV[name];
      return { t: "table", rows, kind, cols, open, close };
    }

    function table() {
      const rows = [[]];
      for (;;) {
        rows[rows.length - 1].push(row(expr()));
        ws();
        if (s[i] === "&") { i++; continue; }
        const name = peekName();
        if (name === "\\" || name === "cr") {
          readName();
          if (s[i] === "[") optional();
          rows.push([]);
          continue;
        }
        break;
      }
      const last = rows[rows.length - 1];
      if (rows.length > 1 && last.length === 1 && !last[0].c.length) rows.pop();
      return rows;
    }

    function atom() {
      const ch = s[i];
      if (ch === "{") { i++; const c = expr(); close(); return row(c); }
      const num = /\d+(?:\.\d+)?|\.\d+/y;
      num.lastIndex = i;
      const m = num.exec(s);
      if (m) { i += m[0].length; return { t: "mn", v: m[0] }; }
      if (ch === "\\") return command();
      const cp = s.codePointAt(i), c = String.fromCodePoint(cp);
      i += c.length;
      if (c === "~") return { t: "space", w: 6 / 18 };
      if (c === "-") return { t: "mo", v: "−", cls: "bin" };
      if (c === "*") return { t: "mo", v: "∗", cls: "bin" };
      if (c === "(" || c === "[") return { t: "mo", v: c, cls: "open" };
      if (c === ")" || c === "]") return { t: "mo", v: c, cls: "close" };
      if (c === "|") return { t: "mo", v: "|", cls: "ord", fence: true };
      if (c === "," || c === ";") return { t: "mo", v: c, cls: "punct" };
      if (c === "!" || c === "?") return { t: "mo", v: c, cls: "close" };
      if (c === "/" || c === ".") return { t: "mo", v: c, cls: "ord" };
      if (RELCH.has(c)) return { t: "mo", v: c, cls: "rel" };
      if (BINCH.has(c)) return { t: "mo", v: c, cls: "bin" };
      if (/\p{L}/u.test(c)) return { t: "mi", v: c };
      if (/\p{N}/u.test(c)) return { t: "mn", v: c };
      if (c === "$" || c === "#") fail(`"${c}" has to be written \\${c}`);
      return { t: "mo", v: c, cls: "ord" };
    }

    function command() {
      const name = readName();
      if (name in GREEK) return { t: "mi", v: GREEK[name] };
      if (name in GREEK_UP) return { t: "mi", v: GREEK_UP[name], normal: true };
      if (name in REL) return { t: "mo", v: REL[name], cls: "rel" };
      if (name in BIN) return { t: "mo", v: BIN[name], cls: "bin" };
      if (name in ORD) return { t: "mi", v: ORD[name], normal: true };
      if (name in OPEN) return { t: "mo", v: OPEN[name], cls: "open" };
      if (name in CLOSE) return { t: "mo", v: CLOSE[name], cls: "close" };
      if (name in SPACE) return { t: "space", w: SPACE[name] };
      if (name === "|" || name === "Vert" || name === "vert") return { t: "mo", v: name === "vert" ? "|" : "‖", cls: "ord", fence: true };
      if (name in BIGOP) return limitsFlag({ t: "mo", v: BIGOP[name], cls: "op", large: true, limits: !INTEGRAL.has(BIGOP[name]) });
      if (FN.has(name)) return { t: "fn", v: name };
      if (name in LIMOP) return limitsFlag({ t: "fn", v: LIMOP[name], limits: true });
      if (name === "operatorname" || name === "operatorname*") return limitsFlag({ t: "fn", v: raw().replace(/\\,|\\ |~/g, " ").trim(), limits: name.endsWith("*") });
      if (name in VARIANT) return variant(argument(), VARIANT[name]);
      if (name in TEXT) return text(TEXT[name]);
      if (name in ACCENT) { const [ch, stretchy] = ACCENT[name]; return { t: "accent", body: argument(), ch, stretchy, kind: name }; }
      if (name === "underline") return { t: "underline", body: argument() };
      if (name in BRACE) { const [ch, over] = BRACE[name]; return { t: "brace", body: argument(), ch, over, kind: name }; }
      if (name in XARROW) { const below = optional(); return { t: "xarrow", ch: XARROW[name], below, above: argument() }; }
      switch (name) {
        case "frac": case "dfrac": case "tfrac": case "cfrac":
          return { t: "frac", num: argument(), den: argument(), style: name === "dfrac" || name === "cfrac" ? "display" : name === "tfrac" ? "text" : null };
        case "binom": case "dbinom": case "tbinom":
          return { t: "fence", open: "(", close: ")", body: { t: "frac", num: argument(), den: argument(), thin: true, style: name === "dbinom" ? "display" : name === "tbinom" ? "text" : null } };
        case "sqrt": { const index = optional(); return { t: "sqrt", index, body: argument() }; }
        case "left": {
          const open = delimiter();
          const body = row(expr());
          if (peekName() !== "right") fail("\\left without a matching \\right");
          readName();
          return { t: "fence", open, close: delimiter(), body, left: true };
        }
        case "right": fail("\\right without a matching \\left"); break;
        case "middle": return { t: "mo", v: delimiter(), cls: "rel", stretchy: true };
        case "color": case "textcolor": {
          const c = raw().trim();
          ws();
          const body = name === "textcolor" || s[i] === "{" ? argument() : row(expr());
          return { t: "color", c, body };
        }
        case "displaystyle": case "textstyle": return { t: "style", display: name === "displaystyle", body: row(expr()) };
        case "boxed": return { t: "box", body: argument() };
        case "cancel": case "bcancel": case "xcancel": return { t: "cancel", body: argument(), kind: name };
        case "phantom": case "hphantom": case "vphantom": return { t: "phantom", body: argument() };
        case "begin": return environment(raw().trim());
        case "end": fail("\\end without a matching \\begin"); break;
        case "not": {
          ws();
          const n = atom();
          if (!n || (n.t !== "mo" && n.t !== "mi")) fail("\\not needs a symbol after it");
          return { t: "mo", v: NEGATE[n.v] ?? n.v + "\u0338", cls: "rel" };
        }
        case "tag": case "tag*": tag = raw().trim(); return null;
        case "label": case "nonumber": case "notag": if (name === "label") raw(); return null;
        case "limits": case "nolimits": return null;
        case "bmod": case "mod": return { t: "mo", v: "mod", cls: "bin" };
        case "pmod": return row([{ t: "space", w: 1 }, { t: "fence", open: "(", close: ")", body: row([{ t: "mi", v: "mod", normal: true }, { t: "space", w: 6 / 18 }, argument()]) }]);
        case "\\": fail("\\\\ (new line) only works between rows of an equation or environment"); break;
        case "{": case "}": return { t: "mo", v: name, cls: name === "{" ? "open" : "close" };
      }
      if (name in BIG || /^(big|Big|bigg|Bigg)[lrm]$/.test(name)) {
        const size = BIG[name.replace(/[lrm]$/, "")];
        const v = delimiter();
        const cls = name.endsWith("l") ? "open" : name.endsWith("r") ? "close" : name.endsWith("m") ? "rel" : "ord";
        return { t: "mo", v, cls, size };
      }
      if (PALETTE.includes(name)) return { t: "color", c: name, body: argument() };
      fail(`unknown command \\${name}`);
    }

    const rows = table();
    ws();
    if (i < s.length) {
      const name = peekName();
      fail(name === "right" ? "\\right without a matching \\left" : name === "end" ? "\\end without a matching \\begin" : `unexpected "${s[i]}"`);
    }
    let node;
    if (rows.length === 1 && rows[0].length === 1) node = rows[0][0];
    else node = { t: "table", rows, kind: rows.some(r => r.length > 1) ? "aligned" : "gathered", open: null, close: null };
    return { node, tag };
  }

  const cache = new Map();
  function parsed(src) {
    let r = cache.get(src);
    if (!r) {
      try { r = parse(src); } catch (e) { if (!(e instanceof TexError)) throw e; r = { error: e.message }; }
      if (cache.size > 500) cache.clear();
      cache.set(src, r);
    }
    return r;
  }

  // ---------- MathML ----------
  const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cssColor = c => (PALETTE.includes(c) ? `var(--${c})` : /^#[0-9a-f]{3,8}$/i.test(c) || /^[a-z]+$/i.test(c) ? c : "inherit");
  const isOpen = n => n && ((n.t === "mo" && n.cls === "open") || (n.t === "fence" && n.open));
  const appliesFn = n => n && (n.t === "fn" && !n.limits || (n.t === "scripts" && n.base.t === "fn" && !n.base.limits));
  const mrow = items => (items.length === 1 ? items[0] : `<mrow>${items.join("")}</mrow>`);

  function ml(n) {
    switch (n.t) {
      case "mi": {
        const v = n.variant && n.variant !== "normal" ? styleText(n.v, n.variant) : n.v;
        const upright = (n.normal || n.variant === "normal") && [...v].length === 1;
        return `<mi${upright ? ' mathvariant="normal"' : ""}>${esc(v)}</mi>`;
      }
      case "mn": return `<mn>${esc(n.variant ? styleText(n.v, n.variant) : n.v)}</mn>`;
      case "mo": {
        let a = "";
        if (n.size) a = ` stretchy="true" symmetric="true" minsize="${n.size}em" maxsize="${n.size}em"`;
        else if (n.stretchy) a = ' stretchy="true" symmetric="true"';
        else if (n.cls === "open" || n.cls === "close" || n.fence) a = ' stretchy="false"';
        // Ordinary symbols (| / . ′) take no operator spacing, as in TeX.
        if (n.cls === "ord" && !n.size && !n.stretchy) a += ' lspace="0" rspace="0"';
        if (n.v === "mod") a += ' lspace="0.2222em" rspace="0.2222em"';
        return `<mo${a}>${esc(n.v)}</mo>`;
      }
      case "fn":
        return n.limits
          ? `<mo form="prefix" movablelimits="true" lspace="0" rspace="0.1667em">${esc(n.v)}</mo>`
          : `<mi>${esc(n.v)}</mi>`;
      case "space": return n.w > 0 ? `<mspace width="${+n.w.toFixed(4)}em"></mspace>` : "";
      case "text": {
        const st = n.style === "it" ? ' style="font-style:italic"' : n.style === "bf" ? ' style="font-weight:bold"' : "";
        // Spaces at the edges of <mtext> collapse; non-breaking ones keep "if x" apart.
        return `<mtext${st}>${esc(n.v.replace(/ /g, "\u00a0"))}</mtext>`;
      }
      case "row": {
        const out = [];
        n.c.forEach((k, j) => {
          out.push(ml(k));
          // sin x: the invisible function application, and TeX's thin space unless a bracket follows.
          if (appliesFn(k)) out.push(`<mo>\u2061</mo>${isOpen(n.c[j + 1]) || !n.c[j + 1] ? "" : '<mspace width="0.1667em"></mspace>'}`);
        });
        return out.length === 1 ? out[0] : `<mrow>${out.join("")}</mrow>`;
      }
      case "scripts": {
        const b = ml(n.base), sub = n.sub && ml(n.sub), sup = n.sup && ml(n.sup);
        if (n.limits) {
          if (sub && sup) return `<munderover>${b}${sub}${sup}</munderover>`;
          return sub ? `<munder>${b}${sub}</munder>` : `<mover>${b}${sup}</mover>`;
        }
        if (sub && sup) return `<msubsup>${b}${sub}${sup}</msubsup>`;
        return sub ? `<msub>${b}${sub}</msub>` : `<msup>${b}${sup}</msup>`;
      }
      case "limit": {
        const b = ml(n.base);
        return n.sup ? `<mover>${b}${ml(n.sup)}</mover>` : `<munder>${b}${ml(n.sub)}</munder>`;
      }
      case "frac": {
        const a = (n.thin ? ' linethickness="0"' : "") + (n.style === "display" ? ' displaystyle="true"' : n.style === "text" ? ' displaystyle="false"' : "");
        return `<mfrac${a}>${ml(n.num)}${ml(n.den)}</mfrac>`;
      }
      case "sqrt": return n.index ? `<mroot>${ml(n.body)}${ml(n.index)}</mroot>` : `<msqrt>${ml(n.body)}</msqrt>`;
      case "fence": {
        const f = (ch, form) => (ch ? `<mo fence="true" form="${form}" stretchy="true" symmetric="true">${esc(ch)}</mo>` : "");
        return `<mrow>${f(n.open, "prefix")}${ml(n.body)}${f(n.close, "postfix")}</mrow>`;
      }
      case "accent": {
        if (n.kind in OVERARROW) return `<mrow class="tex-overarrow tex-arrow-${OVERARROW[n.kind]}">${ml(n.body)}</mrow>`;
        // \vec: a script-sized arrow, nudged right over a slanted letter.
        const b = n.body.t === "row" && n.body.c.length === 1 ? n.body.c[0] : n.body;
        const italic = b.t === "mi" && !b.normal && !b.variant && [...b.v].length === 1 && autoItalic(b.v);
        const st = n.kind === "vec" ? ` style="font-size:0.7em${italic ? ";transform:translateX(0.08em)" : ""}"` : "";
        return `<mover accent="true">${ml(n.body)}<mo stretchy="${n.stretchy}"${st}>${n.ch}</mo></mover>`;
      }
      case "underline": return `<munder accentunder="true">${ml(n.body)}<mo stretchy="true">\u203e</mo></munder>`;
      case "brace": {
        const el = n.over ? "mover" : "munder";
        return `<${el}>${ml(n.body)}<mo stretchy="true">${n.ch}</mo></${el}>`;
      }
      case "xarrow": {
        // Chrome won't stretch an arrow to its labels, so tex.css draws the arrow with
        // gradients across a two-row table; the table centers on the math axis.
        const label = x => `<mrow class="tex-xarrow-label">${ml(x)}</mrow>`;
        const empty = x => !x || (x.t === "row" && !x.c.length);
        const above = empty(n.above) && !empty(n.below) ? `<mphantom>${label(n.below)}</mphantom>` : label(n.above);
        const below = empty(n.below) ? `<mphantom>${above}</mphantom>` : label(n.below);
        return `<mrow class="tex-xarrow tex-arrow-${ARROW_CLASS[n.ch]}"><mtable><mtr><mtd>${above}</mtd></mtr><mtr><mtd>${below}</mtd></mtr></mtable></mrow>`;
      }
      case "color": return `<mrow style="color:${cssColor(n.c)}">${ml(n.body)}</mrow>`;
      case "style": return `<mrow displaystyle="${n.display}">${ml(n.body)}</mrow>`;
      case "box": return `<mrow class="tex-boxed">${ml(n.body)}</mrow>`;
      case "cancel": return `<mrow class="tex-${n.kind}">${ml(n.body)}</mrow>`;
      case "phantom": return `<mphantom>${ml(n.body)}</mphantom>`;
      case "table": {
        const kind = n.kind === "smallmatrix" ? "matrix tex-small" : n.kind;
        const align = n.cols ? n.cols : null;
        const body = n.rows.map(r => `<mtr>${r.map((cell, j) => {
          let c = cell;
          // "&= b": the relation after & spaces like it follows something, as TeX's {} = would.
          if (n.kind === "aligned" && j % 2 === 1 && c.c.length && c.c[0].t === "mo") c = row([row([]), ...c.c]);
          const al = align && align[j] ? ` class="tex-${{ l: "left", c: "center", r: "right" }[align[j]]}"` : "";
          return `<mtd${al}>${ml(c)}</mtd>`;
        }).join("")}</mtr>`).join("");
        const t = `<mtable class="tex-${kind}">${body}</mtable>`;
        if (!n.open && !n.close) return t;
        const f = (ch, form) => (ch ? `<mo fence="true" form="${form}" stretchy="true" symmetric="true">${esc(ch)}</mo>` : "");
        return `<mrow>${f(n.open, "prefix")}${t}${f(n.close, "postfix")}</mrow>`;
      }
    }
    return "";
  }

  function convert(src, display) {
    const r = parsed(String(src).trim());
    const alt = esc(String(src).replace(/\s+/g, " ").trim());
    if (r.error) return { error: r.error, html: `<code class="tex-error" title="TeX error: ${esc(r.error)}">${esc(src)}</code>` };
    return { tag: r.tag, html: `<math${display ? ' display="block"' : ""} alttext="${alt}">${ml(r.node)}</math>` };
  }

  const toMathML = (src, o = {}) => convert(src, !!o.display).html;

  function typeset(root = W.document?.body) {
    if (!root || !root.querySelectorAll) return 0;
    const els = [...(root.matches?.(".tex") ? [root] : []), ...root.querySelectorAll(".tex")];
    let n = 0;
    for (const el of els) {
      if (el.hasAttribute("data-tex")) continue;
      const src = el.textContent.trim();
      const display = el.classList.contains("display") || el.tagName === "DIV" || el.tagName === "P";
      const r = convert(src, display);
      el.setAttribute("data-tex", src);
      if (r.tag) el.setAttribute("data-number", r.tag);
      // Display math scrolls inside its own box, so an equation number beside it stays put.
      el.innerHTML = display && !r.error ? `<span class="tex-scroll">${r.html}</span>` : r.html;
      if (r.error) {
        errors.push({ src, message: r.error });
        console.error(`[tex] ${r.error} in "${src}"`);
      }
      n++;
    }
    if (n) trimRadicals(root);
    return n;
  }
  const errors = [];

  // Chrome leaves about 0.45em of empty space after <msqrt> and <mroot>. Measure
  // it and pull the next symbol back in; browsers without the gap are left alone.
  function trimRadicals(root) {
    const fix = () => {
      for (const m of root.querySelectorAll(".tex msqrt, .tex mroot")) {
        m.style.marginInlineEnd = "";
        const base = m.tagName === "mroot" ? [m.firstElementChild] : [...m.children];
        const right = Math.max(...base.filter(Boolean).map(c => c.getBoundingClientRect().right));
        const em = parseFloat(getComputedStyle(m).fontSize) || 16;
        const gap = (m.getBoundingClientRect().right - right) / em;
        if (gap > 0.15) m.style.marginInlineEnd = `${-(gap - 0.08).toFixed(3)}em`;
      }
    };
    fix();
    W.document?.fonts?.ready?.then(fix);
  }

  // ---------- canvas: tree -> boxes ----------
  // Sizes in px; em = the current font size. Constants follow the STIX Two Math font.
  const AXIS = 0.258, RULE = 0.066, SCALE = [1, 0.7, 0.5];
  const MU = 1 / 18;
  // TeX's inter-atom spacing in mu (thin 3, medium 4, thick 5), text style.
  const GAP = {
    ord: { op: 3, bin: 4, rel: 5 }, op: { ord: 3, op: 3, rel: 5 }, bin: { ord: 4, op: 4, open: 4 },
    rel: { ord: 5, op: 5, open: 5 }, close: { op: 3, bin: 4, rel: 5 }, punct: { ord: 3, op: 3, rel: 3, open: 3, close: 3, punct: 3 },
  };

  let mathFamily = null;
  const family = () => {
    if (!mathFamily) {
      const v = W.document && W.getComputedStyle ? W.getComputedStyle(W.document.documentElement).getPropertyValue("--font-math").trim() : "";
      mathFamily = v || '"Safis Math", "STIX Two Math", "Cambria Math", serif';
    }
    return mathFamily;
  };

  function boxes(ctx, util) {
    const measure = (str, font) => {
      ctx.font = font;
      const m = ctx.measureText(str);
      return { w: m.width, a: Math.max(0, m.actualBoundingBoxAscent ?? 0), d: Math.max(0, m.actualBoundingBoxDescent ?? 0) };
    };
    const sizeOf = env => env.base * SCALE[Math.min(env.level, 2)];
    const deeper = (env, k = 1) => ({ ...env, level: env.level + k });

    function glyph(str, env, o = {}) {
      const S = sizeOf(env) * (o.scale ?? 1);
      const font = `${o.style ?? ""} ${S}px ${o.family ?? family()}`.trim();
      const m = measure(str, font);
      const color = env.color;
      return { ...m, cls: o.cls ?? "ord", italic: !!o.italic, S,
        draw(p, x, y) { p.text(str, font, color, x, y); } };
    }
    const empty = cls => ({ w: 0, a: 0, d: 0, cls: cls ?? "ord", draw() {} });

    function hrow(items, env, display) {
      const S = sizeOf(env);
      const out = [];
      let x = 0, a = 0, d = 0, prev = null;
      items.forEach((b, j) => {
        let cls = b.cls;
        if (cls === "bin" && (!prev || ["bin", "op", "rel", "open", "punct"].includes(prev) || !items[j + 1] || ["rel", "close", "punct"].includes(items[j + 1].cls))) cls = "ord";
        if (prev) {
          const g = (GAP[prev] ?? {})[cls] ?? 0;
          // Scripts keep only thin spaces, as in TeX.
          if (g && (env.level === 0 || g === 3)) x += g * MU * S;
        }
        out.push([b, x]);
        x += b.w;
        a = Math.max(a, b.a);
        d = Math.max(d, b.d);
        prev = cls;
      });
      return { w: x, a, d, cls: items.length === 1 ? items[0].cls : "ord", italic: items.length === 1 && items[0].italic,
        draw(p, X, Y) { for (const [b, dx] of out) b.draw(p, X + dx, Y); } };
    }

    function lay(n, env) {
      const S = sizeOf(env);
      switch (n.t) {
        case "mi": {
          let v = n.v;
          if (n.variant && n.variant !== "normal") v = styleText(v, n.variant);
          else if (!n.normal && n.variant !== "normal" && [...v].length === 1 && autoItalic(v)) return glyph(styleChar(v, "italic"), env, { italic: true });
          return glyph(v, env);
        }
        case "mn": return glyph(n.variant ? styleText(n.v, n.variant) : n.v, env);
        case "mo": {
          if (n.size || n.stretchy) {
            const half = Math.max(n.size ? n.size * S / 2 : S * 0.6, S * 0.5);
            return delim(n.v, half, env, n.cls);
          }
          if (n.large) {
            const g = glyph(n.v, env, { scale: env.display ? 1.45 : 1.05, cls: "op" });
            const shift = (g.a - g.d) / 2 - AXIS * S; // center on the math axis
            return { ...g, a: g.a - shift, d: g.d + shift, draw(p, x, y) { g.draw(p, x, y + shift); } };
          }
          return glyph(n.v, env, { cls: n.v === "mod" ? "bin" : n.cls });
        }
        case "fn": return glyph(n.v, env, { cls: "op" });
        case "space": return { ...empty("space"), w: Math.max(0, n.w * S), cls: "ord" };
        case "text": return glyph(n.v, env, { family: util.fontSerif, style: n.style === "it" ? "italic" : n.style === "bf" ? "bold" : "" });
        case "row": return hrow(n.c.map(k => lay(k, env)).filter(Boolean), env);
        case "style": return lay(n.body, { ...env, display: n.display });
        case "color": return lay(n.body, { ...env, color: util.color(n.c) });
        case "phantom": { const b = lay(n.body, env); return { ...b, draw() {} }; }
        case "scripts": return scripts(n, env);
        case "limit": return limits(lay(n.base, env), n.sub && lay(n.sub, deeper(env)), n.sup && lay(n.sup, deeper(env)), env);
        case "frac": return frac(n, env);
        case "sqrt": return sqrt(n, env);
        case "fence": {
          const body = lay(n.body, env);
          const half = Math.max(body.a - AXIS * S, body.d + AXIS * S) + 0.08 * S;
          const parts = [n.open ? delim(n.open, half, env, "open") : null, body, n.close ? delim(n.close, half, env, "close") : null].filter(Boolean);
          return hrow(parts, env);
        }
        case "accent": return accent(n, env);
        case "underline": {
          const b = lay(n.body, env), t = Math.max(1, RULE * S), y = b.d + 0.12 * S;
          return { ...b, d: y + t, draw(p, x, Y) { b.draw(p, x, Y); p.line([[x, Y + y], [x + b.w, Y + y]], t, env.color); } };
        }
        case "brace": return brace(n, env);
        case "xarrow": return xarrow(n, env);
        case "box": {
          const b = lay(n.body, env), pad = 0.22 * S, t = Math.max(1, RULE * S);
          return { w: b.w + 2 * pad, a: b.a + pad, d: b.d + pad, cls: "ord",
            draw(p, x, y) { b.draw(p, x + pad, y); p.line([[x, y - b.a - pad], [x + b.w + 2 * pad, y - b.a - pad], [x + b.w + 2 * pad, y + b.d + pad], [x, y + b.d + pad]], t, env.color, true); } };
        }
        case "cancel": {
          const b = lay(n.body, env), t = Math.max(1, RULE * S);
          return { ...b, draw(p, x, y) {
            b.draw(p, x, y);
            if (n.kind !== "bcancel") p.line([[x, y + b.d], [x + b.w, y - b.a]], t, env.color);
            if (n.kind !== "cancel") p.line([[x, y - b.a], [x + b.w, y + b.d]], t, env.color);
          } };
        }
        case "table": return table(n, env);
      }
      return empty();
    }

    function scripts(n, env) {
      const base = lay(n.base, env);
      const S = sizeOf(env), se = deeper(env);
      const sub = n.sub && lay(n.sub, se), sup = n.sup && lay(n.sup, se);
      if (n.limits && (env.display || n.base.limits === true && n.base.t === "mo" && INTEGRAL.has(n.base.v))) return limits(base, sub, sup, env);
      let u = sup ? Math.max(base.a - 0.3 * sizeOf(se), 0.36 * S, sup.d + 0.12 * S) : 0;
      let v = sub ? Math.max(base.d + 0.05 * S, 0.16 * S, sub.a - 0.36 * S) : 0;
      if (sup && sub) {
        const gap = (u - sup.d) - (sub.a - v);
        if (gap < 0.16 * S) v += 0.16 * S - gap;
      }
      const kern = base.italic ? 0.06 * S : 0;
      const w = base.w + Math.max(sup ? sup.w + kern : 0, sub ? sub.w : 0) + 0.04 * S;
      return { w, a: Math.max(base.a, sup ? u + sup.a : 0), d: Math.max(base.d, sub ? v + sub.d : 0), cls: base.cls,
        draw(p, x, y) {
          base.draw(p, x, y);
          if (sup) sup.draw(p, x + base.w + kern, y - u);
          if (sub) sub.draw(p, x + base.w, y + v);
        } };
    }

    function limits(base, under, over, env) {
      const S = sizeOf(env), gap = 0.12 * S;
      const w = Math.max(base.w, under ? under.w : 0, over ? over.w : 0);
      const a = base.a + (over ? gap + over.d + over.a : 0), d = base.d + (under ? gap + under.a + under.d : 0);
      return { w, a, d, cls: base.cls,
        draw(p, x, y) {
          base.draw(p, x + (w - base.w) / 2, y);
          if (over) over.draw(p, x + (w - over.w) / 2, y - base.a - gap - over.d);
          if (under) under.draw(p, x + (w - under.w) / 2, y + base.d + gap + under.a);
        } };
    }

    function frac(n, env) {
      const S = sizeOf(env);
      const display = n.style === "display" || (n.style !== "text" && env.display);
      const inner = display ? { ...env, display: false } : deeper(env);
      const num = lay(n.num, inner), den = lay(n.den, inner);
      const t = n.thin ? 0 : Math.max(1, RULE * S), gap = (display ? 0.2 : 0.11) * S, ax = AXIS * S, pad = 0.1 * S;
      const up = ax + t / 2 + gap + num.d, down = -ax + t / 2 + gap + den.a;
      const w = Math.max(num.w, den.w) + 2 * pad;
      return { w, a: up + num.a, d: down + den.d, cls: "ord",
        draw(p, x, y) {
          num.draw(p, x + (w - num.w) / 2, y - up);
          den.draw(p, x + (w - den.w) / 2, y + down);
          if (t) p.line([[x + pad * 0.4, y - ax], [x + w - pad * 0.4, y - ax]], t, env.color);
        } };
    }

    function sqrt(n, env) {
      const S = sizeOf(env), body = lay(n.body, env);
      const t = Math.max(1, RULE * S), gap = (env.display ? 0.18 : 0.12) * S;
      const top = body.a + gap + t / 2, bottom = Math.max(body.d, 0.05 * S) + 0.06 * S, H = top + bottom;
      const rw = 0.5 * S + 0.06 * H;
      const index = n.index && lay(n.index, deeper(env, 2));
      const shift = index ? Math.max(0, index.w - 0.45 * rw) : 0;
      const w = shift + rw + body.w + 0.12 * S;
      return { w, a: Math.max(top + t / 2, index ? 0.6 * H - bottom + index.a + index.d : 0), d: bottom, cls: "ord",
        draw(p, x, y) {
          const X = x + shift;
          p.line([[X, y + bottom - 0.42 * H], [X + 0.16 * rw, y + bottom - 0.5 * H], [X + 0.48 * rw, y + bottom], [X + rw, y - top], [X + rw + body.w + 0.12 * S, y - top]], t * 1.1, env.color);
          body.draw(p, X + rw + 0.04 * S, y);
          if (index) index.draw(p, X + 0.45 * rw - index.w, y + bottom - 0.6 * H - index.d);
        } };
    }

    function accent(n, env) {
      const S = sizeOf(env), b = lay(n.body, env), t = Math.max(1, RULE * S);
      const skew = b.italic ? 0.08 * S : 0;
      const wide = n.stretchy;
      const wd = wide ? Math.max(b.w, 0.4 * S) : Math.min(Math.max(b.w * 0.8, 0.36 * S), 0.5 * S);
      const lift = Math.max(b.a, 0.46 * S) + 0.1 * S;
      const hgt = { vec: 0.2, overrightarrow: 0.2, overleftarrow: 0.2, overleftrightarrow: 0.2, dot: 0.12, ddot: 0.12, bar: 0.06, overline: 0.06 }[n.kind] ?? 0.18;
      return { ...b, a: lift + hgt * S + t, cls: b.cls,
        draw(p, x, y) {
          b.draw(p, x, y);
          const cx = x + b.w / 2 + skew, y0 = y - lift, c = env.color;
          const L = cx - wd / 2, R = cx + wd / 2, h = hgt * S;
          const head = (tip, dir) => { const k = 0.13 * S; p.line([[tip[0] - dir * k, tip[1] - k * 0.6], tip, [tip[0] - dir * k, tip[1] + k * 0.6]], t, c); };
          switch (n.kind) {
            case "vec": case "overrightarrow": p.line([[L, y0 - h / 2], [R, y0 - h / 2]], t, c); head([R, y0 - h / 2], 1); break;
            case "overleftarrow": p.line([[L, y0 - h / 2], [R, y0 - h / 2]], t, c); head([L, y0 - h / 2], -1); break;
            case "overleftrightarrow": p.line([[L, y0 - h / 2], [R, y0 - h / 2]], t, c); head([R, y0 - h / 2], 1); head([L, y0 - h / 2], -1); break;
            case "hat": case "widehat": p.line([[L, y0], [cx, y0 - h], [R, y0]], t, c); break;
            case "check": p.line([[L, y0 - h], [cx, y0], [R, y0 - h]], t, c); break;
            case "bar": case "overline": p.line([[wide ? x : L, y0 - h / 2], [wide ? x + b.w : R, y0 - h / 2]], t, c); break;
            case "dot": p.dot([cx, y0 - h / 2], 0.065 * S, c); break;
            case "ddot": p.dot([cx - 0.12 * S, y0 - h / 2], 0.065 * S, c); p.dot([cx + 0.12 * S, y0 - h / 2], 0.065 * S, c); break;
            case "tilde": case "widetilde": {
              const pts = [];
              for (let k = 0; k <= 16; k++) pts.push([L + (wd * k) / 16, y0 - h / 2 - Math.sin((k / 16) * Math.PI * 2) * h * 0.4]);
              p.line(pts, t, c);
              break;
            }
            case "breve": {
              const pts = [];
              for (let k = 0; k <= 12; k++) pts.push([L + (wd * k) / 12, y0 - h + Math.sin((k / 12) * Math.PI) * h]);
              p.line(pts, t, c);
              break;
            }
            case "acute": p.line([[cx - 0.06 * S, y0], [cx + 0.1 * S, y0 - h]], t, c); break;
            case "grave": p.line([[cx + 0.06 * S, y0], [cx - 0.1 * S, y0 - h]], t, c); break;
          }
        } };
    }

    function braceShape(p, x0, x1, y, h, up, t, c) {
      // A horizontal curly brace from x0 to x1; tips at y, cusp pointing away from the body.
      const m = (x0 + x1) / 2, s = up ? -1 : 1, pts = [];
      const q = (a, b, ctl, n = 8) => { for (let k = 0; k <= n; k++) { const u = k / n; pts.push([(1 - u) * (1 - u) * a[0] + 2 * u * (1 - u) * ctl[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * u * (1 - u) * ctl[1] + u * u * b[1]]); } };
      const r = Math.min(h * 0.5, (x1 - x0) / 6);
      q([x0, y], [x0 + r, y + s * h * 0.5], [x0, y + s * h * 0.5]);
      q([m - r, y + s * h * 0.5], [m, y + s * h], [m, y + s * h * 0.5]);
      q([m, y + s * h], [m + r, y + s * h * 0.5], [m, y + s * h * 0.5]);
      q([x1 - r, y + s * h * 0.5], [x1, y], [x1, y + s * h * 0.5]);
      p.line(pts, t, c);
    }

    function brace(n, env) {
      const S = sizeOf(env), b = lay(n.body, env), t = Math.max(1, RULE * S), h = 0.32 * S, gap = 0.1 * S;
      return { ...b, a: n.over ? b.a + gap + h : b.a, d: n.over ? b.d : b.d + gap + h, cls: "ord",
        draw(p, x, y) {
          b.draw(p, x, y);
          if (n.over) braceShape(p, x, x + b.w, y - b.a - gap, h, true, t, env.color);
          else braceShape(p, x, x + b.w, y + b.d + gap, h, false, t, env.color);
        } };
    }

    function xarrow(n, env) {
      const S = sizeOf(env), se = deeper(env), t = Math.max(1, RULE * S);
      const above = lay(n.above, se), below = n.below && lay(n.below, se);
      const w = Math.max(above.w, below ? below.w : 0) + 0.8 * S, ax = AXIS * S;
      const arrow = { w, a: ax + 0.15 * S, d: Math.max(0, -ax + 0.15 * S), cls: "rel",
        draw(p, x, y) {
          const Y = y - ax, k = 0.14 * S, c = env.color;
          if (n.ch === "⇌") {
            p.line([[x, Y - 0.08 * S], [x + w, Y - 0.08 * S], [x + w - k, Y - 0.08 * S - k * 0.7]], t, c);
            p.line([[x + w, Y + 0.08 * S], [x, Y + 0.08 * S], [x + k, Y + 0.08 * S + k * 0.7]], t, c);
            return;
          }
          const double = n.ch === "⇒" || n.ch === "⇐";
          for (const off of double ? [-0.07 * S, 0.07 * S] : [0]) p.line([[x, Y + off], [x + w, Y + off]], t, c);
          const tip = (X, dir) => p.line([[X - dir * k, Y - k * 0.7], [X, Y], [X - dir * k, Y + k * 0.7]], t, c);
          if (n.ch === "→" || n.ch === "⇒" || n.ch === "↔" || n.ch === "↦") tip(x + w, 1);
          if (n.ch === "←" || n.ch === "⇐" || n.ch === "↔") tip(x, -1);
          if (n.ch === "↦") p.line([[x, Y - k * 0.7], [x, Y + k * 0.7]], t, c);
        } };
      const box = limits(arrow, below, above, env);
      box.cls = "rel";
      return box;
    }

    function delim(ch, half, env, cls) {
      const S = sizeOf(env), ax = AXIS * S, t = Math.max(1, RULE * S) * 1.15;
      const wide = { "(": 0.36, ")": 0.36, "[": 0.3, "]": 0.3, "{": 0.46, "}": 0.46, "⟨": 0.36, "⟩": 0.36, "|": 0.24, "‖": 0.36, "⌊": 0.3, "⌋": 0.3, "⌈": 0.3, "⌉": 0.3, "/": 0.4 }[ch] ?? 0.36;
      const w = wide * S + 0.06 * S;
      if (!ch) return { w: 0.1 * S, a: 0, d: 0, cls, draw() {} };
      if (!(ch in { "(": 1, ")": 1, "[": 1, "]": 1, "{": 1, "}": 1, "⟨": 1, "⟩": 1, "|": 1, "‖": 1, "⌊": 1, "⌋": 1, "⌈": 1, "⌉": 1, "/": 1 })) return glyph(ch, env, { cls });
      return { w, a: ax + half, d: half - ax, cls,
        draw(p, x, y) {
          const T = y - ax - half, B = y - ax + half, M = y - ax, c = env.color;
          const L = x + 0.08 * S, R = x + w - 0.08 * S, C = (L + R) / 2;
          const curve = (a, ctl, b) => { const pts = []; for (let k = 0; k <= 16; k++) { const u = k / 16; pts.push([(1 - u) * (1 - u) * a[0] + 2 * u * (1 - u) * ctl[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * u * (1 - u) * ctl[1] + u * u * b[1]]); } return pts; };
          switch (ch) {
            case "(": p.line(curve([R, T], [L - 0.1 * S, M], [R, B]), t, c); break;
            case ")": p.line(curve([L, T], [R + 0.1 * S, M], [L, B]), t, c); break;
            case "[": p.line([[R, T], [L + 0.04 * S, T], [L + 0.04 * S, B], [R, B]], t, c); break;
            case "]": p.line([[L, T], [R - 0.04 * S, T], [R - 0.04 * S, B], [L, B]], t, c); break;
            case "⌊": p.line([[L + 0.04 * S, T], [L + 0.04 * S, B], [R, B]], t, c); break;
            case "⌋": p.line([[R - 0.04 * S, T], [R - 0.04 * S, B], [L, B]], t, c); break;
            case "⌈": p.line([[R, T], [L + 0.04 * S, T], [L + 0.04 * S, B]], t, c); break;
            case "⌉": p.line([[L, T], [R - 0.04 * S, T], [R - 0.04 * S, B]], t, c); break;
            case "⟨": p.line([[R, T], [L, M], [R, B]], t, c); break;
            case "⟩": p.line([[L, T], [R, M], [L, B]], t, c); break;
            case "|": p.line([[C, T], [C, B]], t, c); break;
            case "‖": p.line([[C - 0.07 * S, T], [C - 0.07 * S, B]], t, c); p.line([[C + 0.07 * S, T], [C + 0.07 * S, B]], t, c); break;
            case "/": p.line([[R, T], [L, B]], t, c); break;
            case "{": case "}": {
              const tip = ch === "{" ? L : R, body = (L + R) / 2, end = ch === "{" ? R : L;
              const r = Math.min(0.18 * S, half * 0.3);
              const pts = [
                ...curve([end, T], [body, T], [body, T + r]),
                ...curve([body, M - r], [body, M], [tip, M]),
                ...curve([tip, M], [body, M], [body, M + r]),
                ...curve([body, B - r], [body, B], [end, B]),
              ];
              p.line(pts, t, c);
              break;
            }
          }
        } };
    }

    function table(n, env) {
      const S = sizeOf(env);
      const cellEnv = n.kind === "smallmatrix" ? deeper(env) : env;
      const cells = n.rows.map(r => r.map(c => lay(c, cellEnv)));
      const ncol = Math.max(...cells.map(r => r.length));
      const colW = Array.from({ length: ncol }, (_, j) => Math.max(0, ...cells.map(r => (r[j] ? r[j].w : 0))));
      const aligned = n.kind === "aligned";
      const colGap = j => (aligned ? (j % 2 === 0 ? 0 : 1.2 * S) : n.kind === "cases" ? 1 * S : 0.8 * S);
      const rowGap = (n.kind === "matrix" || n.kind === "smallmatrix" ? 0.28 : 0.4) * S;
      const xs = [];
      let X = 0;
      colW.forEach((cw, j) => { xs.push(X); X += cw + (j < ncol - 1 ? colGap(j) : 0); });
      const rowsH = cells.map(r => [Math.max(0.6 * S, ...r.map(b => b.a)), Math.max(0.2 * S, ...r.map(b => b.d))]);
      const H = rowsH.reduce((s, [a, d]) => s + a + d, 0) + rowGap * (rowsH.length - 1);
      const align = j => (n.cols ? { l: "left", c: "center", r: "right" }[n.cols[j]] : aligned ? (j % 2 === 0 ? "right" : "left") : n.kind === "cases" ? "left" : "center");
      const ax = AXIS * S;
      const tableBox = { w: X, a: H / 2 + ax, d: H / 2 - ax, cls: "ord",
        draw(p, x, y) {
          let Y = y - ax - H / 2;
          cells.forEach((r, i) => {
            const [ra, rd] = rowsH[i];
            r.forEach((b, j) => {
              const al = align(j);
              const off = al === "left" ? 0 : al === "right" ? colW[j] - b.w : (colW[j] - b.w) / 2;
              b.draw(p, x + xs[j] + off, Y + ra);
            });
            Y += ra + rd + rowGap;
          });
        } };
      if (!n.open && !n.close) return tableBox;
      const half = H / 2 + 0.1 * S;
      return hrow([n.open ? delim(n.open, half, env, "open") : null, tableBox, n.close ? delim(n.close, half, env, "close") : null].filter(Boolean), env);
    }

    return { lay };
  }

  // A painter draws boxes in two passes: halo strokes first, then ink.
  function painter(ctx, pass, halo, haloWidth) {
    return {
      text(str, font, color, x, y) {
        ctx.font = font;
        if (pass === 0) { if (!halo) return; ctx.lineWidth = haloWidth; ctx.lineJoin = "round"; ctx.strokeStyle = halo; ctx.strokeText(str, x, y); return; }
        ctx.fillStyle = color;
        ctx.fillText(str, x, y);
      },
      line(pts, width, color, closed) {
        if (pass === 0 && !halo) return;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
        if (closed) ctx.closePath();
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.setLineDash([]);
        ctx.lineWidth = pass === 0 ? width + haloWidth : width;
        ctx.strokeStyle = pass === 0 ? halo : color;
        ctx.stroke();
      },
      dot(c, r, color) {
        if (pass === 0 && !halo) return;
        ctx.beginPath();
        ctx.arc(c[0], c[1], pass === 0 ? r + haloWidth / 2 : r, 0, Math.PI * 2);
        ctx.fillStyle = pass === 0 ? halo : color;
        ctx.fill();
      },
    };
  }

  function layoutTex(ctx, util, str, o) {
    const r = parsed(String(str));
    const size = o.size ?? 16;
    const env = { base: size, level: 0, display: !!o.display, color: util.color(o.color ?? "ink") };
    if (r.error) {
      const font = `${size * 0.8}px ${util.fontMono}`;
      ctx.font = font;
      const w = ctx.measureText(String(str)).width;
      return { w, a: size * 0.6, d: size * 0.2, draw(p, x, y) { p.text(String(str), font, util.color("red"), x, y); } };
    }
    return boxes(ctx, util).lay(r.node, env);
  }

  function install(g, util) {
    const ctx = g.ctx;
    g.measureTex = (str, o = {}) => {
      ctx.save();
      const b = layoutTex(ctx, util, str, o);
      ctx.restore();
      return { w: b.w, h: b.a + b.d, ascent: b.a, descent: b.d };
    };
    g.tex = (str, p, o = {}) => {
      ctx.save();
      const b = layoutTex(ctx, util, str, o);
      const align = o.align ?? "center", base = o.baseline ?? "middle";
      const x = align === "left" ? p[0] : align === "right" ? p[0] - b.w : p[0] - b.w / 2;
      const y = base === "alphabetic" ? p[1] : base === "top" ? p[1] + b.a : base === "bottom" ? p[1] - b.d : p[1] + (b.a - b.d) / 2;
      if (o.alpha != null) ctx.globalAlpha = o.alpha;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      const halo = o.halo ? util.color(o.halo === true ? "panel" : o.halo) : null;
      if (halo) b.draw(painter(ctx, 0, halo, o.haloWidth ?? 4), x, y);
      b.draw(painter(ctx, 1, null, 0), x, y);
      ctx.restore();
      return { w: b.w, h: b.a + b.d };
    };
  }

  (W.__safisG ||= []).push(install);
  W.SafisTeX = { toMathML, typeset, errors, parse: src => { const r = parsed(String(src)); if (r.error) throw new Error(r.error); return r.node; } };

  const doc = W.document;
  if (doc) {
    const start = () => {
      typeset(doc.body);
      // Load the math font now so figures that draw math labels get it early.
      doc.fonts?.load?.(`16px ${family().split(",")[0]}`, "x").catch(() => {});
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
    else start();
  }
})();

;

/* Plot kit for explainer figures. g.graph(o) draws axes and returns a plot that
   draws curves, areas, fields, and markers in data coordinates; window.Num holds
   the numerics a figure shares with its model; the other helpers added to g draw
   springs, charges, atoms, bars, heatmaps, networks, and tokens in the house style.
   Reference: references/plots.md in the skill. */
(() => {
  "use strict";
  const TAU = Math.PI * 2;
  const MINUS = "−", NBSP = " ", THIN = " ";
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- Num: numerics shared by models and figures ----------
  const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "-": "⁻", "+": "⁺" };
  const sup = s => String(s).replace(/[0-9+-]/g, ch => SUP[ch]);
  // Digits after the decimal point that a step like 0.25 or 5e-4 needs.
  const decimals = x => {
    const m = String(+Number(x).toPrecision(10)).match(/^-?\d*(?:\.(\d+))?(?:e([+-]\d+))?$/);
    return m ? Math.max(0, (m[1]?.length ?? 0) - (m[2] ? +m[2] : 0)) : 0;
  };
  const group = i => (i.length > 4 ? i.replace(/\B(?=(\d{3})+(?!\d))/g, THIN) : i);

  // Number for display: true minus sign, thin-space thousands, 1.2×10⁻⁴ for tiny and huge values.
  // o: digits [3] significant, fixed (decimals), trim (drop trailing zeros), sign ("+" on positives), unit, sci [true].
  function fmt(x, o = {}) {
    if (typeof o === "number") o = { digits: o };
    if (x == null || Number.isNaN(x)) return "–";
    let s;
    if (!Number.isFinite(x)) s = "∞";
    else {
      const ax = Math.abs(x);
      if (o.fixed != null) {
        s = ax.toFixed(o.fixed);
        if (o.trim && s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
      } else if (ax !== 0 && o.sci !== false && (ax >= 1e6 || ax < 1e-3)) {
        let e = Math.floor(Math.log10(ax)), m = +(ax / 10 ** e).toPrecision(o.digits ?? 3);
        if (m >= 10) { m = +(m / 10).toPrecision(o.digits ?? 3); e++; }
        s = (m === 1 ? "" : m + "×") + "10" + sup(e);
      } else s = String(+ax.toPrecision(o.digits ?? 3));
      if (!s.includes("×") && !s.includes("10⁻") && !/e/.test(s)) { const [i, f] = s.split("."); s = group(i) + (f ? "." + f : ""); }
    }
    if (x < 0 && /[1-9∞]/.test(s)) s = MINUS + s;
    else if (o.sign && x > 0) s = "+" + s;
    if (o.unit) s += /^[°%′″]/.test(o.unit) ? o.unit : NBSP + o.unit;
    return s;
  }

  const SI = { "-15": "f", "-12": "p", "-9": "n", "-6": "µ", "-3": "m", 0: "", 3: "k", 6: "M", 9: "G", 12: "T" };
  // 0.0042 s -> "4.2 ms", 15300 N -> "15.3 kN".
  function si(x, unit = "", o = {}) {
    const digits = o.digits ?? 3;
    if (!Number.isFinite(x) || x === 0) return fmt(x, { unit: unit || undefined });
    let e = clamp(Math.floor(Math.log10(Math.abs(x)) / 3) * 3, -15, 12);
    if (Math.abs(+(x / 10 ** e).toPrecision(digits)) >= 1000 && e < 12) e += 3;
    const s = fmt(x / 10 ** e, { digits, sci: false }), u = SI[e] + unit;
    return u ? s + NBSP + u : s;
  }

  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
  // Multiples of π as text: π/2, 3π/4, −2π. Other values fall back to fmt.
  function piFmt(x, o = {}) {
    const k = x / Math.PI;
    for (const d of o.denoms ?? [1, 2, 3, 4, 6, 8, 12]) {
      const n = Math.round(k * d);
      if (Math.abs(k * d - n) < 1e-9 * Math.max(1, Math.abs(n))) {
        if (n === 0) return "0";
        const c = gcd(Math.abs(n), d), an = Math.abs(n) / c, dd = d / c;
        return (n < 0 ? MINUS : "") + (an === 1 ? "" : an) + "π" + (dd === 1 ? "" : "/" + dd);
      }
    }
    return fmt(x, o);
  }

  // A round step (1, 2, or 5 times a power of ten) giving about n intervals over span.
  function niceStep(span, n = 5) {
    const raw = Math.abs(span) / Math.max(1, n);
    if (!(raw > 0) || !Number.isFinite(raw)) return 1;
    const mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  }
  function ticks(a, b, n = 5, step) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    step = step ?? niceStep(hi - lo, n);
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step, i = 0; v <= hi + step * 1e-9 && i < 2000; v += step, i++) {
      const r = +(Math.round(v / step) * step).toPrecision(12);
      out.push(Math.abs(r) < step * 1e-9 ? 0 : r);
    }
    return out;
  }

  function linspace(a, b, n) {
    if (n < 2) return [a];
    return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
  }
  function range(a, b, step = 1) {
    if (b === undefined) { b = a; a = 0; }
    const n = Math.max(0, Math.ceil((b - a) / step - 1e-9));
    return Array.from({ length: n }, (_, i) => a + i * step);
  }

  // ODEs. f(t, y) returns dy/dt; y is a number or an array of numbers.
  const asVec = (f, y) => (typeof y === "number" ? [(t, Y) => [f(t, Y[0])], [y], true] : [f, y, false]);
  function rk4(f, y, t, dt) {
    const [F, Y, scalar] = asVec(f, y);
    const add = (a, k, s) => a.map((v, i) => v + k[i] * s);
    const k1 = F(t, Y), k2 = F(t + dt / 2, add(Y, k1, dt / 2)), k3 = F(t + dt / 2, add(Y, k2, dt / 2)), k4 = F(t + dt, add(Y, k3, dt));
    const out = Y.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    return scalar ? out[0] : out;
  }
  function euler(f, y, t, dt) {
    const [F, Y, scalar] = asVec(f, y);
    const k = F(t, Y), out = Y.map((v, i) => v + k[i] * dt);
    return scalar ? out[0] : out;
  }
  // Advances y by dt in RK4 substeps no longer than maxStep: for step(dt) in live figures.
  function advance(f, y, t, dt, maxStep = 1 / 240) {
    const n = Math.max(1, Math.ceil(Math.abs(dt) / maxStep)), h = dt / n;
    for (let i = 0; i < n; i++) y = rk4(f, y, t + i * h, h);
    return y;
  }
  // Integrates from t0 to t1; returns { t: [...], y: [...] } at every step.
  function ode(f, y0, [t0, t1], o = {}) {
    const n = o.steps ?? Math.max(1, Math.ceil(Math.abs(t1 - t0) / (o.dt ?? (t1 - t0) / 1000)));
    const h = (t1 - t0) / n, T = [t0], Y = [y0];
    let y = y0;
    for (let i = 0; i < n; i++) { y = (o.method === "euler" ? euler : rk4)(f, y, t0 + i * h, h); T.push(t0 + (i + 1) * h); Y.push(y); }
    return { t: T, y: Y };
  }

  // Roots and calculus.
  function bisect(f, a, b, o = {}) {
    let fa = f(a), fb = f(b);
    if (fa === 0) return a;
    if (fb === 0) return b;
    if (!(fa * fb < 0)) return NaN;
    const tol = o.tol ?? 1e-12;
    for (let i = 0; i < (o.maxIter ?? 200) && Math.abs(b - a) > tol * Math.max(1, Math.abs(a)); i++) {
      const m = (a + b) / 2, fm = f(m);
      if (fm === 0) return m;
      if (fa * fm < 0) { b = m; fb = fm; } else { a = m; fa = fm; }
    }
    return (a + b) / 2;
  }
  function deriv(f, x, h) {
    h = h ?? 1e-5 * Math.max(1, Math.abs(x));
    return (f(x + h) - f(x - h)) / (2 * h);
  }
  function deriv2(f, x, h) {
    h = h ?? 1e-4 * Math.max(1, Math.abs(x));
    return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
  }
  function newton(f, x0, o = {}) {
    const df = o.df ?? (x => deriv(f, x));
    let x = x0;
    for (let i = 0; i < (o.maxIter ?? 60); i++) {
      const fx = f(x), d = df(x);
      if (!Number.isFinite(fx) || !d) return NaN;
      const nx = x - fx / d;
      if (Math.abs(nx - x) <= (o.tol ?? 1e-12) * Math.max(1, Math.abs(nx))) return nx;
      x = nx;
    }
    return Math.abs(f(x)) < 1e-9 ? x : NaN;
  }
  // solve(f, a, b) brackets a root in [a, b]; solve(f, x0) starts Newton's method at x0.
  const solve = (f, a, b, o) => (b == null ? newton(f, a, o) : bisect(f, a, b, o));
  // Every root in [a, b], found from sign changes on n samples.
  function roots(f, a, b, n = 400) {
    const out = [];
    let x0 = a, f0 = f(a);
    for (let i = 1; i <= n; i++) {
      const x1 = a + ((b - a) * i) / n, f1 = f(x1);
      if (f0 === 0) out.push(x0);
      else if (f0 * f1 < 0) out.push(bisect(f, x0, x1));
      x0 = x1; f0 = f1;
    }
    if (f0 === 0) out.push(x0);
    return out.filter((r, i) => Number.isFinite(r) && (i === 0 || Math.abs(r - out[i - 1]) > 1e-9));
  }
  // Simpson's rule with n (even) intervals.
  function integrate(f, a, b, n = 256) {
    n += n % 2;
    const h = (b - a) / n;
    let s = f(a) + f(b);
    for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
    return (s * h) / 3;
  }
  // Piecewise-linear lookup in a table; xs ascending; clamps at the ends.
  function interp(xs, ys, x) {
    const n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    return lerp(ys[lo], ys[hi], (x - xs[lo]) / (xs[hi] - xs[lo]));
  }
  const table = (xs, ys) => x => interp(xs, ys, x);

  // Seeded random numbers (mulberry32), so a figure shows the same "random" data on every load.
  function rng(seed = 1) {
    let a = seed >>> 0;
    const r = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.gauss = (mu = 0, sigma = 1) => mu + sigma * Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());
    r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    r.pick = arr => arr[Math.floor(r() * arr.length)];
    r.shuffle = arr => { const b = arr.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
    return r;
  }

  // Statistics.
  const sum = xs => xs.reduce((s, x) => s + x, 0);
  const mean = xs => sum(xs) / xs.length;
  const variance = (xs, sample = false) => { const m = mean(xs); return sum(xs.map(x => (x - m) ** 2)) / (xs.length - (sample ? 1 : 0)); };
  const std = (xs, sample) => Math.sqrt(variance(xs, sample));
  // Abramowitz and Stegun 7.1.26, error below 1.5e-7.
  function erf(x) {
    const s = Math.sign(x), t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const normalPdf = (x, mu = 0, sigma = 1) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(TAU));
  const normalCdf = (x, mu = 0, sigma = 1) => 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
  function histogram(xs, o = {}) {
    const bins = o.bins ?? 20;
    const [lo, hi] = o.range ?? [Math.min(...xs), Math.max(...xs)];
    const w = (hi - lo) / bins || 1, counts = new Array(bins).fill(0);
    for (const x of xs) { if (x < lo || x > hi) continue; counts[Math.min(bins - 1, Math.floor((x - lo) / w))]++; }
    return { edges: linspace(lo, hi, bins + 1), counts, width: w };
  }

  // Vectors.
  const v2 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
    scale: (a, s) => [a[0] * s, a[1] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1],
    cross: (a, b) => a[0] * b[1] - a[1] * b[0],
    len: a => Math.hypot(a[0], a[1]),
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
    norm: a => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
    perp: a => [-a[1], a[0]],
    rot: (a, t) => [a[0] * Math.cos(t) - a[1] * Math.sin(t), a[0] * Math.sin(t) + a[1] * Math.cos(t)],
    angle: a => Math.atan2(a[1], a[0]),
    lerp: (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)],
    polar: (r, t) => [r * Math.cos(t), r * Math.sin(t)],
  };
  const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(a[0], a[1], a[2]),
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)],
  };
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  // Small matrices as arrays of rows.
  const mat = {
    identity: n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j))),
    // Matrix times matrix, or matrix times vector when b is a flat array.
    mul(a, b) {
      if (!Array.isArray(b[0])) return a.map(r => dot(r, b));
      return a.map(r => b[0].map((_, j) => r.reduce((s, x, k) => s + x * b[k][j], 0)));
    },
    transpose: a => a[0].map((_, j) => a.map(r => r[j])),
    add: (a, b) => a.map((r, i) => r.map((x, j) => x + b[i][j])),
    scale: (a, s) => a.map(r => r.map(x => x * s)),
    det(a) {
      const n = a.length;
      if (n === 1) return a[0][0];
      if (n === 2) return a[0][0] * a[1][1] - a[0][1] * a[1][0];
      if (n === 3) return a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
      const m = a.map(r => r.slice());
      let d = 1;
      for (let k = 0; k < n; k++) {
        let p = k;
        for (let i = k + 1; i < n; i++) if (Math.abs(m[i][k]) > Math.abs(m[p][k])) p = i;
        if (m[p][k] === 0) return 0;
        if (p !== k) { [m[p], m[k]] = [m[k], m[p]]; d = -d; }
        d *= m[k][k];
        for (let i = k + 1; i < n; i++) { const f = m[i][k] / m[k][k]; for (let j = k; j < n; j++) m[i][j] -= f * m[k][j]; }
      }
      return d;
    },
    // Inverse by Gauss-Jordan elimination; null when the matrix is singular.
    inv(a) {
      const n = a.length, m = a.map((r, i) => [...r, ...mat.identity(n)[i]]);
      for (let k = 0; k < n; k++) {
        let p = k;
        for (let i = k + 1; i < n; i++) if (Math.abs(m[i][k]) > Math.abs(m[p][k])) p = i;
        if (Math.abs(m[p][k]) < 1e-12) return null;
        [m[p], m[k]] = [m[k], m[p]];
        const piv = m[k][k];
        for (let j = 0; j < 2 * n; j++) m[k][j] /= piv;
        for (let i = 0; i < n; i++) {
          if (i === k) continue;
          const f = m[i][k];
          for (let j = 0; j < 2 * n; j++) m[i][j] -= f * m[k][j];
        }
      }
      return m.map(r => r.slice(n));
    },
    // Eigenvalues of a 2x2 matrix, larger first, with unit eigenvectors when they are real.
    eigen2(a) {
      const [[p, q], [r, s]] = a, tr = p + s, det = p * s - q * r, disc = (tr * tr) / 4 - det;
      if (disc < -1e-12) {
        const im = Math.sqrt(-disc);
        return { complex: true, values: [{ re: tr / 2, im }, { re: tr / 2, im: -im }], vectors: null };
      }
      const d = Math.sqrt(Math.max(0, disc)), values = [tr / 2 + d, tr / 2 - d];
      const vec = l => {
        if (Math.abs(q) > 1e-12) return v2.norm([q, l - p]);
        if (Math.abs(r) > 1e-12) return v2.norm([l - s, r]);
        return Math.abs(l - p) < Math.abs(l - s) ? [1, 0] : [0, 1];
      };
      return { complex: false, values, vectors: values.map(vec) };
    },
    rotation: t => [[Math.cos(t), -Math.sin(t)], [Math.sin(t), Math.cos(t)]],
  };

  // Complex numbers as { re, im }.
  const C = {
    of: (re, im = 0) => ({ re, im }),
    polar: (r, t) => ({ re: r * Math.cos(t), im: r * Math.sin(t) }),
    add: (a, b) => ({ re: a.re + b.re, im: a.im + b.im }),
    sub: (a, b) => ({ re: a.re - b.re, im: a.im - b.im }),
    mul: (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }),
    div: (a, b) => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; },
    scale: (a, s) => ({ re: a.re * s, im: a.im * s }),
    conj: a => ({ re: a.re, im: -a.im }),
    abs: a => Math.hypot(a.re, a.im),
    arg: a => Math.atan2(a.im, a.re),
    exp: a => { const e = Math.exp(a.re); return { re: e * Math.cos(a.im), im: e * Math.sin(a.im) }; },
    fmt: (a, o) => (a.im === 0 ? fmt(a.re, o) : `${a.re === 0 ? "" : fmt(a.re, o) + (a.im < 0 ? ` ${MINUS} ` : " + ")}${a.re === 0 && a.im < 0 ? MINUS : ""}${fmt(Math.abs(a.im), o)}i`),
  };

  // Neural-network and language-model pieces.
  const sigmoid = x => 1 / (1 + Math.exp(-x));
  const relu = x => Math.max(0, x);
  const gelu = x => 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));
  const argmax = xs => xs.reduce((best, x, i) => (x > xs[best] ? i : best), 0);
  const logsumexp = xs => { const m = Math.max(...xs); return m + Math.log(sum(xs.map(x => Math.exp(x - m)))); };
  // Softmax with temperature T; T near 0 gives all weight to the largest.
  function softmax(xs, T = 1) {
    if (T <= 1e-6) { const k = argmax(xs); return xs.map((_, i) => +(i === k)); }
    const m = Math.max(...xs), e = xs.map(x => Math.exp((x - m) / T)), z = sum(e);
    return e.map(x => x / z);
  }
  const normalize = xs => { const z = sum(xs) || 1; return xs.map(x => x / z); };
  const topK = (xs, k) => xs.map((x, i) => i).sort((a, b) => xs[b] - xs[a]).slice(0, k);
  // Index drawn from a probability list; r is a random number in [0, 1).
  function sample(probs, r = Math.random()) {
    let acc = 0;
    for (let i = 0; i < probs.length; i++) { acc += probs[i]; if (r < acc) return i; }
    return probs.length - 1;
  }
  const entropy = (ps, base = Math.E) => -sum(ps.map(p => (p > 0 ? p * Math.log(p) : 0))) / Math.log(base);
  const crossEntropy = (ps, target) => -Math.log(Math.max(1e-300, ps[target]));

  const Num = {
    fmt, si, piFmt, sup, decimals, niceStep, ticks,
    linspace, range, clamp, lerp,
    rk4, euler, advance, ode,
    bisect, newton, solve, roots, deriv, deriv2, integrate, interp, table,
    rng, sum, mean, variance, std, erf, normalPdf, normalCdf, histogram,
    v2, v3, dot, mat, matmul: mat.mul, C,
    sigmoid, tanh: Math.tanh, relu, gelu, softmax, normalize, argmax, topK, sample, entropy, crossEntropy, logsumexp,
  };

  // ---------- TeX-ish fallback for canvas labels when src/tex.js is absent ----------
  const SYM = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
    iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ",
    chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
    cdot: "·", times: "×", pm: "±", infty: "∞", to: "→", approx: "≈", le: "≤", ge: "≥", leq: "≤", geq: "≥", ne: "≠", neq: "≠",
    partial: "∂", nabla: "∇", degree: "°", circ: "°", sum: "Σ", int: "∫", sqrt: "√", propto: "∝", ell: "ℓ", hbar: "ħ",
  };
  const SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
    a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", h: "ₕ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", s: "ₛ", t: "ₜ", i: "ᵢ", j: "ⱼ", r: "ᵣ", u: "ᵤ", v: "ᵥ" };
  const SUPX = { ...SUP, n: "ⁿ", i: "ⁱ", "(": "⁽", ")": "⁾", "=": "⁼" };
  function texToUnicode(s) {
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2").replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1")
      .replace(/\\(?:left|right)/g, "").replace(/\\[,;:! ]/g, THIN)
      .replace(/\\([A-Za-z]+)/g, (m, c) => SYM[c] ?? c);
    const script = (map, body) => [...body].every(ch => map[ch]) ? [...body].map(ch => map[ch]).join("") : null;
    s = s.replace(/([_^])(\{([^{}]*)\}|(.))/g, (m, op, _, braced, single) => {
      const body = braced ?? single;
      return script(op === "_" ? SUB : SUPX, body) ?? (op === "_" ? "_" : "^") + body;
    });
    return s.replace(/[{}]/g, "");
  }

  // ---------- Helpers on g ----------
  (window.__safisG ||= []).push((g, util) => {
    const ATOM = {
      H: ["panel", 0.7], C: ["ink", 1], N: ["blue", 1], O: ["red", 1], F: ["green", 0.95], Cl: ["green", 1.1], Br: ["orange", 1.2], I: ["purple", 1.3],
      S: ["brass", 1.1], P: ["orange", 1.1], Na: ["purple", 1.15], K: ["purple", 1.25], Li: ["purple", 1], Mg: ["green", 1.1], Ca: ["green", 1.2],
      Fe: ["orange", 1.1], Cu: ["orange", 1.1], Zn: ["muted", 1.1], He: ["muted", 0.8], Ne: ["muted", 0.85], Ar: ["muted", 1], B: ["orange", 0.95], Si: ["brass", 1.15],
    };
    const italicSize = o => (o.size ?? 14) + 1.5;

    // Text that understands two conventions: "$...$" is math (g.tex when present), and a single letter is a variable in italic serif.
    function txt(str, p, o = {}) {
      if (str == null || str === "") return 0;
      const s = String(str), m = s.match(/^\$([\s\S]+)\$$/);
      if (m && g.tex) { const r = g.tex(m[1], p, o); return r?.w ?? 0; }
      if (m || /^[A-Za-zα-ωΑ-Ωϑφϕℓ]$/.test(s)) {
        const u = m ? texToUnicode(m[1]) : s, oo = { ...o, font: "serif", italic: true, size: italicSize(o), weight: o.weight ?? 500 };
        g.text(u, p, oo);
        return g.measure(u, oo);
      }
      g.text(s, p, o);
      return g.measure(s, o);
    }
    function txtWidth(str, o = {}) {
      if (str == null || str === "") return 0;
      const s = String(str), m = s.match(/^\$([\s\S]+)\$$/);
      if (m && g.measureTex) return g.measureTex(m[1], o)?.w ?? 0;
      if (m || /^[A-Za-zα-ωΑ-Ωϑφϕℓ]$/.test(s)) return g.measure(m ? texToUnicode(m[1]) : s, { ...o, font: "serif", italic: true, size: italicSize(o) });
      return g.measure(s, o);
    }
    // A shape filled with the paper color, then a palette tint over it: works with any palette color format.
    const tinted = (draw, c, a) => { draw({ fill: "panel" }); if (c && a > 0) draw({ fill: c, alpha: a }); };
    const head = (tip, dir, size, color) => {
      const [ux, uy] = v2.norm(dir), b = [tip[0] - ux * size, tip[1] - uy * size], w = size * 0.42;
      g.path([tip, [b[0] - uy * w, b[1] + ux * w], [b[0] + uy * w, b[1] - ux * w]], { fill: color, close: true });
    };

    // ----- g.graph -----
    g.graph = (o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h];
      const style = o.axes ?? "cross";
      const logX = o.xScale === "log", logY = o.yScale === "log";
      const fx = logX ? Math.log10 : v => v, fy = logY ? Math.log10 : v => v;
      const gx = logX ? t => 10 ** t : t => t, gy = logY ? t => 10 ** t : t => t;
      const xr = o.x ?? [-1, 1], yr = o.y ?? [-1, 1];
      let X0 = fx(xr[0]), X1 = fx(xr[1]), Y0 = fy(yr[0]), Y1 = fy(yr[1]);
      const pad = o.pad ?? 10, TL = 4;
      const TICK = { size: o.tickSize ?? 11.5, color: "muted", weight: 500 };
      const TICKH = { ...TICK, halo: true, haloWidth: 5 };
      const AXL = { size: o.labelSize ?? 13, color: "ink", weight: 500 };

      // Major and minor ticks for one axis (lo, hi in transformed units, len in px).
      function axisTicks(spec, lo, hi, log, len, spacing, format) {
        const out = { major: [], minor: [], label: v => fmt(v) };
        if (spec === false || spec === null) return out;
        const a = log ? 10 ** lo : lo, b = log ? 10 ** hi : hi, mn = Math.min(a, b), mx = Math.max(a, b);
        const target = Math.max(2, Math.round(len / spacing));
        const obj = spec && typeof spec === "object" && !Array.isArray(spec) ? spec : {};
        const kind = Array.isArray(spec) ? "list" : spec === "pi" || obj.pi ? "pi" : typeof spec === "number" || obj.step ? "step" : log ? "log" : "auto";
        const inside = v => v >= mn - Math.abs(mx - mn) * 1e-9 && v <= mx + Math.abs(mx - mn) * 1e-9;
        if (kind === "list") {
          out.major = spec.filter(inside);
          const dec = Math.max(0, ...out.major.map(decimals));
          out.label = v => fmt(v, { fixed: dec });
        } else if (kind === "pi") {
          const steps = [1 / 12, 1 / 6, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32].map(k => k * Math.PI);
          const step = obj.step ?? steps.find(s => (mx - mn) / s <= target) ?? steps[steps.length - 1];
          out.major = ticks(mn, mx, 0, step);
          out.minor = ticks(mn, mx, 0, step / 2).filter(v => !out.major.some(m => Math.abs(m - v) < step * 1e-6));
          out.label = v => piFmt(v);
        } else if (kind === "log") {
          const k0 = Math.ceil(Math.min(lo, hi) - 1e-9), k1 = Math.floor(Math.max(lo, hi) + 1e-9);
          const every = Math.max(1, Math.ceil((k1 - k0 + 1) / target));
          for (let k = k0; k <= k1; k++) {
            if ((k - k0) % every === 0) out.major.push(10 ** k);
            for (let m = 2; m <= 9 && every === 1; m++) { const v = m * 10 ** k; if (inside(v)) out.minor.push(v); }
          }
          if (every === 1 && k0 - 1 >= Math.floor(Math.min(lo, hi))) for (let m = 2; m <= 9; m++) { const v = m * 10 ** (k0 - 1); if (inside(v)) out.minor.push(v); }
          out.label = v => (v >= 1e-3 && v <= 1e4 ? fmt(v) : "10" + sup(Math.round(Math.log10(v))));
        } else {
          const step = typeof spec === "number" ? spec : obj.step ?? niceStep(mx - mn, target);
          out.major = ticks(mn, mx, 0, step);
          const lead = Math.round(step / 10 ** Math.floor(Math.log10(step)));
          out.minor = ticks(mn, mx, 0, step / (lead === 2 ? 4 : 5)).filter(v => !out.major.some(m => Math.abs(m - v) < step * 1e-6));
          const dec = decimals(step), big = Math.max(Math.abs(mn), Math.abs(mx));
          out.label = big >= 1e6 || (step < 1e-3 && big < 1e-2) ? v => fmt(v) : v => fmt(v, { fixed: dec });
        }
        if (Array.isArray(obj.values)) out.major = obj.values.filter(inside);
        if (obj.minor === false) out.minor = [];
        const f = obj.format ?? format;
        if (f) out.label = f;
        return out;
      }
      const XS = o.xTickSpacing ?? 80, YS = o.yTickSpacing ?? 46;
      let xt = axisTicks(o.xTicks, X0, X1, logX, box[2], XS, o.xFormat);
      let yt = axisTicks(o.yTicks, Y0, Y1, logY, box[3], YS, o.yFormat);
      const yLabW = () => Math.max(0, ...yt.major.map(v => g.measure(yt.label(v), TICK)));
      let ml = pad, mr = pad, mt = pad, mb = pad;
      const wl = yLabW();
      if (style === "frame") {
        ml += wl + TL + 6;
        mb += TL + 15 + (o.xLabel ? 20 : 0);
        mt += o.yLabel ? 22 : 7;
        mr += 12;
      } else if (style === "cross") {
        const xl = logX || Math.min(X0, X1) >= 0, xr2 = !logX && Math.max(X0, X1) <= 0;
        const yb = logY || Math.min(Y0, Y1) >= 0, yt2 = !logY && Math.max(Y0, Y1) <= 0;
        if (xl) ml += wl + TL + 6;
        if (xr2) mr += wl + TL + 6;
        if (yb) mb += TL + 15;
        if (yt2) mt += TL + 15;
        mt += 6; mr += 6;
      }
      let L = box[0] + ml, R = box[0] + box[2] - mr, T = box[1] + mt, B = box[1] + box[3] - mb;
      if (R - L < 8) { L = box[0]; R = box[0] + box[2]; }
      if (B - T < 8) { T = box[1]; B = box[1] + box[3]; }
      let sx = (R - L) / (X1 - X0 || 1), sy = (B - T) / (Y1 - Y0 || 1);
      if (o.equal && !logX && !logY) {
        const s = Math.min(Math.abs(sx), Math.abs(sy)), cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2;
        const hx = (R - L) / s / 2, hy = (B - T) / s / 2;
        [X0, X1] = X1 > X0 ? [cx - hx, cx + hx] : [cx + hx, cx - hx];
        [Y0, Y1] = Y1 > Y0 ? [cy - hy, cy + hy] : [cy + hy, cy - hy];
        sx = (R - L) / (X1 - X0); sy = (B - T) / (Y1 - Y0);
      }
      xt = axisTicks(o.xTicks, X0, X1, logX, R - L, XS, o.xFormat);
      yt = axisTicks(o.yTicks, Y0, Y1, logY, B - T, YS, o.yFormat);

      const xpx = x => L + (fx(x) - X0) * sx, ypx = y => B - (fy(y) - Y0) * sy;
      const toPx = q => [xpx(q[0]), ypx(q[1])];
      const P = q => toPx(q);
      P.inv = p => [gx(X0 + (p[0] - L) / sx), gy(Y0 + (B - p[1]) / sy)];
      P.xpx = xpx; P.ypx = ypx;
      P.box = [L, T, R - L, B - T];
      P.x = [gx(X0), gx(X1)]; P.y = [gy(Y0), gy(Y1)];
      P.sx = sx; P.sy = sy;
      const zx = logX ? X0 : clamp(0, Math.min(X0, X1), Math.max(X0, X1));
      const zy = logY ? Y0 : clamp(0, Math.min(Y0, Y1), Math.max(Y0, Y1));
      const axX = style === "frame" ? L : L + (zx - X0) * sx, axY = style === "frame" ? B : B - (zy - Y0) * sy;
      P.axis = { x: axX, y: axY };
      P.contains = q => { const p = toPx(q); return p[0] >= L - 0.5 && p[0] <= R + 0.5 && p[1] >= T - 0.5 && p[1] <= B + 0.5; };
      P.near = (p, q, r = 14) => { const c = toPx(q); return Math.hypot(p[0] - c[0], p[1] - c[1]) <= r; };
      const H = B - T, W = R - L, diag = Math.hypot(W, H);
      const lim = p => [clamp(p[0], L - 4 * W, R + 4 * W), clamp(p[1], T - 4 * H, B + 4 * H)];
      const clipped = (so, fn) => (so.clip === false || o.clip === false ? fn() : g.clip([L - 2, T - 2, W + 4, H + 4], fn));
      P.clip = fn => g.clip([L, T, W, H], fn);

      function drawGrid() {
        if (o.grid === false || style === "none" && !o.grid) return;
        const minor = o.grid === "minor" || o.grid === "both";
        const vline = (v, w, a) => { const x = xpx(v); g.line([x, T], [x, B], { stroke: "grid", width: w, alpha: a }); };
        const hline = (v, w, a) => { const y = ypx(v); g.line([L, y], [R, y], { stroke: "grid", width: w, alpha: a }); };
        if (minor) { xt.minor.forEach(v => vline(v, 0.75, 0.7)); yt.minor.forEach(v => hline(v, 0.75, 0.7)); }
        xt.major.forEach(v => vline(v, 1, 1));
        yt.major.forEach(v => hline(v, 1, 1));
      }
      function drawAxes() {
        const ax = { stroke: "muted", width: 1.2 }, tk = { stroke: "muted", width: 1 };
        if (style === "frame") {
          if (o.zeroLine !== false) {
            if (!logY && Math.min(Y0, Y1) < 0 && Math.max(Y0, Y1) > 0) g.line([L, ypx(0)], [R, ypx(0)], { stroke: "muted", width: 0.9, alpha: 0.8 });
            if (!logX && Math.min(X0, X1) < 0 && Math.max(X0, X1) > 0) g.line([xpx(0), T], [xpx(0), B], { stroke: "muted", width: 0.9, alpha: 0.8 });
          }
          g.line([L, T], [L, B], ax);
          g.line([L, B], [R, B], ax);
          for (const v of xt.major) { const x = xpx(v); g.line([x, B], [x, B + TL], tk); g.text(xt.label(v), [x, B + TL + 9], TICK); }
          for (const v of yt.major) { const y = ypx(v); g.line([L - TL, y], [L, y], tk); g.text(yt.label(v), [L - TL - 4, y], { ...TICK, align: "right" }); }
          if (o.xLabel) txt(o.xLabel, [(L + R) / 2, B + TL + 29], { ...AXL, align: "center" });
          if (o.yLabel) txt(o.yLabel, [L - 2, T - 15], { ...AXL, align: "left" });
          return;
        }
        if (style !== "cross") return;
        const tipX = R + 5, tipY = T - 5, arrows = o.arrows !== false;
        g.line([L, axY], [arrows ? tipX - 3 : R, axY], ax);
        g.line([axX, B], [axX, arrows ? tipY + 3 : T], ax);
        if (arrows) { head([tipX, axY], [1, 0], 7, "muted"); head([axX, tipY], [0, -1], 7, "muted"); }
        const zeroX = !logX && zx === 0 && axX > L + 1 && axX < R - 1, zeroY = !logY && zy === 0 && axY > T + 1 && axY < B - 1;
        const below = axY + 24 <= box[1] + box[3];
        for (const v of xt.major) {
          const x = xpx(v);
          if (zeroY && Math.abs(v) < 1e-12 && zeroX) continue;
          g.line([x, axY - 3], [x, axY + 3], tk);
          if (arrows && x > tipX - 16) continue;
          if (zeroX && Math.abs(x - axX) < 1) continue;
          g.text(xt.label(v), [x, below ? axY + TL + 10 : axY - TL - 10], TICKH);
        }
        const lw = yLabW(), leftOK = axX - TL - 6 - lw >= box[0];
        for (const v of yt.major) {
          const y = ypx(v);
          g.line([axX - 3, y], [axX + 3, y], tk);
          if (arrows && y < tipY + 14) continue;
          if (zeroY && Math.abs(y - axY) < 1) continue;
          g.text(yt.label(v), leftOK ? [axX - TL - 4, y] : [axX + TL + 4, y], { ...TICKH, align: leftOK ? "right" : "left" });
        }
        if (zeroX && zeroY && o.origin !== false && xt.major.length && yt.major.length) g.text("0", [axX - 5, axY + TL + 10], { ...TICKH, align: "right" });
        if (o.xLabel) txt(o.xLabel, [tipX - 2, axY - 12], { ...AXL, align: "right" });
        if (o.yLabel) txt(o.yLabel, [axX + 10, tipY + 4], { ...AXL, align: "left" });
      }
      if (o.draw !== false) { drawGrid(); drawAxes(); }
      // Draws the axes and tick labels again, on top of curves that crossed them.
      P.axesOnTop = drawAxes;

      // f(x) with adaptive sampling; jumps the sampling can't resolve (tan, 1/x) break the line.
      P.fn = (f, so = {}) => {
        const dom = so.domain ?? [gx(X0), gx(X1)];
        const t0 = fx(Math.max(Math.min(dom[0], dom[1]), Math.min(gx(X0), gx(X1)))), t1 = fx(Math.min(Math.max(dom[0], dom[1]), Math.max(gx(X0), gx(X1))));
        if (!(t1 > t0)) return [];
        const n = so.samples ?? Math.max(24, Math.round(((t1 - t0) * Math.abs(sx)) / 4));
        let budget = so.budget ?? 40000;
        const at = t => {
          const x = gx(t);
          let y;
          try { y = f(x); } catch { y = NaN; }
          budget--;
          return { t, p: Number.isFinite(y) && (!logY || y > 0) ? [L + (t - X0) * sx, B - (fy(y) - Y0) * sy] : null };
        };
        const pts = [];
        const refine = (A, Bp, depth) => {
          if (depth < 11 && budget > 0) {
            const M = at((A.t + Bp.t) / 2);
            let split;
            if (!A.p || !Bp.p) split = !!(A.p || Bp.p || M.p);
            else if (!M.p) split = true;
            else split = Math.abs(M.p[1] - (A.p[1] + Bp.p[1]) / 2) > 0.4 || Math.abs(A.p[1] - Bp.p[1]) > H * 0.5;
            if (split) { refine(A, M, depth + 1); refine(M, Bp, depth + 1); return; }
          }
          pts.push(Bp);
        };
        let prev = at(t0);
        pts.push(prev);
        for (let i = 1; i <= n; i++) { const nx = at(t0 + ((t1 - t0) * i) / n); refine(prev, nx, 0); prev = nx; }
        const lines = [];
        let cur = [];
        for (let i = 0; i < pts.length; i++) {
          const q = pts[i];
          if (!q.p) { if (cur.length > 1) lines.push(cur); cur = []; continue; }
          const pr = pts[i - 1];
          if (pr && pr.p && Math.abs(q.p[1] - pr.p[1]) > H * 0.5) { if (cur.length > 1) lines.push(cur); cur = []; }
          cur.push(lim(q.p));
        }
        if (cur.length > 1) lines.push(cur);
        const color = so.color ?? "blue";
        clipped(so, () => { for (const line of lines) g.path(line, { stroke: color, width: so.width ?? 2, dash: so.dash, alpha: so.alpha }); });
        if (so.label) {
          const lx = so.labelAt ?? gx(t1 - (t1 - t0) * 0.04);
          let ly;
          try { ly = f(lx); } catch { ly = NaN; }
          if (Number.isFinite(ly) && P.contains([lx, ly])) {
            const p = toPx([lx, ly]), [dx, dy] = so.labelOffset ?? [0, -12];
            const w = txtWidth(so.label, { size: 13 });
            txt(so.label, [clamp(p[0] + dx, L + w / 2 + 2, R - w / 2 - 2), clamp(p[1] + dy, T + 8, B - 8)], { size: 13, color, halo: true, weight: 600 });
          }
        }
        return lines;
      };
      // A curve t -> [x, y] over [t0, t1].
      P.parametric = (fn, [t0, t1] = [0, 1], so = {}) => {
        let budget = so.budget ?? 40000;
        const n = so.samples ?? 160;
        const at = t => {
          let q;
          try { q = fn(t); } catch { q = null; }
          budget--;
          return { t, p: q && Number.isFinite(q[0]) && Number.isFinite(q[1]) ? toPx(q) : null };
        };
        const pts = [];
        const refine = (A, Bp, depth) => {
          if (depth < 10 && budget > 0) {
            const M = at((A.t + Bp.t) / 2);
            let split;
            if (!A.p || !Bp.p) split = !!(A.p || Bp.p || M.p);
            else if (!M.p) split = true;
            else {
              const dev = Math.hypot(M.p[0] - (A.p[0] + Bp.p[0]) / 2, M.p[1] - (A.p[1] + Bp.p[1]) / 2);
              split = dev > 0.4 || Math.hypot(A.p[0] - Bp.p[0], A.p[1] - Bp.p[1]) > diag * 0.25;
            }
            if (split) { refine(A, M, depth + 1); refine(M, Bp, depth + 1); return; }
          }
          pts.push(Bp);
        };
        let prev = at(t0);
        pts.push(prev);
        for (let i = 1; i <= n; i++) { const nx = at(t0 + ((t1 - t0) * i) / n); refine(prev, nx, 0); prev = nx; }
        const lines = [];
        let cur = [];
        for (let i = 0; i < pts.length; i++) {
          const q = pts[i], pr = pts[i - 1];
          if (!q.p) { if (cur.length > 1) lines.push(cur); cur = []; continue; }
          if (pr && pr.p && Math.hypot(q.p[0] - pr.p[0], q.p[1] - pr.p[1]) > diag * 0.25) { if (cur.length > 1) lines.push(cur); cur = []; }
          cur.push(lim(q.p));
        }
        if (cur.length > 1) lines.push(cur);
        clipped(so, () => { for (const line of lines) g.path(line, { stroke: so.color ?? "blue", width: so.width ?? 2, dash: so.dash, alpha: so.alpha, fill: so.fill, close: !!so.fill }); });
        return lines;
      };
      // r(θ) in polar coordinates.
      P.polar = (r, range = [0, TAU], so = {}) => P.parametric(t => { const rr = r(t); return [rr * Math.cos(t), rr * Math.sin(t)]; }, range, so);

      P.points = (list, so = {}) => {
        const out = list.map(q => toPx(q));
        clipped(so, () => out.forEach((p, i) => {
          const c = Array.isArray(so.color) ? so.color[i] : so.color ?? "ink";
          g.circle(p, so.r ?? 3.5, { fill: c, stroke: "panel", width: 1.2, alpha: so.alpha });
          if (so.labels?.[i]) txt(so.labels[i], [p[0] + 8, p[1] - 9], { size: 12, color: c, align: "left", halo: true });
        }));
        return out;
      };
      P.scatter = P.points;
      P.polyline = (list, so = {}) => { const pts = list.map(toPx); clipped(so, () => g.path(pts.map(lim), { stroke: so.color ?? "ink", width: so.width ?? 2, dash: so.dash, alpha: so.alpha, close: so.close, fill: so.fill })); return pts; };
      P.segment = (a, b, so = {}) => { const A = toPx(a), Bp = toPx(b); clipped(so, () => g.line(A, Bp, { stroke: so.color ?? "ink", width: so.width ?? 2, dash: so.dash, alpha: so.alpha })); return [A, Bp]; };
      const extend = (a, b, back) => {
        const A = toPx(a), Bp = toPx(b), d = v2.norm(v2.sub(Bp, A)), k = diag * 2;
        return [back ? v2.add(A, v2.scale(d, -k)) : A, v2.add(A, v2.scale(d, k))];
      };
      // The whole line through a and b, clipped to the plot.
      P.line = (a, b, so = {}) => { const [A, Bp] = extend(a, b, true); clipped(so, () => g.line(A, Bp, { stroke: so.color ?? "ink", width: so.width ?? 1.5, dash: so.dash, alpha: so.alpha })); };
      P.ray = (a, b, so = {}) => { const [A, Bp] = extend(a, b, false); clipped(so, () => g.line(A, Bp, { stroke: so.color ?? "ink", width: so.width ?? 1.5, dash: so.dash, alpha: so.alpha })); };
      P.vector = (from, to, so = {}) => {
        const A = toPx(from), Bp = toPx(to), c = so.color ?? "ink";
        g.arrow(A, Bp, { stroke: c, width: so.width ?? 2, head: so.head, alpha: so.alpha });
        if (so.label) {
          const d = v2.norm(v2.sub(Bp, A)), off = so.labelOffset ?? 13;
          txt(so.label, [Bp[0] + d[0] * off, Bp[1] + d[1] * off], { size: 14, color: c, halo: true, weight: 600 });
        }
        return [A, Bp];
      };
      // Shaded region between f and o.to (a number or function, default 0) over [a, b]; returns the integral.
      P.area = (f, a, b, so = {}) => {
        const base = typeof so.to === "function" ? so.to : () => so.to ?? 0;
        const lo = Math.max(Math.min(a, b), Math.min(gx(X0), gx(X1))), hi = Math.min(Math.max(a, b), Math.max(gx(X0), gx(X1)));
        if (hi > lo) {
          const xs = linspace(lo, hi, (so.samples ?? 160) + 1);
          const tops = xs.map(x => f(x)), bots = xs.map(x => base(x));
          const fill = (pick, c) => {
            const poly = [...xs.map((x, i) => lim(toPx([x, pick(tops[i], bots[i])]))), ...xs.map((x, i) => lim(toPx([x, bots[i]]))).reverse()];
            g.path(poly, { fill: c, alpha: so.alpha ?? 0.2, close: true });
            if (so.hatch) g.path(poly, { hatch: c, hatchGap: 6, close: true, alpha: 0.55 });
          };
          const color = so.color ?? "blue";
          clipped(so, () => {
            if (so.neg) { fill((y, b0) => Math.max(y, b0), color); fill((y, b0) => Math.min(y, b0), so.neg); }
            else fill(y => y, color);
            if (so.edge) g.path(xs.map((x, i) => lim(toPx([x, tops[i]]))), { stroke: color, width: 2 });
          });
        }
        return integrate(x => f(x) - base(x), a, b);
      };
      P.between = (f, f2, a, b, so = {}) => P.area(f, a, b, { ...so, to: f2 });
      // Tangent to f at x0; returns { x, y, slope }.
      P.tangent = (f, x0, so = {}) => {
        const y0 = f(x0), m = so.slope ?? deriv(f, x0), c = so.color ?? "orange";
        if (so.span) P.segment([x0 - so.span, y0 - m * so.span], [x0 + so.span, y0 + m * so.span], { color: c, width: so.width ?? 1.6, dash: so.dash });
        else P.line([x0, y0], [x0 + 1, y0 + m], { color: c, width: so.width ?? 1.6, dash: so.dash });
        if (so.point !== false) P.marker(x0, y0, { color: c });
        return { x: x0, y: y0, slope: m };
      };
      // Riemann rectangles (rule: "left", "right", "mid", or "trap"); returns the sum.
      P.riemann = (f, a, b, n, so = {}) => {
        const w = (b - a) / n, rule = so.rule ?? "mid", c = so.color ?? "blue", y0 = so.to ?? 0;
        let total = 0;
        clipped(so, () => {
          for (let i = 0; i < n; i++) {
            const xl = a + i * w, xr = xl + w;
            if (rule === "trap") {
              const yl = f(xl), yr = f(xr);
              total += ((yl + yr) / 2 - y0) * w;
              const poly = [toPx([xl, y0]), toPx([xl, yl]), toPx([xr, yr]), toPx([xr, y0])].map(lim);
              g.path(poly, { fill: c, alpha: so.alpha ?? 0.18, close: true });
              g.path(poly, { stroke: c, width: 1, close: true });
              continue;
            }
            const y = f(rule === "left" ? xl : rule === "right" ? xr : xl + w / 2);
            total += (y - y0) * w;
            const p = lim(toPx([xl, y])), q = lim(toPx([xr, y0]));
            const rx = Math.min(p[0], q[0]), ry = Math.min(p[1], q[1]), rw = Math.abs(q[0] - p[0]), rh = Math.abs(q[1] - p[1]);
            g.rect(rx, ry, rw, rh, { fill: c, alpha: so.alpha ?? 0.18 });
            g.rect(rx, ry, rw, rh, { stroke: c, width: 1 });
          }
        });
        return total;
      };
      P.hline = (y, so = {}) => {
        const py = ypx(y), c = so.color ?? "muted";
        clipped(so, () => g.line([L, py], [R, py], { stroke: c, width: so.width ?? 1, dash: so.dash ?? [4, 4] }));
        if (so.label) txt(so.label, [R - 4, py - 9], { size: 12, color: c, align: "right", halo: true });
        return py;
      };
      P.vline = (x, so = {}) => {
        const px = xpx(x), c = so.color ?? "muted";
        clipped(so, () => g.line([px, T], [px, B], { stroke: c, width: so.width ?? 1, dash: so.dash ?? [4, 4] }));
        if (so.label) txt(so.label, [px + 6, T + 9], { size: 12, color: c, align: "left", halo: true });
        return px;
      };
      const OFF = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1] };
      // A point with an optional label and dashed drop lines to the axes.
      P.marker = (x, y, so = {}) => {
        const p = toPx([x, y]), c = so.color ?? "ink";
        if (so.drop) {
          const d = { stroke: c, width: 1, dash: [3, 3], alpha: 0.8 };
          g.line(p, [p[0], axY], d);
          g.line(p, [axX, p[1]], d);
        }
        g.circle(p, so.r ?? 4.5, { fill: c, stroke: "panel", width: 1.5 });
        if (so.label) {
          const dir = OFF[so.pos ?? "ne"], k = 10;
          txt(so.label, [p[0] + dir[0] * k, p[1] + dir[1] * k], { size: 13, color: c, weight: 600, halo: true, align: dir[0] > 0 ? "left" : dir[0] < 0 ? "right" : "center" });
        }
        return p;
      };
      P.label = (text, q, so = {}) => {
        const p = toPx(q);
        return txt(text, [p[0] + (so.dx ?? 0), p[1] + (so.dy ?? 0)], { size: so.size ?? 13, color: so.color ?? "ink", align: so.align ?? "center", halo: true, weight: so.weight ?? 500 });
      };
      // items: [{ label, color, dash, fill }]; o.at: "top-left" (default), "top-right", "bottom-left", "bottom-right", or [x, y].
      P.legend = (items, so = {}) => {
        const rowH = 19, sw = 20, w = Math.max(0, ...items.map(it => txtWidth(it.label, { size: 12.5 }))) + sw + 8;
        const at = so.at ?? "top-left", h = items.length * rowH;
        const [x, y] = Array.isArray(at) ? at : [at.endsWith("right") ? R - 10 - w : L + 10, at.startsWith("bottom") ? B - 8 - h : T + 8];
        items.forEach((it, i) => {
          const cy = y + i * rowH + rowH / 2, c = it.color ?? "ink";
          if (it.fill) { g.rect(x, cy - 5, sw - 4, 10, { fill: c, alpha: 0.25 }); g.rect(x, cy - 5, sw - 4, 10, { stroke: c, width: 1 }); }
          else g.line([x, cy], [x + sw - 4, cy], { stroke: c, width: it.width ?? 2, dash: it.dash });
          txt(it.label, [x + sw + 2, cy], { size: 12.5, color: "ink", align: "left", halo: true });
        });
        return [x, y, w, h];
      };

      // ---------- Measured data ----------
      // y at x on a list of [x, y] pairs sorted by x, by straight lines between them.
      const interp = (data, x) => {
        if (!data.length || x < data[0][0] || x > data[data.length - 1][0]) return NaN;
        let i = 1;
        while (i < data.length - 1 && data[i][0] < x) i++;
        const [x0, y0] = data[i - 1], [x1, y1] = data[i];
        return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      };
      P.interp = interp;
      // A line through [x, y] pairs: o.dots, o.fill (a soft area down to o.to, default 0),
      // o.smooth, o.label at the last point. Returns the px points.
      P.series = (data, so = {}) => {
        const pts = data.filter(q => q && Number.isFinite(q[0]) && Number.isFinite(q[1])).map(q => lim(toPx(q)));
        if (pts.length < 2) return pts;
        const c = so.color ?? "blue";
        clipped(so, () => {
          if (so.fill) {
            const base = ypx(so.to ?? 0);
            g.path([[pts[0][0], base], ...pts, [pts[pts.length - 1][0], base]], { fill: c, alpha: so.fillAlpha ?? 0.12, close: true });
          }
          (so.smooth ? g.spline : g.path)(pts, { stroke: c, width: so.width ?? 2, dash: so.dash, alpha: so.alpha });
          if (so.dots) for (const p of pts) g.circle(p, so.r ?? 3, { fill: c, stroke: "panel", width: 1.2, alpha: so.alpha });
        });
        if (so.label) {
          const end = pts[pts.length - 1], right = end[0] > R - 60;
          txt(so.label, [end[0] + (right ? -8 : 8), end[1] - (right ? 12 : 0)], { size: 12.5, color: c, weight: 600, halo: true, align: right ? "right" : "left" });
        }
        return pts;
      };
      // A band between lo and hi over xs (arrays the length of xs, or functions of x):
      // confidence intervals, ranges, envelopes.
      P.band = (xs, lo, hi, so = {}) => {
        const at = (v, x, i) => (typeof v === "function" ? v(x) : Array.isArray(v) ? v[i] : v);
        const top = xs.map((x, i) => lim(toPx([x, at(hi, x, i)]))), bot = xs.map((x, i) => lim(toPx([x, at(lo, x, i)])));
        clipped(so, () => {
          g.path([...top, ...bot.reverse()], { fill: so.color ?? "blue", alpha: so.alpha ?? 0.15, close: true });
          if (so.edges) { g.path(top, { stroke: so.color ?? "blue", width: 1, alpha: 0.5 }); g.path(bot, { stroke: so.color ?? "blue", width: 1, alpha: 0.5 }); }
        });
      };
      // Error bars: [x, y, err] or [x, y, below, above]; a dot with capped whiskers.
      P.errorbars = (list, so = {}) => {
        const c = so.color ?? "ink", cap = so.cap ?? 4;
        clipped(so, () => {
          for (const [x, y, e1, e2 = e1] of list) {
            const p = toPx([x, y]), lo = toPx([x, y - e1]), hi = toPx([x, y + e2]);
            g.line(lo, hi, { stroke: c, width: 1.2 });
            g.line([lo[0] - cap, lo[1]], [lo[0] + cap, lo[1]], { stroke: c, width: 1.2 });
            g.line([hi[0] - cap, hi[1]], [hi[0] + cap, hi[1]], { stroke: c, width: 1.2 });
            g.circle(p, so.r ?? 3.5, { fill: c, stroke: "panel", width: 1.2 });
          }
        });
      };
      // A histogram of raw samples (binned with Num.histogram) or of { edges, counts }.
      // o.bins, o.range, o.density (area 1, to compare with a pdf), o.color. Returns the bins.
      P.histogram = (samples, so = {}) => {
        const h = Array.isArray(samples) || ArrayBuffer.isView(samples) ? histogram(samples, { bins: so.bins ?? 20, range: so.range }) : samples;
        const total = h.counts.reduce((a, b) => a + b, 0) || 1;
        const k = so.density ? 1 / (total * h.width) : 1, c = so.color ?? "blue";
        clipped(so, () => h.counts.forEach((n, i) => {
          const a = lim(toPx([h.edges[i], n * k])), b = lim(toPx([h.edges[i + 1], 0]));
          const x = Math.min(a[0], b[0]) + 0.5, w = Math.max(0, Math.abs(b[0] - a[0]) - 1), y = Math.min(a[1], b[1]), hh = Math.abs(b[1] - a[1]);
          g.rect(x, y, w, hh, { fill: c, alpha: so.alpha ?? 0.22 });
          g.line([x, y], [x + w, y], { stroke: c, width: 1.5 });
        }));
        return { ...h, scale: k };
      };
      // A hover readout at data x: a guide line, a dot where each curve crosses it, and
      // value tags that keep clear of each other. curves: [{ f } or { data }, with color,
      // label, format]. Feed x from the figure's hover: s.hx = P.inv(p)[0].
      P.crosshair = (x, curves, so = {}) => {
        if (x == null || !Number.isFinite(x)) return [];
        const px = xpx(x);
        if (px < L - 0.5 || px > R + 0.5) return [];
        g.line([px, T], [px, B], { stroke: "muted", width: 1, dash: [3, 3] });
        const hits = curves.map(c => ({ c, y: c.f ? c.f(x) : interp(c.data, x) })).filter(h => Number.isFinite(h.y));
        hits.forEach(h => { h.p = toPx([x, h.y]); g.circle(h.p, 4, { fill: h.c.color ?? "blue", stroke: "panel", width: 1.6 }); });
        const left = px > R - 110, gap = 17;
        const ys = hits.map(h => clamp(h.p[1], T + 8, B - 8)).sort((a, b) => a - b);
        const order = [...hits].sort((a, b) => a.p[1] - b.p[1]);
        for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + gap);
        order.forEach((h, i) => {
          const v = h.c.format ? h.c.format(h.y) : fmt(h.y);
          txt(h.c.label ? `${h.c.label} ${v}` : v, [px + (left ? -9 : 9), ys[i]], { size: 12.5, weight: 600, color: h.c.color ?? "blue", halo: true, align: left ? "right" : "left" });
        });
        if (so.xLabel !== false) {
          const xs = so.xFormat ? so.xFormat(x) : fmt(x);
          txt(xs, [px, B + 14], { size: 11.5, weight: 600, color: "ink", halo: true });
        }
        return hits;
      };
      // Arrows of F(x, y) -> [u, v] on a grid; o.scale "linear" (length by magnitude) or "normalize" (same length, fade by magnitude).
      P.vectorField = (F, so = {}) => {
        const sp = so.spacing ?? 32, cols = Math.max(1, Math.floor(W / sp)), rows = Math.max(1, Math.floor(H / sp));
        const x0 = L + (W - (cols - 1) * sp) / 2, y0 = T + (H - (rows - 1) * sp) / 2;
        const samples = [];
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const p = [x0 + i * sp, y0 + j * sp], q = P.inv(p), v = F(q[0], q[1]);
          if (!v || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) continue;
          samples.push({ p, d: [v[0] * sx, -v[1] * sy], m: Math.hypot(v[0], v[1]) });
        }
        const max = so.max ?? Math.max(1e-12, ...samples.map(s => s.m));
        const c = so.color ?? "muted";
        for (const s of samples) {
          const r = clamp(s.m / max, 0, 1), dl = Math.hypot(s.d[0], s.d[1]);
          if (!dl) continue;
          const len = so.scale === "normalize" ? sp * 0.62 : sp * 0.85 * r;
          if (len < 3) { g.circle(s.p, 1.2, { fill: c, alpha: 0.6 }); continue; }
          const u = [s.d[0] / dl, s.d[1] / dl], a = [s.p[0] - (u[0] * len) / 2, s.p[1] - (u[1] * len) / 2], b = [s.p[0] + (u[0] * len) / 2, s.p[1] + (u[1] * len) / 2];
          g.arrow(a, b, { stroke: c, width: so.width ?? 1.2, head: Math.min(7, len * 0.45), alpha: so.scale === "normalize" ? 0.3 + 0.7 * r : so.alpha });
        }
        return samples.length;
      };
      // Curves that follow F from each seed (data points; default a grid), traced with RK4 in screen space.
      P.streamlines = (F, seeds, so = {}) => {
        const dir = p => {
          const q = P.inv(p), v = F(q[0], q[1]);
          if (!v) return null;
          const d = [v[0] * sx, -v[1] * sy], m = Math.hypot(d[0], d[1]);
          return m > 1e-12 && Number.isFinite(m) ? [d[0] / m, d[1] / m] : null;
        };
        const h = so.step ?? 3, maxSteps = so.maxSteps ?? 500, inside = p => p[0] >= L && p[0] <= R && p[1] >= T && p[1] <= B;
        const trace = (p0, sgn) => {
          const pts = [p0];
          let p = p0;
          for (let i = 0; i < maxSteps; i++) {
            const k1 = dir(p); if (!k1) break;
            const k2 = dir([p[0] + (sgn * h * k1[0]) / 2, p[1] + (sgn * h * k1[1]) / 2]); if (!k2) break;
            const k3 = dir([p[0] + (sgn * h * k2[0]) / 2, p[1] + (sgn * h * k2[1]) / 2]); if (!k3) break;
            const k4 = dir([p[0] + sgn * h * k3[0], p[1] + sgn * h * k3[1]]); if (!k4) break;
            p = [p[0] + (sgn * h * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])) / 6, p[1] + (sgn * h * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])) / 6];
            if (!inside(p)) break;
            pts.push(p);
            if (i > 20 && Math.hypot(p[0] - p0[0], p[1] - p0[1]) < h) { pts.push(p0); break; }
          }
          return pts;
        };
        if (!seeds) {
          seeds = [];
          const n = so.count ?? [7, 5];
          for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) seeds.push(P.inv([L + ((i + 0.5) / n[0]) * W, T + ((j + 0.5) / n[1]) * H]));
        }
        const c = so.color ?? "blue", lines = [];
        clipped(so, () => {
          for (const s of seeds) {
            const p0 = toPx(s), fwd = trace(p0, 1), back = so.both === false ? [] : trace(p0, -1).reverse().slice(0, -1);
            const line = [...back, ...fwd];
            if (line.length < 3) continue;
            lines.push(line);
            g.path(line, { stroke: c, width: so.width ?? 1.4, alpha: so.alpha ?? 0.9 });
            const m = Math.floor(line.length / 2);
            if (so.arrows !== false && m > 1) head(line[m], v2.sub(line[m], line[m - 2]), 7, c);
          }
        });
        return lines;
      };
      // Level curves of f(x, y) by marching squares; levels is a list or a count.
      P.contour = (f, levels = 8, so = {}) => {
        const res = so.res ?? 6, nx = Math.max(2, Math.ceil(W / res)), ny = Math.max(2, Math.ceil(H / res));
        const V = [];
        let mn = Infinity, mx = -Infinity;
        for (let j = 0; j <= ny; j++) {
          const row = [];
          for (let i = 0; i <= nx; i++) {
            const q = P.inv([L + (i / nx) * W, T + (j / ny) * H]), v = f(q[0], q[1]);
            row.push(v);
            if (Number.isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
          }
          V.push(row);
        }
        const lv = Array.isArray(levels) ? levels : linspace(mn, mx, levels + 2).slice(1, -1);
        const X = i => L + (i / nx) * W, Y = j => T + (j / ny) * H;
        const EDGES = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[0, 1], [3, 2]], [[0, 2]], [[3, 0]], [[3, 0]], [[0, 2]], [[3, 0], [2, 1]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []];
        clipped(so, () => lv.forEach((c, k) => {
          const ctx = g.ctx;
          ctx.save();
          ctx.beginPath();
          for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const a = V[j][i], b = V[j][i + 1], d = V[j + 1][i + 1], e = V[j + 1][i];
            if (![a, b, d, e].every(Number.isFinite)) continue;
            const idx = (a > c ? 8 : 0) | (b > c ? 4 : 0) | (d > c ? 2 : 0) | (e > c ? 1 : 0);
            const t = (u, w) => (c - u) / (w - u || 1e-12);
            const pt = edge => edge === 0 ? [lerp(X(i), X(i + 1), t(a, b)), Y(j)] : edge === 1 ? [X(i + 1), lerp(Y(j), Y(j + 1), t(b, d))]
              : edge === 2 ? [lerp(X(i), X(i + 1), t(e, d)), Y(j + 1)] : [X(i), lerp(Y(j), Y(j + 1), t(a, e))];
            for (const [e1, e2] of EDGES[idx]) { const p = pt(e1), q = pt(e2); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
          }
          ctx.strokeStyle = util.color(Array.isArray(so.colors) ? so.colors[k % so.colors.length] : so.color ?? "muted");
          ctx.lineWidth = so.width ?? 1.2;
          ctx.lineCap = ctx.lineJoin = "round";
          if (so.dash) ctx.setLineDash(so.dash);
          ctx.stroke();
          ctx.restore();
        }));
        return { levels: lv, min: mn, max: mx };
      };
      // f(x, y) as color under the axes; o.map "diverging" (default) or "sequential", o.range, o.low, o.high.
      P.heat = (f, so = {}) => {
        let rng2 = so.range;
        if (!rng2) {
          let mn = Infinity, mx = -Infinity;
          for (let j = 0; j <= 24; j++) for (let i = 0; i <= 24; i++) { const q = P.inv([L + (i / 24) * W, T + (j / 24) * H]), v = f(q[0], q[1]); if (Number.isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); } }
          const m = Math.max(Math.abs(mn), Math.abs(mx)) || 1;
          rng2 = (so.map ?? "diverging") === "diverging" ? [-m, m] : [mn, mx];
        }
        g.field((px, py) => { const q = P.inv([px, py]); return f(q[0], q[1]); }, { box: [L, T, W, H], res: so.res ?? 3, range: rng2, map: so.map, low: so.low, high: so.high, alpha: so.alpha });
        drawAxes();
        return rng2;
      };
      return P;
    };

    // ----- Mechanics -----
    // A coil spring from a to b (px). o.coils [8], o.radius [7], o.lead [10] straight ends, o.style "coil" | "zigzag".
    g.spring = (a, b, o = {}) => {
      const d = v2.sub(b, a), len = v2.len(d) || 1, u = [d[0] / len, d[1] / len], n = [-u[1], u[0]];
      const coils = o.coils ?? 8, r = o.radius ?? 7, lead = Math.min(o.lead ?? 10, len / 4), body = Math.max(0, len - 2 * lead);
      const at = (s, off) => [a[0] + u[0] * s + n[0] * off, a[1] + u[1] * s + n[1] * off];
      const pts = [a, at(lead, 0)];
      if (o.style === "zigzag") {
        for (let i = 0; i < 2 * coils; i++) pts.push(at(lead + ((i + 0.5) / (2 * coils)) * body, i % 2 ? -r : r));
      } else {
        // A helix seen slightly from the side: each turn leans back by tilt, so a squeezed spring shows loops.
        const N = coils * 28, pitch = body / coils, tilt = Math.min(1.2 * r, Math.max((o.tilt ?? 0.5) * r, (1.7 * pitch) / TAU));
        for (let i = 1; i < N; i++) {
          const t = i / N, th = TAU * coils * t;
          pts.push(at(lead + t * body + tilt * (Math.cos(th) - 1), r * Math.sin(th)));
        }
      }
      pts.push(at(lead + body, 0), b);
      g.path(pts, { stroke: o.color ?? "ink", width: o.width ?? 1.5 });
      return { a, b, length: len };
    };
    // A surface from a to b with hatching on one side (side 1: to the right of a->b, which is below for left-to-right).
    g.ground = (a, b, o = {}) => {
      const d = v2.sub(b, a), len = v2.len(d) || 1, u = [d[0] / len, d[1] / len], side = o.side ?? 1, n = [-u[1] * side, u[0] * side];
      const gap = o.gap ?? 8, depth = o.depth ?? 8, c = o.color ?? "muted";
      for (let s = gap / 2; s < len; s += gap) {
        const p = [a[0] + u[0] * s, a[1] + u[1] * s];
        g.line(p, [p[0] + n[0] * depth - u[0] * depth * 0.7, p[1] + n[1] * depth - u[1] * depth * 0.7], { stroke: c, width: 1 });
      }
      g.line(a, b, { stroke: o.line ?? "ink", width: o.width ?? 1.6 });
      return { a, b, normal: [-n[0], -n[1]] };
    };
    g.wall = (a, b, o = {}) => g.ground(a, b, o);
    // A labeled block centered at c; o.color tints it, o.label ("m", "$m_1$", "2 kg") sits in the middle.
    g.block = (c, w, h, o = {}) => {
      const x = c[0] - w / 2, y = c[1] - h / 2;
      tinted(s => g.rect(x, y, w, h, { ...s, r: o.r ?? 3 }), o.color ?? "grid", o.color ? 0.3 : 1);
      g.rect(x, y, w, h, { stroke: "ink", width: o.width ?? 1.5, r: o.r ?? 3 });
      if (o.label) txt(o.label, c, { size: o.size ?? 14, color: "ink", weight: 600 });
      return { x, y, w, h, c, top: [c[0], y], bottom: [c[0], y + h], left: [x, c[1]], right: [x + w, c[1]], hit: p => p[0] >= x && p[0] <= x + w && p[1] >= y && p[1] <= y + h };
    };
    g.mass = g.block;
    // A pulley wheel; o.angle turns three spoke marks so rotation shows.
    g.pulley = (c, r, o = {}) => {
      tinted(s => g.circle(c, r, s), o.color, 0.25);
      g.circle(c, r, { stroke: "ink", width: 1.5 });
      g.circle(c, r - 3.5, { stroke: "muted", width: 1 });
      const a = o.angle ?? 0;
      for (let k = 0; k < 3; k++) { const t = a + (k * TAU) / 3; g.line([c[0] + Math.cos(t) * r * 0.25, c[1] + Math.sin(t) * r * 0.25], [c[0] + Math.cos(t) * (r - 6), c[1] + Math.sin(t) * (r - 6)], { stroke: "muted", width: 1.2 }); }
      g.circle(c, 2.6, { fill: "ink" });
      if (o.mount) { g.line(c, o.mount, { stroke: "ink", width: 2 }); }
      return { c, r };
    };
    // A wave along a->b: f(s) gives the sideways displacement in px at distance s (px) from a.
    g.wave = (a, b, f, o = {}) => {
      const d = v2.sub(b, a), len = v2.len(d) || 1, u = [d[0] / len, d[1] / len], n = [-u[1], u[0]], N = o.samples ?? Math.max(24, Math.round(len / 2));
      const pts = [];
      for (let i = 0; i <= N; i++) { const s = (i / N) * len, y = f(s); pts.push([a[0] + u[0] * s + n[0] * y, a[1] + u[1] * s + n[1] * y]); }
      g.path(pts, { stroke: o.color ?? "blue", width: o.width ?? 2, dash: o.dash, alpha: o.alpha });
      return pts;
    };
    // An angle mark at corner c from angle a0 to a1 (canvas radians, y down); o.right draws the square right-angle mark.
    g.angleMark = (c, a0, a1, r = 22, o = {}) => {
      const col = o.color ?? "ink";
      if (o.right) {
        const s = r * 0.5, p1 = [c[0] + Math.cos(a0) * s, c[1] + Math.sin(a0) * s], p2 = [c[0] + Math.cos(a1) * s, c[1] + Math.sin(a1) * s];
        g.path([p1, [p1[0] + p2[0] - c[0], p1[1] + p2[1] - c[1]], p2], { stroke: col, width: 1.2 });
        return;
      }
      const n = 24, pts = [];
      for (let i = 0; i <= n; i++) { const t = lerp(a0, a1, i / n); pts.push([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r]); }
      if (o.fill !== false) g.path([c, ...pts], { fill: col, alpha: 0.12, close: true });
      g.path(pts, { stroke: col, width: 1.5 });
      if (o.label) { const t = (a0 + a1) / 2, k = r + (o.labelGap ?? 12); txt(o.label, [c[0] + Math.cos(t) * k, c[1] + Math.sin(t) * k], { size: 14, color: col, halo: true }); }
    };
    // A curly brace from a to b, bulging to the right of a->b, with a label past its tip.
    g.brace = (a, b, label, o = {}) => {
      const d = v2.sub(b, a), len = v2.len(d) || 1, u = [d[0] / len, d[1] / len], side = o.side ?? 1, n = [-u[1] * side, u[0] * side], k = o.depth ?? 8;
      const P2 = (s, off) => [a[0] + u[0] * s + n[0] * off, a[1] + u[1] * s + n[1] * off];
      const ctx = g.ctx, m = len / 2, c = o.color ?? "muted";
      ctx.save();
      ctx.beginPath();
      const q = (p1, p2) => ctx.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]);
      let p = P2(0, 0); ctx.moveTo(p[0], p[1]);
      q(P2(0, k / 2), P2(Math.min(k, m / 2), k / 2));
      p = P2(m - Math.min(k, m / 2), k / 2); ctx.lineTo(p[0], p[1]);
      q(P2(m, k / 2), P2(m, k));
      q(P2(m, k / 2), P2(m + Math.min(k, m / 2), k / 2));
      p = P2(len - Math.min(k, m / 2), k / 2); ctx.lineTo(p[0], p[1]);
      q(P2(len, k / 2), P2(len, 0));
      ctx.strokeStyle = util.color(c); ctx.lineWidth = o.width ?? 1.2; ctx.stroke();
      ctx.restore();
      if (label) {
        const t = P2(m, k + 12), horizontal = Math.abs(n[0]) < 0.5;
        txt(label, t, { size: o.size ?? 13, color: o.textColor ?? c, align: horizontal ? "center" : n[0] > 0 ? "left" : "right", halo: true });
      }
    };

    // ----- Electricity -----
    g.charge = (p, sign, o = {}) => {
      const r = o.r ?? 11, c = o.color ?? (sign > 0 ? "red" : sign < 0 ? "blue" : "muted");
      tinted(s => g.circle(p, r, s), c, 0.22);
      g.circle(p, r, { stroke: c, width: 1.5 });
      const k = r * 0.45;
      if (sign !== 0) g.line([p[0] - k, p[1]], [p[0] + k, p[1]], { stroke: c, width: 2 });
      if (sign > 0) g.line([p[0], p[1] - k], [p[0], p[1] + k], { stroke: c, width: 2 });
      if (o.label) txt(o.label, [p[0], p[1] + r + 12], { size: 12.5, color: c, halo: true });
      return { p, r, hit: q => Math.hypot(q[0] - p[0], q[1] - p[1]) <= r + 4 };
    };
    // Field lines of point charges [{ p: [px, py], q }] traced from the positive charges (or into the negative ones).
    g.fieldLines = (charges, o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h], c = o.color ?? "muted", step = o.step ?? 3, perUnit = o.density ?? 8;
      const E = p => {
        let ex = 0, ey = 0;
        for (const ch of charges) { const dx = p[0] - ch.p[0], dy = p[1] - ch.p[1], r2 = dx * dx + dy * dy, r3 = r2 * Math.sqrt(r2) || 1e-9; ex += (ch.q * dx) / r3; ey += (ch.q * dy) / r3; }
        return [ex, ey];
      };
      const pos = charges.some(ch => ch.q > 0), sources = charges.filter(ch => (pos ? ch.q > 0 : ch.q < 0)), sgn = pos ? 1 : -1;
      const inside = p => p[0] >= box[0] - 20 && p[0] <= box[0] + box[2] + 20 && p[1] >= box[1] - 20 && p[1] <= box[1] + box[3] + 20;
      const lines = [];
      for (const src of sources) {
        const n = Math.max(4, Math.round(Math.abs(src.q) * perUnit)), r0 = (o.r ?? 11) + 2;
        for (let k = 0; k < n; k++) {
          const t = ((k + 0.5) * TAU) / n;
          let p = [src.p[0] + Math.cos(t) * r0, src.p[1] + Math.sin(t) * r0];
          const pts = [p];
          for (let i = 0; i < (o.maxSteps ?? 1500); i++) {
            const e = E(p), m = Math.hypot(e[0], e[1]);
            if (!(m > 0)) break;
            const mid = [p[0] + (sgn * step * e[0]) / m / 2, p[1] + (sgn * step * e[1]) / m / 2], e2 = E(mid), m2 = Math.hypot(e2[0], e2[1]) || 1;
            p = [p[0] + (sgn * step * e2[0]) / m2, p[1] + (sgn * step * e2[1]) / m2];
            pts.push(p);
            if (!inside(p) || charges.some(ch => ch !== src && Math.hypot(p[0] - ch.p[0], p[1] - ch.p[1]) < r0 - 1)) break;
          }
          lines.push(pts);
        }
      }
      g.clip(box, () => {
        for (const pts of lines) {
          g.path(pts, { stroke: c, width: o.width ?? 1.1 });
          const m = Math.min(pts.length - 1, Math.floor(pts.length * 0.4));
          if (m > 2) head(pts[m], sgn > 0 ? v2.sub(pts[m], pts[m - 2]) : v2.sub(pts[m - 2], pts[m]), 6.5, c);
        }
      });
      return lines;
    };

    // ----- Chemistry -----
    // An atom as a tinted disc with its symbol; o.r, o.scale, o.charge ("+", "δ−"), o.label below.
    g.atom = (p, el, o = {}) => {
      const [c, size] = ATOM[el] ?? ["muted", 1];
      const r = o.r ?? 13 * size * (o.scale ?? 1), dark = c === "ink";
      if (dark) { g.circle(p, r, { fill: "panel" }); g.circle(p, r, { fill: "ink", alpha: 0.78 }); }
      else tinted(s => g.circle(p, r, s), c === "panel" ? null : c, 0.32);
      g.circle(p, r, { stroke: "ink", width: o.width ?? 1.3, alpha: o.alpha });
      if (o.symbol !== false && r >= 6) g.text(el, [p[0], p[1] + 0.5], { size: Math.max(9, r * 0.92), weight: 600, color: dark ? "panel" : "ink" });
      if (o.charge) txt(o.charge, [p[0] + r * 0.85, p[1] - r * 0.85], { size: 12, color: o.chargeColor ?? "ink", align: "left", halo: true, weight: 600 });
      if (o.label) txt(o.label, [p[0], p[1] + r + 12], { size: 12, color: "muted", halo: true });
      return { p, r, hit: q => Math.hypot(q[0] - p[0], q[1] - p[1]) <= r };
    };
    // A bond from a to b; o.order 1, 2, 3, or 1.5; o.r1/o.r2 trim it at the atoms' edges; o.style "dashed" for hydrogen bonds.
    g.bond = (a, b, o = {}) => {
      const d = v2.sub(b, a), len = v2.len(d) || 1, u = [d[0] / len, d[1] / len], n = [-u[1], u[0]];
      const A = [a[0] + u[0] * (o.r1 ?? 0), a[1] + u[1] * (o.r1 ?? 0)], Bp = [b[0] - u[0] * (o.r2 ?? 0), b[1] - u[1] * (o.r2 ?? 0)];
      const c = o.color ?? "ink", w = o.width ?? 2, gap = o.gap ?? 4.5, order = o.order ?? 1;
      const seg = (off, dash) => g.line([A[0] + n[0] * off, A[1] + n[1] * off], [Bp[0] + n[0] * off, Bp[1] + n[1] * off], { stroke: c, width: w, dash });
      const dashed = o.style === "dashed" ? [2, 4] : undefined;
      if (order === 2) { seg(-gap / 2, dashed); seg(gap / 2, dashed); }
      else if (order === 3) { seg(-gap, dashed); seg(0, dashed); seg(gap, dashed); }
      else if (order === 1.5) { seg(-gap / 2, dashed); seg(gap / 2, [4, 3]); }
      else seg(0, dashed);
      return { a: A, b: Bp };
    };
    // Energy levels: items [{ E, label, color }] as bars in o.box, on an energy axis o.range; o.transitions [{ from, to, color, label }] are arrows between them.
    g.levels = (items, o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h], [x, y, w, h] = box;
      const Es = items.map(it => it.E), [lo, hi] = o.range ?? [Math.min(...Es), Math.max(...Es)];
      const top = o.axis === false ? 14 : 30, Y = E => y + h - 14 - ((E - lo) / (hi - lo || 1)) * (h - 14 - top);
      const lx = x + (o.axis === false ? 0 : 28), barW = o.barWidth ?? Math.min(150, (w - lx + x) * 0.45);
      if (o.axis !== false) {
        g.arrow([x + 12, y + h - 6], [x + 12, y + 4], { stroke: "muted", width: 1.2, head: 7 });
        txt(o.axisLabel ?? "Energy", [x + 18, y + 8], { size: 12, color: "muted", align: "left" });
      }
      const out = items.map((it, i) => {
        const col = it.column ?? 0, bx = lx + 10 + col * (barW + 40), by = Y(it.E), c = it.color ?? "ink";
        g.line([bx, by], [bx + barW, by], { stroke: c, width: it.width ?? 2.5 });
        if (it.label) txt(it.label, [bx + barW + 8, by], { size: 12.5, color: c, align: "left", halo: true });
        return { ...it, y: by, x0: bx, x1: bx + barW, i };
      });
      for (const tr of o.transitions ?? []) {
        const a = out[tr.from], b = out[tr.to], tx = (Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2 + (tr.dx ?? 0);
        g.arrow([tx, a.y], [tx, b.y], { stroke: tr.color ?? "orange", width: 1.8, head: 8 });
        if (tr.label) txt(tr.label, [tx + 8, (a.y + b.y) / 2], { size: 12.5, color: tr.color ?? "orange", align: "left", halo: true });
      }
      return { levels: out, y: Y };
    };
    // Reaction-coordinate diagram: o.energies [reactants, transition state, products], o.catalyzed (a lower peak, dashed),
    // o.show { ea, dh } for the barrier and ΔH arrows, o.labels { reactants, products, ts }.
    g.reaction = (o = {}) => {
      const [er, ets, ep] = o.energies ?? [0, 1, -0.4];
      const all = [er, ets, ep, o.catalyzed ?? ets], lo = Math.min(...all), hi = Math.max(...all), pad2 = (hi - lo) * 0.18 || 1;
      const P = g.graph({ box: o.box, x: [0, 1], y: [lo - pad2, hi + pad2], axes: "frame", grid: false, xTicks: false, yTicks: false, xLabel: o.xLabel ?? "Reaction progress", yLabel: o.yLabel ?? "Energy", zeroLine: false });
      const keys = top => [[0, er], [0.18, er], [0.5, top], [0.82, ep], [1, ep]];
      const curve = top => t => {
        const k = keys(top);
        for (let i = 0; i < k.length - 1; i++) if (t <= k[i + 1][0]) { const s = (t - k[i][0]) / (k[i + 1][0] - k[i][0] || 1); return lerp(k[i][1], k[i + 1][1], (1 - Math.cos(Math.PI * s)) / 2); }
        return ep;
      };
      const E = curve(ets);
      if (o.catalyzed != null) P.fn(curve(o.catalyzed), { color: o.catalyzedColor ?? "green", dash: [5, 4], width: 1.8 });
      P.fn(E, { color: o.color ?? "ink", width: 2.2 });
      const lab = o.labels ?? {};
      if (lab.reactants) P.label(lab.reactants, [0.02, er], { dy: -13, color: "ink", align: "left" });
      if (lab.products) P.label(lab.products, [0.9, ep], { dy: -13, color: "ink" });
      if (lab.ts) P.label(lab.ts, [0.5, ets], { dy: -14, color: "ink" });
      const show = o.show ?? {};
      if (show.ea) {
        P.segment([0.18, er], [0.56, er], { color: "muted", width: 1, dash: [3, 3] });
        P.vector([0.5, er], [0.5, ets], { color: "orange", width: 1.6 });
        P.label(show.eaLabel ?? "$E_a$", [0.5, (er + ets) / 2], { dx: 9, color: "orange", align: "left" });
      }
      if (show.dh) {
        P.segment([0.62, er], [1, er], { color: "muted", width: 1, dash: [3, 3] });
        P.vector([0.985, er], [0.985, ep], { color: "blue", width: 1.6 });
        P.label(show.dhLabel ?? "ΔH", [0.985, (er + ep) / 2], { dx: -8, color: "blue", align: "right" });
      }
      return { ...P, P, E };
    };

    // ----- Data -----
    // Bars for a list of values in o.box; o.labels, o.highlight (index or list), o.colors, o.range, o.values (show numbers), o.format,
    // o.horizontal (labels on the left, good for ranked probabilities). Returns { bars, hit(p) -> index | -1 }.
    g.bars = (values, o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h], [bx, by, bw, bh] = box, n = values.length;
      const lo = o.range?.[0] ?? Math.min(0, ...values), hi = o.range?.[1] ?? Math.max(0, ...values);
      const hl = o.highlight == null ? null : new Set([].concat(o.highlight));
      const colorOf = i => (Array.isArray(o.colors) ? o.colors[i] : o.color ?? "blue");
      const fmtv = o.format ?? (v => fmt(v));
      const bars = [];
      if (o.horizontal) {
        const labW = o.labels ? Math.max(0, ...o.labels.map(s => txtWidth(s, { size: 12.5, font: o.labelFont }))) + 10 : 0;
        const valW = o.values ? Math.max(...values.map(v => g.measure(fmtv(v), { size: 12 }))) + 8 : 0;
        const x0 = bx + labW, W2 = bw - labW - valW, rowH = bh / n, barH = Math.min(rowH * 0.7, o.barHeight ?? 22);
        const X = v => x0 + ((v - lo) / (hi - lo || 1)) * W2;
        values.forEach((v, i) => {
          const cy = by + rowH * (i + 0.5), a = X(Math.max(lo, Math.min(0, v))), b = X(Math.min(hi, Math.max(0, v)));
          const on = !hl || hl.has(i), c = colorOf(i);
          g.rect(a, cy - barH / 2, Math.max(1, b - a), barH, { fill: on ? c : "faint", alpha: on ? (hl ? 0.85 : 0.7) : 1, r: 2 });
          if (o.labels) txt(o.labels[i], [x0 - 8, cy], { size: 12.5, color: on ? "ink" : "muted", align: "right", font: o.labelFont });
          if (o.values) g.text(fmtv(v), [b + 6, cy], { size: 12, color: on ? "ink" : "muted", align: "left" });
          bars.push({ i, x: a, y: cy - barH / 2, w: b - a, h: barH, value: v });
        });
        g.line([X(0), by], [X(0), by + bh], { stroke: "muted", width: 1 });
      } else {
        const labH = o.labels ? 18 : 0, valH = o.values ? 16 : 0, H2 = bh - labH - valH, y0 = by + valH;
        const Y = v => y0 + H2 - ((v - lo) / (hi - lo || 1)) * H2;
        const slot = bw / n, barW = Math.min(slot * (1 - (o.gap ?? 0.28)), o.barWidth ?? 60);
        // Labels shrink to fit their slot, then get cut short with an ellipsis.
        let labSize = 12;
        const fit = s => {
          s = String(s);
          if (txtWidth(s, { size: labSize, font: o.labelFont }) <= slot - 4 || s.startsWith("$")) return s;
          while (s.length > 1 && txtWidth(s + "…", { size: labSize, font: o.labelFont }) > slot - 4) s = s.slice(0, -1);
          return s + "…";
        };
        if (o.labels) {
          const widest = Math.max(...o.labels.map(s => txtWidth(s, { size: 12, font: o.labelFont })));
          if (widest > slot - 4) labSize = Math.max(9.5, (12 * (slot - 4)) / widest);
        }
        values.forEach((v, i) => {
          const cx = bx + slot * (i + 0.5), top = Y(Math.max(0, v)), bot = Y(Math.min(0, v)), on = !hl || hl.has(i), c = colorOf(i);
          g.rect(cx - barW / 2, top, barW, Math.max(1, bot - top), { fill: on ? c : "faint", alpha: on ? (hl ? 0.85 : 0.7) : 1, r: 2 });
          if (o.labels) txt(fit(o.labels[i]), [cx, by + bh - 8], { size: labSize, color: on ? "ink" : "muted", font: o.labelFont });
          if (o.values) g.text(fmtv(v), [cx, (v >= 0 ? top : bot) + (v >= 0 ? -9 : 9)], { size: 11.5, color: on ? "ink" : "muted" });
          bars.push({ i, x: cx - barW / 2, y: top, w: barW, h: bot - top, value: v });
        });
        g.line([bx, Y(0)], [bx + bw, Y(0)], { stroke: "muted", width: 1 });
      }
      const hit = p => { const b = bars.find(r => p[0] >= r.x - 2 && p[0] <= r.x + Math.max(r.w, 4) + 2 && p[1] >= r.y - 2 && p[1] <= r.y + Math.max(r.h, 4) + 2); return b ? b.i : -1; };
      return { bars, hit };
    };
    // A matrix as colored cells (attention weights, confusion matrices); o.rowLabels, o.colLabels, o.range,
    // o.color (sequential) or o.diverging: true (o.low, o.high), o.values to print numbers, o.highlight { row, col }.
    g.heatmap = (M, o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h], rows = M.length, cols = M[0]?.length ?? 0;
      const flat = M.flat().filter(Number.isFinite);
      const [lo, hi] = o.range ?? (o.diverging ? [-Math.max(...flat.map(Math.abs)), Math.max(...flat.map(Math.abs))] : [Math.min(0, ...flat), Math.max(...flat)]);
      const LS = { size: o.labelSize ?? 12, color: "muted", font: o.labelFont };
      const left = o.rowLabels ? Math.max(0, ...o.rowLabels.map(s => txtWidth(s, LS))) + 8 : 0;
      const colW = o.colLabels ? Math.max(0, ...o.colLabels.map(s => txtWidth(s, LS))) : 0;
      let cell = Math.min((box[2] - left) / cols, (box[3] - (o.colLabels ? 18 : 0)) / rows);
      const rotate = o.colLabels && colW > cell - 4;
      const top = o.colLabels ? (rotate ? Math.min(colW * 0.72 + 8, box[3] * 0.35) : 18) : 0;
      cell = Math.min((box[2] - left) / cols, (box[3] - top) / rows);
      if (o.square === false) cell = null;
      const cw = cell ?? (box[2] - left) / cols, ch = cell ?? (box[3] - top) / rows;
      const x0 = box[0] + left + (o.align === "left" || !cell ? 0 : (box[2] - left - cw * cols) / 2), y0 = box[1] + top;
      const cellAt = (i, j) => [x0 + j * cw, y0 + i * ch, cw, ch];
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const v = M[i][j], [x, y] = cellAt(i, j);
        g.rect(x + 0.5, y + 0.5, cw - 1, ch - 1, { fill: "panel" });
        if (!Number.isFinite(v)) continue;
        let c, a;
        if (o.diverging) { const t = clamp(v / Math.max(Math.abs(lo), Math.abs(hi), 1e-12), -1, 1); c = t < 0 ? o.low ?? "blue" : o.high ?? "red"; a = Math.abs(t) * 0.9; }
        else { const t = clamp((v - lo) / (hi - lo || 1), 0, 1); c = o.color ?? "blue"; a = 0.05 + t * 0.88; }
        g.rect(x + 0.5, y + 0.5, cw - 1, ch - 1, { fill: c, alpha: a });
        if (o.values && cw > 26 && ch > 14) g.text((o.format ?? (u => fmt(u, { fixed: 2 })))(v), [x + cw / 2, y + ch / 2], { size: Math.min(12, ch * 0.42), color: a > 0.6 ? "panel" : "ink" });
      }
      g.rect(x0, y0, cw * cols, ch * rows, { stroke: "faint", width: 1 });
      if (o.rowLabels) o.rowLabels.forEach((s, i) => txt(s, [x0 - 7, y0 + ch * (i + 0.5)], { ...LS, align: "right", color: o.highlight?.row === i ? "ink" : "muted" }));
      if (o.colLabels) o.colLabels.forEach((s, j) => {
        const p = [x0 + cw * (j + 0.5), y0 - 7], c = o.highlight?.col === j ? "ink" : "muted";
        if (!rotate) { txt(s, [p[0], y0 - 9], { ...LS, color: c }); return; }
        const ctx = g.ctx;
        ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(-Math.PI / 4);
        txt(s, [0, 0], { ...LS, color: c, align: "left" });
        ctx.restore();
      });
      const hlt = o.highlight;
      if (hlt) {
        if (hlt.row != null && hlt.col != null) { const [x, y] = cellAt(hlt.row, hlt.col); g.rect(x, y, cw, ch, { stroke: "ink", width: 2 }); }
        else if (hlt.row != null) g.rect(x0, y0 + hlt.row * ch, cw * cols, ch, { stroke: "ink", width: 2 });
        else if (hlt.col != null) g.rect(x0 + hlt.col * cw, y0, cw, ch * rows, { stroke: "ink", width: 2 });
      }
      const hit = p => { const j = Math.floor((p[0] - x0) / cw), i = Math.floor((p[1] - y0) / ch); return i >= 0 && i < rows && j >= 0 && j < cols ? { i, j } : null; };
      return { cell: cellAt, hit, box: [x0, y0, cw * cols, ch * rows], range: [lo, hi] };
    };
    // A neural network as nodes and edges. layers: counts ([2, 3, 1]) or label lists. o.weights[l][j][i] is the weight from
    // node i of layer l to node j of layer l + 1 (signed: blue positive, red negative); o.activations[l][i] in [0, 1] fills nodes.
    g.network = (layers, o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h], counts = layers.map(l => (Array.isArray(l) ? l.length : l));
      const labH = o.labels ? 20 : 0, n = counts.length, maxN = Math.max(...counts);
      const colGap = box[2] / n, rowGap = (box[3] - labH) / maxN;
      const r = o.r ?? clamp(Math.min(colGap, rowGap) * 0.24, 5, 17);
      const nodes = counts.map((k, l) => Array.from({ length: k }, (_, i) => ({ p: [box[0] + colGap * (l + 0.5), box[1] + (box[3] - labH) / 2 + (i - (k - 1) / 2) * rowGap], r, layer: l, i })));
      const W = o.weights;
      let maxW = 0;
      if (W) for (const m of W) for (const row of m) for (const w of row) maxW = Math.max(maxW, Math.abs(w));
      for (let l = 0; l < n - 1; l++) for (let j = 0; j < counts[l + 1]; j++) for (let i = 0; i < counts[l]; i++) {
        const a = nodes[l][i].p, b = nodes[l + 1][j].p, w = W?.[l]?.[j]?.[i];
        const hot = o.highlight && ((o.highlight.layer === l && o.highlight.i === i) || (o.highlight.layer === l + 1 && o.highlight.i === j));
        if (w == null) g.line(a, b, { stroke: hot ? "ink" : "faint", width: hot ? 1.5 : 1 });
        else { const t = Math.abs(w) / (maxW || 1); g.line(a, b, { stroke: w >= 0 ? o.posColor ?? "blue" : o.negColor ?? "red", width: 0.5 + 3 * t, alpha: hot ? 1 : 0.2 + 0.6 * t }); }
      }
      nodes.forEach((col, l) => col.forEach((nd, i) => {
        const act = o.activations?.[l]?.[i];
        tinted(s => g.circle(nd.p, r, s), act == null ? null : o.color ?? "brass", act == null ? 0 : clamp(act, 0, 1) * 0.85);
        const hot = o.highlight && o.highlight.layer === l && o.highlight.i === i;
        g.circle(nd.p, r, { stroke: "ink", width: hot ? 2.5 : 1.3 });
        const lab = Array.isArray(layers[l]) ? layers[l][i] : o.nodeLabels?.[l]?.[i];
        if (lab != null && lab !== "") txt(lab, nd.p, { size: Math.max(9, r * 0.85), color: act > 0.6 ? "panel" : "ink", weight: 600 });
        else if (o.showValues && act != null) g.text(fmt(act, { fixed: 2 }), nd.p, { size: Math.max(8, r * 0.62), color: act > 0.6 ? "panel" : "ink" });
      }));
      if (o.labels) o.labels.forEach((s, l) => txt(s, [box[0] + colGap * (l + 0.5), box[1] + box[3] - 8], { size: 12, color: "muted" }));
      const hit = p => { for (const col of nodes) for (const nd of col) if (Math.hypot(p[0] - nd.p[0], p[1] - nd.p[1]) <= r + 3) return { layer: nd.layer, i: nd.i }; return null; };
      return { nodes, hit, r };
    };
    // A row of token chips that wraps inside o.width, starting at o.at (top-left). o.highlight (index), o.colors ("cycle", a palette
    // name, or a list), o.values (a small number under each chip, like a probability), o.showSpaces (leading spaces as ·).
    g.tokens = (list, o = {}) => {
      const [x0, y0] = o.at ?? [12, 12], maxW = o.width ?? g.w - 2 * x0, size = o.size ?? 13, padX = 6, gap = o.gap ?? 4;
      const font = o.font ?? "mono", chipH = size + 10, rowH = chipH + (o.values ? 18 : 0) + gap + 2;
      const CYCLE = ["blue", "green", "orange", "purple", "red", "brass"];
      const rects = [];
      let x = x0, y = y0;
      list.forEach((tok, i) => {
        const shown = o.showSpaces === false ? tok : String(tok).replace(/ /g, "·").replace(/\n/g, "↵");
        const w = Math.max(chipH * 0.8, g.measure(shown, { size, font }) + padX * 2);
        if (x + w > x0 + maxW && x > x0) { x = x0; y += rowH; }
        const c = Array.isArray(o.colors) ? o.colors[i] : o.colors === "cycle" || o.colors == null ? CYCLE[i % CYCLE.length] : o.colors;
        const on = o.highlight == null || o.highlight === i || (Array.isArray(o.highlight) && o.highlight.includes(i));
        tinted(s => g.rect(x, y, w, chipH, { ...s, r: 4 }), c, on ? (o.highlight === i ? 0.5 : 0.22) : 0.08);
        g.rect(x, y, w, chipH, { stroke: o.highlight === i ? "ink" : c, width: o.highlight === i ? 1.8 : 1, r: 4, alpha: on ? 1 : 0.5 });
        g.text(shown, [x + w / 2, y + chipH / 2 + 0.5], { size, font, color: on ? "ink" : "muted" });
        if (o.values) g.text((o.format ?? (v => fmt(v, { fixed: 2 })))(o.values[i]), [x + w / 2, y + chipH + 9], { size: 11, color: "muted" });
        rects.push({ i, x, y, w, h: chipH });
        x += w + gap;
      });
      const hit = p => { const r = rects.find(q => p[0] >= q.x && p[0] <= q.x + q.w && p[1] >= q.y && p[1] <= q.y + q.h); return r ? r.i : -1; };
      return { rects, hit, height: list.length ? y + rowH - y0 : 0 };
    };
  });

  window.Num = Num;
})();

;

/* Simulation kit for explainer figures. window.Sim holds small, real simulators a
   figure can run live: particles with springs and rods (ropes, cloth), rigid bodies
   that stack and collide, waves, heat, reaction-diffusion and advection on grids,
   N-body gravity, random walks and an Ising lattice, classic ODE systems, and a tiny
   neural network, language model, and attention head for AI pages.
   Every simulator's state is plain data (numbers, arrays, typed arrays, no functions),
   so it can live in a figure's `s` and the self-check can snapshot and restore it.
   Every simulator steps on a fixed clock with substeps, so the result is the same at
   30 or 144 frames a second, and every random number comes from a seed kept in that
   state. Reference: references/simulations.md in the skill. */
(() => {
  "use strict";
  const TAU = Math.PI * 2;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hypot = Math.hypot;

  // ---------- shared plumbing ----------
  // Seeded random numbers (mulberry32, the same stream as Num.rng(seed)). The state is
  // the integer o.rng on whatever object carries it, so a snapshot restores the stream.
  function random(o) {
    o.rng = ((o.rng ?? 1) + 0x6d2b79f5) >>> 0;
    let t = o.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const gauss = o => Math.sqrt(-2 * Math.log(1 - random(o))) * Math.cos(TAU * random(o));

  // Runs fn(h) for every whole step of size h in the time banked so far. Leftover time
  // waits for the next frame; at most maxSub steps run per call, so a stalled tab
  // doesn't make the simulation sprint to catch up.
  function fixed(w, dt, fn) {
    const h = w.h, maxSub = w.maxSub ?? 64;
    w.acc = Math.min((w.acc ?? 0) + Math.max(0, dt), h * maxSub);
    let n = 0;
    while (w.acc >= h * (1 - 1e-9)) {
      fn(h);
      w.acc -= h;
      w.t += h;
      n++;
    }
    return n;
  }

  // ---------- particles: ropes, cloth, springs, soft bodies ----------
  // Position-based dynamics: forces (gravity, drag, springs, the mouse) move the
  // particles, then rods, pins, walls and collisions are enforced by nudging positions,
  // and velocities come from how far each particle actually moved.
  const particles = {
    create(o = {}) {
      return {
        kind: "particles", t: 0, acc: 0, h: o.h ?? 1 / 240, maxSub: o.maxSub ?? 32, iterations: o.iterations ?? 8,
        gravity: o.gravity ?? [0, -9.81], drag: o.drag ?? 0, restitution: o.restitution ?? 0.3, friction: o.friction ?? 0.2,
        collide: o.collide ?? false, bounds: o.bounds ?? null,
        p: [], springs: [], rods: [], walls: [], mouse: null,
      };
    },
    // Adds a particle; returns its index. m: 0 (or pinned: true) makes it immovable.
    add(w, { x = 0, y = 0, vx = 0, vy = 0, m = 1, r = 0.05, pinned = false } = {}) {
      w.p.push({ x, y, vx, vy, px: x, py: y, im: pinned || m <= 0 ? 0 : 1 / m, r, pin: pinned ? [x, y] : null });
      w.a = null;
      return w.p.length - 1;
    },
    pin(w, i, at = null) { w.a = null; const p = w.p[i]; p.im = 0; p.pin = at ?? [p.x, p.y]; p.vx = p.vy = 0; if (at) { p.x = p.px = at[0]; p.y = p.py = at[1]; } },
    unpin(w, i, m = 1) { w.a = null; const p = w.p[i]; p.im = 1 / m; p.pin = null; },
    // Hooke spring with damping along its length. rest defaults to the current distance.
    spring(w, a, b, { k = 100, damping = 0.5, rest = null } = {}) {
      const A = w.p[a], B = w.p[b];
      w.springs.push({ a, b, k, c: damping, rest: rest ?? hypot(B.x - A.x, B.y - A.y) });
      w.a = null;
      return w.springs.length - 1;
    },
    // Rigid distance constraint (a rod or an inextensible string link). stiffness 0-1.
    rod(w, a, b, { rest = null, stiffness = 1, slack = false } = {}) {
      const A = w.p[a], B = w.p[b];
      w.rods.push({ a, b, rest: rest ?? hypot(B.x - A.x, B.y - A.y), s: stiffness, slack });
      return w.rods.length - 1;
    },
    // A static line segment particles bounce off.
    wall(w, a, b) { w.walls.push({ a: [...a], b: [...b] }); return w.walls.length - 1; },
    // A chain of n particles from a to b joined by rods (or springs with { spring: k }).
    rope(w, a, b, n, o = {}) {
      const ids = [];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        ids.push(particles.add(w, { x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t), m: (o.mass ?? 1) / n, r: o.r ?? 0.03, pinned: (i === 0 && o.pinStart !== false) || (i === n - 1 && o.pinEnd) }));
        if (i) o.spring ? particles.spring(w, ids[i - 1], ids[i], { k: o.spring, damping: o.damping ?? 0.2 }) : particles.rod(w, ids[i - 1], ids[i], { slack: o.slack });
      }
      return ids;
    },
    // A cloth grid of nx by ny particles, top-left corner at [x, y], size [width, height].
    // Structural and shear links: rods (stable at any stiffness; stiffness 0-1) unless
    // springs: k is given. pin: "top", "corners", or a list of [i, j] cells.
    cloth(w, { x = 0, y = 0, width = 1, height = 1, nx = 12, ny = 10, mass = 1, springs = null, damping = 1, stiffness = 1, shear = true, pin = "corners" } = {}) {
      const id = (i, j) => base + j * nx + i, base = w.p.length;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        particles.add(w, { x: x + (width * i) / (nx - 1), y: y - (height * j) / (ny - 1), m: mass / (nx * ny), r: 0.02 });
      }
      const link = (a, b, f) => (springs ? particles.spring(w, a, b, { k: springs * f, damping }) : particles.rod(w, a, b, { stiffness: stiffness * f }));
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (i < nx - 1) link(id(i, j), id(i + 1, j), 1);
        if (j < ny - 1) link(id(i, j), id(i, j + 1), 1);
        if (shear && i < nx - 1 && j < ny - 1) {
          link(id(i, j), id(i + 1, j + 1), 0.5);
          link(id(i + 1, j), id(i, j + 1), 0.5);
        }
      }
      const pins = pin === "top" ? Array.from({ length: nx }, (_, i) => id(i, 0)) : pin === "corners" ? [id(0, 0), id(nx - 1, 0)] : Array.isArray(pin) ? pin.map(([i, j]) => id(i, j)) : [];
      for (const i of pins) particles.pin(w, i);
      return { nx, ny, index: id, ids: Array.from({ length: nx * ny }, (_, k) => base + k) };
    },

    // Stiff springs get extra inner steps (ω·h kept under 0.5), so no setting can blow up.
    step(w, dt) {
      let wmax = 0;
      for (const sp of w.springs) wmax = Math.max(wmax, Math.sqrt(sp.k * (w.p[sp.a].im + w.p[sp.b].im)));
      return fixed(w, dt, h => {
        const n = Math.min(64, Math.max(1, Math.ceil((wmax * h) / 0.5)));
        for (let i = 0; i < n; i++) particleSubstep(w, h / n);
      });
    },

    // The nearest movable particle within radius of point q, or -1.
    nearest(w, q, radius = Infinity, { movable = true } = {}) {
      let best = -1, bd = radius;
      w.p.forEach((p, i) => { const d = hypot(p.x - q[0], p.y - q[1]); if (d < bd && (!movable || p.im > 0 || p.pin)) { bd = d; best = i; } });
      return best;
    },
    // Mouse dragging: grab(w, q) picks a particle, drag(w, q) moves the target, release(w) lets go.
    grab(w, q, radius = 0.2, { k = 400, damping = 20 } = {}) {
      const i = particles.nearest(w, q, radius);
      w.mouse = i < 0 ? null : { i, x: q[0], y: q[1], k, c: damping };
      w.a = null;
      return i;
    },
    drag(w, q) { if (w.mouse) { w.mouse.x = q[0]; w.mouse.y = q[1]; w.a = null; } },
    release(w) { w.mouse = null; w.a = null; },
    // Call after moving particles or changing springs by hand.
    touch(w) { w.a = null; },

    energy(w) {
      let kinetic = 0, potential = 0, elastic = 0;
      const [gx, gy] = w.gravity;
      for (const p of w.p) {
        if (!p.im) continue;
        const m = 1 / p.im;
        kinetic += 0.5 * m * (p.vx * p.vx + p.vy * p.vy);
        potential -= m * (gx * p.x + gy * p.y);
      }
      for (const s of w.springs) {
        const A = w.p[s.a], B = w.p[s.b], e = hypot(B.x - A.x, B.y - A.y) - s.rest;
        elastic += 0.5 * s.k * e * e;
      }
      return { kinetic, potential, elastic, total: kinetic + potential + elastic };
    },
    momentum(w) {
      let px = 0, py = 0;
      for (const p of w.p) if (p.im) { px += p.vx / p.im; py += p.vy / p.im; }
      return [px, py];
    },
    // Strain of each spring, (length - rest) / rest, for coloring.
    strain(w) { return w.springs.map(s => { const A = w.p[s.a], B = w.p[s.b]; return (hypot(B.x - A.x, B.y - A.y) - s.rest) / s.rest; }); },
  };

  // Accelerations from gravity, drag, springs, and the mouse at the current positions and velocities.
  function particleForces(w) {
    const P = w.p, [gx, gy] = w.gravity, ax = new Float64Array(P.length), ay = new Float64Array(P.length);
    for (const s of w.springs) {
      const A = P[s.a], B = P[s.b];
      let dx = B.x - A.x, dy = B.y - A.y;
      const L = hypot(dx, dy) || 1e-9;
      dx /= L; dy /= L;
      const rel = (B.vx - A.vx) * dx + (B.vy - A.vy) * dy;
      const f = s.k * (L - s.rest) + s.c * rel;
      ax[s.a] += f * dx * A.im; ay[s.a] += f * dy * A.im;
      ax[s.b] -= f * dx * B.im; ay[s.b] -= f * dy * B.im;
    }
    const M = w.mouse;
    if (M && P[M.i] && P[M.i].im) {
      const p = P[M.i];
      ax[M.i] += M.k * (M.x - p.x) - M.c * p.vx;
      ay[M.i] += M.k * (M.y - p.y) - M.c * p.vy;
    }
    P.forEach((p, i) => { if (p.im) { ax[i] += gx - w.drag * p.vx; ay[i] += gy - w.drag * p.vy; } });
    return [ax, ay];
  }

  // Velocity Verlet (half kick, drift, constraints, half kick): second order, so an
  // undamped spring's energy stays flat on a plot instead of creeping.
  function particleSubstep(w, h) {
    const P = w.p, M = w.mouse;
    if (!w.a || w.a[0].length !== P.length) w.a = particleForces(w);
    const [ax, ay] = w.a;
    P.forEach((p, i) => {
      p.px = p.x; p.py = p.y;
      if (!p.im) { if (M && M.i === i && p.pin) { p.x = M.x; p.y = M.y; p.pin = [M.x, M.y]; } p.vx = p.vy = 0; return; }
      p.vx += ax[i] * h / 2;
      p.vy += ay[i] * h / 2;
      p.x += p.vx * h;
      p.y += p.vy * h;
    });
    const contacts = [];
    for (let it = 0; it < w.iterations; it++) {
      for (const r of w.rods) {
        const A = P[r.a], B = P[r.b], wsum = A.im + B.im;
        if (!wsum) continue;
        let dx = B.x - A.x, dy = B.y - A.y;
        const L = hypot(dx, dy) || 1e-9, e = L - r.rest;
        if (r.slack && e < 0) continue;
        const k = (r.s * e) / (L * wsum);
        A.x += dx * k * A.im; A.y += dy * k * A.im;
        B.x -= dx * k * B.im; B.y -= dy * k * B.im;
      }
      for (const p of P) {
        if (!p.im) continue;
        for (const s of w.walls) {
          const n = segmentPush(p, s.a, s.b, p.r);
          if (n && it === w.iterations - 1) contacts.push([p, null, n]);
        }
        if (w.bounds) {
          const [x0, y0, x1, y1] = w.bounds;
          if (p.x < x0 + p.r) { p.x = x0 + p.r; if (it === w.iterations - 1) contacts.push([p, null, [1, 0]]); }
          if (p.x > x1 - p.r) { p.x = x1 - p.r; if (it === w.iterations - 1) contacts.push([p, null, [-1, 0]]); }
          if (p.y < y0 + p.r) { p.y = y0 + p.r; if (it === w.iterations - 1) contacts.push([p, null, [0, 1]]); }
          if (p.y > y1 - p.r) { p.y = y1 - p.r; if (it === w.iterations - 1) contacts.push([p, null, [0, -1]]); }
        }
      }
      if (w.collide) collideParticles(P, it === w.iterations - 1 ? contacts : null);
    }
    for (const p of P) {
      if (!p.im) continue;
      p.vx = (p.x - p.px) / h;
      p.vy = (p.y - p.py) / h;
    }
    w.a = particleForces(w);
    P.forEach((p, i) => { if (p.im) { p.vx += w.a[0][i] * h / 2; p.vy += w.a[1][i] * h / 2; } });
    // Bounce and rub: reflect the approaching part of the velocity at each contact.
    for (const [a, b, n] of contacts) {
      const rvx = a.vx - (b ? b.vx : 0), rvy = a.vy - (b ? b.vy : 0);
      const vn = rvx * n[0] + rvy * n[1];
      if (vn >= 0) continue;
      const tx = rvx - vn * n[0], ty = rvy - vn * n[1];
      const share = b ? a.im / (a.im + b.im) : 1;
      const jn = -(1 + w.restitution) * vn * share, ft = w.friction * share;
      a.vx += jn * n[0] - ft * tx; a.vy += jn * n[1] - ft * ty;
      if (b) { const sb = 1 - share; b.vx -= (-(1 + w.restitution) * vn * sb) * n[0] - w.friction * sb * tx; b.vy -= (-(1 + w.restitution) * vn * sb) * n[1] - w.friction * sb * ty; }
    }
  }

  // Pushes particle p out of segment ab (thickness r); returns the push direction or null.
  function segmentPush(p, a, b, r) {
    const ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1e-12;
    const t = clamp(((p.x - a[0]) * ex + (p.y - a[1]) * ey) / L2, 0, 1);
    const cx = a[0] + ex * t, cy = a[1] + ey * t;
    let dx = p.x - cx, dy = p.y - cy;
    const d = hypot(dx, dy);
    if (d >= r) return null;
    if (d < 1e-12) { dx = -ey; dy = ex; } // on the line: push to the left side
    const L = hypot(dx, dy) || 1;
    p.x = cx + (dx / L) * r;
    p.y = cy + (dy / L) * r;
    return [dx / L, dy / L];
  }

  function collideParticles(P, contacts) {
    // Spatial hash on the largest radius, so a few thousand particles stay cheap.
    let rmax = 0;
    for (const p of P) rmax = Math.max(rmax, p.r);
    if (rmax <= 0) return;
    const cell = 2 * rmax, grid = new Map();
    P.forEach((p, i) => {
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(i);
    });
    P.forEach((a, i) => {
      const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        for (const j of grid.get(`${cx + ox},${cy + oy}`) ?? []) {
          if (j <= i) continue;
          const b = P[j], wsum = a.im + b.im;
          if (!wsum) continue;
          let dx = b.x - a.x, dy = b.y - a.y;
          const d = hypot(dx, dy), min = a.r + b.r;
          if (d >= min || d < 1e-12) continue;
          dx /= d; dy /= d;
          const push = (min - d) / wsum;
          a.x -= dx * push * a.im; a.y -= dy * push * a.im;
          b.x += dx * push * b.im; b.y += dy * push * b.im;
          if (contacts) contacts.push([a, b, [-dx, -dy]]);
        }
      }
    });
  }

  // ---------- rigid bodies: boxes, circles, polygons that collide and stack ----------
  // Sequential impulses with warm starting (the approach of Box2D Lite): each contact
  // remembers the impulse it needed last step, which is what lets a tower of boxes
  // stand still instead of jittering.
  const rigid = {
    create(o = {}) {
      return {
        kind: "rigid", t: 0, acc: 0, h: o.h ?? 1 / 120, maxSub: o.maxSub ?? 16, iterations: o.iterations ?? 12,
        gravity: o.gravity ?? [0, -9.81], friction: o.friction ?? 0.5, restitution: o.restitution ?? 0.1,
        bodies: [], cache: {}, mouse: null, contacts: [],
      };
    },
    // shape: { type: "box", w, h } | { type: "circle", r } | { type: "poly", points: [[x, y], ...] }
    add(w, shape, { x = 0, y = 0, angle = 0, vx = 0, vy = 0, omega = 0, density = 1, mass = null, static: isStatic = false, friction = null, restitution = null, color = null, name = null } = {}) {
      let verts = null, r = 0;
      if (shape.type === "box") verts = [[-shape.w / 2, -shape.h / 2], [shape.w / 2, -shape.h / 2], [shape.w / 2, shape.h / 2], [-shape.w / 2, shape.h / 2]];
      else if (shape.type === "poly") verts = ccw(shape.points);
      else r = shape.r;
      let area, I, cx = 0, cy = 0;
      if (verts) {
        ({ area, I, cx, cy } = polyMass(verts));
        verts = verts.map(([px, py]) => [px - cx, py - cy]);
      } else {
        area = Math.PI * r * r;
        I = 0.5 * area * r * r;
      }
      const m = mass ?? density * area;
      const inertia = I * (m / area);
      const b = {
        x: x + cx, y: y + cy, a: angle, vx, vy, w: omega,
        im: isStatic ? 0 : 1 / m, iI: isStatic ? 0 : 1 / inertia, m: isStatic ? 0 : m, I: isStatic ? 0 : inertia,
        type: verts ? "poly" : "circle", verts, r: verts ? Math.max(...verts.map(v => hypot(v[0], v[1]))) : r,
        mu: friction ?? w.friction, e: restitution ?? w.restitution, color, name, static: isStatic,
      };
      w.bodies.push(b);
      return w.bodies.length - 1;
    },
    box(w, x, y, bw, bh, o = {}) { return rigid.add(w, { type: "box", w: bw, h: bh }, { x, y, ...o }); },
    circle(w, x, y, r, o = {}) { return rigid.add(w, { type: "circle", r }, { x, y, ...o }); },
    poly(w, points, o = {}) { return rigid.add(w, { type: "poly", points }, o); },
    // A static floor (a wide flat box with its top at y).
    ground(w, y = 0, { x0 = -50, x1 = 50, thickness = 1 } = {}) { return rigid.box(w, (x0 + x1) / 2, y - thickness / 2, x1 - x0, thickness, { static: true }); },

    step(w, dt) { return fixed(w, dt, h => rigidSubstep(w, h)); },

    // World-space corners of a polygon body.
    vertices(b) {
      const c = Math.cos(b.a), s = Math.sin(b.a);
      return b.verts ? b.verts.map(([px, py]) => [b.x + c * px - s * py, b.y + s * px + c * py]) : null;
    },
    // Index of the body under point q, or -1.
    hit(w, q) {
      for (let i = w.bodies.length - 1; i >= 0; i--) {
        const b = w.bodies[i];
        if (b.type === "circle" ? hypot(q[0] - b.x, q[1] - b.y) <= b.r : pointInPoly(q, rigid.vertices(b))) return i;
      }
      return -1;
    },
    // Mouse spring on a point of a body; k and damping are per unit mass, so heavy and light bodies feel alike.
    grab(w, q, { k = 120, damping = 18, statics = false } = {}) {
      const i = rigid.hit(w, q);
      if (i < 0 || (!statics && w.bodies[i].static)) { w.mouse = null; return -1; }
      const b = w.bodies[i], c = Math.cos(-b.a), s = Math.sin(-b.a), dx = q[0] - b.x, dy = q[1] - b.y;
      w.mouse = { i, lx: c * dx - s * dy, ly: s * dx + c * dy, x: q[0], y: q[1], k, c: damping };
      return i;
    },
    drag(w, q) { if (w.mouse) { w.mouse.x = q[0]; w.mouse.y = q[1]; } },
    release(w) { w.mouse = null; },
    // Where the mouse spring is attached, in world coordinates (for drawing the line).
    anchor(w) {
      const M = w.mouse;
      if (!M) return null;
      const b = w.bodies[M.i], c = Math.cos(b.a), s = Math.sin(b.a);
      return [b.x + c * M.lx - s * M.ly, b.y + s * M.lx + c * M.ly];
    },
    energy(w) {
      let kinetic = 0, potential = 0;
      for (const b of w.bodies) {
        if (!b.im) continue;
        kinetic += 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy) + 0.5 * b.I * b.w * b.w;
        potential -= b.m * (w.gravity[0] * b.x + w.gravity[1] * b.y);
      }
      return { kinetic, potential, total: kinetic + potential };
    },
    momentum(w) {
      let px = 0, py = 0, L = 0;
      for (const b of w.bodies) if (b.im) { px += b.m * b.vx; py += b.m * b.vy; L += b.I * b.w + b.m * (b.x * b.vy - b.y * b.vx); }
      return { linear: [px, py], angular: L };
    },
  };

  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  function ccw(points) {
    let s = 0;
    for (let i = 0; i < points.length; i++) { const p = points[i], q = points[(i + 1) % points.length]; s += cross(p[0], p[1], q[0], q[1]); }
    return s < 0 ? points.slice().reverse() : points.slice();
  }
  function polyMass(v) {
    let area = 0, cx = 0, cy = 0, I = 0;
    for (let i = 0; i < v.length; i++) {
      const [x0, y0] = v[i], [x1, y1] = v[(i + 1) % v.length], c = cross(x0, y0, x1, y1);
      area += c / 2;
      cx += ((x0 + x1) * c) / 6;
      cy += ((y0 + y1) * c) / 6;
      I += (c * (x0 * x0 + x0 * x1 + x1 * x1 + y0 * y0 + y0 * y1 + y1 * y1)) / 12;
    }
    cx /= area; cy /= area;
    I -= area * (cx * cx + cy * cy); // move the inertia to the centroid
    return { area, I, cx, cy };
  }
  function pointInPoly(q, V) {
    for (let i = 0; i < V.length; i++) {
      const a = V[i], b = V[(i + 1) % V.length];
      if (cross(b[0] - a[0], b[1] - a[1], q[0] - a[0], q[1] - a[1]) < 0) return false;
    }
    return true;
  }

  // Contacts between bodies A and B: [{ n (from A to B), p, sep, id }]. Points a hair
  // apart (up to `margin`) count too: resting faces sit at a separation of about zero,
  // and dropping a corner whenever rounding makes it positive is what rocks a stack.
  function collide(A, B, margin = 0.02 * Math.min(A.r, B.r)) {
    if (A.type === "circle" && B.type === "circle") {
      const dx = B.x - A.x, dy = B.y - A.y, d = hypot(dx, dy);
      if (d > A.r + B.r + margin) return [];
      const n = d > 1e-9 ? [dx / d, dy / d] : [0, 1];
      return [{ n, p: [A.x + n[0] * A.r, A.y + n[1] * A.r], sep: d - A.r - B.r, id: 0 }];
    }
    if (A.type === "circle") return collide(B, A, margin).map(c => ({ ...c, n: [-c.n[0], -c.n[1]] }));
    const VA = rigid.vertices(A);
    if (B.type === "circle") {
      // Face of A the circle is most outside of.
      let best = -Infinity, bi = 0;
      for (let i = 0; i < VA.length; i++) {
        const a = VA[i], b = VA[(i + 1) % VA.length], ex = b[0] - a[0], ey = b[1] - a[1], L = hypot(ex, ey);
        const s = cross(ex, ey, B.x - a[0], B.y - a[1]) / -L; // distance outside along the outward normal
        if (s > best) { best = s; bi = i; }
      }
      if (best > B.r + margin) return [];
      const a = VA[bi], b = VA[(bi + 1) % VA.length], ex = b[0] - a[0], ey = b[1] - a[1], L = hypot(ex, ey);
      const t = ((B.x - a[0]) * ex + (B.y - a[1]) * ey) / (L * L);
      let n, cpt;
      if (best > 0 && (t < 0 || t > 1)) {
        cpt = t < 0 ? a : b;
        const dx = B.x - cpt[0], dy = B.y - cpt[1], d = hypot(dx, dy);
        if (d > B.r + margin) return [];
        n = [dx / d, dy / d];
        return [{ n, p: cpt, sep: d - B.r, id: bi * 4 + (t < 0 ? 1 : 2) }];
      }
      n = [ey / L, -ex / L];
      cpt = [B.x - n[0] * B.r, B.y - n[1] * B.r];
      return [{ n, p: cpt, sep: best - B.r, id: bi * 4 }];
    }
    const VB = rigid.vertices(B);
    const [sa, ea] = maxSeparation(VA, VB), [sb, eb] = maxSeparation(VB, VA);
    if (sa > margin || sb > margin) return [];
    // The reference face is on whichever body separates more (A, unless B is clearly better).
    const flip = sb > sa + 0.002 * Math.max(A.r, B.r);
    const R = flip ? VB : VA, I = flip ? VA : VB, ri = flip ? eb : ea;
    const r1 = R[ri], r2 = R[(ri + 1) % R.length], ex = r2[0] - r1[0], ey = r2[1] - r1[1], L = hypot(ex, ey);
    const tx = ex / L, ty = ey / L, nx = ty, ny = -tx; // outward normal of a CCW polygon
    // Incident edge: the one on the other body most opposed to the reference normal.
    let ii = 0, mind = Infinity;
    for (let i = 0; i < I.length; i++) {
      const a = I[i], b = I[(i + 1) % I.length], fx = b[0] - a[0], fy = b[1] - a[1], fl = hypot(fx, fy);
      const d = (fy / fl) * nx + (-fx / fl) * ny;
      if (d < mind) { mind = d; ii = i; }
    }
    let pts = [[...I[ii], 0], [...I[(ii + 1) % I.length], 1]];
    // Clip the incident edge to the sides of the reference face.
    pts = clipSeg(pts, -tx, -ty, -(tx * r1[0] + ty * r1[1]));
    if (pts.length < 2) return [];
    pts = clipSeg(pts, tx, ty, tx * r2[0] + ty * r2[1]);
    if (pts.length < 2) return [];
    const front = nx * r1[0] + ny * r1[1], out = [];
    for (const [px, py, k] of pts) {
      const sep = nx * px + ny * py - front;
      if (sep > margin) continue;
      out.push({ n: flip ? [-nx, -ny] : [nx, ny], p: [px - nx * sep * 0.5, py - ny * sep * 0.5], sep, id: (flip ? 1000 : 0) + ri * 50 + ii * 4 + k });
    }
    return out;
  }
  function maxSeparation(V1, V2) {
    let best = -Infinity, bi = 0;
    for (let i = 0; i < V1.length; i++) {
      const a = V1[i], b = V1[(i + 1) % V1.length], ex = b[0] - a[0], ey = b[1] - a[1], L = hypot(ex, ey);
      const nx = ey / L, ny = -ex / L;
      let mn = Infinity;
      for (const v of V2) mn = Math.min(mn, nx * (v[0] - a[0]) + ny * (v[1] - a[1]));
      if (mn > best) { best = mn; bi = i; }
    }
    return [best, bi];
  }
  function clipSeg(pts, nx, ny, off) {
    const out = [], d0 = nx * pts[0][0] + ny * pts[0][1] - off, d1 = nx * pts[1][0] + ny * pts[1][1] - off;
    if (d0 <= 0) out.push(pts[0]);
    if (d1 <= 0) out.push(pts[1]);
    if (d0 * d1 < 0) {
      const t = d0 / (d0 - d1);
      out.push([lerp(pts[0][0], pts[1][0], t), lerp(pts[0][1], pts[1][1], t), d0 > 0 ? pts[0][2] : pts[1][2]]);
    }
    return out;
  }

  function rigidSubstep(w, h) {
    const B = w.bodies, [gx, gy] = w.gravity;
    for (const b of B) {
      if (!b.im) continue;
      b.vx += gx * h;
      b.vy += gy * h;
    }
    const M = w.mouse;
    if (M && B[M.i]) {
      const b = B[M.i], c = Math.cos(b.a), s = Math.sin(b.a);
      const rx = c * M.lx - s * M.ly, ry = s * M.lx + c * M.ly;
      const vpx = b.vx - b.w * ry, vpy = b.vy + b.w * rx;
      const fx = b.m * (M.k * (M.x - (b.x + rx)) - M.c * vpx), fy = b.m * (M.k * (M.y - (b.y + ry)) - M.c * vpy);
      b.vx += fx * b.im * h; b.vy += fy * b.im * h; b.w += cross(rx, ry, fx, fy) * b.iI * h;
    }
    // Narrow phase on every pair whose bounding circles touch (fine for a few hundred bodies).
    const contacts = [], cache = {};
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const A = B[i], C = B[j];
      if (!A.im && !C.im) continue;
      if (hypot(C.x - A.x, C.y - A.y) > (A.r + C.r) * 1.02) continue;
      for (const k of collide(A, C)) {
        const key = `${i}:${j}:${k.id}`, old = w.cache[key];
        const c = { i, j, key, n: k.n, p: k.p, sep: k.sep, Pn: old ? old.Pn : 0, Pt: old ? old.Pt : 0, mu: Math.sqrt(A.mu * C.mu), e: Math.max(A.e, C.e) };
        contacts.push(c);
      }
    }
    // Pre-step: effective masses, position bias, restitution, warm start.
    for (const c of contacts) {
      const A = B[c.i], C = B[c.j], n = c.n, t = [n[1], -n[0]];
      c.ra = [c.p[0] - A.x, c.p[1] - A.y];
      c.rb = [c.p[0] - C.x, c.p[1] - C.y];
      const rna = cross(c.ra[0], c.ra[1], n[0], n[1]), rnb = cross(c.rb[0], c.rb[1], n[0], n[1]);
      const rta = cross(c.ra[0], c.ra[1], t[0], t[1]), rtb = cross(c.rb[0], c.rb[1], t[0], t[1]);
      c.mn = 1 / (A.im + C.im + A.iI * rna * rna + C.iI * rnb * rnb);
      c.mt = 1 / (A.im + C.im + A.iI * rta * rta + C.iI * rtb * rtb);
      c.t = t;
      // Bounce needs the approach speed before any impulse of this step is applied.
      const dv = relVel(A, C, c), vn = dv[0] * n[0] + dv[1] * n[1];
      const slop = 0.005 * Math.min(A.r, C.r);
      c.bias = c.sep > 0 ? -c.sep / h : -0.2 / h * Math.min(0, c.sep + slop) + (vn < -1 ? -c.e * vn : 0);
    }
    for (const c of contacts) {
      const n = c.n, t = c.t;
      applyImpulse(B[c.i], B[c.j], c, n[0] * c.Pn + t[0] * c.Pt, n[1] * c.Pn + t[1] * c.Pt);
    }
    for (let it = 0; it < w.iterations; it++) {
      for (const c of contacts) {
        const A = B[c.i], C = B[c.j], n = c.n, t = c.t;
        let dv = relVel(A, C, c);
        const dPn = c.mn * (-(dv[0] * n[0] + dv[1] * n[1]) + c.bias);
        const Pn0 = c.Pn;
        c.Pn = Math.max(Pn0 + dPn, 0);
        const pn = c.Pn - Pn0;
        applyImpulse(A, C, c, n[0] * pn, n[1] * pn);
        dv = relVel(A, C, c);
        const dPt = c.mt * -(dv[0] * t[0] + dv[1] * t[1]);
        const Pt0 = c.Pt, maxPt = c.mu * c.Pn;
        c.Pt = clamp(Pt0 + dPt, -maxPt, maxPt);
        const pt = c.Pt - Pt0;
        applyImpulse(A, C, c, t[0] * pt, t[1] * pt);
      }
    }
    for (const c of contacts) cache[c.key] = { Pn: c.Pn, Pt: c.Pt };
    w.cache = cache;
    w.contacts = contacts.map(c => ({ p: c.p, n: c.n, Pn: c.Pn }));
    for (const b of B) {
      if (!b.im) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.a += b.w * h;
    }
  }
  function relVel(A, C, c) {
    return [C.vx - C.w * c.rb[1] - (A.vx - A.w * c.ra[1]), C.vy + C.w * c.rb[0] - (A.vy + A.w * c.ra[0])];
  }
  function applyImpulse(A, C, c, px, py) {
    A.vx -= px * A.im; A.vy -= py * A.im; A.w -= cross(c.ra[0], c.ra[1], px, py) * A.iI;
    C.vx += px * C.im; C.vy += py * C.im; C.w += cross(c.rb[0], c.rb[1], px, py) * C.iI;
  }

  // ---------- fields on grids: waves, heat, reaction-diffusion, advection ----------
  // A grid is { nx, ny, u: Float64Array(nx * ny), ... }; cell (i, j) is u[j * nx + i].
  // ny = 1 makes a 1D grid. dx is the cell size in world units.
  const at = (G, i, j) => G.u[j * G.nx + i];

  const wave = {
    // c: wave speed, dx: cell size, damping: per second, boundary: "fixed" | "free" | "absorbing".
    create({ nx = 200, ny = 1, c = 1, dx = 0.01, damping = 0, boundary = "fixed", cfl = null } = {}) {
      const dims = ny > 1 ? 2 : 1;
      const k = cfl ?? (dims === 1 ? 1 : 0.7);
      const h = (k * dx) / (c * Math.sqrt(dims));
      return {
        kind: "wave", t: 0, acc: 0, h, maxSub: 400, nx, ny, c, dx, damping, boundary,
        u: new Float64Array(nx * ny), up: new Float64Array(nx * ny), wall: new Uint8Array(nx * ny), sources: [],
      };
    },
    // A point that oscillates: amp * sin(2π f t + phase), at cell (i, j).
    source(G, i, j = 0, { amp = 1, freq = 1, phase = 0, soft = false } = {}) { G.sources.push({ i, j, amp, freq, phase, soft }); return G.sources.length - 1; },
    // Cells that hold still (slits, reflectors). mask(i, j) -> true for wall.
    walls(G, mask) { for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) G.wall[j * G.nx + i] = mask(i, j) ? 1 : 0; },
    // A smooth bump of height amp centered at (x0, y0) cells with width sigma cells, at rest.
    pulse(G, x0, y0 = 0, { amp = 1, sigma = 5, moving = 0 } = {}) {
      for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
        const r2 = (i - x0) ** 2 + (G.ny > 1 ? (j - y0) ** 2 : 0);
        const v = amp * Math.exp(-r2 / (2 * sigma * sigma));
        G.u[j * G.nx + i] += v;
        // moving: +1 or -1 sends a 1D pulse one way instead of splitting in two.
        const ib = i + moving * (G.c * G.h) / G.dx, r2b = (ib - x0) ** 2 + (G.ny > 1 ? (j - y0) ** 2 : 0);
        G.up[j * G.nx + i] += moving ? amp * Math.exp(-r2b / (2 * sigma * sigma)) : v;
      }
    },
    step(G, dt) { return fixed(G, dt, h => waveSubstep(G, h)); },
    // The energy the leapfrog scheme conserves exactly (no damping, fixed edges): kinetic
    // from the last time difference, strain as the product of this step's and last step's slopes.
    energy(G) {
      let e = 0;
      const { nx, ny, u, up, h, c, dx } = G;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i, vt = (u[k] - up[k]) / h;
        e += 0.5 * vt * vt;
        if (i < nx - 1) e += 0.5 * c * c * ((u[k + 1] - u[k]) * (up[k + 1] - up[k])) / (dx * dx);
        if (ny > 1 && j < ny - 1) e += 0.5 * c * c * ((u[k + nx] - u[k]) * (up[k + nx] - up[k])) / (dx * dx);
      }
      return e * dx ** (ny > 1 ? 2 : 1);
    },
  };
  function waveSubstep(G, h) {
    const { nx, ny, u, up, wall, c, dx } = G, r2 = (c * h / dx) ** 2, g = G.damping * h;
    const next = new Float64Array(nx * ny);
    const two = ny > 1;
    for (let j = two ? 1 : 0; j < (two ? ny - 1 : 1); j++) for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      if (wall[k]) continue;
      const lap = u[k - 1] + u[k + 1] - 2 * u[k] + (two ? u[k - nx] + u[k + nx] - 2 * u[k] : 0);
      next[k] = (2 * u[k] - (1 - g) * up[k] + r2 * lap) / (1 + g);
    }
    // Edges: fixed stays 0, free copies its neighbor, absorbing lets waves leave (Mur).
    const mur = (c * h - dx) / (c * h + dx);
    const edge = (k, inner) => {
      if (G.boundary === "free") next[k] = next[inner];
      else if (G.boundary === "absorbing") next[k] = u[inner] + mur * (next[inner] - u[k]);
    };
    if (two) {
      for (let i = 0; i < nx; i++) { edge(i, i + nx); edge((ny - 1) * nx + i, (ny - 2) * nx + i); }
      for (let j = 0; j < ny; j++) { edge(j * nx, j * nx + 1); edge(j * nx + nx - 1, j * nx + nx - 2); }
    } else { edge(0, 1); edge(nx - 1, nx - 2); }
    const t = G.t + h;
    for (const s of G.sources) {
      const k = s.j * nx + s.i, v = s.amp * Math.sin(TAU * s.freq * t + s.phase);
      if (s.soft) next[k] += v * r2; else next[k] = v;
    }
    G.up = u;
    G.u = next;
  }

  const heat = {
    // D: diffusivity; boundary "insulated" (no flux, total heat conserved) or "fixed" (edges held at `edge`).
    create({ nx = 100, ny = 1, D = 1, dx = 0.01, boundary = "insulated", edge = 0 } = {}) {
      const dims = ny > 1 ? 2 : 1;
      return { kind: "heat", t: 0, acc: 0, h: (0.9 * dx * dx) / (2 * dims * D), maxSub: 2000, nx, ny, D, dx, boundary, edge, u: new Float64Array(nx * ny), fixedMask: new Uint8Array(nx * ny) };
    },
    // Cells held at their current value (a hot plate, an ice cube).
    hold(G, mask) { for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) G.fixedMask[j * G.nx + i] = mask(i, j) ? 1 : 0; },
    step(G, dt) { return fixed(G, dt, h => heatSubstep(G, h)); },
    total(G) { let s = 0; for (const v of G.u) s += v; return s * G.dx ** (G.ny > 1 ? 2 : 1); },
  };
  function heatSubstep(G, h) {
    const { nx, ny, u } = G, k = (G.D * h) / (G.dx * G.dx), next = new Float64Array(u.length), two = ny > 1;
    const get = (i, j) => {
      if (G.boundary === "insulated") { i = clamp(i, 0, nx - 1); j = clamp(j, 0, ny - 1); return u[j * nx + i]; }
      return i < 0 || i >= nx || j < 0 || j >= ny ? G.edge : u[j * nx + i];
    };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (G.fixedMask[c]) { next[c] = u[c]; continue; }
      const lap = get(i - 1, j) + get(i + 1, j) - 2 * u[c] + (two ? get(i, j - 1) + get(i, j + 1) - 2 * u[c] : 0);
      next[c] = u[c] + k * lap;
    }
    G.u = next;
  }

  // Gray-Scott reaction-diffusion (two chemicals, u feeds v): F feed rate, k kill rate.
  const GRAY_SCOTT = {
    coral: { F: 0.0545, k: 0.062 }, mitosis: { F: 0.0367, k: 0.0649 }, spots: { F: 0.03, k: 0.062 },
    maze: { F: 0.029, k: 0.057 }, worms: { F: 0.078, k: 0.061 }, waves: { F: 0.014, k: 0.045 },
  };
  const grayScott = {
    presets: GRAY_SCOTT,
    create({ nx = 128, ny = 128, preset = "coral", F = null, k = null, Du = 1, Dv = 0.5, seed = 1, rate = 600 } = {}) {
      const p = GRAY_SCOTT[preset] ?? GRAY_SCOTT.coral;
      const G = { kind: "grayScott", t: 0, acc: 0, h: 1 / rate, maxSub: 40, nx, ny, F: F ?? p.F, k: k ?? p.k, Du, Dv, rng: seed, u: new Float64Array(nx * ny).fill(1), v: new Float64Array(nx * ny) };
      grayScott.seed(G, nx / 2, ny / 2, Math.max(3, nx / 12));
      for (let n = 0; n < 6; n++) grayScott.seed(G, random(G) * nx, random(G) * ny, 2 + random(G) * 3);
      return G;
    },
    // Drops some v in a square of half-size r at (x, y): where patterns start.
    seed(G, x, y, r = 4) {
      for (let j = Math.floor(y - r); j <= y + r; j++) for (let i = Math.floor(x - r); i <= x + r; i++) {
        const ii = ((i % G.nx) + G.nx) % G.nx, jj = ((j % G.ny) + G.ny) % G.ny;
        G.u[jj * G.nx + ii] = 0.5;
        G.v[jj * G.nx + ii] = 0.25;
      }
    },
    // One unit of model time per substep (the scheme's natural step); `rate` substeps per second.
    step(G, dt) { return fixed(G, dt, () => gsSubstep(G)); },
  };
  function gsSubstep(G) {
    const { nx, ny, u, v, F, k, Du, Dv } = G, nu = new Float64Array(u.length), nv = new Float64Array(v.length);
    for (let j = 0; j < ny; j++) {
      const jm = ((j - 1 + ny) % ny) * nx, j0 = j * nx, jp = ((j + 1) % ny) * nx;
      for (let i = 0; i < nx; i++) {
        const im = (i - 1 + nx) % nx, ip = (i + 1) % nx, c = j0 + i;
        // 3x3 Laplacian: 0.2 to the sides, 0.05 to the corners, -1 at the center.
        const lu = 0.2 * (u[j0 + im] + u[j0 + ip] + u[jm + i] + u[jp + i]) + 0.05 * (u[jm + im] + u[jm + ip] + u[jp + im] + u[jp + ip]) - u[c];
        const lv = 0.2 * (v[j0 + im] + v[j0 + ip] + v[jm + i] + v[jp + i]) + 0.05 * (v[jm + im] + v[jm + ip] + v[jp + im] + v[jp + ip]) - v[c];
        const uvv = u[c] * v[c] * v[c];
        nu[c] = u[c] + Du * lu - uvv + F * (1 - u[c]);
        nv[c] = v[c] + Dv * lv + uvv - (F + k) * v[c];
      }
    }
    G.u = nu;
    G.v = nv;
  }

  // Semi-Lagrangian advection of a scalar grid by a velocity field vel(x, y) -> [vx, vy] in cells per second.
  // Unconditionally stable; a little blurry, as real numerical advection is.
  function advect(G, vel, dt, { wrap = false } = {}) {
    const { nx, ny, u } = G, out = new Float64Array(u.length);
    const sample = (x, y) => {
      if (wrap) { x = ((x % nx) + nx) % nx; y = ((y % ny) + ny) % ny; } else { x = clamp(x, 0, nx - 1); y = clamp(y, 0, ny - 1); }
      const i0 = Math.floor(x), j0 = Math.floor(y), i1 = wrap ? (i0 + 1) % nx : Math.min(i0 + 1, nx - 1), j1 = wrap ? (j0 + 1) % ny : Math.min(j0 + 1, ny - 1);
      const fx = x - i0, fy = y - j0;
      return lerp(lerp(u[j0 * nx + i0], u[j0 * nx + i1], fx), lerp(u[j1 * nx + i0], u[j1 * nx + i1], fx), fy);
    };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const [vx, vy] = vel(i, j);
      out[j * nx + i] = sample(i - vx * dt, j - vy * dt);
    }
    G.u = out;
    return G;
  }

  // ---------- N-body gravity ----------
  // Leapfrog (kick-drift-kick) conserves energy over long runs, so orbits close.
  const NBODY_PRESETS = {
    // Chenciner and Montgomery's figure eight: three equal masses chasing on one curve (G = 1).
    figure8: () => {
      const v = [-0.93240737, -0.86473146];
      return [
        { m: 1, x: -0.97000436, y: 0.24308753, vx: -v[0] / 2, vy: -v[1] / 2 },
        { m: 1, x: 0.97000436, y: -0.24308753, vx: -v[0] / 2, vy: -v[1] / 2 },
        { m: 1, x: 0, y: 0, vx: v[0], vy: v[1] },
      ];
    },
    binary: () => [{ m: 1, x: -0.5, y: 0, vx: 0, vy: -0.5 }, { m: 1, x: 0.5, y: 0, vx: 0, vy: 0.5 }],
    // A heavy sun and planets on circular orbits at radii 1, 1.6, 2.5 (G = 1, sun mass 1).
    solar: () => [{ m: 1, x: 0, y: 0, vx: 0, vy: 0 }, ...[1, 1.6, 2.5].map((r, i) => ({ m: 1e-4, x: r * Math.cos(i * 2), y: r * Math.sin(i * 2), vx: -Math.sin(i * 2) / Math.sqrt(r), vy: Math.cos(i * 2) / Math.sqrt(r) }))],
  };
  const nbody = {
    presets: NBODY_PRESETS,
    create({ bodies = "figure8", G = 1, soft = 1e-3, h = 1 / 1000, trail = 400, trailEvery = 4 } = {}) {
      const list = typeof bodies === "string" ? NBODY_PRESETS[bodies]() : bodies.map(b => ({ vx: 0, vy: 0, ...b }));
      const w = { kind: "nbody", t: 0, acc: 0, h, maxSub: 2000, G, soft, b: list.map(b => ({ ...b, ax: 0, ay: 0 })), trail, trailEvery, trails: list.map(b => [[b.x, b.y]]), n: 0 };
      accel(w);
      return w;
    },
    step(w, dt) {
      return fixed(w, dt, h => {
        for (const b of w.b) { b.vx += b.ax * h / 2; b.vy += b.ay * h / 2; b.x += b.vx * h; b.y += b.vy * h; }
        accel(w);
        for (const b of w.b) { b.vx += b.ax * h / 2; b.vy += b.ay * h / 2; }
        if (++w.n % w.trailEvery === 0) w.b.forEach((b, i) => { const t = w.trails[i]; t.push([b.x, b.y]); if (t.length > w.trail) t.shift(); });
      });
    },
    energy(w) {
      let K = 0, U = 0;
      w.b.forEach((a, i) => {
        K += 0.5 * a.m * (a.vx * a.vx + a.vy * a.vy);
        for (let j = i + 1; j < w.b.length; j++) { const b = w.b[j]; U -= (w.G * a.m * b.m) / Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + w.soft * w.soft); }
      });
      return { kinetic: K, potential: U, total: K + U };
    },
    momentum(w) { let px = 0, py = 0; for (const b of w.b) { px += b.m * b.vx; py += b.m * b.vy; } return [px, py]; },
    center(w) { let m = 0, x = 0, y = 0; for (const b of w.b) { m += b.m; x += b.m * b.x; y += b.m * b.y; } return [x / m, y / m]; },
  };
  function accel(w) {
    const B = w.b, e2 = w.soft * w.soft;
    for (const b of B) b.ax = b.ay = 0;
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j], dx = b.x - a.x, dy = b.y - a.y, r2 = dx * dx + dy * dy + e2, inv = w.G / (r2 * Math.sqrt(r2));
      a.ax += dx * inv * b.m; a.ay += dy * inv * b.m;
      b.ax -= dx * inv * a.m; b.ay -= dy * inv * a.m;
    }
  }

  // ---------- randomness: walkers, Monte Carlo, Ising ----------
  const walkers = {
    // n walkers starting at the origin, each step a Gaussian kick with diffusion constant D.
    create({ n = 200, D = 1, dims = 2, seed = 1, h = 1 / 60 } = {}) {
      return { kind: "walkers", t: 0, acc: 0, h, maxSub: 60, n, D, dims, rng: seed, x: new Float64Array(n), y: new Float64Array(n) };
    },
    step(w, dt) {
      return fixed(w, dt, h => {
        const s = Math.sqrt(2 * w.D * h);
        for (let i = 0; i < w.n; i++) { w.x[i] += s * gauss(w); if (w.dims > 1) w.y[i] += s * gauss(w); }
      });
    },
    // Mean squared displacement; theory says 2 · dims · D · t.
    msd(w) { let s = 0; for (let i = 0; i < w.n; i++) s += w.x[i] ** 2 + w.y[i] ** 2; return s / w.n; },
  };

  const mc = {
    // Throws n darts at the unit square; the share inside the quarter circle estimates π / 4.
    pi(state, n = 100) {
      state.inside ??= 0; state.total ??= 0; state.points ??= [];
      for (let i = 0; i < n; i++) {
        const x = random(state), y = random(state), hit = x * x + y * y <= 1;
        state.inside += hit; state.total++;
        state.points.push([x, y, hit ? 1 : 0]);
        if (state.points.length > 4000) state.points.shift();
      }
      return (4 * state.inside) / state.total;
    },
    random, gauss,
  };

  const ising = {
    // n by n spins (+1 / -1) at temperature T (in units of J / k), field h. init "random" | "up".
    create({ n = 64, T = 2.27, J = 1, field = 0, seed = 1, init = "random", rate = 30 } = {}) {
      const w = { kind: "ising", t: 0, acc: 0, h: 1 / rate, maxSub: 30, n, T, J, field, rng: seed, s: new Int8Array(n * n) };
      for (let k = 0; k < n * n; k++) w.s[k] = init === "up" ? 1 : random(w) < 0.5 ? -1 : 1;
      return w;
    },
    // One Metropolis sweep per substep: every spin is offered a flip once.
    step(w, dt) { return fixed(w, dt, () => ising.sweep(w)); },
    sweep(w) {
      const { n, s } = w;
      for (let parity = 0; parity < 2; parity++) for (let j = 0; j < n; j++) for (let i = (j + parity) % 2; i < n; i += 2) {
        const k = j * n + i;
        const nb = s[j * n + ((i + 1) % n)] + s[j * n + ((i - 1 + n) % n)] + s[((j + 1) % n) * n + i] + s[((j - 1 + n) % n) * n + i];
        const dE = 2 * s[k] * (w.J * nb + w.field);
        if (dE <= 0 || random(w) < Math.exp(-dE / w.T)) s[k] = -s[k];
      }
    },
    magnetization(w) { let m = 0; for (const v of w.s) m += v; return m / w.s.length; },
    energy(w) {
      const { n, s } = w;
      let e = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        e -= w.J * s[k] * (s[j * n + ((i + 1) % n)] + s[((j + 1) % n) * n + i]) + w.field * s[k];
      }
      return e / s.length;
    },
  };

  // ---------- classic ODE systems ----------
  // Each entry: (params) => f(t, y). Run one live with Sim.ode, or all at once with Sim.ode.run.
  const SYSTEMS = {
    // y = [x, v]; m, k, c (damping), F, omega (drive).
    oscillator: p => (t, y) => [y[1], (-(p.k ?? 1) * y[0] - (p.c ?? 0) * y[1] + (p.F ?? 0) * Math.cos((p.omega ?? 1) * t)) / (p.m ?? 1)],
    // y = [θ, ω]; the full sin θ, so wide swings slow down. L, g, c.
    pendulum: p => (t, y) => [y[1], -((p.g ?? 9.81) / (p.L ?? 1)) * Math.sin(y[0]) - (p.c ?? 0) * y[1]],
    // y = [θ1, θ2, ω1, ω2], angles from straight down. m1, m2, l1, l2, g.
    doublePendulum: p => {
      const m1 = p.m1 ?? 1, m2 = p.m2 ?? 1, l1 = p.l1 ?? 1, l2 = p.l2 ?? 1, g = p.g ?? 9.81;
      return (t, [a, b, w1, w2]) => {
        const d = a - b, den = 2 * m1 + m2 - m2 * Math.cos(2 * d);
        return [w1, w2,
          (-g * (2 * m1 + m2) * Math.sin(a) - m2 * g * Math.sin(a - 2 * b) - 2 * Math.sin(d) * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * Math.cos(d))) / (l1 * den),
          (2 * Math.sin(d) * (w1 * w1 * l1 * (m1 + m2) + g * (m1 + m2) * Math.cos(a) + w2 * w2 * l2 * m2 * Math.cos(d))) / (l2 * den)];
      };
    },
    // y = [x, y, z]; sigma, rho, beta (10, 28, 8/3 is the butterfly).
    lorenz: p => (t, [x, y, z]) => [(p.sigma ?? 10) * (y - x), x * ((p.rho ?? 28) - z) - y, x * y - (p.beta ?? 8 / 3) * z],
    // y = [S, I, R] as fractions; beta (contacts × chance), gamma (recovery rate per day).
    sir: p => (t, [S, I]) => { const inf = (p.beta ?? 0.3) * S * I, rec = (p.gamma ?? 0.1) * I; return [-inf, inf - rec, rec]; },
    // y = [prey, predators]; a, b, c, d.
    lotkaVolterra: p => (t, [x, y]) => [(p.a ?? 1) * x - (p.b ?? 0.5) * x * y, (p.d ?? 0.2) * x * y - (p.c ?? 0.6) * y],
  };
  function rk4(f, y, t, h) {
    const add = (a, k, s) => a.map((v, i) => v + k[i] * s);
    const k1 = f(t, y), k2 = f(t + h / 2, add(y, k1, h / 2)), k3 = f(t + h / 2, add(y, k2, h / 2)), k4 = f(t + h, add(y, k3, h));
    return y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  }
  const ode = {
    systems: SYSTEMS,
    // Live state for one system: { sys, p, y, t }. h: fixed RK4 step.
    create(sys, p = {}, y0, { h = 1 / 480 } = {}) {
      if (!SYSTEMS[sys]) throw new Error(`Sim.ode: no system "${sys}" (have ${Object.keys(SYSTEMS).join(", ")})`);
      return { kind: "ode", sys, p: { ...p }, y: [...y0], t: 0, acc: 0, h, maxSub: 2000, trail: [], trailMax: 0 };
    },
    step(st, dt) {
      const f = SYSTEMS[st.sys](st.p);
      return fixed(st, dt, h => {
        st.y = rk4(f, st.y, st.t, h);
        if (st.trailMax) { st.trail.push(st.y.slice()); if (st.trail.length > st.trailMax) st.trail.shift(); }
      });
    },
    // Whole trajectory: { t: [...], y: [[...], ...] }, sampled every `every` steps.
    run(sys, p, y0, T, { h = 1 / 240, every = 1 } = {}) {
      const f = SYSTEMS[sys](p), out = { t: [0], y: [[...y0]] };
      let y = [...y0];
      const n = Math.ceil(T / h);
      for (let i = 1; i <= n; i++) {
        y = rk4(f, y, (i - 1) * h, h);
        if (i % every === 0 || i === n) { out.t.push(i * h); out.y.push(y); }
      }
      return out;
    },
    // Where the bobs of a double pendulum are: [[x1, y1], [x2, y2]] with the pivot at the origin, y up.
    bobs(st) {
      const [a, b] = st.y, l1 = st.p.l1 ?? 1, l2 = st.p.l2 ?? 1;
      const x1 = l1 * Math.sin(a), y1 = -l1 * Math.cos(a);
      return [[x1, y1], [x1 + l2 * Math.sin(b), y1 - l2 * Math.cos(b)]];
    },
    // Total energy of a pendulum or double pendulum state (per unit mass for the single one).
    energy(st) {
      const p = st.p, g = p.g ?? 9.81;
      if (st.sys === "pendulum") { const L = p.L ?? 1; return 0.5 * (L * st.y[1]) ** 2 - g * L * Math.cos(st.y[0]); }
      if (st.sys === "doublePendulum") {
        const [a, b, w1, w2] = st.y, m1 = p.m1 ?? 1, m2 = p.m2 ?? 1, l1 = p.l1 ?? 1, l2 = p.l2 ?? 1;
        const [[, y1], [, y2]] = ode.bobs(st);
        return 0.5 * m1 * (l1 * w1) ** 2 + 0.5 * m2 * ((l1 * w1) ** 2 + (l2 * w2) ** 2 + 2 * l1 * l2 * w1 * w2 * Math.cos(a - b)) + m1 * g * y1 + m2 * g * y2;
      }
      if (st.sys === "oscillator") return 0.5 * (p.m ?? 1) * st.y[1] ** 2 + 0.5 * (p.k ?? 1) * st.y[0] ** 2;
      return NaN;
    },
  };

  // ---------- small neural networks ----------
  // Weights live in typed arrays inside plain objects, so a whole network (and its
  // optimizer state) can sit in a figure's state and be snapshotted like anything else.
  const ACT = {
    tanh: { f: Math.tanh, d: (y) => 1 - y * y },
    relu: { f: x => (x > 0 ? x : 0), d: (y) => (y > 0 ? 1 : 0) },
    sigmoid: { f: x => 1 / (1 + Math.exp(-x)), d: (y) => y * (1 - y) },
    linear: { f: x => x, d: () => 1 },
  };
  const nn = {
    // sizes: [inputs, hidden..., outputs]; act: hidden activation; out: "softmax" | "sigmoid" | "linear".
    mlp({ sizes = [2, 16, 16, 2], act = "tanh", out = "softmax", seed = 1 } = {}) {
      const net = { kind: "mlp", sizes, act, out, rng: seed, step: 0, layers: [] };
      for (let l = 0; l < sizes.length - 1; l++) {
        const nin = sizes[l], nout = sizes[l + 1], W = new Float64Array(nin * nout), b = new Float64Array(nout);
        const scale = act === "relu" && l < sizes.length - 2 ? Math.sqrt(2 / nin) : Math.sqrt(1 / nin);
        for (let k = 0; k < W.length; k++) W[k] = gauss(net) * scale;
        net.layers.push({ nin, nout, W, b, mW: new Float64Array(W.length), vW: new Float64Array(W.length), mb: new Float64Array(nout), vb: new Float64Array(nout) });
      }
      return net;
    },
    // Activations of every layer for input x: [x, h1, ..., output].
    activations(net, x) {
      const acts = [Float64Array.from(x)];
      net.layers.forEach((L, l) => {
        const a = acts[l], z = new Float64Array(L.nout), last = l === net.layers.length - 1;
        for (let o = 0; o < L.nout; o++) {
          let s = L.b[o];
          for (let i = 0; i < L.nin; i++) s += L.W[o * L.nin + i] * a[i];
          z[o] = s;
        }
        if (!last) for (let o = 0; o < L.nout; o++) z[o] = ACT[net.act].f(z[o]);
        else if (net.out === "softmax") softmaxInPlace(z);
        else if (net.out === "sigmoid") for (let o = 0; o < L.nout; o++) z[o] = ACT.sigmoid.f(z[o]);
        acts.push(z);
      });
      return acts;
    },
    forward(net, x) { const a = nn.activations(net, x); return Array.from(a[a.length - 1]); },
    // Loss for one example: cross-entropy against a class index (softmax), binary
    // cross-entropy against 0/1 (sigmoid), squared error against a target array (linear).
    loss(net, X, Y) {
      let s = 0;
      for (let n = 0; n < X.length; n++) s += exampleLoss(net, nn.forward(net, X[n]), Y[n]);
      return s / X.length;
    },
    accuracy(net, X, Y) {
      let ok = 0;
      for (let n = 0; n < X.length; n++) {
        const o = nn.forward(net, X[n]);
        const pred = o.length === 1 ? (o[0] > 0.5 ? 1 : 0) : o.indexOf(Math.max(...o));
        ok += pred === (Array.isArray(Y[n]) ? Y[n].indexOf(Math.max(...Y[n])) : Y[n]);
      }
      return ok / X.length;
    },
    // One optimizer step on a random mini-batch; returns the batch's mean loss.
    // opt: "adam" (default), "momentum", or "sgd". l2: weight decay.
    train(net, X, Y, { lr = 0.01, batch = 32, opt = "adam", beta1 = 0.9, beta2 = 0.999, momentum = 0.9, l2 = 0 } = {}) {
      const gW = net.layers.map(L => new Float64Array(L.W.length)), gb = net.layers.map(L => new Float64Array(L.nout));
      const B = Math.min(batch, X.length);
      let loss = 0;
      for (let k = 0; k < B; k++) {
        const n = Math.floor(random(net) * X.length);
        const acts = nn.activations(net, X[n]), o = acts[acts.length - 1], y = Y[n];
        loss += exampleLoss(net, o, y);
        // Output error: for softmax+CE, sigmoid+BCE and linear+MSE it is (output - target).
        let delta = new Float64Array(o.length);
        for (let i = 0; i < o.length; i++) delta[i] = o[i] - (net.out === "softmax" ? (i === y ? 1 : 0) : Array.isArray(y) ? y[i] : y);
        for (let l = net.layers.length - 1; l >= 0; l--) {
          const L = net.layers[l], a = acts[l];
          for (let oi = 0; oi < L.nout; oi++) {
            gb[l][oi] += delta[oi];
            for (let i = 0; i < L.nin; i++) gW[l][oi * L.nin + i] += delta[oi] * a[i];
          }
          if (l === 0) break;
          const prev = new Float64Array(L.nin);
          for (let i = 0; i < L.nin; i++) {
            let s = 0;
            for (let oi = 0; oi < L.nout; oi++) s += L.W[oi * L.nin + i] * delta[oi];
            prev[i] = s * ACT[net.act].d(a[i]);
          }
          delta = prev;
        }
      }
      net.step++;
      const t = net.step;
      net.layers.forEach((L, l) => {
        const upd = (P, G, m, v) => {
          for (let i = 0; i < P.length; i++) {
            const gi = G[i] / B + l2 * P[i];
            if (opt === "adam") {
              m[i] = beta1 * m[i] + (1 - beta1) * gi;
              v[i] = beta2 * v[i] + (1 - beta2) * gi * gi;
              P[i] -= (lr * (m[i] / (1 - beta1 ** t))) / (Math.sqrt(v[i] / (1 - beta2 ** t)) + 1e-8);
            } else if (opt === "momentum") {
              m[i] = momentum * m[i] + gi;
              P[i] -= lr * m[i];
            } else P[i] -= lr * gi;
          }
        };
        upd(L.W, gW[l], L.mW, L.vW);
        upd(L.b, gb[l], L.mb, L.vb);
      });
      return loss / B;
    },
    // Output `cls` (or the single output) over a grid of inputs, for decision-boundary pictures:
    // Float64Array of nx * ny values, row j covers y = y0 + (j + 0.5) / ny * (y1 - y0).
    grid(net, [x0, x1], [y0, y1], nx = 48, ny = 32, cls = 1) {
      // A forward pass that reuses two buffers: thousands of points per frame stay cheap.
      const width = Math.max(...net.sizes), A = new Float64Array(width), Bf = new Float64Array(width), act = ACT[net.act].f;
      const out = new Float64Array(nx * ny), last = net.layers.length - 1;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        A[0] = x0 + ((i + 0.5) / nx) * (x1 - x0);
        A[1] = y0 + ((j + 0.5) / ny) * (y1 - y0);
        let a = A, b = Bf;
        net.layers.forEach((L, l) => {
          for (let o = 0; o < L.nout; o++) {
            let s = L.b[o];
            const row = o * L.nin;
            for (let k = 0; k < L.nin; k++) s += L.W[row + k] * a[k];
            b[o] = l < last ? act(s) : s;
          }
          [a, b] = [b, a];
        });
        const n = net.sizes[net.sizes.length - 1];
        let v;
        if (net.out === "softmax") { let m = -Infinity, sum = 0; for (let k = 0; k < n; k++) m = Math.max(m, a[k]); for (let k = 0; k < n; k++) sum += Math.exp(a[k] - m); v = Math.exp(a[n === 1 ? 0 : cls] - m) / sum; }
        else if (net.out === "sigmoid") v = 1 / (1 + Math.exp(-a[0]));
        else v = a[n === 1 ? 0 : cls];
        out[j * nx + i] = v;
      }
      return out;
    },
    params(net) { return net.layers.reduce((s, L) => s + L.W.length + L.b.length, 0); },
  };
  function softmaxInPlace(z, T = 1) {
    let m = -Infinity;
    for (const v of z) m = Math.max(m, v / T);
    let s = 0;
    for (let i = 0; i < z.length; i++) { z[i] = Math.exp(z[i] / T - m); s += z[i]; }
    for (let i = 0; i < z.length; i++) z[i] /= s;
    return z;
  }
  const softmax = (xs, T = 1) => Array.from(softmaxInPlace(Float64Array.from(xs), T));
  function exampleLoss(net, o, y) {
    if (net.out === "softmax") return -Math.log(Math.max(o[y], 1e-12));
    if (net.out === "sigmoid") return -(y * Math.log(Math.max(o[0], 1e-12)) + (1 - y) * Math.log(Math.max(1 - o[0], 1e-12)));
    const t = Array.isArray(y) ? y : [y];
    return o.reduce((s, v, i) => s + 0.5 * (v - t[i]) ** 2, 0);
  }

  // Toy datasets, seeded: arrays X (points) and Y (class indices).
  const data = {
    spirals({ n = 100, classes = 2, turns = 1.5, noise = 0.08, seed = 1 } = {}) {
      const st = { rng: seed }, X = [], Y = [];
      for (let c = 0; c < classes; c++) for (let i = 0; i < n; i++) {
        const r = (i + 1) / n, a = (c * TAU) / classes + r * turns * TAU;
        X.push([r * Math.cos(a) + noise * gauss(st), r * Math.sin(a) + noise * gauss(st)]);
        Y.push(c);
      }
      return { X, Y };
    },
    blobs({ n = 100, centers = [[-0.5, -0.5], [0.5, 0.5]], spread = 0.25, seed = 1 } = {}) {
      const st = { rng: seed }, X = [], Y = [];
      centers.forEach((c, k) => { for (let i = 0; i < n; i++) { X.push([c[0] + spread * gauss(st), c[1] + spread * gauss(st)]); Y.push(k); } });
      return { X, Y };
    },
    xor({ n = 50, spread = 0.18, seed = 1 } = {}) {
      const st = { rng: seed }, X = [], Y = [];
      for (const [x, y, c] of [[-0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 1], [0.5, -0.5, 1]]) for (let i = 0; i < n; i++) { X.push([x + spread * gauss(st), y + spread * gauss(st)]); Y.push(c); }
      return { X, Y };
    },
    circles({ n = 150, noise = 0.06, ratio = 0.45, seed = 1 } = {}) {
      const st = { rng: seed }, X = [], Y = [];
      for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) { const a = random(st) * TAU, r = c ? ratio : 1; X.push([r * Math.cos(a) + noise * gauss(st), r * Math.sin(a) + noise * gauss(st)]); Y.push(c); }
      return { X, Y };
    },
    moons({ n = 150, noise = 0.08, seed = 1 } = {}) {
      const st = { rng: seed }, X = [], Y = [];
      for (let i = 0; i < n; i++) { const a = random(st) * Math.PI; X.push([Math.cos(a) - 0.5 + noise * gauss(st), Math.sin(a) - 0.25 + noise * gauss(st)]); Y.push(0); }
      for (let i = 0; i < n; i++) { const a = random(st) * Math.PI; X.push([0.5 - Math.cos(a) + noise * gauss(st), 0.25 - Math.sin(a) + noise * gauss(st)]); Y.push(1); }
      return { X, Y };
    },
  };

  // ---------- a tiny language model ----------
  // Character (or word) bigrams: what comes next, given only the previous token.
  // `counts` builds it exactly from a text; `learner` learns the same table by gradient
  // descent, so a page can show a loss falling toward the count-based answer.
  const tokenize = (text, level) => (level === "word" ? text.toLowerCase().match(/[a-z']+|[.,!?;]/g) ?? [] : [...text]);
  const lm = {
    counts(text, { level = "char", smoothing = 0 } = {}) {
      const toks = tokenize(text, level), vocab = [...new Set(toks)].sort(), V = vocab.length, index = Object.fromEntries(vocab.map((t, i) => [t, i]));
      const counts = Array.from({ length: V }, () => new Array(V).fill(smoothing));
      for (let i = 1; i < toks.length; i++) counts[index[toks[i - 1]]][index[toks[i]]]++;
      return { kind: "bigram", level, vocab, index, counts, V };
    },
    // Probabilities of each next token after `prev` (temperature T sharpens or flattens).
    next(model, prev, { T = 1 } = {}) {
      const i = model.index[prev];
      if (i === undefined) return new Array(model.V).fill(1 / model.V);
      if (model.kind === "bigram") {
        const row = model.counts[i], total = row.reduce((s, v) => s + v, 0) || 1;
        if (T === 1) return row.map(v => v / total);
        return softmax(row.map(v => Math.log(Math.max(v / total, 1e-12))), T);
      }
      return softmax(Array.from(model.W.subarray(i * model.V, (i + 1) * model.V)), T);
    },
    // Generates n tokens after `start`. st carries the rng (st.rng), so the same seed gives the same text.
    // topK keeps only the k likeliest; topP keeps the smallest set whose probabilities add to p.
    sample(model, st, start, n = 40, { T = 1, topK = 0, topP = 1 } = {}) {
      const out = [start];
      let prev = start;
      for (let k = 0; k < n; k++) {
        let p = lm.next(model, prev, { T }).map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
        if (topK) p = p.slice(0, topK);
        if (topP < 1) { let s = 0; p = p.filter(([v]) => (s += v) - v < topP); }
        const total = p.reduce((s, [v]) => s + v, 0);
        let r = random(st) * total, pick = p[p.length - 1][1];
        for (const [v, i] of p) { r -= v; if (r <= 0) { pick = i; break; } }
        prev = model.vocab[pick];
        out.push(prev);
      }
      return model.level === "word" ? out.join(" ") : out.join("");
    },
    // Average surprise per token in nats (cross-entropy); exp() of it is the perplexity.
    crossEntropy(model, text) {
      const toks = tokenize(text, model.level);
      let s = 0, n = 0;
      for (let i = 1; i < toks.length; i++) {
        if (model.index[toks[i - 1]] === undefined || model.index[toks[i]] === undefined) continue;
        s -= Math.log(Math.max(lm.next(model, toks[i - 1])[model.index[toks[i]]], 1e-12));
        n++;
      }
      return n ? s / n : NaN;
    },
    learner(text, { level = "char", seed = 1 } = {}) {
      const base = lm.counts(text, { level }), toks = tokenize(text, level);
      const pairs = new Int32Array(Math.max(0, (toks.length - 1) * 2));
      for (let i = 1; i < toks.length; i++) { pairs[(i - 1) * 2] = base.index[toks[i - 1]]; pairs[(i - 1) * 2 + 1] = base.index[toks[i]]; }
      const m = { kind: "learned", level, vocab: base.vocab, index: base.index, V: base.V, W: new Float64Array(base.V * base.V), pairs, rng: seed, step: 0 };
      for (let k = 0; k < m.W.length; k++) m.W[k] = 0.01 * gauss(m);
      return m;
    },
    // One gradient step on a random batch of (previous, next) pairs; returns the batch loss.
    train(m, { lr = 1, batch = 64 } = {}) {
      const n = m.pairs.length / 2, G = new Float64Array(m.W.length);
      let loss = 0;
      for (let k = 0; k < batch; k++) {
        const r = Math.floor(random(m) * n), a = m.pairs[r * 2], b = m.pairs[r * 2 + 1];
        const p = softmax(Array.from(m.W.subarray(a * m.V, (a + 1) * m.V)));
        loss -= Math.log(Math.max(p[b], 1e-12));
        for (let j = 0; j < m.V; j++) G[a * m.V + j] += p[j] - (j === b ? 1 : 0);
      }
      for (let k = 0; k < G.length; k++) m.W[k] -= (lr * G[k]) / batch;
      m.step++;
      return loss / batch;
    },
  };

  // ---------- one attention head ----------
  // Exact arithmetic on small matrices (arrays of rows), so every number a figure
  // shows (a score, a weight, an output) is the real result for those inputs.
  const matmul = (A, B) => A.map(row => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
  const transpose = A => A[0].map((_, j) => A.map(r => r[j]));
  const attention = {
    // Random projection matrices for model width d and head width dk (and dv).
    init({ d = 8, dk = 4, dv = dk, seed = 1 } = {}) {
      const st = { rng: seed }, M = (r, c) => Array.from({ length: r }, () => Array.from({ length: c }, () => gauss(st) / Math.sqrt(d)));
      return { Wq: M(d, dk), Wk: M(d, dk), Wv: M(d, dv) };
    },
    // X: n token vectors (rows of width d). causal: each token sees only itself and earlier ones.
    // Returns Q, K, V, raw scores (Q·Kᵀ/√dk), weights (each row sums to 1), and out (weights · V).
    head(X, { Wq, Wk, Wv }, { causal = false, T = 1 } = {}) {
      const Q = matmul(X, Wq), K = matmul(X, Wk), V = matmul(X, Wv), dk = Wq[0].length;
      const scores = matmul(Q, transpose(K)).map((row, i) => row.map((v, j) => (causal && j > i ? -Infinity : v / Math.sqrt(dk))));
      const weights = scores.map(row => softmax(row.map(v => (v === -Infinity ? -1e9 : v)), T));
      return { Q, K, V, scores, weights, out: matmul(weights, V) };
    },
    // Sinusoidal position vectors (the original Transformer's), n positions of width d.
    positions(n, d) {
      return Array.from({ length: n }, (_, p) => Array.from({ length: d }, (_, i) => {
        const f = 1 / 10000 ** ((2 * Math.floor(i / 2)) / d);
        return i % 2 ? Math.cos(p * f) : Math.sin(p * f);
      }));
    },
    matmul, transpose,
  };

  // ---------- drawing ----------
  // Helpers in the house style. P maps world coordinates to the canvas (g.fit or g.graph).
  const draw = {
    // Springs colored by strain (blue squeezed, red stretched), rods in ink, particles as porcelain beads.
    particles(g, P, w, { springs = true, rods = true, beads = true, strain = true, color = "ink", rodColor = null, rodWidth = null, radius = null, hide = null } = {}) {
      const S = strain ? particles.strain(w) : null;
      if (springs) w.springs.forEach((s, k) => {
        if (hide && (hide(s.a) || hide(s.b))) return;
        const A = w.p[s.a], B = w.p[s.b], e = S ? clamp(S[k] * 6, -1, 1) : 0;
        g.line(P([A.x, A.y]), P([B.x, B.y]), { stroke: e > 0.05 ? g.mix("muted", "red", e) : e < -0.05 ? g.mix("muted", "blue", -e) : "muted", width: 1.25 });
      });
      if (rods) for (const r of w.rods) {
        if (hide && (hide(r.a) || hide(r.b))) continue;
        const A = w.p[r.a], B = w.p[r.b];
        g.line(P([A.x, A.y]), P([B.x, B.y]), { stroke: rodColor ?? color, width: rodWidth ?? (w.rods.length > 60 ? 1 : 2) });
      }
      for (const s of w.walls) g.line(P(s.a), P(s.b), { stroke: "ink", width: 2 });
      if (beads) w.p.forEach((p, i) => {
        if (hide && hide(i)) return;
        const r = radius ?? Math.max(2, p.r * (P.sx ?? 100));
        const at = P([p.x, p.y]);
        if (p.pin) g.rect(at[0] - r - 1, at[1] - r - 1, 2 * r + 2, 2 * r + 2, { fill: "ink", r: 1.5 });
        else g.circle(at, r, { fill: "panel", stroke: color, width: 1.25 });
      });
      if (w.mouse) {
        const p = w.p[w.mouse.i];
        if (p) g.line(P([p.x, p.y]), P([w.mouse.x, w.mouse.y]), { stroke: "orange", width: 1.5, dash: [4, 3] });
      }
    },
    // Rigid bodies as porcelain plates with graphite outlines; statics hatched; b.color tints a body.
    rigid(g, P, w, { stroke = "ink", contacts = false } = {}) {
      w.bodies.forEach(b => {
        const fill = b.color ? g.rgba(b.color, 0.28) : "panel", line = b.color ?? stroke;
        if (b.type === "circle") {
          const c = P([b.x, b.y]), r = b.r * (P.sx ?? 100);
          g.circle(c, r, { fill, stroke: line, width: 1.5, hatch: b.static ? g.rgba("muted", 0.5) : null });
          g.line(c, P([b.x + Math.cos(b.a) * b.r, b.y + Math.sin(b.a) * b.r]), { stroke: line, width: 1.25 });
        } else {
          g.path(rigid.vertices(b).map(v => P(v)), { close: true, fill, stroke: line, width: 1.5, hatch: b.static ? g.rgba("muted", 0.5) : null });
        }
      });
      if (contacts) for (const c of w.contacts) g.circle(P(c.p), 2.5, { fill: "red" });
      const a = rigid.anchor(w);
      if (a) {
        g.line(P(a), P([w.mouse.x, w.mouse.y]), { stroke: "orange", width: 1.5, dash: [4, 3] });
        g.circle(P(a), 3.5, { fill: "orange" });
      }
    },
    // A grid as color: map "diverging" (low color, paper, high color) or "sequential" (paper to high).
    // value: which array to show ("u" by default; "v" for Gray-Scott). box: [x, y, w, h] in canvas pixels.
    field(g, G, o = {}) { g.gridField(G[o.value ?? "u"] ?? G.u, G.nx, G.ny, o); },
    // Ising spins as two tones.
    spins(g, w, o = {}) { g.gridField(w.s, w.n, w.n, { map: "diverging", range: [-1, 1], smooth: false, ...o }); },
    // N-body trails and bodies sized by the cube root of mass.
    nbody(g, P, w, { colors = ["blue", "red", "green", "orange", "purple"], trails = true, scale = 6 } = {}) {
      if (trails) w.trails.forEach((t, i) => g.path(t.map(q => P(q)), { stroke: colors[i % colors.length], width: 1.25, alpha: 0.55 }));
      w.b.forEach((b, i) => g.circle(P([b.x, b.y]), Math.max(2.5, scale * Math.cbrt(b.m / Math.max(...w.b.map(x => x.m))) ), { fill: colors[i % colors.length], stroke: "panel", width: 1.5 }));
    },
  };

  // Canvas helper that draws a grid of values as color, with the palette read at draw time.
  (window.__safisG ||= []).push((g, util) => {
    g.gridField = (arr, nx, ny, o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h], [lo, hi] = o.range ?? [-1, 1], map = o.map ?? "diverging";
      const paper = util.rgb(o.paper ?? "panel"), neg = util.rgb(o.low ?? "blue"), pos = util.rgb(o.high ?? "red");
      const cv = document.createElement("canvas");
      cv.width = nx; cv.height = ny;
      const c2 = cv.getContext("2d"), img = c2.createImageData(nx, ny);
      // Row 0 of the grid is drawn at the bottom (y up), like the world coordinates.
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const v = arr[j * nx + i], k = ((o.flip ? j : ny - 1 - j) * nx + i) * 4;
        let col;
        if (map === "diverging") {
          const t = clamp((v - (lo + hi) / 2) / ((hi - lo) / 2), -1, 1), s = Math.pow(Math.abs(t), 0.8) * 0.85, end = t < 0 ? neg : pos;
          col = [0, 1, 2].map(q => paper[q] + (end[q] - paper[q]) * s);
        } else {
          const t = clamp((v - lo) / (hi - lo), 0, 1);
          col = [0, 1, 2].map(q => paper[q] + (pos[q] - paper[q]) * t);
        }
        img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = Number.isFinite(v) ? 255 : 0;
      }
      c2.putImageData(img, 0, 0);
      const ctx = g.ctx;
      ctx.save();
      ctx.imageSmoothingEnabled = o.smooth !== false;
      ctx.imageSmoothingQuality = "high";
      if (o.alpha != null) ctx.globalAlpha = o.alpha;
      ctx.drawImage(cv, box[0], box[1], box[2], box[3]);
      ctx.restore();
    };
  });

  window.Sim = {
    particles, rigid, wave, heat, grayScott, advect, nbody, walkers, mc, ising, ode, nn, data, lm, attention, draw,
    random, gauss, softmax, fixed,
  };
})();

;

/* Maps kit. window.Geo holds the spherical math (distance, bearing, great circles),
   five projections, the world's countries, and about sixty cities; g.map(o) draws a
   projected map in the house style. Reference: references/maps.md in the skill.

   Land, countries, and borders are Natural Earth 1:110m (public domain,
   naturalearthdata.com), from the world-atlas package 2.0.2 by Mike Bostock (ISC
   license). tools/make-geo-data.mjs turns its countries-110m.json into DATA below. */
(() => {
  "use strict";
  const { sin, cos, tan, atan, atan2, asin, acos, sqrt, abs, min, max, hypot, log, exp, ceil } = Math;
  const PI = Math.PI, TAU = 2 * PI, HALF = PI / 2, RAD = PI / 180, DEG = 180 / PI;
  const R_KM = 6371.0088;                                  // mean Earth radius (IUGG), km
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const clamp1 = x => clamp(x, -1, 1);
  const wrap180 = l => l - 360 * Math.round(l / 360);     // degrees to [-180, 180)
  const wrapPi = l => l - TAU * Math.round(l / TAU);       // radians to [-π, π)
  const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  /* geo-data:start */
  // Natural Earth 1:110m countries (public domain), from world-atlas 2.0.2 countries-110m.json
  // (ISC license, Mike Bostock). Generated by tools/make-geo-data.mjs; don't edit by hand.
  // 595 arcs, 8245 points in hundredths of a degree; 177 countries.
  const DATA = {
    arcs: `
mlBSo5iBttDyBiBmC5BhBnD7DbtDaR4CsCkC6CZWn-lCgJqBKZ_CPLgmmCvB9DpBZqCkDqB-BK2D-B_pmCAK84pBw-CiBV2W3MOzD-InGWkhBpX7C1HMxDgEnCGzB1B3DK9BL_CmC7DyClGqCrBSgHnjB_EzD5Gt
C3DEnC7BpEF1BXvH4B1EPK_jBvH3BwIjC-CnB2BjGmBKnLqOxD8B9DiBvCiBzCyBMzMyFrD8HzDwDnB0DUoDjB4FQ3IgYyCKqCoCsCoDyBqBBiCpBsBLwCIiHiN6BYK2DtCwDIJ-HmCa8GD2MQGp0Hg0FCNFlBSD
zBAvJvUKG_P7FPvBnDmB_IvYApBhCEp0B_nBI0CiBI0CEAiOQYoCyC6CiC0I2I4G-C8H-BOiC8EoFWoCZ6CAiCuB8DGFsDeAWr1UssFbAhMmGvE2CpLyCtDyFc6D_H2ChBgFxHyEFmDiBjwBokBwDgDFgEzK-DrG
kH7DwE3F6CnEyCnDoDpGhChGtDxFiErE4ChG4BlGGCyjBAmX-KphCm9C2LvB8J_CwGRuF0CyH-BqJXsJ2CoKyBoExC2EuBsB-CqET0KzFoIoEc3E2HgBsC8ByHLyJzC0OpCyIhBkGOuIlD3IjDoLpB8QYqFiB2G3
D6GmDrG0CgEkC0HKgFUiFvBoGrDgHQiL5C2JgBkJFX8DyFkB2JjCB9FgEgFgFF8CqG3G6DnHyCQ8GsHyEoIfqG3CwIhHxFhD0LnBAtGsI-EuH_D7B1EiGlEwGwEyEsFM8G8INoJdsIjDMhDzErDsEpDZhDnMrE1I
dtG8B7BjD_FpF5B3CnHlE9IN9EzCNhEnHX1HjF3G_GtC9ELnHoJhB6C5F8C3E4IoB0L3CoGrCwE9C6H3B0GzCqKJ6GThBtF-BnGyE_GqJ9F6EgCsDuGnD8JtEqDgK-CiHsEwDqEPmEnEqFzH4EsHwG1C2FjC4JsE
uB2K1BuGTmF0B6FhC2HzD-BtCkLPFnFiC7H4FfwE1DiJwD-F8GmE-C6EzFmI9H8GvHvC9DqIvD0FzD-JxBiE_BuCpF8EZwCrCQ_GxErCvElCpKlC5HlFxKfrNqBrJCvGNnFvE9H3C_IpInH3FqFiBiKmIkNmFqJU
yFhD9FlEgC3GiC1EkIjDqKcoGiHOxEiEnC3HjE5N1DnGvC9GvE3EOHqF8KkFhKF9GXwEytOx5EhEwDAyI3C4BnEfhC0B3E3E7B7EnC5CzCd_BLVvBvLAvJB5CjBzGvEXP_BtC3FAjGB5CdgBnBS9BDTlIhDtGfnH
rDxBAjCgBVeEUsBmC-CuD6B2DnBuFpB2FvG-CYiBda1BAnBgBJuBnBT1BGMUtBUT0B5EgChFiCjGuC7FoCxF3BhCB1H0BhFZhG-BrGgBrEM9BiBjBuDhCBBrC9MArVAnVA3SA3SAtSAhTAjGAxSA3RAOppDmsD0E
8CyIBDlBpHtDrEErB2BWsa2gC9GqDKoCgDOqOV4KtDS1B1GG1GE7Gb3BMQtD9iCuC6ByCDyBnBtCpD3CSzB8BIOQhzCywCtDtChJQxH0BqD6CgJ2BuFlCqC_BOtB8P5CF3LO1B2B0MBsElBXVSlS6HuHlC1BnCnJ
pBhFuB1CsCPyCiIH2DL4B41BrbjKaxQgClCuDXiDnG4C9MYnH-BqCyC-ML-G_BqMAsFhCtBrCmHrB-DvBuIHkJR-JsB4MQkKN2GpCuBzC9DzBpJrB_HY9Rd5MDOtwEwX6IdjC7BzL5BnJgCgFgCmJUO8BiEkInBz
HlBrKAEcsG8BsDJiCg6K3rFpD9DlEvFkEkCmEpBlClCyF3B8CyBmG9B9BxEsEiBapD-B7DzCvF5CHjEmBsBkF3BYnHtF3DIuE-C_FwB3GLjMGd8B8DmC1C2BoF6DuG-J8DyDuFkC8CHlB1BoB3wFm2C6GjCmH_BS
9CyEQwEhCxF_B3JwBvD6ClGpD7InDlC2DtITuFkDY8EmC4FwEPkB3CoDe0DzByE-fotB-FwC6NlD0I9Ca3C0LuBwG_DiPvCuFvC-F5FvL9C4OhE-JrBgJ3F6JN9BrE_KnH1H2C5JgGhIZZxDyGzDwI7CyC1BiElG
jCvE7H4B1PgF6ItFwG3DgBlC9QwCrN0DzHiDmC4BpJmDjJiDE5BhSfnFkCiE0E4LE8MahCmCkCkDkIiG3B6CrCkCxJgD1MkCgE0BzG8DvFM9EkCpD7BrLZ1WuBnN6BjKelFmCwG8C7IA9BsG4EyFuGyCkQ0BxE_D
-E9D4FiF6PyC4KtGdjEsM6BWpiDkLgNF-LvBpJxFvHnB1G1EjHI7DwFCkDoD0CoG2BWnxFuM0K0E6MiE0JByIeb5E5ElC5FJzL1C_JdvIsBWx9B_pEgGQ7BjHuF_EvCA3D8CpC8ClD-BjB4CMgC-CZWkqF89EoMb
-QnC4E9CuCzClKWpKgC9NIiG8BxHwBNsCgBzwDtgGjDbnK8C9BmCxFmCjB4BtGmBrCsDQuByGrB8Dd8FViCjCkD9CoGzCyCtDiBqMkiF-IpB-PJiG5B4G1C7HxBpPrE3HrEA3CtQ_CpD4CtOqD2C0CqEyEuFkEjG
6DkVgBsB41C4IyFgByGHiBhD3D_ClVd3P1CvJFZiCgN4CncX3IkBwIkG-F4ByRjCkL1D8KP9IgG4FoCuGVkC_CuClC6CkIpRgHxC-DhG-BtEuKhDqL9CV3CnKRgErCjCpCpLgB3K2BnHL3LjC5PdjLRtD-CvI2Bx
FV1H-EkEW2JiB6IJkIkBhMuBrNP7IEnDqCwOwCzJD9K2BoF2EqEwC4Q4DsGlBjD9C-N8B2IjDiHmD2FhCkFjGkDyCtEuGwFeoGfegmBpC7GiEsHgDwHpBkLa0B5B5F_CuJ1CjBzFnKtC_FSpEsCxP6EEgC4MXMvm
ByFsII4ErBvFjE3JsEkCca0yBwT4E7CInD7CzEpKT1GgBE0DnKPN8E4GFuJkC4ILQaqByPoYqE-BsGO3CuByOKgIrDwKpBoKlB-EjEwH_BxI7BvL1EjLN9MY1GyCCoC-E2BrLB9GiC9D8CsE4CiE0bkIqJkBqHIo
MgBmJqC4HJ4G3B4EsDoIgBmLWkTIqDViSiBwNLyNL2QPuNZuL1BH1BnP1CjPnB1FtB0NC3O5DlK3B1KjF7MhB_DnB9SV0IXpEjBmFhD9FlC1J3B9CtC3I7BctB2KIEvB1Q3DpQ2BrSdpJY5LKZgDyLuBhDwE6DO2
Q1CvIgEjKmBiFuCiLwB4BmC5IuCzCmDiRH-EV4JoChOY7VLhLkClFwCpH6BrBmCSqmDr6ChE5B_GJxBiD2CwD4Fc8E3BC1CXbWvjE6M6DrC7DlCtI8BhFVxI6CwF-BsE2C0G3B4DjB8BlBQsmGz6DmCSmIxBsGzC
GjB_CDjI-B5F-CSmD1RmChDwEZ6FEjDxCnCL9H0CxBkCsC-BwGxT7LiBhCzG_CtGlCzG7BpD1DftBDpDkCnDyCFTqC6BtBN3BnEf_CCzEhB1CJ1DJlF5BmJmB8BlB5I7B9DAGY9B3B8BHrBvExE5EN0BrBKhCyBq
BrDyBjBCrC_BrCvD_ERI-BoElDsCXmFlB1CqB_DjEgBqE_BI9F6BNUlCcnG9DzEvG7BhEzDjDNlDpCbhC7GhExD_C9C1DdtEkBpEiCrF6CtEA1C-CnHFlEHtCxB5D7BZhDYf4CrCuBpDsF9C4EdwCqBkE3BuD7Eo
FtCepG5CjBK_C8C9DyBhHZxFY3ENxCfkB1BDvCqBnBlBZpCepClBxEG1EqDtFZvEuB9DNnFtB1FzElG1CtD_CtB5CBpEK_CmBjC4Bv7Ft4DtCFtEsB7E-B3B-CrBsE1DyDlC2DjDoErEwCjFD9D9ElF8BnD8BxBu
DhCoD1D4ClDgCpCmC5KAAxC_EArMBpOuErJgDSoB9HVjHPgC98D0pBfoDhEyD9CYV6BvDKnC2B5FUxBgBXuDjGoGlF2IIuB3CiC7EoFZkFrDsDsBmFFsF_B6EuC8FY2FY0FjBsI_BsF5B8CYoBiJjCqD7FyB0Bfk
FjCkFiBlvH5tCkBRgBZyBlCDLtCpB_BfdfxBcG4BfoCKWiBiBNmBMUODuChBS1DoERXjCNhBqBVQBOUQmCR2BfK5E0CFVrDGQYiDHS9HsDSN6BhCLLNElCGXuBHI0BcOpIkDCvBXThCkBKQgBUuBDOtsBwuH-ERU
rC5DfjEmB3D2BkGiBS4yChPmEN0C9BtF9ClGrCnDyBd-C2FoCqDeuH6tE5TtDsCvFgC3BuFhIiFrD8F_FO9JEpH6B9MwG9FmB9KmC1IPpM8CrH2C_GrBqBpEtDNnHnBvFjC9GpBb0D6CmG0G8B1ByB9HtDpElE_I
tEyEhD7FtE3GzCnG9BxB3C3JnD9B9CpHzCpEO5F3BrGjClFhC3K5BdiB6G-CkG-B0GuD6HWiDyC2I4DsBoB0EmCiB4EmD2DlH7BhCiBrDpChEmD1BnCpCkDpGvC5DAP4DkBoChEoCjIlBnF-CpEwBAwD5E2CuC0D
iFuDoCoDiFOoEfiFgDwEP6E-BlB6CvDkB0EuC5DBzGrB9BrB9EsB5IVjJwB1CwC7H0D4I0CgOiDkFAbjDmNIhF6D1HuCtEkD_F0CxIgCwDoDiLG8H8CwBiDsG-CkGY6L4C4FN0JsDuJpByE5C4CmByKLLtByJhBs
GUmN_BgMR6EZqIgBwJ7B4GbYthIk4B6DlB-DUiFzBmGZPV3EpB3EqBrCmBvFLvBSMqCYqzyB_6C3ElElFRJpGvD5CrMiCvElLlDrBrMvC0F7KpEzBQxDYrsB9qB5DelDoCnJUrKGnCV9I0CxDpBd1DpKmChEdtB1
CmBj6BPxDlBnIrE3CtEpCB3BgD9HGnBkFhDAQqGvHyE1KPrHd9F2FjFqC1JwElBShQ1DIhXM19C_FlDJtE8ElE4BjHnB3CjCkB1V-CJyBwByClBmCnHkC5C0FtDyBFiCiGTI0EqFgBuFdkBiGjB8DnGJpFyBlH3C
7FpBkDnV8clDgBWoD_DkE1EDnFmEyD4E5BqBgF6GuGxDYwE-M6G4JG4NpEuHxC0G0C8JEgIlD6B6B6IHyB-CjKqEgGiDlB2BgG0BvEoE8CmCsXkCiDyB0PqC0FyCmLpBgCvGyGyBgIjCRtDiGM0P8FpC9BgI7E-N
5PsDoD0IzD-I0BwDjBgDzDqElB2C1CiIcqD5DQ0oE5Z8BTnFhE0ErCuEyBsHnD9HvE5ESYK1MxCDb4BqB8CrItB_B_D9CvDnFKzB3C0EvBqBzEvDpGG7TpT3EqBtDAgBlIqBE6DnI2CxGiDhE-CjHqEjDuGhCmB5
GJrCqBV-ErIqDnFzDrFjCgBlD_GBgCwxO35H8KpEwLxDqElDwDlDe1DuK5DwBpD3FVsBlE0FhEgE1G0DIH3C6EhB7BlB0GzCV5BjENxB0BrFWpGe5EgExDuDnDuFlI4CnF5B5DhCYxE7ElCvDiBvGIGG3oBBsUDs
UcyoCkiBsC_BYnD9B1BlB2DtBuC7CiCxD0CvE8B4BwBsD3BkCrB0CvBwCzCsBrIzNtDvBlDvBpDAjF6BxD4BQ-B0FbuDOegDcGUpDyDO4BmCwDmCV2D4DEoBfDvDjC5DnDPf3BW0VkD8BtBiD9D-CjCb3B3BT1Cs
C3CgEpB4EaUW7BoC51CzXxFkFpGoBxB3B9HF2CiF-D4BzB6G_CoFjMoFjFStJ4F5B_CtCRrBoCB4C3EiD4GoCuEDP2BlJAtC2DzFmBzCiDuIwBmDiCgKxCgBpC4BjKwG3DmF0GmH6DyFAsFlC0EnC2GlBGrkDuBU
nBE7BOYjDhE1ErFrBXYSkC2C6DmGwCOg5B0PT2EkBoCqBkCuB7BA9CnDnE0BhmD-kCxDzF0E9FjB7CiH5FtHXhCnEIzF_FpEFlGrCxJdmCjH5CtC6DtEMjDgCtHnCpCgDhEJlFYdsIjD4B_CqFbwFY4F2DmEcrzB
pNiBlEqExDgEqBgEP0DmDgDS-F3BiFqBmD2IuCmCmCkHkHAuFhBSm7Dhe8G5BoC5EnFyClFSxDNpEIuBuD4HIMzPlGpEkBlB2CqGKyBhCrChCa0GolBOrD4DRSxCLtFlDUd5DyCpD3BXvC-D7BgIoBgFiCoC6Cnf
hImHImGwEiBrB_ElG3ElB_FmBrKJvFbb3EyFxFsD6C2LkCP7C3Ce1C1DvFtC8F_HjBjC0FlHBjEpD5BtCmCgDkFjGtCxB4BasCvE2DOiGlE7BSpHI9I9Db1C6B4B4FdiGzCA9BqEyCiEcgFmDsJoB0CsF0E8E7B8
HZOvQzlCnIsE6FoBqD9BmC7BN1BzCDSyG4KmEQyFqCbvDtJ3BpIYAoC-EqB-D7BUnTkB8DQyB1CnHnBpEZrDCkCyDuDC2BoCoC1BuBh9BkManCgMTsB0CyLhDqC_DsJlB2H1DjHrC9GwCzFFvGQ5FkBnHsCzEUxC
ZtLyChB2C3FQqE-FyHLiFtC0CNmC3ZshBiBrEmCvDyERiD9DxB5HHzJ9GDnFmFhIkFzC6D3EiFjD2E3E4IvFmF5BsFpC8EzF-DnDsF1EwDxG8GRmDiEH0JlByFjG6EnEuDzC-F1GsGDoFnE0DnF4E7CvChFyDlCo
CDQn5hBniKsC7CkD1EkI3D4IxB5CjD9FJlDmCIuKjO3DG1GAA-NMs6Bo6EzB_EzBrGCnGrBrBPhEsChFhXNnDgIrFbpE8D1CJhD_F_HnJrDxMpB7GUsB1DpB1EkBlD3DlCrGb_FqCtCzBcnGoE7BuDgC6BnD3F9B
_E7DdpGvBrD7FA7ElD5B1EkGxEgGpBlCxFrHxDhEpH1FvCxC7CgCvGmEzDzCK4Cr_B9yD5FgBjPaxC0DE2EjELnCoCP0G4E4CgCgEXkDqDsFqCoIV2D4CmBVqC7CoBiC0C7CsCtBoHwCoBhB0HwBsG2ByF4DqC9B
iGA4F4EiEFoFyDkGC4FzBkB7C6K6DsGTiGoC2FkE8FuE8D7BuCqBiCHsK6GiDmCwGZyBOkJ44FoF2FmIxB0DvEuCiFkHHgBrBY0biDwLlKkFd0HzEuGtCe3ClGvJqG3BgHdgFgB0F6EgBwFQsyB5VkDmBkDxDD_E
nFtDlExChHhGpIxIiBhtCn2FhCvCrF9BhDG1DQxE8BxGe7HwDpGqDzIgHkFpB6IlEoIlCoD6CgCqE4FyCwEXQtQopHiDnEavEqDzC_BhGsD_GuCzIwEayCsG_4GxFC_CxBzFnChB5FzCFhHiCjHsE5HyD9B-D4B2
DjDkEZ2K2CgGyG6EvJ6BgGyFkCsK-GlCoD-MlE0B9B5H9Dc-B-IkC0L8CoE5BkGPgH0CI8DiKqEgK0CqJtBsJ8BkFX4H2D0HkBiMgCgN-BgONmKpB6IGnLm0GmD0B2BmDwB-3Ty-BtCUtIhB1BX3B9DsB5ChBrHZ
nG2BjBsEtC4BkBQ3G3ECzCuDpC2C3EctBoD5D_B_EehC6C_DS9CDJ-BlCE6B1qBlQ5CM7Dd3CGvBRKuHhCqCP6De4DnBuCD-DzHBSoClDAJjB7DHxBzDdxBvDc_BblEPrCqDtBgC5B4DvB0EtSEnCX3BCzCZEtoC
meb-BKb-B0BWG2CgB0BoCqBqBiFqG2BTkCsCuDBM3BqCjB2D-D0DgD0BgCHmF4CiG6CmDkEiDYgCEoCiBmCJyDYwFoB-D6BqDM4DmBkiB4zBSsEuCmDsDgCkFjCgEpCyET0ElB8B4DcQ8CT-GkDwCpBgCGewBqCS
2EViEDgCUQ43B6K6DjF6CX2BiB8CNwDqBuB1CwFjEU0V3KLpHwCb_BlCrC1BrCnDrB7CJhFtBrCB1EK5Hpe5B3BF1DbPRtDGtDrJyB5CMxHIwuCoH3DkFB4WwFkHM2BgjB2B-BgEEyFuEkII2R4SOilBwZsEoF6C
6DAoDAqGAyCCEsBoHqVgCE8CeqDU-CkCsCAE1BRzDCpDrBnC3B3G_C_G7D_HpFjJrF_GrHvInGhFpJnG5F3E7GxHtBpDrBtBQh-CntCB0G6ByCiDkEqCyE5CkHVkD_CsEGUwgB8D4DoEkEckI8HoDhBAvDkChCsE
A8HpFgCBuBGsBXmEP6B0C4F0CwCjCqEAQqnB9sBtEvCvBzCrCNbtE_BvClBlExChCQrqD-9B3E4ClC4BNgCiByCByCxD8DV2CezKmSCwBpC8BB0DpBuClCLUqC0ByCX0CiC8BpBwB2B6D6C0EuFNJ6YIiG40BC0C
mHAAwMIoHkPkZAoYA6YAOmqCAgCjGrBjBctGqCvHsCvBuDpCO0J_YlDxDxEhB_B7BTlE1ClJWvCSrMrWfrFvCjG5DjD1C3ETxC9C3B7BxGExFkCpP5jBD6EbEEkDXmClDuCXwEY0E9COLtB5DJyB5BQ3DtDtDjDv
ElDTnF0DrCpBV5BlDlBFnBnGAboBvEInChB1BQnD2DhB2BvEb1B7CzBxFlClB7BVoEtCetlCqP_DhBlDvCvE5G7F9ChGM3BRUlCnDlCzCtC7HrCxBuBhBClBxBjFPctvBnXgB2B_BqEb0C1CiB1D0DqB-C8CT4BO
wDBtD2FImELkEvCgEc7EgiBU-C_DEAiEzCqC2CmIgI-FKkIuC2MqB2CxCkCDgCpC0BxB2JImCw-BqGuD-Y_L-Y9LM_8Q1TSrDPtCvBfyB7BD3BgBAtKjEiB9CN5DQ9ClBrD-BSgC4FZ4EPoCsB7C2CCsC9DgBsB4
B6DJuFfqBAuKYiB8EA4DzB0BGkBnCuDEH7B6CFiDpCpCvC_CqB5CHhCKjBjBtCNdyBhCdvCnEzBgBJ4BWqqgBo_LwNsBkMjDuOhGxBzFzNXtR4BrKuC5EuEvIoBoQqEO04B9K6PxD5BvCnjBtCsLmImFY2ENS-gH
zTwQJ0WpD9EzE_WGrKvBrMiEqDqEoImBO26B9E2P1BlHtC_JSzLuCwBiC0LdQn0BrM-FwC6HS8ItCYzBtJA5MWjBKe5xSktBmMkBwJCoB1B0DwB8FiBoJrBrCdtIZzFPbfnHhB5GwByD-B7NGGnqEjkFvLD1HYGl
TUuB4C0IgCKiK4EwGhB6CfV3BQxB0BwpGg0D-OwF1B6CgOqD0UgE6UmB2KqCmMaqEvClE9BjWhDjT_CrT9FpJjG5J_FoBlF-LjF1DRrUa1B6CpL0BbuDsGqBHuDuMqF3FYsB6uRp9DkC_FDjGyCpGoGhLlJiC7Dh
JkGrGFrE3E4DjE5EjBoFWiGX4GuB2EKsI1DmGSwI6F8CvC-C4Cc2BlEE7rC3nCbkBiCbkBBkDmDGesHzBsFqFmC0HjBmEkGkC6GuCqCoD0FpK7BrFtCvJAxC8FrHuE7KgCpCkGlC6DrC2C5DqGvFqCrJ8BpIF3Hj
BjFjDuDtBCvDvD_BzFzGC3C5I9DvHsC8Bn3C6uBtHPpDiC3DWjJtEnIf3FxB7HgB5FB3DmDjGgDnGc9Hb7FjB7I0ClB2ErH0B1FW_G0CtGvGwC1DhGpEhJyBlGGlE-CvGCvF-BvJ9C9LrFxGhBE50F1DtCPOxxHj
S5C1DhGhBnGtG2F9FTlE6GrHMnD1c1DvCjBzB3COnE6D3BGUxNK9DuB9ByC5FqB5DfhBmBvIgDnJgBnFiBZVUroB8J9HoFjHsCrF0DwEiBmFmFvDwCoJyCFqBzFfuB5K8WI6CmD4BiGOgBiCtBuDyCqDB6BnJiCz
DB7D8C5Ed7HmCEmBnC4C_EKP-ByBoB_DwDtGR9BKxBtBpCIiBloBofxBgEvBiCoBUgFHuCsB3B2BnEiBMkBxCmB7DiEqB2BR-CjGwBpDXbyBxGyBIxWuZ_B2DRgD_CuBKxFkI2CgC7B6FuE0DdkBGqEyMkHuDxG-
CYSsGsNgI6F0DsCmDnJoEwCiEzF2EoEsFpHiH6F4ExJkEcuEGoDy1BiFS0KwC2Q2PiDuGmCoK5DkRvB0XhH6E9COlE9GnDnK1B7b4EzEZmKxEO7CMtGiI7B8EzBagD3D2CgEsCiP7DoFwBlE0EyOkG6FL6FlC0Dq
ElF2DiD4DzE8DwR_ByDvD7HXAvD-EjC0JqByBgEiNgD6VsF2EJjG5D4HTuEkC4LGoJyCkH3DkHkExG0DoDiCuS7B2I_B0WjHmEqDrGoDDsBxHSiCgDrD8EDgCwL0FkE2F0EoByQzBoBvD7FhF8D_BgCrEtBxI-G5
D1ClEnM7IkHdwCoC8G0B2BiDsFgDzDyD-CkE7GQvBwDgFoGjIkFmLmEtBuEkDGoDvDtC_F2GlB7CwEwKwC-MKyLxDxFmFT2G8KoBiPHwNahFoDoHkEkHEmMkDwQakC4BsQSkFrBgOqDwLD4B2C-F2C4OyC4KhCvI
vBkOf2BhD2FwBqSBiOhDgFpCvBnD9G7BtQtD1E7B4HboJxB0FmBmD_D4CyBgKgBiUfwB9CkadM6EoNjBgKCiKpD8C_D1DzC6H9E8JvCgGyGiK5C0K2BkM9ByE4BoKbvE6FoI2Cu4BhEqF1DsQ5EoZmBuMfmFzCXx
E2H3BsIoBiLG6LnB8LW8KxF4HgChFgE4C6C-T3BgNMgS_CnhmC3CqP3EsQlGP9DmEvBtBwE-QdoM5FlG3CnKTFjGtCpB7FG3EmCpI6BtB4CpGgBjHZrDmCqBqCtHvB6C9CxDzC-pmCB_H3CjIQ0FpD4DlF8C1BYx
CzB1B1LsBtR1ExFXxJrEhJ5DpC7C9IqEpQ7E5CqC_F1CrIc_BjEvHhGGvCkHrBZjJ5FH1ClF0C3C9KlDlCjHpJvB7BrG_I5FpCqE1CkJvD8NiD2IoF2DK-C2JuBmL6H4KuGoLgFgF6IxHP3DlF7P7GjF2HjQjCzP
tKkF5D9N1B1JTQwE3JgB1HjDjTkBxU7BnUlM9X3O6JZiD7DiGtBgEkD8GLiJ7GGpF7EnGRtH5C_JrJhJjCpEvIpHtIlH_D1DpI1D9DB9DgDrIxEfhCUrnpBoMaIqFAgJ5BPbtGvBlILkjmCJhBgChimC0CMg2pB1
_E0ByBuErBgCFanBeFa6JtBCRiDvBsGMnBnC5GhBvIzDtDqBsB8C7G8BkBmBgGiCdYMtoWt2D-CQkEFGzB5GfNqCOuHyB-E5ChBtElBaEoD5CwCAWQvCtL8BHmClFAzDvBJxB0DrC4BsBgEUmqDzhPwH4DqFxB4D
wCgF5C7BlCtI7B5CmCpF5CjD6CkBk9Og2ZsCmCmJG8HlCyUzE1PvCvDxEtFlB_ClFxHHtN6D2FoCrJ4BlMqF5E8EgRoCuDlC8ICUi0CniC0CsE_HuC1JhChDzE_F3C1GwBjIJ9GqD5DzBkB1xBI5DHdjE5LgBzBv
D_FAjEtEnG9G1J3IoClClCtClGEhE7FMpIgElDhCpHlFpE3CxDsBh8BhgClE6DrMnHpItB1ImDlC2G_BuO4FiEwQmFsMwGuL2IgPiMwK2EkR8H4N4CoKLyJmFsLHmLoByTzEhIzB8G9DYsmDwkEnJrDlSXrSiBjB
2B_IE5G8CqT4BiJvBqG8B6PxBoMlCQ5Q5N9NvC_KuBoEyB3DgC-MqBwCrCgJtBoI3-N8d-U4D-VJgIqCiWU-xBZinB9EvLtC9XHzhBTkDjBkWW6SjCmM8BmFnC7GzD-PqCqeuC4SlBwD1CtZtExDtB_ThBwOJpHx
E_EhEG9GwHjE5JHnK9ByLpDuBpF1GRkIrF7NPmHvC_BnC5Id3IA8HnEC5CrM0ClD1BuIxBmI5DsChFlLlB5EuC1HyDkCnEnHnDuQJ0IJ3QtF_Q9EnSlC9GAtGrC1IzGtNrEpEHpIxB_ItBrF7DBrElDjElK_EwC7
E5ClFlDhG5ILlJiFvMChGuDlEiG5K6HlDiEb0FzI4FoC0ElEmCmGqHsJqCwC0CqB8ElHnCrDbzFdzHiCNoEuCqD6FE4M1B3K-DzFmClGblFyB-G6F5DqC9EqExH0G9HuCC0C3Q0DnNQ3QHlPPpHgC5K-DsQ-B0MM
3a0BjOwCcuC2XgD8WiDuCoC7QoCuFwC0VqEiJWxC6C6O0BmTgBmTC8G9ByQuD-OrC4INgNhC7OsDc2CSkzWp0ZgE_B-FZGjB3B7CzJLDqDeyCOqBSm-Kq4HYuBsFuBqEGgCasCZpC1BvG3CnF3BS7mVh7D-CkDwC
3BiBzC6CP-DlBqDQ0FmDAiXqBmW6X2Bd2D9FR5DsBlCwEUkD6C-C8ByBgDgDuB0CXgD3BkFJgEuBUgCiB-CuDQ8BsCiCkE0F2E6I0EKy7B4QyCBgDhBkCYqDTKgLfgD5I0BtEjB9GSnCSiEtWlDkB5BNR5B1BrCA
jC4DtD2DWoB6CEuBxF4EBqC4EBxBxEXlFzB5CnElDlBb1ClD3BlDxDvEhHtGrE3D3E7CvGtClDJZ3B5DehDlB5GoB3DZzCMtGvCpFf7DrC7CDzCoChCE3C4CHbb2BC2D_BmEgCkBF6EhE6FjDqFBAtEkIYhY7N3C
-B9CnBrDtCpD_D2E3EoCSkBgCwDgBiBiC8BgDjC8BkCn0Y22KtCvFhBvEPrIRhDiBrD-BhDoB5EkE1EwBxDuChD0G1ByCzCwF4B4EW2EkB-DiBgEwCwB2DQoFiB6BoE0B0GuBwFF6DQwBpBH_CpD1DvB5DkBjBd1
CxB7ExB0BpBDMo3BhuBlBBnC5DjBYXHCdenFpE5FC5FAAxD5CAqChCqCtBWrBgBLDjChIA_CjFclBVtBF5B2FpTtUhH4GnDgChF0BvDN_ErClDTrE2B1EmB7F8C1EchH8CnFgDxB2BvDMrG-BzC8C1GyDjD-DvBg
DiCUT6BuB0BAkChC6CRwCjCkDvFoGpG8E_C8DrFyCjByBe6DlDwB1DgDxBsErDQzDqD9CiDH-BrD2EnC6EEsCvEwCjCJxD4BfxCiB_CU1EkCxC0EpEiBtBeNalCkBEoBhE8BxBsBnC8DlDiC5F8B3C4B7CKpDiDF
wC7CoC5CDhBzCpCjBA1B6DhEyDvEiDlDyBGyEdsD_C-BnE6CbZxB0B5DwB3D0DQQyCLqCsCI6C5EuE1D4BpC8DpCkE7CgFxCyFSq4G33IgEWqG5EqCGuG_D8EvD0DnE3C9C4BxDQyalW3C9D_GtDzEoBtDV3F2Cn
EF5DuDe7HmyBoB0Dc2DAuDnCkBrCfpCIXuCR2FlB8BlE2BxClBzGmBOwI7BuD-BjW4iBgCqBTyD4B4CiB-EvB8DrD4BVuCe0D_LIrCqH6BCB2CnB8BHyDzD8B9DBzC6BlEoBvCqC_GiB3GyFQmEXuCU2ElIhBnDr
CvFvCrB7BnDFzESqB_mC25BvDhB7CWOwJjF1DxFGpCqDlEMsB2CvD6DzC0F2BkBA0C4D6BTsD0BmCO8CkHqEkFmBae2FJgBnCypB6CkRE4CfyD3CoCAyEyDiBoBVGuCzDUD-DmMFiCmC4B_BoB1DkBYqB6S2iBuD
pD8EOoB-B0EuByCgBY2CuE4BJqBpFSb-DImE5C0BmBS0EZgFxB6BwBwEe-GsCqCsCZ4BkBumB2YoDIuBtBZ1CkCfuB7C3BlCdpFyBlDO7C8D9CiDJWmBgCK6CiBgC2BwDRwBIQmazUsDPSoBfoBU6BwCR-CU0DpB
S0MyC2CnB-B2BsBJc3BgDOsCsC-B0E2D4FyD8RyLkCIyBtDwD9KsDfEpE1ElF-B7BiLdIpG4EkE6HnCsK5DiD1DftDoH-BmMpDqJIoJlFgI_G6E5BqFHoC9BkC_HiB3DvCrKlDhE5I1I9DhHzEtFxBD3BxEO3L3B
zJVjE9BtCjBrIrGjIhBvGhF1CtB3D5GA5JrCrE5C_G5BrH_EnFlGdzEgBvDjBpGtB_CrEtD9GhLvF9EnE9C5C9FjExDQ1oBj4EB-B5FmD5FE9K5B9CvFFrDvCvHUrnCoQ-D4G1CoFuBkCjBqCuCkDEqFKsEqBkCr
FiKmB7E5EpG0DPyCtMoGlL6G5E8DxCmFgB6BpFmIjGwL9FuMxC8C9B0E7EiEtEwCgC6C_C-F-BsEgFgEch-Bu9CWzC3BvBGpCyCQyCTyClDyDyCmBoE6DuFwHuC8GyG8BiEZ4Ec6eqU0BSmE9CgC9C8CzB2DxG0E
ZuD2BqChB4DQ4E7C_DrG8BFkDpDQAA1CwBhDiC5BfnFaxB4ClBDnGyDc5VyJZ-BqCQHkDuBoCkDO0C8DsCqDpCwBmB0DrB2FqB0BfqFvCqDMkGwkBaiDgCNmB8BtB0DYegBqDiJmDF4EsEyCUCiCkBqFyD8C-DEQ
qB-EP8EkDuCuBiDgDmCL0B1BlBhCgC0lBuT_DhBzBjDrC5B7BpCXtE3B1DoDNa5CsBrBQxCXpCGpByBPwBlCiIU0DZsErFwCWwELyDYoChBjBrDrBjCPvEoBjE4B7BIrBlDjDoCrB2BlC8BnGyB9oBvcjC6BpBsD
yB2BzBOjBiCjD4B3CNnBjCvCzBrBFTpB-CrD1BZbd9CJhB4DZhBhCMnBwCxCOzBW1CAFrBVeQ3foGKoBQqBHkBeYpBcAyCsCSgByCuIoCnCDrBwCHSQ4BvBiDO2CyB4DoBmC8BuDLHRwDH6ChBgC7BsC3BmBxCtI
tDuBnBqBYiBHsB3BwBtCoBlCaL6B1BkBO5BnBvBtB2B_BUbqBC8BagC3BcuBmBQlR-ReakE1BuBagCPgBpB8BLuBqBI6Md0BrDsCxC-CzCS5MelC-B9CyCpBiC1CgCjD6CWeiBdOOuBhK6L-BKauBeAFiDwBGqBB
qB2B8BnBUYmBYmC4BCoBUBawBUGiBdoBJsBayBAmCacckCDeia0MPTLrBWpCtBjCVvCF3CKzBG5CfTR1COzBnBzBI1BefGhazMhBgC7BQS9CwCOwCbWpBO3CVFa7BgBrBoB5BQM3JwGoB0BPmBQoB-C4B8CsCoBi
HmIUHsBiB4BEUPeK-CR8CEgCWYYgCLuBL2BEoBS6CbgBF-BjB6BtBoCd0B1BO2C1OVtBzDCnCUzCoBtDM5BsBMtOoCIckCyBmBYLWwBMIgGuZB9EPhH8BAIqB_LgCjBSc8BXKpHtNlDiB7DE7CoBrDyCYoL4dAdm
BAB1BhB3CSdTnCMRVlDnBzBjBHnBjCiCiqD_pBFvB1DXiC5CBnD3C1DqC9E4COsBwE9BmCJ4E4HyCZ-CmC-BoCrEsEDiEtDIhCyFB2GUyD5C6EXwD-BCyB4HMwHEpF7BkC9CgFP4EhDgB_EoDEuCtBSqoCpV9E1D
RnCkCrCvBjB7DfE9C1B1BoE3EOAAkEpC8DhEEnDsCDsDhDuClCSqQ_OfzF5DzBMtBlBnD6CxEgCAavD6DtFKAAwHnBWkBiFQ2G1BO-TpBnDrFQpEuC1DhB1CR7CxBzCKAAkCV0EvB0GnFgBxCK-3LkxI-CzBgJjB
lDpEXtEQgIvL3BhB5CSGxBxEvDD7CgDgBkC3CO9DlKH3B8BrClC7B0B7EsDXV3CK4DrO1FvDpM2BjJhCV3DM5bzHnHZhH8CnCrBvL6CvCuCcxe-FoD4DmBuMvGyGxEmDxJsCTyEiIsBwKzB_BkH-F1CyO8E8BkFu
FoBOybqwBelC8CD-CvCsE9CmDQwF7CG6TjKsBR6BEOmTjrBgEsCiBrFhC5E5CoBvBoEqBqCaxsR1_IqD0ErB4CrC9C3D4CoB6Bf0FkCemB-DsCgENyCuDqBoEwCS03CgpEmDRkBnBzBxB1EA1DFJ0CcekFAWxmCF
oERoDvBiB1BrED7BhBxDgBxDqCYsB0COuBF0CrdsdsFN-EB8FjCwCpC6FWoCtBoF7D-D5CiCC2DnBN5B0EH2ExCXtBjEZlEJpEQ_IRmEuDvC0BhEOjC6BvByDxDH5F2B7BqBjIelCoBsCyBlGKtEnDzCDbvBjDVz
CUoD-BsBoC6CsBmDmB4EUwBWUk6V_6I_D6C5Ee5BgEAmC1CWjH8G9B0DnBiBtCgFUhambgHViCVkCEuDiEuFkFoCQYmCyDuC2Eceqf-NOpCmFE-CpBqBxBgDNoD_BA9HnBpEH1EgB7BV1DdP1BxExGhHU5gC75BA
oSkGIGoW2EG0JmCsCxCgEuC8BAwDuBEsgBusBkBPcx2BnkC1E4EtCyErBiGxByEhC0JFuHXuDtCyCnDmFnDwHrB8DhFkGN6EU7cwmCiDmB2DiBiEF4D5CeOqZIsE_CkPbuLyCK4nCrBmFsBgEJwCtBAPMv5HwiGz
C6EhDoC4CmBgDsEwBoDSyB8PkCgCkDRgDsBwDCgD7BkEzB6DzEkEnEM6avJK9DmBxDsC3BQtCH9BOkEzNdJrDQPXrBDvEyB_CCK1NexLI1BVhCGpDfEzSnBf4Eef4E2FDwBckBCqCuB2CpB2CD4CuBpB4BhCf9BA
tCyB_BDtBvB3GDcmdmJiCkBiB2DgCEsE3BwDoBuCNeuBiZCsBsEhBa_C-a_CgbyJCQqtB2gCiVzNiVzNwB9C8D3B-ChBC9D-GUQu5BpkBAtOtDlEP5DxFfxIRnClC_DHgBpYta_DBzBoBtDd5FxClB9B7E5CbzBx
CnBhDa1BvBdpE9ElFEjC1BzCMzDUlkBvcxCdtBXd0C5BVjBEjB5B5EC3BeZRoBrQf9B4BM8BZYpBTIiCoByBxC0CV4BtBsBnBEvBb_BZ1BrB1CQ3B0BhBGzBZfAJoCEjEurDyXlPSxwBrmCRqD4BkDY8FVmGXiDU
kDzBgDnD2CE23D39BjFXQjFXxBqEKsOpBqBHiDjCmC9B6BaqDKhGsekCWqB4CiDSqB8BI6H8FkC6BoCC4EzDUkJ3BHhCuB3DnBvCW1BhD7D9B7BlB9DG_DLhKGikCwH5BLF_BqB_BrCjBDnE8GvBI7EvD5E6BrDM
5Bb1DG1D1CjDDzHmD9CvBlDCpCsCpGsC1GXzBrBbxD5BxCNxFOlrCrDGqEnHsBFiDvDiEZ6CQiDIoNktB6I4CiSqMuV8LIqwB-a8J1CwDtDuEqCoB0N1kCwCtCVlBJhCpF5EzB_DbnDrBrBnBrEpDxCdlDtBvCRz
CpEjCvD0CrCD3D1D5BB9C_FzBtEUvjBlwBvGnCrCKrCrB_EErD-DhCwErEkE3EBvFAYsqByQjDpGvBjBP7EUzCP7B-CnDSnCqCnD6C_BK5CU5BKyElgBNrD9EuBhF2B7HIKpSAZK1DZ5Dc9CNEnLBlKEOlKEc-Er
CkE7CiBnB6CzBeC2BEzwBkYhFpBUhFpBrBmC1B-DPkDsB0FxBqCR-EAwEzCoDO-BEvG6fwFDKwG5f5J1DtDjCzF5BzF6BMvY5FKuC3CsF2BiH0CoF1B8IOGgdZ2EEyD8KK4CNgCgB8CPOjQyE6CrBkBhC6CpBmCy
B-CIoEzBQ-PxhB5CDrEoB_DBrHjBrE3BlGpClBEUpe_DQmFSYFwCzC0C_BM5B4BqB4CTiDK6BUxE6UgBAM2CPoBUaqCaxBgFtByCQkCoBQSAA3BEpBvC3BAnBsBOwCxC6D1BVpBDalLwE3BLCqCd0BG6BrB0C3Bo
C_EAtBlB3BDhBrBV3BrD3CQ7SiD3C2DrCwCzBaxBoBV4CdsB5BgBS3LsN4CiD-BD0BiBsBAgBaRiCWWEkCOAArD0CzCOrB4BAe7BqBNsBMsuB3pB1BAtG-CzF4ErFuDlEiEKpXmPwBgCK6B8CsD8C-CMAA1BOvEw
CnDsDhBoCZ0EK66FxU_DMnEiB1DpDpD5FQomByduDvCAhCoEnDyC1C0B3D0EvCgB_BIroCpxCpCkC7BhBxC1CE3GzBjF0GiBjF0G6EuDrCkEkC0BmEYS4CqD_CwFH-B-CamEV8E_C2D4CoHxBoB1ER3BoDQ4CQAA
rGqGjEmF5DuGGiCsBgCwByEoB0EI_JmfkCMiJBAwHGAAlBemCgHSuxE__B-C5C0BpFhB1BpBhFoBlF_BjC7B5FqDzBG8Czd_SlFStEUx-BlWhE8DlEkFI8TiNBRkCesCjB-CYgDV-BgB-mCwlB3B3E4BjImCCoC_
B0CvEQhI1CpB9BpEhE8DNsEqB-CLwCtCyB3BRxDgD-BgkBwHgB5CHlGYvFI3JkBhD7BvEtCpE_D7D1FrChHhDhH1GrCjBrEtExCtBRvEgD1EmB1DE7BiBKFjGf9CwBhBdxCzCnCjFjCxHrD3CpCSzC0BNRnDGxzB
xmDR4Cb6CEp8D8iE1B2EoB5C9nCR-DcwFkC2FM2CgC0FwByCyDkEiC4CU0EJyD7BoC1B4DvB4DKqB-BwC9BgGnBmEjDgESmBIksDs6C4DP-ByDqDLE6pBm-GjB_BOjB_BnCcnBjEwBXxBZH1B-CcGbzFEtCjD_JG
_CtMT0BtDkJOhE4K4BiCLM0B8CoB4EeyBGCIsF2LiCASiB2BEIqEmBExCbdEBIpElBmCkFkDsEEIKuF4J6CLgBtCrDrCxBrDiD00CvmJ2B1CyBjEgBvH0B9CT_CjB5BjC2DlB7BmBzEPzC3BvBNnFtCpHhDzI7D5
LrC1I5CnHjFvBtFzCzDyB9EoC3BqDLyFlC-ETwEkBwE8CkBCiCgD4ES-DvBgDlB-DP4FmCwDc-DiDIwDqBqCkB4CCyDyDmF8D6BkDZ2C0CXuDqEG4DiC6CkC1CGv3Cs4IA5Db5BErnKn4Da6CUwkForDzCmL7DyC
BwBjF2DP4E6DwDwBkFf-FoBoDezGwpB6GwCsEXFlDqFqCOlBjDhDB7CmCxBZtFjEjDmBrDoDDyB_CsCdQmT5XL5E_C5B9B_BpErCWzCRzChDtBgB_9DniBAsHiK0EoGekF2BsCkDqHwCI0E0DQ6CqCmIiBkBuCzB
qBjC0GL6DrCgEY0oB-uBgGuD4GiB-DyCiG-ByKiBsKQkDb8FuC2GCyCtBoEMc6oCregCxFM7CjBjFQ5CZtDQ9DtCzC2DvEI1CoCvD8CkB-E7C4C9DGgkFgP-GvCoM2GEmTmEyCzHUyCzHnBdvMjDoGnGhChBhBjC
3EZvBnC1C9B_GgBExavRFcS-nD_fkBKI1B8EgBkFF6DFoEoE2EgE-D8DEicsLmBlCEmBlCc7EQc7ElDBRhEkBb5CnBAvC7BzCDvCKtH7NnBpB5SkDrCqGHuBOvb4MNyE2BqD4BW8B_BEzDrB1DG0DX3BN7BmBIpV
uhBoB5CRrBiC3EI4C9ItEDxB-CxFUGxLuDyEgGoEPMzwB4a8NwGqCyHRyEuDyBmD8DKoWiY2CgBoHZmCzBgDiBakPLiEtHkE7BO1DjDjCtB7EqE9F2HtDmD3EhBxEgCAEpDuDnDE4XntB1DKKvMlFzLQzRyMpJsE
vH2B6Bu9Bha6CpEuDnC0EZ2DjB6CzD2BhCoCZArBpC3Df3BzC_BpCnE7CKnBvBfjDYlERX7CA9DrCT_CtBpB7DAtCxBAvC_C3BtDSlEhC7CLGxU3zBhCsE7EqKI9G2O4SoGmEwM7CuEKuZksB6BkCaRTxCZlBK22
VlmI-DzDhCZjC4CI2BO1CsBb4BD4EgD7BgBhF1BapBLKpxMkuFtBwHgEoFiImB8FdIwQgNkFtC8CqEwFpCOwNNuBjEXvHvK5E4C5DxGNtFvCIhTlXlFcxCoDlDwGe9K0KxF8CrFDe8EvFAP7GrDjJhCxFOvEiEFy
C1FkBtFwDxD4DXoDnDM3CplBhCxChEXPoDjF2ChBjBS5MwBvCuChBiDpDyDhD-Cf1DlBwDW8D6BgGkBzJ2ViDuGuD6FtC2FC-CVwDlE-EvBkDmCmBoCuFvCkE_DyE_CwF0CkB6C4GuEI0D4C0DuBgB6JyhC2C9BK
3DoEJvBxGEzFyG4D8BjB2DGoBmC4EN4EhFMlGiFtFJpF_B5CGAAqBqCqFiEK0GsGSvBqDFdmHoDcamGsG0D7E6C1F4HBsCtF_D1B3BlCuH3DoFtH-DvF2EpEyBtEjBnGmBzWpuCR2E-B4EjC2DQ6GxCoD_BwHjB8
H3CmFjEjDhHvEvDS7DwBmC4HpB6F9EoHYoCzDatEiFIzmBkjCNiFmCfEwEe8ByIkDwBV0CuBkCIwG8EtB4CkFKiDuDoFDyDiIqEuEjBP8DmCkBNsCgBkd8mB0DQkC1D2CvBG5EHjF9FnFVrHyGgBwB3F-DlB5BlF
0ErC4CjByE6BGxCUoenkBsDyB-EBkGYqFqDgDpC2FlBdxD-CxCqGzBiB4kB1FrIpFlF9FrBpE6EzG6FjI2F7D6D_E6CxLZ_KlFjElHhEjFlF3H5FnCgE4BoE1EyDEiuEmhEAAcAArCM1CjC7BjCGvElDrBjBjBrC
5BjEf3C1BF3CVVwCfwD3COlPxWbvB1CNtEHtC5C3CGLRcxNrFhDmBXlB5BPHmBzBS1BgB2B4CwBYRkB0BsDNgBzDW_C2BU_L0NkFgE8GsDqEuE-C_BuFFfoD2J2CwCwDgEzDayZnIsFrHyBhEClHrCtD1FlB9ExC
zFRXsDmB2E3CyG0EgBnEsF8C9oCwmChD3EtElG0BxCyDYkGd6EqCiF_B0FrEVnC9EWhJZrE3BzEjEvJtCnGpDtGoBvDSnD_DgCtCgBhCrEhCvErDpHlCrJHhKjCpHrD3C-BxHAnJ4DjGepIb9MuB7GD1D2D5C4F7
DWxH-DtIcrHiBnC2CsCqHpEgF9IsClFqD1BsEsBh2EhuFpD-J1BBf9DtDmD-ByD4CM-CqFzDiB5FD9FcRqE_CM9E2ClCnEwEpD7DpCtBpC8D1BhB3DmC1EejF2C3WEbpCnEC1HnBK3EpD1D_IlE_GrH1E9DnGhEA
7CjDxBzFnC7CJ9B3EqBjIMlF1C9FAzKnDJ5C3E8BhC1F5BjCnEvC3B9F6F7C4IrCqGlC-CrDgGvB6HjB-D1FyIxCkM7BgIAyHlB8FjJ3DrEYjIyH-CoC5BuCpHqFqBpiEmKkEmE4NAnBqFvDmDV6EjE6C-GyGoHP
wGyG-DsGiGoGBuEqF0DhFkDlCmElCwFiD2CwJvB-GciGoFSs8B4pC2GpHThFwCnDFlDvEc4B7GkG_D2IrEcuUlhB9D5CtC7FiGpC8FhDkIxDyIX0DlD6ETyHtBmFCWwCZgEQ2CG6rBrO6DqBQ9EQqEzDGnB0FrC-
DgBqFNiFGQ6DxCgCSiS-CgFa2F0EoHgEoFxBuE0C-C7DjCzC4GdYmErsB5BoDJmDlBgDzC2D3FGSxC_BtDzCoBdjB3BWtCSMnWupBmE0EsD0BuEvBqDD4C1BUjwBgSyCwBiF9BqGhEwDbkC_C6EnBiF3CiHtBqHR
O5wCxoBzE0B5BuE7E4EvLjBjKD5IbS3pB2IsCoHgJoDR8C_CgBDwF_F4CvC4DjDqD6B9D2dwKlDoGe4DZoBsBsERkI0CGqFwDwD0EAW4B6EaqCRuC4BL4D2C6D-DyBtCkE-FF4BoCJsCkD0CVkDvB0C2D4C2GqBm
HYmDkB0DWIq5C0tB0E7C6B5EqKxCmB5tBE-BZwEgCiClBiC8C4DDecWyC2CmCsDtBV9B8BHRnFuChCmCqB6CU8D6CqEPuGAE2sB2BkB5BUl4CtvB2F2FPgE3EiBP-D_BgF0CuD1Ce2BwEyC6HWkCskBsGrC2EaqB
8C-EeyD8BmBgFqFmBgBoC-C1B8BFOo9B2cnC7B5GgBTxD6GO2H_B8LeM2QhFyB3FiCU4DtBFtCexDWkpBoSbtB7JrDlCtC_HXrC_DzGapElB_F_CctB3BtBWh3D7pBRoFzEIlHwF9EW9GmDtES3CjBlEEtExDvFl
BcxtB2JjBuEcwG7EkC0BqEjEKsBqF8FxBwFgCxE4D5ByD_ExBVzE9BiEKl5BFtDgFoB-B9BmHoE4BIE8PgBpCmD9CoEZEuIhGqCGOqCGqH0EsCO6B5BjCjD8DnDyBKO6O5CgCzE-FpBqEjD8IhB6J0BSwBgB8uC3
yC5L8B5GuB_Ga1C2H_CiB5EjBnG_C1HiCpG6E_F6BlE8FzEsIpDf_DiCpCtCGr_E67BT4EyByCWeqH2BsB2BsBKwDiCnB8G4BqDlBkFCoHqCqDDkHgBMu-BoSvC0DAe3CA7B2BpBFKtIiGtC6BzEyBSiDhBmCExH
0I2IgBS2IgBqBzBsCjBnBxBqDjC3B_B2C1B4ChBGpEKh4EkuFsIhD4JnEGzJiCtCmBsUrT3K5BhGpEgB7D9J_EhMrFxE5IuErEgGvD3FhHvGtBrCvKxD7FxHUxD9EnHJ_B-FlFiH3E8IeqxB92CrFL9BrBLjDvCU
zFJ1BuBpChBrCc7EE_GwBpGQ7EDrD1B_CHOzzBnDD4C9B-C4DoBCwC3BsCJ4CMJyOiGA6GqCuByDkFgCT4CG6S0K6DiB4GuCMqpCl1B_EPjE_B7FJrFrCKpDO7dhHbW3JyBNsC3FZpCtD7EzEI_XnE5CiB9Cf5Cm
BoBxIoB0BWiBkC4BgCPkBqBQUb2DF2BOlBWOclC0Bd0CnCgBOkC5C2BxCIzE-BjETvBdShKiRzCAxBtBzETjCd9CwB_DC7DW1CrBGtYjCN2BvD2BG9DsDoByC4B0BOgDmEsBLzB6C2FmFiDYW4BjDuFQAA9FsCvE
b9CU3DpBjDmCxCZLMUlXyC7CiDzEMR-BpEWdxBrDoBM4B1EQ9CiCO9XiKxCgEQkCxBsDpCmC4B2BtBmDOzFyQoE6B4J8C8HkCoGhBQvBgGBG61ByDmDVwB9BK9jB5mBPvCvDBmBpBhChEK7E9HlBhBtFDlDtBjFQ
M9OjC9I0BtBkCjGhBXlB5DcKhVsClDG5CkBeyBFiBYnF-D6BMmD3Bc2BwFJwEkBgDF-BnBUiBdiEoCaoC8COgZwI0E_BwDwCoCQ6E9B-CM8ClBGgV3BPZUlCK-jBvE5DpB9CnE5DlE_ElBGxP9K7DI5EzBK1IrBp
CdlFmB1E2C9BYGjO2DnBkChBCayCkKmDxBqCVoFYQoBwCGgDgBWN-CawBuBgCM2G7BqBUQqmCtQjB8CW0CF4CzD4D_B0C9B6B7BUKyInBGxBhDrB7BS3BvHSvG7J1DUxEqCpHvBjDxBlJK5EgBtCP3B0CU7kBqDl
BiBwBiBxBY9BrB1D6BPyC5DwBVgCrDuCE1IukCrBoFOrBoFmH-BwKNkGUcpBqDLgGhDOAAI2EiD-D8FkCgFzEgFEmB4EKsUgLsFkB2CXsFpCmFBSAAY2DpCX9DmCR0D8H4B8Hc6GfuGGWh6B3pB5CVzBYxBlBvEn
BpCxBxEpBiB7BWzCmDvByD1CI7hBtW3G-BnBrBpFCGpVkMK4CnBuBEdmEYmEMYmEhByG4DAyBsCyB2FjBkCO2E4QmBqBoFMkBrBoEiDtBsCHwDGkKoJ2EZgEeQ2IEErCqGvBBlCsGmBwD2BiHtC-C_BIw0DtmCnD
zCnCtEgCxDGvDzKrFarG9BM3LjBBjD1FTtEmC_E1BzEGG5ThDNkEjDgCQxDkGiBcVYiBgCqC-B_C2CRqCyBuBWuY7rBZ7B_IPCiBzHmBmB2CuDjC8EM0EPDhBsDYIhB6oBgD1B9B7DtBX0BLpG5DGpDUvHzBqExD
lDfvDAnDoDlBrBsB3DkD9CrCrBwD7CiD5BExD5F2B8BlD9DVqCvFjEBjF2CpCgFjBmEtC8ClDyDN6BK9kBtH-CgDKiCiCcE0BMuFyHiESuCsBsDDgBiBmBI6By-CrfpC8CsCqC5DRnFwBnEzDvJVhFqD3GItBzCp
EVhGqD5GD1DmGxEwDgD8E9D-C-GgG0JI0C4E-LZwHiEoH4BsKE8KtEgJrCoHesFRsHqDG4hB4jB2GIgGhDS10C-CWtCwF_BjBvBtHL1C9BlFrD_B-CEoBQhxB7OhBMDsBtDkCRgDQoEc-BhBgBK7EiOLgC2CiDMl
B2BSIsEuEqB1BwBTOnCIoDxEZjCc1C0CxBI_KqZwBtCgC3BrCrCckBxG7CsBpEBrFgB9CDpBpBnCuBpBxCiD9CsB9B6CpCuCrBqCzCyFrCE5C5NVhBaVhB7FqCzDoC3F8BlFyEoBQ7C0CDkC_De9B1C5BkCEkCGE
Szd8SsEFmBiBiChBwCDB4BmCUUyCgF0BUtU2IPxC3ChBzEapBvC_CHhBgBvDjChDH1CqBG3dwQUwD0BIE5TkKgFoBKgFoB0EP4FoBgE1CuDvBKAAoD2BwFmJyI0CmFFmBjtCl7BoC0ByCcyBhD2DAiBa0DH4BjD7
C1BB7EhBbH_C1CPwC3D1BjEkC5Bb3BpCpCShCe8J7dxCzBnDcnDVe8ER8D5CSvBsCQiEwCqCOwCqB4DD0CnBoCHkCS7J8dKuExC4C6IwE0HjBuIA0GhBmFMkKHoBkrC2DKzD9FjE_HrBRhC5DvDtChFuCxDzD5Cp
BhE3EnBtE5E7HB_FE9DnCrCpChDQpCkC3ByD5FgBSt5BonCiBvE3ExFhL1D7IeiFwGnDsGwI-E4E8CKxI8HoBpDnBrD8DC2EnBau7hBp8OkF7DoD7CrCvBtD2BvE6C_DqDjEsEbkC2CBwDjC4CjCgC3BM7WoiC4B
lCrECrC6D4DvBoBFO3CwFdjBzEsFpB4DkCAoC_EwC_CQlF1BtCF5DWpBeMwCkEfiCpBgBzBSxHyLwB_BInB9E2CrDoCrCiCeU8CvBkF7COzPoGwChCnBJ3CsBxCyCKiB4DzCoCu7DxuGrCrDjDnE5EvChB0BzCe0
DkFhCuD3GwCGoCwEmCiB6EHiExCmEGkB_CyC7EwF1CuEsCQsDvD8EzB4BxFyExGEoE6C1Be3EgF_BoEPyDsCmDXvBvF9B1D3EE1B7BS1CblB8BjtB5VqFqD6DoD4C0EsC0BeuDsE-CsB1CuBxCuEwC6BzCAzCpC7
CjEzElDvCqC_C5EDrFpC1BjEvDpG9E5CjD3B3FEhEiC3GOhBqCsD0E6HmGiEkBwEsCiBrpEmR4DLOtHjClCV_ElC2BpErEpBM5DG7DsFZkEzDuFE8CkERgGlCuDc8EmBgOzmE21BzGlDtFtBlBnDpCxCpFD9DRvF
kBvEVpEJ1DpD5BKlD5B9C9BzEGlEAzGgEpDmBE0DiDaiBuBFoCYqEV4DpDqGfyDIyDvCiED6B5CwCX-ExD-Eb0C4C1CjC6FkD5B6BtCBmDjD-ERgCvB8BWyDqByBakDT2DyCuEO3E2CqEiFkCiD0C4EqC6CQ4BZ-
EsC6DWesB0BSuDF0G8BsD4CyBqD2DmDKwCEsDsEqF0CrF2CoBnC-CgCiD4CrBY4EuDiDwBwCkDiBE4B4CXCyB4CeiDayE7CwD1D8DBgERpBuDgDgF6C0BfyB4CyD4DoCmDXqFmBDmDzEiCsDckExBqDxCoFxB6BU
8D9B0D6BsCRuBmB8ChD1BrDpCvClCFYvC7BjDlCjDO3BgFtD6E_BmDlCwE1D6BAoDxBe9BgGjCiEkCoBsDoB4CauD8BgFbgDO6BVyDa4EmBoBdiCwBqDmBuDE6BsCqC4BhDO7DyBXI1CoCjDQxDHnCoC9EgEsCkC
zC-CvCT3CsBrFehDyBZ2BpFTnDiCnE4GnDuE_CmE1CZvByD9DuC3GwCsBwC3CyBgBiBzGuE7D8CrC-EhF4B_EExDN7DgDpFLvFhB9C1BxFExDnBvE3C1FzEhDpC7EhChD7BrFrCjDxB1EZpEK_BzDjC9GH5FxC7C
tC3D1ClF6C5DiBeoDrDlBvFvErF2BxDgBxDOhG6BhE8DjB4EtBkDjDyC_FYiCgDvB0EhDpExFjBoDuDgB0DsCiDP0EhFpF9DjCrC_E7EyCGqD9DyEnDqCkBuB_H6DrEG_FgDnLRhInCjHhC9FMUn1Is4HdvGzC3B
tFtB_C-EhBgJ6CkKqEtD-CtEgDvGUitF4iClF-BDsFiD6C6G4B0DDsBrC3C3CtBzDrF_CqDs8C6nE1I5BzE9C3G1BsD8CpBuC-EmEpDqDtFnChHpE7DhEjGJlD7CqDnEkFfG5C-E5BgHuEyFtCiEDgBpD7I3B7Cr
DjGjDlDrE4GtDuCjG6D3FoE5EDzE7D1BuBrD2D9BdhFzB9EtDRzE5GhFlI3FtHzI3F1IpFhHV5D5CjCiCxDjD3IjDxGdlCzGtDLzByEuBsCrIgC9CfSvPjhD3D_J1CjFpDoFV2E0DkGiF4E6C7BhB5DG5iVoqEVh
DwB1C4Ca3F_EehFnCKhDX5BiClD8FjDkDlF-G_E8EAyBrB3BnB0FnCyE7BsFnDUlBlBnCtD-CtFgBzC_DwEpCXpDzCLpDpFzCPC-BoBqDsBqBtC0D9BmDxCY7B4C_DkB1CwCzEM7E8C3FiEnEyD9BmGjDYhFiC7C
bzD7CxCPWkFxuB4ESnC9Ee9BpBlD5EsCjDU3ImDcoDqHRsGUU5lBoRkD-B4DtEbnI7CMvChCrC0BHyHtByDuDJgBjB83CxCwDFsGiB2B4B8BwFMoC4BgF4BFlD7BhCY3BsDdvBrC7BWvEvE2BhDMgYmHgCjD3DhF
xGwDb0CmJiCIz8DjGoFI2G5DrDpE-Cgc5Kc0DlE8DBCxHkBvB2BoC6ChC2BrD9CLgGjDmDoCwG8EiFgFPyHQ1G3GsGc6GBzBhFzFzFuGLQV0FrHoEf8DjH4BtCyHlBX_DlD5BwCnDzFnDrICzK3B9CoBjE9C3FWr
ErCrDoBmJyG0FsBBA3JgB5BwCyG-BtDsDmBkEqJToBrnC0xCtBhEiHnEjI5E_RnEtFjBlIctRgCkG4CzNiDiLmBH8BjNuBoEiEwJe2JnEwJuD8H5BmKsDsKNUqqMh6EqDpDmDtE-CH8B1BjFPjB7EhBlCnCtBEjD
OxWvDyBgB0E5BsDLcYhDsD0BcMrV6Be0CxBoExDqCvDYpC-BMwvPn0FlD6EsFHmCnC1BrF1CiDYgL_QyB4BW8DuDMflE0EgGT9FnChC9B9D9B7B7DqEqB2B2B2X5JUjEMvDjC3FpCsG9CjDgCzE3B9CrH0D3ByE8
B-C9D-C9BxC_CIxEvDhB6BuCqF-D4BuDqCmC5C4E2BgB6CuEGL6EiF9CSlDOpCSnxB2FnI9FiDsEwE6D4DsEoDmGkBjFjEtDpDnEiCgY03BhBxCkCvEzBlF1DhCd_EsB_EqDV4CY6HvDTrDiCvBT7C7EiDpCoDzB
nC9D2D1FbjDsBKyC-B0B7BuBZnChDyDd4CH-FyChCU6JgC2F6DB8D3B8B0BUzBS7BvqBf-C4D9BgEADxC7C1C_D7BF-COmDc0V0E4B9G5E0BEhCyB7D_CtBHuE7BKf4D2DNBqC5D6EgGD2BrCoB_xEjlBuBR2D3D
0CnEMlEV5CUlCO1DoC1BuCxFDjCtEL9F0ErH-EXmDzDmEZmFnCsDWyErB0CQgvBpa0ElC6EmBoBqF2CmBwHqBuE-EkDgEMuc4P6CnDqBkCgDFK-DKkDY4H4F6EqEmD8EwCCmDlDK1CkE3BmF7BNtClEJkBhDzEjC
G3H3FuCqCqFuDEj0TigIuBSc45C49CpLP_KnClKpBzDsDhGiCsBkG_C2FgD0D0F-DqO4GmEqBT0C3IgDUtlCrqCcsB4CDmCUEUoBIMuBuBIgBkB6BCSimEn_F0DnH4B3FsD_CyI9FuDxDuDzD-BjCiD7BGmdjhB7
BvB1CQYxEfjCiCxC0D5CgCxBmCtFwCpECvBqB1DtB3D6C_B1EnHqBqCiuTwmF3FpGEtGrC_EiBjDnDrE_H9C9KL9IlHlEuCH2E7KrBrH_CpHBqGzElEzK_DzChDuCyB0F9D6BxCqE-F8BoD-DqGoDyEoEuM8B2Gn
BwGiLmE9CmJoGyDuC8D0HhBgH2CgE0GkBuD1IHhFgBiR8duE0CsB_GnJ1BvFnG5JqErD5G9GDbmGiD6E2GM6B0I8B8EqHvG6EjCsEpBYvsCzhCwD4DwDX0C0CyEpBajCxD5DxCgClDtBzB1DjE6BC-C4BrvPhpDv
E1BnB3CDjCnGzC_J9CxFtE3CJ7BM1DzC9DlBnFJxBLrBzB1BPdxBjDE_BZpEKzB0DGuDf6BnB0E5ByCqBKV8CYmBH4CexgC7B4CgCT0C0BiDyCzB2BSoHEkBTiGTsCKyBhC-CiBuEyG8F6CgSsCWojBosCuCrFiD
tBiBlCoEzCMxCTjCahC6B3BahCexBEySvYmBtC0B51B3zBZ0C7B-BPuClDoCrDoF3BkFpEoE5CiBjE-FXsEK2DzD-G7CuCrDqBjCyDMsB3BoD5BuBtC0E5DiFlDoEjDAgBuDImCYwCqBv7R_tSmDAqJsBuJrB2H1
C2C5DY1CIlD1J9BlKxB3LvBhNnB5OMlIkCiByCsN2BsFkC8D2C8CqC4DmCiEyCaluD5NiOFwNT0EyCqDmCwGxC7BlD5B5ChNc_NL5HiCAItD6ByBzvBm4BoEYoHH6BmDMqCDgFyD-C4FgBqDpCuBpC2C5CiC1C4B
7CY5CjBtC1BpCrHb_GlBlIEiDuCrHb9Gb3E8BLyC8GuCazxF7D-DiB-HbiJN8Gb6GY2DxD7EQzHH1HItILrGmBpD0CS5-DhLqBkCwHjBiIfwHkBxDlC7FzB1IQnGmCOjdoBwEqBoGtByJtC1DIhISxI4BW1jHjgB
4DsC2LfmG9B6EnC2B5C_LZlImC1DmCHM_D2B0iB5lDlmBMBwF0DoL9BYG0GgCaBYBiJxC8HyCuBMsSkB-FvB-CXuJhC4RzBiO9BkYtBgS2ByanBiP9BwQ8BsR2BsB-CzYIlUuBnFwC5QqBkB6CqCyCsCsCnByCtK
2B3EoC1J-BmPLuOgBiJjCkL8BqKqCgFiClCyChI4BlJ6B7MMnLcjMUhEqChI-B7EmC9BkHiDT0F9BoKU-JakF1C-JUqIsB6H2BkHiCsJUHqCjCsC6BmCiIkB2DjCyJoBmHyB-IEuIUuIwB4GqByHsB-ELoEPqJcs
IjByIEmIcuITqJT2IIiJDqJDyIIsG8ByHe8HpBuHiB4GmCgE9BmClCiEhCwG6BuHpCuIXoH1B6IKgIkBsJHuIb0IhBoD2C_DiChDoCjIOvDsCrBqClC0E4EZmILkIMqHfsG7B2ClCuILkIcyIoB2HWsGtBqIQsF4
EiF5CmHjB8HUkFtCmIHyHXwHpB8EqCuCmCoGtC0IUqGrBqEhCqIUwGqBsG0ByHc6IW-HckGsB2D-BuB2CVyC9BuCnCwC9BuCzBmCJuCSwC-CqCuCyCgBuClB2CXuCiD6CuD8BgEqCqE-BgF8BuC2CuD2B-D0BgGM
-D-BsEoBkFWyE0BwD-B-EY2DzBrChCpG5B3CrBzEgBjFTpEvBvExBhD5BbtCMrC-ChCnEvB7FNtDjC1D9B9D1CfpCoCzCqD9BkFtB4E_ByCtCsBpC6BtC-CjC8BpCa3F8BpCQtC-BvCbpDtDxCzDhCpIb5ClC5Dh
CtJpCpIf7HrBtIpB_EzChKF_KG9JNvKA-BvCyJhBgH3B-DlC_G9B5KU7IzBNxCHtCsHhCsBrC-HpCoNfoL1B-I9BsL_BwPdsP3B0K5B0LjCkG9CiDpCyHmCqK8B8K-BgN0BkL2ByPEoPb0MtBiE2C2I6B6PEsMsB
2LqBgNc6NkB2JyBtEoCzCmCAqCjMH7MfnMA3BsCc0E6CsB-IuByKwByH6B0H6B0FwCyIiBuIcoEQ2JImJa4HoByHwB8GuB2I-BwFkC8F6B6BuCxGwBmCyCkE-BwGoB8GuBsGgC8EuCiD-CyE4BuHLiDjCuHHIsCm
DuC4GTyBpCwHLiIkB8HWiHL2CxC8GiCsGkBiHcgHcsGuB-GgBuFqB4DoC2EzBuGcyE9CyDlCiHmB6CuCsG4BoILuCpCkFqC4GYqHG0GB-GX4GL-ChCiE7B6GkBsHIkHA-GEoGa0GYwF4B8FiBsGU4E4BuDsDyDkC
wGfuClCsFvBwGQuElC0EzBsGwBmC2C0FkBwGiCkGcqHmB-EsBkFuB8EsB8FX0FmCiE4B8FDmFuBmBoCoF2BkFoBoGe6FQuFL-FTgF1BU1CwFhC4D3BwHXkE1BmF1BgGLgFmBsFyC8FpBkGX8FXkGNoGAkFvGHzBX
5C9FxB9EpCcvC-GEZtClDpC9CxC4E_BoHRmHiBuDuCkCsCuD-B8D6ByBoCqDgD-DUkHImGYsGgBiDuC8BqCoEqCkG0BoFmBwDkCwDiByEgBmGT0FUkGY8GLyE2BmDmEqC1B-C_CoFlBgGPgGYsGP8FD-DUoFL4Er
B0Fc4GA4FcwGbmEkCkDiCqE2B6H2EiEb4E3BmElC-H5DkGD4FA4GY2GcmF2BoE8BgHI0EqB-ElBmD_BsE9B8GIoExBwHzB6HTwGQ8E-BmEgC0FQ0FbwGT8FgB0FAwFT4FT0FkB4GesGIkHA2FU2FQ2BiDIyC-D1B
iB5CkCzCyChCoFjBkHMmIE0FMmIA8FEmIHgHNuE_BnBpCiE5B2GvBgHzBiIhBuIfsGdkHFgEkCyF3B4E9BwFtB0HTmHXiDtCkHvB4ElCgHfmHE4GLuHEwHNgHbuGvBwGlBuE7BXtCpDlC5C5ClClC9CzClId1DnC
jIpB5CtCnErCvE9BzCxCxBpCT5CErCyDtCsBpC8ClC0LbwC1CpLfvJpB7LHpFxDhB9C1CpCpDrCqIhCmDxCsFpC0HhC2I_BsJ9BqO_BoDhDgSpBmBP0E5BqRyBqO9B4KvB_pmCAOyxpBitXOAeyBwED2F8BnEzCQ
lBU6HPVGlBNdELHBUPMlBC1BPlBKMAAEPrGxChDatBwC-CIgC3-Jn1CK-CsC2BiCoDNkCmCsEwDgEiCgB2B0DEsDoC6DkEqCgEsGECkDuC6FW-EoEkD2BoFmFzB6HuCsFaqDgEmEoG8C2EyCmEwG-B6D0EA4D1C-
FOwGrB2CBO0mI0DAgXAoW7BgF0B8Df2CqCgDciB67BoIEiG1BmG5B8Cf6EgCyC4ByFSuEZ2BjDuBiCgFvB8EJkDyBmB-8B9M3BvCpB3E1BnDvBhBhCgC5C6CvE-ITRyCzG8DnG2E3JqCrDiCxDyF7GnBjBIhEoHx
FkBpBqBtyE4WqHlC0CSoFhBoI3C-CxF0FnB6IzC2GhDiD0B-C8CtB4E-BiDwE-CqEauInBmC5CqCAgChBmGXyBhCS60E1sF1D4G7CwBhBwClDgD7DOkC0DqDEgB-BQisB-rBlC3CjC9CQ1BE9BuDDwBQuBjBO2Ch
KrBnCqCtDqC_CsCnCuUrHoFAK8BiLwB9BFxCxDvB0C3BEM3HnCpDWAAiCjBoBzC6CxCiDB-F0B4GYyF-BiDMoCmByDGGvvC3uC3D7BvBUMyCid0C2B-DrBiFuBsEA6D8CM7pCuiIoCAxB3CgDrCd9CtBJIqBrIlB
R_BtBdtDKyIrKaBIoB2DgBuBIGmGuCkCK8CEaAAHOYYWwBbAlBkBhBKZgBjBMdcjBJZjCvBNMnIwDQSrCqBhCUbc1BiBIxF5FpBQ3BgC1CoBEyF6FlBrBQjgQpoGyDaqBHHzElFVjBS6B4BDuC`,
    // [ISO numeric, name, ISO alpha-3, polygons as rings of arc indexes (~i is arc i reversed)]
    countries: [
      ["242","Fiji","FJI",[[[0]],[[1]]]],
      ["834","Tanzania","TZA",[[[2,3,4,5,6,7,8,9,10]]]],
      ["732","W. Sahara","ESH",[[[11,12,13,14]]]],
      ["124","Canada","CAN",[[[15,16,17,18]],[[19]],[[20]],[[21]],[[22]],[[23]],[[24]],[[25]],[[26]],[[27]],[[28]],[[29]],[[30]],[[31]],[[32]],[[33]],[[34]],[[35]],[[36]],[[37]],[[38]],[[39]],[[40]],[[41]],[[42]],[[43]],[[44]],[[45]],[[46]],[[47]]]],
      ["840","United States of America","USA",[[[-19,48,49,50]],[[51]],[[52]],[[53]],[[54]],[[55]],[[56]],[[57]],[[-17,58]],[[59]]]],
      ["398","Kazakhstan","KAZ",[[[60,61,62,63,64,65]]]],
      ["860","Uzbekistan","UZB",[[[-63,66,67,68,69]]]],
      ["598","Papua New Guinea","PNG",[[[70,71]],[[72]],[[73]],[[74]]]],
      ["360","Indonesia","IDN",[[[-72,75]],[[76,77]],[[78]],[[79,80]],[[81]],[[82]],[[83]],[[84]],[[85]],[[86]],[[87]],[[88]],[[89]]]],
      ["032","Argentina","ARG",[[[90,91]],[[92,93,94,95,96,97]]]],
      ["152","Chile","CHL",[[[-92,98]],[[99,-95,100,101]]]],
      ["180","Dem. Rep. Congo","COD",[[[-8,102,103,104,105,106,107,108,109,110,111]]]],
      ["706","Somalia","SOM",[[[112,113,114,115]]]],
      ["404","Kenya","KEN",[[[-3,116,117,118,-113,119]]]],
      ["729","Sudan","SDN",[[[120,121,122,123,124,125,126,127]]]],
      ["148","Chad","TCD",[[[-122,128,129,130,131]]]],
      ["332","Haiti","HTI",[[[132,133]]]],
      ["214","Dominican Rep.","DOM",[[[-133,134]]]],
      ["643","Russia","RUS",[[[135]],[[136]],[[137]],[[138]],[[139]],[[140]],[[141,142,143]],[[144]],[[145]],[[146,147,148,149,-66,150,151,152,153,154,155,156,157,158,159,160,161]],[[162]],[[163,164]]]],
      ["044","Bahamas","BHS",[[[165]],[[166]],[[167]]]],
      ["238","Falkland Is.","FLK",[[[168]]]],
      ["578","Norway","NOR",[[[169]],[[-161,170,171,172]],[[173]],[[174]]]],
      ["304","Greenland","GRL",[[[175]]]],
      ["260","Fr. S. Antarctic Lands","ATF",[[[176]]]],
      ["626","Timor-Leste","TLS",[[[177,-77]]]],
      ["710","South Africa","ZAF",[[[178,179,180,181,182,183,184],[185]]]],
      ["426","Lesotho","LSO",[[[-186]]]],
      ["484","Mexico","MEX",[[[-50,186,187,188,189]]]],
      ["858","Uruguay","URY",[[[190,191,-93]]]],
      ["076","Brazil","BRA",[[[-191,-98,192,193,194,195,196,197,198,199,200]]]],
      ["068","Bolivia","BOL",[[[-194,201,-96,-100,202]]]],
      ["604","Peru","PER",[[[-195,-203,-102,203,204,205]]]],
      ["170","Colombia","COL",[[[-196,-206,206,207,208,209,210]]]],
      ["591","Panama","PAN",[[[-209,211,212,213]]]],
      ["188","Costa Rica","CRI",[[[-213,214,215,216]]]],
      ["558","Nicaragua","NIC",[[[-216,217,218,219]]]],
      ["340","Honduras","HND",[[[-219,220,221,222,223]]]],
      ["222","El Salvador","SLV",[[[-222,224,225]]]],
      ["320","Guatemala","GTM",[[[-189,226,227,-223,-226,228]]]],
      ["084","Belize","BLZ",[[[-188,229,-227]]]],
      ["862","Venezuela","VEN",[[[-197,-211,230,231]]]],
      ["328","Guyana","GUY",[[[-198,-232,232,233]]]],
      ["740","Suriname","SUR",[[[-199,-234,234,235]]]],
      ["250","France","FRA",[[[-200,-236,236]],[[237,238,239,240,241,242,243,244]],[[245]]]],
      ["218","Ecuador","ECU",[[[-205,246,-207]]]],
      ["630","Puerto Rico","PRI",[[[247]]]],
      ["388","Jamaica","JAM",[[[248]]]],
      ["192","Cuba","CUB",[[[249]]]],
      ["716","Zimbabwe","ZWE",[[[-181,250,251,252]]]],
      ["072","Botswana","BWA",[[[-180,253,254,-251]]]],
      ["516","Namibia","NAM",[[[-179,255,256,257,-254]]]],
      ["686","Senegal","SEN",[[[258,259,260,261,262,263,264]]]],
      ["466","Mali","MLI",[[[-261,265,266,267,268,269,270]]]],
      ["478","Mauritania","MRT",[[[-13,271,-266,-260,272]]]],
      ["204","Benin","BEN",[[[273,274,275,276,277]]]],
      ["562","Niger","NER",[[[-131,278,279,-277,280,-268,281,282]]]],
      ["566","Nigeria","NGA",[[[-278,-280,283,284]]]],
      ["120","Cameroon","CMR",[[[-130,285,286,287,288,289,-284,-279]]]],
      ["768","Togo","TGO",[[[-275,290,291,292]]]],
      ["288","Ghana","GHA",[[[-292,293,294,295]]]],
      ["384","Côte d'Ivoire","CIV",[[[-270,296,-295,297,298,299]]]],
      ["324","Guinea","GIN",[[[-262,-271,-300,300,301,302,303]]]],
      ["624","Guinea-Bissau","GNB",[[[-263,-304,304]]]],
      ["430","Liberia","LBR",[[[-299,305,306,-301]]]],
      ["694","Sierra Leone","SLE",[[[-302,-307,307]]]],
      ["854","Burkina Faso","BFA",[[[-269,-281,-276,-293,-296,-297]]]],
      ["140","Central African Rep.","CAF",[[[-108,308,-286,-129,-121,309]]]],
      ["178","Congo","COG",[[[-107,310,311,312,-287,-309]]]],
      ["266","Gabon","GAB",[[[-288,-313,313,314]]]],
      ["226","Eq. Guinea","GNQ",[[[-289,-315,315]]]],
      ["894","Zambia","ZMB",[[[-7,316,317,-252,-255,-258,318,-103]]]],
      ["454","Malawi","MWI",[[[-6,319,-317]]]],
      ["508","Mozambique","MOZ",[[[-5,320,-184,321,-182,-253,-318,-320]]]],
      ["748","eSwatini","SWZ",[[[-183,-322]]]],
      ["024","Angola","AGO",[[[-106,322,-311]],[[-104,-319,-257,323]]]],
      ["108","Burundi","BDI",[[[-9,-112,324]]]],
      ["376","Israel","ISR",[[[325,326,327,328,329,330,331]]]],
      ["422","Lebanon","LBN",[[[-331,332,333]]]],
      ["450","Madagascar","MDG",[[[334]]]],
      ["275","Palestine","PSE",[[[-327,335]]]],
      ["270","Gambia","GMB",[[[-265,336]]]],
      ["788","Tunisia","TUN",[[[337,338,339]]]],
      ["012","Algeria","DZA",[[[-12,340,341,-338,342,-282,-267,-272]]]],
      ["400","Jordan","JOR",[[[-326,343,344,345,346,-328,-336]]]],
      ["784","United Arab Emirates","ARE",[[[347,348,349,350,351]]]],
      ["634","Qatar","QAT",[[[352,353]]]],
      ["414","Kuwait","KWT",[[[354,355,356]]]],
      ["368","Iraq","IRQ",[[[-345,357,358,359,360,-357,361]]]],
      ["512","Oman","OMN",[[[-351,362,363,364]],[[-349,365]]]],
      ["548","Vanuatu","VUT",[[[366]],[[367]]]],
      ["116","Cambodia","KHM",[[[368,369,370,371]]]],
      ["764","Thailand","THA",[[[-369,372,373,374,375,376]]]],
      ["418","Laos","LAO",[[[-370,-377,377,378,379]]]],
      ["104","Myanmar","MMR",[[[-376,380,381,382,383,-378]]]],
      ["704","Vietnam","VNM",[[[-371,-380,384,385]]]],
      ["408","North Korea","PRK",[[[386,386,386]],[[-147,387,388,389,390]]]],
      ["410","South Korea","KOR",[[[-389,391]]]],
      ["496","Mongolia","MNG",[[[-149,392]]]],
      ["356","India","IND",[[[-383,393,394,395,396,397,398,399,400]]]],
      ["050","Bangladesh","BGD",[[[-382,401,-394]]]],
      ["064","Bhutan","BTN",[[[-400,402]]]],
      ["524","Nepal","NPL",[[[-398,403]]]],
      ["586","Pakistan","PAK",[[[-396,404,405,406,407]]]],
      ["004","Afghanistan","AFG",[[[-69,408,409,-407,410,411]]]],
      ["762","Tajikistan","TJK",[[[-68,412,413,-409]]]],
      ["417","Kyrgyzstan","KGZ",[[[-62,414,-413,-67]]]],
      ["795","Turkmenistan","TKM",[[[-64,-70,-412,415,416]]]],
      ["364","Iran","IRN",[[[-360,417,418,419,420,421,-416,-411,-406,422]]]],
      ["760","Syria","SYR",[[[-332,-334,423,424,-358,-344]]]],
      ["051","Armenia","ARM",[[[-420,425,426,427,428]]]],
      ["752","Sweden","SWE",[[[-172,429,430]]]],
      ["112","Belarus","BLR",[[[-156,431,432,433,434]]]],
      ["804","Ukraine","UKR",[[[-155,435,-164,436,437,438,439,440,441,442,-432]]]],
      ["616","Poland","POL",[[[-433,-443,443,444,445,446,-142,447]]]],
      ["040","Austria","AUT",[[[448,449,450,451,452,453,454]]]],
      ["348","Hungary","HUN",[[[-441,455,456,457,458,-449,459]]]],
      ["498","Moldova","MDA",[[[-439,460]]]],
      ["642","Romania","ROU",[[[-438,461,462,463,-456,-440,-461]]]],
      ["440","Lithuania","LTU",[[[-434,-448,-144,464,465]]]],
      ["428","Latvia","LVA",[[[-157,-435,-466,466,467]]]],
      ["233","Estonia","EST",[[[-158,-468,468]]]],
      ["276","Germany","DEU",[[[-446,469,-453,470,-238,471,472,473,474,475,476]]]],
      ["100","Bulgaria","BGR",[[[-463,477,478,479,480,481]]]],
      ["300","Greece","GRC",[[[482]],[[-480,483,484,485,486]]]],
      ["792","Turkey","TUR",[[[-359,-425,487,488,-427,-418]],[[-479,489,-484]]]],
      ["008","Albania","ALB",[[[-486,490,491,492,493]]]],
      ["191","Croatia","HRV",[[[-458,494,495,496,497,498]]]],
      ["756","Switzerland","CHE",[[[-452,499,-239,-471]]]],
      ["442","Luxembourg","LUX",[[[-472,-245,500]]]],
      ["056","Belgium","BEL",[[[-473,-501,-244,501,502]]]],
      ["528","Netherlands","NLD",[[[-474,-503,503]]]],
      ["620","Portugal","PRT",[[[504,505]]]],
      ["724","Spain","ESP",[[[-505,506,-242,507]]]],
      ["372","Ireland","IRL",[[[508,509]]]],
      ["540","New Caledonia","NCL",[[[510]]]],
      ["090","Solomon Is.","SLB",[[[511]],[[512]],[[513]],[[514]],[[515]]]],
      ["554","New Zealand","NZL",[[[516]],[[517]]]],
      ["036","Australia","AUS",[[[518]],[[519]]]],
      ["144","Sri Lanka","LKA",[[[520]]]],
      ["156","China","CHN",[[[521]],[[-61,-150,-393,-148,-391,522,-385,-379,-384,-401,-403,-399,-404,-397,-408,-410,-414,-415]]]],
      ["158","Taiwan","TWN",[[[523]]]],
      ["380","Italy","ITA",[[[-451,524,525,-240,-500]],[[526]],[[527]]]],
      ["208","Denmark","DNK",[[[-476,528]],[[529]]]],
      ["826","United Kingdom","GBR",[[[-510,530]],[[531]]]],
      ["352","Iceland","ISL",[[[532]]]],
      ["031","Azerbaijan","AZE",[[[-152,533,-421,-429,534]],[[-419,-426]]]],
      ["268","Georgia","GEO",[[[-153,-535,-428,-489,535]]]],
      ["608","Philippines","PHL",[[[536]],[[537]],[[538]],[[539]],[[540]],[[541]],[[542]]]],
      ["458","Malaysia","MYS",[[[-374,543]],[[-81,544,545,546]]]],
      ["096","Brunei","BRN",[[[-546,547]]]],
      ["705","Slovenia","SVN",[[[-450,-459,-499,548,-525]]]],
      ["246","Finland","FIN",[[[-160,549,-430,-171]]]],
      ["703","Slovakia","SVK",[[[-442,-460,-455,550,-444]]]],
      ["203","Czechia","CZE",[[[-445,-551,-454,-470]]]],
      ["232","Eritrea","ERI",[[[-126,551,552,553]]]],
      ["392","Japan","JPN",[[[554]],[[555]],[[556]]]],
      ["600","Paraguay","PRY",[[[-193,-97,-202]]]],
      ["887","Yemen","YEM",[[[-364,557,558]]]],
      ["682","Saudi Arabia","SAU",[[[-346,-362,-356,559,-354,560,-352,-365,-559,561]]]],
      ["010","Antarctica","ATA",[[[562]],[[563]],[[564]],[[565]],[[566]],[[567]],[[568]],[[569]]]],
      ["","N. Cyprus","",[[[570,571]]]],
      ["196","Cyprus","CYP",[[[-572,572]]]],
      ["504","Morocco","MAR",[[[-341,-15,573]]]],
      ["818","Egypt","EGY",[[[-124,574,575,-329,576]]]],
      ["434","Libya","LBY",[[[-123,-132,-283,-343,-340,577,-575]]]],
      ["231","Ethiopia","ETH",[[[-114,-119,578,-127,-554,579,580]]]],
      ["262","Djibouti","DJI",[[[-553,581,582,-580]]]],
      ["","Somaliland","",[[[-115,-581,-583,583]]]],
      ["800","Uganda","UGA",[[[-11,584,-110,585,-117]]]],
      ["646","Rwanda","RWA",[[[-10,-325,-111,-585]]]],
      ["070","Bosnia and Herz.","BIH",[[[-496,586,587]]]],
      ["807","Macedonia","MKD",[[[-481,-487,-494,588,589]]]],
      ["688","Serbia","SRB",[[[-457,-464,-482,-590,590,591,-587,-495]]]],
      ["499","Montenegro","MNE",[[[-492,592,-497,-588,-592,593]]]],
      ["","Kosovo","XKX",[[[-493,-594,-591,-589]]]],
      ["780","Trinidad and Tobago","TTO",[[[594]]]],
      ["728","S. Sudan","SSD",[[[-109,-310,-128,-579,-118,-586]]]],
    ],
    land: [[[0]],[[1]],[[3,320,184,255,323,104,322,311,313,315,289,284,273,290,293,297,305,307,302,304,263,336,258,272,13,573,341,338,577,575,329,332,423,487,535,153,435,164,436,461,477,489,484,490,592,497,548,525,240,507,505,506,242,501,503,474,528,476,446,142,464,466,468,158,549,430,172,161,387,391,389,522,385,371,372,543,374,380,401,394,404,422,360,354,559,352,560,347,365,349,362,557,561,346,576,124,551,581,583,115,119],[421,416,64,150,533]],[[17,48,186,229,227,223,219,216,213,209,230,232,234,236,200,191,93,100,203,246,207,211,214,217,220,224,228,189,50,15,58]],[[19]],[[20]],[[21]],[[22]],[[23]],[[24]],[[25]],[[26]],[[27]],[[28]],[[29]],[[30]],[[31]],[[32]],[[33]],[[34]],[[35]],[[36]],[[37]],[[38]],[[39]],[[40]],[[41]],[[42]],[[43]],[[44]],[[45]],[[46]],[[47]],[[51]],[[52]],[[53]],[[54]],[[55]],[[56]],[[57]],[[59]],[[70,75]],[[72]],[[73]],[[74]],[[77,177]],[[78]],[[546,79,544,547]],[[81]],[[82]],[[83]],[[84]],[[85]],[[86]],[[87]],[[88]],[[89]],[[90,98]],[[133,134]],[[135]],[[136]],[[137]],[[138]],[[139]],[[140]],[[144]],[[145]],[[162]],[[165]],[[166]],[[167]],[[168]],[[169]],[[173]],[[174]],[[175]],[[176]],[[245]],[[247]],[[248]],[[249]],[[334]],[[366]],[[367]],[[482]],[[508,530]],[[510]],[[511]],[[512]],[[513]],[[514]],[[515]],[[516]],[[517]],[[518]],[[519]],[[520]],[[521]],[[523]],[[526]],[[527]],[[529]],[[531]],[[532]],[[536]],[[537]],[[538]],[[539]],[[540]],[[541]],[[542]],[[554]],[[555]],[[556]],[[562]],[[563]],[[564]],[[565]],[[566]],[[567]],[[568]],[[569]],[[570,572]],[[594]]],
  };
  /* geo-data:end */

  // ---------- Vectors on the unit sphere ----------
  const vec = p => { const l = p[0] * RAD, f = p[1] * RAD, c = cos(f); return [c * cos(l), c * sin(l), sin(f)]; };
  const toLL = v => [atan2(v[1], v[0]) * DEG, asin(clamp1(v[2])) * DEG];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = v => { const n = hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
  const nlerp = (a, b, t) => unit([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  function slerp(a, b, t) {
    const d = acos(clamp1(dot(a, b))), s = sin(d);
    if (s < 1e-12) return t < 0.5 ? a.slice() : b.slice();
    const ka = sin((1 - t) * d) / s, kb = sin(t * d) / s;
    return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
  }
  // Where the great-circle step from a to b first changes side(v): bisection, accurate to about 1 m.
  function crossing(a, b, side) {
    const sa = side(a);
    let lo = 0, hi = 1;
    for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (side(nlerp(a, b, m)) === sa) lo = m; else hi = m; }
    return nlerp(a, b, (lo + hi) / 2);
  }

  // ---------- Places ----------
  // A point is [lon, lat] in degrees (GeoJSON order), an object with lon and lat (cities), or a city name.
  function ll(p) {
    if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) return [p[0], p[1]];
    if (typeof p === "string") {
      const c = city(p);
      if (!c) throw new Error(`Geo: unknown place "${p}". Use [lon, lat] or a name from Geo.cities.`);
      return [c.lon, c.lat];
    }
    if (p && typeof p === "object") {
      const lon = p.lon ?? p.lng ?? p.longitude, lat = p.lat ?? p.latitude;
      if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon, lat];
    }
    throw new Error(`Geo: expected [lon, lat], {lon, lat}, or a city name, got ${JSON.stringify(p)}`);
  }

  // Great-circle distance in km (haversine).
  function distance(a, b) {
    a = ll(a); b = ll(b);
    const f1 = a[1] * RAD, f2 = b[1] * RAD, df = f2 - f1, dl = (b[0] - a[0]) * RAD;
    const h = sin(df / 2) ** 2 + cos(f1) * cos(f2) * sin(dl / 2) ** 2;
    return 2 * R_KM * asin(min(1, sqrt(h)));
  }
  // The point a fraction t of the way along the great circle from a to b.
  const interpolate = (a, b, t) => toLL(slerp(vec(ll(a)), vec(ll(b)), t));
  // n + 1 points along the great circle from a to b, ends included.
  function greatCircle(a, b, n) {
    const va = vec(ll(a)), vb = vec(ll(b));
    n ??= max(1, ceil(acos(clamp1(dot(va, vb))) * DEG));
    return Array.from({ length: n + 1 }, (_, i) => toLL(slerp(va, vb, i / n)));
  }
  // Initial bearing from a toward b, degrees clockwise from north, in [0, 360).
  function bearing(a, b) {
    a = ll(a); b = ll(b);
    const f1 = a[1] * RAD, f2 = b[1] * RAD, dl = (b[0] - a[0]) * RAD;
    const th = atan2(sin(dl) * cos(f2), cos(f1) * sin(f2) - sin(f1) * cos(f2) * cos(dl));
    return (th * DEG + 360) % 360;
  }
  // The point reached by going km along a great circle from a, starting on the given bearing.
  function destination(a, brg, km) {
    a = ll(a);
    const f1 = clamp(a[1], -89.999999, 89.999999) * RAD, l1 = a[0] * RAD, th = brg * RAD, d = km / R_KM;
    const f2 = asin(clamp1(sin(f1) * cos(d) + cos(f1) * sin(d) * cos(th)));
    const l2 = l1 + atan2(sin(th) * sin(d) * cos(f1), cos(d) - sin(f1) * sin(f2));
    return [wrap180(l2 * DEG), f2 * DEG];
  }
  const midpoint = (a, b) => interpolate(a, b, 0.5);
  // A ring of points km from the center, clockwise seen from above, so the cap is on its right.
  function circlePoints(c, km, n = 128) {
    c = ll(c);
    km = clamp(km, 1e-6, PI * R_KM - 1e-3);
    const out = [];
    for (let i = 0; i < n; i++) out.push(destination(c, (360 * i) / n, km));
    out.push(out[0]);
    return out;
  }

  // ---------- Rings ----------
  // Straight lines in lon/lat (the data's convention), split into steps of at most `step` degrees.
  function densify(pts, step = 1) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [l0, f0] = pts[i - 1], [l1, f1] = pts[i];
      const dl = wrap180(l1 - l0), df = f1 - f0, n = ceil(max(abs(dl), abs(df)) / step);
      for (let k = 1; k < n; k++) out.push([wrap180(l0 + (dl * k) / n), f0 + (df * k) / n]);
      out.push(pts[i]);
    }
    return out;
  }
  // A ring as a closed curve in the plane of unwrapped longitude and latitude. A ring that goes once
  // round a pole is closed through the pole on its right-hand side (the data puts a ring's inside on
  // its right, so Antarctica closes through the south pole).
  function planar(pts) {
    const n = pts.length, xs = [pts[0][0]], ys = [pts[0][1]];
    for (let i = 1; i < n; i++) { xs.push(xs[i - 1] + wrap180(pts[i][0] - pts[i - 1][0])); ys.push(pts[i][1]); }
    const net = xs[n - 1] - xs[0] + wrap180(pts[0][0] - pts[n - 1][0]);
    let pole = 0;
    if (abs(net) > 180) {
      pole = net > 0 ? -90 : 90;
      const end = xs[0] + net;
      xs.push(end, end, xs[0]); ys.push(ys[0], pole, pole);
    }
    return { xs, ys, pole, x0: min(...xs), x1: max(...xs), y0: min(...ys), y1: max(...ys) };
  }
  function inside(xs, ys, x, y) {
    let c = false;
    for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
      if ((ys[i] > y) !== (ys[j] > y) && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) c = !c;
    }
    return c;
  }
  function makeRing(raw, dense) {
    let P = null;
    const plane = () => (P ??= planar(raw));
    return {
      raw, dense,
      contains(q) {
        const r = plane();
        if (q[1] < r.y0 || q[1] > r.y1) return false;
        for (let k = -1; k <= 1; k++) {
          const x = q[0] + 360 * k;
          if (x >= r.x0 && x <= r.x1 && inside(r.xs, r.ys, x, q[1])) return true;
        }
        return false;
      },
      // Area on the unit sphere enclosed by the planar curve (sign follows its direction).
      area() {
        const { xs, ys } = plane();
        let s = 0;
        for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) s -= (xs[i] - xs[j]) * RAD * (sin(ys[i] * RAD) + sin(ys[j] * RAD)) / 2;
        return s;
      },
      // A point inside the ring for its label: the centroid when it falls inside (by inside(), which can
      // also exclude holes), else the middle of the widest stretch across it, preferring the centroid's latitude.
      labelPoint(inside = q => this.contains(q)) {
        const c = this.centroid();
        if (inside(c)) return c;
        const { xs, ys, y0, y1 } = plane();
        let best = null, bw = -Infinity;
        for (let k = 1; k < 24; k++) {
          const y = y0 + ((y1 - y0) * k) / 24, cut = [];
          for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) if ((ys[i] > y) !== (ys[j] > y)) cut.push(xs[i] + ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]));
          cut.sort((a, b) => a - b);
          for (let i = 0; i + 1 < cut.length; i += 2) {
            const q = [wrap180((cut[i] + cut[i + 1]) / 2), y], w = (cut[i + 1] - cut[i]) * cos(y * RAD) - abs(y - c[1]) * 0.25;
            if (w > bw && inside(q)) { bw = w; best = q; }
          }
        }
        return best ?? c;
      },
      centroid() {
        const { xs, ys } = plane();
        let a = 0, cx = 0, cy = 0;
        for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
          const w = xs[j] * ys[i] - xs[i] * ys[j];
          a += w; cx += (xs[j] + xs[i]) * w; cy += (ys[j] + ys[i]) * w;
        }
        return abs(a) < 1e-12 ? [xs[0], ys[0]] : [wrap180(cx / (3 * a)), cy / (3 * a)];
      },
    };
  }

  // ---------- The world: decoded from DATA on first use ----------
  const COUNTRY_ALIASES = {
    "United States of America": ["United States", "US", "America"],
    "United Kingdom": ["UK", "Britain", "Great Britain"],
    "Russia": ["Russian Federation"],
    "Dem. Rep. Congo": ["Democratic Republic of the Congo", "DR Congo", "DRC", "Congo Kinshasa"],
    "Congo": ["Republic of the Congo", "Congo Brazzaville"],
    "Central African Rep.": ["Central African Republic", "CAR"],
    "Dominican Rep.": ["Dominican Republic"],
    "Eq. Guinea": ["Equatorial Guinea"],
    "Bosnia and Herz.": ["Bosnia and Herzegovina", "Bosnia"],
    "Solomon Is.": ["Solomon Islands"],
    "Falkland Is.": ["Falkland Islands"],
    "Fr. S. Antarctic Lands": ["French Southern and Antarctic Lands"],
    "W. Sahara": ["Western Sahara"],
    "S. Sudan": ["South Sudan"],
    "N. Cyprus": ["Northern Cyprus"],
    "Côte d'Ivoire": ["Ivory Coast"],
    "Czechia": ["Czech Republic"],
    "Macedonia": ["North Macedonia"],
    "eSwatini": ["Swaziland"],
    "Timor-Leste": ["East Timor"],
    "Myanmar": ["Burma"],
    "South Korea": ["Korea", "Republic of Korea"],
    "North Korea": ["DPRK"],
    "Vietnam": ["Viet Nam"],
    "Turkey": ["Türkiye"],
    "Laos": ["Lao PDR"],
    "United Arab Emirates": ["UAE"],
    "Netherlands": ["Holland", "The Netherlands"],
  };
  let W = null;
  function world() {
    if (W) return W;
    const code = {};
    for (let i = 0; i < 64; i++) code["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[i]] = i;
    const s = DATA.arcs.replace(/\s+/g, "");
    let pos = 0;
    const int = () => {
      let z = 0, m = 1, c;
      do { c = code[s[pos++]]; z += (c & 31) * m; m *= 32; } while (c & 32);
      return z % 2 ? -(z + 1) / 2 : z / 2;
    };
    const arcs = [];
    for (let a = 0, n = int(), x0 = 0, y0 = 0; a < n; a++) {
      const len = int();
      let x = (x0 += int()), y = (y0 += int());
      const pts = [[x / 100, y / 100]];
      for (let i = 1; i < len; i++) { x += int(); y += int(); pts.push([x / 100, y / 100]); }
      arcs.push(pts);
    }
    const dense = arcs.map(a => densify(a));
    const join = (refs, src) => {
      const out = [];
      for (const r of refs) {
        const a = r < 0 ? src[~r].slice().reverse() : src[r];
        for (let i = out.length ? 1 : 0; i < a.length; i++) out.push(a[i]);
      }
      return out;
    };
    const ring = refs => makeRing(join(refs, arcs), join(refs, dense));
    const byKey = new Map();
    const countries = DATA.countries.map(([id, name, iso3, polys], index) => {
      const polygons = polys.map(p => p.map(ring));
      // Spherical area: each polygon's outer ring minus its holes.
      const area = polygons.reduce((sum, p) => sum + abs(p[0].area()) - p.slice(1).reduce((h, r) => h + abs(r.area()), 0), 0) * R_KM * R_KM;
      const main = polygons.reduce((a, p) => (abs(p[0].area()) > abs(a[0].area()) ? p : a));
      const inside = q => polygons.flat().reduce((n, r) => n + (r.contains(q) ? 1 : 0), 0) % 2 === 1;
      const c = {
        id: id || null, name, iso3: iso3 || null, index,
        area, center: main[0].labelPoint(inside),
        polygons: polygons.map(p => p.map(r => r.raw)),
        rings: polygons.flat(), parts: polygons, main,
        contains(q) { q = ll(q); let n = 0; for (const r of this.rings) if (r.contains(q)) n++; return n % 2 === 1; },
      };
      for (const k of [name, id, iso3, ...(COUNTRY_ALIASES[name] ?? [])]) if (k) byKey.set(norm(k), c);
      return c;
    });
    const land = DATA.land.flatMap(p => p.map(ring));
    const users = arcs.map(() => new Set());
    DATA.countries.forEach((c, i) => { for (const r of c[3].flat(2)) users[r < 0 ? ~r : r].add(i); });
    W = {
      countries, land, byKey,
      coast: dense.filter((_, i) => users[i].size === 1),
      borders: dense.filter((_, i) => users[i].size > 1),
    };
    return W;
  }
  // A country by name ("France", "Dem. Rep. Congo", "DR Congo"), ISO numeric id ("250", 250), or ISO alpha-3 ("FRA").
  function country(key) {
    if (key && typeof key === "object" && key.rings) return key;
    if (key == null) return null;
    let k = norm(key);
    if (/^\d{1,3}$/.test(k)) k = k.padStart(3, "0");
    return world().byKey.get(k) ?? null;
  }
  const countryAt = p => { p = ll(p); return world().countries.find(c => c.contains(p)) ?? null; };

  // ---------- Projections ----------
  // Raw projections of rotated [λ, φ] in radians; y points up.
  const EE = { A1: 1.340264, A2: -0.081106, A3: 0.000893, A4: 0.003796, M: sqrt(3) / 2 };
  function eeF(l, f) {
    const { A1, A2, A3, A4, M } = EE, t = asin(M * sin(f)), t2 = t * t, t6 = t2 * t2 * t2;
    return [(l * cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))), t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))];
  }
  function eeI(x, y) {
    const { A1, A2, A3, A4, M } = EE;
    let t = y, t2 = t * t, t6 = t2 * t2 * t2;
    for (let i = 0; i < 12; i++) {
      const fy = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - y, fp = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2), d = fy / fp;
      t -= d; t2 = t * t; t6 = t2 * t2 * t2;
      if (abs(d) < 1e-12) break;
    }
    return [(M * x * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))) / cos(t), asin(clamp1(sin(t) / M))];
  }
  const RAW = {
    equirectangular: { cyl: true, lat: 90, f: (l, f) => [l, f], i: (x, y) => [x, y] },
    mercator: { cyl: true, lat: 85, fillLat: 88, f: (l, f) => [l, log(tan(PI / 4 + f / 2))], i: (x, y) => [x, 2 * atan(exp(y)) - HALF] },
    equalEarth: { cyl: true, lat: 90, f: eeF, i: eeI },
    orthographic: { cyl: false, clip: 90 },
    azimuthalEquidistant: { cyl: false, clip: 179.5 },
  };
  const PROJ_NAMES = {
    equirectangular: "equirectangular", equirect: "equirectangular", platecarree: "equirectangular",
    mercator: "mercator", equalearth: "equalEarth",
    orthographic: "orthographic", ortho: "orthographic", globe: "orthographic",
    azimuthalequidistant: "azimuthalEquidistant", azimuthal: "azimuthalEquidistant", equidistant: "azimuthalEquidistant",
  };
  // Rotation that takes [lon, lat] to the projection's center and turns it by roll (all degrees), as d3-geo's rotate([-lon, -lat, roll]).
  function rotation(lon, lat, roll) {
    const cl = cos(-lon * RAD), sl = sin(-lon * RAD), cp = cos(-lat * RAD), sp = sin(-lat * RAD), cg = cos(roll * RAD), sg = sin(roll * RAD);
    const a0 = [cp * cl, -cp * sl, -sp], a1 = [sl, cl, 0], a2 = [sp * cl, -sp * sl, cp];
    return [...a0, cg * a1[0] - sg * a2[0], cg * a1[1] - sg * a2[1], cg * a1[2] - sg * a2[2], sg * a1[0] + cg * a2[0], sg * a1[1] + cg * a2[1], sg * a1[2] + cg * a2[2]];
  }

  // A projection fitted into a box of the page: forward, inverse, and the clipping that lines and areas need.
  function projection(name = "equirectangular", o = {}) {
    const key = PROJ_NAMES[String(name).toLowerCase().replace(/[^a-z]/g, "")];
    if (!key) throw new Error(`Geo: unknown projection "${name}" (use ${Object.keys(RAW).join(", ")})`);
    const R = RAW[key], cyl = R.cyl, ortho = key === "orthographic";
    const box = o.box ?? [0, 0, 960, 480], pad = o.pad ?? 8;
    const samples = o.fit != null ? fitSamples(o.fit) : null;
    let center = o.center != null ? ll(o.center) : samples ? toLL(unit(samples.map(vec).reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]))) : [0, 0];
    if (o.view) center = [center[0] - (o.view.yaw ?? 0) * DEG, cyl ? center[1] : clamp(center[1] + (o.view.pitch ?? 0) * DEG, -90, 90)];
    center = [wrap180(center[0]), clamp(center[1], -90, 90)];
    const rot = o.rotate ? [o.rotate[0] ?? 0, o.rotate[1] ?? 0, o.rotate[2] ?? 0] : [center[0], cyl ? 0 : center[1], o.roll ?? 0];
    const m = rotation(...rot);
    const fwd = v => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
    const back = v => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
    const lam = v => atan2(v[1], v[0]), phi = v => asin(clamp1(v[2]));
    const latMax = cyl ? R.lat * RAD : HALF, fillLat = cyl ? (R.fillLat ?? R.lat) * RAD : HALF;
    const cosClip = cyl ? -2 : cos(R.clip * RAD), rim = cyl ? 0 : ortho ? 1 : R.clip * RAD;
    const azRaw = v => {
      if (ortho) return [v[1], v[2]];
      const c = acos(clamp1(v[0])), k = c < 1e-9 ? 1 : c / sin(c);
      return [k * v[1], k * v[2]];
    };
    const visible = cyl ? (R.lat >= 90 ? () => true : v => abs(phi(v)) <= latMax + 1e-12) : v => v[0] >= cosClip;
    const rawOf = v => (cyl ? R.f(lam(v), phi(v)) : azRaw(v));

    // The sphere's outline in raw units: two edge meridians for the flat maps, the rim for the azimuthal ones.
    const outlineRaw = [];
    if (cyl) {
      for (let d = -R.lat; d <= R.lat + 1e-9; d++) outlineRaw.push(R.f(PI, d * RAD));
      for (let d = R.lat; d >= -R.lat - 1e-9; d--) outlineRaw.push(R.f(-PI, d * RAD));
    } else for (let i = 0; i < 180; i++) outlineRaw.push([rim * cos((i * TAU) / 180), rim * sin((i * TAU) / 180)]);

    // Fit: the whole outline, or the region in o.fit, inside the box less its padding.
    const bounds = pts => pts.reduce((b, p) => [min(b[0], p[0]), min(b[1], p[1]), max(b[2], p[0]), max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    let B = bounds(outlineRaw);
    if (samples) {
      const raw = samples.map(p => fwd(vec(p))).filter(visible).map(rawOf);
      if (raw.length > 1) B = bounds(raw);
    }
    const fw = max(1, box[2] - 2 * pad), fh = max(1, box[3] - 2 * pad);
    let cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2, k;
    if (o.center != null && !o.rotate) { cx = 0; cy = cyl ? R.f(0, clamp(center[1] * RAD, -latMax, latMax))[1] : 0; }
    if (samples && o.center != null) {
      const hx = max(abs(B[0] - cx), abs(B[2] - cx), 1e-9), hy = max(abs(B[1] - cy), abs(B[3] - cy), 1e-9);
      k = min(fw / (2 * hx), fh / (2 * hy));
    } else k = min(fw / max(1e-9, B[2] - B[0]), fh / max(1e-9, B[3] - B[1]));
    k *= o.zoom ?? 1;
    const tx = box[0] + box[2] / 2 - k * cx, ty = box[1] + box[3] / 2 + k * cy;
    const px = q => [tx + k * q[0], ty - k * q[1]];
    const outline = outlineRaw.map(px);

    function forward(p) {
      const v = fwd(vec(ll(p)));
      return visible(v) ? px(rawOf(v)) : null;
    }
    function invert(p) {
      const x = (p[0] - tx) / k, y = (ty - p[1]) / k;
      let v;
      if (cyl) {
        const [l, f] = R.i(x, y);
        if (!Number.isFinite(l) || !Number.isFinite(f) || abs(l) > PI + 1e-9 || abs(f) > latMax + 1e-9) return null;
        v = vec([l * DEG, f * DEG]);
      } else {
        const r = hypot(x, y);
        if (r > rim + 1e-9) return null;
        const c = ortho ? asin(min(1, r)) : r, s = r < 1e-12 ? 0 : sin(c) / r;
        v = [cos(c), x * s, y * s];
      }
      return toLL(back(v));
    }

    // Points to rotated unit vectors, with steps no longer than 1°: along great circles, or straight in lon/lat.
    function vectors(pts, { geodesic = true, dense = false, closed = false } = {}) {
      pts = pts.map(ll);
      if (closed && pts.length > 1) pts.push(pts[0]);
      if (dense) return pts.map(p => fwd(vec(p)));
      if (!geodesic) return densify(pts).map(p => fwd(vec(p)));
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const v = fwd(vec(pts[i]));
        if (i > 0) {
          const u = out[out.length - 1], n = ceil(acos(clamp1(dot(u, v))) * DEG);
          for (let j = 1; j < n; j++) out.push(slerp(u, v, j / n));
        }
        out.push(v);
      }
      return out;
    }

    // Adaptive resampling: split a step while its projected midpoint strays from the straight px
    // chord, so curves stay smooth where a projection stretches (near the antipode of an azimuthal map).
    // Returns the vectors with their raw projected points alongside, in out.raw.
    function refine(a, b, pa, pb, depth, out) {
      if (depth > 8 || k * hypot(pb[0] - pa[0], pb[1] - pa[1]) < 4 || !visible(a) || !visible(b) || (cyl && abs(lam(a) - lam(b)) > PI)) return;
      const mv = nlerp(a, b, 0.5), pm = rawOf(mv);
      if (k * hypot(pm[0] - (pa[0] + pb[0]) / 2, pm[1] - (pa[1] + pb[1]) / 2) < 0.25) return;
      refine(a, mv, pa, pm, depth + 1, out);
      out.push(mv); out.raw.push(pm);
      refine(mv, b, pm, pb, depth + 1, out);
    }
    function resample(vs) {
      const out = [vs[0]];
      let pa = rawOf(vs[0]);
      out.raw = [pa];
      for (let i = 1; i < vs.length; i++) { const pb = rawOf(vs[i]); refine(vs[i - 1], vs[i], pa, pb, 0, out); out.push(vs[i]); out.raw.push(pb); pa = pb; }
      return out;
    }

    // A polyline cut where it leaves the map: at the far side of a globe, at the antimeridian of a flat
    // map, and past Mercator's ±85°. Returns the visible pieces in px.
    function line(pts, opt) {
      const vs = resample(vectors(pts, opt)), pieces = [];
      let cur = null, pv = null, pin = false, l0 = 0;
      const open = () => { cur = []; pieces.push(cur); };
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i], vin = visible(v), l1 = cyl ? lam(v) : 0;
        if (pv && vin !== pin) {
          const b = crossing(pv, v, visible);
          if (vin) { open(); cur.push(px(rawOf(b))); } else if (cur) { cur.push(px(rawOf(b))); cur = null; }
        } else if (pv && vin && cyl) {
          if (abs(l1 - l0) > PI) {
            const b = crossing(pv, v, u => u[1] >= 0), f = phi(b);
            cur.push(px(R.f(l0 < 0 ? -PI : PI, f)));
            open();
            cur.push(px(R.f(l1 < 0 ? -PI : PI, f)));
          }
        }
        if (vin) { if (!cur) open(); cur.push(px(vs.raw[i])); }
        pv = v; pin = vin; l0 = l1;
      }
      // A closed ring cut somewhere other than at its start: rejoin the last piece to the first.
      const v0 = vs[0], vn = vs[vs.length - 1];
      if (pieces.length > 1 && visible(v0) && dot(v0, vn) > 1 - 1e-12 && cur === pieces[pieces.length - 1]) {
        const last = pieces.pop();
        pieces[0] = last.concat(pieces[0].slice(1));
      }
      return pieces.filter(p => p.length > 1);
    }

    // Closed areas, as px subpaths to fill with the even-odd rule. rings: [{ dense, contains(lonlat) }],
    // where contains says what the ring encloses on the sphere.
    // Globes: points on the far side slide onto the rim along their own direction, which keeps the
    // area right everywhere on the visible side except that a ring around the antipode comes out
    // inside out; adding the rim once flips it back.
    // Flat maps: longitudes are unwrapped so a ring stays in one piece, a ring that goes round a pole is
    // closed through that pole, copies 360° to either side fill in what crosses the edge, and the
    // whole is clipped to the outline. A ring whose drawn side disagrees with contains() at the
    // map's north pole is flipped the same way.
    function fill(rings) {
      const paths = [];
      let flips = 0;
      if (!cyl) {
        const anti = toLL(back([-1, 0, 0]));
        const rimAt = a => px([rim * cos(a), rim * sin(a)]);
        for (const r of rings) {
          const vs = resample((r.dense ?? r.pts).map(p => fwd(vec(p)))), out = [];
          let last = null, pv = null, pin = false;
          const toRim = a => {
            if (last != null) {
              const d = wrapPi(a - last), n = ceil(abs(d) / 0.05);
              for (let j = 1; j < n; j++) out.push(rimAt(last + (d * j) / n));
            }
            out.push(rimAt(a));
            last = a;
          };
          const azimuth = v => atan2(v[2], v[1]);
          for (const v of vs) {
            const vin = v[0] >= cosClip;
            if (pv && vin !== pin) { toRim(azimuth(crossing(pv, v, u => u[0] >= cosClip))); if (vin) last = null; }
            if (vin) { out.push(px(azRaw(v))); last = null; }
            else {
              // Near the antipode a short step can swing the direction a long way: follow it in small steps.
              if (pv && !pin && last != null && abs(wrapPi(azimuth(v) - last)) > 0.5) for (let j = 1; j < 16; j++) toRim(azimuth(nlerp(pv, v, j / 16)));
              toRim(azimuth(v));
            }
            pv = v; pin = vin;
          }
          if (out.length > 2) paths.push(out);
          if (r.contains(anti)) flips++;
        }
        if (flips % 2) paths.push(outline);
        return { paths, clip: null };
      }
      const north = toLL(back([0, 0, 1]));
      for (const r of rings) {
        const vs = resample((r.dense ?? r.pts).map(p => fwd(vec(p)))), n = vs.length;
        if (n < 3) continue;
        const ls = [lam(vs[0])], fs = [phi(vs[0])];
        for (let i = 1; i < n; i++) { ls.push(ls[i - 1] + wrapPi(lam(vs[i]) - lam(vs[i - 1]))); fs.push(phi(vs[i])); }
        const net = ls[n - 1] - ls[0] + wrapPi(lam(vs[0]) - lam(vs[n - 1]));
        let viaNorth = false;
        if (abs(net) > PI) {
          const pole = net > 0 ? -HALF : HALF, end = ls[0] + net, f0 = fs[0];
          viaNorth = pole > 0;
          for (let j = 0; j <= 30; j++) { ls.push(end); fs.push(f0 + ((pole - f0) * j) / 30); }
          for (let j = 1; j < 72; j++) { ls.push(end + ((ls[0] - end) * j) / 72); fs.push(pole); }
          for (let j = 30; j >= 0; j--) { ls.push(ls[0]); fs.push(f0 + ((pole - f0) * j) / 30); }
        }
        if (r.contains(north) !== viaNorth) flips++;
        const lo = min(...ls), hi = max(...ls);
        for (let c = ceil((-PI - hi) / TAU); c <= Math.floor((PI - lo) / TAU); c++) {
          paths.push(ls.map((l, i) => px(R.f(l + c * TAU, clamp(fs[i], -fillLat, fillLat)))));
        }
      }
      if (flips % 2) paths.push(outline);
      return { paths, clip: outline };
    }

    // The [lon, lat] that keeps the map under the pointer after it moves by delta px (for drag).
    function pan(delta) {
      const [dx, dy] = delta;
      if (cyl) return [wrap180(center[0] - (dx / k) * DEG), center[1]];
      const lat = clamp(center[1] + (dy / k) * DEG, -89.9, 89.9);
      return [wrap180(center[0] - (dx / (k * max(0.15, cos(center[1] * RAD)))) * DEG), lat];
    }

    return {
      name: key, cylindrical: cyl, box, center, rotate: rot, scale: k,
      radius: cyl ? null : k * rim, origin: px([0, 0]), outline,
      forward, invert, line, fill, pan,
    };
  }
  // A country's main landmass and the land within 3,000 km of it: mainland France and Corsica, not
  // French Guiana; the lower 48, not Alaska.
  const homeland = c => c.parts.filter(p => p === c.main || distance(c.center, p[0].centroid()) < 3000).flatMap(p => p.flatMap(r => r.raw));
  // What o.fit names, as sample points: country names, two corners [[w, s], [e, n]], or a list of places.
  function fitSamples(f) {
    const list = Array.isArray(f) ? f : [f];
    if (list.length && list.every(x => typeof x === "string" && country(x))) return list.flatMap(n => homeland(country(n)));
    if (list.length === 2 && Array.isArray(list[0]) && Array.isArray(list[1]) && typeof list[0][0] === "number") {
      let [[w, s], [e, n]] = list;
      if (e < w) e += 360;
      const out = [];
      for (let i = 0; i <= 24; i++) { const x = w + ((e - w) * i) / 24, y = s + ((n - s) * i) / 24; out.push([x, s], [x, n], [w, y], [e, y]); }
      return out.map(p => [wrap180(p[0]), p[1]]);
    }
    return list.map(p => (typeof p === "string" && !city(p) && country(p) ? country(p).center : ll(p)));
  }

  // ---------- Cities ----------
  // [name, country, continent, lat, lon]: city centers to about 1 km.
  const CITY_DATA = [
    ["New York", "United States of America", "North America", 40.7128, -74.006],
    ["Los Angeles", "United States of America", "North America", 34.0522, -118.2437],
    ["Chicago", "United States of America", "North America", 41.8781, -87.6298],
    ["Mexico City", "Mexico", "North America", 19.4326, -99.1332],
    ["Toronto", "Canada", "North America", 43.6532, -79.3832],
    ["Vancouver", "Canada", "North America", 49.2827, -123.1207],
    ["Havana", "Cuba", "North America", 23.1136, -82.3666],
    ["Panama City", "Panama", "North America", 8.9824, -79.5199],
    ["Anchorage", "United States of America", "North America", 61.2181, -149.9003],
    ["Nuuk", "Greenland", "North America", 64.1814, -51.6941],
    ["São Paulo", "Brazil", "South America", -23.5505, -46.6333],
    ["Rio de Janeiro", "Brazil", "South America", -22.9068, -43.1729],
    ["Buenos Aires", "Argentina", "South America", -34.6037, -58.3816],
    ["Lima", "Peru", "South America", -12.0464, -77.0428],
    ["Bogotá", "Colombia", "South America", 4.711, -74.0721],
    ["Santiago", "Chile", "South America", -33.4489, -70.6693],
    ["Caracas", "Venezuela", "South America", 10.4806, -66.9036],
    ["Quito", "Ecuador", "South America", -0.1807, -78.4678],
    ["Ushuaia", "Argentina", "South America", -54.8019, -68.303],
    ["London", "United Kingdom", "Europe", 51.5074, -0.1278],
    ["Paris", "France", "Europe", 48.8566, 2.3522],
    ["Berlin", "Germany", "Europe", 52.52, 13.405],
    ["Madrid", "Spain", "Europe", 40.4168, -3.7038],
    ["Rome", "Italy", "Europe", 41.9028, 12.4964],
    ["Lisbon", "Portugal", "Europe", 38.7223, -9.1393],
    ["Stockholm", "Sweden", "Europe", 59.3293, 18.0686],
    ["Athens", "Greece", "Europe", 37.9838, 23.7275],
    ["Kyiv", "Ukraine", "Europe", 50.4501, 30.5234],
    ["Moscow", "Russia", "Europe", 55.7558, 37.6173],
    ["Istanbul", "Turkey", "Europe", 41.0082, 28.9784],
    ["Reykjavík", "Iceland", "Europe", 64.1466, -21.9426],
    ["Cairo", "Egypt", "Africa", 30.0444, 31.2357],
    ["Lagos", "Nigeria", "Africa", 6.5244, 3.3792],
    ["Kinshasa", "Dem. Rep. Congo", "Africa", -4.4419, 15.2663],
    ["Johannesburg", "South Africa", "Africa", -26.2041, 28.0473],
    ["Cape Town", "South Africa", "Africa", -33.9249, 18.4241],
    ["Nairobi", "Kenya", "Africa", -1.2921, 36.8219],
    ["Addis Ababa", "Ethiopia", "Africa", 9.032, 38.7469],
    ["Casablanca", "Morocco", "Africa", 33.5731, -7.5898],
    ["Dakar", "Senegal", "Africa", 14.7167, -17.4677],
    ["Accra", "Ghana", "Africa", 5.6037, -0.187],
    ["Tokyo", "Japan", "Asia", 35.6762, 139.6503],
    ["Beijing", "China", "Asia", 39.9042, 116.4074],
    ["Shanghai", "China", "Asia", 31.2304, 121.4737],
    ["Hong Kong", "China", "Asia", 22.3193, 114.1694],
    ["Seoul", "South Korea", "Asia", 37.5665, 126.978],
    ["Delhi", "India", "Asia", 28.6139, 77.209],
    ["Mumbai", "India", "Asia", 19.076, 72.8777],
    ["Dhaka", "Bangladesh", "Asia", 23.8103, 90.4125],
    ["Karachi", "Pakistan", "Asia", 24.8607, 67.0011],
    ["Bangkok", "Thailand", "Asia", 13.7563, 100.5018],
    ["Singapore", "Singapore", "Asia", 1.3521, 103.8198],
    ["Jakarta", "Indonesia", "Asia", -6.2088, 106.8456],
    ["Manila", "Philippines", "Asia", 14.5995, 120.9842],
    ["Dubai", "United Arab Emirates", "Asia", 25.2048, 55.2708],
    ["Riyadh", "Saudi Arabia", "Asia", 24.7136, 46.6753],
    ["Tehran", "Iran", "Asia", 35.6892, 51.389],
    ["Novosibirsk", "Russia", "Asia", 55.0084, 82.9357],
    ["Ulaanbaatar", "Mongolia", "Asia", 47.8864, 106.9057],
    ["Sydney", "Australia", "Oceania", -33.8688, 151.2093],
    ["Melbourne", "Australia", "Oceania", -37.8136, 144.9631],
    ["Perth", "Australia", "Oceania", -31.9505, 115.8605],
    ["Auckland", "New Zealand", "Oceania", -36.8485, 174.7633],
    ["Suva", "Fiji", "Oceania", -18.1416, 178.4419],
    ["Honolulu", "United States of America", "Oceania", 21.3069, -157.8583],
    ["McMurdo Station", "Antarctica", "Antarctica", -77.8419, 166.6863],
  ];
  const cities = Object.freeze(CITY_DATA.map(([name, ctry, continent, lat, lon]) => Object.freeze({ name, country: ctry, continent, lat, lon })));
  const CITY_ALIASES = { "new york city": "New York", nyc: "New York", la: "Los Angeles", "new delhi": "Delhi", bombay: "Mumbai", kiev: "Kyiv", peking: "Beijing", rio: "Rio de Janeiro", mcmurdo: "McMurdo Station" };
  const cityIndex = new Map(cities.map(c => [norm(c.name), c]));
  for (const [a, n] of Object.entries(CITY_ALIASES)) cityIndex.set(norm(a), cityIndex.get(norm(n)));
  function city(name) { return cityIndex.get(norm(name)) ?? null; }

  // ---------- g.map ----------
  function makeMap(g, util, o = {}) {
    const box = o.box ?? [0, 0, g.w, g.h];
    const P = projection(o.projection ?? "equirectangular", { ...o, box });
    let ctx = g.ctx;
    const C = util.color;
    const porcelain = util.mix("panel", "ink", 0.075);
    const taken = [];   // boxes of labels and dots drawn on this map, so later labels avoid them
    const [bx, by, bw, bh] = box;

    const trace = (pieces, close) => {
      for (const pc of pieces) {
        ctx.moveTo(pc[0][0], pc[0][1]);
        for (let i = 1; i < pc.length; i++) ctx.lineTo(pc[i][0], pc[i][1]);
        if (close) ctx.closePath();
      }
    };
    const clipped = (fn, outline) => {
      ctx.save();
      if (o.clip !== false) { ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip(); }
      if (outline) { ctx.beginPath(); trace([outline], true); ctx.clip(); }
      fn();
      ctx.restore();
    };
    const stroke = (pieces, s = {}) => {
      if (!pieces.length || s.color === false) return;
      clipped(() => {
        ctx.beginPath();
        trace(pieces, false);
        if (s.alpha != null) ctx.globalAlpha = s.alpha;
        ctx.strokeStyle = C(s.color ?? "ink");
        ctx.lineWidth = s.width ?? 1;
        ctx.lineJoin = ctx.lineCap = "round";
        ctx.setLineDash(s.dash ?? []);
        ctx.stroke();
      });
    };
    const fillRings = (rings, color, alpha) => {
      if (!rings.length || !color) return;
      const f = P.fill(rings);
      if (!f.paths.length) return;
      clipped(() => {
        ctx.beginPath();
        trace(f.paths, true);
        if (alpha != null) ctx.globalAlpha = alpha;
        ctx.fillStyle = C(color);
        ctx.fill("evenodd");
      }, f.clip);
    };
    const inBox = q => q && q[0] >= bx && q[0] <= bx + bw && q[1] >= by && q[1] <= by + bh;
    const free = b => b[0] >= bx + 1 && b[1] >= by + 1 && b[2] <= bx + bw - 1 && b[3] <= by + bh - 1 &&
      !taken.some(q => b[0] < q[2] + 2 && b[2] > q[0] - 2 && b[1] < q[3] + 2 && b[3] > q[1] - 2);
    // A label beside a point, on the first side where it fits without covering another label or dot.
    function placeLabel(text, p, r, s = {}) {
      if (text == null || text === "" || !p) return null;
      const size = s.size ?? 11.5, weight = s.weight ?? 500, str = String(text);
      const w = g.measure(str, { size, weight }), h = size + 2, d = r + 3, e = d * 0.72;
      const at = {
        e: [p[0] + d, p[1], "left"], w: [p[0] - d, p[1], "right"], n: [p[0], p[1] - d - h / 2, "center"], s: [p[0], p[1] + d + h / 2, "center"],
        ne: [p[0] + e, p[1] - e - h / 2 + 2, "left"], se: [p[0] + e, p[1] + e + h / 2 - 2, "left"], nw: [p[0] - e, p[1] - e - h / 2 + 2, "right"], sw: [p[0] - e, p[1] + e + h / 2 - 2, "right"],
        c: [p[0], p[1], "center"],
      };
      const order = s.side ? [s.side] : ["e", "w", "ne", "nw", "se", "sw", "n", "s"];
      const boxAt = side => { const [x, y, align] = at[side], x0 = align === "left" ? x : align === "right" ? x - w : x - w / 2; return [x0, y - h / 2, x0 + w, y + h / 2]; };
      // The first side that is free; a forced label that fits nowhere takes its first choice anyway.
      const side = order.find(sd => free(boxAt(sd))) ?? (s.force ? order[0] : null);
      if (!side) return null;
      const b = boxAt(side), [x, y, align] = at[side];
      taken.push(b);
      g.text(str, [x, y], { size, weight, color: s.color ?? "ink", align, halo: true, haloWidth: 3.5 });
      return b;
    }
    const dotBox = (q, r) => [q[0] - r - 1, q[1] - r - 1, q[0] + r + 1, q[1] + r + 1];
    const lonsLats = (from, to, step) => { const out = []; for (let x = from; x <= to + 1e-9; x += step) out.push(x); return out; };

    const M = {
      projection: P.name, box, center: P.center, scale: P.scale, radius: P.radius, origin: P.origin, outline: P.outline,
      // [lon, lat] to px, or null where the point isn't on the map (the far side of a globe, beyond Mercator's ±85°).
      project: p => P.forward(p),
      // px to [lon, lat], or null off the map.
      invert: p => P.invert(p),
      visible: p => inBox(P.forward(p)),
      near: (p, at, r = 14) => { const q = P.forward(at); return !!q && hypot(p[0] - q[0], p[1] - q[1]) <= r; },
      countryAt(p) { const q = p && P.invert(p); return q ? countryAt(q) : null; },
      pan: delta => P.pan(delta),
      // Visible pieces of a line in px, for drawing or hit-testing it yourself.
      lines: (pts, opt) => P.line(pts, opt),

      sphere(s = {}) {
        if (s.fill !== false) {
          clipped(() => {
            ctx.beginPath(); trace([P.outline], true);
            ctx.fillStyle = C(s.fill ?? "panel"); ctx.fill();
          });
        }
        if (s.stroke !== false) stroke([[...P.outline, P.outline[0]]], { color: s.stroke ?? "muted", width: s.width ?? 1 });
        return M;
      },
      // The shading that makes a globe read as a ball: darker toward the rim.
      shade(s = {}) {
        if (P.name !== "orthographic") return M;
        const [x, y] = P.origin, r = P.radius;
        // Toward whichever of ink and paper is darker, so the rim darkens in light and dark mode alike.
        const lum = c => { const [r0, g0, b0] = util.rgb(c); return 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0; };
        const dark = lum("ink") < lum("panel") ? "ink" : "panel", k = dark === "ink" ? 1 : 3;
        clipped(() => {
          const grad = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r);
          grad.addColorStop(0, util.rgba(dark, 0));
          grad.addColorStop(0.65, util.rgba(dark, 0.02 * k));
          grad.addColorStop(1, util.rgba(dark, min(0.9, (s.strength ?? 0.1) * k)));
          ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
          ctx.fillStyle = grad; ctx.fill();
        });
        return M;
      },
      graticule(s = {}) {
        const [ls, fs] = Array.isArray(s.step) ? s.step : [s.step ?? 30, s.step ?? 30];
        const pieces = [];
        for (let l = -180; l < 180; l += ls) pieces.push(...P.line(lonsLats(-90, 90, 2).map(f => [l, f]), { geodesic: false }));
        for (let f = -90 + fs; f < 90 - 1e-9; f += fs) pieces.push(...P.line(lonsLats(-180, 180, 2).map(l => [l, f]), { geodesic: false }));
        stroke(pieces, { color: s.color ?? "faint", width: s.width ?? 0.6, alpha: s.alpha });
        return M;
      },
      land(s = {}) {
        const w = world();
        fillRings(w.land, s.fill ?? porcelain, s.alpha);
        if (s.stroke !== false) M.coast({ color: s.stroke, width: s.width });
        return M;
      },
      coast(s = {}) {
        stroke(world().coast.flatMap(a => P.line(a, { dense: true })), { color: s.color ?? "ink", width: s.width ?? 0.9, alpha: s.alpha, dash: s.dash });
        return M;
      },
      borders(s = {}) {
        stroke(world().borders.flatMap(a => P.line(a, { dense: true })), { color: s.color ?? "muted", width: s.width ?? 0.6, alpha: s.alpha, dash: s.dash });
        return M;
      },
      // One country or a list, by name, ISO numeric id, or ISO alpha-3: tinted fill, outline, optional label.
      country(which, s = {}) {
        const list = (Array.isArray(which) ? which : [which]).map(k => {
          const c = country(k);
          if (!c) throw new Error(`Geo: unknown country "${k}"`);
          return c;
        });
        const color = s.color ?? "orange";
        for (const c of list) {
          if (s.fill !== false) fillRings(c.rings, s.fill ?? color, s.alpha ?? 0.35);
          if (s.stroke !== false) stroke(c.rings.flatMap(r => P.line(r.dense, { dense: true })), { color: s.stroke ?? color, width: s.width ?? 1.4 });
          if (s.label) placeLabel(s.label === true ? c.name : s.label, P.forward(s.labelAt ?? c.center), 0, { size: 12.5, weight: 600, color: s.labelColor ?? "ink", side: "c", force: true, ...s.labelStyle });
        }
        return list;
      },
      // Every country filled by fill(country): a palette name or color, or null to leave it as land.
      countries(s = {}) {
        for (const c of world().countries) { const f = s.fill?.(c); if (f) fillRings(c.rings, f, s.alpha); }
        if (s.borders !== false) { M.borders(s.borderStyle); M.coast(s.coastStyle); }
        return M;
      },
      // Countries shaded by a number: values keyed by name, id, or alpha-3 (or a function of the country).
      choropleth(values, s = {}) {
        const vals = new Map(), unmatched = [];
        if (typeof values === "function") for (const c of world().countries) { const v = values(c); if (Number.isFinite(v)) vals.set(c, v); }
        else for (const [key, v] of values instanceof Map ? values : Object.entries(values)) {
          const c = country(key);
          if (c && Number.isFinite(v)) vals.set(c, v); else unmatched.push(key);
        }
        const all = [...vals.values()];
        let [lo, hi] = s.range ?? (all.length ? [min(...all), max(...all)] : [0, 1]);
        if (!(hi > lo)) hi = lo + 1;
        const color = s.color ?? "blue", low = s.low ?? "red", diverging = !!s.diverging;
        const mid = s.mid ?? (lo < 0 && hi > 0 ? 0 : (lo + hi) / 2);
        const quant = t => (s.steps > 1 ? Math.min(s.steps - 1, Math.floor(t * s.steps)) / (s.steps - 1) : t);
        const t = v => (diverging ? (v < mid ? -quant(clamp((mid - v) / (mid - lo || 1), 0, 1)) : quant(clamp((v - mid) / (hi - mid || 1), 0, 1))) : quant(clamp((v - lo) / (hi - lo), 0, 1)));
        const ramp = u => (diverging ? util.mix(porcelain, u < 0 ? low : color, abs(u)) : util.mix(porcelain, color, 0.1 + 0.9 * u));
        const colorOf = v => ramp(t(v));
        if (s.missing) for (const c of world().countries) if (!vals.has(c)) fillRings(c.rings, s.missing);
        for (const [c, v] of vals) fillRings(c.rings, colorOf(v));
        if (s.borders !== false) { M.borders({ color: s.borderColor ?? "panel", width: s.borderWidth ?? 0.7 }); M.coast({ width: 0.8 }); }
        // at(u): the color at a position along the legend, u in [0, 1] (or [-1, 1] when diverging), banded like the map.
        const at = u => ramp(u < 0 ? -quant(-u) : quant(u));
        const out = { color: colorOf, range: [lo, hi], mid, unmatched, ramp, at, diverging };
        if (s.legend) M.legend(out, s.legend === true ? {} : s.legend);
        return out;
      },
      // The color ramp of a choropleth with its range: { title, at: "bottom-left" | ... | [x, y], width, format }.
      legend(scale, s = {}) {
        const w = s.width ?? clamp(bw * 0.28, 90, 170), h = 7, size = 10.5;
        const fmt = s.format ?? (v => (window.Num?.fmt ? window.Num.fmt(v) : String(+v.toPrecision(3))));
        const fmtLo = fmt(scale.range[0]), fmtHi = fmt(scale.range[1]);
        const titleH = s.title ? 16 : 0, H = titleH + h + 16;
        const wide = max(w, s.title ? g.measure(s.title, { size: 11, weight: 600 }) : 0, g.measure(fmtLo, { size }) + g.measure(fmtHi, { size }) + 12);
        const corner = s.at ?? "bottom-left";
        const x = Array.isArray(corner) ? corner[0] : corner.endsWith("left") ? bx + 14 : bx + bw - 14 - wide;
        const y = Array.isArray(corner) ? corner[1] : corner.startsWith("top") ? by + 12 : by + bh - 12 - H;
        if (s.background !== false) g.rect(x - 8, y - 6, wide + 16, H + 10, { fill: "panel", stroke: "faint", width: 1, r: 6, alpha: 0.94 });
        if (s.title) g.text(s.title, [x, y + 6], { size: 11, weight: 600, align: "left" });
        const n = 40, top = y + titleH;
        for (let i = 0; i < n; i++) {
          const u = scale.diverging ? -1 + (2 * (i + 0.5)) / n : (i + 0.5) / n;
          g.rect(x + (w * i) / n, top, w / n + 0.6, h, { fill: (scale.at ?? scale.ramp)(u) });
        }
        g.rect(x, top, w, h, { stroke: "faint", width: 1 });
        g.text(fmtLo, [x, top + h + 8], { size, color: "muted", align: "left" });
        g.text(fmtHi, [x + w, top + h + 8], { size, color: "muted", align: "right" });
        if (scale.diverging && scale.mid != null) g.text(fmt(scale.mid), [x + w / 2, top + h + 8], { size, color: "muted" });
        taken.push([x - 8, y - 6, x + wide + 8, y + H + 4]);
        return M;
      },
      // Dots for a list of places, with labels placed where they don't collide (earlier items win).
      points(list, s = {}) {
        const r = s.r ?? 3, drawn = [];
        for (const item of list) {
          const at = ll(item), q = P.forward(at);
          if (!inBox(q)) continue;
          const c = typeof s.color === "function" ? s.color(item) : s.color ?? "ink";
          g.circle(q, r, { fill: c, stroke: "panel", width: 1.25 });
          taken.push(dotBox(q, r));
          drawn.push({ item, at, p: q });
        }
        if (s.labels !== false) {
          const text = typeof s.labels === "function" ? s.labels : it => (typeof it === "string" ? city(it)?.name ?? it : it?.name ?? it?.label);
          for (const d of drawn) {
            const label = text(d.item);
            if (label != null) d.label = placeLabel(label, d.p, r, { size: s.size, color: s.labelColor ?? "ink", weight: s.weight });
          }
        }
        return {
          drawn,
          hit(p, rad = 12) {
            let best = null, bd = rad;
            for (const d of drawn) { const e = hypot(p[0] - d.p[0], p[1] - d.p[1]); if (e <= bd) { bd = e; best = d.item; } }
            return best;
          },
        };
      },
      // One emphasized place: a ringed dot and a label that claims its space first.
      marker(at, s = {}) {
        const q = P.forward(ll(at));
        if (!inBox(q)) return null;
        const c = s.color ?? "red", r = s.r ?? 5;
        g.circle(q, r + 3.5, { stroke: c, width: 1.25, alpha: 0.55 });
        g.circle(q, r, { fill: c, stroke: "panel", width: 2 });
        taken.push(dotBox(q, r + 3));
        const label = s.label === true ? (typeof at === "string" ? city(at)?.name : at?.name) : s.label;
        if (label) placeLabel(label, q, r + 3, { size: 12.5, weight: 600, color: s.labelColor ?? c, side: s.side, force: true });
        return q;
      },
      // A halo label at a place, avoiding labels already drawn.
      label(text, at, s = {}) { return placeLabel(text, P.forward(ll(at)), s.r ?? 2, { size: 12.5, weight: 600, force: true, ...s }); },
      // The great circle from a to b (the shortest route), cut correctly at the antimeridian and the horizon.
      arc(a, b, s = {}) {
        a = ll(a); b = ll(b);
        const km = distance(a, b), t1 = clamp(s.progress ?? 1, 0, 1), n = max(2, ceil((km / R_KM) * DEG * t1));
        const va = vec(a), vb = vec(b), pts = Array.from({ length: n + 1 }, (_, i) => toLL(slerp(va, vb, (t1 * i) / n)));
        const pieces = P.line(pts, { dense: true });
        stroke(pieces, { color: s.color ?? "blue", width: s.width ?? 2, dash: s.dash, alpha: s.alpha });
        const end = P.forward(pts[n]), last = pieces[pieces.length - 1];
        if (s.arrow && end && last && t1 > 0) {
          const tip = last[last.length - 1];
          let k = last.length - 2;
          while (k > 0 && hypot(tip[0] - last[k][0], tip[1] - last[k][1]) < 8) k--;
          const from = last[max(0, k)], d = hypot(tip[0] - from[0], tip[1] - from[1]);
          if (d > 1e-6) {
            const ux = (tip[0] - from[0]) / d, uy = (tip[1] - from[1]) / d, hl = s.head ?? 9, hw = hl * 0.45;
            const base = [tip[0] - ux * hl, tip[1] - uy * hl];
            g.path([tip, [base[0] - uy * hw, base[1] + ux * hw], [base[0] + uy * hw, base[1] - ux * hw]], { fill: s.color ?? "blue", close: true });
          }
        }
        if (s.label) placeLabel(s.label, P.forward(toLL(slerp(va, vb, t1 / 2))), 3, { size: 12, weight: 600, color: s.labelColor ?? s.color ?? "blue", force: true });
        return { km, pieces, at: t => P.forward(toLL(slerp(va, vb, t))) };
      },
      // A path through several places: great-circle steps, or straight in lon/lat with geodesic: false.
      line(list, s = {}) {
        const pieces = P.line(list, { geodesic: s.geodesic ?? true, closed: !!s.close });
        stroke(pieces, { color: s.color ?? "ink", width: s.width ?? 1.5, dash: s.dash, alpha: s.alpha });
        return pieces;
      },
      // Everything within km of the center: a true circle on the ground, however the map distorts it.
      circle(center, km, s = {}) {
        const c = ll(center), ring = circlePoints(c, km, s.steps ?? 160), color = s.color ?? "red";
        if (s.fill) fillRings([{ dense: ring, contains: q => distance(c, q) < km }], s.fill === true ? color : s.fill, s.fillAlpha ?? 0.14);
        const pieces = P.line(ring, { dense: true });
        stroke(pieces, { color, width: s.width ?? 1.5, dash: s.dash, alpha: s.alpha });
        return pieces;
      },
      // A line of latitude or longitude, with an optional label at its right or top end.
      parallel(lat, s = {}) {
        const pieces = P.line(lonsLats(-180, 180, 1).map(l => [l, lat]), { geodesic: false });
        stroke(pieces, { color: s.color ?? "muted", width: s.width ?? 1, dash: s.dash ?? [4, 4], alpha: s.alpha });
        const end = pieces.flat().reduce((a, p) => (!a || p[0] > a[0] ? p : a), null);
        if (s.label && end) placeLabel(s.label, [min(end[0], bx + bw - 4), end[1]], 0, { size: 11, weight: 600, color: s.labelColor ?? s.color ?? "muted", side: "nw", force: true });
        return pieces;
      },
      meridian(lon, s = {}) {
        const pieces = P.line(lonsLats(-90, 90, 1).map(f => [lon, f]), { geodesic: false });
        stroke(pieces, { color: s.color ?? "muted", width: s.width ?? 1, dash: s.dash ?? [4, 4], alpha: s.alpha });
        const end = pieces.flat().reduce((a, p) => (!a || p[1] < a[1] ? p : a), null);
        if (s.label && end) placeLabel(s.label, [end[0], max(end[1], by + 4)], 0, { size: 11, weight: 600, color: s.labelColor ?? s.color ?? "muted", side: "se", force: true });
        return pieces;
      },
    };

    // The base map, drawn as soon as the map is made (like g.graph's axes). base: false draws nothing.
    const drawBase = () => {
      const landStyle = typeof o.land === "object" ? o.land : {};
      M.sphere({ stroke: false, fill: o.water ?? "panel" });
      if (o.graticule !== false) M.graticule(typeof o.graticule === "object" ? o.graticule : { step: typeof o.graticule === "number" ? o.graticule : 30 });
      if (o.land !== false) M.land({ ...landStyle, stroke: false });
      if (o.borders !== false) M.borders(typeof o.borders === "object" ? o.borders : {});
      if (o.land !== false && landStyle.stroke !== false) M.coast({ color: landStyle.stroke, width: landStyle.width });
      if (o.shade !== false) M.shade();
      M.sphere({ fill: false });
    };
    if (o.base !== false) {
      // A base that stays the same from one frame to the next (a flat map under an animation) is drawn
      // once into an offscreen canvas and copied after that. One that changes every frame (a globe
      // being turned) is drawn directly.
      const dev = ctx.canvas, canCache = o.cache !== false && typeof document !== "undefined" && dev && g.dpr;
      const key = canCache && JSON.stringify([P.name, P.rotate, P.scale, P.origin, box, dev.width, dev.height, g.dpr, o.graticule, o.land, o.borders, o.water, o.shade, o.clip,
        ...["panel", "ink", "muted", "faint", "grid", "blue", "red", "green", "orange", "purple", "brass"].map(n => C(n))]);
      let store = BASE_CACHE.get(g);
      if (!store) BASE_CACHE.set(g, (store = { last: null, canvases: new Map() }));
      let cv = key ? store.canvases.get(key) : null;
      if (key && !cv && store.last === key) {
        cv = document.createElement("canvas");
        cv.width = dev.width; cv.height = dev.height;
        ctx = cv.getContext("2d");
        ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
        drawBase();
        ctx = g.ctx;
        store.canvases.set(key, cv);
        if (store.canvases.size > 4) store.canvases.delete(store.canvases.keys().next().value);
      }
      if (key) store.last = key;
      if (cv) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cv, 0, 0); ctx.restore(); }
      else drawBase();
    }
    return M;
  }
  const BASE_CACHE = new WeakMap();   // per figure's g: the last base key, and up to four drawn bases

  window.Geo = {
    R: R_KM,
    distance, interpolate, greatCircle, bearing, destination, midpoint, circle: circlePoints, ll,
    projection, projections: Object.keys(RAW),
    country, countryAt,
    get countries() { return world().countries; },
    area: c => country(c)?.area ?? null,
    contains: (c, p) => !!country(c)?.contains(p),
    cities, city,
  };
  (window.__safisG ||= []).push((g, util) => { g.map = (o = {}) => makeMap(g, util, o); });
})();

;

/* Optics kit for explainer figures. window.Optics traces light through a 2D scene:
   flat and curved mirrors, ideal thin lenses, glass bodies whose index depends on
   wavelength (prisms, slabs, thick lenses, raindrops), absorbing walls and screens,
   and sensors, with Snell refraction, Fresnel splitting, and total internal
   reflection. Optics.eye builds a schematic eye that accommodates and wears glasses.
   g.optics(scene, o) traces and draws a scene and returns the hits.
   Reference: references/optics.md in the skill. */
(() => {
  "use strict";
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hypot = Math.hypot;
  const D_LINE = 587.56; // nm: catalogs quote indices at the helium d line
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const dist = (a, b) => hypot(a[0] - b[0], a[1] - b[1]);
  const unit = v => { const l = hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const rotate = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };
  const pt = p => [+p[0], +p[1]];

  // ---------- Materials ----------
  // Cauchy fits n(λ) = A + B/λ² (λ in µm), matched to each material's index at the
  // d line and its Abbe number, so the spread of colors is the real one.
  const MATERIALS = {
    vacuum: 1, air: 1,
    water: { A: 1.3242, B: 0.003066 },     // 1.333 at 589 nm, 1.343 at 400 nm, 1.330 at 700 nm
    ice: { A: 1.3006, B: 0.00289 },        // 1.309
    acrylic: { A: 1.4787, B: 0.004484 },   // PMMA, 1.492
    bk7: { A: 1.5046, B: 0.0042 },         // crown glass, 1.517, Abbe 64
    flint: { A: 1.5942, B: 0.00893 },      // F2, 1.620, Abbe 36
    denseFlint: { A: 1.7384, B: 0.016 },   // SF11, 1.785, Abbe 26
    diamond: { A: 2.3786, B: 0.01342 },    // 2.417, Abbe 55
  };
  MATERIALS.crown = MATERIALS.glass = MATERIALS.bk7;

  function material(m) {
    if (m == null) return 1;
    if (typeof m === "string") {
      if (!(m in MATERIALS)) throw new Error(`Optics: unknown material "${m}" (try ${Object.keys(MATERIALS).join(", ")})`);
      return MATERIALS[m];
    }
    return m;
  }
  // Refractive index of a material (a number, a name, or { A, B, C }) at a wavelength in nm.
  function index(m, wl) {
    const c = material(m);
    if (typeof c === "number") return c;
    const l2 = ((wl ?? D_LINE) / 1000) ** 2;
    return c.A + (c.B ?? 0) / l2 + (c.C ?? 0) / (l2 * l2);
  }
  const dispersive = m => { const c = material(m); return typeof c === "object" && !!(c.B || c.C); };
  const abbe = m => (index(m, D_LINE) - 1) / (index(m, 486.13) - index(m, 656.27));

  // ---------- Wavelength to color ----------
  // CIE 1931 2° color matching functions x̄, ȳ, z̄ from 380 to 780 nm in 10 nm steps, then
  // XYZ to linear sRGB with negative parts clipped, scaled so the largest channel is 1
  // and dimmed a little toward the ends of the visible range.
  const CMF = [
    [0.001368, 0.000039, 0.00645], [0.004243, 0.00012, 0.02005], [0.01431, 0.000396, 0.06785], [0.04351, 0.00121, 0.2074], [0.13438, 0.004, 0.6456],
    [0.2839, 0.0116, 1.3856], [0.34828, 0.023, 1.74706], [0.3362, 0.038, 1.77211], [0.2908, 0.06, 1.6692], [0.19536, 0.09098, 1.28764],
    [0.09564, 0.13902, 0.81295], [0.03201, 0.20802, 0.46518], [0.0049, 0.323, 0.272], [0.0093, 0.503, 0.1582], [0.06327, 0.71, 0.07825],
    [0.1655, 0.862, 0.04216], [0.2904, 0.954, 0.0203], [0.43345, 0.99495, 0.00875], [0.5945, 0.995, 0.0039], [0.7621, 0.952, 0.0021],
    [0.9163, 0.87, 0.00165], [1.0263, 0.757, 0.0011], [1.0622, 0.631, 0.0008], [1.0026, 0.503, 0.00034], [0.85445, 0.381, 0.00019],
    [0.6424, 0.265, 0.00005], [0.4479, 0.175, 0.00002], [0.2835, 0.107, 0], [0.1649, 0.061, 0], [0.0874, 0.032, 0], [0.04677, 0.017, 0],
    [0.0227, 0.00821, 0], [0.011359, 0.004102, 0], [0.00579, 0.002091, 0], [0.002899, 0.001047, 0], [0.00144, 0.00052, 0],
    [0.00069, 0.000249, 0], [0.000332, 0.00012, 0], [0.000166, 0.00006, 0], [0.000083, 0.00003, 0], [0.000042, 0.000015, 0],
  ];
  function linearRGB(nm) {
    const f = clamp((nm - 380) / 10, 0, 40), i = Math.min(39, Math.floor(f)), t = f - i;
    const [X, Y, Z] = [0, 1, 2].map(k => lerp(CMF[i][k], CMF[i + 1][k], t));
    const c = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z].map(v => Math.max(0, v));
    const m = Math.max(...c) || 1;
    const edge = nm < 420 ? lerp(0.6, 1, clamp((nm - 380) / 40, 0, 1)) : nm > 680 ? lerp(1, 0.6, clamp((nm - 680) / 100, 0, 1)) : 1;
    return c.map(v => (v / m) * edge);
  }
  const encode = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  // [r, g, b] in 0-255. o.on = "light" darkens bright hues (yellow, green) so a thin
  // line still reads on a light page.
  function wavelengthRGB(nm, o = {}) {
    let c = linearRGB(nm);
    if (o.on === "light") {
      const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], k = Math.min(1, (o.luminance ?? 0.2) / Math.max(Y, 1e-6));
      c = c.map(v => v * k);
    }
    return c.map(v => Math.round(clamp(encode(v), 0, 255)));
  }
  const wavelengthColor = (nm, o) => { const [r, g, b] = wavelengthRGB(nm, o); return `rgb(${r}, ${g}, ${b})`; };
  // White light as seven lines, red to violet; Optics.spectrum(n) gives finer ones.
  const WHITE = [650, 605, 578, 540, 500, 465, 415];
  const spectrum = (n = 7, lo = 415, hi = 650) => Array.from({ length: n }, (_, i) => +(n === 1 ? (lo + hi) / 2 : hi - ((hi - lo) * i) / (n - 1)).toFixed(1));

  // ---------- Physics ----------
  // Fresnel reflectance for unpolarized light from index n1 into n2, given cos of the incidence angle.
  function fres(n1, n2, ci) {
    ci = clamp(ci, 0, 1);
    const st = (n1 / n2) * Math.sqrt(1 - ci * ci);
    if (st >= 1) return { R: 1, T: 0, Rs: 1, Rp: 1, tir: true, ct: 0 };
    const ct = Math.sqrt(1 - st * st);
    const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct), rp = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct);
    const Rs = rs * rs, Rp = rp * rp, R = (Rs + Rp) / 2;
    return { R, T: 1 - R, Rs, Rp, tir: false, ct };
  }
  const snell = (n1, n2, i) => { const s = (n1 * Math.sin(i * DEG)) / n2; return Math.abs(s) > 1 ? NaN : Math.asin(s) / DEG; };
  const critical = (n1, n2 = 1) => (n1 > n2 ? Math.asin(n2 / n1) / DEG : NaN);
  const brewster = (n1, n2) => Math.atan(n2 / n1) / DEG;
  function fresnel(n1, n2, i) {
    const f = fres(n1, n2, Math.cos(i * DEG));
    return { R: f.R, T: f.T, Rs: f.Rs, Rp: f.Rp, tir: f.tir, t: f.tir ? NaN : Math.acos(f.ct) / DEG };
  }
  // Thin lens or mirror: object at distance d (real objects positive), focal length f.
  function image(f, d) {
    if (!Number.isFinite(d)) return { d: f, m: 0 };
    const inv = 1 / f - 1 / d;
    const di = Math.abs(inv) < 1e-15 ? Infinity : 1 / inv;
    return { d: di, m: Number.isFinite(di) ? -di / d : Infinity };
  }
  // A thick lens of index n, radii R1, R2 (center of curvature to the right is positive), center thickness d.
  function thick(n, R1, R2, d = 0) {
    const c1 = 1 / R1, c2 = 1 / R2;
    const P = (n - 1) * (c1 - c2 + ((n - 1) * d * c1 * c2) / n), f = 1 / P;
    return { f, bfd: f * (1 - ((n - 1) * d * c1) / n), ffd: f * (1 + ((n - 1) * d * c2) / n) };
  }
  const lensmaker = (n, R1, R2, d = 0) => thick(n, R1, R2, d).f;
  // The rainbow after k internal reflections in a drop of index n: the incidence angle of
  // minimum deviation, cos²i = (n² − 1) / (k(k + 2)), and the bow's angle from the antisolar point.
  function rainbow(n, k = 1) {
    const i = Math.acos(Math.sqrt((n * n - 1) / (k * (k + 2)))), r = Math.asin(Math.sin(i) / n);
    const D = 2 * (i - r) + k * (Math.PI - 2 * r), w = ((D % TAU) + TAU) % TAU;
    return { i: i / DEG, r: r / DEG, deviation: D / DEG, angle: Math.abs(Math.PI - w) / DEG };
  }

  // ---------- Geometry ----------
  // A piece of boundary is a segment { k: "seg", a, b } or an arc { k: "arc", c, r, a0, a1 }
  // running counterclockwise from a0 to a1 (radians, world y up).
  const segment = (a, b) => ({ k: "seg", a: pt(a), b: pt(b) });
  // u0, u1 are the unit vectors to the ends, kept so the in-arc test needs no trigonometry.
  function arcR(c, r, a0, a1) {
    if (a1 < a0) a1 += TAU;
    return { k: "arc", c: pt(c), r: Math.abs(r), a0, a1, u0: [Math.cos(a0), Math.sin(a0)], u1: [Math.cos(a1), Math.sin(a1)] };
  }
  const arc = (c, r, from, to) => arcR(c, r, from * DEG, to * DEG);
  const dirOf = a => (typeof a === "number" ? [Math.cos(a * DEG), Math.sin(a * DEG)] : unit(a));
  const place = (pc, c, a) => (pc.k === "seg" ? segment(add(rotate(pc.a, a), c), add(rotate(pc.b, a), c)) : arcR(add(rotate(pc.c, a), c), pc.r, pc.a0 + a, pc.a1 + a));
  function inArc(pc, x, y) {
    const sw = pc.a1 - pc.a0;
    if (sw >= TAU - 1e-12) return true;
    if (!pc.u0) { pc.u0 = [Math.cos(pc.a0), Math.sin(pc.a0)]; pc.u1 = [Math.cos(pc.a1), Math.sin(pc.a1)]; }
    const vx = x - pc.c[0], vy = y - pc.c[1], u0 = pc.u0, u1 = pc.u1, e = -1e-12 * pc.r;
    const after0 = u0[0] * vy - u0[1] * vx >= e, before1 = vx * u1[1] - vy * u1[0] >= e;
    return sw <= Math.PI ? after0 && before1 : after0 || before1;
  }
  // Distance along the unit ray (px, py) + t (dx, dy) to the piece, for t > eps; Infinity on a miss.
  function cast(pc, px, py, dx, dy, eps) {
    if (pc.k === "seg") {
      const ex = pc.b[0] - pc.a[0], ey = pc.b[1] - pc.a[1], den = dx * ey - dy * ex;
      if (den === 0) return Infinity;
      const wx = pc.a[0] - px, wy = pc.a[1] - py, t = (wx * ey - wy * ex) / den;
      if (!(t > eps)) return Infinity;
      const s = (wx * dy - wy * dx) / den;
      return s >= -1e-9 && s <= 1 + 1e-9 ? t : Infinity;
    }
    const fx = px - pc.c[0], fy = py - pc.c[1], b = fx * dx + fy * dy, disc = b * b - (fx * fx + fy * fy - pc.r * pc.r);
    if (disc < 0) return Infinity;
    const sq = Math.sqrt(disc);
    let t = -b - sq;
    if (t > eps && inArc(pc, px + t * dx, py + t * dy)) return t;
    t = -b + sq;
    return t > eps && inArc(pc, px + t * dx, py + t * dy) ? t : Infinity;
  }
  // Unit normal of a piece at a point on it: left of a->b for segments, away from the center for arcs.
  function normalAt(pc, x, y) {
    if (pc.k === "seg") { const e = unit(sub(pc.b, pc.a)); return [-e[1], e[0]]; }
    return [(x - pc.c[0]) / pc.r, (y - pc.c[1]) / pc.r];
  }
  function midOf(pc) {
    if (pc.k === "seg") { const e = unit(sub(pc.b, pc.a)); return [mul(add(pc.a, pc.b), 0.5), [-e[1], e[0]]]; }
    const a = (pc.a0 + pc.a1) / 2, u = [Math.cos(a), Math.sin(a)];
    return [add(pc.c, mul(u, pc.r)), u];
  }
  function bbox(shape) {
    const b = [Infinity, Infinity, -Infinity, -Infinity], grow = p => { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); };
    for (const pc of shape) {
      if (pc.k === "seg") { grow(pc.a); grow(pc.b); continue; }
      grow([pc.c[0] + pc.r * Math.cos(pc.a0), pc.c[1] + pc.r * Math.sin(pc.a0)]);
      grow([pc.c[0] + pc.r * Math.cos(pc.a1), pc.c[1] + pc.r * Math.sin(pc.a1)]);
      for (let k = Math.ceil(pc.a0 / (Math.PI / 2)); k * (Math.PI / 2) <= pc.a1; k++) grow(add(pc.c, mul([Math.cos(k * Math.PI / 2), Math.sin(k * Math.PI / 2)], pc.r)));
    }
    return b;
  }
  // Inside test by counting crossings along a ray in an awkward direction (so it doesn't graze corners).
  const PROBE = [Math.cos(1), Math.sin(1)];
  function inside(el, x, y) {
    const b = el.box;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
    let n = 0;
    for (const pc of el.shape) {
      if (pc.k === "seg") {
        const ex = pc.b[0] - pc.a[0], ey = pc.b[1] - pc.a[1], den = PROBE[0] * ey - PROBE[1] * ex;
        if (!den) continue;
        const wx = pc.a[0] - x, wy = pc.a[1] - y, t = (wx * ey - wy * ex) / den, s = (wx * PROBE[1] - wy * PROBE[0]) / den;
        if (t > 0 && s >= 0 && s < 1) n++;
      } else {
        const fx = x - pc.c[0], fy = y - pc.c[1], bb = fx * PROBE[0] + fy * PROBE[1], disc = bb * bb - (fx * fx + fy * fy - pc.r * pc.r);
        if (disc <= 0) continue;
        const sq = Math.sqrt(disc);
        for (const t of [-bb - sq, -bb + sq]) if (t > 0 && inArc(pc, x + t * PROBE[0], y + t * PROBE[1])) n++;
      }
    }
    return n % 2 === 1;
  }
  // Distance from a world point to an element's outline, for drag hit tests.
  function distance(el, q) {
    let best = Infinity;
    for (const pc of el.shape ?? []) {
      if (pc.k === "seg") {
        const e = sub(pc.b, pc.a), l2 = e[0] * e[0] + e[1] * e[1] || 1, t = clamp(((q[0] - pc.a[0]) * e[0] + (q[1] - pc.a[1]) * e[1]) / l2, 0, 1);
        best = Math.min(best, dist(q, add(pc.a, mul(e, t))));
      } else if (inArc(pc, q[0], q[1])) best = Math.min(best, Math.abs(dist(q, pc.c) - pc.r));
      else for (const a of [pc.a0, pc.a1]) best = Math.min(best, dist(q, add(pc.c, mul([Math.cos(a), Math.sin(a)], pc.r))));
    }
    return best;
  }

  // ---------- Elements ----------
  // Every element is plain data: { type, shape: [pieces], name, label, ... }.
  const common = (el, o) => Object.assign(el, {
    name: o.name ?? el.name ?? null, label: o.label ?? null, labelAt: o.labelAt ? pt(o.labelAt) : null,
    color: o.color ?? el.color ?? null, hidden: !!o.hidden,
  });
  function body(shape, o = {}, extra = {}) {
    const el = common({ type: "body", shape: [].concat(shape).map(pc => ({ ...pc })), n: o.n ?? "bk7", tint: o.tint ?? "blue", ...extra }, o);
    material(el.n);
    el.box = bbox(el.shape);
    // Which way is out: probe just off each piece's middle.
    const h = hypot(el.box[2] - el.box[0], el.box[3] - el.box[1]) * 1e-5;
    for (const pc of el.shape) { const [m, u] = midOf(pc); pc.out = inside(el, m[0] + u[0] * h, m[1] + u[1] * h) ? -1 : 1; }
    return el;
  }
  const polygon = (points, o = {}) => body(points.map((p, i) => segment(p, points[(i + 1) % points.length])), o);
  function slab(c, w, h, o = {}) {
    const a = (o.angle ?? 0) * DEG;
    return polygon([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(p => add(rotate(p, a), c)), o);
  }
  // Isosceles prism with its apex up (before o.angle turns it), size = the length of its two equal sides.
  function prism(c, size, o = {}) {
    const A = ((o.apex ?? 60) * DEG) / 2, b = size * Math.sin(A), H = size * Math.cos(A), a = (o.angle ?? 0) * DEG;
    return polygon([[0, (2 * H) / 3], [-b, -H / 3], [b, -H / 3]].map(p => add(rotate(p, a), c)), o);
  }
  const circle = (c, r, o = {}) => body([arcR(c, r, 0, TAU)], o);
  const drop = (c, r, o = {}) => circle(c, r, { n: "water", ...o });
  // Half disc: the curved side faces o.angle (degrees), the flat side goes through c.
  function semicircle(c, r, o = {}) {
    const a = (o.angle ?? 0) * DEG, e0 = add(c, rotate([0, -r], a)), e1 = add(c, rotate([0, r], a));
    return body([arcR(c, r, a - Math.PI / 2, a + Math.PI / 2), segment(e1, e0)], o);
  }
  // Two spherical faces in local coordinates (axis +x, vertices at -d/2 and d/2), cut at half height h.
  function lensShape(R1, R2, d, h) {
    const x1 = -d / 2, x2 = d / 2;
    const sag = (xv, R, y) => (Number.isFinite(R) ? xv + R - Math.sign(R) * Math.sqrt(Math.max(0, R * R - y * y)) : xv);
    h = Math.min(h, Math.min(Number.isFinite(R1) ? Math.abs(R1) : Infinity, Number.isFinite(R2) ? Math.abs(R2) : Infinity) * 0.999);
    const edge = y => sag(x2, R2, y) - sag(x1, R1, y);
    if (edge(h) < 0) { let lo = 0, hi = h; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (edge(m) > 0) lo = m; else hi = m; } h = lo; }
    const face = (xv, R) => {
      if (!Number.isFinite(R)) return segment([xv, -h], [xv, h]);
      const al = Math.asin(h / Math.abs(R)), mid = R > 0 ? Math.PI : 0;
      return arcR([xv + R, 0], R, mid - al, mid + al);
    };
    const rim = edge(h) > 1e-9 * Math.max(d, 1e-9);
    const shape = [face(x1, R1)];
    if (rim) shape.push(segment([sag(x1, R1, h), h], [sag(x2, R2, h), h]));
    shape.push(face(x2, R2));
    if (rim) shape.push(segment([sag(x2, R2, -h), -h], [sag(x1, R1, -h), -h]));
    return { shape, h };
  }
  // A real lens: { f } (equal radii, solved from the thick-lens equation) or { R1, R2 }, with thickness and aperture.
  // Without o.thickness the center is made thick enough to leave a thin rim at the full aperture.
  function lens(c, o = {}) {
    const n = o.n ?? "bk7", nd = index(n);
    let R1 = o.R1 ?? Infinity, R2 = o.R2 ?? Infinity;
    const ap = o.aperture ?? (o.f != null ? Math.abs(o.f) * 0.5 : Math.min(Math.abs(R1), Math.abs(R2), 2) * 0.8), h = ap / 2;
    const bulge = R => (Number.isFinite(R) ? Math.sign(R) * (Math.abs(R) - Math.sqrt(Math.max(0, R * R - h * h))) : 0);
    const radii = d => { if (o.f == null) return; const k = 1 - d / (nd * o.f), R = k >= 0 ? o.f * (nd - 1) * (1 + Math.sqrt(k)) : 2 * o.f * (nd - 1); R1 = R; R2 = -R; };
    let d = o.thickness ?? ap * 0.1;
    radii(d);
    if (o.thickness == null) for (let i = 0; i < 30; i++) { d = (d + Math.max(ap * 0.1, bulge(R1) - bulge(R2) + ap * 0.04)) / 2; radii(d); }
    const a = (o.angle ?? 0) * DEG, { shape } = lensShape(R1, R2, d, ap / 2);
    return body(shape.map(pc => place(pc, pt(c), a)), o, { optic: { kind: "thick", c: pt(c), axis: dirOf(o.angle ?? 0), R1, R2, d, n } });
  }
  // A mirror segment. The silvered face is on the left going from a to b (world y up); the back absorbs.
  const mirror = (a, b, o = {}) => common({ type: "mirror", shape: [segment(a, b)], face: o.twoSided ? 0 : o.flip ? -1 : 1, reflectance: o.reflectance ?? 1 }, o);
  // A spherical mirror with its vertex at `vertex`, facing o.facing (degrees). R > 0 is concave, R < 0 convex; f = R / 2.
  function curvedMirror(vertex, R, o = {}) {
    const u = dirOf(o.facing ?? 180), r = Math.abs(R), ap = Math.min(o.aperture ?? r * 0.9, 2 * r * 0.999), al = Math.asin(ap / (2 * r));
    const c = add(vertex, mul(u, R)), toV = Math.atan2(vertex[1] - c[1], vertex[0] - c[0]);
    return common({ type: "mirror", shape: [arcR(c, r, toV - al, toV + al)], face: R > 0 ? -1 : 1, reflectance: o.reflectance ?? 1, optic: { kind: "mirror", vertex: pt(vertex), axis: u, R } }, o);
  }
  // An ideal thin lens: every ray through height h leaves with its slope changed by -h/f. No aberration, no color.
  function thinLens(c, f, o = {}) {
    const ax = dirOf(o.angle ?? 0), v = [-ax[1], ax[0]], h = (o.aperture ?? Math.abs(f) * 0.8) / 2;
    return common({ type: "lens", shape: [segment(sub(c, mul(v, h)), add(c, mul(v, h)))], f, c: pt(c), axis: ax, v, optic: { kind: "thin", c: pt(c), axis: ax, f } }, o);
  }
  // Absorbers: walls stop light, screens and sensors also record where it lands.
  function absorber(style, a, b, o) {
    let shape;
    if (a && (a.k || (Array.isArray(a) && a[0] && a[0].k))) { shape = [].concat(a).map(pc => ({ ...pc })); o = b; }
    else shape = [segment(a, b)];
    o = o ?? {};
    return common({ type: "absorber", style, shape, record: style !== "wall", width: o.width ?? null }, o);
  }
  const wall = (a, b, o) => absorber("wall", a, b, o);
  const screen = (a, b, o) => absorber("screen", a, b, o);
  const sensor = (a, b, o) => absorber("sensor", a, b, o);

  // ---------- Sources ----------
  // A source is plain data: { type: "source", rays: [[x, y, dx, dy], ...], wl, I, color }.
  // wl: undefined (one color, index at the d line), a wavelength in nm, a list, or "white".
  const wlOf = w => (w == null ? null : w === "white" ? WHITE.slice() : Array.isArray(w) ? w.slice() : +w);
  const source = (kind, rays, o, at) => ({ type: "source", kind, at: at ? pt(at) : null, rays, wl: wlOf(o.wl), I: o.I ?? 1, color: o.color ?? null, name: o.name ?? null, marker: o.marker ?? kind !== "beam" });
  const ray = (p, dir, o = {}) => { const d = dirOf(dir); return source("ray", [[p[0], p[1], d[0], d[1]]], o, p); };
  function beam(p, dir, width, o = {}) {
    const d = dirOf(dir), v = [-d[1], d[0]], n = Math.max(1, o.n ?? 9), rays = [];
    for (let k = 0; k < n; k++) { const s = n === 1 ? 0 : (k / (n - 1) - 0.5) * width; rays.push([p[0] + v[0] * s, p[1] + v[1] * s, d[0], d[1]]); }
    return source("beam", rays, o, p);
  }
  function fan(p, dir, spread, o = {}) {
    const n = Math.max(1, o.n ?? 9), a0 = typeof dir === "number" ? dir : Math.atan2(dir[1], dir[0]) / DEG, full = spread >= 360, rays = [];
    for (let k = 0; k < n; k++) {
      const a = full ? a0 + (360 * k) / n : n === 1 ? a0 : a0 + (k / (n - 1) - 0.5) * spread, d = dirOf(a);
      rays.push([p[0], p[1], d[0], d[1]]);
    }
    return source("fan", rays, o, p);
  }
  // Rays from p through n evenly spaced points from a to b: a point source filling an aperture.
  function fanTo(p, a, b, o = {}) {
    const n = Math.max(1, o.n ?? 9), rays = [];
    for (let k = 0; k < n; k++) { const t = n === 1 ? 0.5 : k / (n - 1), d = unit(sub([lerp(a[0], b[0], t), lerp(a[1], b[1], t)], p)); rays.push([p[0], p[1], d[0], d[1]]); }
    return source("fan", rays, o, p);
  }

  // ---------- Tracing ----------
  function flatten(scene, out = []) {
    for (const it of [].concat(scene ?? [])) {
      if (!it) continue;
      if (Array.isArray(it)) flatten(it, out);
      else if (it.type === "eye") flatten(it.items, out);
      else out.push(it);
    }
    return out;
  }
  function split(scene) {
    const items = flatten(scene);
    return { els: items.filter(e => e.type !== "source" && e.shape), srcs: items.filter(e => e.type === "source") };
  }
  const keyOf = (el, ei) => el.name ?? String(ei);

  // o: depth [24] interactions per path, minI [0.01] intensity below which a ray is dropped,
  // fresnel [true] (false: no partial reflections, only total internal reflection),
  // n0 [1] the surrounding medium, far (how far escaping rays run), maxSegments [6000].
  function trace(scene, o = {}) {
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    const { els, srcs } = split(scene);
    const maxDepth = o.depth ?? 24, minI = o.minI ?? 0.01, maxSeg = o.maxSegments ?? 6000, useFresnel = o.fresnel !== false, n0 = o.n0 ?? 1;
    const B = [Infinity, Infinity, -Infinity, -Infinity];
    for (const el of els) { const b = el.box ?? bbox(el.shape); B[0] = Math.min(B[0], b[0]); B[1] = Math.min(B[1], b[1]); B[2] = Math.max(B[2], b[2]); B[3] = Math.max(B[3], b[3]); }
    for (const s of srcs) for (const r of s.rays) { B[0] = Math.min(B[0], r[0]); B[1] = Math.min(B[1], r[1]); B[2] = Math.max(B[2], r[0]); B[3] = Math.max(B[3], r[1]); }
    const ext = Math.max(1e-6, Number.isFinite(B[0]) ? hypot(B[2] - B[0], B[3] - B[1]) : 1), eps = ext * 1e-9, far = o.far ?? ext * 20;
    const pieces = [];
    els.forEach((el, ei) => { if (!el.box) el = els[ei] = { ...el, box: bbox(el.shape) }; for (const pc of el.shape) pieces.push(pc, ei); });
    const bodies = [];
    els.forEach((el, ei) => { if (el.type === "body") bodies.push(ei); });
    const mediumAt = (x, y, skip) => { for (let k = bodies.length - 1; k >= 0; k--) { const ei = bodies[k]; if (ei !== skip && inside(els[ei], x, y)) return ei; } return -1; };
    const matOf = med => (med < 0 ? n0 : els[med].n);
    const names = els.map(keyOf);
    const segments = [], hits = [], sensors = {}, energy = { escaped: 0, absorbed: 0, lost: 0 };
    els.forEach((el, ei) => { if (el.record) sensors[names[ei]] = []; });
    const stack = [];
    srcs.forEach((s, si) => s.rays.forEach((r, ri) => {
      const band = Array.isArray(s.wl) ? s.wl : null, d = unit([r[2], r[3]]);
      stack.push({ x: r[0], y: r[1], dx: d[0], dy: d[1], I: s.I, wl: band ? null : s.wl, band, med: mediumAt(r[0], r[1], -1), depth: 0, via: "", src: si, ray: ri, color: s.color });
    }));
    stack.reverse();
    const spawn = (r, x, y, d, I, wl, band, med, ch) => {
      if (I < minI) { energy.lost += I; return; }
      d = unit(d);
      stack.push({ x, y, dx: d[0], dy: d[1], I, wl, band, med, depth: r.depth + 1, via: r.via + ch, src: r.src, ray: r.ray, color: r.color });
    };
    const record = (kind, r, x, y, ei, nn) => {
      const h = { p: [x, y], kind, el: ei, name: names[ei], normal: nn, din: [r.dx, r.dy], i: Math.acos(clamp(-(r.dx * nn[0] + r.dy * nn[1]), -1, 1)) / DEG,
        t: null, dout: null, dr: null, R: null, n1: null, n2: null, I: r.I, wl: r.wl, band: r.band, depth: r.depth, via: r.via, src: r.src, ray: r.ray };
      hits.push(h);
      return h;
    };
    const refl = (r, nn) => { const ci = -(r.dx * nn[0] + r.dy * nn[1]); return [r.dx + 2 * ci * nn[0], r.dy + 2 * ci * nn[1]]; };
    const refr = (r, nn, n1, n2, ct) => { const ci = -(r.dx * nn[0] + r.dy * nn[1]), k = n1 / n2, m = k * ci - ct; return [k * r.dx + m * nn[0], k * r.dy + m * nn[1]]; };

    let truncated = false;
    while (stack.length) {
      if (segments.length >= maxSeg) { truncated = true; for (const r of stack) energy.lost += r.I; break; }
      const r = stack.pop();
      let best = far, bi = -1;
      for (let k = 0; k < pieces.length; k += 2) { const t = cast(pieces[k], r.x, r.y, r.dx, r.dy, eps); if (t < best) { best = t; bi = k; } }
      const x = r.x + r.dx * best, y = r.y + r.dy * best;
      const sg = { a: [r.x, r.y], b: [x, y], I: r.I, wl: r.wl, band: r.band, depth: r.depth, via: r.via, src: r.src, ray: r.ray, med: r.med, color: r.color, end: "escape" };
      segments.push(sg);
      if (bi < 0) { energy.escaped += r.I; continue; }
      const pc = pieces[bi], ei = pieces[bi + 1], el = els[ei];
      sg.end = el.type;
      if (r.depth >= maxDepth) { sg.end = "depth"; energy.lost += r.I; continue; }
      const N = normalAt(pc, x, y), cosN = r.dx * N[0] + r.dy * N[1], nn = cosN < 0 ? N : [-N[0], -N[1]];

      if (el.type === "body") {
        const entering = cosN * (pc.out ?? 1) < 0;
        const medOut = entering ? ei : mediumAt(x + r.dx * eps * 50, y + r.dy * eps * 50, ei);
        const m1 = matOf(r.med), m2 = matOf(medOut), ci = -(r.dx * nn[0] + r.dy * nn[1]);
        if (r.band && (dispersive(m1) || dispersive(m2))) {
          // White light splits into its colors here; the reflected part stays white.
          let Rsum = 0;
          const parts = r.band.map(wl => { const n1 = index(m1, wl), n2 = index(m2, wl), f = fres(n1, n2, ci); Rsum += useFresnel || f.tir ? f.R : 0; return { wl, n1, n2, f }; });
          const R = Rsum / parts.length, mid = parts[parts.length >> 1];
          const h = Object.assign(record("refract", r, x, y, ei, nn), { n1: mid.n1, n2: mid.n2, R, t: mid.f.tir ? null : Math.acos(mid.f.ct) / DEG, dr: refl(r, nn) });
          if (parts.every(q => q.f.tir)) { h.kind = "tir"; h.dout = h.dr; }
          else h.dout = unit(refr(r, nn, mid.n1, mid.n2, mid.f.ct));
          spawn(r, x, y, h.dr, r.I * R, null, r.band, r.med, "R");
          for (const q of parts) if (!q.f.tir) spawn(r, x, y, refr(r, nn, q.n1, q.n2, q.f.ct), r.I * (useFresnel ? q.f.T : 1), q.wl, null, medOut, "T");
        } else {
          const wl = r.wl ?? (r.band ? r.band[r.band.length >> 1] : null), n1 = index(m1, wl), n2 = index(m2, wl), f = fres(n1, n2, ci);
          const R = useFresnel || f.tir ? f.R : 0, dr = refl(r, nn);
          const h = record(f.tir ? "tir" : "refract", r, x, y, ei, nn);
          h.n1 = n1; h.n2 = n2; h.R = R; h.dr = dr; h.t = f.tir ? null : Math.acos(f.ct) / DEG;
          if (f.tir) h.dout = dr;
          spawn(r, x, y, dr, r.I * R, r.wl, r.band, r.med, "R");
          if (!f.tir) { h.dout = unit(refr(r, nn, n1, n2, f.ct)); spawn(r, x, y, h.dout, r.I * (1 - R), r.wl, r.band, medOut, "T"); }
        }
      } else if (el.type === "mirror") {
        const F = el.face ? mul(N, el.face) : null;
        if (F && r.dx * F[0] + r.dy * F[1] > 0) { record("absorb", r, x, y, ei, nn); energy.absorbed += r.I; sg.end = "absorber"; continue; }
        const dr = refl(r, nn), R = el.reflectance ?? 1;
        const h = record("mirror", r, x, y, ei, nn);
        h.dout = h.dr = dr; h.R = R;
        spawn(r, x, y, dr, r.I * R, r.wl, r.band, r.med, "M");
        if (R < 1) spawn(r, x, y, [r.dx, r.dy], r.I * (1 - R), r.wl, r.band, r.med, "P");
      } else if (el.type === "lens") {
        const du = r.dx * el.axis[0] + r.dy * el.axis[1], dv = r.dx * el.v[0] + r.dy * el.v[1];
        const h = (x - el.c[0]) * el.v[0] + (y - el.c[1]) * el.v[1];
        let d = [r.dx, r.dy];
        if (Math.abs(du) > 1e-12) { const sgn = Math.sign(du), s2 = dv / Math.abs(du) - h / el.f; d = unit(add(mul(el.axis, sgn), mul(el.v, s2))); }
        record("lens", r, x, y, ei, nn).dout = d;
        spawn(r, x, y, d, r.I, r.wl, r.band, r.med, "L");
      } else {
        record(el.record ? "sensor" : "absorb", r, x, y, ei, nn);
        energy.absorbed += r.I;
        if (el.record) {
          const at = el.shape.indexOf(pc);
          let s;
          if (pc.k === "seg") { const e = sub(pc.b, pc.a); s = ((x - pc.a[0]) * e[0] + (y - pc.a[1]) * e[1]) / (e[0] * e[0] + e[1] * e[1]); }
          else { let d = (Math.atan2(y - pc.c[1], x - pc.c[0]) - pc.a0) % TAU; if (d < 0) d += TAU; s = d / (pc.a1 - pc.a0); }
          sensors[names[ei]].push({ p: [x, y], t: (at + clamp(s, 0, 1)) / el.shape.length, I: r.I, wl: r.wl, band: r.band, dir: [r.dx, r.dy], src: r.src, ray: r.ray, via: r.via });
        }
      }
    }
    return { segments, hits, sensors, energy, truncated, ms: typeof performance !== "undefined" ? performance.now() - t0 : 0 };
  }

  // Where a bundle of rays comes closest to meeting: the least-squares point of the lines.
  // lines: segments ({ a, b }), hits or sensor records ({ p, din | dir }), or { p, d }.
  function focus(lines) {
    let sxx = 0, sxy = 0, syy = 0, bx = 0, by = 0, n = 0;
    const L = [];
    for (const l of lines ?? []) {
      const p = l.a ?? l.p, d = unit(l.b ? sub(l.b, l.a) : l.d ?? l.din ?? l.dir);
      if (!p || !Number.isFinite(d[0])) continue;
      const m11 = 1 - d[0] * d[0], m12 = -d[0] * d[1], m22 = 1 - d[1] * d[1];
      sxx += m11; sxy += m12; syy += m22; bx += m11 * p[0] + m12 * p[1]; by += m12 * p[0] + m22 * p[1]; n++;
      L.push([p, d]);
    }
    const det = sxx * syy - sxy * sxy;
    if (n < 2 || Math.abs(det) < 1e-9 * (sxx + syy) ** 2) return null;
    const q = [(syy * bx - sxy * by) / det, (sxx * by - sxy * bx) / det];
    let e = 0;
    for (const [p, d] of L) { const w = sub(q, p), c = w[0] * d[1] - w[1] * d[0]; e += c * c; }
    return { p: q, rms: Math.sqrt(e / n), n };
  }
  // Centroid and size of a set of landing points (sensor records or [x, y]).
  function spot(points) {
    const ps = (points ?? []).map(q => q.p ?? q);
    if (!ps.length) return null;
    const c = [ps.reduce((s, q) => s + q[0], 0) / ps.length, ps.reduce((s, q) => s + q[1], 0) / ps.length];
    let e = 0, w = 0;
    for (const q of ps) { const r = dist(q, c); e += r * r; w = Math.max(w, r); }
    return { center: c, rms: Math.sqrt(e / ps.length), width: 2 * w, n: ps.length };
  }

  // ---------- Eye ----------
  // The Gullstrand-Emsley simplified schematic eye, in mm, cornea vertex at the origin, light along +x:
  // one corneal surface (r 7.8) into aqueous of 1.333, a lens of 1.416, vitreous of 1.333, retina at 23.9.
  // Accommodating, the lens front moves from 3.6 to 3.2 mm and its radii go from 10 / −6 to 5 / −5 mm.
  const EYE = { rc: 7.8, nAq: 1.3333, nLens: 1.416, nGlass: 1.498, length: 23.896, globe: 11.5, iris: 2.9,
    relaxed: [3.6, 1 / 10, 7.2, -1 / 6], near: [3.2, 1 / 5, 7.2, -1 / 5] };
  function eyeSurfaces(t, gl) {
    const [x1a, c1a, x2a, c2a] = EYE.relaxed, [x1b, c1b, x2b, c2b] = EYE.near, s = [];
    if (gl) s.push({ x: -gl.vertex - gl.d, c: 1 / gl.R1, n: EYE.nGlass }, { x: -gl.vertex, c: 1 / gl.R2, n: 1 });
    s.push({ x: 0, c: 1 / EYE.rc, n: EYE.nAq }, { x: lerp(x1a, x1b, t), c: lerp(c1a, c1b, t), n: EYE.nLens }, { x: lerp(x2a, x2b, t), c: lerp(c2a, c2b, t), n: EYE.nAq });
    return s;
  }
  // Paraxial system matrix in (height, n × angle) from the first surface to the plane x = xEnd.
  function system(surfs, xEnd) {
    let A = 1, B = 0, C = 0, D = 1, n = 1, x = surfs[0].x;
    for (const s of surfs) {
      const t = (s.x - x) / n; A += t * C; B += t * D;
      const P = (s.n - n) * s.c; C -= P * A; D -= P * B;
      n = s.n; x = s.x;
    }
    const t = (xEnd - x) / n; A += t * C; B += t * D;
    return { A, B, C, D, n };
  }
  // The object distance in front of the cornea (mm) that is sharp on a retina at x = L. Negative: virtual, behind the eye.
  function focusDistance(surfs, L) {
    const M = system(surfs, L);
    return Math.abs(M.A) < 1e-12 ? Infinity : -M.B / M.A - surfs[0].x;
  }
  // Where the image of an object s mm in front of the first surface forms (x, mm).
  function imageX(surfs, s) {
    const last = surfs[surfs.length - 1].x, M = system(surfs, last);
    const y = Number.isFinite(s) ? M.A * s + M.B : M.A, nu = Number.isFinite(s) ? M.C * s + M.D : M.C;
    return Math.abs(nu) < 1e-15 ? Infinity : last - (y * M.n) / nu;
  }
  const vergence = d => (Number.isFinite(d) ? 1000 / d : 0);
  function glassesGeom(g) {
    if (g == null || g === false) return null;
    const power = typeof g === "number" ? g : g.power ?? 0, vertex = typeof g === "number" ? 12 : g.vertex ?? 12;
    if (!power) return { power: 0, vertex, d: 1.5, R1: Infinity, R2: Infinity };
    const f = 1000 / power, d = power > 0 ? 1.5 + Math.min(4, power * 0.25) : 1.2, k = 1 - d / (EYE.nGlass * f);
    const R = k >= 0 ? f * (EYE.nGlass - 1) * (1 + Math.sqrt(k)) : 2 * f * (EYE.nGlass - 1);
    return { power, vertex, d, R1: R, R2: -R };
  }
  // o: at [0, 0] (cornea vertex, mm), accommodation [0] diopters, amplitude (the most this eye can
  // accommodate, D), error [0] (refractive error at the cornea in D, −3 = 3 D nearsighted; sets the
  // eye's length) or length (mm), pupil [3] mm, glasses (power in D, or { power, vertex [12] }).
  function eye(o = {}) {
    const at = pt(o.at ?? [0, 0]), gl = glassesGeom(o.glasses), pupil = o.pupil ?? 3, rx = o.error ?? 0;
    const L = o.length ?? (rx ? imageX(eyeSurfaces(0, null), -1000 / rx) : imageX(eyeSurfaces(0, null), Infinity));
    const K = t => vergence(focusDistance(eyeSurfaces(t, null), L)), K0 = K(0);
    const amplitude = clamp(o.amplitude ?? Infinity, 0, K(1) - K0);
    const solve = A => { if (A <= 0) return 0; let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (K(m) - K0 < A) lo = m; else hi = m; } return (lo + hi) / 2; };
    const accommodation = clamp(o.accommodation ?? 0, 0, amplitude), t = solve(accommodation);
    const surfaces = eyeSurfaces(t, gl);
    const farPoint = focusDistance(eyeSurfaces(0, gl), L), nearPoint = focusDistance(eyeSurfaces(solve(amplitude), gl), L);
    const bare = system(eyeSurfaces(t, null), surfaces[surfaces.length - 1].x);

    // Geometry. The globe is the cornea's sphere joined to a sphere for the sclera that ends at the retina.
    const W = p => add(at, p), rc = EYE.rc, rg = EYE.globe + (L - EYE.length) * 0.5, cg = L - rg;
    const xj = (cg * cg - rg * rg) / (2 * (cg - rc)), yj = Math.sqrt(Math.max(0, rc * rc - (xj - rc) ** 2));
    const al = Math.atan2(yj, rc - xj), be = Math.atan2(yj, xj - cg), rIn = rg - 0.06;
    const half = x => Math.max(x > xj ? Math.sqrt(Math.max(0, rg * rg - (x - cg) ** 2)) : 0, Math.sqrt(Math.max(0, rc * rc - (x - rc) ** 2)));
    const items = [];
    items.push(body([arcR(W([rc, 0]), rc, Math.PI - al, Math.PI + al), arcR(W([cg, 0]), rg, -be, be)], { n: EYE.nAq, tint: "blue", name: "eye", label: o.labels === false ? null : "cornea", labelAt: W([-2.2, 6.2]) }));
    const [x1, c1, x2, c2] = [surfaces[surfaces.length - 2].x, surfaces[surfaces.length - 2].c, surfaces[surfaces.length - 1].x, surfaces[surfaces.length - 1].c];
    const ls = lensShape(1 / c1, 1 / c2, x2 - x1, 4.3);
    items.push(body(ls.shape.map(pc => place(pc, W([(x1 + x2) / 2, 0]), 0)), { n: EYE.nLens, tint: "blue", name: "lens", label: o.labels === false ? null : "lens", labelAt: W([(x1 + x2) / 2, -ls.h - 1.6]) }));
    const yi = half(EYE.iris) - 0.03;
    for (const s of [1, -1]) items.push(absorber("wall", W([EYE.iris, (s * pupil) / 2]), W([EYE.iris, s * yi]), { name: "iris", width: 4 }));
    const ret = Math.min(70 * DEG, be - 0.2);
    items.push(absorber("sensor", arcR(W([cg, 0]), rIn, -ret, ret), { name: "retina", color: "red", label: o.labels === false ? null : "retina", labelAt: W([L + 1.5, rg * 0.62]) }));
    items.push(absorber("wall", [arcR(W([cg, 0]), rIn, ret, be - 0.04), arcR(W([cg, 0]), rIn, -be + 0.04, -ret)], { name: "sclera", hidden: true }));
    if (gl) {
      const shape = lensShape(gl.R1, gl.R2, gl.d, 10).shape.map(pc => place(pc, W([-gl.vertex - gl.d / 2, 0]), 0));
      items.push(body(shape, { n: EYE.nGlass, tint: "blue", name: "glasses", label: o.labels === false ? null : "glasses", labelAt: W([-gl.vertex - gl.d / 2, 12]) }));
    }
    return {
      type: "eye", at, length: L, retina: W([L, 0]), pupil, accommodation, amplitude, t, error: -vergence(focusDistance(eyeSurfaces(0, null), L)) || 0,
      glasses: gl ? { power: gl.power, vertex: gl.vertex } : null, power: -bare.C * 1000,
      farPoint, nearPoint, surfaces, items,
    };
  }
  // Light from an object `distance` mm in front of the cornea (Infinity: a parallel beam), filling the pupil.
  function eyeLight(E, distance = Infinity, o = {}) {
    const half = (E.pupil / 2) * (o.fill ?? 1.12), [x0, y0] = E.at, n = o.n ?? 9;
    if (!Number.isFinite(distance)) return beam([x0 - (o.from ?? (E.glasses ? E.glasses.vertex + 10 : 12)), y0 + (o.height ?? 0)], 0, 2 * half, { ...o, n });
    return fanTo([x0 - distance, y0 + (o.height ?? 0)], [x0, y0 - half], [x0, y0 + half], { ...o, n });
  }
  // Is an object at `distance` mm sharp? Paraxial, through the eye as it is now (lens, glasses).
  // diopters > 0: the focus falls behind the retina (needs more power); < 0: in front of it.
  function eyeFocus(E, distance = Infinity) {
    const s = E.surfaces, sFirst = Number.isFinite(distance) ? distance + s[0].x : Infinity;
    const img = imageX(s, sFirst), D = vergence(distance) - vergence(focusDistance(s, E.length));
    return { image: E.at[0] + img, retina: E.at[0] + E.length, defocus: img - E.length, diopters: D, sharp: Math.abs(D) <= 0.25,
      where: Math.abs(D) <= 0.25 ? "on" : D < 0 ? "front" : "behind", focusDistance: focusDistance(s, E.length) };
  }
  // Spectacle power (D) at `vertex` mm that moves the naked eye's far point to infinity.
  function correction(E, vertex = 12) {
    const F = focusDistance(eyeSurfaces(0, null), E.length);
    return Number.isFinite(F) ? 1000 / (vertex - F) : 0;
  }

  // ---------- Drawing helpers on g ----------
  (window.__safisG ||= []).push((g, util) => {
    let lastP = null;
    const dark = () => { const [r, gg, b] = util.rgb("panel"); return 0.2126 * r + 0.7152 * gg + 0.0722 * b < 110; };
    const cache = new Map();
    const spectral = (nm, dk) => { const k = `${nm}|${dk}`; let c = cache.get(k); if (!c) { c = wavelengthColor(nm, { on: dk ? "dark" : "light" }); cache.set(k, c); } return c; };
    g.wavelengthColor = nm => spectral(nm, dark());
    const ident = q => q;
    const scaleOf = P => P.sx ?? (dist(P([1, 0]), P([0, 0])) || 1);
    const dirPx = (P, p, d) => unit(sub(P(add(p, d)), P(p)));
    function piecePx(pc, P, sc) {
      if (pc.k === "seg") return [P(pc.a), P(pc.b)];
      const sweep = pc.a1 - pc.a0, n = clamp(Math.ceil((sweep * pc.r * sc) / 3), 6, 240), out = [];
      for (let i = 0; i <= n; i++) { const t = pc.a0 + (sweep * i) / n; out.push(P([pc.c[0] + pc.r * Math.cos(t), pc.c[1] + pc.r * Math.sin(t)])); }
      return out;
    }
    // The outline of a body as one closed polyline, joining pieces end to end.
    function outline(el, P, sc) {
      const parts = el.shape.map(pc => piecePx(pc, P, sc));
      if (parts.length > 1) {
        const a = parts[0], b = parts[1], ends = [b[0], b[b.length - 1]];
        if (Math.min(...ends.map(q => dist(a[0], q))) < Math.min(...ends.map(q => dist(a[a.length - 1], q)))) a.reverse();
      }
      const pts = [];
      for (const q of parts) { if (pts.length && dist(pts[pts.length - 1], q[q.length - 1]) < dist(pts[pts.length - 1], q[0])) q.reverse(); pts.push(...q); }
      return pts;
    }
    // A strip w px wide along a polyline, for walls, screens, and sensors.
    function strip(pts, w) {
      const L = [], R = [];
      pts.forEach((p, i) => {
        const t = unit(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
        L.push([p[0] - (t[1] * w) / 2, p[1] + (t[0] * w) / 2]); R.push([p[0] + (t[1] * w) / 2, p[1] - (t[0] * w) / 2]);
      });
      return [...L, ...R.reverse()];
    }
    function clipSeg(a, b, box) {
      let t0 = 0, t1 = 1;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      for (const [p, q] of [[-dx, a[0] - box[0]], [dx, box[0] + box[2] - a[0]], [-dy, a[1] - box[1]], [dy, box[1] + box[3] - a[1]]]) {
        if (p === 0) { if (q < 0) return null; continue; }
        const r = q / p;
        if (p < 0) { if (r > t1) return null; t0 = Math.max(t0, r); } else { if (r < t0) return null; t1 = Math.min(t1, r); }
      }
      return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
    }
    const tri = (tip, u, size) => {
      const b = sub(tip, mul(u, size)), w = size * 0.45;
      g.ctx.beginPath(); g.ctx.moveTo(tip[0], tip[1]); g.ctx.lineTo(b[0] - u[1] * w, b[1] + u[0] * w); g.ctx.lineTo(b[0] + u[1] * w, b[1] - u[0] * w); g.ctx.closePath(); g.ctx.fill();
    };
    const fillAlpha = (el, dk) => clamp(0.05 + 0.12 * (index(el.n) - 1), 0.07, 0.22) * (dk ? 1.5 : 1);

    function drawMirror(el, P, sc, lit) {
      for (const pc of el.shape) {
        const pts = piecePx(pc, P, sc);
        if (el.reflectance < 1) { g.path(pts, { stroke: "ink", width: lit ? 2.5 : 1.5, dash: [5, 3] }); continue; }
        if (el.face) {
          // Hatching on the back, a tick every 7 px.
          const len = pc.k === "seg" ? dist(pts[0], pts[1]) : (pc.a1 - pc.a0) * pc.r * sc, n = Math.max(1, Math.floor(len / 7));
          for (let i = 0; i < n; i++) {
            const s = (i + 0.5) / n;
            const q = pc.k === "seg" ? add(pc.a, mul(sub(pc.b, pc.a), s)) : add(pc.c, mul([Math.cos(pc.a0 + (pc.a1 - pc.a0) * s), Math.sin(pc.a0 + (pc.a1 - pc.a0) * s)], pc.r));
            const nb = mul(normalAt(pc, q[0], q[1]), -el.face), Q = P(q), b = dirPx(P, q, nb), t = [-b[1], b[0]];
            g.line(add(Q, mul(b, 1.5)), add(add(Q, mul(b, 7)), mul(t, 4)), { stroke: "muted", width: 1 });
          }
        }
        g.path(pts, { stroke: "ink", width: lit ? 3.5 : 2.5 });
      }
    }
    function drawThinLens(el, P, dk, lit) {
      const a = P(el.shape[0].a), b = P(el.shape[0].b), len = dist(a, b), u = unit(sub(b, a)), nv = [-u[1], u[0]], m = mul(add(a, b), 0.5), k = len * 0.06;
      const ctx = g.ctx;
      ctx.save();
      ctx.beginPath();
      if (el.f > 0) {
        ctx.moveTo(a[0], a[1]);
        ctx.quadraticCurveTo(m[0] + nv[0] * 2 * k, m[1] + nv[1] * 2 * k, b[0], b[1]);
        ctx.quadraticCurveTo(m[0] - nv[0] * 2 * k, m[1] - nv[1] * 2 * k, a[0], a[1]);
      } else {
        const A1 = add(a, mul(nv, k)), A2 = sub(a, mul(nv, k)), B1 = add(b, mul(nv, k)), B2 = sub(b, mul(nv, k));
        ctx.moveTo(A1[0], A1[1]);
        ctx.quadraticCurveTo(m[0] - nv[0] * k * 0.6, m[1] - nv[1] * k * 0.6, B1[0], B1[1]);
        ctx.lineTo(B2[0], B2[1]);
        ctx.quadraticCurveTo(m[0] + nv[0] * k * 0.6, m[1] + nv[1] * k * 0.6, A2[0], A2[1]);
        ctx.closePath();
      }
      ctx.fillStyle = util.rgba(el.color ?? "blue", (dk ? 0.24 : 0.14) * (lit ? 1.6 : 1));
      ctx.fill();
      ctx.strokeStyle = util.color("ink");
      ctx.lineWidth = lit ? 2.25 : 1.25;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
    }
    function drawAbsorber(el, P, sc, lit) {
      const w = el.width ?? (el.style === "wall" ? 7 : el.style === "screen" ? 6 : 4);
      for (const pc of el.shape) {
        const band = strip(piecePx(pc, P, sc), w);
        if (el.style === "wall") g.path(band, { fill: "panel", hatch: g.rgba("muted", 0.7), stroke: "ink", width: lit ? 2 : 1, close: true });
        else if (el.style === "screen") g.path(band, { fill: "grid", stroke: lit ? "ink" : "muted", width: lit ? 2 : 1, close: true });
        else g.path(band, { fill: g.rgba(el.color ?? "muted", 0.3), stroke: el.color ?? "muted", width: lit ? 2 : 1.2, close: true });
      }
    }
    function marks(el, P, dk) {
      const op = el.optic, out = [];
      if (!op) return;
      if (op.kind === "thin") out.push([add(op.c, mul(op.axis, op.f)), "F′"], [sub(op.c, mul(op.axis, op.f)), "F"]);
      else if (op.kind === "mirror") out.push([add(op.vertex, mul(op.axis, op.R / 2)), "F"], [add(op.vertex, mul(op.axis, op.R)), "C"]);
      else {
        const t = thick(index(op.n), op.R1, op.R2, op.d);
        if (!Number.isFinite(t.f)) return;
        out.push([add(add(op.c, mul(op.axis, op.d / 2)), mul(op.axis, t.bfd)), "F′"], [sub(sub(op.c, mul(op.axis, op.d / 2)), mul(op.axis, t.ffd)), "F"]);
      }
      for (const [q, name] of out) {
        const p = P(q);
        if (p[0] < -20 || p[0] > g.w + 20 || p[1] < -20 || p[1] > g.h + 20) continue;
        g.circle(p, 3.2, { fill: "ink", stroke: "panel", width: 1.5 });
        g.text(name, [p[0], p[1] + 15], { font: "serif", italic: true, size: 15, color: "ink", halo: true });
      }
    }

    // Traces the scene and draws it. Returns the trace, with hit.px (canvas position) on every hit and sensor record.
    g.optics = (scene, o = {}) => {
      const P = o.P ?? ident, sc = scaleOf(P), dk = dark();
      lastP = P;
      const { els, srcs } = split(scene);
      const T = o.trace ?? trace(scene, o);
      const show = o.elements !== false;
      const lit = el => !!el.name && g.lit(el.name);
      // Optical axes, then glass fills, so rays draw over them.
      if (o.axis) {
        const far = (4 * Math.max(g.w, g.h)) / sc;
        for (const el of els) {
          if (!el.optic || el.hidden) continue;
          const c = el.optic.c ?? el.optic.vertex, ax = el.optic.axis;
          g.line(P(sub(c, mul(ax, far))), P(add(c, mul(ax, far))), { stroke: "muted", width: 1, dash: [6, 5], alpha: 0.6 });
        }
      }
      if (show) for (const el of els) {
        if (el.type !== "body" || el.hidden) continue;
        g.path(outline(el, P, sc), { fill: el.tint ?? "blue", alpha: fillAlpha(el, dk) * (lit(el) ? 1.7 : 1), close: true });
      }
      // Rays: alpha by intensity, color by wavelength; added together on dark pages.
      if (o.rays !== false) {
        const ctx = g.ctx, w = o.width ?? 1.75, base = o.alpha ?? 1, minA = o.minAlpha ?? 0.12, gain = o.gain ?? 1;
        const segs = o.filter ? T.segments.filter(o.filter) : T.segments, alphaOf = s => clamp(Math.sqrt(s.I * gain), minA, 1) * base;
        const additive = o.blend === "add" || (o.blend !== "normal" && dk);
        const colorOf = s => (s.wl != null ? spectral(s.wl, dk) : util.color(s.band ? o.white ?? "ink" : s.color ?? o.color ?? "orange"));
        ctx.save();
        ctx.lineCap = "butt";
        ctx.lineJoin = "round";
        if (additive) ctx.globalCompositeOperation = "lighter";
        for (const s of segs) {
          const sl = srcs[s.src]?.name && g.lit(srcs[s.src].name);
          ctx.strokeStyle = colorOf(s);
          ctx.globalAlpha = alphaOf(s);
          ctx.lineWidth = sl ? w + 1.25 : w;
          const a = P(s.a), b = P(s.b);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
        if (o.arrows) {
          const size = o.arrowSize ?? 8;
          for (const s of segs) {
            if (o.arrows === "first" && s.depth > 0) continue;
            const v = clipSeg(P(s.a), P(s.b), [0, 0, g.w, g.h]);
            if (!v || dist(v[0], v[1]) < size * 5) continue;
            ctx.fillStyle = colorOf(s);
            ctx.globalAlpha = alphaOf(s);
            const u = unit(sub(v[1], v[0]));
            tri(add(mul(add(v[0], v[1]), 0.5), mul(u, size / 2)), u, size);
          }
        }
        ctx.restore();
      }
      if (show) {
        for (const el of els) {
          if (el.hidden) continue;
          if (el.type === "body") g.path(outline(el, P, sc), { stroke: "ink", width: lit(el) ? 2.5 : 1.25, close: true });
          else if (el.type === "mirror") drawMirror(el, P, sc, lit(el));
          else if (el.type === "lens") drawThinLens(el, P, dk, lit(el));
          else if (el.type === "absorber") drawAbsorber(el, P, sc, lit(el));
        }
        els.forEach((el, ei) => {
          if (!el.record || el.hidden || o.marks === false) return;
          for (const r of T.sensors[keyOf(el, ei)] ?? []) {
            const c = r.wl != null ? spectral(r.wl, dk) : r.band ? o.white ?? "ink" : r.color ?? srcs[r.src]?.color ?? o.color ?? "orange";
            g.circle(P(r.p), 2.4, { fill: c, alpha: clamp(Math.sqrt(r.I), 0.25, 1) });
          }
        });
        for (const s of srcs) {
          if (!s.marker || !s.at || o.sources === false) continue;
          const c = Array.isArray(s.wl) ? "ink" : s.wl != null ? spectral(s.wl, dk) : s.color ?? o.color ?? "orange";
          g.circle(P(s.at), 4.5, { fill: c, stroke: "panel", width: 1.5 });
        }
        if (o.focal) for (const el of els) if (!el.hidden) marks(el, P, dk);
        if (o.labels !== false) for (const el of els) {
          if (!el.label || el.hidden) continue;
          let p;
          if (el.labelAt) p = P(el.labelAt);
          else {
            const pts = el.shape.flatMap(pc => piecePx(pc, P, sc)), xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
            p = [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys) - 12];
          }
          g.label(el.label, p, { color: lit(el) ? "ink" : el.labelColor ?? "ink" });
        }
      }
      for (const h of T.hits) h.px = P(h.p);
      for (const k in T.sensors) for (const r of T.sensors[k]) r.px = P(r.p);
      return T;
    };

    // The normal at a hit with the angles of incidence, refraction, and reflection marked against it.
    // o: P (defaults to the last g.optics mapping), r [30] arc radius px, length [52] of the normal each side,
    // show ("auto": incidence plus refraction, or reflection at mirrors and total internal reflection;
    // or a string with any of "i", "t", "r"), names { i, t, r }, colors { i, t, r }, values [true], digits [1].
    g.rayAngles = (hit, o = {}) => {
      if (!hit) return null;
      const P = o.P ?? lastP ?? ident, c = P(hit.p), d = v => dirPx(P, hit.p, v);
      const n = d(hit.normal), L = o.length ?? 52, rad = o.r ?? 30;
      if (o.normal !== false) g.line(sub(c, mul(n, L)), add(c, mul(n, L)), { stroke: "muted", width: 1, dash: [4, 4] });
      const reflects = hit.kind === "mirror" || hit.kind === "tir";
      const show = o.show && o.show !== "auto" ? o.show : reflects ? "ir" : hit.kind === "refract" ? "it" : "i";
      const names = { i: hit.kind === "mirror" ? "θᵢ" : "θ₁", t: "θ₂", r: "θᵣ", ...o.names }, colors = { i: "blue", t: "purple", r: "green", ...o.colors };
      const fmt = a => `${a.toFixed(o.digits ?? 1)}°`;
      const wedge = (u, w, r, col, text) => {
        const a0 = Math.atan2(u[1], u[0]);
        let da = Math.atan2(w[1], w[0]) - a0;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        const pts = [];
        for (let k = 0; k <= 24; k++) { const a = a0 + (da * k) / 24; pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
        g.path([c, ...pts], { fill: col, alpha: 0.13, close: true });
        g.path(pts, { stroke: col, width: 1.5 });
        if (!text) return;
        // Beside the ray's end of the arc, on the side away from the normal, where the wedge isn't.
        let q = [-w[1], w[0]];
        if (q[0] * u[0] + q[1] * u[1] > 0) q = [-q[0], -q[1]];
        const k = (o.gap ?? 8) + 5 * Math.abs(q[1]);
        g.text(text, [c[0] + w[0] * (r + 2) + q[0] * k, c[1] + w[1] * (r + 2) + q[1] * k], { size: 13, weight: 600, color: col, halo: true, align: q[0] > 0.3 ? "left" : q[0] < -0.3 ? "right" : "center" });
      };
      const label = (key, a) => (o.labels === false ? null : o.values === false ? names[key] : `${names[key]} ${fmt(a)}`);
      if (show.includes("i")) wedge(n, d(mul(hit.din, -1)), rad, colors.i, label("i", hit.i));
      if (show.includes("t") && hit.t != null && hit.dout) wedge(mul(n, -1), d(hit.dout), rad, colors.t, label("t", hit.t));
      if (show.includes("r") && (hit.dr || hit.dout)) wedge(n, d(hit.dr ?? hit.dout), reflects ? rad : rad * 0.72, colors.r, label("r", hit.i));
      return { i: hit.i, t: hit.t, r: hit.i, at: c };
    };

    // A strip of the visible spectrum in box = [x, y, w, h]; o.range [380, 720] nm, o.marks [{ wl, label, color }].
    // Returns { x(nm) -> px, wl(px) -> nm }.
    g.visibleSpectrum = (box, o = {}) => {
      const [x, y, w, h] = box, [lo, hi] = o.range ?? [380, 720], ctx = g.ctx;
      const X = nm => x + ((nm - lo) / (hi - lo)) * w;
      ctx.save();
      for (let i = 0; i < w; i++) { ctx.fillStyle = wavelengthColor(lo + ((hi - lo) * (i + 0.5)) / w); ctx.fillRect(x + i, y, 1.5, h); }
      ctx.restore();
      g.rect(x, y, w, h, { stroke: "faint", width: 1 });
      if (o.ticks !== false) {
        const step = o.step ?? (w < 300 ? 100 : 50);
        for (let nm = Math.ceil(lo / step) * step; nm <= hi; nm += step) {
          g.line([X(nm), y + h], [X(nm), y + h + 4], { stroke: "muted", width: 1 });
          g.text(String(nm), [X(nm), y + h + 14], { size: 11, color: "muted" });
        }
        if (o.label !== false) g.text(o.label ?? "nm", [x + w + 6, y + h + 14], { size: 11, color: "muted", align: "left" });
      }
      for (const m of o.marks ?? []) {
        const px = X(m.wl);
        g.line([px, y - 5], [px, y + h + 2], { stroke: m.color ?? "ink", width: 2 });
        if (m.label) g.label(m.label, [px, y - 14], { color: m.color ?? "ink" });
      }
      return { x: X, wl: px => lo + ((px - x) / w) * (hi - lo), box };
    };

    // An eye from Optics.eye with light from an object o.distance mm away (Infinity by default):
    // traces and draws it, and marks where the image actually forms. Returns { trace, focus }.
    g.eye = (E, o = {}) => {
      const distance = o.distance ?? Infinity, P = o.P ?? ident;
      const src = o.source ?? eyeLight(E, distance, { n: o.n ?? 9, wl: o.wl, color: o.color });
      const T = g.optics([E.items, src], { minI: 0.05, ...o, P });
      const F = eyeFocus(E, distance);
      if (o.focus !== false && Number.isFinite(F.image) && Math.abs(F.defocus) < E.length) {
        const q = P([F.image, E.at[1]]), col = F.sharp ? "green" : "red";
        g.circle(q, 5, { stroke: col, width: 2 });
        if (!F.sharp && o.focusLabel !== false) g.label("focus", [q[0], q[1] - 15], { color: col });
      }
      return { trace: T, focus: F };
    };
  });

  window.Optics = {
    // materials and light
    materials: MATERIALS, index, abbe, dispersive, WHITE, spectrum, wavelengthRGB, wavelengthColor,
    // physics
    snell, critical, brewster, fresnel, image, lensmaker, thick, rainbow,
    // geometry and elements
    segment, arc, body, polygon, slab, prism, circle, drop, semicircle, lens, mirror, curvedMirror, thinLens, wall, screen, sensor, distance, inside,
    // sources
    ray, beam, fan, fanTo,
    // tracing and measuring
    trace, focus, spot,
    // the eye
    eye, eyeLight, eyeFocus, correction,
  };
})();

;

/* Sound kit (window.Sound): Web Audio voices with smooth parameters, plucked strings,
   noise through filters, ADSR envelopes, and buffers from f(t), all behind a master
   gain cap and limiter; plus real analysis (radix-2 FFT, spectra, spectrograms) and
   the g helpers that draw them. Reference: references/sound.md in the skill.
   Nothing makes a sound until the reader presses something: the AudioContext is
   created on the first user gesture, so a page that is never played stays silent. */
(() => {
  "use strict";
  const TAU = Math.PI * 2, SR = 44100, MASTER = 0.22;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const isPow2 = n => n > 0 && (n & (n - 1)) === 0;
  const nextPow2 = n => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
  const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  const hasDoc = typeof document !== "undefined";

  // Seeded random numbers (mulberry32), so noise is the same on every load.
  function rng(seed = 1) {
    let a = seed >>> 0 || 1;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Analysis ----------
  const plans = new Map();
  function plan(n) {
    let p = plans.get(n);
    if (p) return p;
    if (!isPow2(n)) throw new Error(`Sound.fft needs a power-of-two length, got ${n}`);
    const bits = Math.round(Math.log2(n)), rev = new Uint32Array(n), cos = new Float64Array(n / 2 || 1), sin = new Float64Array(n / 2 || 1);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1); rev[i] = r; }
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((TAU * i) / n); sin[i] = -Math.sin((TAU * i) / n); }
    p = { rev, cos, sin };
    plans.set(n, p);
    return p;
  }
  // In-place iterative radix-2 FFT: X[k] = sum x[n] e^(-2 pi i k n / N). inverse divides by N.
  function fft(re, im, inverse = false) {
    const n = re.length;
    im = im ?? new Float64Array(n);
    const { rev, cos, sin } = plan(n), sg = inverse ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step], wi = sg * sin[k * step], a = i + k, b = a + half;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    return { re, im };
  }
  const ifft = (re, im) => fft(re, im, true);

  // Window functions (periodic), cached by name and length.
  const wins = new Map();
  function windowOf(name, n) {
    const key = name + n;
    let w = wins.get(key);
    if (w) return w;
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = (TAU * i) / n;
      w[i] = name === "rect" || name === "none" ? 1 : name === "hamming" ? 0.54 - 0.46 * Math.cos(t)
        : name === "blackman" ? 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t) : 0.5 - 0.5 * Math.cos(t);
    }
    wins.set(key, w);
    return w;
  }

  // One-sided amplitude spectrum, scaled so a sine of amplitude A peaks at about A.
  // Returns size / 2 + 1 magnitudes; bin k is k * sampleRate / size Hz.
  function spectrum(x, o = {}) {
    const off = o.offset ?? 0, avail = Math.max(0, x.length - off);
    const size = o.size ?? nextPow2(Math.min(Math.max(avail, 2), 16384));
    if (!isPow2(size)) throw new Error(`Sound.spectrum size must be a power of two, got ${size}`);
    const len = Math.min(size, avail), w = windowOf(o.window ?? "hann", Math.max(1, len));
    const re = new Float64Array(size), im = new Float64Array(size);
    let sw = 0;
    for (let i = 0; i < len; i++) { re[i] = x[off + i] * w[i]; sw += w[i]; }
    fft(re, im);
    const half = size / 2, out = new Float32Array(half + 1), floor = o.floor ?? -120;
    for (let k = 0; k <= half; k++) {
      const m = Math.hypot(re[k], im[k]) / (sw || 1), a = k === 0 || k === half ? m : 2 * m;
      out[k] = o.db ? Math.max(floor, 20 * Math.log10(a + 1e-12)) : a;
    }
    return out;
  }
  const binFreq = (k, size, sampleRate = SR) => (k * sampleRate) / size;

  // The largest local maxima, refined by a parabola through the log magnitudes. With the
  // default Hann window the amplitude is corrected by the window's exact main-lobe shape.
  function peaks(mags, o = {}) {
    const hann = (o.window ?? "hann") === "hann";
    const n = mags.length, size = (n - 1) * 2, sr = o.sampleRate ?? SR;
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, mags[i]);
    const min = o.min ?? max * 1e-3, out = [];
    for (let k = 1; k < n - 1; k++) {
      const m = mags[k];
      if (m <= min || m < mags[k - 1] || m <= mags[k + 1]) continue;
      const a = Math.log(mags[k - 1] + 1e-30), b = Math.log(m + 1e-30), c = Math.log(mags[k + 1] + 1e-30);
      const d = a - 2 * b + c, p = d ? clamp((0.5 * (a - c)) / d, -0.5, 0.5) : 0;
      const lobe = p ? Math.abs(Math.sin(Math.PI * p) / (Math.PI * p)) / (1 - p * p) : 1;
      out.push({ bin: k + p, mag: hann ? m / lobe : Math.exp(b - 0.25 * (a - c) * p), freq: ((k + p) * sr) / size });
    }
    return out.sort((x, y) => y.mag - x.mag).slice(0, o.count ?? 5);
  }

  // Short-time spectra for a spectrogram: one magnitude array per hop.
  function stft(x, o = {}) {
    const size = o.size ?? 1024, hop = o.hop ?? size / 4, frames = [];
    const count = Math.max(1, Math.floor((x.length - size) / hop) + 1);
    for (let i = 0; i < count; i++) frames.push(spectrum(x, { size, offset: i * hop, window: o.window, db: o.db, floor: o.floor }));
    return frames;
  }

  const rms = x => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / (x.length || 1)); };

  // ---------- Synthesis, offline (pure functions, also used to draw what plays) ----------
  const typeOf = p => p.type ?? (p.harmonics ? "additive" : "sine");
  // Fourier amplitudes of the standard shapes, as sine-series coefficients.
  function partials(p, sr = SR) {
    const t = typeOf(p);
    if (p.harmonics) return p.harmonics;
    if (t === "sine") return [1];
    const K = clamp(Math.floor(sr / 2 / (p.freq ?? 220)), 1, 400), a = new Float64Array(K);
    for (let k = 1; k <= K; k++) {
      a[k - 1] = t === "square" ? (k % 2 ? 4 / (Math.PI * k) : 0)
        : t === "sawtooth" ? ((k % 2 ? 2 : -2) / (Math.PI * k))
        : t === "triangle" ? (k % 2 ? (((k - 1) / 2) % 2 ? -8 : 8) / (Math.PI * Math.PI * k * k) : 0) : 0;
    }
    return a;
  }
  // One period as a table, normalized to a peak of 1 (the same scaling the live voice uses).
  const tables = new Map();
  function cycleTable(amps, phases, n = 2048, normalize = true) {
    const key = `${n}|${normalize}|${Array.prototype.join.call(amps, ",")}|${phases ? phases.join(",") : ""}`;
    let tab = tables.get(key);
    if (tab) return tab;
    tab = new Float32Array(n);
    for (let k = 0; k < amps.length; k++) {
      const a = amps[k];
      if (!a) continue;
      const ph = phases?.[k] ?? 0;
      for (let i = 0; i < n; i++) tab[i] += a * Math.sin(((k + 1) * TAU * i) / n + ph);
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(tab[i]));
    const s = normalize ? 1 / (peak || 1) : 1 / Math.max(1, peak);
    for (let i = 0; i < n; i++) tab[i] *= s;
    tab.scale = s;
    if (tables.size > 64) tables.delete(tables.keys().next().value);
    tables.set(key, tab);
    return tab;
  }
  // `cycles` periods of a voice's waveform at n points, for drawing its shape.
  function cycle(p, o = {}) {
    const n = o.n ?? 512, cycles = o.cycles ?? 1, tab = cycleTable(partials(p, o.sampleRate ?? SR), p.phases, 2048, p.normalize !== false);
    const out = new Float32Array(n), g = clamp(p.gain ?? 1, 0, 1);
    for (let i = 0; i < n; i++) {
      const u = ((i / (n - 1 || 1)) * cycles % 1) * 2048, j = Math.floor(u), f = u - j;
      out[i] = g * (tab[j % 2048] * (1 - f) + tab[(j + 1) % 2048] * f);
    }
    return out;
  }

  function noise(n, o = {}) {
    const r = rng(o.seed ?? 7), color = o.color ?? "white", x = new Float32Array(n);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      if (color === "pink") {
        // Paul Kellet's filter: -3 dB per octave within 0.05 dB above 9 Hz.
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else if (color === "brown") { br = (br + 0.02 * w) / 1.02; x[i] = br * 3.5; }
      else x[i] = w;
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
    if (peak > 1) for (let i = 0; i < n; i++) x[i] /= peak;
    return x;
  }

  // RBJ cookbook biquad, the same formulas as Web Audio's BiquadFilterNode. q is linear for every type.
  function biquad(f, sr = SR) {
    const type = f.type ?? "lowpass", w = (TAU * clamp(f.freq ?? 1000, 1, sr / 2 - 1)) / sr;
    const cw = Math.cos(w), al = Math.sin(w) / (2 * Math.max(1e-4, f.q ?? Math.SQRT1_2)), A = 10 ** ((f.gain ?? 0) / 40);
    let b = [1, 0, 0], a = [1 + al, -2 * cw, 1 - al];
    if (type === "lowpass") b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2];
    else if (type === "highpass") b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
    else if (type === "bandpass") b = [al, 0, -al];
    else if (type === "notch") b = [1, -2 * cw, 1];
    else if (type === "allpass") b = [1 - al, -2 * cw, 1 + al];
    else if (type === "peaking") { b = [1 + al * A, -2 * cw, 1 - al * A]; a = [1 + al / A, -2 * cw, 1 - al / A]; }
    else throw new Error(`Sound: unknown filter type "${type}"`);
    return [b[0] / a[0], b[1] / a[0], b[2] / a[0], a[1] / a[0], a[2] / a[0]];
  }
  function filter(x, f, sr = SR) {
    const [b0, b1, b2, a1, a2] = biquad(f, sr), y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  // Magnitude response |H| of a filter at each frequency (Hz).
  function response(f, freqs, sr = SR) {
    const [b0, b1, b2, a1, a2] = biquad(f, sr);
    return Float32Array.from(freqs, hz => {
      const w = (TAU * hz) / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
      return Math.hypot(b0 + b1 * c1 + b2 * c2, b1 * s1 + b2 * s2) / Math.hypot(1 + a1 * c1 + a2 * c2, a1 * s1 + a2 * s2);
    });
  }

  // ADSR level at time t (s) for a note held for `held` seconds. Linear segments, like the live voice.
  const ENV = { a: 0.02, d: 0, s: 1, r: 0.08 };
  function adsr(t, env = ENV, held = Infinity) {
    const a = env.a ?? 0.01, d = env.d ?? 0.1, s = env.s ?? 0.8, r = env.r ?? 0.2;
    const level = u => (u <= 0 ? 0 : u < a ? u / a : u < a + d ? 1 - ((1 - s) * (u - a)) / d : s);
    if (t < held) return level(t);
    return r > 0 ? Math.max(0, level(held) * (1 - (t - held) / r)) : 0;
  }

  // Karplus-Strong plucked string: one period of the string's shape circulating in a delay
  // line through a two-point average (the loss that dulls high harmonics first). The shape
  // is the triangle a finger pulls the string into at `pick` (0 to 0.5 of its length),
  // plus filtered noise for `brightness`. An allpass supplies the fractional delay, so the pitch is exact.
  function karplus(o = {}) {
    const sr = o.sampleRate ?? SR, f = clamp(o.freq ?? 220, 20, sr / 4), n = Math.max(1, Math.round((o.duration ?? 2) * sr));
    const P = sr / f, N = Math.max(2, Math.floor(P - 0.6)), eta = P - 0.5 - N, C = (1 - eta) / (1 + eta);
    const rho = 10 ** (-3 / (Math.max(0.05, o.decay ?? 2) * f));   // per-loop gain: -60 dB after `decay` seconds
    const bright = clamp(o.brightness ?? 0.5, 0, 1), beta = clamp(o.pick ?? 0.2, 0.02, 0.5), r = rng(o.seed ?? 3);
    const exc = new Float32Array(N), k = 1 - bright * 0.95;
    let lp = 0, mean = 0, peak = 0;
    for (let i = 0; i < N; i++) {
      const u = i / N, tri = u < beta ? u / beta : (1 - u) / (1 - beta);
      lp += (1 - k) * (r() * 2 - 1 - lp);
      exc[i] = tri + bright * 0.7 * lp;
      mean += exc[i] / N;
    }
    for (let i = 0; i < N; i++) { exc[i] -= mean; peak = Math.max(peak, Math.abs(exc[i])); }   // no DC: it would ring on forever
    const y = new Float32Array(n);
    let apx = 0, apy = 0;
    for (let i = 0; i < n; i++) {
      const u = 0.5 * rho * ((i >= N ? y[i - N] : 0) + (i > N ? y[i - N - 1] : 0));
      const ap = C * u + apx - C * apy;
      apx = u; apy = ap;
      y[i] = (i < N ? exc[i] / (peak || 1) : 0) + ap;
    }
    let m = 0;
    for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(y[i]));
    const g = clamp(o.gain ?? 0.9, 0, 1) / (m || 1);
    for (let i = 0; i < n; i++) y[i] *= g;
    return y;
  }

  function fromFunction(fn, o = {}) {
    const sr = o.sampleRate ?? SR, n = Math.max(1, Math.round((o.duration ?? 1) * sr)), x = new Float32Array(n);
    for (let i = 0; i < n; i++) { const v = +fn(i / sr); x[i] = Number.isFinite(v) ? clamp(v, -1, 1) : 0; }
    return x;
  }

  // Render a voice spec (the same object Sound.voice takes) to samples.
  function render(p, o = {}) {
    const sr = o.sampleRate ?? SR, n = Math.max(1, Math.round((o.duration ?? 1) * sr)), t = typeOf(p);
    if (t === "pluck") return karplus({ ...p, duration: n / sr, sampleRate: sr });
    let x;
    if (t === "noise") x = noise(n, p);
    else {
      const tab = cycleTable(partials(p, sr), p.phases, 2048, p.normalize !== false), f = p.freq ?? 220;
      x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const u = (((f * i) / sr) % 1) * 2048, j = Math.floor(u), fr = u - j;
        x[i] = tab[j] * (1 - fr) + tab[(j + 1) % 2048] * fr;
      }
    }
    if (p.filter) x = filter(x, p.filter, sr);
    const g = clamp(p.gain ?? 1, 0, 1);
    if (p.env || o.env) {
      const env = p.env ?? o.env, held = o.held ?? n / sr - (env.r ?? 0.2);
      for (let i = 0; i < n; i++) x[i] *= g * adsr(i / sr, env, held);
    } else if (g !== 1) for (let i = 0; i < n; i++) x[i] *= g;
    return x;
  }

  // ---------- Live audio ----------
  let ac = null, master = null, volume = 1;
  const allowed = () => { const u = typeof navigator !== "undefined" && navigator.userActivation; return u ? u.hasBeenActive : true; };
  // The AudioContext, created on demand once the page has had a user gesture; null otherwise.
  function audio() {
    if (ac) { if (ac.state === "suspended" && allowed()) ac.resume().catch(() => {}); return ac; }
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AC || !allowed()) return null;
    try {
      ac = new AC({ latencyHint: "interactive" });
      master = ac.createGain();
      master.gain.value = MASTER * volume;
      const lim = ac.createDynamicsCompressor();   // a brick-wall-ish limiter after the gain cap
      lim.threshold.value = -12; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.15;
      master.connect(lim).connect(ac.destination);
    } catch { ac = null; }
    return ac;
  }

  const live = new Set();          // everything playing now: voices and one-shots
  const owners = new Map();        // figure element -> { el, fig, buttons }
  let pressing = null;             // the figure whose sound button is being pressed

  function ownerOf(fig) {
    const el = fig?.el ?? (fig && fig.nodeType === 1 ? fig : null);
    if (!el) return null;
    let rec = owners.get(el);
    if (!rec) {
      rec = { el, fig: null, buttons: [] };
      owners.set(el, rec);
      // The runtime says when the figure leaves the screen, resets, or goes away.
      el.addEventListener?.("safis:visibility", e => { if (!e.detail?.visible) stopOwner(el); });
      el.addEventListener?.("safis:reset", () => stopOwner(el));
      el.addEventListener?.("safis:destroy", () => stopOwner(el));
    }
    if (fig.el) rec.fig = fig;
    return el;
  }
  // One figure plays at a time: starting a sound stops what other figures are playing.
  function claim(p, o) {
    const fig = o.fig ?? pressing;
    if (fig) p.owner = ownerOf(fig);
    for (const q of [...live]) if (q !== p && q.owner !== p.owner) q.stop();
  }
  function stopOwner(el) { for (const q of [...live]) if (q.owner === el) q.stop(); }
  function stopAll() { for (const q of [...live]) q.stop(); }
  // Tell the figure to redraw; its buttons relabel themselves from text() and pressed().
  function changed(el) {
    const rec = el && owners.get(el);
    if (!rec) return;
    for (const b of rec.buttons) {
      const on = b.isOn();
      if (b.animate && rec.fig && b.was !== on) rec.fig.play(on);
      b.was = on;
    }
    rec.fig?.redraw?.();
  }
  if (hasDoc) {
    document.addEventListener("visibilitychange", () => { if (document.hidden) stopAll(); });
    addEventListener("pagehide", stopAll);
  }

  const same = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (ArrayBuffer.isView(a) || Array.isArray(a)) return a.length === b.length && Array.prototype.every.call(a, (x, i) => x === b[i]);
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every(k => a[k] === b[k]);
  };
  const copy = v => (ArrayBuffer.isView(v) || Array.isArray(v) ? Array.from(v) : v && typeof v === "object" ? { ...v } : v);
  const envOf = p => ({ ...ENV, ...(p.env ?? {}) });
  const MAXP = 64;

  function setFilter(node, f, t, tc) {
    if (!f) { node.type = "allpass"; return; }
    if (node.type !== (f.type ?? "lowpass")) node.type = f.type ?? "lowpass";
    const q = Math.max(1e-4, f.q ?? Math.SQRT1_2), lphp = node.type === "lowpass" || node.type === "highpass";
    node.frequency.setTargetAtTime(clamp(f.freq ?? 1000, 10, node.context.sampleRate / 2 - 10), t, tc);
    node.Q.setTargetAtTime(lphp ? 20 * Math.log10(q) : q, t, tc);    // Web Audio takes Q in dB for these two
    node.gain.setTargetAtTime(f.gain ?? 0, t, tc);
  }
  function addPartial(n, k, t) {
    const ctx = n.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(g).connect(n.filter);
    osc.start(t);
    n.srcs.push(osc);
    n.bank.push({ osc, g, k, ph: null });
  }
  function applyPartials(n, p, t, tc) {
    const amps = p.harmonics ?? [1], f = p.freq ?? 220, ny = n.ctx.sampleRate / 2;
    while (n.bank.length < Math.min(MAXP, amps.length)) addPartial(n, n.bank.length + 1, n.ctx.currentTime);
    const scale = cycleTable(amps.slice(0, MAXP), p.phases, 512, p.normalize !== false).scale;
    for (const b of n.bank) {
      const a = (amps[b.k - 1] ?? 0) * scale, ph = (p.phases?.[b.k - 1] ?? 0) + (a < 0 ? Math.PI : 0);
      if (ph !== b.ph) {
        // A sine with a phase offset: sin(x + ph) = cos(ph) sin x + sin(ph) cos x.
        b.osc.setPeriodicWave(n.ctx.createPeriodicWave(new Float32Array([0, Math.sin(ph)]), new Float32Array([0, Math.cos(ph)]), { disableNormalization: true }));
        b.ph = ph;
      }
      b.osc.frequency.setTargetAtTime(b.k * f, t, tc);
      b.g.gain.setTargetAtTime(b.k * f < ny ? Math.abs(a) : 0, t, tc);
    }
  }
  function build(ctx, p) {
    const t = ctx.currentTime, type = typeOf(p), env = envOf(p);
    const n = { ctx, type, srcs: [], bank: [], color: p.color };
    n.filter = ctx.createBiquadFilter();
    n.env = ctx.createGain();
    n.out = ctx.createGain();
    n.out.gain.value = clamp(p.gain ?? 1, 0, 1);
    n.filter.connect(n.env).connect(n.out).connect(master);
    setFilter(n.filter, p.filter, t, 0.001);
    n.env.gain.setValueAtTime(0, t);
    n.env.gain.linearRampToValueAtTime(1, t + Math.max(0.003, env.a));
    if (env.d > 0) n.env.gain.linearRampToValueAtTime(env.s, t + Math.max(0.003, env.a) + env.d);
    if (type === "noise") newNoise(n, p, t);
    else if (type === "additive") applyPartials(n, p, t, 0.001);
    else {
      const osc = ctx.createOscillator();
      osc.type = ["square", "sawtooth", "triangle"].includes(type) ? type : "sine";
      osc.frequency.value = p.freq ?? 220;
      osc.connect(n.filter);
      osc.start(t);
      n.srcs.push(osc);
      n.osc = osc;
    }
    return n;
  }
  function newNoise(n, p, t) {
    const ctx = n.ctx, buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    buf.getChannelData(0).set(noise(buf.length, { color: p.color, seed: p.seed }));
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(n.filter);
    src.start(t);
    if (n.noise) { n.noise.stop(t + 0.02); n.srcs = n.srcs.filter(s => s !== n.noise); }
    n.noise = src; n.color = p.color;
    n.srcs.push(src);
  }
  function update(n, p) {
    const t = n.ctx.currentTime, tc = p.glide ?? 0.03;
    n.out.gain.setTargetAtTime(clamp(p.gain ?? 1, 0, 1), t, tc);
    setFilter(n.filter, p.filter, t, tc);
    if (n.type === "noise") { if (p.color !== n.color) newNoise(n, p, t); }
    else if (n.type === "additive") applyPartials(n, p, t, tc);
    else if (n.osc) n.osc.frequency.setTargetAtTime(p.freq ?? 220, t, tc);
  }
  function release(n, p, elapsed) {
    const t = n.ctx.currentTime, env = envOf(p), r = Math.max(0.01, env.r);
    n.env.gain.cancelScheduledValues(t);
    n.env.gain.setValueAtTime(adsr(elapsed, env), t);
    n.env.gain.linearRampToValueAtTime(0, t + r);
    for (const s of n.srcs) { try { s.stop(t + r + 0.05); } catch {} }
    setTimeout(() => { try { n.out.disconnect(); } catch {} }, (r + 0.3) * 1000);
  }

  // A continuous voice. Parameters glide (setTargetAtTime), so calling set() from draw() is cheap and smooth.
  class Voice {
    constructor(o = {}) {
      this.params = {};
      for (const k in o) this.params[k] = copy(o[k]);
      this.params.type = typeOf(o);
      this.playing = false; this.owner = null; this.t0 = 0; this.n = null;
    }
    get elapsed() { return this.playing ? clock() - this.t0 : 0; }
    get audible() { return !!this.n; }
    start(o = {}) {
      if (this.playing) return this;
      claim(this, o);
      this.playing = true; this.t0 = clock();
      live.add(this);
      const ctx = audio();
      if (ctx) this.n = build(ctx, this.params);
      changed(this.owner);
      return this;
    }
    stop() {
      if (!this.playing) return this;
      this.playing = false;
      live.delete(this);
      if (this.n) release(this.n, this.params, clock() - this.t0);
      this.n = null;
      changed(this.owner);
      return this;
    }
    toggle(on = !this.playing, o) { return on ? this.start(o) : this.stop(); }
    set(p) {
      let dirty = false;
      for (const k in p) if (k !== "type" && !same(this.params[k], p[k])) { this.params[k] = copy(p[k]); dirty = true; }
      if (dirty && this.n) update(this.n, this.params);
      return this;
    }
  }
  const voice = o => new Voice(o);

  // Play samples, a function f(t), or a voice spec once. Returns a playback with stop() and progress.
  function play(src, o = {}) {
    const ctx = audio(), rate0 = ctx ? ctx.sampleRate : SR;
    let x = src, rate = o.sampleRate ?? SR;
    if (typeof src === "function") { rate = rate0; x = fromFunction(src, { duration: o.duration ?? 1, sampleRate: rate }); }
    else if (src && !ArrayBuffer.isView(src) && !Array.isArray(src)) { rate = rate0; x = render(src, { duration: o.duration ?? (typeOf(src) === "pluck" ? 2 : 1), sampleRate: rate }); }
    let timer = null, node = null, gain = null;
    const pb = {
      playing: true, owner: null, duration: x.length / rate, t0: clock(),
      get elapsed() { return this.playing ? clock() - this.t0 : 0; },
      get progress() { return this.playing ? clamp((clock() - this.t0) / this.duration, 0, 1) : 0; },
      stop() {
        if (!this.playing) return this;
        if (node) { try { gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01); node.stop(ctx.currentTime + 0.06); } catch {} }
        end();
        return this;
      },
    };
    function end() {
      if (!pb.playing) return;
      pb.playing = false;
      clearTimeout(timer);
      live.delete(pb);
      changed(pb.owner);
      o.onend?.();
    }
    claim(pb, o);
    live.add(pb);
    if (ctx && x.length) {
      const buf = ctx.createBuffer(1, x.length, rate), d = buf.getChannelData(0), fade = Math.min(x.length / 2, Math.round(rate * 0.003));
      let peak = 0;
      for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
      const s = peak > 1 ? 1 / peak : 1;
      for (let i = 0; i < x.length; i++) d[i] = x[i] * s * (o.loop ? 1 : Math.min(1, i / fade, (x.length - 1 - i) / fade));
      node = ctx.createBufferSource();
      node.buffer = buf; node.loop = !!o.loop;
      gain = ctx.createGain();
      gain.gain.value = clamp(o.gain ?? 1, 0, 1);
      node.connect(gain).connect(master);
      node.onended = end;
      node.start();
    } else if (!o.loop) timer = setTimeout(end, pb.duration * 1000);
    return pb;
  }
  const pluck = (o = {}) => play(karplus({ ...o, sampleRate: audio()?.sampleRate ?? SR }), { ...o, sampleRate: audio()?.sampleRate ?? SR, gain: 1 });

  // A play/stop button control for a figure. target: a voice, a list of voices, or
  // fn(s, v, fig) that starts one-shots (Sound.play, Sound.pluck) and returns them.
  function button(target, o = {}) {
    const voices = typeof target === "function" ? null : [].concat(target);
    const label = o.label ?? "Play", stopLabel = o.stopLabel ?? "Stop", toggle = o.toggle ?? !!voices;
    let shots = [];
    const isOn = () => (voices ?? shots).some(x => x.playing);
    const ctl = {
      type: "button", label, primary: o.primary ?? true, color: o.color, hidden: o.hidden,
      text: toggle ? () => (isOn() ? stopLabel : label) : undefined,
      pressed: toggle ? () => isOn() : undefined,
      action(s, v, fig) {
        audio();                              // inside the click, so the browser lets audio start
        const el = ownerOf(fig), rec = owners.get(el);
        if (rec && !rec.buttons.some(b => b.ctl === ctl)) rec.buttons.push({ ctl, isOn, animate: !!o.animate, was: false });
        pressing = fig;
        try {
          if (toggle && isOn()) (voices ?? shots).forEach(x => x.stop());
          else if (voices) voices.forEach(x => x.start());
          else shots = [].concat(target(s, v, fig) ?? []).filter(x => x && typeof x.stop === "function");
        } finally { pressing = null; }
        changed(el);
      },
    };
    return ctl;
  }
  const playingIn = fig => { const el = fig?.el ?? fig; return [...live].some(q => q.owner === el); };

  // ---------- Drawing helpers on g ----------
  (window.__safisG ||= []).push((g, util) => {
    const C = c => util.color(c);
    const fmtHz = f => (f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);
    const db = (m, floor) => Math.max(floor, 20 * Math.log10(m + 1e-12));

    // Samples as a trace. Long signals draw as a min/max band per pixel column, like an audio editor.
    g.waveform = (x, box = [0, 0, g.w, g.h], o = {}) => {
      const [bx, by, bw, bh] = box, from = o.from ?? 0, to = Math.min(x.length, o.to ?? x.length), n = Math.max(1, to - from);
      const [lo, hi] = o.range ?? [-1, 1], c = o.color ?? "blue";
      const X = i => bx + (bw * (i - from)) / Math.max(1, n - 1), Y = v => by + (bh * (hi - v)) / (hi - lo);
      if (o.zero !== false && lo < 0 && hi > 0) g.line([bx, Y(0)], [bx + bw, Y(0)], { stroke: "grid", width: 1 });
      g.clip([bx - 2, by - 2, bw + 4, bh + 4], () => {
        if (n > bw * 1.5) {
          const cols = Math.max(1, Math.round(bw)), top = [], bot = [];
          for (let c2 = 0; c2 < cols; c2++) {
            const i0 = from + Math.floor((c2 * n) / cols), i1 = Math.max(i0 + 1, from + Math.floor(((c2 + 1) * n) / cols));
            let mn = Infinity, mx = -Infinity;
            for (let i = i0; i < i1 && i < to; i++) { const v = x[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
            const px = bx + ((c2 + 0.5) * bw) / cols;
            top.push([px, Y(mx)]); bot.push([px, Y(mn) + 0.75]);
          }
          g.path(top.concat(bot.reverse()), { fill: c, alpha: o.alpha ?? 0.9, close: true });
        } else {
          const pts = [];
          for (let i = from; i < to; i++) pts.push([X(i), Y(x[i])]);
          if (o.fill) g.path([[X(from), Y(0)], ...pts, [X(to - 1), Y(0)]], { fill: c, alpha: 0.14, close: true });
          if (o.stems) for (const p of pts) { g.line([p[0], Y(0)], p, { stroke: c, width: 1.25, alpha: 0.7 }); g.circle(p, o.dot ?? 2.5, { fill: c }); }
          else g.path(pts, { stroke: c, width: o.width ?? 2 });
        }
      });
      if (o.playhead != null) {
        const px = bx + clamp(o.playhead, 0, 1) * bw;
        g.line([px, by], [px, by + bh], { stroke: "ink", width: 1.5 });
      }
      if (o.label) g.label(o.label, [bx + 6, by + 10], { align: "left", color: c });
      return { box, x: X, y: Y, index: px => clamp(Math.round(from + ((px - bx) / bw) * (n - 1)), from, to - 1) };
    };

    // An amplitude spectrum: mags from Sound.spectrum (linear), or partial amplitudes with o.freqs.
    g.spectrum = (mags, box = [0, 0, g.w, g.h], o = {}) => {
      const sr = o.sampleRate ?? SR, size = (mags.length - 1) * 2, floor = o.floor ?? -80, c = o.color ?? "blue";
      const freqs = o.freqs ?? null, hz = k => (freqs ? freqs[k] : (k * sr) / size);
      const f0 = o.minFreq ?? (o.log ? 20 : 0), f1 = o.maxFreq ?? (freqs ? Math.max(...freqs) * 1.1 : sr / 2);
      const val = m => (o.db ? db(Math.abs(m), floor) : Math.abs(m));
      const yr = o.range ?? (o.db ? [floor, 0] : [0, 1]);
      let P = null;
      if (g.graph && o.axes !== false) {
        P = g.graph({ box, x: [f0, f1], y: yr, axes: "frame", xScale: o.log ? "log" : "linear", grid: o.grid ?? false, xFormat: o.xFormat ?? fmtHz,
          yFormat: o.yFormat, yTicks: o.yTicks ?? (o.db ? undefined : false), xTicks: o.xTicks, xLabel: o.xLabel ?? "", yLabel: o.yLabel ?? (o.db ? "dB" : ""), zeroLine: false, pad: o.pad });
      } else {
        const L = Math.log10;
        const fx = f => box[0] + (box[2] * (o.log ? (L(Math.max(f, 1e-9)) - L(f0)) / (L(f1) - L(f0)) : (f - f0) / (f1 - f0)));
        P = p => [fx(p[0]), box[1] + (box[3] * (yr[1] - p[1])) / (yr[1] - yr[0])];
        P.box = box; P.clip = fn => g.clip(box, fn);
      }
      const base = yr[0], style = o.style ?? (freqs ? "stems" : "line");
      P.clip(() => {
        if (style === "stems" || style === "bars") {
          const bw = style === "bars" ? Math.max(1, (P.box[2] / Math.max(1, (f1 - f0) / (sr / size))) * 0.8) : 0;
          for (let k = 0; k < mags.length; k++) {
            const f = hz(k), v = val(mags[k]);
            if (f < f0 || f > f1 || v <= base) continue;
            const a = P([f, base]), b = P([f, v]), hot = o.highlight === k;
            if (bw) g.rect(b[0] - bw / 2, b[1], bw, a[1] - b[1], { fill: hot ? "ink" : c, alpha: 0.85 });
            else { g.line(a, b, { stroke: hot ? "ink" : c, width: 2.5 }); g.circle(b, 3.5, { fill: hot ? "ink" : c }); }
          }
        } else {
          const pts = [];
          for (let k = 0; k < mags.length; k++) { const f = hz(k); if (f >= f0 && f <= f1 && (!o.log || f > 0)) pts.push(P([f, val(mags[k])])); }
          if (pts.length > 1) {
            const yb = P([f0, base])[1];
            if (o.fill !== false) g.path([[pts[0][0], yb], ...pts, [pts[pts.length - 1][0], yb]], { fill: c, alpha: 0.14, close: true });
            g.path(pts, { stroke: c, width: o.width ?? 1.75 });
          }
        }
      });
      if (o.peaks) {
        const list = freqs ? [...mags].map((m, k) => ({ freq: hz(k), mag: Math.abs(m) })).sort((a, b) => b.mag - a.mag).slice(0, o.peaks) : peaks(mags, { count: o.peaks, sampleRate: sr });
        for (const p of list) if (p.freq >= f0 && p.freq <= f1) { const q = P([p.freq, val(p.mag)]); g.label(fmtHz(p.freq), [q[0], q[1] - 12], { color: c, size: 12 }); }
      }
      return { P, box: P.box, x: f => P([f, base])[0], y: m => P([f0, val(m)])[1] };
    };

    // Short-time spectra as an image: time across, frequency up, loudness as ink.
    const sgCache = new WeakMap();
    g.spectrogram = (frames, box = [0, 0, g.w, g.h], o = {}) => {
      const sr = o.sampleRate ?? SR, bins = frames[0]?.length ?? 0, size = (bins - 1) * 2, floor = o.floor ?? -80, ref = o.ref ?? 1;
      const maxF = Math.min(o.maxFreq ?? sr / 2, sr / 2), nb = Math.max(1, Math.min(bins, Math.round((maxF / (sr / 2)) * (bins - 1)) + 1));
      const hop = o.hop ?? size / 4, dur = (frames.length * hop) / sr;
      let P = null, area = box;
      if (g.graph && o.axes !== false) {
        P = g.graph({ box, x: [0, dur], y: [0, maxF], axes: "frame", grid: false, xFormat: o.xFormat ?? (t => `${+t.toFixed(2)} s`), yFormat: o.yFormat ?? fmtHz, xLabel: o.xLabel ?? "", yLabel: o.yLabel ?? "", zeroLine: false, pad: o.pad });
        area = P.box;
      }
      const key = `${C("panel")}|${C(o.color ?? "ink")}|${floor}|${ref}|${nb}|${o.gamma ?? 1}`;
      let hit = sgCache.get(frames);
      if (!hit || hit.key !== key) {
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, frames.length); cv.height = nb;
        const c2 = cv.getContext("2d"), img = c2.createImageData(cv.width, nb), lo = util.rgb("panel"), hi = util.rgb(o.color ?? "ink");
        for (let i = 0; i < frames.length; i++) for (let k = 0; k < nb; k++) {
          const t = clamp((db(frames[i][k] / ref, floor) - floor) / -floor, 0, 1) ** (o.gamma ?? 1), q = ((nb - 1 - k) * cv.width + i) * 4;
          img.data[q] = lo[0] + (hi[0] - lo[0]) * t; img.data[q + 1] = lo[1] + (hi[1] - lo[1]) * t; img.data[q + 2] = lo[2] + (hi[2] - lo[2]) * t; img.data[q + 3] = 255;
        }
        c2.putImageData(img, 0, 0);
        hit = { key, cv };
        sgCache.set(frames, hit);
      }
      const ctx = g.ctx;
      ctx.save();
      ctx.imageSmoothingEnabled = o.smooth !== false;
      ctx.drawImage(hit.cv, area[0], area[1], area[2], area[3]);
      ctx.restore();
      if (o.playhead != null) { const px = area[0] + clamp(o.playhead, 0, 1) * area[2]; g.line([px, area[1]], [px, area[1] + area[3]], { stroke: o.playheadColor ?? "red", width: 1.5 }); }
      return { P, box: area, time: px => ((px - area[0]) / area[2]) * dur, freq: py => (1 - (py - area[1]) / area[3]) * maxF };
    };

    // An ADSR envelope as a shape, with its four phases named.
    g.envelope = (env, box = [0, 0, g.w, g.h], o = {}) => {
      const e = { ...ENV, ...env }, held = o.held ?? e.a + e.d + Math.max(0.25, (e.a + e.d + e.r) * 0.8), T = held + e.r;
      const [bx, by, bw, bh] = box, c = o.color ?? "orange", X = t => bx + (bw * t) / T, Y = v => by + bh * (1 - v);
      g.line([bx, Y(0)], [bx + bw, Y(0)], { stroke: "muted", width: 1 });
      const pts = [0, e.a, e.a + e.d, held, T].map(t => [X(t), Y(adsr(t, e, held))]);
      g.path([...pts, [X(T), Y(0)]], { fill: c, alpha: 0.12, close: true });
      g.path(pts, { stroke: c, width: 2.5 });
      if (o.labels !== false) {
        const names = ["attack", "decay", "sustain", "release"], ts = [0, e.a, e.a + e.d, held, T];
        names.forEach((s, i) => { if (ts[i + 1] - ts[i] > 1e-6 && X(ts[i + 1]) - X(ts[i]) > g.measure(s, { size: 11.5 }) * 0.7) g.text(s, [(X(ts[i]) + X(ts[i + 1])) / 2, Y(0) + 12], { size: 11.5, color: "muted" }); });
      }
      if (o.t != null && o.t >= 0 && o.t <= T) { const p = [X(o.t), Y(adsr(o.t, e, held))]; g.line([p[0], Y(0)], p, { stroke: "ink", width: 1, dash: [3, 3] }); g.circle(p, 4.5, { fill: "ink" }); }
      return { box, x: X, y: Y, held, T };
    };
  });

  window.Sound = {
    voice, play, pluck, button, stopAll, playing: playingIn,
    get ready() { return !!ac && ac.state === "running"; },
    get context() { return ac; },
    get volume() { return volume; },
    set volume(v) { volume = clamp(+v || 0, 0, 1); if (master) master.gain.setTargetAtTime(MASTER * volume, ac.currentTime, 0.05); },
    wake: () => !!audio(),   // create or resume the AudioContext; call only inside a user gesture
    // Offline synthesis
    render, cycle, partials, karplus, noise, fromFunction, adsr, filter, response, biquad,
    // Analysis
    fft, ifft, spectrum, stft, peaks, binFreq, rms, window: windowOf, nextPow2, sampleRate: SR, rng,
  };
})();

;

/* Image kit (window.Img): procedural test images, pixel operations (convolution, resampling,
   quantization, dithering, the 8x8 DCT behind JPEG, histograms), and crisp pixel drawing
   on g. An image is { w, h, data: Float32Array RGB, row by row, values 0 to 1 }.
   Operations never change their input; they return new images, cached by their parameters.
   Reference: references/images.md in the skill. */
(() => {
  "use strict";
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hasDoc = typeof document !== "undefined";

  // ---------- Images, ids, and the cache ----------
  let nextId = 1;
  const anon = new WeakMap();
  const idOf = im => im.id ?? anon.get(im) ?? (anon.set(im, `a${nextId++}`), anon.get(im));
  function image(w, h, data) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    return { w, h, data: data ?? new Float32Array(w * h * 3), id: nextId++ };
  }
  // Least recently used results, kept under a memory budget (about 24 MB of pixels).
  const cache = new Map();
  let cached = 0;
  const BUDGET = 6e6;
  const sizeOf = v => (v?.data?.length ?? 0) + (v?.img?.data?.length ?? 0) + (v?.length ?? 0);
  function memo(key, fn) {
    if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
    const v = fn();
    cache.set(key, v); cached += sizeOf(v);
    while ((cached > BUDGET || cache.size > 120) && cache.size > 1) {
      const k = cache.keys().next().value;
      cached -= sizeOf(cache.get(k)); cache.delete(k);
    }
    return v;
  }
  const lumaOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;   // BT.601, the weights JPEG uses

  function make(w, h, fn) {
    const im = image(w, h), d = im.data;
    for (let y = 0, i = 0; y < im.h; y++) for (let x = 0; x < im.w; x++, i += 3) {
      const v = fn(x, y, (x + 0.5) / im.w, (y + 0.5) / im.h);
      if (typeof v === "number") d[i] = d[i + 1] = d[i + 2] = v;
      else { d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; }
    }
    return im;
  }
  const get = (im, x, y) => { const i = (clamp(Math.round(y), 0, im.h - 1) * im.w + clamp(Math.round(x), 0, im.w - 1)) * 3; return [im.data[i], im.data[i + 1], im.data[i + 2]]; };
  const isGray = im => { const d = im.data; for (let i = 0; i < d.length; i += 3) if (d[i] !== d[i + 1] || d[i] !== d[i + 2]) return false; return true; };

  // ---------- Test images ----------
  function rng(seed = 1) {
    let a = seed >>> 0 || 1;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function valueNoise(seed) {
    const N = 64, r = rng(seed), grid = new Float32Array(N * N);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const i0 = ((xi % N) + N) % N, j0 = ((yi % N) + N) % N, i1 = (i0 + 1) % N, j1 = (j0 + 1) % N;
      const a = grid[j0 * N + i0], b = grid[j0 * N + i1], c = grid[j1 * N + i0], d = grid[j1 * N + i1];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  }
  // A country scene with what a photo has: smooth sky, texture, hard edges, fine repeats (the
  // fence aliases when shrunk), saturated colors, and tones from shadow to highlight.
  function scene(w = 128, h = w, o = {}) {
    return memo(`scene|${w}|${h}|${o.seed ?? 1}`, () => {
      const N = valueNoise(o.seed ?? 1), fbm = (x, y) => (N(x, y) * 4 + N(x * 2.03, y * 2.03) * 2 + N(x * 4.1, y * 4.1)) / 7;
      const col = (u, v) => {
        const mount = 0.4 + 0.07 * Math.sin(u * 7 + 1) + 0.045 * Math.sin(u * 17 + 2) + 0.05 * (N(u * 9, 3.3) - 0.5);
        const hill = 0.6 + 0.035 * Math.sin(u * 5 + 0.5) + 0.018 * Math.sin(u * 13);
        let r, g, b;
        if (v < mount) {
          const t = Math.pow(v / mount, 1.3), d = Math.hypot(u - 0.76, v - 0.17), glow = 0.4 * Math.exp(-((d / 0.13) ** 2));
          r = 0.2 + 0.52 * t + glow; g = 0.42 + 0.42 * t + glow * 0.85; b = 0.78 + 0.16 * t + glow * 0.4;
          const cl = smooth(0.5, 0.72, fbm(u * 5, v * 11)) * Math.exp(-(((v - 0.25) / 0.09) ** 2)) * 0.9;
          r += (0.97 - r) * cl; g += (0.97 - g) * cl; b += (0.98 - b) * cl;
          const sun = smooth(0.056, 0.05, d);
          r += (1 - r) * sun; g += (0.95 - g) * sun; b += (0.78 - b) * sun;
        } else if (v < hill) {
          const tex = N(u * 34, v * 34) - 0.5, k = 0.92 + 0.3 * tex - 0.25 * (v - mount);
          r = 0.4 * k + 0.12; g = 0.45 * k + 0.12; b = 0.56 * k + 0.13;
          if (mount < 0.38 && v < mount + (0.38 - mount) * 0.85 + 0.01 * tex) { r = 0.9 + 0.08 * tex; g = 0.92 + 0.08 * tex; b = 0.97 + 0.04 * tex; }
        } else {
          const tex = fbm(u * 40, v * 70), dark = 1 - 0.35 * (v - hill) / (1 - hill);
          r = (0.2 + 0.18 * tex) * dark; g = (0.42 + 0.28 * tex) * dark; b = (0.14 + 0.12 * tex) * dark;
          const pc = 0.64 - (v - hill) * 0.3, pw = 0.008 + (v - hill) * 0.42;
          if (Math.abs(u - pc) < pw) { const k = 0.82 + 0.3 * tex; r = 0.8 * k; g = 0.69 * k; b = 0.5 * k; }
        }
        // A tree in front of the hills.
        const dt = Math.hypot((u - 0.12) * 1.1, v - 0.55);
        if (u > 0.108 && u < 0.134 && v > 0.58 && v < 0.7) { r = 0.33; g = 0.21; b = 0.12; }
        if (dt < 0.085 + 0.022 * (N(u * 30, v * 30) - 0.5)) { const k = 0.6 + 0.8 * fbm(u * 26, v * 26) - (v - 0.5) * 1.2; r = 0.1 * k; g = 0.3 * k; b = 0.12 * k; }
        // A house: white wall, red roof with shingle lines, window, door, chimney.
        if (u > 0.41 && u < 0.44 && v > 0.45 && v < 0.52) { r = 0.55; g = 0.22; b = 0.16; }
        if (v > 0.44 && v < 0.552 && Math.abs(u - 0.36) < ((v - 0.44) / 0.112) * 0.125) {
          const s = (v - 0.44) % 0.0125 < 0.002 ? 0.7 : 1; r = 0.74 * s; g = 0.17 * s; b = 0.12 * s;
        }
        if (u > 0.26 && u < 0.46 && v >= 0.552 && v < 0.71) {
          r = 0.94 - 0.15 * (u - 0.26); g = 0.91 - 0.15 * (u - 0.26); b = 0.84 - 0.12 * (u - 0.26);
          if (u > 0.285 && u < 0.345 && v > 0.578 && v < 0.64) {
            const bar = Math.abs(u - 0.315) < 0.003 || Math.abs(v - 0.609) < 0.003;
            r = bar ? 0.95 : 0.16; g = bar ? 0.95 : 0.22; b = bar ? 0.93 : 0.34;
          }
          if (u > 0.375 && u < 0.43 && v > 0.6) { r = 0.43; g = 0.25; b = 0.13; }
        }
        // A picket fence across the front: thin, regular, and close together.
        if (v > 0.76 && v < 0.87) {
          const p = (u % 0.03) / 0.03, top = 0.765 + Math.abs(p - 0.27) * 0.04;
          const picket = p < 0.54 && v > top, rail = Math.abs(v - 0.79) < 0.005 || Math.abs(v - 0.845) < 0.005;
          if (picket || rail) { const k = picket ? 1 - 0.18 * p : 0.88; r = 0.93 * k; g = 0.91 * k; b = 0.87 * k; }
        }
        return [r, g, b];
      };
      const aa = o.aa ?? (w * h > 40000 ? 1 : 2);
      return make(w, h, (x, y) => {
        let r = 0, g = 0, b = 0;
        for (let j = 0; j < aa; j++) for (let i = 0; i < aa; i++) {
          const c = col((x + (i + 0.5) / aa) / w, (y + (j + 0.5) / aa) / h);
          r += c[0]; g += c[1]; b += c[2];
        }
        const n = aa * aa;
        return [clamp(r / n, 0, 1), clamp(g / n, 0, 1), clamp(b / n, 0, 1)];
      });
    });
  }
  function checker(w = 64, h = w, cell = 8, o = {}) {
    const [a, b] = o.colors ?? [[1, 1, 1], [0, 0, 0]];
    return memo(`checker|${w}|${h}|${cell}|${a}|${b}`, () => make(w, h, (x, y) => ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? b : a)));
  }
  // Rings whose frequency rises with radius, reaching the Nyquist limit (half a cycle per
  // pixel) at the edge when scale is 1: every frequency at once, the classic aliasing test.
  function zonePlate(w = 128, h = w, o = {}) {
    const k = o.scale ?? 1;
    return memo(`zone|${w}|${h}|${k}`, () => make(w, h, (x, y) => {
      const dx = x + 0.5 - w / 2, dy = y + 0.5 - h / 2;
      return 0.5 + 0.5 * Math.cos((Math.PI * k * (dx * dx + dy * dy)) / Math.min(w, h));
    }));
  }
  function gradient(w = 256, h = 32, o = {}) {
    const a = o.from ?? [0, 0, 0], b = o.to ?? [1, 1, 1], dir = o.dir ?? "x";
    return memo(`grad|${w}|${h}|${a}|${b}|${dir}`, () => make(w, h, (x, y, u, v) => {
      const t = dir === "y" ? (y / Math.max(1, h - 1)) : dir === "radial" ? clamp(Math.hypot(u - 0.5, v - 0.5) * 2, 0, 1) : x / Math.max(1, w - 1);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }));
  }
  // A 5x7 bitmap font (rows as base-32 digits) for pixel glyphs and for Node, where there is no canvas.
  const FONT = {};
  "ehhvhhh uhhuhhu ehggghe sihhhis vgguggv vgguggg ehgnhhf hhhvhhh e44444e 72222ic hikokih ggggggv hrllhhh hpljhhh ehhhhhe uhhuggg ehhhlid uhhukih fgge11u v444444 hhhhhhe hhhhha4 hhhllla hha4ahh hha4444 v1248gv ehjlphe 4c4444e eh1248v v2421he 26aiv22 vgu11he 68guhhe v124888 ehhehhe ehhf12c eh12404"
    .split(" ").forEach((s, i) => { FONT["ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?"[i]] = [...s].map(c => parseInt(c, 32)); });
  function glyph(ch = "A", size = 64, o = {}) {
    const ink = o.invert ? 1 : 0, paper = 1 - ink;
    return memo(`glyph|${ch}|${size}|${o.pixel ? 1 : 0}|${o.invert ? 1 : 0}|${o.font ?? ""}|${o.weight ?? ""}`, () => {
      if (o.pixel || !hasDoc) {
        const rows = FONT[String(ch).toUpperCase()] ?? FONT["?"], s = Math.max(1, Math.round(size / 9));
        return make(7 * s, 9 * s, (x, y) => {
          const cx = Math.floor(x / s) - 1, cy = Math.floor(y / s) - 1;
          return cx >= 0 && cx < 5 && cy >= 0 && cy < 7 && (rows[cy] >> (4 - cx)) & 1 ? ink : paper;
        });
      }
      const cv = document.createElement("canvas");
      cv.width = cv.height = size;
      const c2 = cv.getContext("2d"), css = getComputedStyle(document.documentElement);
      const family = o.font ?? (css.getPropertyValue("--font-serif").trim() || "Georgia, serif");
      c2.fillStyle = "#fff"; c2.fillRect(0, 0, size, size);
      c2.fillStyle = "#000"; c2.textAlign = "center"; c2.textBaseline = "alphabetic";
      c2.font = `${o.weight ?? 500} ${Math.round(size * 0.78)}px ${family}`;
      const m = c2.measureText(ch), asc = m.actualBoundingBoxAscent ?? size * 0.55, desc = m.actualBoundingBoxDescent ?? 0;
      c2.fillText(ch, size / 2, size / 2 + (asc - desc) / 2);
      const px = c2.getImageData(0, 0, size, size).data;
      return make(size, size, (x, y) => { const v = px[(y * size + x) * 4] / 255; return o.invert ? 1 - v : v; });
    });
  }

  // Embedded images (a data: URL in the page), decoded once and shrunk to fit maxSize.
  const loads = new Map(), loaded = new Map();
  function fromDataURL(url, o = {}) {
    const key = `${o.maxSize ?? 256}|${url}`;
    if (!loads.has(key)) {
      loads.set(key, new Promise((resolve, reject) => {
        if (!hasDoc) return reject(new Error("Img.fromDataURL needs a browser"));
        const el = new Image();
        el.onload = () => {
          const max = o.maxSize ?? 256, k = Math.min(1, max / Math.max(el.naturalWidth, el.naturalHeight));
          const w = Math.max(1, Math.round(el.naturalWidth * k)), h = Math.max(1, Math.round(el.naturalHeight * k));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          const c2 = cv.getContext("2d");
          c2.imageSmoothingQuality = "high";
          c2.drawImage(el, 0, 0, w, h);
          const px = c2.getImageData(0, 0, w, h).data, im = image(w, h);
          for (let i = 0, j = 0; i < w * h; i++, j += 3) { im.data[j] = px[i * 4] / 255; im.data[j + 1] = px[i * 4 + 1] / 255; im.data[j + 2] = px[i * 4 + 2] / 255; }
          loaded.set(key, im);
          resolve(im);
        };
        el.onerror = () => reject(new Error("Img.fromDataURL couldn't decode the image"));
        el.src = url;
      }));
    }
    return loads.get(key);
  }
  const peek = (url, o = {}) => loaded.get(`${o.maxSize ?? 256}|${url}`) ?? null;

  // ---------- Point operations ----------
  function luma(im) {
    return memo(`luma|${idOf(im)}`, () => {
      const d = im.data, out = new Float32Array(im.w * im.h);
      for (let i = 0, j = 0; i < out.length; i++, j += 3) out[i] = lumaOf(d[j], d[j + 1], d[j + 2]);
      return out;
    });
  }
  const fromPlane = (w, h, p) => { const im = image(w, h); for (let i = 0, j = 0; i < p.length; i++, j += 3) im.data[j] = im.data[j + 1] = im.data[j + 2] = p[i]; return im; };
  const gray = im => memo(`gray|${idOf(im)}`, () => fromPlane(im.w, im.h, luma(im)));
  const CH = { r: 0, g: 1, b: 2, red: 0, green: 1, blue: 2 };
  function channel(im, c, o = {}) {
    const k = CH[c] ?? c;
    return memo(`chan|${idOf(im)}|${k}|${o.tint ? 1 : 0}`, () => {
      const out = image(im.w, im.h), d = im.data, e = out.data;
      for (let j = 0; j < d.length; j += 3) { if (o.tint) e[j + k] = d[j + k]; else e[j] = e[j + 1] = e[j + 2] = d[j + k]; }
      return out;
    });
  }
  function map(im, fn) {
    const out = image(im.w, im.h), d = im.data, e = out.data;
    for (let i = 0, j = 0; j < d.length; i++, j += 3) {
      const v = fn(d[j], d[j + 1], d[j + 2], i % im.w, Math.floor(i / im.w));
      if (typeof v === "number") e[j] = e[j + 1] = e[j + 2] = v; else { e[j] = v[0]; e[j + 1] = v[1]; e[j + 2] = v[2]; }
    }
    return out;
  }
  const invert = im => memo(`inv|${idOf(im)}`, () => map(im, (r, g, b) => [1 - r, 1 - g, 1 - b]));
  function crop(im, x, y, w, h) {
    return memo(`crop|${idOf(im)}|${x}|${y}|${w}|${h}`, () => make(w, h, (i, j) => get(im, x + i, y + j)));
  }
  function diff(a, b, o = {}) {
    const k = o.gain ?? 1;
    return memo(`diff|${idOf(a)}|${idOf(b)}|${k}`, () => { const out = image(a.w, a.h); for (let i = 0; i < out.data.length; i++) out.data[i] = Math.abs(a.data[i] - b.data[i]) * k; return out; });
  }
  function stats(im) {
    const d = im.data, n = im.w * im.h, mean = [0, 0, 0];
    let min = Infinity, max = -Infinity;
    for (let j = 0; j < d.length; j += 3) for (let c = 0; c < 3; c++) { mean[c] += d[j + c]; min = Math.min(min, d[j + c]); max = Math.max(max, d[j + c]); }
    for (let c = 0; c < 3; c++) mean[c] /= n;
    return { mean, luma: lumaOf(...mean), min, max };
  }
  function mse(a, b) { let s = 0; for (let i = 0; i < a.data.length; i++) { const e = a.data[i] - b.data[i]; s += e * e; } return s / a.data.length; }
  const psnr = (a, b) => { const m = mse(a, b); return m ? 10 * Math.log10(1 / m) : Infinity; };

  // ---------- Convolution ----------
  const kernels = {
    identity: (n = 3) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j && i === (n - 1) / 2 ? 1 : 0))),
    box: (n = 3) => Array.from({ length: n }, () => Array(n).fill(1 / (n * n))),
    gaussian(sigma = 1, n = 2 * Math.ceil(3 * sigma) + 1) {
      const c = (n - 1) / 2, row = Array.from({ length: n }, (_, i) => Math.exp(-((i - c) ** 2) / (2 * sigma * sigma))), s = row.reduce((a, b) => a + b, 0);
      return row.map(a => row.map(b => (a * b) / (s * s)));
    },
    // Pascal's triangle: [1 2 1] x [1 2 1] / 16, the integer kernel that approximates a Gaussian.
    binomial(n = 3) {
      let row = [1];
      for (let i = 1; i < n; i++) row = [...row, 0].map((v, j) => v + (row[j - 1] ?? 0));
      const s = row.reduce((a, b) => a + b, 0);
      return row.map(a => row.map(b => (a * b) / (s * s)));
    },
    sharpen: (a = 1) => [[0, -a, 0], [-a, 1 + 4 * a, -a], [0, -a, 0]],
    sobelX: () => [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],
    sobelY: () => [[-1, -2, -1], [0, 0, 0], [1, 2, 1]],
    laplacian: () => [[0, 1, 0], [1, -4, 1], [0, 1, 0]],
    edge: () => [[-1, -1, -1], [-1, 8, -1], [-1, -1, -1]],
    emboss: () => [[-2, -1, 0], [-1, 1, 1], [0, 1, 2]],
  };
  // A kernel that is an outer product col x row runs as two 1D passes (n + n instead of n * n).
  function separate(k) {
    let pi = 0, pj = 0, max = 0;
    k.forEach((r, i) => r.forEach((v, j) => { if (Math.abs(v) > max) { max = Math.abs(v); pi = i; pj = j; } }));
    if (!max) return null;
    const col = k.map(r => r[pj]), row = k[pi].map(v => v / k[pi][pj]);
    return k.every((r, i) => r.every((v, j) => Math.abs(v - col[i] * row[j]) <= 1e-12 * max)) ? { col, row } : null;
  }
  // Source index for each padded position, for the edge rule: clamp (repeat the border), wrap, or zero (-1).
  function indexes(n, r, edge) {
    const out = new Int32Array(n + 2 * r);
    for (let i = -r; i < n + r; i++) out[i + r] = edge === "wrap" ? ((i % n) + n) % n : edge === "zero" ? (i < 0 || i >= n ? -1 : i) : clamp(i, 0, n - 1);
    return out;
  }
  // planes: arrays of Float32Array (one per channel), each w * h. Every pass works a whole
  // row at a time, tap by tap, so memory is read in order; only border pixels use the edge tables.
  function rowTap(acc, p, rowp, c, shift, w, r, ix, i) {
    const lo = Math.min(r, w), hi = Math.max(r, w - r);
    for (let x = lo; x < hi; x++) acc[x] += c * p[rowp + x + shift];
    for (let x = 0; x < lo; x++) { const sx = ix[x + i]; if (sx >= 0) acc[x] += c * p[rowp + sx]; }
    for (let x = hi; x < w; x++) { const sx = ix[x + i]; if (sx >= 0) acc[x] += c * p[rowp + sx]; }
  }
  function pass1d(planes, w, h, taps, horizontal, edge) {
    const L = taps.length, r = (L - 1) / 2, f = Float64Array.from(taps).reverse(), idx = indexes(horizontal ? w : h, r, edge);
    return planes.map(p => {
      const out = new Float32Array(w * h), acc = new Float64Array(w);
      for (let y = 0; y < h; y++) {
        acc.fill(0);
        for (let t = 0; t < L; t++) {
          const c = f[t];
          if (!c) continue;
          if (horizontal) rowTap(acc, p, y * w, c, t - r, w, r, idx, t);
          else { const q = idx[y + t]; if (q < 0) continue; const b = q * w; for (let x = 0; x < w; x++) acc[x] += c * p[b + x]; }
        }
        out.set(acc, y * w);
      }
      return out;
    });
  }
  function conv2d(planes, w, h, k, edge) {
    const kh = k.length, kw = k[0].length, ry = (kh - 1) / 2, rx = (kw - 1) / 2, ix = indexes(w, rx, edge), iy = indexes(h, ry, edge);
    return planes.map(p => {
      const out = new Float32Array(w * h), acc = new Float64Array(w);
      for (let y = 0; y < h; y++) {
        acc.fill(0);
        for (let j = 0; j < kh; j++) {
          const sy = iy[y + j];
          if (sy < 0) continue;
          for (let i = 0; i < kw; i++) { const c = k[kh - 1 - j][kw - 1 - i]; if (c) rowTap(acc, p, sy * w, c, i - rx, w, rx, ix, i); }   // flipped
        }
        out.set(acc, y * w);
      }
      return out;
    });
  }
  const planesOf = (im, grayOnly) => {
    if (grayOnly) return [luma(im)];
    const n = im.w * im.h, ps = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0, j = 0; i < n; i++, j += 3) { ps[0][i] = im.data[j]; ps[1][i] = im.data[j + 1]; ps[2][i] = im.data[j + 2]; }
    return ps;
  };
  function fromPlanes(w, h, ps, o = {}) {
    const im = image(w, h), d = im.data, off = o.offset ?? 0, sc = o.scale ?? 1;
    for (let i = 0, j = 0; i < w * h; i++, j += 3) for (let c = 0; c < 3; c++) {
      let v = ps[ps.length === 1 ? 0 : c][i] * sc;
      if (o.abs) v = Math.abs(v);
      d[j + c] = v + off;
    }
    return im;
  }
  // True convolution (the kernel is flipped), odd-sized kernels. Results are not clamped:
  // an edge kernel gives negative numbers; draw them with o.abs or o.offset: 0.5.
  function convolve(im, k, o = {}) {
    if (k.length % 2 === 0 || k[0].length % 2 === 0) throw new Error("Img.convolve needs a kernel with odd width and height");
    const edge = o.edge ?? "clamp";
    return memo(`conv|${idOf(im)}|${k.map(r => r.join(",")).join(";")}|${edge}|${o.abs ? 1 : 0}|${o.offset ?? 0}|${o.scale ?? 1}|${o.gray ? 1 : 0}`, () => {
      const ps = planesOf(im, o.gray), sep = separate(k);
      const out = sep ? pass1d(pass1d(ps, im.w, im.h, sep.row, true, edge), im.w, im.h, sep.col, false, edge) : conv2d(ps, im.w, im.h, k, edge);
      return fromPlanes(im.w, im.h, out, o);
    });
  }
  function blur(im, sigma = 1, o = {}) {
    if (sigma <= 0) return im;
    return memo(`blur|${idOf(im)}|${sigma}|${o.edge ?? "clamp"}`, () => {
      const g = kernels.gaussian(sigma), row = g[(g.length - 1) / 2].map(v => v / g[(g.length - 1) / 2][(g.length - 1) / 2]);
      const s = row.reduce((a, b) => a + b, 0), taps = row.map(v => v / s), edge = o.edge ?? "clamp";
      return fromPlanes(im.w, im.h, pass1d(pass1d(planesOf(im), im.w, im.h, taps, true, edge), im.w, im.h, taps, false, edge));
    });
  }
  // Sobel gradients of the luma: gx, gy (signed) and the edge strength mag, as gray images.
  function sobel(im, o = {}) {
    return memo(`sobel|${idOf(im)}|${o.edge ?? "clamp"}`, () => {
      const gx = convolve(im, kernels.sobelX(), { gray: true, edge: o.edge }), gy = convolve(im, kernels.sobelY(), { gray: true, edge: o.edge });
      const mag = image(im.w, im.h);
      for (let j = 0; j < mag.data.length; j += 3) mag.data[j] = mag.data[j + 1] = mag.data[j + 2] = Math.hypot(gx.data[j], gy.data[j]) / 4;
      return { gx, gy, mag };
    });
  }

  // ---------- Resampling ----------
  // For each of m outputs along an axis of n pixels: the first source pixel and its weights.
  function axisWeights(n, m, method) {
    const k = n / m, start = new Int32Array(m), count = new Int32Array(m), off = new Int32Array(m), wts = [];
    for (let i = 0; i < m; i++) {
      let s, ws;
      if (method === "nearest") { s = Math.min(n - 1, Math.floor((i + 0.5) * k)); ws = [1]; }
      else if (method === "area" && k > 1) {
        const a = i * k, b = (i + 1) * k;
        s = Math.floor(a); ws = [];
        for (let j = s; j < Math.min(n, Math.ceil(b)); j++) ws.push((Math.min(b, j + 1) - Math.max(a, j)) / k);
      } else if (n === 1) { s = 0; ws = [1]; }
      else { const x = clamp((i + 0.5) * k - 0.5, 0, n - 1), j = Math.min(Math.floor(x), n - 2), f = x - j; s = j; ws = [1 - f, f]; }
      start[i] = s; count[i] = ws.length; off[i] = wts.length; wts.push(...ws);
    }
    return { start, count, off, w: Float64Array.from(wts) };
  }
  // "nearest" copies the closest pixel, "bilinear" blends the four around, "area" averages
  // every pixel a target pixel covers (the antialiased way to shrink; bilinear when enlarging).
  function resize(im, w, h, method = "bilinear") {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    return memo(`resize|${idOf(im)}|${w}|${h}|${method}`, () => {
      const X = axisWeights(im.w, w, method), Y = axisWeights(im.h, h, method), d = im.data, W = im.w;
      const tmp = new Float32Array(w * im.h * 3), out = image(w, h), e = out.data;
      for (let y = 0; y < im.h; y++) for (let x = 0; x < w; x++) {
        const s = X.start[x], c = X.count[x], o = X.off[x];
        let r = 0, g = 0, b = 0;
        for (let t = 0; t < c; t++) { const q = (y * W + s + t) * 3, wt = X.w[o + t]; r += wt * d[q]; g += wt * d[q + 1]; b += wt * d[q + 2]; }
        const k = (y * w + x) * 3;
        tmp[k] = r; tmp[k + 1] = g; tmp[k + 2] = b;
      }
      for (let y = 0; y < h; y++) {
        const s = Y.start[y], c = Y.count[y], o = Y.off[y], row = y * w * 3;
        for (let t = 0; t < c; t++) {
          const wt = Y.w[o + t], src = (s + t) * w * 3;
          for (let i = 0; i < w * 3; i++) e[row + i] += wt * tmp[src + i];
        }
      }
      return out;
    });
  }

  // ---------- Quantization and dithering ----------
  const q = (v, L) => Math.round(clamp(v, 0, 1) * (L - 1)) / (L - 1);
  function quantize(im, levels = 4) {
    const L = Math.max(2, Math.round(levels));
    return memo(`quant|${idOf(im)}|${L}`, () => map(im, (r, g, b) => [q(r, L), q(g, L), q(b, L)]));
  }
  const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
  // levels per channel; method "floyd" (error diffusion, default), "ordered" (8x8 Bayer), or "random".
  function dither(im, levels = 2, o = {}) {
    const L = Math.max(2, Math.round(levels)), method = o.method ?? "floyd";
    return memo(`dither|${idOf(im)}|${L}|${method}|${o.gray ? 1 : 0}|${o.serpentine ? 1 : 0}`, () => {
      const { w, h } = im, ps = planesOf(im, o.gray), step = 1 / (L - 1), r = rng(o.seed ?? 9);
      const out = ps.map(p => {
        if (method !== "floyd") {
          return p.map((v, i) => {
            const t = method === "random" ? r() - 0.5 : (BAYER[((Math.floor(i / w) & 7) << 3) | (i % w & 7)] + 0.5) / 64 - 0.5;
            return q(v + t * step, L);
          });
        }
        const e = Float32Array.from(p), res = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
          const back = o.serpentine && y % 2, dx = back ? -1 : 1;
          for (let k = 0; k < w; k++) {
            const x = back ? w - 1 - k : k, i = y * w + x, v = e[i], nv = q(v, L), err = v - nv;
            res[i] = nv;
            // Floyd and Steinberg (1976): 7/16 ahead, 3/16 behind below, 5/16 below, 1/16 ahead below.
            if (x + dx >= 0 && x + dx < w) e[i + dx] += (err * 7) / 16;
            if (y + 1 < h) {
              if (x - dx >= 0 && x - dx < w) e[i + w - dx] += (err * 3) / 16;
              e[i + w] += (err * 5) / 16;
              if (x + dx >= 0 && x + dx < w) e[i + w + dx] += err / 16;
            }
          }
        }
        return res;
      });
      return fromPlanes(w, h, out);
    });
  }

  // ---------- The JPEG idea: 8x8 DCT and quantization ----------
  const COS = new Float64Array(64);
  for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) COS[x * 8 + u] = (u ? 0.5 : Math.SQRT1_2 / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  // Orthonormal 2D DCT-II of 64 values, row by row (index y * 8 + x). Coefficient (u, v) is at v * 8 + u.
  const T64 = new Float64Array(64);
  function dct8(b, out = new Float64Array(64)) {
    const t = T64;
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += b[y * 8 + x] * COS[x * 8 + u]; t[y * 8 + u] = s; }
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let s = 0; for (let y = 0; y < 8; y++) s += t[y * 8 + u] * COS[y * 8 + v]; out[v * 8 + u] = s; }
    return out;
  }
  function idct8(c, out = new Float64Array(64)) {
    const t = T64;
    for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += c[v * 8 + u] * COS[x * 8 + u]; t[v * 8 + x] = s; }
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let s = 0; for (let v = 0; v < 8; v++) s += t[v * 8 + x] * COS[y * 8 + v]; out[y * 8 + x] = s; }
    return out;
  }
  // The example tables from the JPEG standard (ITU T.81, Annex K).
  const QUANT_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  const QUANT_CHROMA = Array.from({ length: 64 }, (_, i) => [17, 18, 24, 47, 18, 21, 26, 66, 24, 26, 56, 99, 47, 66, 99, 99][(i >> 3) < 4 && (i & 7) < 4 ? (i >> 3) * 4 + (i & 7) : 15] ?? 99);
  // Quality 1-100 scales the table the way libjpeg does.
  function quantTable(quality = 50, chroma = false) {
    const qq = clamp(Math.round(quality), 1, 100), s = qq < 50 ? 5000 / qq : 200 - 2 * qq;
    return (chroma ? QUANT_CHROMA : QUANT_LUMA).map(v => clamp(Math.floor((v * s + 50) / 100), 1, 255));
  }
  const ZIGZAG = (() => {
    const out = [];
    for (let s = 0; s < 15; s++) for (let i = 0; i <= s; i++) { const a = s % 2 ? s - i : i, b = s - a; if (a < 8 && b < 8) out.push(b * 8 + a); }
    return out;
  })();
  // One 8x8 block of luma, 0-255, at block column bx, block row by.
  function block(im, bx, by) {
    const L = luma(im), out = new Float64Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = 255 * L[clamp(by * 8 + y, 0, im.h - 1) * im.w + clamp(bx * 8 + x, 0, im.w - 1)];
    return out;
  }
  const fromBlock = (vals, scale = 255) => fromPlane(8, 8, Float32Array.from(vals, v => clamp(v / scale, 0, 1)));
  function dctBasis(u, v, n = 8) {
    return memo(`basis|${u}|${v}|${n}`, () => make(n, n, (x, y) => 0.5 + 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n)) * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * n))));
  }
  // Compress and decompress: YCbCr, optional 4:2:0 chroma, 8x8 DCT, quantize, and back.
  // o.quality (50), o.keep (keep only the first n zigzag coefficients instead of quantizing),
  // o.subsample (true for color), o.gray. Returns { img, nonzero, total, ratio, psnr }.
  function jpeg(im, o = {}) {
    const color = !(o.gray ?? isGray(im)), sub = color && o.subsample !== false;
    return memo(`jpeg|${idOf(im)}|${o.quality ?? 50}|${o.keep ?? ""}|${color}|${sub}`, () => {
      const { w, h } = im, d = im.data, n = w * h, Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        const r = d[j] * 255, g = d[j + 1] * 255, b = d[j + 2] * 255;
        Y[i] = lumaOf(r, g, b); Cb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b; Cr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      }
      let nonzero = 0, total = 0;
      const code = (p, pw, ph, table) => {
        const out = new Float32Array(pw * ph), blk = new Float64Array(64), c = new Float64Array(64), r = new Float64Array(64);
        for (let by = 0; by < ph; by += 8) for (let bx = 0; bx < pw; bx += 8) {
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = p[Math.min(by + y, ph - 1) * pw + Math.min(bx + x, pw - 1)] - 128;
          dct8(blk, c);
          for (let z = 0; z < 64; z++) {
            const k = ZIGZAG[z];
            if (o.keep != null) { if (z >= o.keep) c[k] = 0; }
            else c[k] = Math.round(c[k] / table[k]) * table[k];
            if (c[k]) nonzero++;
          }
          total += 64;
          idct8(c, r);
          for (let y = 0; y < 8 && by + y < ph; y++) for (let x = 0; x < 8 && bx + x < pw; x++) out[(by + y) * pw + bx + x] = r[y * 8 + x] + 128;
        }
        return out;
      };
      const half = p => {
        const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2), out = new Float32Array(hw * hh);
        for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
          let s = 0;
          for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) s += p[Math.min(2 * y + j, h - 1) * w + Math.min(2 * x + i, w - 1)];
          out[y * hw + x] = s / 4;
        }
        return [out, hw, hh];
      };
      const tl = quantTable(o.quality ?? 50), tc = quantTable(o.quality ?? 50, true);
      const y2 = code(Y, w, h, tl);
      let cb2 = Cb, cr2 = Cr, cw = w;
      if (color) {
        if (sub) { const [a, hw, hh] = half(Cb), [b] = half(Cr); cb2 = code(a, hw, hh, tc); cr2 = code(b, hw, hh, tc); cw = hw; }
        else { cb2 = code(Cb, w, h, tc); cr2 = code(Cr, w, h, tc); }
      }
      const out = image(w, h), e = out.data;
      for (let y = 0, j = 0; y < h; y++) for (let x = 0; x < w; x++, j += 3) {
        const Yv = y2[y * w + x];
        if (!color) { e[j] = e[j + 1] = e[j + 2] = clamp(Yv / 255, 0, 1); continue; }
        const ci = sub ? (y >> 1) * cw + (x >> 1) : y * w + x, cb = cb2[ci] - 128, cr = cr2[ci] - 128;
        e[j] = clamp((Yv + 1.402 * cr) / 255, 0, 1); e[j + 1] = clamp((Yv - 0.344136 * cb - 0.714136 * cr) / 255, 0, 1); e[j + 2] = clamp((Yv + 1.772 * cb) / 255, 0, 1);
      }
      return { img: out, nonzero, total, ratio: nonzero / total, psnr: psnr(im, out) };
    });
  }

  // ---------- Histograms ----------
  // Counts per bin of tone 0-1: o.channel "luma" (default), "r", "g", "b", or "rgb" for { r, g, b }.
  function histogram(im, o = {}) {
    const bins = o.bins ?? 256, ch = o.channel ?? "luma";
    if (ch === "rgb") return { r: histogram(im, { ...o, channel: "r" }), g: histogram(im, { ...o, channel: "g" }), b: histogram(im, { ...o, channel: "b" }) };
    return memo(`hist|${idOf(im)}|${bins}|${ch}|${o.normalize ? 1 : 0}`, () => {
      const out = new Float32Array(bins), n = im.w * im.h, L = ch === "luma" ? luma(im) : null, k = CH[ch] ?? 0;
      for (let i = 0; i < n; i++) out[clamp(Math.floor((L ? L[i] : im.data[i * 3 + k]) * bins), 0, bins - 1)]++;
      if (o.normalize) for (let i = 0; i < bins; i++) out[i] /= n;
      return out;
    });
  }
  // Spread the tones so each luma level is used about equally; colors keep their hue.
  function equalize(im) {
    return memo(`eq|${idOf(im)}`, () => {
      const h = histogram(im, { bins: 256 }), cdf = new Float32Array(256), n = im.w * im.h, L = luma(im);
      let s = 0;
      for (let i = 0; i < 256; i++) { s += h[i]; cdf[i] = s / n; }
      const c0 = cdf.find(v => v > 0) ?? 0;
      return map(im, (r, g, b, x, y) => {
        const l = L[y * im.w + x], t = (cdf[clamp(Math.floor(l * 256), 0, 255)] - c0) / (1 - c0 || 1), k = l > 1e-4 ? t / l : 0;
        return l > 1e-4 ? [r * k, g * k, b * k] : t;
      });
    });
  }

  // ---------- Drawing helpers on g ----------
  (window.__safisG ||= []).push((g, util) => {
    const canvases = new Map();
    function canvasOf(im) {
      const key = idOf(im);
      let cv = canvases.get(key);
      if (cv && cv.width === im.w && cv.height === im.h) { canvases.delete(key); canvases.set(key, cv); return cv; }
      cv = document.createElement("canvas");
      cv.width = im.w; cv.height = im.h;
      const c2 = cv.getContext("2d"), px = c2.createImageData(im.w, im.h), d = im.data;
      for (let i = 0, j = 0; i < im.w * im.h; i++, j += 3) { const k = i * 4; px.data[k] = d[j] * 255; px.data[k + 1] = d[j + 1] * 255; px.data[k + 2] = d[j + 2] * 255; px.data[k + 3] = 255; }
      c2.putImageData(px, 0, 0);
      canvases.set(key, cv);
      if (canvases.size > 32) canvases.delete(canvases.keys().next().value);
      return cv;
    }
    const lum = c => { const p = util.rgb(c); return lumaOf(p[0], p[1], p[2]) / 255; };

    // Crisp pixels: each image pixel becomes a cell of whole screen pixels. Zoomed in far
    // enough, a grid separates the cells and each shows its value (0-255).
    g.pixels = (im, box = [0, 0, g.w, g.h], o = {}) => {
      const [sx, sy, sw, sh] = o.src ?? [0, 0, im.w, im.h], labelH = o.label ? 20 : 0;
      let cw = box[2] / sw, chh = (box[3] - labelH) / sh;
      if (o.fit !== "fill") cw = chh = Math.min(cw, chh);
      if (o.cell) cw = chh = o.cell;
      if (o.fit !== "fill" && cw >= 2 && o.snap !== false) cw = chh = Math.floor(cw);
      const W = cw * sw, H = chh * sh;
      const x0 = Math.round(o.align === "left" ? box[0] : o.align === "right" ? box[0] + box[2] - W : box[0] + (box[2] - W) / 2);
      const y0 = Math.round(o.valign === "top" ? box[1] : box[1] + (box[3] - labelH - H) / 2);
      const ctx = g.ctx;
      ctx.save();
      ctx.imageSmoothingEnabled = !!o.smooth;
      if (o.alpha != null) ctx.globalAlpha = o.alpha;
      ctx.drawImage(canvasOf(im), sx, sy, sw, sh, x0, y0, W, H);
      ctx.restore();
      const grid = o.grid ?? "auto", values = o.values ?? "auto", ink = lum("ink"), paper = lum("panel");
      if (grid === true || (grid === "auto" && cw >= 12)) {
        const lw = cw >= 24 ? 1.5 : 1;
        for (let i = 1; i < sw; i++) g.line([x0 + i * cw, y0], [x0 + i * cw, y0 + H], { stroke: "panel", width: lw, alpha: 0.9 });
        for (let j = 1; j < sh; j++) g.line([x0, y0 + j * chh], [x0 + W, y0 + j * chh], { stroke: "panel", width: lw, alpha: 0.9 });
      }
      const mono = values !== false && cw >= 20 && (o.channel != null || isGray(im)), need = mono ? 30 : 46;
      if (values === true || (values === "auto" && cw >= need)) {
        const fmt = o.format ?? (v => String(Math.round(clamp(v, 0, 1) * 255)));
        const size = Math.min(13, cw * (mono ? 0.32 : 0.24));
        for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
          const p = get(im, sx + i, sy + j), l = lumaOf(...p), c = Math.abs(l - ink) > Math.abs(l - paper) ? "ink" : "panel";
          const cx = x0 + (i + 0.5) * cw, cy = y0 + (j + 0.5) * chh;
          if (mono) g.text(fmt(o.channel != null ? p[CH[o.channel] ?? o.channel] : p[0]), [cx, cy], { size, weight: 600, color: c, font: "mono" });
          else p.forEach((v, k) => g.text(fmt(v), [cx, cy + (k - 1) * size * 1.15], { size, weight: 600, color: c, font: "mono" }));
        }
      }
      if (o.frame !== false) g.rect(x0 - 0.5, y0 - 0.5, W + 1, H + 1, { stroke: "faint", width: 1 });
      for (const m of o.mark ? (Array.isArray(o.mark[0]) ? o.mark : [o.mark]) : []) {
        g.rect(x0 + (m[0] - sx) * cw, y0 + (m[1] - sy) * chh, (m[2] ?? 1) * cw, (m[3] ?? 1) * chh, { stroke: o.markColor ?? "orange", width: 2 });
      }
      if (o.label) g.text(o.label, [x0 + W / 2, y0 + H + 13], { size: 12.5, weight: 500, color: "muted" });
      return {
        box: [x0, y0, W, H], cell: cw,
        at(p) { const i = Math.floor((p[0] - x0) / cw), j = Math.floor((p[1] - y0) / chh); return i >= 0 && j >= 0 && i < sw && j < sh ? [sx + i, sy + j] : null; },
        rect: (i, j, w = 1, h = 1) => [x0 + (i - sx) * cw, y0 + (j - sy) * chh, w * cw, h * chh],
        center: (i, j) => [x0 + (i - sx + 0.5) * cw, y0 + (j - sy + 0.5) * chh],
      };
    };

    // A kernel as a grid of its weights. When every weight is a whole number over a common
    // denominator (box 1/9, binomial 1/16), the grid shows the whole numbers and "× 1/16".
    g.kernel = (k, box = [0, 0, g.w, g.h], o = {}) => {
      const rows = k.length, cols = k[0].length, flat = k.flat(), max = Math.max(...flat.map(Math.abs)) || 1;
      let den = o.denominator ?? 1;
      if (o.denominator == null) for (let d = 1; d <= 1024; d++) if (flat.every(v => Math.abs(v * d - Math.round(v * d)) < 1e-6)) { den = d; break; }
      if (o.denominator == null && !flat.every(v => Math.abs(v * den - Math.round(v * den)) < 1e-6)) den = 1;
      const exact = flat.every(v => Math.abs(v * den - Math.round(v * den)) < 1e-6), noteH = den > 1 && o.note !== false ? 20 : 0;
      const cell = Math.floor(Math.min(o.cell ?? Infinity, box[2] / cols, (box[3] - noteH) / rows)), W = cell * cols, H = cell * rows;
      const x0 = Math.round(box[0] + (box[2] - W) / 2), y0 = Math.round(o.valign === "top" ? box[1] : box[1] + (box[3] - noteH - H) / 2);
      const show = v => (exact ? String(Math.round(v * den)) : Math.abs(v) < 0.005 ? "0" : v.toFixed(cell > 44 ? 3 : 2).replace(/^(-?)0\./, "$1.")).replace("-", "−");
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const v = k[i][j], x = x0 + j * cell, y = y0 + i * cell;
        g.rect(x, y, cell, cell, { fill: "panel" });
        if (v) g.rect(x, y, cell, cell, { fill: v > 0 ? o.positive ?? "blue" : o.negative ?? "red", alpha: 0.08 + 0.32 * (Math.abs(v) / max) });
        g.rect(x + 0.5, y + 0.5, cell - 1, cell - 1, { stroke: "grid", width: 1 });
        if (o.values !== false) g.text(show(v), [x + cell / 2, y + cell / 2 + 0.5], { size: Math.min(15, cell * 0.36), weight: 600, color: v ? "ink" : "muted", font: "mono" });
      }
      if (o.highlight) { const [i, j] = o.highlight; g.rect(x0 + j * cell, y0 + i * cell, cell, cell, { stroke: "ink", width: 2 }); }
      g.rect(x0, y0, W, H, { stroke: "muted", width: 1.25 });
      if (noteH) g.text(`× 1/${den}`, [x0 + W / 2, y0 + H + 13], { size: 12.5, weight: 500, color: "muted" });
      if (o.label) g.text(o.label, [x0 + W / 2, y0 - 12], { size: 12.5, weight: 600, color: "ink" });
      return {
        box: [x0, y0, W, H], cell, denominator: den,
        hit(p) { const j = Math.floor((p[0] - x0) / cell), i = Math.floor((p[1] - y0) / cell); return i >= 0 && j >= 0 && i < rows && j < cols ? [i, j] : null; },
        center: (i, j) => [x0 + (j + 0.5) * cell, y0 + (i + 0.5) * cell],
      };
    };

    // A histogram of tones (from Img.histogram), dark on the left and light on the right.
    g.histogram = (hist, box = [0, 0, g.w, g.h], o = {}) => {
      const sets = hist.r ? [[hist.r, "red"], [hist.g, "green"], [hist.b, "blue"]] : [[hist, o.color ?? "ink"]];
      const n = sets[0][0].length, axisH = o.axis !== false ? 18 : 0, [bx, by, bw] = box, bh = box[3] - axisH;
      const f = v => (o.log ? Math.log1p(v) : v);
      let top = o.max != null ? f(o.max) : 0;
      if (o.max == null) for (const [a] of sets) for (let i = 0; i < n; i++) top = Math.max(top, f(a[i]));
      top = top || 1;
      const X = t => bx + t * bw, Y = c => by + bh - (Math.min(f(c), top) / top) * bh;
      for (const [a, c] of sets) {
        const pts = [[bx, by + bh]];
        for (let i = 0; i < n; i++) { const y = Y(a[i]); pts.push([X(i / n), y], [X((i + 1) / n), y]); }
        pts.push([bx + bw, by + bh]);
        g.path(pts, { fill: c, alpha: sets.length > 1 ? 0.28 : 0.75, close: true });
        if (sets.length > 1) g.path(pts.slice(1, -1), { stroke: c, width: 1.25 });
      }
      g.line([bx, by + bh], [bx + bw, by + bh], { stroke: "muted", width: 1 });
      for (const t of [].concat(o.mark ?? [])) g.line([X(t), by], [X(t), by + bh], { stroke: o.markColor ?? "orange", width: 1.5, dash: [4, 3] });
      if (axisH) {
        const [a, b] = o.ends ?? ["0", "255"];
        g.text(a, [bx, by + bh + 11], { size: 11.5, color: "muted", align: "left" });
        g.text(b, [bx + bw, by + bh + 11], { size: 11.5, color: "muted", align: "right" });
        if (o.label) g.text(o.label, [bx + bw / 2, by + bh + 11], { size: 12, color: "muted" });
      }
      return { box: [bx, by, bw, bh], x: X, y: Y, tone: px => clamp((px - bx) / bw, 0, 1) };
    };
  });

  window.Img = {
    image, make, get, isGray, idOf,
    scene, checker, zonePlate, gradient, glyph, fromDataURL, peek,
    luma, gray, channel, map, invert, crop, diff, stats, mse, psnr,
    kernels, convolve, blur, sobel, resize, quantize, dither,
    dct8, idct8, quantTable, QUANT_LUMA, QUANT_CHROMA, ZIGZAG, block, fromBlock, dctBasis, jpeg,
    histogram, equalize,
  };
})();

;

/* Effects kit: g.fx and window.Fx draw fire, exhaust, smoke, steam, glow, ripples, caustics,
   sparks, arcs, shimmer, and airflow, each a pure function of time t and a seed. Shaders share
   one WebGL2 context, with 2D versions without it. Reference: references/effects.md. */
(() => {
  "use strict";
  const TAU = Math.PI * 2, PI = Math.PI;
  const { exp, sin, cos, sqrt, hypot, min, max, floor, abs } = Math;
  const clamp = (x, lo, hi) => min(hi, max(lo, x)), lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const cn = (v, d, lo, hi) => clamp(num(v, d), lo, hi);

  // ---------- seeded numbers ----------
  function hash(a, b = 0, c = 0) {
    let h = Math.imul(a | 0, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul((c | 0) + 0x27d4eb2f, 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return h >>> 0;
  }
  const rnd = (a, b, c) => hash(a, b, c) / 4294967296;
  // Smooth value noise in [-1, 1].
  const noise1 = (x, seed = 1) => { const i = floor(x), f = x - i; return lerp(rnd(seed, i), rnd(seed, i + 1), f * f * (3 - 2 * f)) * 2 - 1; };

  // ---------- physics ----------
  // Black-body color at T kelvin, [r, g, b] 0-255 (a Planckian-locus fit).
  function blackbody(T) {
    const t = cn(T, 1500, 500, 40000) / 100;
    const r = t <= 66 ? 255 : 329.6987 * (t - 60) ** -0.1332048;
    const g = t <= 66 ? 99.4708 * Math.log(t) - 161.1196 : 288.1222 * (t - 60) ** -0.0755148;
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177 * Math.log(t - 10) - 305.0448;
    return [r, g, b].map(v => Math.round(clamp(v, 0, 255)));
  }
  // How bright a hot body looks, 0 to 1: dark below the Draper point (798 K), then rising with
  // the log of its visible radiance (Wien), full by 1600 K.
  const glowLevel = T => clamp((1 / 798 - 1 / max(num(T, 0), 1)) / (1 / 798 - 1 / 1600), 0, 1);
  // Pool fires puff at about 1.5 / sqrt(D) Hz, D the fire's diameter in meters.
  const puff = D => 1.5 / sqrt(clamp(D, 0.005, 50));
  // Eases cur toward target (time constant tau, s) so nothing pops.
  const follow = (cur, target, dt, tau = 0.3) => (num(cur, null) === null ? target : target + (cur - target) * exp(-max(0, dt) / max(1e-6, tau)));

  // ---------- round parts in parallel projection ----------
  // A round part's rim is a screen ellipse { center, rx, ry, angle }. In a parallel view its axis
  // runs along the minor axis at sqrt(major² - minor²) px per rim radius, so the ellipse fixes
  // the map from part coordinates [s, y, z] (rim radii) to the screen: C + s A + y E1 + z E2.
  function frame(e, axis, along) {
    const c = cos(e.angle || 0), s = sin(e.angle || 0), rx = abs(num(e.rx, 10)), ry = abs(num(e.ry, 10)), big = max(rx, ry, 1e-6), small = min(rx, ry);
    let d = axis ? [axis[0], axis[1]] : rx <= ry ? [c, s] : [-s, c];
    const l = hypot(d[0], d[1]) || 1;
    d = [d[0] / l, d[1] / l];
    if (!axis && d[0] < -1e-9) d = [-d[0], -d[1]];
    const L = num(along, max(sqrt(big * big - small * small), 0.2 * big));
    return { C: [e.center[0], e.center[1]], A: [d[0] * L, d[1] * L], E1: [rx * c, rx * s], E2: [-ry * s, ry * c], R: big, dir: d, along: L };
  }
  const onScreen = (F, x) => [0, 1].map(i => F.C[i] + x[0] * F.A[i] + x[1] * F.E1[i] + x[2] * F.E2[i]);
  // The rim ellipse of a 3D circle under a projector (g.view3d's P, an E3 view's project).
  function ellipse(project, center, normal, r) {
    const unit = v => { const l = hypot(...v) || 1; return v.map(x => x / l); };
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const n = unit(normal), u = unit(cr(abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], n)), w = cr(n, u), p0 = project(center);
    const d = v => { const p = project(center.map((c, i) => c + v[i] * r)); return [p[0] - p0[0], p[1] - p0[1]]; };
    const a = d(u), b = d(w), A = d(n), LA = hypot(...A);
    const P = a[0] ** 2 + b[0] ** 2, Q = a[0] * a[1] + b[0] * b[1], S = a[1] ** 2 + b[1] ** 2, m = (P + S) / 2, q = hypot((P - S) / 2, Q);
    return { center: [p0[0], p0[1]], rx: sqrt(m + q), ry: sqrt(max(0, m - q)), angle: 0.5 * Math.atan2(2 * Q, P - S), axis: LA > 1e-9 ? [A[0] / LA, A[1] / LA] : [1, 0], along: LA };
  }

  // ---------- color ramps, cool to hot, for dark (d) and light (l) pages ----------
  const FIRE = { d: [[.7, .12, .02], [1, .38, .04], [1, .68, .2], [1, .93, .72]], l: [[.8, .2, .06], [.96, .4, .06], [1, .64, .12], [1, .86, .42]] };
  const BLUE = { d: [[.12, .16, .6], [.2, .36, 1], [.45, .66, 1], [.82, .9, 1]], l: [[.3, .32, .8], [.22, .4, .95], [.4, .6, 1], [.72, .84, 1]] };
  // Exhaust by propellant: kerosene burns sooty orange, methane blue, hydrogen nearly clear.
  const FUELS = {
    kerosene: { body: 1, d: [[.75, .18, .04], [1, .45, .08], [1, .75, .3], [1, .95, .82]], l: [[.8, .2, .06], [.95, .4, .06], [1, .62, .08], [1, .82, .2]] },
    methane: { body: .7, d: [[.35, .2, .75], [.3, .45, 1], [.6, .76, 1], [.92, .95, 1]], l: [[.45, .28, .82], [.3, .42, .95], [.5, .64, 1], [.8, .86, 1]] },
    hydrogen: { body: .25, d: [[.55, .3, .75], [.75, .5, .9], [1, .75, .85], [1, .96, .95]], l: [[.62, .3, .78], [.82, .42, .8], [1, .58, .7], [1, .82, .84]] },
  };
  const ramp = (st, x) => { x = clamp(x, 0, 1) * 3; const i = min(floor(x), 2); return [0, 1, 2].map(k => lerp(st[i][k], st[i + 1][k], x - i)); };
  const css = (c, a = 1) => `rgba(${c.map(v => Math.round(v * 255)).join(", ")}, ${clamp(a, 0, 1).toFixed(3)})`;
  const hue = c => { const m = max(...c, 1); return c.map(v => v / m); };
  const W1 = [1, 1, 1], mixc = (a, b, t) => a.map((v, i) => lerp(v, b[i], clamp(t, 0, 1)));

  // ---------- parameters: options resolved against the box ----------
  const common = o => ({ t: num(o.t, 0), seed: num(o.seed, 1) | 0 }), bp = (b, x, y) => [b[0] + b[2] * x, b[1] + b[3] * y];
  const sources = (list, b) => (list?.length ? list : [bp(b, 0.5, 0.5)]).slice(0, 8).map(s =>
    Array.isArray(s) ? { x: s[0], y: s[1], phase: 0, amp: 1, start: -1e6 } : { x: s.at[0], y: s.at[1], phase: num(s.phase, 0), amp: num(s.amp, 1), start: num(s.start, -1e6) });
  function water(b, o, lam, c) {
    const f = o.frame, X = f?.x ?? [1, 0], Y = f?.y ?? [0, 1], org = f?.origin ?? [0, 0], det = X[0] * Y[1] - Y[0] * X[1] || 1;
    return { k: TAU / lam, om: TAU * c / lam, c, damp: max(0, num(o.damping, 0)), A: 0.04 * lam * num(o.amp, 1), src: sources(o.sources, b),
      inv: [Y[1] / det, -X[1] / det, -Y[0] / det, X[0] / det], org: [org[0] - b[0], org[1] - b[1]], box: b, waves: [] };
  }
  const DEF = {
    fire: (b, o) => {
      const power = cn(o.power, 0.7, 0, 1);   // flame height grows as heat release to the 2/5 power
      return { ...common(o), base: o.base ?? bp(b, 0.5, 0.99), width: num(o.width, min(b[2] * 0.42, b[3] * 0.45)),
        height: num(o.height, b[3] * 0.9) * power ** 0.4, power, wind: cn(o.wind, 0, -1, 1), soot: cn(o.soot, 1, 0, 1), size: cn(o.size, 0.3, 0.005, 50) };
    },
    plume: (b, o) => {
      const thr = cn(o.throttle, 0.8, 0, 1), amb = cn(o.ambient, 1, 0, 1), a = num(o.angle, PI / 2), r = num(o.width, min(b[2], b[3]) * 0.16) / 2;
      const F = o.nozzle ? frame(o.nozzle, o.axis, o.along) : frame({ center: o.at ?? [b[0] + b[2] / 2, b[1] + r * 0.5], rx: r, ry: 0, angle: a + PI / 2 }, [cos(a), sin(a)], r);
      // Shock cells repeat every 1.3 D sqrt(M² - 1); thin air stretches them and balloons the plume.
      const M = 1.4 + 1.2 * thr;
      return { ...common(o), F, throttle: thr, ambient: amb, fuel: FUELS[o.fuel] ? o.fuel : "kerosene", length: 6 + 16 * thr,
        spacing: 2.62 * sqrt(M * M - 1) * sqrt(1.2 / (amb + 0.2)), spread: 0.05 + 0.5 * (1 - amb) ** 2,
        diamonds: o.diamonds === false ? 0 : smooth(0.05, 0.5, amb) * (0.3 + 0.7 * thr) * smooth(0, 0.12, thr) };
    },
    smoke: (b, o) => {
      const steam = o.kind === "steam";
      return { ...common(o), steam, at: o.at ?? bp(b, 0.5, 0.995), width: num(o.width, b[2] * 0.1), rise: num(o.rise, 0.35) * b[3],
        wind: cn(o.wind, 0, -3, 3), density: cn(o.density, 0.7, 0, 1), spread: cn(o.spread, 0.12, 0, 1), fade: (steam ? 4 : 0.3) / b[3], H: b[3] };
    },
    glow: (b, o) => {
      const T = num(o.temp, 2700);
      return { ...common(o), T, intensity: cn(o.intensity, glowLevel(T), 0, 2), at: o.path ? null : o.at ?? bp(b, 0.5, 0.5), r: num(o.r, 6),
        path: o.path ?? null, close: !!o.close, width: num(o.width, 2.5), spread: max(1, num(o.spread, 22)), core: o.core !== false };
    },
    ripples: (b, o) => ({ ...common(o), ...water(b, o, max(2, num(o.wavelength, 32)), num(o.speed, 48)), style: o.style === "height" ? 1 : 0,
      color: o.color ?? "blue", low: o.low ?? "blue", high: o.high ?? "red" }),
    caustics: (b, o) => {
      const scale = max(4, num(o.scale, 80)), w = water(b, o, max(2, num(o.wavelength, 32)), num(o.speed, 48)), s = num(o.seed, 1) | 0;
      if (!o.sources) w.src = [];
      // Wind waves from all round, with deep-water dispersion (long waves run faster).
      const G = (TAU / 1.6) ** 2 * scale / TAU, n = o.calm ? 0 : 6;
      for (let j = 0; j < n; j++) {
        const k = TAU / (scale * (0.55 + 0.9 * rnd(s, j, 1))), th = num(o.wind, 0.6) + (j + 0.7 * rnd(s, j, 2)) * PI / n;
        w.waves.push({ kx: k * cos(th), ky: k * sin(th), om: sqrt(G * k), ph: TAU * rnd(s, j, 3), A: 0.09 * num(o.amp, 1) / k });
      }
      return { ...common(o), ...w, depth: max(0, num(o.depth, scale * 2)), color: o.color ?? "blue" };
    },
    sparks: (b, o) => {
      const life = cn(o.life, 1.1, 0.05, 10);
      return { ...common(o), at: o.at ?? bp(b, 0.5, 0.85), angle: num(o.angle, -PI / 2), spread: num(o.spread, 0.55), speed: num(o.speed, b[3] * 1.5),
        rate: min(cn(o.rate, 50, 0, 2000), 1500 / life), life, gravity: num(o.gravity, b[3] * 2.2), drag: max(0, num(o.drag, 1.2)), temp: num(o.temp, 2000),
        width: num(o.width, 1.5), trail: cn(o.trail, 1 / 30, 0, 0.5) };
    },
    arc: (b, o) => ({ ...common(o), from: o.from ?? bp(b, 0.12, 0.5), to: o.to ?? bp(b, 0.88, 0.5),
      jitter: cn(o.jitter, 0.16, 0, 1), rate: max(0, num(o.rate, 7)), branches: cn(o.branches, 2, 0, 4) | 0, width: num(o.width, 1.6),
      spread: max(1, num(o.spread, 14)), intensity: cn(o.intensity, 1, 0, 2) }),
    shimmer: (b, o) => ({ ...common(o), strength: cn(o.strength, 2.5, 0, 40), scale: max(2, num(o.scale, 16)), rise: num(o.rise, 40) }),
    flow: (b, o) => {
      const inlet = o.inlet ?? { center: bp(b, 0.3, 0.45), rx: b[3] * 0.06, ry: b[3] * 0.2 }, nz = o.nozzle;
      const F = frame(inlet, o.axis ?? (nz ? [nz.center[0] - inlet.center[0], nz.center[1] - inlet.center[1]] : null), o.along);
      const sN = nz ? ((nz.center[0] - F.C[0]) * F.A[0] + (nz.center[1] - F.C[1]) * F.A[1]) / (F.A[0] ** 2 + F.A[1] ** 2 || 1) : 4;
      return { ...common(o), F, sN, throttle: cn(o.throttle, 0.7, 0, 1), temperature: num(o.temperature, 900), speed: cn(o.speed, 0.1, 0, 1),
        rN: nz ? max(abs(nz.rx), abs(nz.ry)) / F.R : 0.75, ground: num(o.ground, null), density: cn(o.density, 1, 0, 4), trail: cn(o.trail, 0.35, 0.05, 1),
        width: num(o.width, 1.2), intake: o.intake !== false, exhaust: o.exhaust !== false && sN > 0 };
    },
  };
  const params = (name, box, o = {}) => DEF[name](box, o);

  // ---------- models (shared by shaders, 2D, tests) ----------
  // Water at p: [h, h_x, h_y, h_xx, h_xy, h_yy]. Rings from each source fall as 1/sqrt(r) (their
  // energy spreads round a growing circle); a source with a start time sends out a front.
  function surf(p, w, t) {
    const o = [0, 0, 0, 0, 0, 0];
    for (const s of w.src) {
      const dx = p[0] - s.x, dy = p[1] - s.y, r = max(hypot(dx, dy), 1e-3), ex = dx / r, ey = dy / r;
      const f = s.amp * w.A / sqrt(1 + r * w.k / TAU) * exp(-w.damp * r) * (1 - smooth(-TAU / w.k, 0, r - w.c * (t - s.start)));
      const ph = w.k * r - w.om * t + s.phase, C = cos(ph), u1 = -f * w.k * sin(ph), u2 = -f * w.k * w.k * C, q = u1 / max(r, 0.3 / w.k);
      o[0] += f * C; o[1] += u1 * ex; o[2] += u1 * ey;
      o[3] += u2 * ex * ex + q * (1 - ex * ex); o[4] += (u2 - q) * ex * ey; o[5] += u2 * ey * ey + q * (1 - ey * ey);
    }
    for (const v of w.waves) {
      const ph = v.kx * p[0] + v.ky * p[1] - v.om * t + v.ph, C = v.A * cos(ph), S = v.A * sin(ph);
      o[0] += S; o[1] += C * v.kx; o[2] += C * v.ky; o[3] -= S * v.kx * v.kx; o[4] -= S * v.kx * v.ky; o[5] -= S * v.ky * v.ky;
    }
    return o;
  }
  // Floor light, 1 = flat water: refraction moves light from q to q + D grad h(q), D = (1 - 1/n)
  // depth, so a beam's area scales by det(I + D H) and its brightness by the inverse.
  function focus(p, w, t, depth) {
    const D = depth * (1 - 1 / 1.33), a = surf(p, w, t), b = surf([p[0] - D * a[1], p[1] - D * a[2]], w, t);
    return 1 / max(abs((1 + D * b[3]) * (1 + D * b[5]) - D * D * b[4] * b[4]), 0.12);
  }
  const toSurface = (w, q) => { const x = q[0] - w.box[0] - w.org[0], y = q[1] - w.box[1] - w.org[1]; return [w.inv[0] * x + w.inv[2] * y, w.inv[1] * x + w.inv[3] * y]; };

  // Spark k is born at k / rate with seeded speed, angle, and life, flies under gravity and
  // linear drag (solved exactly), and cools.
  function sparks(p) {
    const out = [], c = p.drag, G = p.gravity;
    for (let k = Math.ceil((p.t - p.life) * p.rate); p.rate > 0 && k <= floor(p.t * p.rate); k++) {
      const age = p.t - k / p.rate, life = p.life * (0.5 + 0.5 * rnd(p.seed, k, 2));
      if (age < 0 || age > life) continue;
      const a = p.angle + (rnd(p.seed, k, 0) * 2 - 1) * p.spread, v = p.speed * (0.4 + 0.6 * rnd(p.seed, k, 1));
      const pos = s => {
        s = max(0, s);
        const f = c > 1e-6 ? (1 - exp(-c * s)) / c : s;
        return [p.at[0] + cos(a) * v * f, p.at[1] + sin(a) * v * f + (c > 1e-6 ? (G / c) * (s - f) : 0.5 * G * s * s)];
      };
      const T = p.temp * (1 - 0.55 * age / life);
      out.push({ k, p: pos(age), tail: pos(age - p.trail), T, age, life, level: glowLevel(T) * smooth(0, 0.04, age) });
    }
    return out;
  }

  // A midpoint-displaced path whose kinks drift in time, plus branches that strike and fade.
  function arc(p) {
    const n = 64, A = p.from, B = p.to, L = hypot(B[0] - A[0], B[1] - A[1]) || 1, nx = (A[1] - B[1]) / L, ny = (B[0] - A[0]) / L, off = new Float64Array(n + 1);
    for (let step = n / 2, lv = 0; step >= 1; step /= 2, lv++) {
      for (let i = step; i < n; i += 2 * step) {
        const wob = noise1(p.t * p.rate * (1 + lv * 0.35) + i * 1.7, p.seed + lv) + 0.35 * noise1(p.t * p.rate * 4 + i, p.seed + 17);
        off[i] = (off[i - step] + off[i + step]) / 2 + wob * p.jitter * L * 0.5 ** (lv * 0.85) * 0.5;
      }
    }
    const path = Array.from(off, (o, i) => [lerp(A[0], B[0], i / n) + nx * o, lerp(A[1], B[1], i / n) + ny * o]);
    const strike = floor(p.t * p.rate * 0.6), phase = p.t * p.rate * 0.6 - strike, branches = [];
    for (let j = 0; j < p.branches; j++) {
      const r = q => rnd(p.seed + 31, strike * 8 + j, q), i0 = 6 + floor(r(0) * (n - 12)), a = path[i0], b = path[i0 + 1], len = L * (0.08 + 0.14 * r(3)) / 8, pts = [a];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + (r(1) < 0.5 ? -1 : 1) * (0.35 + 0.5 * r(2));
      for (let i = 1; i <= 8; i++) { const q = pts[i - 1], t = ang + (r(4 + i) - 0.5) * 0.9; pts.push([q[0] + cos(t) * len, q[1] + sin(t) * len]); }
      branches.push({ path: pts, level: (1 - phase) * smooth(0, 0.08, phase) });
    }
    return { path, branches, level: p.intensity * (0.85 + 0.15 * noise1(p.t * p.rate * 3, p.seed + 5)) };
  }

  // Airflow in part coordinates (inlet radii): intake into a sink over the inlet face, a jet that
  // slows, spreads, and cools, and curl noise. Particles born at fixed times are integrated from
  // birth on a fixed step, so each trail is a function of t.
  const TA = 288, H = 1 / 40;
  function flow(p) {
    const thr = p.throttle, U = p.speed * 4, W = 2.5 * thr, Vj = 3 + 11 * thr, out = [], ph = [0, 1, 2, 3, 4, 5].map(j => TAU * rnd(p.seed, 99, j));
    // Curl noise (an ABC flow): swirls without sources or sinks.
    const curl = (x, t, k, a, o) => {
      const X = x[0] * k + ph[o] + t * 0.8, Y = x[1] * k + ph[o + 1] - t * 0.6, Z = x[2] * k + ph[o + 2] + t * 0.7;
      return [a * (sin(Z) + cos(Y)), a * (sin(X) + cos(Z)), a * (sin(Y) + cos(X))];
    };
    // Intake paths ignore the settings; throttle (swirl) and speed (narrower capture) bend them
    // afterward, so a change can't re-time whole histories.
    const intake = (x, t) => {
      const [s, y, z] = x, rho = hypot(y, z) + 1e-9, k = min(rho, 0.85) / rho, dy = y - y * k, dz = z - z * k, d = hypot(s, dy, dz) + 0.3, m = 12 / (d * d * d), c = curl(x, t, 0.8, 0.2, 0);
      return [c[0] - m * s, c[1] - m * dy, c[2] - m * dz];
    };
    const twist = q => { const e = min(q[0], 0), a = W * exp(e * 0.7), m = 1 - 0.45 * p.speed * (1 - exp(e * 0.5)), c = cos(a) * m, s = sin(a) * m; return [q[0], q[1] * c - q[2] * s, q[1] * s + q[2] * c]; };
    const jet = (x, t) => {
      const ds = max(x[0] - p.sN, 0), vs = Vj / (1 + ds / 4), e = 0.14 * vs / (p.rN + 0.14 * ds);
      const a = curl(x, t, 0.9, 0.22 * vs * smooth(0, 2, ds), 3), b = curl(x, t * 1.7, 2.1, 0.12 * vs * smooth(0, 1, ds), 0);
      return [vs + U + a[0] + b[0], x[1] * e + a[1] + b[1], x[2] * e + a[2] + b[2]];
    };
    const disk = (s0, r) => u => { const a = TAU * u(3), q = r * sqrt(u(2)); return [s0(u), q * cos(a), q * sin(a)]; };
    const n = Math.ceil(p.trail / H) + 1, dens = 0.25 + 0.75 * thr, streams = [];
    if (p.intake) streams.push({ id: 1, rate: 45, life: 3.2, vel: intake, end: x => x[0] > -0.03, fadeIn: 0.7, temp: () => TA - 8, map: twist,
      spawn: disk(u => -(1.8 + 2.4 * u(1)), 2.2) });
    if (p.exhaust) streams.push({ id: 2, rate: 70, life: 1.4, vel: jet, end: x => x[0] > p.sN + 18, fadeIn: 0.1, spawn: disk(() => p.sN + 0.02, p.rN * 0.95), map: q => q,
      temp: (x, u) => TA + ((u(2) < 0.6 ? p.temperature : TA + 50) - TA) * exp(-max(x[0] - p.sN, 0) / 12) });
    for (const st of streams) {
      const rate = st.rate * p.density;
      for (let k = Math.ceil((p.t - st.life - p.trail) * rate); k <= floor(p.t * rate); k++) {
        const born = k / rate, age = p.t - born, u = j => rnd(p.seed + st.id * 7919, k, j);
        if (age < 0 || u(0) > dens + 0.25) continue;
        let x = st.spawn(u), tt = born, end = -1;
        const pts = [x], steps = floor(age / H + 1e-9);
        for (let i = 0; i <= steps; i++) {
          const v1 = st.vel(x, tt), v2 = st.vel(x.map((c, j) => c + v1[j] * H / 2), tt + H / 2), nx = x.map((c, j) => c + v2[j] * H);
          if (i === steps) { pts.push(x.map((c, j) => lerp(c, nx[j], age / H - steps))); break; }
          x = nx; tt += H; pts.push(x);
          if (pts.length > n + 2) pts.shift();
          if (st.end(x) || tt - born > st.life) { end = tt; break; }
        }
        // One that has gone in keeps its trail until the tail catches up.
        const keep = end < 0 ? n + 1 : Math.ceil((end - (p.t - p.trail)) / H);
        if (keep < 2) continue;
        const local = pts.slice(-keep);
        out.push({ stream: st.id === 1 ? "intake" : "exhaust", points: local.map(q => onScreen(p.F, st.map(q))), T: local.map(q => st.temp(q, u)),
          alpha: clamp((dens + 0.25 - u(0)) / 0.25, 0, 1) * smooth(0, st.fadeIn, age) * (end < 0 ? 1 : clamp((end - p.t + p.trail) / p.trail, 0, 1)) });
      }
    }
    // The ground vortex: strongest at high power, low forward speed, an inlet near the ground.
    if (p.intake && p.ground != null) {
      const F = p.F, top = onScreen(F, [-0.3, 0, 0]), foot = [onScreen(F, [-1.2, 0, 0])[0], p.ground], life = 1.3;
      const str = thr * thr * (1 - p.speed) ** 2 * (1 - smooth(1, 2.4, (p.ground - F.C[1]) / (2 * F.R)));
      for (let k = Math.ceil((p.t - life) * 22); k <= floor(p.t * 22); k++) {
        const u = j => rnd(p.seed + 5, k, j), age = p.t - k / 22, pts = [];
        if (age < 0 || u(0) > str) continue;
        for (let j = n; j >= 0; j--) {
          const a = clamp((age - j * H) / life, 0, 1), rad = F.R * 0.5 * (1 - 0.8 * a) * (0.6 + 0.4 * u(1)), th = TAU * (u(2) + 2.5 * a);
          pts.push([lerp(foot[0], top[0], a * a) + rad * cos(th), lerp(foot[1], top[1], a) + rad * 0.4 * sin(th)]);
        }
        out.push({ stream: "ground", points: pts, T: pts.map(() => TA - 8), alpha: smooth(0, 0.15, age) * (1 - smooth(0.85, 1, age / life)) * clamp((str - u(0)) / 0.25, 0, 1) });
      }
    }
    return out;
  }

  // ---------- GPU: one shared WebGL2 context, programs compiled once ----------
  const VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  // Shared: the pixel in box px, seeded gradient noise, ramps.
  const HEAD = `#version 300 es
precision highp float; precision highp int;
uniform vec2 uSize; uniform float uK, uT; uniform uint uSeed; uniform vec3 uRamp[4];
out vec4 o;
vec2 px() { return vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) / uK; }
float sq(float x) { return x * x; }
uint hs(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
vec2 gr(ivec2 c) { uvec2 u = uvec2(c & 0x7fffffff); float a = float(hs(u.x * 0x9e3779b1u ^ hs(u.y + uSeed))) * 1.4629181e-9; return vec2(cos(a), sin(a)); }
float nz(vec2 p) {
  vec2 f = fract(p), u = f * f * (3.0 - 2.0 * f); ivec2 i = ivec2(floor(p)), e = ivec2(1, 0);
  return mix(mix(dot(gr(i), f), dot(gr(i + e), f - vec2(1, 0)), u.x), mix(dot(gr(i + e.yx), f - vec2(0, 1)), dot(gr(i + 1), f - 1.0), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * nz(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.1; a *= 0.5; } return s; }
vec3 rampOf(vec3 r[4], float x) { x = clamp(x, 0.0, 1.0) * 3.0; int i = min(int(x), 2); return mix(r[i], r[i + 1], x - float(i)); }
vec4 emit(vec3 c, float a) { a = clamp(a, 0.0, 1.0); return vec4(c * a, a); }
`;
  const SURF = `
uniform vec4 uSrc[8], uWv[6]; uniform float uStart[8], uWa[6]; uniform int uN, uNw; uniform float uKk, uOm, uCs, uDamp, uAmp; uniform mat2 uInv; uniform vec2 uOrg;
void surf(vec2 p, out vec3 a, out vec3 b) {
  a = vec3(0.0); b = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uN) break;
    vec2 d = p - uSrc[i].xy; float r = max(length(d), 1e-3); vec2 e = d / r;
    float f = uSrc[i].w * uAmp * inversesqrt(1.0 + r * uKk * 0.1591549) * exp(-uDamp * r) * (1.0 - smoothstep(-6.2831853 / uKk, 0.0, r - uCs * (uT - uStart[i])));
    float ph = uKk * r - uOm * uT + uSrc[i].z, c = cos(ph), u1 = -f * uKk * sin(ph), u2 = -f * uKk * uKk * c, q = u1 / max(r, 0.3 / uKk);
    a += vec3(f * c, u1 * e);
    b += vec3(u2 * e.x * e.x + q * (1.0 - e.x * e.x), (u2 - q) * e.x * e.y, u2 * e.y * e.y + q * (1.0 - e.y * e.y));
  }
  for (int j = 0; j < 6; j++) {
    if (j >= uNw) break;
    vec4 w = uWv[j]; float ph = dot(w.xy, p) - w.z * uT + w.w, s = uWa[j] * sin(ph);
    a += vec3(s, uWa[j] * cos(ph) * w.xy);
    b -= s * vec3(w.x * w.x, w.x * w.y, w.y * w.y);
  }
}
vec2 sp() { return uInv * (px() - uOrg); }
`;
  const FS = {
    fire: `uniform vec2 uBase; uniform float uW, uH, uWind, uSoot, uPow, uHz; uniform vec3 uBlue[4];
void main() {
  vec2 p = px();
  float y = (uBase.y - p.y) / (uH * (1.0 + 0.08 * sin(6.2831853 * uT * uHz))), x = (p.x - uBase.x) / uW - uWind * y * y * 0.9;
  vec2 q = vec2(x * 2.4, y * 2.2 - uT * uHz * 1.2);
  float n = fbm(q + 0.4 * vec2(fbm(q * 1.7 + vec2(0.0, -uT * uHz)), 0.0)), d = abs(x + 0.45 * y * n) / (0.5 * pow(clamp(1.0 - y, 0.0, 1.0), 0.65) + 0.015);
  float heat = ((1.0 - d * d) * (1.05 - 0.55 * y) + n * (0.3 + 1.1 * y)) * smoothstep(-0.05, 0.04, y) * (1.0 - smoothstep(0.75, 1.2, y)) * (0.55 + 0.55 * uPow);
  float sm = uSoot * smoothstep(0.02, 0.22, y);   // soot forms only above the blue base
  o = emit(mix(rampOf(uBlue, heat), rampOf(uRamp, heat), sm), smoothstep(0.06, 0.4, heat) * mix(0.75, 1.0, sm));
}`,
    // Ray-marched: the inverse of the drawing's projection gives each pixel's line of sight.
    plume: `uniform vec2 uC, uA, uE1, uE2; uniform float uThr, uL, uSp, uSpr, uBody, uDia, uInk;
void main() {
  vec2 d = px() - uC;
  vec3 r1 = vec3(uA.x, uE1.x, uE2.x), r2 = vec3(uA.y, uE1.y, uE2.y), v = normalize(cross(r1, r2));
  float a = dot(r1, r1), b = dot(r1, r2), c = dot(r2, r2);
  vec3 x0 = (r1 * (c * d.x - b * d.y) + r2 * (a * d.y - b * d.x)) / (a * c - b * b);
  float smax = 2.5 * uL, vr = dot(v.yz, v.yz), lo = -1e4, hi = 1e4;
  o = vec4(0.0);
  if (vr > 1e-5) x0 += v * (-dot(x0.yz, v.yz) / vr);
  // Clip the line of sight to the cone rho < 1.6 R(s), where the light is.
  float a0 = 1.0 + uSpr * x0.x, b0 = uSpr * v.x, A = vr - 2.56 * b0 * b0, B = -5.12 * a0 * b0, C = dot(x0.yz, x0.yz) - 2.56 * a0 * a0;
  if (A > 1e-6) { float D = B * B - 4.0 * A * C; if (D <= 0.0) return; D = sqrt(D); lo = (-B - D) / (2.0 * A); hi = (-B + D) / (2.0 * A); }
  if (abs(v.x) > 1e-5) { float s0 = -x0.x / v.x, s1 = (smax - x0.x) / v.x; lo = max(lo, min(s0, s1)); hi = min(hi, max(s0, s1)); }
  else if (x0.x < 0.0 || x0.x > smax) return;
  if (hi <= lo) return;
  float st = (hi - lo) / 24.0, body = 0.0, hot = 0.0, dia = 0.0;
  for (int i = 0; i < 24; i++) {
    vec3 x = x0 + (lo + (float(i) + 0.5) * st) * v;
    float s = x.x, rho = length(x.yz), R = 1.0 + s * uSpr, e = rho / R, cr = 0.9 * max(0.0, 1.0 - s / (0.75 * uSp));
    body += exp(-2.0 * e * e - s / uL) / (R * R);
    hot += cr > 0.0 ? 1.0 - smoothstep(cr * 0.3, cr * 1.2, rho) : 0.0;
    // Shock cells: a bright Mach disk in each, cone-shaped shocks between.
    float ph = s / uSp, cell = fract(ph), rs = cell < 0.62 ? 1.0 - 0.55 * cell / 0.62 : 0.45 + 0.55 * (cell - 0.62) / 0.38;
    dia += (2.6 * exp(-sq((cell - 0.62) * uSp / 0.35) - 4.0 * rho * rho) + 0.25 * exp(-sq((rho - rs * 0.95) / 0.1))) * exp(-0.45 * floor(ph));
  }
  float n = fbm(vec2(x0.x * 0.3 - uT * (3.0 + 6.0 * uThr), (x0.y + x0.z) * 0.9));
  body *= st * uBody * 0.45 * (1.0 + 0.9 * n * smoothstep(0.0, 6.0, x0.x)) * (0.4 + uThr);
  hot *= st * 0.35 * (0.3 + 0.7 * uThr); dia *= st * uDia * 1.3;
  float E = max(body, 0.0) + hot + dia;
  o = emit(rampOf(uRamp, (body * 0.4 + hot * 0.75 + dia) / max(E, 1e-4)), (1.0 - exp(-E * uInk)) * smoothstep(0.0, 0.12, uThr));
}`,
    smoke: `uniform vec2 uSrc; uniform float uR0, uRise, uDrift, uDen, uSpr, uFade, uH; uniform vec3 uCol, uCol2;
void main() {
  vec2 p = px(); float z = uSrc.y - p.y, zp = max(z, 0.0), x = p.x - uSrc.x - uDrift * zp, b = uR0 + uSpr * zp, e = x / b;
  vec2 q = vec2(x, z - uT * uRise) / (uR0 * 1.5 + 0.12 * uH);
  float n = fbm(q + 1.2 * vec2(fbm(q * 0.7 + vec2(0.0, uT * 0.15)), fbm(q * 0.7 + vec2(5.2, -uT * 0.1))));
  float rho = exp(-1.4 * e * e) * pow(uR0 / b, 0.6) * smoothstep(-uR0, uR0 * 0.5, z) * exp(-zp * uFade) * clamp(0.55 + 1.6 * n, 0.0, 1.5);
  float a = 1.0 - exp(-rho * 2.5 * uDen);
  o = vec4(mix(uCol, uCol2, clamp(0.5 + n, 0.0, 1.0)) * a, a);
}`,
    // Bloom: a core, a near exponential falloff, a far tail that ends smoothly.
    glow: `uniform vec4 uSeg[96]; uniform float uSegW[96]; uniform int uNs; uniform float uW, uSpr, uI, uCore; uniform vec3 uHue, uHalo;
void main() {
  vec2 p = px(); float d = 1e9;
  for (int i = 0; i < 96; i++) {
    if (i >= uNs) break;
    vec2 pa = p - uSeg[i].xy, ba = uSeg[i].zw - uSeg[i].xy;
    d = min(d, length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0)) + (1.0 - uSegW[i]) * uSpr * 1.5);
  }
  float core = (1.0 - smoothstep(uW - 0.7, uW + 0.7, d)) * uCore, x = max(d - uW, 0.0) / uSpr;
  float a = clamp(core + uI * (0.55 * exp(-2.5 * x) + 0.45 / (1.0 + 3.0 * x * x) * (1.0 - smoothstep(2.5, 6.0, x))), 0.0, 1.0);
  o = vec4(mix(uHalo, uHue, clamp(core, 0.0, 1.0)) * a, a);
}`,
    ripples: SURF + `uniform int uStyle; uniform vec3 uLo, uMid, uHi; uniform vec2 uSun;
void main() {
  vec3 a, b; surf(sp(), a, b);
  if (uStyle == 1) { float h = clamp(a.x / (uAmp * 1.5), -1.0, 1.0); o = vec4(mix(uMid, h > 0.0 ? uHi : uLo, abs(h)), 1.0); return; }
  float sh = dot(a.yz, uSun);
  o = vec4(mix(mix(uMid, sh > 0.0 ? uHi : uLo, clamp(abs(sh), 0.0, 1.0)), uHi, pow(clamp(sh * 1.4, 0.0, 1.0), 4.0) * 0.6), 1.0);
}`,
    caustics: SURF + `uniform float uD; uniform vec3 uFloor, uShadow, uLight;
void main() {
  vec2 p = sp(); vec3 a, b; surf(p, a, b); surf(p - uD * a.yz, a, b);
  float I = 1.0 / max(abs((1.0 + uD * b.x) * (1.0 + uD * b.z) - uD * uD * b.y * b.y), 0.12);
  o = vec4(min(mix(uShadow, uFloor, min(I, 1.0)) + uLight * max(I - 1.2, 0.0) * 0.22, vec3(1.0)), 1.0);
}`,
    shimmer: `uniform sampler2D uTex; uniform vec4 uBx; uniform vec2 uCv; uniform float uDpr, uStr, uNs, uRise;
void main() {
  vec2 p = px(), q = vec2(p.x, p.y + uT * uRise) / uNs;
  vec2 dp = clamp(p + vec2(fbm(q), fbm(q + vec2(4.7, 1.3))) * uStr * (0.5 + 1.5 * smoothstep(0.0, uBx.w, p.y)), vec2(0.5), uBx.zw - 0.5);
  o = texture(uTex, (uBx.xy + dp * uDpr) / uCv);
}`,
  };

  let R = null, noGPU = false;
  const errors = [];
  function context() {
    if (R && !R.gl.isContextLost()) return R;
    R = null;
    if (noGPU || typeof document === "undefined") return null;
    try {
      const off = typeof OffscreenCanvas !== "undefined", canvas = off ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
      const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: !off, depth: false, stencil: false });
      if (!gl) { noGPU = true; return null; }
      R = { canvas, gl, off, w: 1, h: 1, progs: {}, vao: gl.createVertexArray() };
      canvas.addEventListener?.("webglcontextlost", e => { e.preventDefault(); R = null; });
    } catch (e) { noGPU = true; errors.push(String(e.message || e)); }
    return R;
  }
  function program(name) {
    if (name in R.progs) return R.progs[name];
    const gl = R.gl;
    let P = null;
    try {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, HEAD + FS[name]]]) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      P = { p, u: {} };
      for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
        const a = gl.getActiveUniform(p, i);
        P.u[a.name.replace(/\[0\]$/, "")] = { loc: gl.getUniformLocation(p, a.name), type: a.type };
      }
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      console.warn(`[Fx] ${name} shader failed; using 2D.`, e.message);
    }
    return (R.progs[name] = P);
  }
  function uniforms(P, u) {
    const gl = R.gl, FN = { [gl.FLOAT]: "uniform1fv", [gl.FLOAT_VEC2]: "uniform2fv", [gl.FLOAT_VEC3]: "uniform3fv", [gl.FLOAT_VEC4]: "uniform4fv" };
    for (const [name, v] of Object.entries(u)) {
      const i = P.u[name], a = typeof v === "number" ? [v] : v;
      if (!i) continue;
      if (v?.width !== undefined) {   // a canvas: the texture
        R.tex ??= gl.createTexture();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.uniform1i(i.loc, 0);
      } else if (FN[i.type]) gl[FN[i.type]](i.loc, a);
      else if (i.type === gl.FLOAT_MAT2) gl.uniformMatrix2fv(i.loc, false, a);
      else if (i.type === gl.UNSIGNED_INT) gl.uniform1ui(i.loc, a[0] >>> 0);
      else gl.uniform1i(i.loc, a[0] | 0);
    }
  }
  // Renders a shader over the box at figure size (density capped at 2).
  function render(g, box, name, u, o) {
    if (o.gpu === false || Fx.force2d || !context() || !program(name)) return null;
    const gl = R.gl, P = R.progs[name], k = min(g.dpr || 1, 2) * cn(o.res, 1, 0.25, 1), W = max(1, Math.round(box[2] * k)), Hh = max(1, Math.round(box[3] * k));
    if (W > R.w || Hh > R.h) { R.w = max(W, R.w); R.h = max(Hh, R.h); R.canvas.width = R.w; R.canvas.height = R.h; }
    gl.viewport(0, 0, W, Hh);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(P.p);
    uniforms(P, { uSize: [W, Hh], uK: k, ...u });
    gl.bindVertexArray(R.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return { img: R.off ? R.canvas.transferToImageBitmap() : R.canvas, sy: R.h - Hh, W, H: Hh };
  }

  // ---------- 2D versions (no WebGL2, or gpu: false) ----------
  const trace = (c, pts) => { c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); };
  const stroke = (c, pts, close) => { trace(c, pts); if (close) c.closePath(); c.stroke(); };
  function fire2d(c, p, F, B) {   // a flickering teardrop, blue at the base
    const { width: w0, base: [x0, y0] } = p, hz = puff(p.size), h = p.height * (1 + 0.1 * noise1(p.t * hz * 1.3, p.seed)), w = w0 / 2;
    const tx = x0 + p.wind * 0.9 * w0 + 0.1 * noise1(p.t * hz * 0.8 + 7, p.seed) * h, gr = c.createLinearGradient(x0, y0, tx, y0 - h);
    [[0, 0.9, 0], [0.2, 0.9, 1], [0.6, 0.55, 1], [1, 0.25, 1]].forEach(([at, heat, k]) => gr.addColorStop(at, css(mixc(ramp(B, heat), ramp(F, heat), p.soot * k), 0.9 - at * 0.6)));
    c.beginPath(); c.moveTo(x0 - w, y0);
    c.bezierCurveTo(x0 - w, y0 - h * 0.5, tx - w * 0.15, y0 - h * 0.78, tx, y0 - h);
    c.bezierCurveTo(tx + w * 0.15, y0 - h * 0.78, x0 + w, y0 - h * 0.5, x0 + w, y0);
    c.fillStyle = gr; c.fill();
  }
  function plume2d(c, p, st, F = p.F) {   // the plume's outline, shaded hot to cool
    const n = [-F.dir[1], F.dir[0]], half = hypot(F.E1[0] * n[0] + F.E1[1] * n[1], F.E2[0] * n[0] + F.E2[1] * n[1]), S = p.length * 1.6, side = [];
    for (let i = 0; i <= 12; i++) {
      const s = S * i / 12, r = (1 + s * p.spread) * half, m = onScreen(F, [s, 0, 0]);
      side.push([m[0] + n[0] * r, m[1] + n[1] * r]); side.unshift([m[0] - n[0] * r, m[1] - n[1] * r]);
    }
    const end = onScreen(F, [S, 0, 0]), gr = c.createLinearGradient(F.C[0], F.C[1], end[0], end[1]), a = smooth(0, 0.12, p.throttle);
    [[0, 0.9, 0.95], [0.3, 0.45, 0.6 * FUELS[p.fuel].body * (0.4 + p.throttle)], [1, 0.2, 0]].forEach(([at, h, k]) => gr.addColorStop(at, css(ramp(st, h), a * k)));
    c.fillStyle = gr; trace(c, side); c.fill();
  }
  function smoke2d(c, p, col) {
    const life = min(6, (p.H * 0.95) / max(p.rise, 1));
    for (let k = Math.ceil((p.t - life) * 9); k <= floor(p.t * 9); k++) {
      const age = p.t - k / 9, z = age * p.rise, b = max(1, p.width / 2 + p.spread * z), x = p.at[0] + p.wind * z + (rnd(p.seed, k, 0) - 0.5) * b, y = p.at[1] - z;
      const a = p.density * 0.35 * smooth(0, 0.3, age) * (1 - age / life) * exp(-z * p.fade) * (p.width / 2 / b) ** 0.6, gr = c.createRadialGradient(x, y, 0, x, y, b * 1.3);
      gr.addColorStop(0, css(col, a)); gr.addColorStop(1, css(col, 0));
      c.fillStyle = gr; c.fillRect(x - b * 1.3, y - b * 1.3, b * 2.6, b * 2.6);
    }
  }
  function glow2d(c, p, core, halo, lines) {
    c.lineCap = c.lineJoin = "round";
    for (const L of lines) {
      for (let i = 6; i >= 1; i--) { c.strokeStyle = css(halo, p.intensity * L.level * 0.09); c.lineWidth = p.width + p.spread * i * 0.5; stroke(c, L.path, L.close); }
      if (p.core) { c.strokeStyle = css(core, L.level); c.lineWidth = p.width; stroke(c, L.path, L.close); }
    }
  }
  // fn(x, y) on a coarse grid, smoothed up to the box.
  let gridCanvas = null;
  function grid(c, box, fn) {
    const cell = max(2, sqrt(box[2] * box[3] / 9000)), nx = max(2, Math.ceil(box[2] / cell)), ny = max(2, Math.ceil(box[3] / cell));
    gridCanvas ??= document.createElement("canvas");
    gridCanvas.width = nx; gridCanvas.height = ny;
    const c2 = gridCanvas.getContext("2d"), img = c2.createImageData(nx, ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const col = fn(box[0] + (i + 0.5) * box[2] / nx, box[1] + (j + 0.5) * box[3] / ny);
      img.data.set([col[0] * 255, col[1] * 255, col[2] * 255, 255], (j * nx + i) * 4);
    }
    c2.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true;
    c.drawImage(gridCanvas, box[0], box[1], box[2], box[3]);
  }

  // ---------- helpers on g ----------
  (window.__safisG ||= []).push((g, util) => {
    const pal = n => util.rgb(n).map(v => v / 255);
    const isDark = () => { const c = util.rgb("panel"); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 128; };
    const boxOf = b => (Array.isArray(b) && b.length === 4 ? b.map(Number) : [0, 0, g.w, g.h]);
    const local = (q, box) => [q[0] - box[0], q[1] - box[1]];
    // Composites into the box (or o.clip). Light adds on a dark page and multiplies on a light
    // one, tinting the paper like ink (added light washes out on white). Paint covers.
    function layer(box, o, light, fn) {
      const c = g.ctx;
      c.save();
      if (o.clip?.length > 2) trace(c, o.clip); else { c.beginPath(); c.rect(...box); }
      c.clip();
      c.globalCompositeOperation = { add: "lighter", multiply: "multiply", over: "source-over" }[o.blend] ?? (light ? (isDark() ? "lighter" : "multiply") : "source-over");
      c.globalAlpha = cn(o.alpha, 1, 0, 1);
      fn(c);
      c.restore();
    }
    function draw(box, o, p, light, name, u, fallback) {
      const r = u && render(g, box, name, { uT: p.t, uSeed: hash(p.seed), ...u }, o);
      layer(box, o, light, c => { if (!r) return fallback(c); c.imageSmoothingEnabled = true; c.drawImage(r.img, 0, r.sy, r.W, r.H, ...box); });
      r?.img.close?.();
      return !!r;
    }
    const pad = (a, n) => a.concat(Array(max(0, n - a.length)).fill(0)).slice(0, n);
    const waterU = p => ({
      uN: p.src.length, uNw: p.waves.length, uKk: p.k, uOm: p.om, uCs: p.c, uDamp: p.damp, uAmp: p.A, uInv: p.inv, uOrg: p.org,
      uSrc: pad(p.src.flatMap(s => [s.x, s.y, s.phase, s.amp]), 32), uStart: pad(p.src.map(s => s.start), 8),
      uWv: pad(p.waves.flatMap(w => [w.kx, w.ky, w.om, w.ph]), 24), uWa: pad(p.waves.map(w => w.A), 6),
    });
    // Glow shader input: segments in box px, each with a weight.
    const glowU = (lines, box, core, halo, I, width, spread, on = true) => {
      const s = [], w = [];
      for (const ln of lines) {
        const pts = ln.close ? [...ln.path, ln.path[0]] : ln.path;
        for (let i = 1; i < pts.length && w.length < 96; i++) { s.push(...local(pts[i - 1], box), ...local(pts[i], box)); w.push(ln.level); }
      }
      return { uSeg: pad(s, 384), uSegW: pad(w, 96), uNs: w.length, uW: width / 2, uSpr: spread, uI: I, uCore: on ? 1 : 0, uHue: core, uHalo: halo };
    };
    const fx = {}, def = (name, fn) => { fx[name] = (b, o = {}) => { const box = boxOf(b); return { box, ...fn(box, DEF[name](box, o), o, isDark()) }; }; };

    def("fire", (box, p, o, dk) => {
      const F = FIRE[dk ? "d" : "l"], B = BLUE[dk ? "d" : "l"];
      return { gpu: p.height >= 1 && draw(box, o, p, true, "fire", { uRamp: F.flat(), uBlue: B.flat(), uBase: local(p.base, box), uW: p.width, uH: p.height,
        uWind: p.wind, uSoot: p.soot, uPow: p.power, uHz: puff(p.size) }, c => fire2d(c, p, F, B)), height: p.height, tip: [p.base[0] + p.wind * 0.9 * p.width, p.base[1] - p.height] };
    });

    def("plume", (box, p, o, dk) => {
      const F = p.F, st = FUELS[p.fuel][dk ? "d" : "l"], diamonds = [];
      for (let k = 0; p.diamonds > 0.05 && (k + 0.62) * p.spacing < p.length * 1.2; k++) diamonds.push(onScreen(F, [(k + 0.62) * p.spacing, 0, 0]));
      return { gpu: draw(box, o, p, true, "plume", { uRamp: st.flat(), uC: local(F.C, box), uA: F.A, uE1: F.E1, uE2: F.E2, uThr: p.throttle, uL: p.length, uSp: p.spacing,
        uSpr: p.spread, uBody: FUELS[p.fuel].body, uDia: p.diamonds, uInk: dk ? 1.8 : 2.8 }, c => plume2d(c, p, st)), length: p.length * F.along, end: onScreen(F, [p.length, 0, 0]), diamonds };
    });

    def("smoke", (box, p, o, dk) => {
      const col = o.color ? pal(o.color) : p.steam ? (dk ? [0.9, 0.92, 0.95] : [0.6, 0.65, 0.72]) : dk ? [0.6, 0.6, 0.62] : [0.3, 0.3, 0.32];
      return { gpu: draw(box, o, p, false, "smoke", { uSrc: local(p.at, box), uR0: max(1, p.width / 2), uRise: p.rise, uDrift: p.wind, uDen: p.density, uSpr: p.spread,
        uFade: p.fade, uH: p.H, uCol: col, uCol2: mixc(col, dk ? W1 : [0, 0, 0], p.steam ? 0.12 : 0.18) }, c => smoke2d(c, p, col)) };
    });
    fx.steam = (b, o = {}) => fx.smoke(b, { ...o, kind: "steam" });

    def("glow", (box, p, o, dk) => {
      const tint = o.color ? pal(o.color) : hue(blackbody(p.T)).map(v => (dk ? v : v ** 1.4)), core = dk ? mixc(tint, W1, p.intensity - 0.5) : tint;
      const lines = [{ path: p.path ?? [p.at, p.at], close: p.close, level: 1 }], w = p.path ? p.width : p.r * 2;
      return { gpu: draw(box, o, p, true, "glow", glowU(lines, box, core, tint, p.intensity, w, p.spread, p.core), c => glow2d(c, { ...p, width: w }, core, tint, lines)), color: css(tint), level: p.intensity };
    });

    def("ripples", (box, p, o, dk) => {
      const paper = pal("panel"), tint = pal(p.color), sun = [-2.65, -2.98];
      const c3 = p.style ? [mixc(paper, pal(p.low), 0.85), paper, mixc(paper, pal(p.high), 0.85)]
        : [mixc(paper, tint, dk ? 0.06 : 0.6), mixc(paper, tint, dk ? 0.26 : 0.2), dk ? mixc(tint, W1, 0.55) : W1];
      const gpu = draw(box, o, p, false, "ripples", { ...waterU(p), uStyle: p.style, uLo: c3[0], uMid: c3[1], uHi: c3[2], uSun: sun }, c => grid(c, box, (x, y) => {
        const a = surf(toSurface(p, [x, y]), p, p.t), sh = p.style ? clamp(a[0] / (p.A * 1.5), -1, 1) : a[1] * sun[0] + a[2] * sun[1], col = mixc(c3[1], sh > 0 ? c3[2] : c3[0], abs(sh));
        return p.style ? col : mixc(col, c3[2], clamp(sh * 1.4, 0, 1) ** 4 * 0.6);
      }));
      return { gpu, wavelength: TAU / p.k, period: TAU / p.om, height: q => surf(toSurface(p, q), p, p.t)[0] / p.A };
    });

    def("caustics", (box, p, o, dk) => {
      const paper = pal("panel"), tint = pal(p.color), fl = mixc(paper, tint, dk ? 0.34 : 0.3), sh = mixc(paper, tint, dk ? 0.16 : 0.5), lt = dk ? mixc(tint, W1, 0.7) : W1;
      const gpu = draw(box, o, p, false, "caustics", { ...waterU(p), uD: p.depth * (1 - 1 / 1.33), uFloor: fl, uShadow: sh, uLight: lt }, c => grid(c, box, (x, y) => {
        const I = focus(toSurface(p, [x, y]), p, p.t, p.depth);
        return fl.map((v, i) => min(1, lerp(sh[i], v, min(I, 1)) + lt[i] * max(I - 1.2, 0) * 0.22));
      }));
      return { gpu, intensity: q => focus(toSurface(p, q), p, p.t, p.depth) };
    });

    def("sparks", (box, p, o, dk) => {
      const list = sparks(p);
      draw(box, o, p, true, "", null, c => {
        c.lineCap = "round";
        for (const s of list) {
          const col = hue(blackbody(s.T)).map(v => (dk ? v : v ** 1.6));
          c.strokeStyle = css(col, s.level * 0.25); c.lineWidth = p.width * 3.5; stroke(c, [s.tail, s.p]);
          c.strokeStyle = css(dk ? mixc(col, W1, 0.4 * s.level) : col, s.level); c.lineWidth = p.width; stroke(c, [s.tail, s.p]);
        }
      });
      return { gpu: false, sparks: list };
    });

    def("arc", (box, p, o, dk) => {
      const A = arc(p), I = A.level * 0.8, lines = [{ path: A.path, level: 1 }, ...A.branches];
      // Air in an arc glows blue-violet (nitrogen's emission lines) around a white-hot core.
      const halo = o.color ? pal(o.color) : dk ? [0.55, 0.55, 1] : [0.45, 0.32, 0.95], core = dk ? W1 : mixc(halo, [0.15, 0.05, 0.5], 0.5);
      return { gpu: draw(box, o, p, true, "glow", glowU(lines, box, core, halo, I, p.width, p.spread), c => glow2d(c, { spread: p.spread, core: true, intensity: I, width: p.width }, core, halo, lines)),
        path: A.path, branches: A.branches.map(q => q.path) };
    });

    def("shimmer", (box, p, o) => {
      const cv = g.ctx.canvas, dpr = cv.width / max(1, g.w);
      return { gpu: p.strength > 0 && draw(box, o, p, false, "shimmer", { uTex: cv, uBx: [box[0] * dpr, box[1] * dpr, box[2], box[3]], uCv: [cv.width, cv.height], uDpr: dpr,
        uStr: p.strength, uNs: p.scale, uRise: p.rise }, c => {   // without WebGL2, rows slide sideways
        for (let r = 0; r < box[3]; r += 2) c.drawImage(cv, box[0] * dpr, (box[1] + r) * dpr, box[2] * dpr, 2 * dpr, box[0] + noise1((r - p.t * p.rise) / p.scale, p.seed) * p.strength * (0.25 + 0.75 * r / box[3]), box[1] + r, box[2], 2);
      }) };
    });

    def("flow", (box, p, o, dk) => {
      const trails = flow(p), stops = ["blue", "purple", "red", "orange"].map(pal);
      draw(box, o, p, false, "", null, c => {
        c.lineCap = c.lineJoin = "round";
        for (const tr of trails) {
          const pts = tr.points, n = pts.length - 1;
          c.lineWidth = p.width * (tr.stream === "exhaust" ? 1.15 : 1);
          for (let j = 0, i0 = 0, i1; j < 3; j++, i0 = i1) {
            i1 = floor((j + 1) * n / 3);
            if (i1 <= i0) continue;
            c.strokeStyle = css(ramp(stops, clamp((tr.T[i1] - TA) / (900 - TA), 0, 1) ** 0.75), tr.alpha * [0.2, 0.5, 0.9][j] * (tr.stream === "ground" ? 0.7 : dk ? 0.85 : 1));
            stroke(c, pts.slice(i0, i1 + 1));
          }
        }
      });
      return { gpu: false, count: trails.length, frame: p.F };
    });
    g.fx = fx;
  });

  // The bare models, for labels and tests.
  const model = (name, fn) => (box, o = {}, q) => { const p = params(name, box, o); return fn(p, q && toSurface(p, q)); };
  const Fx = {
    hash, noise: noise1, blackbody, glowLevel, puff, follow, frame, ellipse, project: onScreen, params,
    surface: model("caustics", (p, q) => surf(q, p, p.t)), focus: model("caustics", (p, q) => focus(q, p, p.t, p.depth)),
    sparks: model("sparks", sparks), arc: model("arc", arc), flow: model("flow", flow),
    force2d: false,
    get gpu() { return !this.force2d && !!context(); },
    get still() { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; },
    errors,
  };
  window.Fx = Fx;
})();

;

/* Iso kit: isometric technical illustration as vector polygons on the 2D canvas: solid parts in
   flat tones, ink outlines, a separating-plane paint order, SVG export. Reference: references/iso.md. */
(() => {
  "use strict";
  const { sin, cos, sqrt, abs, min, max, hypot, exp, PI, floor, round, ceil } = Math;
  const TAU = 2 * PI, clamp = (x, a, b) => min(b, max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = a => { const l = hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const axv = a => (typeof a === "string" ? scl(AX[a.replace(/[+-]/, "")], a[0] === "-" ? -1 : 1) : nrm(a));
  const now = () => performance.now();

  // ---------- affine 3x4 matrices, row-major: x' = m0 x + m1 y + m2 z + m3 ----------
  const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  function mul(a, b) {
    const o = new Array(12);
    for (let r = 0; r < 12; r += 4) {
      const x = a[r], y = a[r + 1], z = a[r + 2];
      o[r] = x * b[0] + y * b[4] + z * b[8]; o[r + 1] = x * b[1] + y * b[5] + z * b[9];
      o[r + 2] = x * b[2] + y * b[6] + z * b[10]; o[r + 3] = x * b[3] + y * b[7] + z * b[11] + a[r + 3];
    }
    return o;
  }
  const ap = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
  const ad = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[4] * p[0] + m[5] * p[1] + m[6] * p[2], m[8] * p[0] + m[9] * p[1] + m[10] * p[2]];
  function rot(axis, ang, about) {
    const [x, y, z] = axv(axis), c = cos(ang), s = sin(ang), t = 1 - c;
    const m = [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0, t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0];
    if (about) { const q = ad(m, about); m[3] = about[0] - q[0]; m[7] = about[1] - q[1]; m[11] = about[2] - q[2]; }
    return m;
  }
  // A node's pose: its rotations in order, then its move.
  function pose(n) {
    let m = ID;
    for (const r of [].concat(n.rotate || [])) if (r && r.angle) m = mul(rot(r.axis ?? "z", r.angle, r.about), m);
    if (n.move) { m = m.slice(); m[3] += n.move[0]; m[7] += n.move[1]; m[11] += n.move[2]; }
    return m;
  }
  // Right-handed basis [u, v, w] with w along the axis.
  const BASES = { x: [[0, 1, 0], [0, 0, 1], [1, 0, 0]], "-x": [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], y: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    "-y": [[1, 0, 0], [0, 0, 1], [0, -1, 0]], z: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "-z": [[0, 1, 0], [1, 0, 0], [0, 0, -1]] };
  function basis(a) {
    if (typeof a === "string") return BASES[a.replace("+", "")];
    const w = nrm(a), u = nrm(crs(abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], w));
    return [u, crs(w, u), w];
  }
  function frame(at = [0, 0, 0], a = "z", spin = 0) {
    let [u, v, w] = basis(a);
    if (spin) { const c = cos(spin), s = sin(spin); [u, v] = [add(scl(u, c), scl(v, s)), add(scl(u, -s), scl(v, c))]; }
    return [u[0], v[0], w[0], at[0], u[1], v[1], w[1], at[1], u[2], v[2], w[2], at[2]];
  }

  // ---------- meshes: vertices plus polygon faces (outer loop, optional holes) ----------
  let SID = 1, NID = 1;
  class Mesh {
    constructor() { this.id = NID++; this.P = []; this.F = []; this.convex = false; this.wrap = null; }
    v(x, y, z) { this.P.push(x, y, z); return this.P.length / 3 - 1; }
    f(v, s = 0, c = 0, x) { const F = { v, s, c }; if (x) Object.assign(F, x); this.F.push(F); return F; }
  }
  function newell(P, L) {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < L.length; i++) {
      const a = L[i] * 3, b = L[(i + 1) % L.length] * 3;
      x += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]); y += (P[a + 2] - P[b + 2]) * (P[a] + P[b]); z += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
    }
    return nrm([x, y, z]);
  }
  // Edges with their two faces; a crease is drawn where flat faces meet at an angle.
  function edges(F) {
    const map = new Map(), E = [];
    F.forEach((f, i) => {
      if (f.d) return;
      for (const L of f.h ? [f.v, ...f.h] : [f.v]) for (let j = 0; j < L.length; j++) {
        const a = L[j], b = L[(j + 1) % L.length];
        if (a === b) continue;
        const k = a < b ? a * 2097152 + b : b * 2097152 + a, e = map.get(k);
        if (e && e[3] < 0) e[3] = i; else { const ne = [a, b, i, -1, 0]; map.set(k, ne); E.push(ne); }
      }
    });
    for (const e of E) {
      if (e[3] < 0) { e[4] = 1; continue; }
      const A = F[e[2]], B = F[e[3]];
      e[4] = A.s && A.s === B.s ? 0 : dot(A.n, B.n) < 0.985 ? 1 : 0;
    }
    return E;
  }
  function finish(m) {
    for (const f of m.F) if (!f.n) f.n = newell(m.P, f.v);
    m.E = edges(m.F);
    m.nc = 1 + max(0, ...m.F.map(f => f.c || 0));
    return m;
  }
  function bake(m, F) {
    const P = m.P;
    for (let i = 0; i < P.length; i += 3) { const q = ap(F, [P[i], P[i + 1], P[i + 2]]); P[i] = q[0]; P[i + 1] = q[1]; P[i + 2] = q[2]; }
    if (m.wrap) m.wrap = { ...m.wrap, o: ap(F, m.wrap.o), a: ad(F, m.wrap.a) };
    if (m.ax) m.ax = ad(F, m.ax);
    return m;
  }

  // ---------- 2D outlines ----------
  const area = L => { let a = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const orient = (L, ccw) => ((area(L) > 0) === ccw ? L : L.slice().reverse());
  function convex2(L) {
    let sg = 0;
    for (let i = 0; i < L.length; i++) {
      const a = L[i], b = L[(i + 1) % L.length], c = L[(i + 2) % L.length], z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (abs(z) < 1e-12) continue;
      if (sg && Math.sign(z) !== sg) return false;
      sg = Math.sign(z);
    }
    return true;
  }
  const leftN = (x, y) => { const l = hypot(x, y) || 1; return [-y / l, x / l]; };
  function inset(L, d) {
    const n = L.length;
    return L.map((p, i) => {
      const a = L[(i + n - 1) % n], b = L[(i + 1) % n], n1 = leftN(p[0] - a[0], p[1] - a[1]), n2 = leftN(b[0] - p[0], b[1] - p[1]);
      const m = nrm([n1[0] + n2[0], n1[1] + n2[1], 0]), k = d / max(0.25, m[0] * n1[0] + m[1] * n1[1]);
      return [p[0] + m[0] * k, p[1] + m[1] * k];
    });
  }
  // Smooth-group id per edge: edges joined at gentle corners share a group (no crease line).
  function groups(L, cyclic, singles) {
    const n = L.length, segs = cyclic ? n : n - 1, id = new Array(segs);
    const sharp = j => {
      if (!cyclic && (j === 0 || j === n - 1)) return true;
      const a = L[(j + n - 1) % n], p = L[j], c = L[(j + 1) % n], d1 = [p[0] - a[0], p[1] - a[1]], d2 = [c[0] - p[0], c[1] - p[1]];
      return (d1[0] * d2[0] + d1[1] * d2[1]) / (hypot(...d1) * hypot(...d2) || 1) < 0.9;
    };
    let st = 0;
    if (cyclic) { st = -1; for (let j = 0; j < n; j++) if (sharp(j)) { st = j; break; } if (st < 0) return id.fill(SID++); }
    let s = 0;
    for (let k = 0; k < segs; k++) { const j = (st + k) % n; if (!k || sharp(j)) s = SID++; id[j] = s; }
    if (singles) return id;
    const cnt = {}; for (const g of id) cnt[g] = (cnt[g] || 0) + 1;
    return id.map(g => (cnt[g] > 1 ? g : 0));
  }
  function rrect(x, y, w, h, r = 0, n = 4) {
    if (r <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    r = min(r, w / 2, h / 2);
    const pts = [];
    for (const [cx, cy, a0] of [[x + w - r, y + r, -PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, PI / 2], [x + r, y + r, PI]])
      for (let i = 0; i <= n; i++) { const a = a0 + (PI / 2) * i / n; pts.push([cx + r * cos(a), cy + r * sin(a)]); }
    return pts;
  }
  const circle = (c, r, n = 20) => Array.from({ length: n }, (_, i) => [c[0] + r * cos(i * TAU / n), c[1] + r * sin(i * TAU / n)]);

  // ---------- core builders, in local coordinates (Z is the axis) ----------
  // A 2D outline lifted from z0 to z1, with holes or a chamfer, split into chunks along Z.
  function prism(out, holes, z0, z1, o = {}) {
    const m = new Mesh(), n = max(1, o.split || 1), b = holes.length ? 0 : min(o.bevel || 0, (z1 - z0) / 2.2);
    out = orient(out, true); holes = holes.map(h => orient(h, false));
    const lv = [];
    if (b) lv.push([z0, 1]);
    for (let i = 0; i <= n; i++) lv.push([lerp(z0 + b, z1 - b, i / n), 0]);
    if (b) lv.push([z1, 2]);
    const last = lv.length - 1;
    const rings = [out, ...holes].map(L => {
      const sid = groups(L, true, false), ins = b ? inset(L, b) : L;
      const R = lv.map(([z, t]) => (t ? ins : L).map(p => m.v(p[0], p[1], z)));
      for (let i = 0; i < last; i++) {
        const kind = lv[i][1] === 1 ? 1 : lv[i + 1][1] === 2 ? 2 : 0, c = clamp(i - (b ? 1 : 0), 0, n - 1);
        for (let j = 0; j < L.length; j++) { const j2 = (j + 1) % L.length; m.f([R[i][j], R[i][j2], R[i + 1][j2], R[i + 1][j]], sid[j] ? sid[j] * 4 + kind : 0, c); }
      }
      return R;
    });
    const hl = k => (holes.length ? { h: rings.slice(1).map(R => (k ? R[k] : R[0].slice().reverse())) } : null);
    m.f(rings[0][0].slice().reverse(), 0, 0, hl(0));
    m.f(rings[0][last], 0, n - 1, hl(last));
    m.convex = !holes.length && convex2(out);
    return m;
  }
  // A profile [[r, z], ...] turned about Z. Closed profiles (all r > 0) make shells.
  function lathe(prof, o = {}) {
    const m = new Mesh(), seg = o.segments || 32, closed = !!o.closed, ph = o.phase || 0;
    let pr = prof.map(p => [max(0, p[0]), p[1]]);
    const za = min(...pr.map(p => p[1])), zb = max(...pr.map(p => p[1])), rm = max(...pr.map(p => p[0]));
    // Shells split along their axis (splitAt: positions, to line up coaxial shells).
    const n0 = max(1, o.split ?? (closed ? clamp(round((zb - za) / rm), 1, 8) : 1));
    const zs = o.splitAt ? [za, ...o.splitAt.filter(z => z > za && z < zb), zb] : Array.from({ length: n0 + 1 }, (_, k) => lerp(za, zb, k / n0)), n = zs.length - 1;
    if (n > 1) {
      const q = [], L = closed ? pr.length : pr.length - 1;
      for (let i = 0; i < pr.length; i++) {
        const a = pr[i], b = i < L ? pr[(i + 1) % pr.length] : null; q.push(a);
        if (b) { const cut = zs.slice(1, -1).filter(z => (a[1] - z) * (b[1] - z) < 0); if (b[1] < a[1]) cut.reverse(); for (const z of cut) { const t = (z - a[1]) / (b[1] - a[1]); q.push([lerp(a[0], b[0], t), z]); } }
      }
      pr = q;
    }
    const chunkOf = z => { let k = 0; while (k < n - 1 && z >= zs[k + 1]) k++; return k; };
    const rings = pr.map(([r, z]) => (r < 1e-9 ? null : Array.from({ length: seg }, (_, j) => m.v(r * cos(ph + j * TAU / seg), r * sin(ph + j * TAU / seg), z))));
    const apex = pr.map(([r, z]) => (r < 1e-9 ? m.v(0, 0, z) : -1));
    const sid = groups(pr, closed, true), segs = closed ? pr.length : pr.length - 1, smooth = seg >= 10;
    for (let i = 0; i < segs; i++) {
      const i2 = (i + 1) % pr.length, A = rings[i], B = rings[i2];
      const c = chunkOf((pr[i][1] + pr[i2][1]) / 2), s = smooth ? sid[i] : 0;
      if (!A && !B) continue;
      if (!A || !B) {
        if (abs(pr[i][1] - pr[i2][1]) < 1e-9) m.f(A ? A.slice() : B.slice().reverse(), 0, c);
        else for (let j = 0; j < seg; j++) { const j2 = (j + 1) % seg; m.f(A ? [A[j], A[j2], apex[i2]] : [apex[i], B[j2], B[j]], s, c); }
        continue;
      }
      for (let j = 0; j < seg; j++) { const j2 = (j + 1) % seg; m.f([A[j], A[j2], B[j2], B[j]], s, c); }
    }
    const poly = pr.slice();
    if (!closed) { if (pr[0][0] > 0) poly.unshift([0, pr[0][1]]); if (pr[pr.length - 1][0] > 0) poly.push([0, pr[pr.length - 1][1]]); }
    m.convex = !closed && convex2(poly);
    m.ax = [0, 0, 1];
    if (closed || o.wrap) m.wrap = { o: [0, 0, 0], a: [0, 0, 1], z0: za, z1: zb, r: rm, zs };
    return m;
  }
  // Round the corners of a polyline with arcs of radius R.
  function fillet(P, R, steps = 6) {
    if (P.length < 3 || R <= 0) return P;
    const out = [P[0]];
    for (let i = 1; i + 1 < P.length; i++) {
      const p = P[i], a = sub(p, P[i - 1]), b = sub(P[i + 1], p), la = hypot(...a), lb = hypot(...b);
      const d1 = scl(a, 1 / la), d2 = scl(b, 1 / lb), cs = clamp(dot(d1, d2), -1, 1), th = Math.acos(cs);
      if (th < 1e-3 || la < 1e-9 || lb < 1e-9) { out.push(p); continue; }
      let t = R * Math.tan(th / 2), rr = R;
      const tm = 0.5 * min(la, lb);
      if (t > tm) { rr = R * tm / t; t = tm; }
      const A = sub(p, scl(d1, t)), nIn = nrm(sub(d2, scl(d1, cs))), C = add(A, scl(nIn, rr)), k = max(2, ceil(steps * th / (PI / 2)));
      for (let s = 0; s <= k; s++) { const f = th * s / k; out.push(add(C, add(scl(nIn, -rr * cos(f)), scl(d1, rr * sin(f))))); }
    }
    out.push(P[P.length - 1]);
    return out;
  }
  // A round tube along a 3D path, with rounded bends.
  function pipe(path, r, o = {}) {
    const m = new Mesh(), seg = o.segments || 14, pts = fillet(path, o.bend ?? r * 2.5, o.steps || 6), n = pts.length;
    const T = pts.map((p, i) => nrm(sub(pts[min(n - 1, i + 1)], pts[max(0, i - 1)])));
    let u = nrm(crs(abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], T[0]));
    const S = [0];
    for (let i = 1; i < n; i++) S.push(S[i - 1] + hypot(...sub(pts[i], pts[i - 1])));
    const clen = o.chunk ?? max(r * 8, S[n - 1] / 40), g = SID++;
    const rings = pts.map((p, i) => {
      u = nrm(sub(u, scl(T[i], dot(u, T[i]))));
      const v = crs(T[i], u);
      return Array.from({ length: seg }, (_, j) => { const a = j * TAU / seg; return m.v(...add(p, add(scl(u, r * cos(a)), scl(v, r * sin(a))))); });
    });
    let c = 0;
    for (let i = 0; i + 1 < n; i++) {
      c = floor((S[i] + S[i + 1]) / 2 / clen);
      for (let j = 0; j < seg; j++) { const j2 = (j + 1) % seg; m.f([rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]], g, c); }
    }
    if (o.caps !== false) { m.f(rings[0].slice().reverse(), 0, 0); m.f(rings[n - 1].slice(), 0, c); }
    return m;
  }
  // A radial array of thin twisted blades around Z, from radius r0 to r1.
  function bladeRing(o) {
    const m = new Mesh(), N = o.count || 20, r0 = o.r0 ?? 1, r1 = o.r1 ?? 3, sp = o.spans || 2;
    const ch = [].concat(o.chord ?? (r1 - r0) * 0.4), c0 = ch[0], c1 = ch[1] ?? c0, th = o.thick ?? c0 * 0.1;
    const tw = [].concat(o.twist ?? [0.5, 1.1]), b0 = tw[0], b1 = tw[1] ?? b0;
    for (let i = 0; i < N; i++) {
      const ph = (o.phase || 0) + i * TAU / N, er = [cos(ph), sin(ph), 0], et = [-sin(ph), cos(ph), 0], st = [];
      for (let k = 0; k <= sp; k++) {
        const t = k / sp, r = lerp(r0, r1, t), b = lerp(b0, b1, t), c = lerp(c0, c1, t);
        const cd = add([0, 0, cos(b) * c / 2], scl(et, sin(b) * c / 2)), td = add([0, 0, -sin(b) * th / 2], scl(et, cos(b) * th / 2)), q = scl(er, r);
        st.push([sub(sub(q, cd), td), add(sub(q, cd), td), add(add(q, cd), td), sub(add(q, cd), td)].map(p => m.v(...p)));
      }
      for (let k = 0; k < sp; k++) for (let j = 0; j < 4; j++) { const j2 = (j + 1) % 4; m.f([st[k][j], st[k][j2], st[k + 1][j2], st[k + 1][j]]); }
      m.f(st[0].slice().reverse()); m.f(st[sp].slice());
    }
    m.wrap = { o: [0, 0, 0], a: [0, 0, 1], z0: -max(c0, c1) / 2, z1: max(c0, c1) / 2, r: r1 };
    return m;
  }
  // T-slot aluminum profile of side s: four slots and a center bore.
  function tslotProfile(s) {
    const h = s / 2, o = s * 0.14, lip = s * 0.085, cw = s * 0.29, cd = s * 0.29, c = s * 0.045, cb = s * 0.15;
    const side = [[h - c, h], [o, h], [o, h - lip], [cw, h - lip], [cb, h - cd], [-cb, h - cd], [-cw, h - lip], [-o, h - lip], [-o, h], [-h + c, h]], pts = [];
    for (let k = 0; k < 4; k++) { const a = k * PI / 2, C = cos(a), S = sin(a); for (const [x, y] of side) pts.push([x * C - y * S, x * S + y * C]); }
    return pts;
  }
  function seg3(o, def) {
    if (o.from && o.to) { const d = sub(o.to, o.from); return { at: o.from, axis: d, len: hypot(...d) }; }
    const axis = o.axis || "z", len = o.length ?? def;
    return { at: o.center ? sub(o.at || [0, 0, 0], scl(axv(axis), len / 2)) : o.at || [0, 0, 0], axis, len };
  }
  const autoSplit = (L, cs, cap = 24) => (L > 4 * cs ? min(cap, round(L / (2.5 * cs))) : 1);

  const BUILD = {
    box(o) {
      let lo, hi;
      if (o.from && o.to) { lo = o.from.map((v, i) => min(v, o.to[i])); hi = o.from.map((v, i) => max(v, o.to[i])); }
      else { const s = o.size || [1, 1, 1], a = o.at || [0, 0, 0]; lo = [a[0] - s[0] / 2, a[1] - s[1] / 2, a[2]]; hi = [a[0] + s[0] / 2, a[1] + s[1] / 2, a[2] + s[2]]; }
      const d = sub(hi, lo), k = d[0] >= d[1] && d[0] >= d[2] ? 0 : d[1] >= d[2] ? 1 : 2, i = (k + 1) % 3, j = (k + 2) % 3;
      const w = d[i], h = d[j], L = d[k], b = min(o.bevel || 0, w / 2.2, h / 2.2, L / 2.2);
      const out = b ? [[b, 0], [w - b, 0], [w, b], [w, h - b], [w - b, h], [b, h], [0, h - b], [0, b]] : [[0, 0], [w, 0], [w, h], [0, h]];
      const m = prism(out, [], 0, L, { bevel: b, split: o.split ?? autoSplit(L, max(w, h)) });
      const e = q => { const v = [0, 0, 0]; v[q] = 1; return v; }, ei = e(i), ej = e(j), ek = e(k);
      return bake(m, [ei[0], ej[0], ek[0], lo[0], ei[1], ej[1], ek[1], lo[1], ei[2], ej[2], ek[2], lo[2]]);
    },
    cylinder(o) {
      const { at, axis, len } = seg3(o, 1), r = o.r ?? 0.5, r2 = o.r2 ?? r, hole = o.hole || 0, b = min(o.bevel || 0, r / 2, len / 3);
      let pr;
      if (hole) pr = [[hole, 0], [r, 0], [r2, len], [o.hole2 ?? hole, len]];
      else if (r2 <= 1e-9) pr = b ? [[0, 0], [r - b, 0], [r, b], [0, len]] : [[0, 0], [r, 0], [0, len]];
      else pr = b ? [[0, 0], [r - b, 0], [r, b], [r2, len - b], [r2 - b, len], [0, len]] : [[0, 0], [r, 0], [r2, len], [0, len]];
      const m = lathe(pr, { segments: o.segments ?? 32, closed: !!hole, split: o.split ?? (hole ? undefined : autoSplit(len, 2 * max(r, r2), 16)), splitAt: o.splitAt, phase: o.phase });
      return bake(m, frame(at, axis, o.spin));
    },
    cone(o) { return BUILD.cylinder({ ...o, r2: o.r2 ?? 0 }); },
    sphere(o) {
      const r = o.r ?? 0.5, n = o.segments ?? 24, h = max(4, n >> 1), pr = [];
      for (let i = 0; i <= h; i++) { const a = -PI / 2 + PI * i / h; pr.push([r * cos(a), r * sin(a)]); }
      return bake(lathe(pr, { segments: n }), frame(o.at, o.axis || "z"));
    },
    lathe(o) { return bake(lathe(o.profile, o), frame(o.at, o.axis || "z", o.spin)); },
    extrude(o) {
      const { at, axis, len } = seg3(o, o.depth ?? 1);
      return bake(prism(o.outline, o.holes || [], 0, o.depth ?? len, { bevel: o.bevel, split: o.split }), frame(at, axis, o.spin));
    },
    plate(o) {
      const [w, d] = o.size || [1, 1], t = o.thick ?? 0.05;
      const holes = (o.holes || []).map(h => (h.r ? circle(h.at, h.r, h.segments || 20) : rrect(h.at[0] - h.size[0] / 2, h.at[1] - h.size[1] / 2, h.size[0], h.size[1], h.round || 0)));
      return bake(prism(rrect(-w / 2, -d / 2, w, d, o.round || 0), holes, 0, t, { bevel: o.bevel }), frame(o.at, o.axis || "z", o.spin));
    },
    tslot(o) {
      const { at, axis, len } = seg3(o, 1), s = o.size ?? 0.04;
      return bake(prism(tslotProfile(s), [circle([0, 0], s * 0.1, 12)], 0, len, { split: o.split ?? autoSplit(len, s) }), frame(at, axis, o.spin));
    },
    pipe(o) { return pipe(o.path, o.r ?? 0.05, o); },
    blades(o) { return bake(bladeRing(o), frame(o.at, o.axis || "z")); },
    screw(o) {
      const r = o.r ?? 0.01, hex = o.head === "hex";
      const pr = hex ? [[0, 0], [r, 0], [r, r * 0.55], [r * 0.86, r * 0.7], [0, r * 0.7]] : [[0, 0], [r, 0], [r, r * 0.3], [r * 0.8, r * 0.6], [0, r * 0.6]];
      const m = lathe(pr, { segments: hex ? 6 : 16, phase: hex ? PI / 6 : 0 }), top = m.F.length - 1, z = hex ? r * 0.7 : r * 0.6, w = r * 0.11;
      if (!hex && o.slot !== false) m.f([m.v(-r * 0.72, -w, z), m.v(r * 0.72, -w, z), m.v(r * 0.72, w, z), m.v(-r * 0.72, w, z)], 0, 0, { d: { base: top, tone: "slot" } });
      return bake(m, frame(o.at, o.axis || "z", o.angle || 0));
    },
    knob(o) {
      const r = o.r ?? 0.02, h = o.h ?? r * 1.2, sk = o.skirt ?? 1.25, w = r * 0.13;
      const m = lathe([[0, 0], [r * sk, 0], [r * sk, h * 0.18], [r, h * 0.26], [r, h * 0.86], [r * 0.86, h], [0, h]], { segments: o.segments ?? 28 }), top = m.F.length - 1;
      m.f([m.v(r * 0.1, -w, h), m.v(r * 0.78, -w, h), m.v(r * 0.78, w, h), m.v(r * 0.1, w, h)], 0, 0, { d: { base: top, tone: o.mark ?? "mark" } });
      return bake(m, frame(o.at, o.axis || "z", o.angle || 0));
    },
  };

  // ---------- scene graph ----------
  const KEEP = ["name", "material", "color", "layer", "move", "rotate", "cut", "visible", "heat", "pickable", "shadow", "opacity", "data"];
  class Node {
    constructor(o = {}) { this.id = NID++; this.kids = []; this.name = ""; this.visible = true; this.material = "porcelain"; this.heat = 0; Object.assign(this, o); }
    add(n) { n.parent = this; this.kids.push(n); return n; }
    group(o = {}) { const n = new Node(); for (const k of KEEP) if (o[k] !== undefined) n[k] = o[k]; return this.add(n); }
    part(m, o = {}) {
      finish(m);
      if (o.wrap === false) m.wrap = null; else if (o.wrap && typeof o.wrap === "object") m.wrap = o.wrap;
      const n = new Node({ mesh: m });
      for (const k of KEEP) if (o[k] !== undefined) n[k] = o[k];
      return this.add(n);
    }
    find(name) { if (this.name === name) return this; for (const k of this.kids) { const f = k.find(name); if (f) return f; } return null; }
    all(name, out = []) { if (name == null ? this.mesh : this.name === name) out.push(this); for (const k of this.kids) k.all(name, out); return out; }
    set(o) { Object.assign(this, o); return this; }
    // Decals: flat marks drawn on one face of this part, right after that face.
    decal(o) {
      const m = this.mesh, fr = faceFrame(m, o.face || "+z"), pts = o.points.map(([a, b]) => m.v(...add(fr.o, add(scl(fr.u, a), scl(fr.v, b)))));
      const d = { base: fr.fi, tone: o.tone || "slot", line: o.line, k: pts.length === 2 ? "line" : "fill", w: o.width };
      m.F.push({ v: pts, s: 0, c: m.F[fr.fi].c, n: fr.n, d });
      return d;
    }
    vents(o = {}) {
      const [w, h] = o.size || [0.1, 0.06], n = o.count || 5, c = o.at || [0, 0], p = h / n, sh = p * (o.open ?? 0.5);
      for (let i = 0; i < n; i++) { const y = c[1] - h / 2 + p * (i + 0.5); this.decal({ face: o.face, points: rrect(c[0] - w / 2, y - sh / 2, w, sh, sh / 2, 3), tone: o.tone || "slot", line: true }); }
      return this;
    }
    text(o = {}) {
      const m = this.mesh, fr = faceFrame(m, o.face || "+z"), a = o.at || [0, 0];
      const d = { base: fr.fi, k: "text", text: o.text ?? "", size: o.size ?? 0.02, color: o.color ?? "ink", align: o.align ?? "center", font: o.font ?? "mono", weight: o.weight ?? 600, o: add(fr.o, add(scl(fr.u, a[0]), scl(fr.v, a[1]))), u: fr.u, v: fr.v };
      m.F.push({ v: [], s: 0, c: m.F[fr.fi].c, n: fr.n, d });
      return d;
    }
    screen(o = {}) {
      const [w, h] = o.size || [0.1, 0.05], c = o.at || [0, 0];
      this.decal({ face: o.face, points: rrect(c[0] - w / 2, c[1] - h / 2, w, h, o.round ?? h * 0.1, 2), tone: "screen", line: true });
      return this.text({ face: o.face, at: [c[0] - w / 2 + h * 0.2, c[1]], text: o.text ?? "", size: o.textSize ?? h * 0.42, color: o.color ?? "green", align: "left" });
    }
    ruler(o) {
      const a = o.from, b = o.to, L = hypot(b[0] - a[0], b[1] - a[1]), dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], nn = [-dir[1], dir[0]];
      const st = o.step, maj = o.major || 5, tk = o.tick ?? L * 0.02, side = o.side ?? 1;
      for (let i = 0, x = 0; x <= L + 1e-9; i++, x = i * st) {
        const len = (i % maj ? tk : tk * 2) * side, p = [a[0] + dir[0] * x, a[1] + dir[1] * x];
        this.decal({ face: o.face, points: [p, [p[0] + nn[0] * len, p[1] + nn[1] * len]], tone: "mark" });
        if (!(i % maj) && o.label !== false) this.text({ face: o.face, at: [p[0] + nn[0] * tk * 3.3 * side, p[1] + nn[1] * tk * 3.3 * side], text: o.label ? o.label(x, i) : String(i), size: o.size ?? tk * 1.5, color: o.color ?? "muted", font: "text", weight: 500 });
      }
      this.decal({ face: o.face, points: [a, b], tone: "mark" });
      return this;
    }
  }
  for (const [k, fn] of Object.entries(BUILD)) Node.prototype[k] = function (o = {}) { return this.part(fn(o), o); };

  const FACES = { "+x": [[1, 0, 0], [0, -1, 0]], "-x": [[-1, 0, 0], [0, 1, 0]], "+y": [[0, 1, 0], [1, 0, 0]], "-y": [[0, -1, 0], [-1, 0, 0]], "+z": [[0, 0, 1], [1, 0, 0]], "-z": [[0, 0, -1], [1, 0, 0]] };
  // A face's frame: center o, u (left to right), v (up), normal n.
  function faceFrame(m, face) {
    let n, u;
    if (typeof face === "string") [n, u] = FACES[/^[+-]/.test(face) ? face : "+" + face];
    else { n = nrm(face); u = nrm(crs(abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0], n)); }
    const v = crs(u, n);
    let fi = -1, best = -1e18;
    m.F.forEach((f, i) => {
      if (f.d || dot(f.n, n) < 0.99) return;
      let c = 0; for (const q of f.v) c += m.P[q * 3] * n[0] + m.P[q * 3 + 1] * n[1] + m.P[q * 3 + 2] * n[2];
      c /= f.v.length;
      if (c > best + 1e-9) { best = c; fi = i; }
    });
    if (fi < 0) throw new Error("no face " + face);
    const lo = [1e18, 1e18, 1e18], hi = [-1e18, -1e18, -1e18];
    for (const q of m.F[fi].v) for (let k = 0; k < 3; k++) { lo[k] = min(lo[k], m.P[q * 3 + k]); hi[k] = max(hi[k], m.P[q * 3 + k]); }
    return { o: scl(add(lo, hi), 0.5), u, v, n, fi };
  }

  // ---------- section cut: keep n·p <= d, cap the cut with hatched faces ----------
  function clip(W0, F0, N0, plane, wrap) {
    const n = plane.slice(0, 3), d0 = plane[3], W = Array.from(W0), nv = W.length / 3, dist = new Float64Array(nv);
    for (let i = 0; i < nv; i++) dist[i] = n[0] * W[i * 3] + n[1] * W[i * 3 + 1] + n[2] * W[i * 3 + 2] - d0;
    const cache = new Map(), F = [], N = [], seg = new Map(), remap = new Map();
    const cut = (a, b) => {
      const k = a < b ? a * 2097152 + b : b * 2097152 + a;
      let i = cache.get(k);
      if (i == null) { const t = dist[a] / (dist[a] - dist[b]); for (let q = 0; q < 3; q++) W.push(W[a * 3 + q] + (W[b * 3 + q] - W[a * 3 + q]) * t); i = W.length / 3 - 1; cache.set(k, i); }
      return i;
    };
    F0.forEach((f, fi) => {
      if (f.d && !remap.has(f.d.base)) return;
      if (f.d && f.d.k === "text") { if (dot(n, f.d.o) <= d0) { F.push({ ...f, d: { ...f.d, base: remap.get(f.d.base) } }); N.push(N0[fi]); } return; }
      const out = [];
      for (const L of f.h ? [f.v, ...f.h] : [f.v]) {
        const q = [], tr = [];
        for (let i = 0; i < L.length; i++) {
          const a = L[i], b = L[(i + 1) % L.length], ia = dist[a] <= 0, ib = dist[b] <= 0;
          if (ia) q.push(a);
          if (ia !== ib && (L.length > 2 || i === 0)) { const c = cut(a, b); q.push(c); tr.push([ia ? 0 : 1, c]); }
        }
        if (!f.d && tr.length > 1) for (let k = 0; k < tr.length; k++) if (tr[k][0] === 0) { const y = tr[(k + 1) % tr.length]; if (y[0] === 1) seg.set(y[1], tr[k][1]); }
        if (q.length >= (L.length === 2 ? 2 : 3)) out.push(q);
      }
      if (!out.length) return;
      remap.set(fi, F.length);
      F.push({ ...f, v: out[0], h: out.length > 1 ? out.slice(1) : null, n: N0[fi], d: f.d ? { ...f.d, base: remap.get(f.d.base) } : f.d });
      N.push(N0[fi]);
    });
    const loops = [];
    for (const start of [...seg.keys()]) {
      if (!seg.has(start)) continue;
      const L = [];
      let p = start, guard = 0;
      while (seg.has(p) && guard++ < 1e5) { L.push(p); const q = seg.get(p); seg.delete(p); p = q; }
      if (L.length > 2) loops.push(L);
    }
    const nn = nrm(n), sid = SID++, zs = wrap && wrap.zs && wrap.zs.length > 2 ? wrap.zs : [-1e18, 1e18], hc = new Map();
    // Keep loop L where a·p <= d; k names the plane so pieces share new vertices.
    const half = (L, a, d, k) => {
      const q = [], f = i => a[0] * W[i * 3] + a[1] * W[i * 3 + 1] + a[2] * W[i * 3 + 2] - d;
      for (let i = 0; i < L.length; i++) {
        const p = L[i], r = L[(i + 1) % L.length], fp = f(p), fr = f(r);
        if (fp <= 0) q.push(p);
        if ((fp <= 0) !== (fr <= 0)) {
          const key = `${min(p, r)},${max(p, r)},${k}`;
          let x = hc.get(key);
          if (x == null) { const t = fp / (fp - fr); for (let j = 0; j < 3; j++) W.push(W[p * 3 + j] + (W[r * 3 + j] - W[p * 3 + j]) * t); x = W.length / 3 - 1; hc.set(key, x); }
          q.push(x);
        }
      }
      return q;
    };
    if (loops.length) for (let k = 0; k + 1 < zs.length; k++) {
      const a = wrap ? wrap.a : [0, 0, 1], t0 = wrap ? dot(a, wrap.o) : 0;
      const L = loops.map(l => half(half(l, a, zs[k + 1] + t0, k + 1), scl(a, -1), -(zs[k] + t0), -(k + 1) * 7 - 1)).filter(l => l.length > 2);
      if (L.length) { F.push({ v: L[0], h: L.length > 1 ? L.slice(1) : null, s: sid, c: k, n: nn, cap: true }); N.push(nn); }
    }
    return { W, F, N, E: edges(F) };
  }

  // ---------- materials: tones defined against the page palette ----------
  const NAMES = ["bg", "panel", "ink", "muted", "faint", "grid", "brass", "red", "orange", "green", "blue", "purple"];
  // Fallbacks when no stylesheet is readable.
  const DEF_L = { bg: "#fcfcfc", ink: "#111111", muted: "#666666", faint: "#d4d4d4", grid: "#efefef", brass: "#966111", red: "#d22d2d", orange: "#bd4f08", green: "#18793e", blue: "#2457d6", purple: "#7438e0" };
  const DEF_D = { bg: "#0a0a0a", ink: "#ededed", muted: "#9a9a9a", faint: "#3a3a3a", grid: "#1a1a1a", brass: "#d9a548", red: "#f47272", orange: "#f59447", green: "#4fd185", blue: "#6aa5ff", purple: "#ac8cff" };
  function parse(v) {
    const s = String(v ?? "").trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [...m[1]].map(h => parseInt(h + h, 16));
    m = /^#([0-9a-f]{6})/i.exec(s);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  function mkPal(src, def) {
    const p = {};
    for (const n of NAMES) p[n] = parse(src[n]) || parse(def[n]) || [128, 128, 128];
    if (!parse(src.panel)) p.panel = p.bg;
    p.dark = lum(p.panel) < lum(p.ink);
    p.id = NAMES.map(n => p[n].join(",")).join("|");
    return p;
  }
  let LIVE = null;
  function livePal() {
    const src = (typeof window !== "undefined" && window.palette) || {}, key = (src.ink || "") + (src.panel || "") + (src.blue || "");
    if (!LIVE || LIVE.key !== key) { LIVE = mkPal(src, DEF_L); LIVE.key = key; }
    return LIVE;
  }
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const hex = c => "#" + c.map(v => clamp(round(v), 0, 255).toString(16).padStart(2, "0")).join("");
  // [light base, dark base, metal, line tint, alpha]; a base [a, b, t, c, t2] mixes a to b by t, then to c by t2.
  const MAT = {
    porcelain: [["panel", "ink", 0.035], ["panel", "ink", 0.34]],
    white: [["panel", "ink", 0], ["panel", "ink", 0.42]],
    steel: [["panel", "ink", 0.17, "blue", 0.05], ["panel", "ink", 0.27, "blue", 0.07], 1],
    aluminum: [["panel", "ink", 0.08, "blue", 0.035], ["panel", "ink", 0.37, "blue", 0.05], 1],
    brass: [["panel", "brass", 0.5], ["panel", "brass", 0.62], 1, "brass"],
    rubber: [["panel", "ink", 0.74], ["panel", "ink", 0.13]],
    plastic: [["panel", "ink", 0.56], ["panel", "ink", 0.2]],
    graphite: [["panel", "ink", 0.4], ["panel", "ink", 0.24]],
    glass: [["panel", "blue", 0.18], ["panel", "blue", 0.3], 1, "blue", 0.26],
    ghost: [["panel", "ink", 0.04], ["panel", "ink", 0.3], 0, null, 0.3],
    hot: [["panel", "orange", 0.55], ["panel", "orange", 0.7], 0, "orange"],
  };
  for (const c of ["red", "orange", "green", "blue", "purple"]) MAT[c] = [["panel", c, 0.3], ["panel", c, 0.52], 0, c];
  const baseOf = (b, p) => { let c = mixc(p[b[0]], p[b[1]], b[2]); if (b[3]) c = mixc(c, p[b[3]], b[4]); return c; };
  // Tones: 0 top, 1-4 sides, 5 specular, 6 cut, 7 slot, 8 screen, 9 mark, 10 silhouette, 11 crease, 12 hatch.
  function toneSet(p, mat, color) {
    const M = MAT[mat] || MAT.porcelain, dk = p.dark, tint = color || M[3];
    const b = color && MAT[color] ? baseOf(MAT[color][dk ? 1 : 0], p) : baseOf(M[dk ? 1 : 0], p);
    const tg = dk ? p.panel : p.ink, f = dk ? [0, 0.22, 0.38, 0.54, 0.68] : [0, 0.08, 0.18, 0.31, 0.45];
    const t = f.map(x => mixc(b, tg, x));
    t.push(dk ? mixc(b, p.ink, 0.4) : mixc(b, p.panel, 0.8), dk ? mixc(b, tg, 0.5) : mixc(b, p.ink, 0.27), dk ? mixc(b, tg, 0.8) : mixc(b, p.ink, 0.62),
      dk ? mixc(p.panel, p.ink, 0.04) : mixc(p.panel, p.ink, 0.86));
    let sil = mixc(p.ink, p.panel, dk ? 0.1 : 0.03), cre = mixc(p.ink, p.panel, dk ? 0.5 : 0.48);
    if (tint && p[tint]) { sil = mixc(sil, p[tint], 0.35); cre = mixc(cre, p[tint], 0.3); }
    t.push(mixc(p.ink, p.panel, dk ? 0.15 : 0.1), sil, cre, dk ? mixc(b, p.ink, 0.32) : mixc(b, p.ink, 0.52));
    return t;
  }
  const CACHE = new Map();
  // Colors for one part this frame: material, subject color, heat (blend to "hot"), highlight.
  function partColors(p, r, hlc, fmt = hex) {
    const n = r.node, heat = round(clamp(n.heat || 0, 0, 1) * 50) / 50, hl = round((r.hl || 0) * 20) / 20;
    const key = `${p.id}|${n.material}|${n.color || ""}|${heat}|${hl}|${hlc}`;
    let c = CACHE.get(key);
    if (!c) {
      let t = toneSet(p, n.material, n.color);
      if (heat) { const h = toneSet(p, "hot"); t = t.map((x, i) => (i < 9 || i === 12 ? mixc(x, h[i], heat) : x)); }
      if (hl) { const h = toneSet(p, hlc, hlc); t = t.map((x, i) => (i < 9 ? mixc(x, h[i], 0.5 * hl) : i === 10 ? mixc(x, p[hlc] || x, 0.7 * hl) : x)); }
      c = t.map(fmt);
      if (CACHE.size > 4000) CACHE.clear();
      CACHE.set(key, c);
    }
    return c;
  }
  const alphaOf = n => (n.opacity != null ? n.opacity : (MAT[n.material] || [])[4] ?? 1);

  // ---------- camera: orthographic, azimuth A (yaw) and elevation E (pitch) ----------
  const VIEWS = { iso: { yaw: PI / 4, pitch: Math.atan(1 / sqrt(2)) }, dimetric: { yaw: PI / 4, pitch: PI / 6 },
    front: { yaw: PI / 2, pitch: 0 }, side: { yaw: 0, pitch: 0 }, top: { yaw: PI / 2, pitch: PI / 2 - 1e-4 } };
  function camera(scene, A, E, box, lo, hi, o, recs) {
    const sA = sin(A), cA = cos(A), sE = sin(E), cE = cos(E);
    const R = [sA, -cA, 0], D = [cA * sE, sA * sE, -cE], V = [cA * cE, sA * cE, sE];
    const zoom = o.zoom ?? 1, bw = box[2], bh = box[3];
    let fit = scene._fit;
    if (!fit || o.fit === "always" || fit.w !== bw || fit.h !== bh || fit.zoom !== zoom) {
      // Fit every vertex (or o.bounds) into the box.
      let x0 = 1e18, x1 = -1e18, y0 = 1e18, y1 = -1e18;
      const see = (x, y, z) => { const a = x * R[0] + y * R[1], b = x * D[0] + y * D[1] + z * D[2]; if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b; };
      if (o.bounds) for (let i = 0; i < 8; i++) see(o.bounds[i & 1][0], o.bounds[(i >> 1) & 1][1], o.bounds[i >> 2][2]);
      else for (const r of recs) { const W = r.G.W; for (let i = 0; i < W.length; i += 3) see(W[i], W[i + 1], W[i + 2]); }
      const mg = o.margin ?? 0.92, k = min(bw * mg / (x1 - x0 || 1), bh * mg / (y1 - y0 || 1)) * zoom, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      fit = scene._fit = { w: bw, h: bh, zoom, k, c: add(add(scl(R, cx), scl(D, cy)), scl(V, dot(scl(add(lo, hi), 0.5), V))) };
    }
    const k = o.scale ? o.scale * sqrt(1.6) : fit.k, c = o.center || fit.c;
    const ox = box[0] + bw / 2 - k * dot(c, R), oy = box[1] + bh / 2 - k * dot(c, D);
    const L = nrm(add(add(scl(R, -0.52), scl(D, -0.62)), scl(V, 0.58))), H = nrm(add(add(scl(R, -0.45), scl(D, -0.3)), V));
    return { A, E, R, D, V, L, H, k, ox, oy, T: a => nrm(sub(H, scl(a, dot(H, a)))), key: [A, E, k, ox, oy].map(x => x.toFixed(6)).join(","),
      p: q => [ox + k * (q[0] * R[0] + q[1] * R[1]), oy + k * (q[0] * D[0] + q[1] * D[1] + q[2] * D[2]), dot(q, V)] };
  }
  // The light is locked to the camera: tops get their own fill, sides fall in four buckets.
  // Turned metal parts get a specular stripe, measured around their axis.
  function toneOf(n, cam, ax) {
    if (ax) { const d = dot(n, ax), q = sub(n, scl(ax, d)), l = hypot(...q); if (l > 0.3 && dot(q, cam.T(ax)) / l > 0.975) return 5; }
    if (n[2] > 0.8) return 0;
    const i = dot(n, cam.L);
    return i > 0.35 ? 1 : i > 0 ? 2 : i > -0.3 ? 3 : 4;
  }

  // ---------- layout: world geometry, projection, paint order ----------
  function walk(n, M, cut, layer, names, out) {
    if (!n.visible) return;
    if (n.move || n.rotate) M = mul(M, pose(n));
    if (n.cut !== undefined) cut = n.cut || null;
    if (n.layer != null) layer = n.layer;
    if (n.name) names = names.concat(n.name);
    if (n.mesh) out.push({ node: n, M, cut, layer, names });
    for (const k of n.kids) walk(k, M, cut, layer, names, out);
  }
  function geo(r) {
    const n = r.node, m = n.mesh, key = r.M.map(x => x.toFixed(7)).join(",") + (r.cut ? "|" + r.cut.join(",") : "") + "|" + m.id + "." + m.F.length;
    let G = n._g;
    if (!G || G.key !== key) {
      const M = r.M, P = m.P, nv = P.length / 3;
      let W = new Float64Array(nv * 3);
      for (let i = 0; i < nv * 3; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        W[i] = M[0] * x + M[1] * y + M[2] * z + M[3]; W[i + 1] = M[4] * x + M[5] * y + M[6] * z + M[7]; W[i + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
      }
      let F = m.F, E = m.E, N = F.map(f => ad(M, f.n));
      const wr = m.wrap && { o: ap(M, m.wrap.o), a: ad(M, m.wrap.a), z0: m.wrap.z0, z1: m.wrap.z1, r: m.wrap.r, zs: m.wrap.zs };
      if (r.cut) ({ W, F, N, E } = clip(W, F, N, r.cut, wr));
      const lo = [1e18, 1e18, 1e18], hi = [-1e18, -1e18, -1e18];
      for (const f of F) for (const q of f.v) for (let k = 0; k < 3; k++) { const v = W[q * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
      const rotd = abs(M[0] - 1) + abs(M[5] - 1) + abs(M[10] - 1) > 1e-9;
      G = n._g = { key, ver: (G ? G.ver : 0) + 1, W, F, N, E, lo, hi, rot: rotd && !r.cut, wrap: wr };
    }
    r.G = G;
  }
  function layout(scene, o = {}) {
    const t0 = now(), box = o.box || [0, 0, o.w || 640, o.h || 400], vw = o.view || {};
    const A = vw.yaw ?? o.yaw ?? PI / 4, E = vw.pitch ?? o.pitch ?? PI / 6, recs = [];
    walk(scene, ID, null, 0, [], recs);
    const lo = [1e18, 1e18, 1e18], hi = [-1e18, -1e18, -1e18];
    let h = 7;
    for (const r of recs) {
      geo(r);
      for (let k = 0; k < 3; k++) { lo[k] = min(lo[k], r.G.lo[k]); hi[k] = max(hi[k], r.G.hi[k]); }
      h = (h * 31 + r.node.id * 17 + r.G.ver * 7 + r.layer) | 0;
    }
    if (!recs.length) for (let k = 0; k < 3; k++) { lo[k] = -1; hi[k] = 1; }
    const cam = camera(scene, A, E, box, lo, hi, o, recs), key = `${cam.key}|${h}|${recs.length}`;
    let V = scene._lay;
    if (!V || V.key !== key) V = scene._lay = order(scene, recs, cam, lo, hi, key, box);
    V.ms = now() - t0;
    return V;
  }
  function order(scene, recs, cam, lo, hi, key, box) {
    const { V, k, ox, oy, R, D } = cam, eps = 1e-6 * (hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1), chunks = [];
    let faces = 0;
    for (const r of recs) {
      const G = r.G, W = G.W, nv = W.length / 3, S = (r.S = new Float64Array(nv * 3)), F = G.F, nf = F.length, m = r.node.mesh;
      for (let i = 0, j = 0; i < nv; i++, j += 3) {
        const x = W[j], y = W[j + 1], z = W[j + 2];
        S[j] = ox + k * (x * R[0] + y * R[1]); S[j + 1] = oy + k * (x * D[0] + y * D[1] + z * D[2]); S[j + 2] = x * V[0] + y * V[1] + z * V[2];
      }
      const front = (r.front = new Uint8Array(nf)), tone = (r.tone = new Uint8Array(nf)), ch = (r.ch = new Int32Array(nf)), ax = (MAT[r.node.material] || [])[2] && m.ax && nrm(ad(r.M, m.ax));
      const w = G.wrap;
      let vp = null;
      if (w) { vp = sub(V, scl(w.a, dot(V, w.a))); if (hypot(...vp) < 1e-3) vp = null; }
      const map = new Map();
      for (let f = 0; f < nf; f++) {
        const fc = F[f], d = fc.d;
        if (d) { front[f] = front[d.base] ?? 0; ch[f] = ch[d.base] ?? 0; }
        else {
          front[f] = dot(G.N[f], V) > 1e-7 ? 1 : 0;
          if (front[f]) tone[f] = fc.cap ? 6 : toneOf(G.N[f], cam, fc.s && ax);
          if (w) { let c = [0, 0, 0]; for (const q of fc.v) c = add(c, [W[q * 3], W[q * 3 + 1], W[q * 3 + 2]]); ch[f] = (fc.c || 0) * 2 + (vp && dot(sub(scl(c, 1 / fc.v.length), w.o), vp) > 0 ? 1 : 0); }
          else ch[f] = fc.c || 0;
        }
        let C = map.get(ch[f]);
        if (!C) map.set(ch[f], (C = { r, c: ch[f], faces: [], all: [], layer: r.layer, key: r.node.id * 64 + ch[f] }));
        C.all.push(f);
        if (front[f]) C.faces.push(f);
      }
      for (const C of map.values()) {
        if (!C.faces.length) continue;
        const l = [1e18, 1e18, 1e18], u = [-1e18, -1e18, -1e18], sb = [1e18, 1e18, -1e18, -1e18];
        for (const f of C.all) for (const q of F[f].v) for (let a = 0; a < 3; a++) { const v = W[q * 3 + a]; if (v < l[a]) l[a] = v; if (v > u[a]) u[a] = v; }
        for (const f of C.faces) for (const q of F[f].v) { const x = S[q * 3], y = S[q * 3 + 1]; if (x < sb[0]) sb[0] = x; if (y < sb[1]) sb[1] = y; if (x > sb[2]) sb[2] = x; if (y > sb[3]) sb[3] = y; }
        if (!(sb[2] >= sb[0])) continue;
        Object.assign(C, { lo: l, hi: u, sb, dz: dot(scl(add(l, u), 0.5), V) });
        if (G.rot) {   // oriented box from the part's own axes
          const M = r.M, ll = [1e18, 1e18, 1e18], hh = [-1e18, -1e18, -1e18], P = m.P;
          for (const f of C.all) for (const q of F[f].v) for (let a = 0; a < 3; a++) { const v = P[q * 3 + a]; if (v < ll[a]) ll[a] = v; if (v > hh[a]) hh[a] = v; }
          const ax = [0, 1, 2].map(i => [M[i], M[4 + i], M[8 + i]]), t = [M[3], M[7], M[11]], corners = [];
          for (let i = 0; i < 8; i++) corners.push(ap(M, [i & 1 ? hh[0] : ll[0], i & 2 ? hh[1] : ll[1], i & 4 ? hh[2] : ll[2]]));
          C.ob = { ax, lo: ax.map((a, i) => ll[i] + dot(a, t)), hi: ax.map((a, i) => hh[i] + dot(a, t)), corners };
        }
        chunks.push(C);
        faces += C.faces.length;
      }
    }
    // Constraints between chunks that overlap on screen, then a stable topological sort.
    const N = chunks.length, prev = scene._rank, pri = new Float64Array(N);
    chunks.map((c, i) => i).sort((a, b) => chunks[a].dz - chunks[b].dz).forEach((ci, rank) => { pri[ci] = rank; });
    if (prev) for (let i = 0; i < N; i++) { const p = prev.get(chunks[i].key); if (p != null) pri[i] = p; }
    const byX = chunks.map((c, i) => i).sort((a, b) => chunks[a].sb[0] - chunks[b].sb[0]), adj = Array.from({ length: N }, () => []), pre = Array.from({ length: N }, () => []), indeg = new Int32Array(N), strong = new Int32Array(N);
    for (let a = 0; a < N; a++) {
      const ia = byX[a], P = chunks[ia];
      for (let b = a + 1; b < N; b++) {
        const ib = byX[b], Q = chunks[ib];
        if (Q.sb[0] >= P.sb[2]) break;
        if (Q.sb[1] >= P.sb[3] || Q.sb[3] <= P.sb[1]) continue;
        let s = before(P, Q, V, eps);
        if (s === 2) continue;   // neither can hide the other
        const weak = !s;         // no separating plane: fall back to depth, as a weak edge
        if (weak) s = P.dz < Q.dz ? 1 : -1;
        const [u, w] = s > 0 ? [ia, ib] : [ib, ia];
        adj[u].push(weak ? ~w : w); pre[w].push(u); indeg[w]++; if (!weak) strong[w]++;
      }
    }
    const heap = [], push = i => { heap.push(i); let j = heap.length - 1; while (j > 0) { const p = (j - 1) >> 1; if (pri[heap[p]] <= pri[heap[j]]) break; [heap[p], heap[j]] = [heap[j], heap[p]]; j = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let j = 0; ;) { const l = 2 * j + 1, r = l + 1; let m = j; if (l < heap.length && pri[heap[l]] < pri[heap[m]]) m = l; if (r < heap.length && pri[heap[r]] < pri[heap[m]]) m = r; if (m === j) break; [heap[m], heap[j]] = [heap[j], heap[m]]; j = m; }
      }
      return top;
    };
    const done = new Uint8Array(N), seq = [];
    let cycles = 0;
    for (let i = 0; i < N; i++) if (!indeg[i]) push(i);
    while (seq.length < N) {
      let i = -1;
      if (heap.length) { i = pop(); if (done[i]) continue; }
      else {
        // Stuck on a cycle: free a node held only by weak edges, else walk back to a node on the cycle.
        cycles++;
        for (let j = 0; j < N; j++) if (!done[j] && !strong[j] && (i < 0 || pri[j] < pri[i])) i = j;
        if (i < 0) {
          const seen = new Map();
          let v = 0;
          while (done[v]) v++;
          while (!seen.has(v)) { seen.set(v, seen.size); v = pre[v].find(u => !done[u]) ?? v; }
          const k0 = seen.get(v);
          for (const [u, k] of seen) if (k >= k0 && (i < 0 || pri[u] < pri[i])) i = u;
        }
      }
      done[i] = 1; seq.push(i);
      for (const e of adj[i]) { const w = e < 0 ? ~e : e; if (done[w]) continue; if (e >= 0) strong[w]--; if (--indeg[w] === 0) push(w); }
    }
    scene._rank = new Map(seq.map((ci, rank) => [chunks[ci].key, rank]));
    // Faces inside each chunk: convex pieces need no sort; decals follow their face.
    const list = [];
    for (const r of recs) r.items = [];
    for (const ci of seq) {
      const C = chunks[ci], r = C.r, F = r.G.F, S = r.S, dec = new Map(), fs = [];
      for (const f of C.faces) { const d = F[f].d; if (d) { if (!dec.has(d.base)) dec.set(d.base, []); dec.get(d.base).push(f); } else fs.push(f); }
      if (!(r.node.mesh.convex && !r.cut)) {
        const dz = f => { let s = 0; for (const q of F[f].v) s += S[q * 3 + 2]; return s / F[f].v.length; }, key = new Map(fs.map(f => [f, dz(f)]));
        fs.sort((a, b) => key.get(a) - key.get(b));
      }
      const seam = r.node.mesh.nc > 1 || !!r.cut, start = list.length;
      for (const f of fs) {
        list.push((r.items[f] = { r, f, t: r.tone[f], i: list.length, seam: seam || !!F[f].s, sil: [], cre: [] }));
        for (const d of dec.get(f) || []) list.push((r.items[d] = { r, f: d, i: list.length, sil: [], cre: [] }));
      }
      if (r.node.mesh.convex && !r.cut && list.length - start > 1) list[start].run = list.length - start;   // faces that can't overlap: batch them
    }
    // Lines: silhouettes (front face by back face) and creases (owned by the later of two front faces).
    for (const r of recs) {
      const fr = r.front, it = r.items;
      for (const e of r.G.E) {
        const a = e[2], b = e[3], fa = fr[a] && it[a], fb = b >= 0 && fr[b] && it[b];
        if (fa && fb) { if (e[4]) (fa.i > fb.i ? fa : fb).cre.push(e); }
        else if (fa || fb) (fa || fb).sil.push(e);
      }
    }
    // Contact shadow: footprints of parts on the ground, projected.
    const gz = scene.ground ?? lo[2], hz = (hi[2] - lo[2]) * 0.06, amb = [], con = [];
    for (const r of recs) {
      if (r.node.shadow === false || alphaOf(r.node) < 1) continue;
      const l = r.G.lo, u = r.G.hi, poly = [[l[0], l[1]], [u[0], l[1]], [u[0], u[1]], [l[0], u[1]]].map(([x, y]) => cam.p([x, y, gz]));
      amb.push(poly);
      if (l[2] < gz + hz) con.push(poly);
    }
    return Object.assign(Object.create(VIEW), { key, cam, box, scene, recs, list, chunks: seq.map(i => chunks[i]), shadow: { amb, con }, lo, hi, faces, cycles });
  }
  // Does chunk P paint before chunk Q? 1 yes, -1 no, 0 unknown (no separating plane), 2 either
  // (two separating planes disagree, so neither can hide the other).
  function before(P, Q, V, eps) {
    if (P.layer !== Q.layer) return P.layer < Q.layer ? 1 : -1;
    const wp = P.r.G.wrap, wq = Q.r.G.wrap;
    let s = 0;
    const vote = x => { if (!s) s = x; else if (s !== x) s = 2; };
    if (P.r === Q.r && wp) {   // one shell: the plane through its axis puts back halves first
      if (P.c >> 1 === Q.c >> 1) return P.c < Q.c ? 1 : -1;
      if ((P.c & 1) !== (Q.c & 1)) vote(P.c & 1 ? -1 : 1);
    }
    if (wp && P.r !== Q.r && inside(Q, wp) && over(P, Q, wp)) return P.c & 1 ? -1 : 1;
    if (wq && P.r !== Q.r && inside(P, wq) && over(P, Q, wq)) return Q.c & 1 ? 1 : -1;
    for (let a = 0; a < 3 && s !== 2; a++) {
      const v = V[a];
      if (abs(v) < 1e-4) continue;
      if (P.hi[a] <= Q.lo[a] + eps) vote(v > 0 ? 1 : -1);
      else if (Q.hi[a] <= P.lo[a] + eps) vote(v > 0 ? -1 : 1);
    }
    for (const [X, Y, sg] of [[P, Q, 1], [Q, P, -1]]) {
      if (!X.ob || s === 2) continue;
      for (let i = 0; i < 3; i++) {
        const ax = X.ob.ax[i], v = dot(ax, V);
        if (abs(v) < 1e-4) continue;
        const [y0, y1] = range(Y, ax);
        if (X.ob.hi[i] <= y0 + eps) vote(sg * (v > 0 ? 1 : -1));
        else if (y1 <= X.ob.lo[i] + eps) vote(sg * (v > 0 ? -1 : 1));
      }
    }
    return s;
  }
  function range(C, ax) {
    let a = 1e18, b = -1e18;
    const pts = C.ob ? C.ob.corners : Array.from({ length: 8 }, (_, i) => [i & 1 ? C.hi[0] : C.lo[0], i & 2 ? C.hi[1] : C.lo[1], i & 4 ? C.hi[2] : C.lo[2]]);
    for (const p of pts) { const d = dot(p, ax); if (d < a) a = d; if (d > b) b = d; }
    return [a, b];
  }
  // A chunk's extent along a shell's axis: [center, half length, half size].
  const span = (C, w) => { const e = scl(sub(C.hi, C.lo), 0.5), c = add(C.lo, e); return [dot(sub(c, w.o), w.a), abs(e[0] * w.a[0]) + abs(e[1] * w.a[1]) + abs(e[2] * w.a[2]), e, c]; };
  const over = (P, Q, w) => { const a = span(P, w), b = span(Q, w); return a[1] + b[1] - abs(a[0] - b[0]) > 0.6 * min(a[1], b[1]); };
  // Is chunk C inside the shell w (a part that wraps others)? Coaxial shells compare radii.
  function inside(C, w) {
    const q = C.r.G.wrap, [t, ext, e, c] = span(C, w);
    if (t < w.z0 || t > w.z1 || min(t + ext, w.z1) - max(t - ext, w.z0) < ext) return false;   // mostly within the shell's length
    if (q && hypot(...crs(q.a, w.a)) < 0.01) { const d = sub(q.o, w.o); return hypot(...sub(d, scl(w.a, dot(d, w.a)))) < w.r * 0.05 && q.r < w.r; }
    const rq = sqrt(max(0, dot(e, e) - ext * ext));
    return hypot(...sub(sub(c, w.o), scl(w.a, t))) + 0.7 * rq < w.r;
  }
  function inPoly(S, L, H, p) {
    let c = false;
    for (const lp of H ? [L, ...H] : [L]) for (let i = 0, j = lp.length - 1; i < lp.length; j = i++) {
      const a = lp[i] * 3, b = lp[j] * 3, yi = S[a + 1], yj = S[b + 1];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < (S[b] - S[a]) * (p[1] - yi) / (yj - yi) + S[a]) c = !c;
    }
    return c;
  }
  const planeDepth = (V, it, p) => {
    const r = it.r, F = r.G.F[it.f], n = r.G.N[it.f], W = r.G.W, j = F.v[0] * 3, c = V.cam;
    const q = add(scl(c.R, (p[0] - c.ox) / c.k), scl(c.D, (p[1] - c.oy) / c.k)), den = dot(n, c.V);
    return abs(den) < 1e-9 ? null : (dot(n, [W[j], W[j + 1], W[j + 2]]) - dot(n, q)) / den;
  };

  // ---------- the view a layout returns ----------
  const VIEW = {
    project(p) { return this.cam.p(p); },
    // A screen point back onto the plane z = h, or onto { point, normal }.
    unproject(pt, z = 0) {
      const c = this.cam, q = add(scl(c.R, (pt[0] - c.ox) / c.k), scl(c.D, (pt[1] - c.oy) / c.k));
      const n = typeof z === "object" ? z.normal : [0, 0, 1], d0 = typeof z === "object" ? dot(z.normal, z.point) : z, den = dot(n, c.V);
      return abs(den) < 1e-9 ? null : add(q, scl(c.V, (d0 - dot(n, q)) / den));
    },
    // The front-most part under a screen point (solid parts first, then see-through ones).
    pick(pt) {
      for (const glass of [false, true]) for (let i = this.list.length - 1; i >= 0; i--) {
        const it = this.list[i], r = it.r, F = r.G.F[it.f];
        if (F.d || r.node.pickable === false || (alphaOf(r.node) < 1) !== glass) continue;
        if (inPoly(r.S, F.v, F.h, pt)) {
          const d = planeDepth(this, it, pt);
          return { node: r.node, name: r.names[r.names.length - 1] ?? "", names: r.names, face: it.f, point: d == null ? null : add(add(scl(this.cam.R, (pt[0] - this.cam.ox) / this.cam.k), scl(this.cam.D, (pt[1] - this.cam.oy) / this.cam.k)), scl(this.cam.V, d)) };
        }
      }
      return null;
    },
    // World bounds of every part with this name (or in a group with it).
    bounds(name) {
      const lo = [1e18, 1e18, 1e18], hi = [-1e18, -1e18, -1e18];
      let any = false;
      for (const r of this.recs) if (r.names.includes(name)) { any = true; for (let k = 0; k < 3; k++) { lo[k] = min(lo[k], r.G.lo[k]); hi[k] = max(hi[k], r.G.hi[k]); } }
      return any ? [lo, hi] : null;
    },
    at(name, f = [0.5, 0.5, 0.5]) { const b = this.bounds(name); return b ? this.project([0, 1, 2].map(k => lerp(b[0][k], b[1][k], f[k]))) : null; },
    // The screen ellipse of a 3D circle, in the effects kit's format.
    ellipse(c, n, r) {
      n = nrm(n);
      const u = nrm(crs(abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], n)), w = crs(n, u), p0 = this.project(c);
      const d = v => { const p = this.project(add(c, scl(v, r))); return [p[0] - p0[0], p[1] - p0[1]]; };
      const a = d(u), b = d(w), A = d(n), LA = hypot(...A), P = a[0] ** 2 + b[0] ** 2, Q = a[0] * a[1] + b[0] * b[1], S = a[1] ** 2 + b[1] ** 2, m = (P + S) / 2, q = hypot((P - S) / 2, Q);
      return { center: [p0[0], p0[1]], rx: sqrt(m + q), ry: sqrt(max(0, m - q)), angle: 0.5 * Math.atan2(2 * Q, P - S), axis: LA > 1e-9 ? [A[0] / LA, A[1] / LA] : [1, 0], along: LA };
    },
    axis(a, b) { const p = this.project(a), q = this.project(b), l = hypot(q[0] - p[0], q[1] - p[1]) || 1; return { from: p, to: q, dir: [(q[0] - p[0]) / l, (q[1] - p[1]) / l], length: l }; },
    get stats() { return { faces: this.faces, chunks: this.chunks.length, cycles: this.cycles, ms: this.ms }; },
  };

  // ---------- painting, to a canvas or to SVG ----------
  const LW = { sil: 1.35, cre: 0.7 };
  function textMatrix(cam, r, d) {
    const o = ap(r.M, d.o), u = ad(r.M, d.u), v = ad(r.M, d.v), s = d.size / 10, k = cam.k, p = cam.p(o);
    return [s * k * dot(u, cam.R), s * k * dot(u, cam.D), -s * k * dot(v, cam.R), -s * k * dot(v, cam.D), p[0], p[1]];
  }
  function paint(V, pen, colorsOf, nameColor, o = {}) {
    const ink = (V.scene.ink ?? 1) * (o.ink ?? 1), L = V.list;
    if (V.scene.shadow !== false) pen.shadow(V.shadow);
    const lines = (r, S, col, a, cre, sil) => {
      if (cre.length) pen.seg(S, cre, col[11], LW.cre * ink, a < 1 ? 0.55 : 1);
      if (sil.length) pen.seg(S, sil, col[10], LW.sil * ink * (1 + 0.5 * (r.hl || 0)), a < 1 ? 0.7 : 1);
    };
    for (let i = 0; i < L.length; i++) {
      const it = L[i], r = it.r, F = r.G.F[it.f], S = r.S, col = colorsOf(r), a = alphaOf(r.node), d = F.d;
      if (it.run) {   // a convex chunk: one fill per tone, then all its lines in two strokes
        const tones = new Map(), cre = [], sil = [], dec = [];
        let sm = 0;
        for (let k = i; k < i + it.run; k++) {
          const q = L[k], G = r.G.F[q.f];
          if (G.d) { dec.push(q); continue; }
          if (!tones.has(q.t)) tones.set(q.t, []);
          tones.get(q.t).push(G.v, ...(G.h || []));
          cre.push(...q.cre); sil.push(...q.sil); sm ||= q.seam;
        }
        for (const [t, loops] of tones) pen.poly(S, loops, col[t], a, a < 1 || !sm ? 0 : 0.6);
        for (const q of dec) mark(q);
        lines(r, S, col, a, cre, sil);
        i += it.run - 1;
        continue;
      }
      if (d) { mark(it); continue; }
      const loops = F.h ? [F.v, ...F.h] : [F.v];
      pen.poly(S, loops, col[it.t], a, a < 1 ? 0 : it.seam ? 0.6 : 0);
      if (F.cap) pen.hatch(S, loops, col[12]);
      lines(r, S, col, a, it.cre, it.sil);
    }
    function mark(it) {
      const r = it.r, F = r.G.F[it.f], S = r.S, col = colorsOf(r), a = alphaOf(r.node), d = F.d;
      {
        if (d.k === "text") { if (d.text !== "" && d.text != null) pen.text(String(d.text), textMatrix(V.cam, r, d), nameColor(d.color), d); return; }
        if (d.tone === "none") return;
        const c = d.tone === "slot" ? col[7] : d.tone === "screen" ? col[8] : d.tone === "mark" ? col[9] : nameColor(d.tone);
        if (d.k === "line") return pen.seg(S, [F.v], c, (d.w || 0.8) * ink, a);
        pen.poly(S, [F.v], c, a, 0);
        if (d.line) pen.seg(S, F.v.map((q, i) => [q, F.v[(i + 1) % F.v.length]]), col[11], LW.cre * ink * 0.85, a);
      }
    }
  }
  function canvasPen(ctx, g, fonts, sh) {
    const trace = (S, L) => { let j = L[0] * 3; ctx.moveTo(S[j], S[j + 1]); for (let i = 1; i < L.length; i++) { j = L[i] * 3; ctx.lineTo(S[j], S[j + 1]); } ctx.closePath(); };
    const blur = (polys, b, color, alpha) => {
      if (!polys.length) return;
      const dpr = g.dpr || 1, off = 6000;
      ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = b * dpr; ctx.shadowOffsetX = off * dpr; ctx.globalAlpha = alpha; ctx.fillStyle = color;
      ctx.beginPath();
      for (const P of polys) { ctx.moveTo(P[0][0] - off, P[0][1]); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0] - off, P[i][1]); ctx.closePath(); }
      ctx.fill(); ctx.restore();
    };
    return {
      poly(S, loops, fill, a, seam) {
        ctx.beginPath(); for (const L of loops) trace(S, L);
        ctx.globalAlpha = a; ctx.fillStyle = fill; ctx.fill("evenodd");
        if (seam) { ctx.strokeStyle = fill; ctx.lineWidth = seam; ctx.stroke(); }
        ctx.globalAlpha = 1;
      },
      hatch(S, loops, color) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        ctx.save(); ctx.beginPath();
        for (const L of loops) { trace(S, L); for (const q of L) { x0 = min(x0, S[q * 3]); x1 = max(x1, S[q * 3]); y0 = min(y0, S[q * 3 + 1]); y1 = max(y1, S[q * 3 + 1]); } }
        ctx.clip("evenodd"); ctx.beginPath();
        for (let x = x0 - (y1 - y0); x < x1; x += 4.5) { ctx.moveTo(x, y1); ctx.lineTo(x + (y1 - y0), y0); }
        ctx.strokeStyle = color; ctx.lineWidth = 0.75; ctx.stroke(); ctx.restore();
      },
      seg(S, es, color, w, a) {
        ctx.beginPath();
        for (const e of es) { const i = e[0] * 3, j = e[1] * 3; ctx.moveTo(S[i], S[i + 1]); ctx.lineTo(S[j], S[j + 1]); }
        ctx.globalAlpha = a; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); ctx.globalAlpha = 1;
      },
      text(str, m, color, d) {
        ctx.save(); ctx.transform(...m);
        ctx.font = `${d.weight} 10px ${d.font === "mono" ? fonts.mono : fonts.text}`;
        ctx.textAlign = d.align; ctx.textBaseline = "middle"; ctx.fillStyle = color; ctx.fillText(str, 0, 0); ctx.restore();
      },
      shadow(s) { blur(s.amb, 16, sh.color, sh.amb); blur(s.con, 5, sh.color, sh.con); },
    };
  }
  const f1 = x => (round(x * 10) / 10).toString();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function svgPen(out, sh) {
    const P = (S, L) => { let s = ""; for (let i = 0; i < L.length; i++) { const j = L[i] * 3; s += (i ? "L" : "M") + f1(S[j]) + " " + f1(S[j + 1]); } return s + "Z"; };
    const op = (k, a) => (a < 1 ? ` ${k}="${a}"` : "");
    return {
      poly(S, loops, fill, a, seam) { out.push(`<path d="${loops.map(L => P(S, L)).join("")}" fill="${fill}"${loops.length > 1 ? ' fill-rule="evenodd"' : ""}${op("fill-opacity", a)}${seam ? ` stroke="${fill}" stroke-width="${seam}"` : ""}/>`); },
      hatch(S, loops) { out.push(`<path d="${loops.map(L => P(S, L)).join("")}" fill="url(#iso-hatch)" fill-rule="evenodd"/>`); },
      seg(S, es, color, w, a) { if (es.length) out.push(`<path d="${es.map(e => `M${f1(S[e[0] * 3])} ${f1(S[e[0] * 3 + 1])}L${f1(S[e[1] * 3])} ${f1(S[e[1] * 3 + 1])}`).join("")}" fill="none" stroke="${color}" stroke-width="${f1(w * 10) / 10}"${op("stroke-opacity", a)}/>`); },
      text(str, m, color, d) { out.push(`<text transform="matrix(${m.map(x => (round(x * 1000) / 1000)).join(" ")})" fill="${color}" font-family="${d.font === "mono" ? "monospace" : "sans-serif"}" font-size="10" font-weight="${d.weight}" text-anchor="${d.align === "left" ? "start" : d.align === "right" ? "end" : "middle"}" dominant-baseline="central">${esc(str)}</text>`); },
      shadow(s) {
        for (const [polys, b, a] of [[s.amb, 8, sh.amb], [s.con, 2.5, sh.con]]) if (polys.length)
          out.push(`<path d="${polys.map(p => "M" + p.map(q => f1(q[0]) + " " + f1(q[1])).join("L") + "Z").join("")}" fill="${sh.color}" fill-opacity="${a}" filter="url(#iso-b${b * 10})"/>`);
      },
    };
  }
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // A glow at a 3D point: g.fx.glow when present, else a gradient.
  function glow(g, V, p3, o = {}) {
    const p = V.project(p3), I = o.intensity ?? 1, r = o.r ?? 6, sp = o.spread ?? 22;
    if (I <= 0.01) return null;
    if (g.fx && g.fx.glow) return g.fx.glow(o.box ?? null, { at: [p[0], p[1]], r, temp: o.temp ?? 1500, intensity: I, spread: sp, seed: o.seed, t: o.t });
    const c = g.ctx, R = r + sp, gr = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], R), col = o.color ?? "orange";
    gr.addColorStop(0, g.rgba(col, 0.9 * min(1, I))); gr.addColorStop(r / R, g.rgba(col, 0.5 * min(1, I))); gr.addColorStop(1, g.rgba(col, 0));
    c.save(); c.fillStyle = gr; c.fillRect(p[0] - R, p[1] - R, 2 * R, 2 * R); c.restore();
    return null;
  }

  (typeof window !== "undefined" ? (window.__safisG ||= []) : []).push((g, util) => {
    // Draws a scene into the figure (or o.box); returns the view.
    g.iso = (scene, o = {}) => {
      const box = o.box || [0, 0, g.w, g.h], V = layout(scene, { ...o, box }), pal = livePal(), hlc = o.highlightColor || "brass";
      const dt = scene._time != null ? clamp(g.time - scene._time, 0, 0.1) : 1, still = reduced();
      scene._time = g.time;
      let anim = false;
      for (const r of V.recs) {
        const n = r.node, tg = n.pickable !== false && ((o.hover != null && r.names.includes(o.hover)) || (g.highlight != null && r.names.includes(g.highlight))) ? 1 : 0;
        n._hl = still ? tg : follow(n._hl ?? tg, tg, dt, 0.08);
        if (abs(n._hl - tg) < 0.01) n._hl = tg; else anim = true;
        r.hl = n._hl;
      }
      const ctx = g.ctx;
      ctx.save();
      if (o.box) { ctx.beginPath(); ctx.rect(...box); ctx.clip(); }
      ctx.lineCap = ctx.lineJoin = "round";
      paint(V, canvasPen(ctx, g, { mono: util.fontMono, text: util.fontText }, pal.dark ? { color: "rgb(0,0,0)", amb: 0.55, con: 0.75 } : { color: hex(pal.ink), amb: 0.1, con: 0.22 }),
        r => partColors(pal, r, hlc), name => (pal[name] ? hex(pal[name]) : name), o);
      ctx.restore();
      V.glow = (p, oo) => glow(g, V, p, oo);
      if (o.glow !== false) for (const r of V.recs) {
        const n = r.node;
        if ((n.material === "hot" || n.heat > 0) && (n.heat ?? 0) > 0.02) {
          const lo = r.G.lo, hi = r.G.hi, c = scl(add(lo, hi), 0.5), a = V.project(lo), b = V.project(hi);
          V.glow(c, { r: hypot(a[0] - b[0], a[1] - b[1]) * 0.16, intensity: n.heat * (pal.dark ? 0.6 : 0.85), temp: 900 + 800 * n.heat, spread: 22 });
        }
      }
      if (anim) g.wantsFrame = true;
      scene._view = V;
      return V;
    };
  });

  // ---------- SVG export ----------
  function themes() {
    const L = {}, D = {};
    if (typeof document !== "undefined") try {
      const grab = (st, to) => { for (const n of NAMES) { const v = st.getPropertyValue("--" + n).trim(); if (v && !v.startsWith("var(")) to[n] = v; } };
      const visit = rules => {
        for (const r of rules) {
          if (r.media) { if (!/dark/.test(r.media.mediaText) && r.cssRules) visit(r.cssRules); continue; }
          if (r.selectorText === ":root") grab(r.style, L);
          else if (/^:root\[data-theme=["']?dark["']?\]$/.test(r.selectorText || "")) grab(r.style, D);
        }
      };
      for (const s of document.styleSheets) visit(s.cssRules);
    } catch (e) { /* stylesheet unreadable: fall back to defaults */ }
    return { light: mkPal(L, DEF_L), dark: mkPal(D, DEF_D) };
  }
  function toSVG(scene, o = {}) {
    let V = scene._view;
    if (!V || o.view || o.width) {
      const keep = [scene._fit, scene._lay, scene._rank], w = o.width ?? V?.box[2] ?? 640, h = o.height ?? V?.box[3] ?? 400;
      V = layout(scene, { view: o.view ?? (V ? { yaw: V.cam.A, pitch: V.cam.E } : {}), box: [0, 0, w, h], zoom: o.zoom });
      [scene._fit, scene._lay, scene._rank] = keep;
    }
    const [bx, by, w, h] = V.box, th = themes(), vars = new Map();
    const reg = (l, d) => { const k = l + d; let v = vars.get(k); if (!v) vars.set(k, (v = { n: "i" + vars.size.toString(36), l, d })); return `var(--${v.n})`; };
    const hlc = o.highlightColor || "brass", out = [];
    const sh = { color: reg(hex(th.light.ink), "#000000"), amb: 0.1, con: 0.22 };
    const bg = reg(hex(th.light.panel), hex(th.dark.panel)), hatch = reg(hex(mixc(th.light.ink, th.light.panel, 0.45)), hex(mixc(th.dark.ink, th.dark.panel, 0.55)));
    const memo = new Map();
    paint(V, svgPen(out, sh), r => {
      let c = memo.get(r);
      if (!c) { const a = partColors(th.light, r, hlc), b = partColors(th.dark, r, hlc); c = a.map((x, i) => reg(x, b[i])); memo.set(r, c); }
      return c;
    }, name => (th.light[name] ? reg(hex(th.light[name]), hex(th.dark[name])) : name), o);
    const vl = [...vars.values()];
    const css = `svg{${vl.map(v => `--${v.n}:${v.l}`).join(";")}}@media (prefers-color-scheme:dark){svg{${vl.map(v => `--${v.n}:${v.d}`).join(";")}}}`;
    const defs = `<filter id="iso-b80" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8"/></filter><filter id="iso-b25"><feGaussianBlur stdDeviation="2.5"/></filter>` +
      `<pattern id="iso-hatch" width="4.5" height="4.5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="4.5" stroke="${hatch}" stroke-width="0.75"/></pattern>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bx} ${by} ${w} ${h}" width="${w}" height="${h}">${o.title ? `<title>${esc(o.title)}</title>` : ""}<style>${css}</style><defs>${defs}</defs>` +
      `${o.background !== false ? `<rect x="${bx}" y="${by}" width="${w}" height="${h}" fill="${bg}"/>` : ""}<g stroke-linecap="round" stroke-linejoin="round">${out.join("")}</g></svg>`;
  }
  function download(scene, name = "figure.svg", o = {}) {
    const svg = toSVG(scene, o);
    if (typeof document === "undefined" || navigator.webdriver || document.documentElement.classList.contains("safis-checking")) return svg;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return svg;
  }

  // ---------- audit: paint order against true depth where chunks overlap ----------
  function audit(scene, o = {}) {
    const V = o.view || scene._view || scene._lay;
    if (!V) return null;
    const C = V.chunks, n = o.samples ?? 5, tol = o.tol ?? 1e-4 * (hypot(V.hi[0] - V.lo[0], V.hi[1] - V.lo[1], V.hi[2] - V.lo[2]) || 1), conflicts = [];
    const depth = (ch, p) => {
      let best = null;
      for (const f of ch.faces) {
        const it = ch.r.items[f], F = ch.r.G.F[f];
        if (F.d || !it || !inPoly(ch.r.S, F.v, F.h, p)) continue;
        const d = planeDepth(V, it, p);
        if (d != null && (best == null || d > best)) best = d;
      }
      return best;
    };
    let pairs = 0;
    for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++) {
      const A = C[i], B = C[j], x0 = max(A.sb[0], B.sb[0]), x1 = min(A.sb[2], B.sb[2]), y0 = max(A.sb[1], B.sb[1]), y1 = min(A.sb[3], B.sb[3]);
      if (x0 >= x1 || y0 >= y1) continue;
      pairs++;
      let bad = 0, at = null, worst = 0;
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
        const p = [lerp(x0, x1, (a + 0.5) / n), lerp(y0, y1, (b + 0.5) / n)], da = depth(A, p), db = depth(B, p);
        if (da != null && db != null && da > db + tol) { bad++; if (da - db > worst) { worst = da - db; at = p; } }
      }
      if (bad) conflicts.push({ first: A.r.names.join("/") || "part", second: B.r.names.join("/") || "part", samples: bad, at, depth: worst });
    }
    return { pairs, conflicts, ok: !conflicts.length };
  }

  // ---------- motion helpers ----------
  const cdt = dt => clamp(dt || 0, 0, 0.1);
  // Exponential follow: moves a share 1 - e^(-dt/tau) of the way each step, at any frame rate.
  function follow(cur, target, dt, tau = 0.25) {
    if (reduced() || cur == null || !Number.isFinite(cur)) return target;
    return target + (cur - target) * exp(-cdt(dt) / max(1e-6, tau));
  }
  // Critically damped spring on { x, v }: settles on target without overshoot. Returns x.
  function spring(st, target, dt, tau = 0.25) {
    if (reduced() || !Number.isFinite(st.x)) { st.x = target; st.v = 0; return target; }
    const w = 1 / max(1e-6, tau), h = cdt(dt), c1 = st.x - target, c2 = (st.v || 0) + w * c1, e = exp(-w * h);
    st.x = target + (c1 + c2 * h) * e; st.v = (c2 - w * (c1 + c2 * h)) * e;
    return st.x;
  }
  // A one-off event: smoothstep rise over `rise` seconds, then exponential decay.
  function pulse(t, rise = 0.12, decay = 0.6) {
    if (t < 0) return 0;
    if (t < rise) { const u = t / rise; return u * u * (3 - 2 * u); }
    return reduced() ? 0 : exp(-(t - rise) / decay);
  }

  // ---------- interaction helpers for demo() ----------
  const matches = (hit, sp) => hit && [].concat(sp.part).some(n => hit.names.includes(n));
  // drag: { hit, start, move, end } that slides named parts along an axis within limits.
  function drag(scene, specs) {
    specs = [].concat(specs);
    let act = null;
    return {
      hit(p) { const V = scene._view, h = V && V.pick(p); return !!specs.find(sp => matches(h, sp)); },
      start(p, s, v) {
        const V = scene._view, h = V && V.pick(p), sp = h && specs.find(x => matches(h, x));
        act = sp ? { sp, p0: p, val: sp.key in v ? v[sp.key] : s[sp.key] } : null;
      },
      move(p, s, v, delta, fig) {
        const V = scene._view;
        if (!act || !V) return;
        const { sp, p0, val } = act, u = axv(sp.axis || "x"), c = V.cam, pu = [c.k * dot(u, c.R), c.k * dot(u, c.D)], l2 = pu[0] ** 2 + pu[1] ** 2;
        if (l2 < 1e-6) return;
        const t = ((p[0] - p0[0]) * pu[0] + (p[1] - p0[1]) * pu[1]) / l2, x = clamp(val + t / (sp.scale ?? 1), sp.min ?? -Infinity, sp.max ?? Infinity);
        if (sp.key in v && fig) fig.set(sp.key, x); else s[sp.key] = x;
      },
      end() { act = null; },
    };
  }
  // hover(p, s): the name under the pointer goes to s[key]; true when it changed.
  function hover(scene, o = {}) {
    const key = o.key || "hover";
    return (p, s) => {
      const V = scene._view, h = p && V ? V.pick(p) : null;
      let name = h ? (o.level === "group" ? h.names[0] : h.name) || null : null;
      if (o.only && !o.only.includes(name)) name = null;
      if (s[key] === name) return false;
      s[key] = name;
      return true;
    };
  }
  function helix(o = {}) {
    const r = o.r ?? 1, pitch = o.pitch ?? 0.3, turns = o.turns ?? 4, n = max(8, round((o.steps ?? 16) * turns)), F = frame(o.at, o.axis || "z"), pts = [];
    for (let i = 0; i <= n; i++) { const a = TAU * turns * i / n; pts.push(ap(F, [r * cos(a), r * sin(a), pitch * turns * i / n])); }
    return pts;
  }

  const Iso = {
    scene: (o = {}) => new Node({ ...o, name: o.name ?? "" }),
    layout, toSVG, download, audit, follow, spring, pulse, reduced, helix, fillet, frame, VIEWS,
    orbit: (o = {}) => ({ yaw: PI / 4, pitch: PI / 6, minPitch: -0.3, maxPitch: 1.45, ...o }),
    drag, hover, materials: Object.keys(MAT), Mesh, Node, version: 1,
  };
  if (typeof window !== "undefined") window.Iso = Iso;
})();

;

/* Explainer runtime. demo(id, spec) turns <figure class="demo" id="..."> into a
   live figure. Reference: references/runtime.md in the skill. */
(() => {
  "use strict";
  const root = document.documentElement;
  const NAMES = ["bg", "panel", "ink", "muted", "faint", "grid", "brass", "red", "orange", "green", "blue", "purple"];
  const palette = {};
  const demos = [];
  const byEl = new Map();
  const errors = [];
  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");
  let fontText = "sans-serif", fontMono = "monospace", fontSerif = "serif";

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const TAU = Math.PI * 2;

  // The reader's light/dark choice, applied before the page paints. "auto" follows the system.
  const THEME_KEY = "safis-theme";
  const savedTheme = () => { try { return localStorage.getItem(THEME_KEY) || "auto"; } catch { return "auto"; } };
  function setTheme(mode) {
    // Snap, don't smear: switch with transitions off for one frame.
    const still = document.createElement("style");
    still.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.append(still);
    if (mode === "light" || mode === "dark") root.dataset.theme = mode; else delete root.dataset.theme;
    void getComputedStyle(document.body).opacity;
    requestAnimationFrame(() => still.remove());
    try { if (mode === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, mode); } catch {}
    for (const b of document.querySelectorAll(".theme-toggle")) syncThemeButton(b);
  }
  if (!root.dataset.theme && savedTheme() !== "auto") root.dataset.theme = savedTheme();

  function readTheme() {
    // Tokens live on :root in pages; framework hosts can scope them to a .safis element instead.
    let cs = getComputedStyle(root);
    if (!cs.getPropertyValue("--ink").trim()) { const el = document.querySelector(".safis"); if (el) cs = getComputedStyle(el); }
    for (const n of NAMES) palette[n] = cs.getPropertyValue("--" + n).trim();
    fontText = cs.getPropertyValue("--font-text").trim() || "sans-serif";
    fontMono = cs.getPropertyValue("--font-mono").trim() || "monospace";
    fontSerif = cs.getPropertyValue("--font-serif").trim() || "serif";
  }
  readTheme();

  const color = c => palette[c] || c;
  const cssColor = c => (c in palette ? `var(--${c})` : c);
  // Palette values arrive as #rrggbb, or #rgb and rgb() once a host's CSS minifier has had them.
  function parseColor(v) {
    const s = String(v).trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [...m[1]].map(h => parseInt(h + h, 16));
    m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(s);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    if (m) return [+m[1], +m[2], +m[3]].map(Math.round);
    return null;
  }
  const rgb = c => parseColor(color(c)) ?? [128, 128, 128];
  function rgba(c, a) {
    const p = parseColor(color(c));
    return p ? `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${a})` : color(c);
  }
  // Mix of two palette colors, t from 0 (a) to 1 (b).
  function mix(a, b, t) {
    const p = rgb(a), q = rgb(b);
    return `rgb(${Math.round(lerp(p[0], q[0], t))}, ${Math.round(lerp(p[1], q[1], t))}, ${Math.round(lerp(p[2], q[2], t))})`;
  }

  const decimals = step => (String(step ?? 0.01).split(".")[1] || "").length;
  const clone = o => { try { return structuredClone(o); } catch { return { ...o }; } };

  // ---------- Drawing helpers, passed to draw() as g ----------
  function makeG(ctx) {
    let hatchCache = new Map();
    function hatchPattern(c, gap, angle) {
      const key = `${color(c)}|${gap}|${angle}`;
      if (hatchCache.has(key)) return hatchCache.get(key);
      const s = Math.max(4, Math.round(gap * 2));
      const cv = document.createElement("canvas");
      const dpr = g.dpr || 1;
      cv.width = cv.height = Math.round(s * dpr);
      const c2 = cv.getContext("2d");
      c2.scale(dpr, dpr);
      c2.strokeStyle = color(c);
      c2.lineWidth = 1;
      for (let k = -s; k <= 2 * s; k += gap) { c2.beginPath(); c2.moveTo(k, s); c2.lineTo(k + s, 0); c2.stroke(); }
      const pat = ctx.createPattern(cv, "repeat");
      if (pat && pat.setTransform) pat.setTransform(new DOMMatrix().scale(1 / dpr).rotateSelf(angle - 45));
      hatchCache.set(key, pat);
      return pat;
    }
    function shape(o, build) {
      ctx.save();
      if (o.alpha != null) ctx.globalAlpha = o.alpha;
      ctx.beginPath();
      build();
      const rule = o.fillRule ?? "nonzero";
      if (o.fill) { ctx.fillStyle = color(o.fill); ctx.fill(rule); }
      if (o.hatch) {
        ctx.fillStyle = hatchPattern(o.hatch === true ? "muted" : o.hatch, o.hatchGap ?? 6, o.hatchAngle ?? 45);
        ctx.fill(rule);
      }
      if (o.stroke) {
        ctx.strokeStyle = color(o.stroke);
        ctx.lineWidth = o.width ?? 2;
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.setLineDash(o.dash || []);
        ctx.stroke();
      }
      ctx.restore();
    }
    const font = (o, fallback = fontText) => `${o.italic ? "italic " : ""}${o.weight ?? 500} ${o.size ?? 14}px ${o.font === "mono" ? fontMono : o.font === "serif" ? fontSerif : o.font ?? fallback}`;
    const textWidth = (str, o) => { ctx.save(); ctx.font = font(o); if ("letterSpacing" in ctx && o.tracking) ctx.letterSpacing = `${o.tracking}px`; const w = ctx.measureText(String(str)).width; ctx.restore(); return w; };

    const g = {
      ctx, w: 0, h: 0, dpr: 1, color, rgba, mix,
      line(a, b, o = {}) {
        shape({ stroke: "ink", ...o }, () => { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); });
      },
      // A list of points, or a list of rings (shapes with holes: pair with fillRule: "evenodd").
      path(pts, o = {}) {
        const rings = Array.isArray(pts[0]?.[0]) ? pts.filter(r => r.length > 1) : pts.length > 1 ? [pts] : [];
        if (!rings.length) return;
        shape(o.fill || o.stroke || o.hatch ? o : { ...o, stroke: "ink" }, () => {
          for (const r of rings) {
            ctx.moveTo(r[0][0], r[0][1]);
            for (let i = 1; i < r.length; i++) ctx.lineTo(r[i][0], r[i][1]);
            if (o.close) ctx.closePath();
          }
        });
      },
      // The house hatching as a fill style, for drawing straight on g.ctx (shadows, night, cut faces).
      hatch: (c = "muted", gap = 6, angle = 45) => hatchPattern(c, gap, angle),
      // Smooth curve through the points (Catmull-Rom).
      spline(pts, o = {}) {
        if (pts.length < 2) return;
        g.path(window.E3 ? E3.smooth(pts, { closed: !!o.close, steps: o.steps ?? 10 }) : pts, o);
      },
      circle(c, r, o = {}) {
        shape(o.fill || o.stroke || o.hatch ? o : { ...o, fill: "ink" }, () => ctx.arc(c[0], c[1], Math.max(0, r), 0, TAU));
      },
      rect(x, y, w, h, o = {}) {
        shape(o.fill || o.stroke || o.hatch ? o : { ...o, fill: "ink" }, () => {
          if (o.r && ctx.roundRect) ctx.roundRect(x, y, w, h, o.r); else ctx.rect(x, y, w, h);
        });
      },
      arrow(a, b, o = {}) {
        const w = o.width ?? 2;
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
        if (len < 1e-6) return;
        const ux = dx / len, uy = dy / len;
        const hl = Math.min(o.head ?? Math.max(9, w * 4), len);
        const hw = hl * 0.45;
        const base = [b[0] - ux * hl, b[1] - uy * hl];
        g.line(a, base, { ...o, stroke: o.stroke ?? "ink", width: w });
        shape({ fill: o.stroke ?? "ink", alpha: o.alpha }, () => {
          ctx.moveTo(b[0], b[1]);
          ctx.lineTo(base[0] - uy * hw, base[1] + ux * hw);
          ctx.lineTo(base[0] + uy * hw, base[1] - ux * hw);
          ctx.closePath();
        });
      },
      // Arc with an arrowhead at the end: center c, radius r, angles in radians (canvas convention, y down).
      arcArrow(c, r, a0, a1, o = {}) {
        const n = 32, pts = [];
        for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
        const tail = pts.slice(0, -3);
        g.path(tail, { stroke: o.stroke ?? "ink", width: o.width ?? 2, alpha: o.alpha });
        g.arrow(pts[pts.length - 4], pts[pts.length - 1], { ...o, head: o.head ?? 10 });
      },
      text(str, p, o = {}) {
        ctx.save();
        if (o.alpha != null) ctx.globalAlpha = o.alpha;
        ctx.font = font(o);
        if ("letterSpacing" in ctx) ctx.letterSpacing = `${o.tracking ?? 0}px`;
        ctx.textAlign = o.align ?? "center";
        ctx.textBaseline = o.baseline ?? "middle";
        const s = o.caps ? String(str).toUpperCase() : String(str);
        if (o.halo) {
          ctx.lineWidth = o.haloWidth ?? 4;
          ctx.lineJoin = "round";
          ctx.strokeStyle = color(o.halo === true ? "panel" : o.halo);
          ctx.strokeText(s, p[0], p[1]);
        }
        ctx.fillStyle = color(o.color ?? "ink");
        ctx.fillText(s, p[0], p[1]);
        ctx.restore();
      },
      measure: (str, o = {}) => textWidth(o.caps ? String(str).toUpperCase() : str, o),
      // A small label with a halo, the house style for naming things inside figures.
      label(str, p, o = {}) {
        g.text(str, p, { size: 12.5, weight: 600, halo: true, color: "ink", ...o });
      },
      // A colored pill with text, for variable names and short values ("c", "a", "X").
      chip(str, p, o = {}) {
        const size = o.size ?? 12, padX = o.padX ?? 5, h = size + 8;
        const w = Math.max(h, textWidth(str, { size, weight: 600 }) + padX * 2);
        const c = o.color ?? "blue";
        g.rect(p[0] - w / 2, p[1] - h / 2, w, h, { fill: mix(c, "#ffffff", 0.68), stroke: c, width: 1, r: 4 });
        g.text(str, [p[0], p[1] + 0.5], { size, weight: 600, color: "#1d1d20" });
        return { w, h };
      },
      // A disc with a short name inside (beads on a chain, residues, nodes). The name shrinks
      // to fit the disc instead of spilling out of it, and the fill follows the theme.
      bead(c, r, str, o = {}) {
        const col = o.color ?? "blue";
        g.circle(c, r, { fill: o.fill ?? mix(col, "panel", 0.8), stroke: o.stroke ?? col, width: o.width ?? 1.25, alpha: o.alpha });
        if (str == null || str === "") return;
        const max = o.size ?? Math.min(13, r * 0.9);
        const w = textWidth(str, { size: max, weight: 600 });
        const size = Math.max(7, Math.min(max, (max * (2 * r - 5)) / Math.max(w, 1)));
        g.text(str, [c[0], c[1] + 0.5], { size, weight: 600, color: o.textColor ?? "ink", alpha: o.alpha });
      },
      // Labels beside their points. Each takes the first nearby spot that overlaps no other
      // label or point and stays on the canvas; one pushed further out gets a leader line.
      // items: [{ at: [x, y], text, color, r (the point's radius), size, prefer: [dx, dy] }]
      labels(items, o = {}) {
        const placed = [], gap = 2;
        const pts = items.filter(it => it && it.at && Number.isFinite(it.at[0]) && Number.isFinite(it.at[1]));
        const DIRS = [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]];
        const onCanvas = b => b.x >= 2 && b.y >= 2 && b.x + b.w <= g.w - 2 && b.y + b.h <= g.h - 2;
        const hitsLabel = b => placed.some(p => b.x < p.x + p.w + gap && p.x < b.x + b.w + gap && b.y < p.y + p.h + gap && p.y < b.y + b.h + gap);
        const hitsPoint = (b, self) => pts.some(q => {
          if (q === self) return false;
          const r = (q.r ?? 3) + gap;
          return q.at[0] > b.x - r && q.at[0] < b.x + b.w + r && q.at[1] > b.y - r && q.at[1] < b.y + b.h + r;
        });
        for (const it of pts) {
          const style = { size: it.size ?? o.size ?? 12.5, weight: 600 };
          const w = textWidth(it.text, style), h = style.size + 3, r = (it.r ?? 3) + 5;
          let best = null;
          for (const ring of [1, 1.9, 2.8]) {
            for (const [dx, dy] of it.prefer ? [it.prefer, ...DIRS] : DIRS) {
              const cx = it.at[0] + dx * (r * ring + (dx ? w / 2 : 0)), cy = it.at[1] + dy * (r * ring + (dy ? h / 2 : 0));
              const b = { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, ring };
              if (onCanvas(b) && !hitsLabel(b) && !hitsPoint(b, it)) { best = b; break; }
            }
            if (best) break;
          }
          best ??= { x: it.at[0] + r, y: it.at[1] - h / 2, w, h, cx: it.at[0] + r + w / 2, cy: it.at[1], ring: 1 };
          placed.push(best);
          const c = it.color ?? o.color ?? "ink";
          if (best.ring > 1) g.line(it.at, [clamp(it.at[0], best.x, best.x + best.w), clamp(it.at[1], best.y, best.y + best.h)], { stroke: c === "ink" ? "muted" : c, width: 1 });
          g.text(it.text, [best.cx, best.cy], { ...style, color: c, halo: true });
        }
        return placed;
      },
      // Labels in the left and right margins of the canvas, with leader lines to their anchors.
      // items: [{ at: [x, y], text, color, side: "left" | "right" }]
      callouts(items, o = {}) {
        const pad = o.pad ?? 12, gap = o.gap ?? 20, size = o.size ?? 12.5;
        const style = { size, weight: 600, caps: o.caps ?? false, tracking: o.caps ? 0.9 : 0 };
        const sides = { left: [], right: [] };
        // A label keeps its side until its anchor is well past the split, so labels
        // don't jump from margin to margin while a 3D view turns.
        const memo = (g._calloutSides ??= new Map()), split = o.split ?? g.w / 2, band = g.w * 0.12;
        for (const it of items) {
          if (!it || !it.at || !Number.isFinite(it.at[0])) continue;
          let side = it.side;
          if (!side) {
            const prev = memo.get(it.text);
            side = prev && Math.abs(it.at[0] - split) < band ? prev : it.at[0] < split ? "left" : "right";
            memo.set(it.text, side);
          }
          sides[side].push(it);
        }
        for (const [side, list] of Object.entries(sides)) {
          list.sort((a, b) => a.at[1] - b.at[1]);
          const lo = pad + size, hi = g.h - pad - size;
          const ys = list.map(it => clamp(it.at[1] + (it.dy ?? 0), lo, hi));
          for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + gap);
          const over = ys.length ? ys[ys.length - 1] - hi : 0;
          if (over > 0) for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.max(lo, ys[i] - over);
          list.forEach((it, i) => {
            const y = ys[i], c = it.color ?? "ink";
            const tw = textWidth(it.text, style);
            const tx = side === "left" ? (o.left ?? pad) : g.w - (o.right ?? pad);
            const shoulder = side === "left" ? tx + tw + 8 : tx - tw - 8;
            const knee = side === "left" ? Math.min(shoulder + 14, it.at[0]) : Math.max(shoulder - 14, it.at[0]);
            g.path([it.at, [knee, y], [shoulder, y]], { stroke: c === "ink" ? "muted" : c, width: 1 });
            g.circle(it.at, 2.6, { fill: c === "ink" ? "ink" : c, stroke: "panel", width: 1.2 });
            g.text(it.text, [tx, y], { ...style, color: c, align: side === "left" ? "left" : "right", halo: true });
          });
        }
      },
      // A dimension line between a and b with end ticks and a centered label.
      dimension(a, b, text, o = {}) {
        const c = o.color ?? "muted", off = o.offset ?? 0;
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const A = [a[0] + nx * off, a[1] + ny * off], B = [b[0] + nx * off, b[1] + ny * off];
        if (off) { g.line(a, A, { stroke: c, width: 0.75, dash: [2, 3] }); g.line(b, B, { stroke: c, width: 0.75, dash: [2, 3] }); }
        g.line(A, B, { stroke: c, width: 1 });
        for (const P of [A, B]) g.line([P[0] + nx * 5, P[1] + ny * 5], [P[0] - nx * 5, P[1] - ny * 5], { stroke: c, width: 1 });
        if (text != null) g.text(text, [(A[0] + B[0]) / 2 + nx * 11, (A[1] + B[1]) / 2 + ny * 11], { size: 12.5, weight: 600, color: o.textColor ?? c, halo: true });
      },
      // A horizontal meter bar. frac from 0 to 1.
      meter(x, y, w, h, frac, o = {}) {
        const c = o.color ?? "brass";
        g.rect(x, y, w, h, { fill: "grid", r: h / 2 });
        g.rect(x, y, Math.max(h, w * clamp(frac, 0, 1)), h, { fill: c, r: h / 2, alpha: frac <= 0 ? 0 : 1 });
        if (o.label) g.text(o.label, [x + w / 2, y + h + 12], { size: 12, weight: 500, color: "muted" });
      },
      // A round gauge with a needle. value in [min, max].
      dial(c, r, value, o = {}) {
        const min = o.min ?? 0, max = o.max ?? 1, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
        g.circle(c, r, { fill: "panel", stroke: "ink", width: 1.5 });
        const ticks = o.ticks ?? 10;
        for (let i = 0; i <= ticks; i++) {
          const a = lerp(a0, a1, i / ticks), long = i % (o.major ?? 2) === 0;
          g.line([c[0] + Math.cos(a) * r * (long ? 0.78 : 0.85), c[1] + Math.sin(a) * r * (long ? 0.78 : 0.85)],
            [c[0] + Math.cos(a) * r * 0.92, c[1] + Math.sin(a) * r * 0.92], { stroke: "ink", width: long ? 1.5 : 1 });
        }
        const a = lerp(a0, a1, clamp((value - min) / (max - min), 0, 1));
        g.line(c, [c[0] + Math.cos(a) * r * 0.82, c[1] + Math.sin(a) * r * 0.82], { stroke: o.color ?? "red", width: 2 });
        g.circle(c, 3, { fill: o.color ?? "red" });
        if (o.label) g.text(o.label, [c[0], c[1] + r * 0.45], { size: 11, weight: 500, color: "muted" });
      },
      // A scalar field drawn as color. fn(x, y) gets canvas pixels and returns a number.
      field(fn, o = {}) {
        const box = o.box ?? [0, 0, g.w, g.h], res = o.res ?? 3;
        const cols = Math.max(2, Math.ceil(box[2] / res)), rows = Math.max(2, Math.ceil(box[3] / res));
        const [lo, hi] = o.range ?? [-1, 1];
        const map = o.map ?? "diverging";
        const cv = document.createElement("canvas");
        cv.width = cols; cv.height = rows;
        const c2 = cv.getContext("2d"), img = c2.createImageData(cols, rows);
        const paper = rgb("panel"), neg = rgb(o.low ?? "blue"), pos = rgb(o.high ?? "red");
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const v = fn(box[0] + ((i + 0.5) / cols) * box[2], box[1] + ((j + 0.5) / rows) * box[3]);
          let col;
          if (map === "diverging") {
            const t = clamp((v - (lo + hi) / 2) / ((hi - lo) / 2), -1, 1), k = Math.pow(Math.abs(t), 0.8) * 0.85;
            const end = t < 0 ? neg : pos;
            col = paper.map((p, q) => p + (end[q] - p) * k);
          } else {
            const t = clamp((v - lo) / (hi - lo), 0, 1);
            col = paper.map((p, q) => p + (pos[q] - p) * t);
          }
          const k = (j * cols + i) * 4;
          img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = Number.isFinite(v) ? 255 : 0;
        }
        c2.putImageData(img, 0, 0);
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        if (o.alpha != null) ctx.globalAlpha = o.alpha;
        ctx.drawImage(cv, box[0], box[1], box[2], box[3]);
        ctx.restore();
      },
      colorbar(x, y, w, h, o = {}) {
        const [lo, hi] = o.range ?? [-1, 1];
        g.field((px) => lerp(lo, hi, (px - x) / w), { box: [x, y, w, h], res: 2, range: [lo, hi], map: o.map, low: o.low, high: o.high });
        g.rect(x, y, w, h, { stroke: "faint", width: 1 });
        if (o.label) g.text(o.label, [x + w / 2, y + h + 12], { size: 12, weight: 500, color: "muted" });
        if (o.ends) { g.text(o.ends[0], [x - 6, y + h / 2], { size: 11, align: "right", color: "muted" }); g.text(o.ends[1], [x + w + 6, y + h / 2], { size: 11, align: "left", color: "muted" }); }
      },
      // A circular magnifier: redraws `draw` zoomed around `from`, shown in a circle at `to`.
      inset(o, draw) {
        const { from, to } = o, R = o.radius ?? 70, zoom = o.zoom ?? 3, r = R / zoom;
        const dx = to[0] - from[0], dy = to[1] - from[1], d = Math.hypot(dx, dy) || 1;
        const nx = -dy / d, ny = dx / d;
        const lineO = { stroke: "muted", width: 1 };
        g.line([from[0] + nx * r, from[1] + ny * r], [to[0] + nx * R, to[1] + ny * R], lineO);
        g.line([from[0] - nx * r, from[1] - ny * r], [to[0] - nx * R, to[1] - ny * R], lineO);
        g.circle(from, r, { stroke: "muted", width: 1 });
        ctx.save();
        ctx.beginPath();
        ctx.arc(to[0], to[1], R, 0, TAU);
        ctx.fillStyle = color("panel");
        ctx.fill();
        ctx.clip();
        ctx.translate(to[0], to[1]);
        ctx.scale(zoom, zoom);
        ctx.translate(-from[0], -from[1]);
        draw(g);
        ctx.restore();
        g.circle(to, R, { stroke: "ink", width: 1.5 });
      },
      // World coordinates (y up) -> canvas pixels, fitted into the canvas or into o.box = [x, y, w, h].
      fit(x0, x1, y0, y1, o = {}) {
        const pad = o.pad ?? 16;
        const box = o.box ?? [0, 0, g.w, g.h];
        let sx = (box[2] - 2 * pad) / (x1 - x0);
        let sy = (box[3] - 2 * pad) / (y1 - y0);
        if (o.uniform ?? true) sx = sy = Math.min(sx, sy);
        const cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2;
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const P = q => [cx + (q[0] - mx) * sx, cy - (q[1] - my) * sy];
        P.inv = p => [mx + (p[0] - cx) / sx, my - (p[1] - cy) / sy];
        P.sx = sx;
        P.sy = sy;
        return P;
      },
      axes(P, o = {}) {
        const [x0, x1] = o.x, [y0, y1] = o.y;
        const ax = clamp(0, x0, x1), ay = clamp(0, y0, y1);
        const fmt = o.format ?? (t => String(+t.toFixed(3)));
        const thin = { stroke: "muted", width: 1 };
        if (o.grid) {
          for (const t of o.xTicks ?? []) g.line(P([t, y0]), P([t, y1]), { stroke: "grid", width: 1 });
          for (const t of o.yTicks ?? []) g.line(P([x0, t]), P([x1, t]), { stroke: "grid", width: 1 });
        }
        g.line(P([x0, ay]), P([x1, ay]), thin);
        g.line(P([ax, y0]), P([ax, y1]), thin);
        for (const t of o.xTicks ?? []) {
          const p = P([t, ay]);
          g.line(p, [p[0], p[1] + 4], thin);
          g.text(fmt(t), [p[0], p[1] + 14], { color: "muted", size: 11.5 });
        }
        for (const t of o.yTicks ?? []) {
          const p = P([ax, t]);
          g.line(p, [p[0] - 4, p[1]], thin);
          g.text(fmt(t), [p[0] - 7, p[1]], { color: "muted", size: 11.5, align: "right" });
        }
        const lab = { size: 12, weight: 500, color: "muted" };
        if (o.xLabel) { const p = P([x1, ay]); g.text(o.xLabel, [p[0], p[1] - 10], { ...lab, align: "right" }); }
        if (o.yLabel) { const p = P([ax, y1]); g.text(o.yLabel, [p[0] + 8, p[1] + 2], { ...lab, align: "left" }); }
      },
      // Runs fn with drawing clipped to box = [x, y, w, h].
      clip(box, fn) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(box[0], box[1], box[2], box[3]);
        ctx.clip();
        try { fn(g); } finally { ctx.restore(); }
      },
      // Simple 3D to 2D projection for line drawings (no WebGL). Larger depth is closer.
      view3d(o = {}) {
        const yaw = o.yaw ?? 0.6, pitch = o.pitch ?? 0.3;
        const s = o.scale ?? Math.min(g.w, g.h) * 0.35;
        const c = o.center ?? [g.w / 2, g.h / 2];
        const dist = o.dist ?? Infinity;
        const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const rotate = q => {
          const x1 = cy * q[0] + sy * q[2], z1 = -sy * q[0] + cy * q[2];
          return [x1, cp * q[1] - sp * z1, sp * q[1] + cp * z1];
        };
        const P = q => {
          const r = rotate(q);
          const f = dist === Infinity ? 1 : dist / (dist - r[2]);
          return [c[0] + r[0] * s * f, c[1] - r[1] * s * f, r[2]];
        };
        P.rotate = rotate;
        P.scale = s;
        return P;
      },
      // Renders an E3 scene into the canvas (or into o.box) and returns its view:
      // view.project([x, y, z]) -> [px, py, distance], view.pick([px, py]) -> { node, point } | null.
      render3d(scene, cam = {}, o = {}) {
        if (!window.E3) throw new Error("the 3D engine (E3) is missing from this page");
        const box = o.box ?? [0, 0, g.w, g.h];
        const [bx, by, bw, bh] = box;
        // Supersample 2x for smooth edges. While the reader turns or drags the view, or
        // an animation runs, dense screens drop to 1x so motion stays fluid; the still
        // frame afterwards comes back at full quality.
        const out = g.dpr, budget = 1.05e7;
        let ss = out >= 1.5 && g.interacting ? 1 : 2;
        if (bw * bh * (out * ss) ** 2 > budget) ss = 1;
        const view = E3.render(scene, cam, bw, bh, out, ss);
        const s = view.source;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(s.image, s.sx, s.sy, s.sw, s.sh, bx, by, bw, bh);
        ctx.restore();
        if (s.image.close) s.image.close();
        return {
          ...view,
          box,
          project: p => { const q = view.project(p); return [q[0] + bx, q[1] + by, q[2]]; },
          pick: (p, opt) => view.pick([p[0] - bx, p[1] - by], opt),
          hidden: p => view.hidden(p),
        };
      },
      // Small XYZ axis marker showing the 3D view's orientation.
      gizmo(view, o = {}) {
        const at = o.at ?? [g.w - 34, g.h - 34], size = o.size ?? 20;
        const t = view.target, o0 = view.project(t);
        const span = Math.max(1e-6, E3.v3.dist(view.eye, t)) * 0.05;
        const axes = [["X", [1, 0, 0], "red"], ["Y", [0, 1, 0], "green"], ["Z", [0, 0, 1], "blue"]];
        const ends = axes.map(([name, d, c]) => {
          const q = view.project(E3.v3.add(t, E3.v3.scale(d, span)));
          const v = [q[0] - o0[0], q[1] - o0[1]], l = Math.hypot(v[0], v[1]) || 1;
          return { name, c, depth: q[2], end: [at[0] + (v[0] / l) * size * Math.min(1, l / 6), at[1] + (v[1] / l) * size * Math.min(1, l / 6)] };
        }).sort((a, b) => b.depth - a.depth);
        for (const e of ends) { g.line(at, e.end, { stroke: e.c, width: 1.5 }); g.text(e.name, [e.end[0] + (e.end[0] - at[0]) * 0.35, e.end[1] + (e.end[1] - at[1]) * 0.35], { size: 9, weight: 700, color: e.c }); }
      },
    };
    // A grab handle for something the reader can drag. Until the reader first touches
    // the figure it breathes gently, so it's obvious what can be moved.
    g.handle = (p, o = {}) => {
      const c = o.color ?? "ink", r = o.r ?? 7;
      if (!g.touched && o.hint !== false && !motionQuery.matches) {
        const k = (g.time * 0.9) % 1;
        g.circle(p, r + 3 + k * 12, { stroke: c, width: 1.5, alpha: 0.45 * (1 - k) });
        g.wantsFrame = true;
      }
      if (o.active) g.circle(p, r + 5, { fill: c, alpha: 0.16 });
      g.circle(p, r, { fill: c, stroke: "panel", width: 2.5 });
      g.circle(p, r + 1.25, { stroke: c, width: 1 });
      return { at: p, r: r + 6 };
    };
    // True when the prose term (or figure code) has lit the part with this name.
    g.lit = name => g.highlight != null && (Array.isArray(name) ? name.includes(g.highlight) : g.highlight === name);

    // Extensions (src/tex.js, src/plot.js) add their helpers to g here.
    for (const ext of window.__safisG ?? []) ext(g, util);
    return g;
  }

  // What extensions get besides g: palette access and the current theme fonts.
  const util = {
    color, cssColor, rgb, rgba, mix, clamp, lerp, smoothstep, TAU,
    get fontText() { return fontText; },
    get fontSerif() { return fontSerif; },
    get fontMono() { return fontMono; },
    // True when the page is dark, for kits that pick additive light or absorbing ink.
    get dark() { const [r, g, b] = rgb("bg"); return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128; },
  };

  // ---------- Figures ----------
  function fail(d, phase, e) {
    d.broken = true;
    d.playing = false;
    syncPlay(d);
    const message = String((e && e.message) || e);
    errors.push({ demo: d.id, phase, message });
    console.error(`[demo #${d.id}] ${phase}() failed:`, e);
    let box = d.el.querySelector(".demo-error");
    if (!box) {
      box = document.createElement("p");
      box.className = "demo-error";
      d.plate.after(box);
      d.nodes.push(box);
    }
    box.textContent = `This figure stopped: ${phase}() threw "${message}"`;
  }

  function guard(d, phase, fn) {
    if (d.broken) return false;
    try { fn(); return true; } catch (e) { fail(d, phase, e); return false; }
  }

  const initialState = spec =>
    typeof spec.state === "function" ? spec.state() : clone(spec.state ?? {});

  const node = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const typeOf = c => c.type ?? "slider";
  const NUMERIC = new Set(["slider", "stepper", "knob"]);
  const options = c => (c.options ?? []).map(o => (o !== null && typeof o === "object" ? { value: o.value, label: o.label ?? String(o.value) } : { value: o, label: String(o) }));
  const mod = (a, n) => ((a % n) + n) % n;
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let autoId = 0;

  function format(c, val, axis) {
    const type = typeOf(c);
    if (type === "toggle") return val ? "on" : "off";
    if (type === "choice") return options(c).find(o => o.value === val)?.label ?? String(val);
    const r = type === "pad" ? (axis ? c.y : c.x) : c;
    if (r.format) return r.format(val);
    const unit = r.unit ?? c.unit;
    const num = Number(val).toFixed(decimals(r.step ?? c.step)).replace("-", "−");
    return unit ? (/^[°%′″]/.test(unit) ? num + unit : `${num} ${unit}`) : num;
  }

  function demo(target, spec) {
    const el = typeof target === "string" ? document.getElementById(target) : target;
    if (!el) {
      errors.push({ demo: target, phase: "setup", message: `demo("${target}") found no element with that id` });
      console.error(`[demo #${target}] no element with id="${target}"`);
      return null;
    }
    if (!palette.ink) readTheme();
    if (!el.id) el.id = `figure-${++autoId}`;
    const id = el.id;
    if (byEl.has(el)) destroy(byEl.get(el));
    const d = {
      id, el, spec, v: {}, inputs: {}, w: 0, h: 0, dpr: 1, visible: false, dirty: true, broken: false,
      dragging: false, playing: false, spin: null, speed: 1, tweens: new Map(), touched: false, highlight: null,
      nodes: [], prose: [], abort: new AbortController(),
    };
    d.handle = {
      id, el,
      get state() { return d.s; },
      get values() { return d.v; },
      set: (key, value) => setControl(d, key, value),
      setMany: (values, o = {}) => applyValues(d, values, o.animate),
      // Back to the starting state. A spec.reset function runs after, so a figure can stop
      // what it started (a sound, a timer); listeners get a "safis:reset" event.
      reset() {
        const view = d.s.view;
        for (const k of Object.keys(d.s)) delete d.s[k];
        Object.assign(d.s, initialState(spec));
        if (view) d.s.view = view;
        d.dirty = true;
        if (typeof spec.reset === "function") guard(d, "reset", () => spec.reset(d.s, d.v, d.handle));
        el.dispatchEvent(new CustomEvent("safis:reset", { detail: d.handle }));
      },
      get visible() { return d.visible; },
      redraw() { d.dirty = true; },
      play(on = true) { d.playing = !!on && !!spec.step; syncPlay(d); },
      get playing() { return d.playing; },
      get highlight() { return d.highlight; },
      set highlight(name) { setHighlight(d, name); },
      destroy: () => destroy(d),
    };
    d.s = initialState(spec);
    if (spec.orbit) {
      d.s.view = { yaw: spec.orbit.yaw ?? -0.6, pitch: spec.orbit.pitch ?? 0.35 };
      d.view0 = { ...d.s.view };
    }

    el.classList.add("is-live");
    const plate = node("div", "plate");
    const stage = node("div", "stage");
    stage.tabIndex = 0;
    stage.setAttribute("role", "group");
    stage.setAttribute("aria-label", el.getAttribute("aria-label") || "interactive figure");
    d.canvas = node("canvas");
    d.canvas.setAttribute("aria-hidden", "true");
    stage.append(d.canvas);
    plate.append(stage);
    Object.assign(d, { plate, stage, ctx: d.canvas.getContext("2d") });
    d.g = makeG(d.ctx);

    const panel = node("div", "panel");
    if (spec.controls?.length) {
      const controls = buildControls(d);
      if (controls.children.length) panel.append(controls);
    }
    const foot = buildFoot(d);
    if (foot.children.length) panel.append(foot);
    if (panel.children.length) plate.append(panel);
    else plate.classList.add("bare");
    d.side = node("div", "side");
    buildHints(d);
    plate.append(d.side);
    el.prepend(plate);
    d.nodes.push(plate);

    // Every figure is a numbered plate with a caption: the author's <figcaption>,
    // else spec.caption, else the figure's aria-label.
    const own = el.querySelector(":scope > figcaption");
    if (own) el.append(own);
    else if (spec.caption !== false) {
      const text = spec.caption ?? el.getAttribute("aria-label");
      if (text) {
        const cap = node("figcaption", "auto");
        if (/<[a-z]/i.test(text)) cap.innerHTML = text; else cap.textContent = text;
        el.append(cap);
        d.nodes.push(cap);
      }
    }

    if (spec.drag || spec.orbit || spec.hover) addPointer(d);
    else d.canvas.addEventListener("pointerdown", () => { d.touched = true; }, { signal: d.abort.signal });
    addKeys(d);

    demos.push(d);
    byEl.set(el, d);
    visibility.observe(el);
    reveal?.observe(el);
    // Resize on the next frame, not inside the observer: changing the canvas
    // height there would re-trigger the observer and log a loop error.
    d.resizer = new ResizeObserver(() => { d.needsResize = true; });
    d.resizer.observe(stage);
    if (document.readyState !== "loading") queueMicrotask(() => enhance(document));
    return d.handle;
  }

  function destroy(d) {
    if (typeof d.spec.destroy === "function") guard(d, "destroy", () => d.spec.destroy(d.s, d.v, d.handle));
    d.el.dispatchEvent(new CustomEvent("safis:destroy", { detail: d.handle }));
    d.abort.abort();
    d.resizer?.disconnect();
    visibility.unobserve(d.el);
    for (const n of d.nodes) n.remove();
    for (const e of d.prose) delete e.__safis;
    d.el.classList.remove("is-live");
    const i = demos.indexOf(d);
    if (i >= 0) demos.splice(i, 1);
    if (byEl.get(d.el) === d) byEl.delete(d.el);
    d.broken = true;
  }

  // ---------- Controls ----------
  function buildControls(d) {
    const box = node("div", "controls");
    const on = (e, type, fn) => e.addEventListener(type, fn, { signal: d.abort.signal });
    let toggles = null;
    for (const c of d.spec.controls) {
      const type = typeOf(c);
      if (type === "button") continue;
      const color = cssColor(c.color ?? "ink");
      const label = c.label ?? c.key ?? (c.keys ?? []).join(", ");

      if (type === "pad") {
        const [kx, ky] = c.keys;
        d.v[kx] = c.value?.[0] ?? (c.x.min + c.x.max) / 2;
        d.v[ky] = c.value?.[1] ?? (c.y.min + c.y.max) / 2;
        let pad = null, dot = null, val = null;
        const sync = () => {
          if (!pad) return;
          const fx = (d.v[kx] - c.x.min) / (c.x.max - c.x.min), fy = (d.v[ky] - c.y.min) / (c.y.max - c.y.min);
          pad.style.setProperty("--x", `${fx * 100}%`);
          pad.style.setProperty("--y", `${(1 - fy) * 100}%`);
          pad.setAttribute("aria-valuetext", `${format(c, d.v[kx], 0)}, ${format(c, d.v[ky], 1)}`);
          val.textContent = `${format(c, d.v[kx], 0)}, ${format(c, d.v[ky], 1)}`;
        };
        d.inputs[kx] = { c, type, axis: 0, sync };
        d.inputs[ky] = { c, type, axis: 1, sync };
        if (c.hidden) continue;
        const row = node("div", "ctl");
        row.style.setProperty("--c", color);
        pad = node("div", "pad");
        dot = node("span", "dot");
        val = node("span", "val");
        pad.append(dot);
        pad.tabIndex = 0;
        pad.setAttribute("role", "slider");
        pad.setAttribute("aria-label", label);
        const fromPointer = e => {
          const r = pad.getBoundingClientRect();
          const fx = clamp((e.clientX - r.left) / r.width, 0, 1), fy = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
          userSet(d, kx, lerp(c.x.min, c.x.max, fx));
          userSet(d, ky, lerp(c.y.min, c.y.max, fy));
        };
        on(pad, "pointerdown", e => { try { pad.setPointerCapture(e.pointerId); } catch {} pad.dataset.down = "1"; fromPointer(e); e.preventDefault(); });
        on(pad, "pointermove", e => { if (pad.dataset.down) fromPointer(e); });
        for (const t of ["pointerup", "pointercancel"]) on(pad, t, () => { delete pad.dataset.down; });
        on(pad, "keydown", e => {
          const big = e.shiftKey ? 10 : 1;
          const dx = { ArrowLeft: -1, ArrowRight: 1 }[e.key] ?? 0, dy = { ArrowDown: -1, ArrowUp: 1 }[e.key] ?? 0;
          if (!dx && !dy) return;
          e.preventDefault();
          e.stopPropagation();
          if (dx) userSet(d, kx, d.v[kx] + dx * big * (c.x.step ?? (c.x.max - c.x.min) / 50));
          if (dy) userSet(d, ky, d.v[ky] + dy * big * (c.y.step ?? (c.y.max - c.y.min) / 50));
        });
        row.append(node("span", "name", label), pad, val);
        box.append(row);
        sync();
        continue;
      }

      d.v[c.key] = type === "toggle" ? !!c.value
        : type === "choice" ? (c.value ?? options(c)[0]?.value)
        : clamp(c.value ?? c.min, c.min, c.max);
      const entry = { c, type, sync: () => {} };
      d.inputs[c.key] = entry;
      if (c.hidden) continue;

      if (type === "toggle") {
        if (!toggles) { toggles = node("div", "toggles"); box.append(toggles); }
        const sw = node("label", "switch");
        sw.style.setProperty("--c", color);
        const input = node("input");
        input.type = "checkbox";
        input.setAttribute("role", "switch");
        sw.append(input, node("span", "track"), node("span", "label", label));
        on(input, "change", () => userSet(d, c.key, input.checked));
        entry.sync = () => { input.checked = d.v[c.key]; };
        toggles.append(sw);
        entry.sync();
        continue;
      }

      const row = node("div", "ctl");
      row.style.setProperty("--c", color);
      const name = node("span", "name", label);
      if (type === "choice") {
        row.classList.add("wide-widget");
        const seg = node("div", "segmented");
        seg.setAttribute("role", "group");
        seg.setAttribute("aria-label", label);
        const btns = options(c).map(o => {
          const b = node("button", null, o.label);
          b.type = "button";
          on(b, "click", () => userSet(d, c.key, o.value));
          seg.append(b);
          return [o.value, b];
        });
        entry.sync = () => { for (const [v, b] of btns) b.setAttribute("aria-pressed", String(v === d.v[c.key])); };
        row.append(name, seg);
      } else if (type === "stepper") {
        row.classList.add("wide-widget");
        const st = node("div", "stepper");
        const minus = node("button", null, "−"), plus = node("button", null, "+"), val = node("span", "val");
        minus.type = plus.type = "button";
        minus.setAttribute("aria-label", `Less ${label.toLowerCase()}`);
        plus.setAttribute("aria-label", `More ${label.toLowerCase()}`);
        const step = c.step ?? 1;
        on(minus, "click", () => userSet(d, c.key, d.v[c.key] - step));
        on(plus, "click", () => userSet(d, c.key, d.v[c.key] + step));
        st.append(minus, val, plus);
        entry.sync = () => {
          val.textContent = format(c, d.v[c.key]);
          minus.disabled = d.v[c.key] <= c.min;
          plus.disabled = d.v[c.key] >= c.max;
        };
        row.append(name, st);
      } else if (type === "knob") {
        const knob = node("div", "knob"), val = node("span", "val");
        knob.tabIndex = 0;
        knob.setAttribute("role", "slider");
        knob.setAttribute("aria-label", label);
        knob.setAttribute("aria-valuemin", c.min);
        knob.setAttribute("aria-valuemax", c.max);
        scrubbable(d, knob, c.key, { vertical: true });
        val.tabIndex = -1;
        scrubbable(d, val, c.key, { edit: true });
        entry.sync = () => {
          const f = (d.v[c.key] - c.min) / (c.max - c.min);
          knob.style.setProperty("--a", `${c.wrap ? f * 360 : -135 + f * 270}deg`);
          knob.setAttribute("aria-valuenow", d.v[c.key]);
          knob.setAttribute("aria-valuetext", format(c, d.v[c.key]));
          val.textContent = format(c, d.v[c.key]);
        };
        row.append(name, knob, val);
      } else {
        const wrap = node("div", "slider");
        const input = node("input");
        Object.assign(input, { type: "range", min: c.min, max: c.max, step: c.step ?? "any" });
        input.setAttribute("aria-label", label);
        wrap.append(input);
        const marks = (c.marks ?? []).map(m => (typeof m === "object" ? m : { value: m }));
        if (marks.length) {
          const mk = node("div", "marks");
          for (const m of marks) {
            const t = node("span", "mark", m.label ?? "");
            t.style.left = `${((m.value - c.min) / (c.max - c.min)) * 100}%`;
            mk.append(t);
          }
          wrap.append(mk);
          if (marks.some(m => m.label)) wrap.classList.add("has-labels");
        }
        const val = node("span", "val");
        val.tabIndex = -1;
        on(input, "input", () => {
          let x = input.valueAsNumber;
          // Snap to a labeled mark when the thumb lands within 2% of it.
          if (c.snapToMarks !== false && marks.length) {
            const near = marks.find(m => Math.abs(m.value - x) < (c.max - c.min) * 0.02);
            if (near) x = near.value;
          }
          userSet(d, c.key, x);
        });
        scrubbable(d, val, c.key, { edit: true });
        entry.sync = () => {
          const v = d.v[c.key];
          if (input.valueAsNumber !== v) input.value = v;
          input.style.setProperty("--p", `${((v - c.min) / (c.max - c.min)) * 100}%`);
          input.setAttribute("aria-valuetext", format(c, v));
          val.textContent = format(c, v);
        };
        row.append(name, wrap, val);
      }
      box.append(row);
      entry.sync();
    }
    return box;
  }

  // Drag a value sideways (or up/down) to change it; click to type one (edit: true).
  function scrubbable(d, el, key, o = {}) {
    const { c } = d.inputs[key];
    const on = (type, fn) => el.addEventListener(type, fn, { signal: d.abort.signal });
    let start = null;
    on("pointerdown", e => {
      if (el.isContentEditable || e.button > 0) return;
      start = { x: e.clientX, y: e.clientY, v: d.v[key], moved: false };
      try { el.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
    });
    on("pointermove", e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = start.y - e.clientY;
      const delta = o.vertical ? dx + dy : dx;
      if (!start.moved && Math.abs(delta) < 3) return;
      start.moved = true;
      el.classList.add("active");
      const span = (c.max - c.min) * (e.shiftKey ? 0.1 : 1);
      userSet(d, key, start.v + (delta / (c.scrubPx ?? 200)) * span);
    });
    const end = () => {
      if (!start) return;
      const tapped = !start.moved;
      start = null;
      el.classList.remove("active");
      if (tapped && o.edit) editValue(d, el, key);
    };
    on("pointerup", end);
    on("pointercancel", end);
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    on("keydown", e => {
      if (el.isContentEditable) return;
      const step = c.step ?? (c.max - c.min) / 100;
      const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (dir) { userSet(d, key, d.v[key] + dir * step * (e.shiftKey ? 10 : 1)); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === "Enter" && o.edit) { editValue(d, el, key); e.preventDefault(); }
    });
  }

  function editValue(d, el, key) {
    const { c } = d.inputs[key];
    const before = el.textContent;
    el.contentEditable = "true";
    el.textContent = String(+Number(d.v[key]).toFixed(Math.max(decimals(c.step), 2)));
    el.focus();
    getSelection()?.selectAllChildren(el);
    let done = false;
    const finish = commit => {
      if (done) return;
      done = true;
      el.contentEditable = "false";
      const x = parseFloat(el.textContent.replace("−", "-").replace(",", "."));
      if (commit && Number.isFinite(x)) userSet(d, key, x);
      else el.textContent = before;
      d.inputs[key].sync();
    };
    const keys = e => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); el.blur(); }
      else if (e.key === "Escape") { finish(false); el.blur(); }
      e.stopPropagation();
    };
    el.addEventListener("keydown", keys);
    el.addEventListener("blur", () => { el.removeEventListener("keydown", keys); finish(true); }, { once: true });
  }

  // A change made by the reader: stop any animated preset on that key, and note
  // that the figure has been touched (which stops the grab handles breathing).
  function userSet(d, key, value) {
    d.tweens.delete(key);
    d.touched = true;
    setControl(d, key, value);
  }

  function setControl(d, key, value) {
    const entry = d.inputs[key];
    if (!entry) throw new Error(`figure "${d.id}" has no control "${key}"`);
    const { c, type } = entry;
    let v;
    if (type === "toggle") v = typeof value === "string" ? value === "true" || value === "on" : !!value;
    else if (type === "choice") {
      const opts = options(c);
      const hit = opts.find(o => o.value === value) ?? opts.find(o => String(o.value) === String(value));
      if (!hit) return;
      v = hit.value;
    } else {
      const r = type === "pad" ? (entry.axis ? c.y : c.x) : c;
      let x = Number(value);
      if (!Number.isFinite(x)) return;
      x = c.wrap ? r.min + mod(x - r.min, r.max - r.min) : clamp(x, r.min, r.max);
      // Land on the control's step, so a slider with step 1 never hands draw() 6.33.
      const s = type === "stepper" ? r.step ?? 1 : r.step;
      if (typeof s === "number" && s > 0) x = clamp(+(r.min + Math.round((x - r.min) / s) * s).toFixed(decimals(s) + 3), r.min, r.max);
      v = x;
    }
    d.v[key] = v;
    entry.sync();
    syncProse(d, key);
    if (d.spec.change) guard(d, "change", () => d.spec.change(key, d.s, d.v, d.handle));
    d.dirty = true;
  }

  // Set several values at once; numbers glide there when animate is true.
  function applyValues(d, values, animate) {
    const now = performance.now();
    for (const [k, val] of Object.entries(values)) {
      const entry = d.inputs[k];
      if (!entry) throw new Error(`figure "${d.id}" has no control "${k}"`);
      const numeric = NUMERIC.has(entry.type) || entry.type === "pad";
      if (animate && numeric && !motionQuery.matches && Math.abs(Number(val) - d.v[k]) > 1e-9 && !entry.c.wrap) {
        d.tweens.set(k, { from: d.v[k], to: Number(val), t0: now, dur: 520 });
      } else {
        d.tweens.delete(k);
        setControl(d, k, val);
      }
    }
  }

  function runTweens(d, now) {
    for (const [k, t] of d.tweens) {
      const f = clamp((now - t.t0) / t.dur, 0, 1);
      setControl(d, k, f >= 1 ? t.to : lerp(t.from, t.to, ease(f)));
      if (f >= 1) d.tweens.delete(k);
    }
  }

  // ---------- Transport, buttons, presets, readout ----------
  const ICONS = {
    pause: '<svg class="i-pause" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3" width="3" height="10" rx="1"/><rect x="9.5" y="3" width="3" height="10" rx="1"/></svg>',
    play: '<svg class="i-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6c0 .5.5.8.9.5l7-4.8a.6.6 0 0 0 0-1L5.9 2.7c-.4-.3-.9 0-.9.5z"/></svg>',
    step: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.6v8.8c0 .5.5.7.9.5l6-4.4a.6.6 0 0 0 0-1l-6-4.4c-.4-.2-.9 0-.9.5z"/><rect x="11" y="3" width="2.4" height="10" rx="1"/></svg>',
    reset: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.4.5A4 4 0 1 0 8 4v2L4.8 3.3 8 .5z"/></svg>',
  };
  const SPEEDS = [0.25, 0.5, 1, 2];

  function buildFoot(d) {
    const { spec } = d;
    const foot = node("div", "foot");
    const on = (e, type, fn) => e.addEventListener(type, fn, { signal: d.abort.signal });
    const t = spec.transport ?? {};
    const transport = node("div", "transport");
    const iconBtn = (html, label, fn) => {
      const b = node("button", "icon-btn");
      b.type = "button";
      b.innerHTML = html;
      b.setAttribute("aria-label", label);
      on(b, "click", fn);
      transport.append(b);
      return b;
    };
    if (spec.step && spec.playButton !== false && t !== false) {
      d.playBtn = iconBtn(ICONS.pause + ICONS.play, "Pause animation", () => { d.playing = !d.playing; d.touched = true; syncPlay(d); });
      d.playing = spec.autoplay !== false && !motionQuery.matches;
      syncPlay(d);
      if (t.step !== false) {
        iconBtn(ICONS.step, "Step forward", () => {
          d.playing = false;
          syncPlay(d);
          runSteps(d, spec.stepFrames ?? 6, d.speed);
          d.dirty = true;
        });
      }
      if (t.speed !== false) {
        const sp = node("button", "speed", "1×");
        sp.type = "button";
        const label = () => { const t = `${d.speed === 0.25 ? "¼" : d.speed === 0.5 ? "½" : d.speed}×`; sp.textContent = t; sp.setAttribute("aria-label", `Speed ${t}`); };
        label();
        on(sp, "click", () => { d.speed = SPEEDS[(SPEEDS.indexOf(d.speed) + 1) % SPEEDS.length]; label(); });
        transport.append(sp);
      }
    }
    if (spec.reset && typeof spec.state === "function") {
      iconBtn(ICONS.reset, "Reset", () => d.handle.reset());
    }
    if (transport.children.length) foot.append(transport);

    const buttons = node("div", "buttons");
    for (const c of spec.controls ?? []) {
      if (c.type !== "button" || c.hidden) continue;
      const b = node("button", c.primary ? "btn primary" : "btn", c.label);
      b.type = "button";
      if (c.color) b.style.setProperty("--c", cssColor(c.color));
      on(b, "click", () => { d.touched = true; pressButton(d, c); });
      buttons.append(b);
      // c.text(s, v) relabels the button as the state changes ("Play" / "Stop"); c.pressed(s, v)
      // marks it on. c.label stays its name for presets ({ press }) and the checker.
      if (c.text || c.pressed) (d.liveButtons ??= []).push([c, b]);
    }
    if (buttons.children.length) foot.append(buttons);

    if (spec.presets?.length) {
      const box = node("div", "presets");
      if (spec.presetsLabel !== "") box.append(node("span", "try", spec.presetsLabel ?? "Try"));
      d.presetBtns = spec.presets.map(p => {
        const b = node("button", "preset", p.label);
        b.type = "button";
        on(b, "click", () => { d.touched = true; applyPreset(d, p, true); });
        box.append(b);
        return [p, b];
      });
      foot.append(box);
    }
    if (spec.status) {
      d.statusEl = node("span", "status");
      foot.append(d.statusEl);
    }
    return foot;
  }

  function pressButton(d, c) {
    if (guard(d, "action", () => c.action?.(d.s, d.v, d.handle))) d.dirty = true;
  }

  function applyPreset(d, p, animate) {
    if (p.set) applyValues(d, p.set, animate);
    if (p.press) { const c = (d.spec.controls ?? []).find(x => x.type === "button" && x.label === p.press); if (c) pressButton(d, c); }
    if (p.play != null) d.handle.play(p.play);
  }

  function syncButtons(d) {
    for (const [c, b] of d.liveButtons ?? []) {
      let t = c.label, on = false;
      if (c.text && guard(d, "button text", () => { t = String(c.text(d.s, d.v) ?? c.label); }) && b.textContent !== t) b.textContent = t;
      if (c.pressed && guard(d, "button pressed", () => { on = !!c.pressed(d.s, d.v); }) && b.getAttribute("aria-pressed") !== String(on)) b.setAttribute("aria-pressed", String(on));
    }
  }

  function syncPresets(d) {
    if (!d.presetBtns) return;
    for (const [p, b] of d.presetBtns) {
      const on = !!p.set && Object.entries(p.set).every(([k, v]) => {
        const target = d.tweens.get(k)?.to ?? d.v[k];
        return typeof v === "number" ? Math.abs(target - v) < 1e-6 : target === v;
      });
      b.setAttribute("aria-pressed", String(on));
    }
  }

  function buildHints(d) {
    const { spec } = d;
    let hints = spec.hints;
    if (hints === undefined) {
      hints = [];
      const nums = numericControls(d);
      if (spec.orbit && spec.drag) hints.push(["Drag", "move or turn"]);
      else if (spec.orbit) hints.push(["Drag", "turn"]);
      else if (spec.drag) hints.push(["Drag", "move"]);
      if (nums[0]) hints.push(["← →", String(nums[0].label ?? nums[0].key).toLowerCase()]);
      if (nums[1]) hints.push(["↑ ↓", String(nums[1].label ?? nums[1].key).toLowerCase()]);
      if (spec.step && spec.playButton !== false) hints.push(["Space", "pause"]);
    }
    for (const [keys, what] of hints || []) {
      const row = node("span", "hint");
      for (const k of String(keys).split(" ")) row.append(node("kbd", null, k));
      row.append(document.createTextNode(what));
      d.side.append(row);
    }
  }

  function syncPlay(d) {
    if (!d.playBtn) return;
    d.playBtn.dataset.state = d.playing ? "playing" : "paused";
    d.playBtn.setAttribute("aria-label", d.playing ? "Pause animation" : "Play animation");
  }

  const numericControls = d => (d.spec.controls ?? []).filter(c => NUMERIC.has(typeOf(c)) && !c.hidden);

  function addKeys(d) {
    d.stage.addEventListener("keydown", e => {
      if (d.broken) return;
      const nums = numericControls(d);
      const nudge = (c, dir) => {
        const step = c.step ?? (c.max - c.min) / 100;
        userSet(d, c.key, d.v[c.key] + dir * step * (e.shiftKey ? 10 : 1));
      };
      let used = true;
      if (e.key === " " && d.spec.step && d.spec.playButton !== false) { d.playing = !d.playing; syncPlay(d); }
      else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && nums[0]) nudge(nums[0], e.key === "ArrowRight" ? 1 : -1);
      else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && nums[1]) nudge(nums[1], e.key === "ArrowUp" ? 1 : -1);
      else if (e.key.startsWith("Arrow") && d.spec.orbit) {
        const v = d.s.view;
        if (e.key === "ArrowLeft") v.yaw -= 0.08; else if (e.key === "ArrowRight") v.yaw += 0.08;
        else if (e.key === "ArrowUp") v.pitch = clampPitch(d, v.pitch + 0.06); else v.pitch = clampPitch(d, v.pitch - 0.06);
        d.dirty = true;
      } else used = false;
      if (used) e.preventDefault();
    }, { signal: d.abort.signal });
  }

  const clampPitch = (d, p) => clamp(p, d.spec.orbit?.minPitch ?? -1.45, d.spec.orbit?.maxPitch ?? 1.45);
  const clampYaw = (d, y) => clamp(y, d.spec.orbit?.minYaw ?? -Infinity, d.spec.orbit?.maxYaw ?? Infinity);

  function addPointer(d) {
    const { canvas, spec } = d;
    const on = (type, fn) => canvas.addEventListener(type, fn, { signal: d.abort.signal });
    if (spec.drag || spec.orbit) canvas.classList.add("draggable");
    let mode = null, last = null, lastT = 0, vel = [0, 0];
    const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const hits = p => {
      if (!spec.drag) return false;
      if (!spec.drag.hit) return true;
      let hit = false;
      guard(d, "drag.hit", () => { hit = !!spec.drag.hit(p, d.s, d.v, d.handle); });
      return hit;
    };
    on("pointerdown", e => {
      if (d.broken || e.button > 0) return;
      d.touched = true;
      const p = pos(e);
      if (hits(p)) mode = "drag";
      else if (spec.orbit) mode = "orbit";
      else return;
      d.dragging = mode === "drag";
      d.orbiting = mode === "orbit";
      d.spin = null;
      last = p;
      lastT = performance.now();
      vel = [0, 0];
      if (mode === "drag") guard(d, "drag.start", () => spec.drag.start?.(p, d.s, d.v, d.handle));
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      canvas.classList.add("grabbing");
      e.preventDefault();
    });
    on("pointermove", e => {
      const p = pos(e);
      if (!mode) {
        if (e.pointerType === "mouse") canvas.style.cursor = hits(p) ? "grab" : spec.orbit ? "grab" : "";
        if (spec.hover) {
          let changed = false;
          guard(d, "hover", () => { changed = spec.hover(p, d.s, d.v, d.handle); });
          if (changed) d.dirty = true;
        }
        return;
      }
      const now = performance.now(), dtm = Math.max(1, now - lastT);
      const delta = [p[0] - last[0], p[1] - last[1]];
      vel = [lerp(vel[0], delta[0] / dtm, 0.5), lerp(vel[1], delta[1] / dtm, 0.5)];
      last = p;
      lastT = now;
      if (mode === "drag") guard(d, "drag.move", () => spec.drag.move?.(p, d.s, d.v, delta, d.handle));
      else {
        const view = d.s.view;
        const k = d.spec.orbit?.speed ?? 0.01;
        view.yaw = clampYaw(d, view.yaw + delta[0] * k);
        view.pitch = clampPitch(d, view.pitch + delta[1] * k);
      }
      d.dirty = true;
    });
    const end = () => {
      if (!mode) return;
      if (mode === "drag") guard(d, "drag.end", () => spec.drag.end?.(d.s, d.v, d.handle));
      if (mode === "orbit" && !motionQuery.matches && performance.now() - lastT < 80 && Math.hypot(vel[0], vel[1]) > 0.08) d.spin = vel.slice();
      mode = null;
      d.dragging = d.orbiting = false;
      canvas.classList.remove("grabbing");
      d.dirty = true;
    };
    on("pointerup", end);
    on("pointercancel", end);
    on("pointerleave", () => {
      if (spec.hover && !mode) {
        let changed = false;
        guard(d, "hover", () => { changed = spec.hover(null, d.s, d.v, d.handle); });
        if (changed) d.dirty = true;
      }
    });
  }

  // ---------- Prose that talks to figures ----------
  // <span class="scrub" data-key="swing"></span>   a number in the text the reader drags
  // <button class="set" data-set="swing=45">…</button>   a "try this" link that sets values
  // <span class="c-green" data-part="condyle">condyle</span>   a term that lights its part
  // data-figure="<id>" names the figure; without it, the next figure on the page is used.
  function figureFor(e) {
    const id = e.dataset.figure;
    if (id) return demos.find(d => d.id === id) ?? null;
    const own = e.closest("figure.demo");
    if (own) return byEl.get(own) ?? null;
    let after = null, before = null;
    for (const f of document.querySelectorAll("figure.demo")) {
      if (e.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING) { after = f; break; }
      before = f;
    }
    const f = after ?? before;
    return f ? byEl.get(f) ?? null : null;
  }

  const parseSet = str => Object.fromEntries(String(str).split(/[;,]\s*|\s+(?=[\w-]+=)/).filter(Boolean).map(pair => {
    const [k, ...rest] = pair.split("=");
    const raw = rest.join("=").trim();
    const val = raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
    return [k.trim(), val];
  }));

  function enhance(root = document) {
    for (const e of root.querySelectorAll(".scrub, .set, [data-part]")) {
      if (e.__safis) continue;
      const d = figureFor(e);
      if (!d || d.broken) continue;
      const on = (type, fn) => e.addEventListener(type, fn, { signal: d.abort.signal });
      if (e.classList.contains("scrub")) {
        const key = e.dataset.key, entry = d.inputs[key];
        if (!entry || !NUMERIC.has(entry.type)) { errors.push({ demo: d.id, phase: "prose", message: `a .scrub names control "${key}", which isn't a number control of #${d.id}` }); continue; }
        e.style.setProperty("--c", cssColor(entry.c.color ?? "brass"));
        e.setAttribute("role", "slider");
        e.setAttribute("aria-label", entry.c.label ?? key);
        e.setAttribute("aria-valuemin", entry.c.min);
        e.setAttribute("aria-valuemax", entry.c.max);
        scrubbable(d, e, key);
      } else if (e.classList.contains("set")) {
        let values;
        try { values = parseSet(e.dataset.set ?? ""); } catch { values = {}; }
        const first = d.inputs[Object.keys(values)[0]];
        if (first?.c.color && !e.style.getPropertyValue("--c")) e.style.setProperty("--c", cssColor(first.c.color));
        if (e.tagName !== "BUTTON" && !e.hasAttribute("tabindex")) { e.tabIndex = 0; e.setAttribute("role", "button"); }
        const go = () => {
          d.touched = true;
          applyPreset(d, { set: values, press: e.dataset.press, play: e.dataset.play != null ? e.dataset.play !== "false" : undefined }, true);
          d.el.scrollIntoView?.({ block: "nearest", behavior: motionQuery.matches ? "auto" : "smooth" });
        };
        on("click", go);
        on("keydown", ev => { if ((ev.key === "Enter" || ev.key === " ") && e.tagName !== "BUTTON") { ev.preventDefault(); go(); } });
      } else {
        const part = e.dataset.part;
        if (!e.hasAttribute("tabindex")) e.tabIndex = 0;
        e.setAttribute("role", "button");
        e.setAttribute("aria-pressed", "false");
        let pinned = false;
        on("pointerenter", ev => { if (ev.pointerType === "mouse") setHighlight(d, part); });
        on("pointerleave", ev => { if (ev.pointerType === "mouse" && !pinned && d.highlight === part) setHighlight(d, null); });
        const toggle = () => { pinned = d.highlight !== part || !pinned; setHighlight(d, pinned ? part : null); };
        on("click", toggle);
        on("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); } });
        on("blur", () => { if (!pinned && d.highlight === part) setHighlight(d, null); });
      }
      e.__safis = d;
      d.prose.push(e);
    }
    for (const d of demos) for (const k of Object.keys(d.inputs)) syncProse(d, k);
  }

  function syncProse(d, key) {
    for (const e of d.prose) {
      if (e.classList.contains("scrub") && e.dataset.key === key) {
        e.textContent = format(d.inputs[key].c, d.v[key]);
        e.setAttribute("aria-valuenow", d.v[key]);
        e.setAttribute("aria-valuetext", e.textContent);
      }
    }
    syncPresets(d);
    syncButtons(d);
  }

  function setHighlight(d, name) {
    if (d.highlight === name) return;
    d.highlight = name ?? null;
    for (const e of d.prose) if (e.dataset.part) {
      const lit = e.dataset.part === d.highlight;
      e.classList.toggle("lit", lit);
      e.setAttribute("aria-pressed", String(lit));
    }
    if (d.spec.highlight) guard(d, "highlight", () => d.spec.highlight(d.highlight, d.s, d.v, d.handle));
    d.dirty = true;
  }

  // ---------- Drawing loop ----------
  function resize(d) {
    const w = Math.round(d.canvas.parentElement.clientWidth);
    if (!w || d.broken) return;
    let aspect = 1.6;
    if (!guard(d, "aspect", () => {
      aspect = typeof d.spec.aspect === "function" ? d.spec.aspect(w) : d.spec.aspect ?? 1.6;
    })) return;
    const h = Math.round(w / aspect);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (w === d.w && h === d.h && dpr === d.dpr) return;
    Object.assign(d, { w, h, dpr });
    d.canvas.style.height = `${h}px`;
    d.canvas.width = Math.round(w * dpr);
    d.canvas.height = Math.round(h * dpr);
    render(d);
  }

  function render(d) {
    d.dirty = false;
    if (d.broken || !d.w) return;
    const ctx = d.ctx;
    if (ctx.reset) ctx.reset();
    // Paint the background instead of clearing: some Chrome builds don't reliably
    // clear a canvas that receives WebGL frames, which leaves ghost images behind.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "copy";
    ctx.fillStyle = color(d.spec.background ?? "panel");
    ctx.fillRect(0, 0, d.canvas.width, d.canvas.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.setTransform(d.dpr, 0, 0, d.dpr, 0, 0);
    const interacting = !!(d.orbiting || d.dragging || d.spin || d.tweens.size || (d.playing && d.spec.step));
    Object.assign(d.g, { w: d.w, h: d.h, dpr: d.dpr, time: performance.now() / 1000, touched: d.touched, highlight: d.highlight, interacting, wantsFrame: false });
    guard(d, "draw", () => d.spec.draw(d.g, d.s, d.v, d.handle));
    d.pulse = d.g.wantsFrame;
    if (d.statusEl && !d.broken) guard(d, "status", () => { d.statusEl.textContent = d.spec.status(d.s, d.v, d.handle) ?? ""; });
  }

  const visibility = new IntersectionObserver(entries => {
    for (const e of entries) {
      const d = byEl.get(e.target);
      if (d && d.visible !== e.isIntersecting) {
        d.visible = e.isIntersecting;
        d.el.dispatchEvent(new CustomEvent("safis:visibility", { detail: { visible: d.visible, handle: d.handle } }));
      }
    }
  }, { rootMargin: "200px 0px" });

  // Figures settle in the first time they scroll into view (theme.css, .safis-reveal).
  // Apps that host figures (window.__safisHost) keep their own motion.
  const reveal = window.__safisHost ? null : new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); reveal.unobserve(e.target); }
  }, { threshold: 0.12 });
  if (reveal) document.documentElement.classList.add("safis-reveal");
  // The checker and screenshot tools drive the page; show every figure at rest for them.
  const checking = () => document.documentElement.classList.add("safis-checking");

  let lastTime = performance.now();
  function frame(now) {
    const dt = clamp((now - lastTime) / 1000, 0, 1 / 30);
    lastTime = now;
    for (const d of demos) {
      if (d.needsResize) { d.needsResize = false; resize(d); }
      if (d.tweens.size && !d.broken) runTweens(d, now);
      if (d.spin && !d.broken && d.s.view) {
        const view = d.s.view, k = Math.exp(-dt / 0.35);
        const turn = d.spec.orbit?.speed ?? 0.01;
        view.yaw = clampYaw(d, view.yaw + d.spin[0] * dt * 1000 * turn);
        view.pitch = clampPitch(d, view.pitch + d.spin[1] * dt * 1000 * turn);
        d.spin = [d.spin[0] * k, d.spin[1] * k];
        if (Math.hypot(d.spin[0], d.spin[1]) < 0.004) d.spin = null;
        d.dirty = true;
      }
      if (d.spec.step && d.playing && d.visible && !d.dragging && !d.broken) {
        if (guard(d, "step", () => d.spec.step(dt * d.speed, d.s, d.v, d.handle))) d.dirty = true;
      }
      if (d.pulse && d.visible) d.dirty = true;
      if (d.dirty && (d.visible || !d.w)) render(d);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const refreshTheme = () => { readTheme(); for (const d of demos) d.dirty = true; };
  darkQuery.addEventListener("change", refreshTheme);
  new MutationObserver(refreshTheme).observe(root, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  document.fonts?.ready.then(refreshTheme);
  document.fonts?.addEventListener?.("loadingdone", refreshTheme);
  addEventListener("resize", () => { for (const d of demos) resize(d); });
  addEventListener("error", e => errors.push({ demo: null, phase: "page", message: e.message }));
  addEventListener("unhandledrejection", e => errors.push({ demo: null, phase: "page", message: String(e.reason) }));

  // Reading time and figure count in the kicker, once the article is in.
  function addMeta() {
    const kicker = document.querySelector("header .kicker");
    const article = document.querySelector("article");
    if (!kicker || !article || kicker.querySelector(".meta")) return;
    const words = (article.innerText || article.textContent || "").split(/\s+/).filter(Boolean).length;
    const figs = article.querySelectorAll("figure.demo").length;
    const meta = node("span", "meta", `${Math.max(1, Math.round(words / 230))} min read${figs ? ` · ${figs} figure${figs === 1 ? "" : "s"}` : ""}`);
    kicker.append(meta);
  }
  function addSkipLink() {
    if (window.__safisHost) return; // inside an app, the host owns page chrome
    const main = document.querySelector("main");
    if (!main || document.querySelector(".skip") || !document.querySelector(".toc a")) return;
    if (!main.id) main.id = "content";
    const a = node("a", "skip", "Skip to the article");
    a.href = `#${main.id}`;
    document.body.prepend(a);
  }
  const THEME_ICONS = {
    auto: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z"/></svg>',
    light: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    dark: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1z"/></svg>',
  };
  function syncThemeButton(b) {
    const mode = savedTheme();
    b.innerHTML = THEME_ICONS[mode];
    b.setAttribute("aria-label", `Theme: ${mode === "auto" ? "match system" : mode}`);
    b.title = b.getAttribute("aria-label");
  }
  // A light / dark / system switch in the page corner (pages only; framework hosts call Safis.setTheme).
  function addThemeToggle() {
    if (window.__safisHost) return; // inside an app, the host owns page chrome
    if (!document.querySelector("main") || document.querySelector(".theme-toggle")) return;
    const b = node("button", "theme-toggle");
    b.type = "button";
    b.addEventListener("click", () => {
      const order = ["auto", "light", "dark"];
      setTheme(order[(order.indexOf(savedTheme()) + 1) % order.length]);
    });
    syncThemeButton(b);
    document.body.append(b);
  }
  // The site index in the sidebar: a button hides it on wide screens (remembered, and
  // applied before the page paints) and opens it as a drawer on narrow ones.
  const TOC_KEY = "safis-toc";
  try { if (!window.__safisHost && localStorage.getItem(TOC_KEY) === "hidden") root.classList.add("safis-toc-hidden"); } catch {}
  function addIndexToggle() {
    if (window.__safisHost || !document.querySelector(".page.has-toc .toc") || document.querySelector(".toc-toggle")) return;
    const wide = matchMedia("(min-width: 1240px)");
    const b = node("button", "toc-toggle");
    b.type = "button";
    b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.25 3v10" stroke="currentColor" stroke-width="1.5"/></svg>';
    const open = () => (wide.matches ? !root.classList.contains("safis-toc-hidden") : root.classList.contains("safis-toc-open"));
    const sync = () => {
      const label = open() ? "Hide the index" : "Show the index";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.setAttribute("aria-expanded", String(open()));
    };
    const close = () => { root.classList.remove("safis-toc-open"); sync(); };
    b.addEventListener("click", () => {
      if (wide.matches) {
        const hidden = root.classList.toggle("safis-toc-hidden");
        try { if (hidden) localStorage.setItem(TOC_KEY, "hidden"); else localStorage.removeItem(TOC_KEY); } catch {}
      } else root.classList.toggle("safis-toc-open");
      sync();
    });
    document.addEventListener("click", e => { if (root.classList.contains("safis-toc-open") && !e.target.closest(".toc, .toc-toggle")) close(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && root.classList.contains("safis-toc-open")) { close(); b.focus(); } });
    wide.addEventListener("change", close);
    sync();
    document.body.append(b);
  }
  // ---------- Article furniture (styles in src/article.css, reference in references/article.md) ----------
  const slug = t => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "section";
  let tipEl = null, tipFor = null;
  function showTip(target, html) {
    if (!tipEl) { tipEl = node("div", "tip"); tipEl.id = "safis-tip"; tipEl.setAttribute("role", "tooltip"); document.body.append(tipEl); }
    tipEl.innerHTML = html;
    tipFor = target;
    target.setAttribute("aria-describedby", tipEl.id);
    const r = target.getBoundingClientRect(), w = Math.min(352, innerWidth - 32);
    tipEl.style.width = "max-content";
    tipEl.style.maxWidth = `${w}px`;
    const tw = Math.min(tipEl.offsetWidth, w), th = tipEl.offsetHeight;
    const x = clamp(r.left + r.width / 2 - tw / 2, 16, innerWidth - 16 - tw);
    const below = r.bottom + 10 + th < innerHeight;
    tipEl.style.left = `${x + scrollX}px`;
    tipEl.style.top = `${(below ? r.bottom + 10 : r.top - 10 - th) + scrollY}px`;
    tipEl.classList.add("show");
  }
  function hideTip(target) {
    if (!tipEl || (target && tipFor !== target)) return;
    tipEl.classList.remove("show");
    tipFor?.removeAttribute("aria-describedby");
    tipFor = null;
  }
  function tipOn(el, html) {
    if (el.tagName !== "A" && el.tagName !== "BUTTON" && !el.hasAttribute("tabindex")) el.tabIndex = 0;
    el.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") showTip(el, html()); });
    el.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") hideTip(el); });
    el.addEventListener("focus", () => showTip(el, html()));
    el.addEventListener("blur", () => hideTip(el));
    el.addEventListener("keydown", e => { if (e.key === "Escape") hideTip(el); });
  }
  addEventListener("pointerdown", e => { if (tipFor && !tipFor.contains(e.target)) hideTip(); });

  const KEYWORDS = /^(?:const|let|var|function|return|if|else|for|while|do|break|continue|new|class|extends|import|from|export|default|async|await|yield|try|catch|finally|throw|of|in|typeof|instanceof|def|lambda|pass|elif|and|or|not|is|None|True|False|null|undefined|true|false|this|self|struct|fn|pub|impl|use|mut|match|int|float|double|void|char|bool|static|public|private)$/;
  function highlight(code) {
    const text = code.textContent, out = [];
    const re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
    const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    let last = 0, m;
    const py = /python|py\b/.test(code.className);
    while ((m = re.exec(text))) {
      out.push(esc(text.slice(last, m.index)));
      const [t, com, str, num, fn, word] = m;
      if (com && (py || !com.startsWith("#"))) out.push(`<span class="tok-c">${esc(t)}</span>`);
      else if (com) out.push(esc(t));
      else if (str) out.push(`<span class="tok-s">${esc(t)}</span>`);
      else if (num) out.push(`<span class="tok-n">${t}</span>`);
      else if (fn) out.push(KEYWORDS.test(fn) ? `<span class="tok-k">${fn}</span>` : `<span class="tok-f">${fn}</span>`);
      else out.push(KEYWORDS.test(word) ? `<span class="tok-k">${word}</span>` : esc(word));
      last = re.lastIndex;
    }
    out.push(esc(text.slice(last)));
    code.innerHTML = out.join("");
  }

  function enhanceArticle() {
    const article = document.querySelector("article");
    if (!article || article.dataset.enhanced) return;
    article.dataset.enhanced = "1";
    // Section anchors
    const used = new Set();
    for (const h of article.querySelectorAll("h2, h3")) {
      if (!h.id) { let id = slug(h.textContent), k = 2; while (used.has(id) || document.getElementById(id)) id = `${slug(h.textContent)}-${k++}`; h.id = id; }
      used.add(h.id);
      const a = node("a", "anchor", "#");
      a.href = `#${h.id}`;
      a.setAttribute("aria-label", `Link to “${h.textContent.trim()}”`);
      h.append(a);
    }
    // Contents for long articles
    const sections = [...article.querySelectorAll("h2:not(.plain)")];
    if (sections.length >= 5 && !document.querySelector(".contents")) {
      const nav = node("details", "contents");
      nav.open = innerWidth >= 700;
      nav.append(node("summary", null, "Contents"));
      const ol = node("ol");
      for (const h of sections) { const li = node("li"), a = node("a", null, h.firstChild?.textContent?.trim() || h.textContent); a.href = `#${h.id}`; li.append(a); ol.append(li); }
      nav.append(ol);
      const abstract = article.querySelector(".abstract");
      if (abstract) abstract.after(nav); else article.prepend(nav);
    }
    // Sidenotes and margin notes
    let n = 0;
    for (const sn of article.querySelectorAll(".sidenote, .marginnote")) {
      const numbered = sn.classList.contains("sidenote");
      sn.id ||= `note-${numbered ? ++n : `m${n}-${Math.random().toString(36).slice(2, 6)}`}`;
      if (numbered) sn.dataset.n = n;
      const b = node("button", "sn-ref", numbered ? String(n) : "⊕");
      b.type = "button";
      b.setAttribute("aria-expanded", "false");
      b.setAttribute("aria-controls", sn.id);
      b.setAttribute("aria-label", numbered ? `Note ${n}` : "Margin note");
      b.addEventListener("click", () => { const open = sn.classList.toggle("open"); b.setAttribute("aria-expanded", String(open)); });
      sn.before(b);
    }
    // Numbered citations with a preview of the reference
    const refs = [...article.querySelectorAll(".references > li[id]")];
    const index = new Map(refs.map((li, i) => [li.id, i + 1]));
    for (const c of article.querySelectorAll("a.cite")) {
      const id = (c.getAttribute("href") || "").slice(1), k = index.get(id);
      if (!k) { errors.push({ demo: null, phase: "article", message: `citation ${c.getAttribute("href")} has no matching .references item` }); continue; }
      if (!c.textContent.trim()) c.textContent = `[${k}]`;
      c.setAttribute("aria-label", `Reference ${k}`);
      tipOn(c, () => `<b>[${k}]</b> ${document.getElementById(id).innerHTML}`);
    }
    // Defined terms
    for (const t of article.querySelectorAll("dfn[data-def], .term[data-def]")) tipOn(t, () => `<b>${t.textContent}</b>: ${t.dataset.def}`);
    // Figure references: <a class="figref" href="#id"></a> becomes "Figure 4"
    const figs = [...article.querySelectorAll("figure.demo")];
    for (const a of article.querySelectorAll("a.figref")) {
      const k = figs.findIndex(f => `#${f.id}` === a.getAttribute("href")) + 1;
      if (!k) { errors.push({ demo: null, phase: "article", message: `figure reference ${a.getAttribute("href")} names no figure` }); continue; }
      if (!a.textContent.trim()) a.textContent = `Figure ${k}`;
    }
    // Predictions
    for (const q of article.querySelectorAll(".quiz")) {
      const buttons = [...q.querySelectorAll("button")];
      for (const b of buttons) {
        b.type = "button";
        b.addEventListener("click", () => {
          q.classList.add("answered");
          for (const x of buttons) x.classList.remove("right", "wrong");
          b.classList.add(b.hasAttribute("data-correct") ? "right" : "wrong");
          if (!b.hasAttribute("data-correct")) buttons.find(x => x.hasAttribute("data-correct"))?.classList.add("right");
          for (const x of buttons) x.setAttribute("aria-pressed", String(x === b));
        });
      }
      q.querySelector(".why")?.setAttribute("aria-live", "polite");
    }
    // Tables scroll on their own on phones
    for (const t of article.querySelectorAll("table")) if (!t.parentElement.classList.contains("table-wrap")) { const w = node("div", "table-wrap"); t.before(w); w.append(t); }
    // Code
    for (const c of article.querySelectorAll('pre code[class*="language-"]')) highlight(c);
    // Blocks from scripts/render.mjs get a copy button.
    for (const b of article.querySelectorAll(".code-block")) {
      if (b.querySelector(".code-copy")) continue;
      const btn = node("button", "code-copy", "Copy");
      btn.type = "button";
      btn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(b.querySelector("code")?.innerText ?? ""); btn.textContent = "Copied"; }
        catch { btn.textContent = "Select to copy"; }
        btn.classList.add("done");
        setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1400);
      });
      b.append(btn);
    }
    // Reading progress for long pieces
    if (sections.length >= 4) {
      const bar = node("div", "progress");
      bar.setAttribute("aria-hidden", "true");
      document.body.append(bar);
      const update = () => {
        const r = article.getBoundingClientRect();
        root.style.setProperty("--read", clamp(-r.top / Math.max(1, r.height - innerHeight), 0, 1).toFixed(4));
      };
      addEventListener("scroll", update, { passive: true });
      update();
    }
  }

  const ready = () => { enhanceArticle(); enhance(document); addMeta(); addSkipLink(); addThemeToggle(); addIndexToggle(); };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", ready); else queueMicrotask(ready);

  // ---------- Self-check (used by scripts/verify.mjs, or open the page with ?check) ----------
  function snapshot(d) {
    render(d);
    const data = new Uint32Array(d.ctx.getImageData(0, 0, d.canvas.width, d.canvas.height).data.buffer);
    let hash = 2166136261, varied = false;
    const first = data[0];
    for (let i = 0; i < data.length; i++) {
      hash = Math.imul(hash ^ data[i], 16777619);
      if (data[i] !== first) varied = true;
    }
    return { hash: hash >>> 0, varied };
  }

  function saveState(d) { return { s: clone(d.s), v: { ...d.v } }; }
  function restoreState(d, saved) {
    for (const k of Object.keys(d.s)) delete d.s[k];
    Object.assign(d.s, clone(saved.s));
    d.tweens.clear();
    for (const [k, val] of Object.entries(saved.v)) { d.v[k] = val; d.inputs[k]?.sync(); syncProse(d, k); }
    d.dirty = true;
  }
  function runSteps(d, n, speed = 1) {
    for (let i = 0; i < n && !d.broken; i++) guard(d, "step", () => d.spec.step(speed / 60, d.s, d.v, d.handle));
  }
  function probe(d, key, value, saved) {
    restoreState(d, saved);
    setControl(d, key, value);
    if (d.spec.step) runSteps(d, 20);
    return snapshot(d).hash;
  }

  // The values each control is tried at by the self-check, as [key, values] pairs.
  function probeValues(c) {
    const type = typeOf(c);
    if (type === "button") return [];
    if (type === "toggle") return [[c.key, [false, true]]];
    if (type === "choice") return [[c.key, options(c).map(o => o.value)]];
    if (type === "pad") return [[c.keys[0], [c.x.min, (c.x.min + c.x.max) / 2, c.x.max]], [c.keys[1], [c.y.min, (c.y.min + c.y.max) / 2, c.y.max]]];
    return [[c.key, [c.min, (c.min + c.max) / 2, c.max]]];
  }

  function checkDemo(d) {
    const { spec } = d;
    const r = { id: d.id, summary: "", errors: [], warnings: [] };
    const own = () => errors.filter(e => e.demo === d.id).map(e => `${e.phase}() threw: ${e.message}`);
    if (!d.el.getAttribute("aria-label")) r.warnings.push("the <figure> has no aria-label describing what it shows");
    d.touched = true; // grab handles stop breathing, so snapshots are stable
    resize(d);
    const n = (spec.controls ?? []).length;
    r.summary = `${d.w}x${d.h}, ${n} control${n === 1 ? "" : "s"}` + (spec.presets?.length ? `, ${spec.presets.length} presets` : "") +
      (spec.step ? ", animated" : "") + (spec.drag ? ", draggable" : "") + (spec.orbit ? ", orbit" : "") + (spec.hover ? ", hover" : "");
    if (!d.w || !d.h) { r.errors.push("canvas has zero size"); return r; }
    if (!d.broken) {
      const base = snapshot(d);
      if (!d.broken && !base.varied) r.errors.push("canvas is blank after draw()");
    }
    if (!d.broken) {
      const saved = saveState(d);
      // Probe from a fresh state when there is one, so an animation that has
      // already finished (a ball that landed) doesn't look broken.
      const fresh = typeof spec.state === "function"
        ? { s: Object.assign(initialState(spec), d.s.view ? { view: clone(d.s.view) } : {}), v: saved.v }
        : saved;
      for (const c of spec.controls ?? []) {
        for (const [key, values] of probeValues(c)) {
          if (d.broken) break;
          const hashes = new Set(values.map(x => probe(d, key, x, fresh)));
          if (!d.broken && hashes.size === 1) r.warnings.push(`moving "${c.label ?? key}" across its range doesn't change the figure`);
        }
      }
      for (const p of spec.presets ?? []) {
        if (d.broken) break;
        restoreState(d, fresh);
        try { applyPreset(d, p, false); } catch (e) { r.errors.push(`preset "${p.label}": ${e.message}`); }
      }
      // A figure with autoplay: false only moves when the reader starts it (a button), so idling is fine.
      if (spec.step && spec.autoplay !== false && !d.broken) {
        restoreState(d, fresh);
        const before = snapshot(d).hash;
        runSteps(d, 40);
        if (!d.broken && snapshot(d).hash === before) r.warnings.push("the animation runs but nothing moves in its first 40 frames");
      }
      if (spec.orbit && !d.broken) {
        restoreState(d, saved);
        const before = snapshot(d).hash;
        d.s.view.yaw += 0.5;
        if (!d.broken && snapshot(d).hash === before) r.warnings.push("turning the view doesn't change the figure (is draw() using s.view?)");
      }
      restoreState(d, saved);
      render(d);
    }
    r.errors.push(...own());
    return r;
  }

  function check() {
    checking();
    const report = { errors: [], warnings: [], demos: [] };
    // Figures inside collapsed "going deeper" sections need a size to be checked.
    const closed = [...document.querySelectorAll("details:not([open])")].filter(x => x.querySelector("figure.demo"));
    for (const x of closed) x.open = true;
    try { return runCheck(report); } finally { for (const x of closed) x.open = false; }
  }
  function runCheck(report) {
    const live = new Set(demos.map(d => d.el));
    document.querySelectorAll("figure.demo").forEach(f => {
      if (!live.has(f)) report.errors.push(`<figure id="${f.id}"> has no demo() attached, so it renders empty`);
    });
    const text = [document.title, document.querySelector('meta[name="description"]')?.content ?? "", document.body.innerText];
    if (text.some(t => t.includes("{{"))) report.errors.push("template placeholders (names in double curly braces) are still on the page");
    if (document.getElementById("example-cube")) report.warnings.push("the template's example figure (#example-cube) is still on the page");
    const raw = document.querySelectorAll("pre.mermaid").length;
    if (raw) report.errors.push(`${raw} Mermaid block${raw === 1 ? " isn't" : "s aren't"} rendered: run scripts/render.mjs on the page`);
    for (const e of document.querySelectorAll(".scrub, .set, [data-part]")) {
      if (!e.__safis) report.warnings.push(`${e.outerHTML.slice(0, 80)}… isn't tied to any figure`);
    }
    const ids = new Set(demos.map(d => d.id));
    for (const e of errors) if (!ids.has(e.demo)) report.errors.push(`${e.phase}: ${e.message}`);
    for (const d of demos) report.demos.push(checkDemo(d));
    report.ok = !report.errors.length && report.demos.every(r => !r.errors.length);
    return report;
  }

  // Exploration support for scripts/explore.mjs: describe a figure and drive its controls.
  function describe(id) {
    checking();
    const d = demos.find(x => x.id === id);
    if (!d) return null;
    const controls = (d.spec.controls ?? []).flatMap(c => {
      const type = typeOf(c), label = c.label ?? c.key;
      if (type === "pad") return [0, 1].map(axis => {
        const r = axis ? c.y : c.x, key = c.keys[axis];
        return { key, label: `${label} (${axis ? "y" : "x"})`, type: "slider", min: r.min, max: r.max, value: d.v[key] };
      });
      if (type === "choice") return [{ key: c.key, label, type, options: options(c).map(o => o.value), value: d.v[c.key] }];
      return [{ key: c.key, label, type: NUMERIC.has(type) ? "slider" : type, min: c.min, max: c.max, value: d.v[c.key] }];
    });
    for (const p of d.spec.presets ?? []) controls.push({ label: p.label, type: "button", preset: true });
    return { id: d.id, controls, stepped: !!d.spec.step, animated: !!d.spec.step, orbit: !!d.spec.orbit, drag: !!d.spec.drag };
  }
  function drive(id, action) {
    checking();
    const d = demos.find(x => x.id === id);
    if (!d) return false;
    d.touched = true;
    if (action.reset) {
      if (typeof d.spec.state === "function") d.handle.reset();
      if (d.s.view && d.view0) Object.assign(d.s.view, d.view0);
      d.spin = null;
      d.tweens.clear();
    }
    if (action.set) for (const [k, v] of Object.entries(action.set)) setControl(d, k, v);
    if (action.view && d.s.view) Object.assign(d.s.view, action.view);
    if (action.viewDelta && d.s.view && d.view0) {
      d.s.view.yaw = clampYaw(d, d.view0.yaw + action.viewDelta[0]);
      d.s.view.pitch = clampPitch(d, d.view0.pitch + action.viewDelta[1]);
    }
    if (action.press) {
      const c = (d.spec.controls ?? []).find(x => x.type === "button" && x.label === action.press);
      const p = (d.spec.presets ?? []).find(x => x.label === action.press);
      if (c) pressButton(d, c);
      else if (p) applyPreset(d, p, false);
    }
    if (action.highlight !== undefined) setHighlight(d, action.highlight);
    if (action.steps && d.spec.step) runSteps(d, action.steps);
    if (action.play !== undefined) d.handle.play(action.play);
    render(d);
    return true;
  }

  function showReport(report) {
    const lines = [`Self-check: ${report.ok ? "PASS" : "FAIL"}`];
    for (const e of report.errors) lines.push(`ERROR ${e}`);
    for (const w of report.warnings) lines.push(`warn  ${w}`);
    for (const r of report.demos) {
      lines.push(`${r.errors.length ? "ERROR" : r.warnings.length ? "warn " : "ok   "} #${r.id}  ${r.summary}`);
      for (const e of r.errors) lines.push(`        ${e}`);
      for (const w of r.warnings) lines.push(`        ${w}`);
    }
    const box = node("pre", "check-report");
    box.textContent = lines.join("\n");
    document.body.prepend(box);
  }
  if (new URLSearchParams(location.search).has("check")) {
    addEventListener("load", () => requestAnimationFrame(() => showReport(check())));
  }

  const Safis = { demo, mount: demo, enhance, setTheme, version: 3, get palette() { return palette; }, typeset: root => window.SafisTeX?.typeset(root) };
  Object.assign(window, { demo, palette, rgba, clamp, lerp, smoothstep, TAU, Safis });
  window.__explainer = { check, describe, drive, ids: () => demos.map(d => d.id), version: 3 };
})();
