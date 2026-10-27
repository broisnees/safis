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

  const ready = () => { enhanceArticle(); enhance(document); addMeta(); addSkipLink(); addThemeToggle(); };
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
