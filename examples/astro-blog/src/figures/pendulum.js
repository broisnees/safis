// A pendulum whose length the reader sets from the prose.
export default function pendulum() {
  return {
    aspect: 1.7,
    state: () => ({ t: 0 }),
    controls: [
      { key: "length", label: "Length", min: 0.25, max: 2, step: 0.01, value: 1, unit: "m", color: "green",
        marks: [{ value: 0.25 }, { value: 0.994, label: "1 s beat" }, { value: 2 }] },
      { key: "swing", label: "Swing", min: 2, max: 30, step: 1, value: 15, unit: "°", color: "blue", hidden: true },
    ],
    caption: "A pendulum swinging from a pivot. The readout is its period, the time for one full swing there and back.",
    step(dt, s) { s.t += dt; },
    draw(g, s, v) {
      const T = 2 * Math.PI * Math.sqrt(v.length / 9.81);
      const a = (v.swing * Math.PI / 180) * Math.cos((2 * Math.PI * s.t) / T);
      const P = g.fit(-1.2, 1.2, -2.2, 0.15, { pad: 20 });
      const bob = [v.length * Math.sin(a), -v.length * Math.cos(a)];
      g.line(P([-0.25, 0]), P([0.25, 0]), { stroke: "ink", width: 2 });
      g.line(P([0, 0]), P(bob), { stroke: g.lit("rod") ? "green" : "ink", width: g.lit("rod") ? 3 : 1.75 });
      g.circle(P(bob), 11, { fill: g.lit("bob") ? "blue" : "ink" });
      g.dimension(P([-0.95, 0]), P([-0.95, -v.length]), `${v.length.toFixed(2)} m`, { color: "green" });
    },
    status: (s, v) => `period ${(2 * Math.PI * Math.sqrt(v.length / 9.81)).toFixed(2)} s`,
  };
}
