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

  function readTheme() {
    const cs = getComputedStyle(root);
    for (const n of NAMES) palette[n] = cs.getPropertyValue("--" + n).trim();
    fontText = cs.getPropertyValue("--font-text").trim() || "sans-serif";
    fontMono = cs.getPropertyValue("--font-mono").trim() || "monospace";
    fontSerif = cs.getPropertyValue("--font-serif").trim() || "serif";
  }
  readTheme();

  const color = c => palette[c] || c;
  const cssColor = c => (c in palette ? `var(--${c})` : c);
  function rgb(c) {
    const hex = String(color(c)).replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(hex)) return [128, 128, 128];
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(c, a) {
    const hex = String(color(c)).replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(hex)) return color(c);
    const [r, g, b] = rgb(c);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
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
      if (o.fill) { ctx.fillStyle = color(o.fill); ctx.fill(); }
      if (o.hatch) {
        ctx.fillStyle = hatchPattern(o.hatch === true ? "muted" : o.hatch, o.hatchGap ?? 6, o.hatchAngle ?? 45);
        ctx.fill();
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
      path(pts, o = {}) {
        if (pts.length < 2) return;
        shape(o.fill || o.stroke || o.hatch ? o : { ...o, stroke: "ink" }, () => {
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          if (o.close) ctx.closePath();
        });
      },
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
      // A small uppercase label with a halo, the house style for naming things inside figures.
      label(str, p, o = {}) {
        g.text(str, p, { size: 11, weight: 600, caps: true, tracking: 0.9, halo: true, color: "ink", ...o });
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
      // Labels in the left and right margins of the canvas, with leader lines to their anchors.
      // items: [{ at: [x, y], text, color, side: "left" | "right" }]
      callouts(items, o = {}) {
        const pad = o.pad ?? 12, gap = o.gap ?? 20, size = o.size ?? 11;
        const style = { size, weight: 600, caps: o.caps ?? true, tracking: 0.9 };
        const sides = { left: [], right: [] };
        for (const it of items) {
          if (!it || !it.at || !Number.isFinite(it.at[0])) continue;
          sides[it.side ?? (it.at[0] < (o.split ?? g.w / 2) ? "left" : "right")].push(it);
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
        if (text != null) g.text(text, [(A[0] + B[0]) / 2 + nx * 11, (A[1] + B[1]) / 2 + ny * 11], { size: 12, font: "mono", color: o.textColor ?? c, halo: true });
      },
      // A horizontal meter bar. frac from 0 to 1.
      meter(x, y, w, h, frac, o = {}) {
        const c = o.color ?? "brass";
        g.rect(x, y, w, h, { fill: "grid", r: h / 2 });
        g.rect(x, y, Math.max(h, w * clamp(frac, 0, 1)), h, { fill: c, r: h / 2, alpha: frac <= 0 ? 0 : 1 });
        if (o.label) g.text(o.label, [x + w / 2, y + h + 12], { size: 11, weight: 600, caps: true, tracking: 0.8, color: "muted" });
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
        if (o.label) g.text(o.label, [c[0], c[1] + r * 0.45], { size: 10, weight: 600, caps: true, tracking: 0.8, color: "muted" });
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
        if (o.label) g.text(o.label, [x + w / 2, y + h + 12], { size: 11, weight: 600, caps: true, tracking: 0.8, color: "muted" });
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
          g.text(fmt(t), [p[0], p[1] + 14], { color: "muted", size: 11, font: "mono" });
        }
        for (const t of o.yTicks ?? []) {
          const p = P([ax, t]);
          g.line(p, [p[0] - 4, p[1]], thin);
          g.text(fmt(t), [p[0] - 7, p[1]], { color: "muted", size: 11, align: "right", font: "mono" });
        }
        const lab = { size: 10.5, weight: 600, caps: true, tracking: 0.8, color: "muted" };
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
        // Supersample 2x on ordinary screens; dense screens already have the pixels.
        const out = g.dpr, budget = 4.2e6;
        let ss = out >= 1.5 ? 1 : 2;
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
    return g;
  }

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
      d.el.append(box);
    }
    box.textContent = `This figure stopped: ${phase}() threw "${message}"`;
  }

  function guard(d, phase, fn) {
    if (d.broken) return false;
    try { fn(); return true; } catch (e) { fail(d, phase, e); return false; }
  }

  const initialState = spec =>
    typeof spec.state === "function" ? spec.state() : clone(spec.state ?? {});

  function demo(id, spec) {
    const el = document.getElementById(id);
    if (!el) {
      errors.push({ demo: id, phase: "setup", message: `demo("${id}") found no element with that id` });
      console.error(`[demo #${id}] no element with id="${id}"`);
      return null;
    }
    const d = { id, el, spec, v: {}, inputs: {}, w: 0, h: 0, dpr: 1, visible: false, dirty: true, broken: false, dragging: false, playing: false, spin: null };
    d.handle = {
      id,
      get state() { return d.s; },
      get values() { return d.v; },
      set: (key, value) => setControl(d, key, value),
      reset() {
        const view = d.s.view;
        for (const k of Object.keys(d.s)) delete d.s[k];
        Object.assign(d.s, initialState(spec));
        if (view) d.s.view = view;
        d.dirty = true;
      },
      redraw() { d.dirty = true; },
      play(on = true) { d.playing = !!on && !!spec.step; syncPlay(d); },
    };
    d.s = initialState(spec);
    if (spec.orbit) {
      d.s.view = { yaw: spec.orbit.yaw ?? -0.6, pitch: spec.orbit.pitch ?? 0.35 };
      d.view0 = { ...d.s.view };
    }

    el.classList.add("is-live");
    const stage = document.createElement("div");
    stage.className = "stage";
    stage.tabIndex = 0;
    stage.setAttribute("role", "group");
    stage.setAttribute("aria-label", el.getAttribute("aria-label") || "interactive figure");
    d.canvas = document.createElement("canvas");
    d.canvas.setAttribute("aria-hidden", "true");
    stage.append(d.canvas);
    el.prepend(stage);
    d.stage = stage;
    d.ctx = d.canvas.getContext("2d");
    d.g = makeG(d.ctx);
    const side = document.createElement("div");
    side.className = "side";
    d.side = side;
    let after = stage;
    if (spec.controls?.length) { const c = buildControls(d); after.after(c); after = c; }
    after.after(side);
    buildTools(d, stage);
    buildHints(d);
    if (spec.drag || spec.orbit || spec.hover) addPointer(d);
    addKeys(d);

    demos.push(d);
    byEl.set(el, d);
    visibility.observe(el);
    // Resize on the next frame, not inside the observer: changing the canvas
    // height there would re-trigger the observer and log a loop error.
    new ResizeObserver(() => { d.needsResize = true; }).observe(stage);
    return d.handle;
  }

  function buildControls(d) {
    const box = document.createElement("div");
    box.className = "controls";
    const buttons = document.createElement("div");
    buttons.className = "buttons";
    for (const c of d.spec.controls) {
      if (c.type === "button") {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn";
        b.textContent = c.label;
        b.addEventListener("click", () => {
          if (guard(d, "action", () => c.action?.(d.s, d.v, d.handle))) d.dirty = true;
        });
        buttons.append(b);
        continue;
      }
      const row = document.createElement("label");
      row.style.setProperty("--c", cssColor(c.color ?? "ink"));
      const input = document.createElement("input");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = c.label ?? c.key;
      let out = null;
      if (c.type === "toggle") {
        row.className = "ctl toggle";
        input.type = "checkbox";
        row.append(input, name);
        input.addEventListener("change", () => setControl(d, c.key, input.checked));
        d.v[c.key] = !!c.value;
      } else {
        row.className = "ctl";
        Object.assign(input, { type: "range", min: c.min, max: c.max, step: c.step ?? "any" });
        out = document.createElement("output");
        row.append(name, input, out);
        input.addEventListener("input", () => setControl(d, c.key, input.valueAsNumber));
        d.v[c.key] = c.value ?? c.min;
      }
      d.inputs[c.key] = { c, input, out };
      syncInput(d, c.key);
      box.append(row);
    }
    if (buttons.children.length) box.append(buttons);
    return box;
  }

  function setControl(d, key, value) {
    const entry = d.inputs[key];
    if (!entry) throw new Error(`figure "${d.id}" has no control "${key}"`);
    const { c } = entry;
    d.v[key] = c.type === "toggle" ? !!value : clamp(Number(value), c.min, c.max);
    syncInput(d, key);
    if (d.spec.change) guard(d, "change", () => d.spec.change(key, d.s, d.v, d.handle));
    d.dirty = true;
  }

  function syncInput(d, key) {
    const { c, input, out } = d.inputs[key];
    const val = d.v[key];
    if (c.type === "toggle") { input.checked = val; return; }
    if (input.valueAsNumber !== val) input.value = val;
    input.style.setProperty("--p", `${((val - c.min) / (c.max - c.min)) * 100}%`);
    out.textContent = c.format ? c.format(val) : val.toFixed(decimals(c.step)) + (c.unit ? ` ${c.unit}` : "");
  }

  const ICONS = {
    pause: '<svg class="i-pause" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3" width="3" height="10" rx="1"/><rect x="9.5" y="3" width="3" height="10" rx="1"/></svg>',
    play: '<svg class="i-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6c0 .5.5.8.9.5l7-4.8a.6.6 0 0 0 0-1L5.9 2.7c-.4-.3-.9 0-.9.5z"/></svg>',
    reset: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.4.5A4 4 0 1 0 8 4v2L4.8 3.3 8 .5z"/></svg>',
  };

  function buildTools(d, stage) {
    const { spec } = d;
    const tools = document.createElement("div");
    tools.className = "tools";
    if (spec.step && spec.playButton !== false) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "icon-btn play";
      b.innerHTML = ICONS.pause + ICONS.play;
      b.addEventListener("click", () => { d.playing = !d.playing; syncPlay(d); });
      tools.append(b);
      d.playBtn = b;
      d.playing = spec.autoplay !== false && !motionQuery.matches;
      syncPlay(d);
    }
    if (spec.reset && typeof spec.state === "function") {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "icon-btn";
      b.innerHTML = ICONS.reset;
      b.setAttribute("aria-label", "Reset");
      b.addEventListener("click", () => {
        d.handle.reset();
        if (typeof spec.reset === "function") guard(d, "reset", () => spec.reset(d.s, d.v, d.handle));
      });
      tools.append(b);
    }
    if (tools.children.length) stage.append(tools);
    if (spec.drag || spec.orbit) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.setAttribute("aria-hidden", "true");
      stage.append(badge);
    }
  }

  function buildHints(d) {
    const { spec } = d;
    let hints = spec.hints;
    if (hints === undefined) {
      hints = [];
      const sliders = (spec.controls ?? []).filter(c => !c.type);
      if (spec.orbit && spec.drag) hints.push(["Drag", "move or turn"]);
      else if (spec.orbit) hints.push(["Drag", "turn"]);
      else if (spec.drag) hints.push(["Drag", "move"]);
      if (sliders[0]) hints.push(["← →", (sliders[0].label ?? sliders[0].key).toLowerCase()]);
      if (sliders[1]) hints.push(["↑ ↓", (sliders[1].label ?? sliders[1].key).toLowerCase()]);
      if (spec.step && spec.playButton !== false) hints.push(["Space", "pause"]);
    }
    for (const [keys, what] of hints || []) {
      const row = document.createElement("span");
      row.className = "hint";
      for (const k of String(keys).split(" ")) { const kb = document.createElement("kbd"); kb.textContent = k; row.append(kb); }
      row.append(document.createTextNode(what));
      d.side.append(row);
    }
    if (spec.status) {
      d.statusEl = document.createElement("span");
      d.statusEl.className = "status";
      d.side.append(d.statusEl);
    }
  }

  function syncPlay(d) {
    if (!d.playBtn) return;
    d.playBtn.dataset.state = d.playing ? "playing" : "paused";
    d.playBtn.setAttribute("aria-label", d.playing ? "Pause animation" : "Play animation");
  }

  function addKeys(d) {
    const sliders = () => (d.spec.controls ?? []).filter(c => !c.type);
    d.stage.addEventListener("keydown", e => {
      if (d.broken) return;
      const sl = sliders();
      const nudge = (c, dir) => {
        const step = c.step ?? (c.max - c.min) / 100;
        setControl(d, c.key, d.v[c.key] + dir * step * (e.shiftKey ? 10 : 1));
      };
      let used = true;
      if (e.key === " " && d.spec.step && d.spec.playButton !== false) { d.playing = !d.playing; syncPlay(d); }
      else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && sl[0]) nudge(sl[0], e.key === "ArrowRight" ? 1 : -1);
      else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && sl[1]) nudge(sl[1], e.key === "ArrowUp" ? 1 : -1);
      else if (e.key.startsWith("Arrow") && d.spec.orbit) {
        const v = d.s.view;
        if (e.key === "ArrowLeft") v.yaw -= 0.08; else if (e.key === "ArrowRight") v.yaw += 0.08;
        else if (e.key === "ArrowUp") v.pitch = clampPitch(d, v.pitch + 0.06); else v.pitch = clampPitch(d, v.pitch - 0.06);
        d.dirty = true;
      } else used = false;
      if (used) e.preventDefault();
    });
  }

  const clampPitch = (d, p) => clamp(p, d.spec.orbit?.minPitch ?? -1.45, d.spec.orbit?.maxPitch ?? 1.45);
  const clampYaw = (d, y) => clamp(y, d.spec.orbit?.minYaw ?? -Infinity, d.spec.orbit?.maxYaw ?? Infinity);

  function addPointer(d) {
    const { canvas, spec } = d;
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
    canvas.addEventListener("pointerdown", e => {
      if (d.broken || e.button > 0) return;
      const p = pos(e);
      if (hits(p)) mode = "drag";
      else if (spec.orbit) mode = "orbit";
      else return;
      d.dragging = mode === "drag";
      d.spin = null;
      last = p;
      lastT = performance.now();
      vel = [0, 0];
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      canvas.classList.add("grabbing");
      e.preventDefault();
    });
    canvas.addEventListener("pointermove", e => {
      const p = pos(e);
      if (!mode) {
        if (e.pointerType === "mouse") canvas.style.cursor = spec.orbit || hits(p) ? "grab" : "";
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
        view.yaw = clampYaw(d, view.yaw + delta[0] * 0.01);
        view.pitch = clampPitch(d, view.pitch + delta[1] * 0.01);
      }
      d.dirty = true;
    });
    const end = () => {
      if (!mode) return;
      if (mode === "drag") guard(d, "drag.end", () => spec.drag.end?.(d.s, d.v, d.handle));
      if (mode === "orbit" && !motionQuery.matches && performance.now() - lastT < 80 && Math.hypot(vel[0], vel[1]) > 0.08) d.spin = vel.slice();
      mode = null;
      d.dragging = false;
      canvas.classList.remove("grabbing");
      d.dirty = true;
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => {
      if (spec.hover && !mode) {
        let changed = false;
        guard(d, "hover", () => { changed = spec.hover(null, d.s, d.v, d.handle); });
        if (changed) d.dirty = true;
      }
    });
  }

  function resize(d) {
    const w = Math.round(d.canvas.parentElement.clientWidth);
    if (!w || d.broken) return;
    let aspect = 1.6;
    if (!guard(d, "aspect", () => {
      aspect = typeof d.spec.aspect === "function" ? d.spec.aspect(w) : d.spec.aspect ?? 1.6;
    })) return;
    const h = Math.round(w / aspect);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
    d.g.w = d.w;
    d.g.h = d.h;
    d.g.dpr = d.dpr;
    guard(d, "draw", () => d.spec.draw(d.g, d.s, d.v, d.handle));
    if (d.statusEl && !d.broken) guard(d, "status", () => { d.statusEl.textContent = d.spec.status(d.s, d.v) ?? ""; });
  }

  const visibility = new IntersectionObserver(entries => {
    for (const e of entries) {
      const d = byEl.get(e.target);
      if (d) d.visible = e.isIntersecting;
    }
  }, { rootMargin: "200px 0px" });

  let lastTime = performance.now();
  function frame(now) {
    const dt = clamp((now - lastTime) / 1000, 0, 1 / 30);
    lastTime = now;
    for (const d of demos) {
      if (d.needsResize) { d.needsResize = false; resize(d); }
      if (d.spin && !d.broken && d.s.view) {
        const view = d.s.view, k = Math.exp(-dt / 0.35);
        view.yaw = clampYaw(d, view.yaw + d.spin[0] * dt * 1000 * 0.01);
        view.pitch = clampPitch(d, view.pitch + d.spin[1] * dt * 1000 * 0.01);
        d.spin = [d.spin[0] * k, d.spin[1] * k];
        if (Math.hypot(d.spin[0], d.spin[1]) < 0.004) d.spin = null;
        d.dirty = true;
      }
      if (d.spec.step && d.playing && d.visible && !d.dragging && !d.broken) {
        if (guard(d, "step", () => d.spec.step(dt, d.s, d.v, d.handle))) d.dirty = true;
      }
      if (d.dirty && (d.visible || !d.w)) render(d);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  darkQuery.addEventListener("change", () => { readTheme(); for (const d of demos) d.dirty = true; });
  addEventListener("resize", () => { for (const d of demos) resize(d); });
  addEventListener("error", e => errors.push({ demo: null, phase: "page", message: e.message }));
  addEventListener("unhandledrejection", e => errors.push({ demo: null, phase: "page", message: String(e.reason) }));

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
    for (const [k, val] of Object.entries(saved.v)) { d.v[k] = val; syncInput(d, k); }
    d.dirty = true;
  }
  function runSteps(d, n) {
    for (let i = 0; i < n && !d.broken; i++) guard(d, "step", () => d.spec.step(1 / 60, d.s, d.v, d.handle));
  }
  function probe(d, key, value, saved) {
    restoreState(d, saved);
    setControl(d, key, value);
    if (d.spec.step) runSteps(d, 20);
    return snapshot(d).hash;
  }

  function checkDemo(d) {
    const { spec } = d;
    const r = { id: d.id, summary: "", errors: [], warnings: [] };
    const own = () => errors.filter(e => e.demo === d.id).map(e => `${e.phase}() threw: ${e.message}`);
    if (!d.el.getAttribute("aria-label")) r.warnings.push("the <figure> has no aria-label describing what it shows");
    resize(d);
    const n = (spec.controls ?? []).length;
    r.summary = `${d.w}x${d.h}, ${n} control${n === 1 ? "" : "s"}` +
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
        if (c.type === "button" || d.broken) continue;
        const values = c.type === "toggle" ? [false, true] : [c.min, (c.min + c.max) / 2, c.max];
        const hashes = new Set(values.map(x => probe(d, c.key, x, fresh)));
        if (!d.broken && hashes.size === 1) r.warnings.push(`moving "${c.label ?? c.key}" across its range doesn't change the figure`);
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
    const report = { errors: [], warnings: [], demos: [] };
    const live = new Set(demos.map(d => d.el));
    document.querySelectorAll("figure.demo").forEach(f => {
      if (!live.has(f)) report.errors.push(`<figure id="${f.id}"> has no demo() attached, so it renders empty`);
    });
    const text = [document.title, document.querySelector('meta[name="description"]')?.content ?? "", document.body.innerText];
    if (text.some(t => t.includes("{{"))) report.errors.push("template placeholders (names in double curly braces) are still on the page");
    if (document.getElementById("example-cube")) report.warnings.push("the template's example figure (#example-cube) is still on the page");
    const ids = new Set(demos.map(d => d.id));
    for (const e of errors) if (!ids.has(e.demo)) report.errors.push(`${e.phase}: ${e.message}`);
    for (const d of demos) report.demos.push(checkDemo(d));
    report.ok = !report.errors.length && report.demos.every(r => !r.errors.length);
    return report;
  }

  // Exploration support for scripts/explore.mjs: describe a figure and drive its controls.
  function describe(id) {
    const d = demos.find(x => x.id === id);
    if (!d) return null;
    return {
      id: d.id,
      controls: (d.spec.controls ?? []).map(c => ({ key: c.key, label: c.label ?? c.key, type: c.type ?? "slider", min: c.min, max: c.max, value: d.v[c.key] })),
      stepped: !!d.spec.step,
      animated: !!d.spec.step, orbit: !!d.spec.orbit, drag: !!d.spec.drag,
    };
  }
  function drive(id, action) {
    const d = demos.find(x => x.id === id);
    if (!d) return false;
    if (action.reset) {
      if (typeof d.spec.state === "function") d.handle.reset();
      if (d.s.view && d.view0) Object.assign(d.s.view, d.view0);
      d.spin = null;
    }
    if (action.set) for (const [k, v] of Object.entries(action.set)) setControl(d, k, v);
    if (action.view && d.s.view) Object.assign(d.s.view, action.view);
    if (action.viewDelta && d.s.view && d.view0) {
      d.s.view.yaw = clampYaw(d, d.view0.yaw + action.viewDelta[0]);
      d.s.view.pitch = clampPitch(d, d.view0.pitch + action.viewDelta[1]);
    }
    if (action.press) {
      const c = (d.spec.controls ?? []).find(x => x.type === "button" && x.label === action.press);
      if (c) guard(d, "action", () => c.action?.(d.s, d.v, d.handle));
    }
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
    const box = document.createElement("pre");
    box.className = "check-report";
    box.textContent = lines.join("\n");
    document.body.prepend(box);
  }
  if (new URLSearchParams(location.search).has("check")) {
    addEventListener("load", () => requestAnimationFrame(() => showReport(check())));
  }

  Object.assign(window, { demo, palette, rgba, clamp, lerp, smoothstep, TAU });
  window.__explainer = { check, describe, drive, ids: () => demos.map(d => d.id), version: 2 };
})();
