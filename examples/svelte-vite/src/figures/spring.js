// A block on a spring. A factory, so each mounted copy gets its own drag mapping.
export default function spring() {
  let P; // world (meters) to canvas pixels, from the last draw

  return {
    aspect: 1.9,
    state: () => ({ x: 0.9, v: 0 }),
    reset: true,
    controls: [
      { key: "k", label: "Stiffness", min: 1, max: 20, step: 0.1, value: 6, unit: "N/m", color: "orange" },
      { key: "m", label: "Mass", min: 0.2, max: 5, step: 0.1, value: 1, unit: "kg", color: "blue" },
      { key: "damp", label: "Friction", type: "choice", value: 0.3, color: "green",
        options: [{ value: 0, label: "None" }, { value: 0.3, label: "Some" }, { value: 1.2, label: "Lots" }] },
    ],
    presets: [{ label: "Bouncy", set: { k: 16, m: 0.4, damp: 0 } }, { label: "Sluggish", set: { k: 2, m: 4, damp: 1.2 } }],
    caption: "A block on a spring. Drag the block to pull it; the readout is the time for one full swing.",
    // New settings start a fresh swing from 0.9 m, so changing them never adds energy mid-swing.
    change(key, s) { s.x = 0.9; s.v = 0; },
    step(dt, s, v) {
      const a = (-v.k * s.x - v.damp * s.v) / v.m; // Hooke's law plus friction
      s.v += a * dt;
      s.x += s.v * dt;
    },
    draw(g, s, v) {
      P = g.fit(-2.2, 2.2, -0.8, 1, { pad: 24 });
      const wall = -2, y0 = -0.35, bx = Math.max(-1.6, s.x);
      g.line(P([wall, y0]), P([2.1, y0]), { stroke: "ink", width: 1.5 });
      g.line(P([wall, y0]), P([wall, 0.7]), { stroke: "ink", width: 1.5 });
      const coils = 9, pts = [];
      for (let i = 0; i <= coils * 2; i++) {
        const x = wall + (bx - 0.3 - wall) * (i / (coils * 2));
        pts.push(P([x, i === 0 || i === coils * 2 ? 0 : i % 2 ? 0.16 : -0.16]));
      }
      g.path(pts, { stroke: "orange", width: g.lit("spring") ? 3.5 : 2 });
      const a = P([bx - 0.3, 0.3]), b = P([bx + 0.3, y0]);
      g.rect(a[0], a[1], b[0] - a[0], b[1] - a[1], { fill: g.lit("block") ? g.rgba("blue", 0.25) : "panel", stroke: "blue", width: 2, r: 3 });
      g.handle(P([bx, -0.02]), { color: "blue" });
      g.dimension(P([0, -0.6]), P([bx, -0.6]), `${s.x >= 0 ? "+" : "−"}${Math.abs(s.x).toFixed(2)} m`, { color: "muted" });
    },
    drag: {
      hit: (p, s) => { const c = P([s.x, -0.02]); return Math.hypot(p[0] - c[0], p[1] - c[1]) < 40; },
      move(p, s) { s.x = Math.max(-1.6, Math.min(2, P.inv(p)[0])); s.v = 0; },
    },
    status: (s, v) => `period ${(2 * Math.PI * Math.sqrt(v.m / v.k)).toFixed(2)} s`,
  };
}
