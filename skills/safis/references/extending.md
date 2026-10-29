# Adding what's missing: materials, particles, colormaps

Check the built-in lists first (`E3.MATERIALS`, `E3.matter`, and the `Fx` presets in effects.md). When nothing fits, define a new one in the page's first script, from real numbers. A definition is checked as it's made, and a misspelled key throws with the allowed keys listed.

## A material (3D)

```js
E3.define.material("ice", { base: "glass", ior: 1.31, roughness: 0.08, color: "#e8f4fa" });
E3.define.material("wet-sand", { color: "#8a7350", metal: 0, roughness: 0.35, clearcoat: 0.6 });
// then: scene.add(mesh, { material: "ice" })
```

| real property | key | typical values |
|---|---|---|
| what it is | `base` | start from the closest built-in: `glass`, `water`, `steel`, `plastic`, `concrete`, `paint`, `rubber` |
| metal or not | `metal` | 1 metals, 0 everything else (no in-between for real materials) |
| how polished | `roughness` | 0.05 mirror or wet, 0.3 machined, 0.5 plastic, 0.9 chalk, dirt |
| metal's tint | `f0` | measured reflectance, linear RGB: gold [1, 0.77, 0.34], copper [0.95, 0.64, 0.54] |
| transparent | `glass: true`, `ior` | water 1.333, ice 1.31, acrylic 1.49, glass 1.5, sapphire 1.77, diamond 2.42 |
| a varnish or wet film | `clearcoat` | 0 to 1 |
| light under the skin | `sss`, `sssColor` | 0.3 to 0.8 for wax, skin, leaves, milk (`foliage: true` for leaves and blades) |
| glows | `emissive`, `temperature` | a number (strength) or a color; `temperature` in K for hot metal |
| a picture on it | `map`, `mapping` | a canvas or `(u, v) => color`; `"sphere"`, `"planar"`, `"box"` |

## A particle matter (3D)

Say how it moves with one number from physics, and the engine derives gravity and drag:

```js
E3.define.matter("ash", { vt: 0.5, style: "dot", life: [3, 6], size: [0.003, 0.003], color: "#777" });
E3.particles({ matter: "ash", units: "m", count: 600, emitter: { ... } });
```

| it | key | how to get the number |
|---|---|---|
| falls | `vt` terminal speed, m/s | small grains (under 0.1 mm): Stokes, vt = (ρp - ρair) g d² / (18 μ), μ = 1.8e-5 Pa·s; bigger ones: vt = √(2 m g / (ρair Cd A)), Cd ≈ 0.5 for a sphere, 1.2 for a flat flake |
| rises in water | `rise`, m/s | bubbles 1-5 mm: 0.2 to 0.3 m/s |
| is a hot gas | `gas: true`, `temperature: [birth K, end K]`, `drag` (1/s mixing rate) | lift is g (T - 293) / T at birth; drag 1 to 3/s for smoke, 3 to 4 for flame |
| drifts on air | `eddy: [speed m/s, size m, change rate]` | indoor drafts [0.03, 0.4, 0.1], outdoor gusts [1, 1, 0.3] |
| looks like | `style` (`smoke`, `fire`, `spark`, `streak`, `sphere`, `dot`), `size: [birth, end]` m, `life: [min, max]` s, `color`, `opacity` | |
| meets the ground | `bounce` (0 to 1), `friction` (0 to 1) | sand 0.15 / 0.85, drops 0.1 / 0.6, dust 0 / 1 |

`base: "dust"` copies a preset to change one number. Check it: a falling matter should reach `vt` and land, a gas should rise and slow; read the explore sheet.

## 2D effects

`Fx.matter.define(name, spec)` takes the same keys for `Fx.particles`, and `Fx.colormap.define(name, stops)` adds a colormap for `Fx.fluid` and `Fx.waves` (see effects.md, "Adding a new effect, matter, or colormap").

## When the physics itself is missing

Model it from the governing law, not from how it looks: write the force, the rate, or the field in a few lines (a `forces` entry, an `attractors` list, a `flow` field, `Sim` for anything stepped), cite the source of each number in a comment, and add the check that it behaves (falls at vt, conserves energy, matches a closed form) before drawing it.
