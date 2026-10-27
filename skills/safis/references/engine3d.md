# E3: the 3D engine

E3 is a small WebGL 2 engine built into every page. It draws solid objects the way a technical illustration does: matte porcelain-like surfaces, ink outlines on every silhouette, crease, and part boundary (tinted to match each part), hatched faces where a section cuts through, see-through parts, and a soft shadow on the ground. It's meant for explainer figures, not games: scenes of a few dozen parts and up to a few hundred thousand triangles.

Contents: [scenes](#scenes-and-nodes), [meshes](#meshes), [materials](#materials), [cuts, ghosts, shadows](#cuts-ghosts-shadows-and-light), [camera](#camera), [picking and labels](#picking-and-labels), [molecules](#molecules), [math helpers](#math-helpers), [recipes](#recipes), [limits](#limits).

## Scenes and nodes

Build the scene once, outside `draw`, and change node properties inside `draw`:

```js
{
  const scene = E3.scene({ shadow: true });
  const wheel = scene.add(E3.mesh.gear({ teeth: 30, thickness: 4, hole: 2, spokes: 5 }), { name: "wheel" });
  const pinion = scene.add(E3.mesh.gear({ teeth: 12, thickness: 6, hole: 1.2 }), { name: "pinion", material: "brass", position: [21, 0, 0] });
  demo("gears", {
    orbit: { yaw: -0.5, pitch: 0.5 },
    controls: [{ key: "turn", label: "Turn", min: 0, max: 6.28, step: 0.01, value: 0 }],
    draw(g, s, v) {
      wheel.rotation = [0, v.turn, 0];
      pinion.rotation = [0, -v.turn * 30 / 12, 0];
      const view = g.render3d(scene, { ...s.view });
      g.callouts([{ at: view.project([21, 3, 0]), text: "pinion", color: "brass" }]);
    },
  });
}
```

World axes: x right, y up, z toward the viewer before the camera turns. Pick units that suit the subject (millimeters for a jaw, ångström for a molecule, meters for a bridge) and stay consistent.

`scene.add(meshOrNode, options)` returns a node; `node.add(...)` makes children that move with their parent; `node.group(options)` adds an empty node for grouping.

| node property | meaning |
|---|---|
| `name` | Used by picking and `scene.find(name)`. |
| `position`, `rotation`, `scale` | `rotation: [x, y, z]` radians, applied about X, then Y, then Z, all about the parent's axes. `scale` is a number or `[x, y, z]`. |
| `pivot` | `[x, y, z]` in local coordinates to rotate and scale around (hinges). |
| `matrix` | A full 4x4 matrix (`E3.m4`) that replaces position/rotation/scale when you compute poses yourself. |
| `material`, `color` | See [materials](#materials). `color` overrides the material's color. |
| `opacity` | Below 1 draws the part see-through (x-ray style: clear in the middle, denser at the edges). |
| `visible` | Hide parts to reveal what's behind ("I'll briefly hide the hour wheel"). |
| `cut` | `false` exempts the part from the scene's section cut (default `true`). |
| `highlight` | `true` (or a palette name) tints the part, for hover. |
| `pickable` | `false` makes picking ignore it. |

Methods: `node.set(options)`, `node.world()` (4x4 matrix), `node.toWorld([x, y, z])` (a local point in world coordinates, for labels on moving parts), `node.find(name)`, `node.traverse(fn)`.

## Meshes

All builders return meshes you can share between nodes and scenes. Closed solids come out watertight with outward normals; edges sharper than about 35° get hard shading and an ink line.

| builder | shape |
|---|---|
| `E3.mesh.box(w, h, d, { round })` | Box, optionally with rounded edges (teeth, blocks, keys) |
| `E3.mesh.sphere(r)`, `ellipsoid(rx, ry, rz)` | Spheres and ellipsoids (heads of bones, eyeballs, planets) |
| `E3.mesh.cylinder(r, h, { r2, caps })` | Along y; `r2: 0` gives a cone |
| `E3.mesh.torus(R, r, { arc })` | Rings, partial rings with `arc` |
| `E3.mesh.lathe([[r, y], ...])` | Revolves a profile around y: pistons, bottles, bolts, cells, vessels |
| `E3.mesh.extrude(outline, depth, { bevel, holes })` | Extrudes a 2D outline (xy) along z, with rounded edges and holes: plates, brackets, bones in profile, levers |
| `E3.mesh.sweep(path, section, { up, closed, caps })` | Sweeps a 2D cross-section along a 3D path. `section` can be a function `(t, i) => points` with the same number of points everywhere, so the shape can change along the path (a jaw that is taller at the chin). `up` keeps the section upright. |
| `E3.mesh.tube(path, r, { segments })` | Tube along a path; `r` can be a function of `t` (muscles thicker in the middle, tapering vessels, nerves) |
| `E3.mesh.helix(radius, pitch, turns, wire)` | Springs, coils, DNA backbones |
| `E3.mesh.gear({ teeth, module, thickness, hole, spokes, bevel })` | Spur gear lying flat (axis y) |
| `E3.mesh.arrow(a, b, { radius })` | Straight 3D arrow between two points (forces, flows) |
| `E3.mesh.arcArrow(radius, a0, a1, { tube, y })` | Curved arrow around y (rotation direction) |
| `E3.mesh.plane(w, d)` | Flat rectangle (ground, water surface) |
| `E3.mesh.custom(positions, indices)` | Any triangle list |
| `E3.mesh.transform(mesh, matrix)`, `E3.mesh.merge(...meshes)` | Place and combine meshes |

`E3.smooth(points, { closed, steps })` turns a few control points into a smooth curve (Catmull-Rom) for outlines and paths. To extrude a side profile across the body (x) instead of along z, transform the result by `E3.m4.rotationY(-Math.PI / 2)`: the outline's x becomes z and the extrusion runs along x.

A mesh whose shape changes every frame (a deforming disc, a filling balloon) can be rebuilt each draw; for big meshes, build a few key shapes once and switch between them.

## Materials

`material` is a name or `{ color, metal, opacity }`.

| name | look |
|---|---|
| `porcelain` (default), `paper` | Neutral white: the context that isn't under discussion |
| `bone`, `enamel`, `cartilage` | Skeleton and teeth |
| `muscle`, `tendon`, `tissue`, `fat`, `nerve`, `artery`, `vein` | Soft tissue |
| `brass`, `gold`, `copper`, `steel` | Metals, with a highlight |
| `graphite` | Dark parts (pupils, screw slots, rubber) |
| `glass`, `water` | See-through by default |
| `red`, `orange`, `green`, `blue`, `purple` | Pale tints of the page's subject colors, so a part can match the colored word that names it |
| any `#rrggbb` | Exact color |

The house style: nearly everything `porcelain` or a natural material, and only the parts the current paragraph talks about in a subject color.

## Cuts, ghosts, shadows, and light

| scene property | meaning |
|---|---|
| `scene.cutPlane = [nx, ny, nz, d]` | Removes everything where `n · p > d`. Cut solids show a hatched section face, the way technical drawings show cut material. `null` turns it off. Drive `d` from a slider to cut progressively. |
| `scene.shadow` | `true`, `false`, or `{ opacity, scale, y }`: a soft contact shadow under the scene. |
| `scene.light` | `"camera"` (default: a studio light that follows the view, so every side looks lit), or a world direction like `[1, 0.2, 0]` (the Sun). |
| `scene.lighting` | `"soft"` (default porcelain shading) or `"sun"` (hard day/night terminator, for planets and phases). |
| `scene.ink` | Outline weight multiplier; `0` turns outlines off. |
| `scene.ao` | Ambient occlusion strength, default `0.5`: surfaces crowded by nearer ones (the crease between packed atoms, the inside of a socket) darken a little, so dense models read as solid shapes. `false` turns it off; up to `1` for very crowded scenes. |

Quality is automatic: edges are supersampled 2x while the view is still, and dense screens drop to 1x while the reader turns or drags the view or an animation runs, then redraw sharp when it stops.

Section cuts work best on closed meshes that don't overlap each other. For an "x-ray" view, give the outer parts `opacity: 0.3` and keep the inner parts solid.

## Camera

`g.render3d(scene, camera)` takes:

| camera option | meaning |
|---|---|
| `yaw`, `pitch` | Usually `...s.view` from `orbit`. Positive pitch looks from above. |
| `fov` | Vertical field of view in degrees [28]. `0` gives an orthographic view, good for side and front elevations. |
| `target` | Point to look at. Default: the center of the scene's outline as seen from the first view. |
| `distance` | Camera distance. Default: fitted so the scene fills `margin` [0.86] of the frame. |
| `zoom` | Multiplier on the fitted framing. |
| `fit` | `"once"` (default: fit on the first draw and keep it, so turning doesn't zoom) or `"always"`. |

When a big context part (a ghost shell, a ground plate) makes the subject small, set `target` and `distance` explicitly.

## Picking and labels

```js
let view = null;
demo("parts", {
  orbit: {},
  state: () => ({ hover: null }),
  hover(p, s) { const hit = p && view ? view.pick(p) : null; const name = hit ? hit.node.name : null; if (name === s.hover) return false; s.hover = name; return true; },
  status: s => (s.hover ? `${s.hover}: ${INFO[s.hover]}` : "Point at a part to name it."),
  draw(g, s, v) {
    for (const n of parts) n.highlight = n.name === s.hover;
    view = g.render3d(scene, { ...s.view });
    g.callouts(parts.map(n => ({ at: view.project(n.toWorld([0, 0, 0])), text: n.name })));
  },
});
```

`view.project(p)` gives `[px, py, distance]` in the figure's pixels; `view.pick(p, { ghosts: true })` also hits see-through parts. Labels drawn with `g.callouts` stay readable while the model turns.

## Science and math builders

For plots and fields in 3D. Full signatures and examples are in [simulations.md](simulations.md#3d-builders-for-math-and-science).

| call | builds |
|---|---|
| `E3.mesh.surface(f, { x, z, n, nz })` | A height field y = f(x, z) (the engine is y-up), with holes where `f` is not finite |
| `E3.mesh.surfaceBands(f, { ..., bands })` | The same surface cut into color bands; the outlines between bands are contour lines |
| `E3.mesh.parametric((u, v) => [x, y, z], { u, v, nu, nv, wrapU, wrapV })` | Spheres, tori, saddles, Möbius strips |
| `E3.mesh.glyphs(points, vectors, { scale })` | A 3D vector field as arrows, in one mesh |
| `E3.mesh.polyline(points, r)` | A trajectory or field line as a wire |
| `E3.axes3(scene, { x, y, z, ticks, grid })` | Graphite axes, ticks and a floor grid; returns label anchors for `view.project` |
| `E3.ramp(t, stops)` | A color between palette stops (call it in `draw` so it follows dark mode) |

## Molecules

```js
const water = E3.molecule([["O", [0, 0, 0]], ["H", [0.757, 0.586, 0]], ["H", [-0.757, 0.586, 0]]], [[0, 1], [0, 2]], { scale: 4 });
scene.add(water);
```

`E3.molecule(atoms, bonds, { style, scale })` returns a group node. `atoms` are `[element, [x, y, z]]` in ångström; `bonds` are `[i, j, order]` (order 2 and 3 draw parallel sticks). `style: "ball"` (ball-and-stick, default) or `"space"` (space-filling, van der Waals radii). Atom nodes are named like `O1`, `H2` for picking. `E3.ELEMENTS` has radii and colors for common elements; use real bond lengths and angles.

## Math helpers

`E3.v3` (`add`, `sub`, `scale`, `dot`, `cross`, `len`, `norm`, `lerp`, `dist`) and `E3.m4` (`identity`, `multiply`, `translation`, `scaling`, `rotationX/Y/Z`, `rotationAxis`, `alignY`, `invert`, `apply`, `applyDir`, `compose`, `lookAt`, `perspective`). Matrices are column-major `Float32Array`s, as in WebGL.

## Recipes

- **Exploded view.** Store each part's assembled position; offset it along an explode direction times a slider value. Hide or ghost the housing as parts come out.
- **Assembly narrative.** One scene, several figures: each figure shows one more part (`visible`), the way a mechanism is put together.
- **Cutaway.** A slider drives `scene.cutPlane[3]` from outside the object to its middle. Exempt parts that should stay whole with `cut: false`.
- **Moving joints.** Compute the pose from the model (angles, contact points) and set `node.matrix`; children (teeth on a jaw, a hand on a forearm) follow.
- **Rotation direction.** `E3.mesh.arcArrow` around a wheel's axis, colored like the word that describes the motion.
- **Planet and Sun.** `scene.lighting = "sun"`, `scene.light` toward the Sun, sphere meshes; draw orbits as thin tubes or as 2D paths through `view.project`.
- **Front and side views together.** Two `g.render3d` calls with `box` set to each half of the canvas, one with `fov: 0`.
- **Context without clutter.** Context parts in `porcelain` or `glass` with low opacity; the subject in a subject color.

## Limits

- One WebGL context serves every figure. If a browser has no WebGL 2, the figure shows an error message instead of the drawing.
- Transparency is sorted per part, not per triangle; overlapping see-through parts can look wrong from some angles.
- There are no textures and no cast shadows between parts; the look comes from shading, outlines, and color.
- Keep each scene under a few hundred thousand triangles so it stays smooth on laptops; the headless check renders in software and is slower.
