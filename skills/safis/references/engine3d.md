# E3: the 3D engine

E3 is a small WebGL 2 engine built into every page. It draws solid objects the way a technical illustration does: matte porcelain-like surfaces, ink outlines on every silhouette, crease, and part boundary (tinted to match each part), hatched faces where a section cuts through, see-through parts, and a soft shadow on the ground. Parts can also be physically based (steel that reflects a studio, brushed and heat-tinted metal, refracting glass, glowing hot parts) with soft shadows, bloom, GPU particles, and a ray-marched rocket plume. It's meant for explainer figures, not games: scenes of a few dozen parts and up to a few hundred thousand triangles.

## Making 3D that looks real

Follow these steps in order for every 3D figure of a real object.

1. **Real dimensions first.** Look up the real sizes and write them down in one unit (millimeters for a lock, meters for an engine). Model to those numbers; proportions are what make a part read as real.
2. **Name the parts.** List every part the prose mentions and the ones a reader expects to see, with what each is made of.
3. **Use the parts library.** Build from `E3.parts` (see [parts3d.md](parts3d.md)) before writing meshes by hand.
4. **Materials by what the part is made of.** Steel shafts `steel` or `brushed`, housings `aluminum`, seals `rubber`, windows `glass`, hot sections `inconel` with a `temperature`. Keep context parts `porcelain` and color only the subject.
5. **Pick a look.** `scene.look = "studio"` for machines, `"night"` when glow carries the story, `"outdoor"` for vehicles and buildings, `"diagram"` for teaching drawings. Don't tune lights by hand.
6. **Camera and framing.** A three-quarter view from slightly above (`pitch` 0.2 to 0.5), `fov` 26 to 32, the subject filling most of the frame; set `target` and `distance` when context parts make it small.
7. **Cutaway and explode.** A section cut (`scene.cutPlane`) or an exploded slider to show what's inside, with the housing ghosted.
8. **Labels.** `g.callouts` on `view.project` of named points, a few at a time.
9. **Check turntable views at 2x.** Run explore.mjs and read the "view" row, and crop the screenshots at 2x around joints and edges.

Checklist (verify and explore can't catch these):

- Proportions match the real numbers; nothing is a toy-sized thickness.
- No gaps where parts should touch, no parts sunk into each other, no z-fighting on coplanar faces.
- Metal doesn't look flat: curved metal shows soft-box highlights; a flat metal face that looks dull grey needs a bevel (`round`) or a slight angle.
- Glass doesn't look like white plastic: something should sit behind it to bend.
- Nothing floats: parts that rest on something touch it, and the shadow grounds the object.
- One material everywhere reads as a toy; real assemblies mix two to four.
- Dark mode: metals still read and glowing parts stay the brightest thing.

Contents: [making 3D that looks real](#making-3d-that-looks-real), [scenes](#scenes-and-nodes), [meshes](#meshes), [materials](#materials), [looks](#looks), [cuts, ghosts, shadows](#cuts-ghosts-shadows-and-light), [particles and plumes](#particles-and-plumes), [camera](#camera), [picking and labels](#picking-and-labels), [molecules](#molecules), [math helpers](#math-helpers), [recipes](#recipes), [limits](#limits).

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

`material` is a name or an object. Pick each part's material by what the real part is made of.

| name | look |
|---|---|
| `porcelain` (default), `paper` | Neutral white diagram shading: the context that isn't under discussion |
| `bone`, `enamel`, `cartilage`, `muscle`, `tendon`, `tissue`, `fat`, `nerve`, `artery`, `vein` | Anatomy, diagram shading |
| `graphite` | Dark diagram parts (pupils, screw slots) |
| `red`, `orange`, `green`, `blue`, `purple` | Pale tints of the page's subject colors, so a part can match the colored word that names it |
| `steel`, `chrome`, `aluminum`, `titanium` | Metals that reflect the studio. Chrome is a near mirror, aluminum bright and soft |
| `brushed` | Turned or brushed steel: highlights stretch across the grooves. `brush: "linear"` for a straight grain, `brushAxis` to turn it |
| `copper`, `brass`, `gold` | Colored metals |
| `inconel` | Nickel superalloy for hot sections; with a `temperature` it heat-tints and glows |
| `ceramic`, `plastic` | Satin dielectrics |
| `rubber` | Matte black |
| `carbon` | Carbon fiber twill under clear coat |
| `paint` | Glossy clear-coated paint; set the node's `color` (`"red"` gives the full subject color) |
| `concrete` | Rough grey, for pads and floors |
| `glass` | Refracts the scene behind it with a little dispersion, Fresnel edges, ink on its edges, a lighter shadow |
| `ghost`, `water` | See-through x-ray parts (clear in the middle, denser at the edges) |
| `hot` | Oxidized metal glowing by `temperature` (default 1400 K) |
| any `#rrggbb` | Diagram shading in that color |

The object form is `{ color, metal, roughness, emissive, temperature, opacity }`, plus `base` (start from a named material), `clearcoat`, `anisotropy`, `ior`, `thickness` (glass, world units), and `f0` (measured metal reflectance, linear RGB). An object with `metal` or `roughness` is physically based; `{ color }` alone keeps diagram shading. `{ color, metal: true }` from older pages is a physical metal of that color.

**Temperature.** `temperature` on a node (or material) is kelvin, or a field along a local axis: `{ axis: [0, 1, 0], stops: [[y, T], ...] }` (up to four stops). Metals take temper colors from about 450 K (straw, brown, purple, blue, then grey; inconel 150 K later) and glow by black-body color from about 750 K. `E3.blackbody(T)` returns the glow color as hex, `E3.heatTint(T)` the temper color.

The house style: nearly everything `porcelain` or a natural material, and only the parts the current paragraph talks about in a subject color. Real machines use real materials: steel, aluminum, inconel, rubber, glass, by what the part is made of.

## Looks

`scene.look` picks the whole light rig in one word: the environment metals reflect, key, fill and rim lights locked to the camera, shadow strength, outline weight, and bloom. Every look adapts to dark pages.

| look | for |
|---|---|
| `"studio"` (default) | Soft boxes on a neutral sweep. Real parts, product shots, machines |
| `"diagram"` | Flatter and lighter, for teaching drawings with only a few physical materials |
| `"night"` | Dark surround, strong cool rim light; glowing parts carry the picture (engines firing, furnaces) |
| `"outdoor"` | Sky dome and a warm sun, firmer shadows (vehicles, buildings, terrain) |

`scene.exposure` (1) brightens or darkens physical materials, `scene.bloom` (`false` or a strength) sets the glow around hot parts, `scene.lights = [{ position, color, intensity, range }]` adds up to two point lights. Physical materials are tone mapped with a neutral filmic curve, so base colors stay true and highlights roll off to white; diagram materials are never tone mapped and look exactly as before.

## Cuts, ghosts, shadows, and light

| scene property | meaning |
|---|---|
| `scene.cutPlane = [nx, ny, nz, d]` | Removes everything where `n · p > d`. Cut solids show a hatched section face, the way technical drawings show cut material. `null` turns it off. Drive `d` from a slider to cut progressively. |
| `scene.shadow` | `true` (default), `false`, or `{ opacity, scale, y, strength, parts, softness, cast }`. Soft shadows from the key light (contact-hardening PCF) fall on an invisible ground and on other parts, over a soft contact shadow. `opacity` is the contact shadow, `strength` the cast shadow on the ground, `parts` (0 to 1) how dark parts shade each other, `cast: false` keeps only the contact shadow. A node with `castShadow: false` casts none. |
| `scene.light` | `"camera"` (default: a studio light that follows the view, so every side looks lit), or a world direction like `[1, 0.2, 0]` (the Sun). |
| `scene.lighting` | `"soft"` (default porcelain shading) or `"sun"` (hard day/night terminator, for planets and phases). |
| `scene.ink` | Outline weight multiplier; `0` turns outlines off. Night and outdoor looks already draw lighter ink; drop to about `0.5` for a photographic scene. |
| `scene.ao` | Ambient occlusion strength, default `0.5`: surfaces crowded by nearer ones (the crease between packed atoms, the inside of a socket) darken a little, so dense models read as solid shapes. `false` turns it off; up to `1` for very crowded scenes. |

Quality is automatic. Still frames are supersampled 2x with full shadow and volume quality. While the view moves or an animation plays, E3 measures the time between frames and picks a tier: `high`, `medium`, or `low` (render scale, MSAA, shadow map size, particle count, plume steps). Phones start lower; desktops start high. `E3.scene({ quality: "low" })` (or `quality` in the camera) forces a tier, and `E3.quality.tier` reads the current one. The page checker always renders at `high`, so screenshots are stable.

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

## Particles and plumes

```js
const smoke = scene.add(E3.particles({
  count: 800, seed: 4, life: [1.6, 3.2], style: "smoke", size: [0.3, 1.2], opacity: 0.35,
  emitter: { shape: "ring", radius: 0.5, position: [0, 0.3, 0], along: "radial", speed: [2.5, 4.5], spread: 0.3 },
  forces: { drag: 0.9, buoyancy: 2.2, turbulence: { strength: 1.6, scale: 1.4 }, wind: [0.25, 0, 0] },
  colliders: [{ plane: [0, 1, 0, 0], bounce: 0.1 }],
}));
const plume = scene.add(E3.plume({ radius: 0.45, length: 4.3, fuel: "kerosene" }), { position: nozzleExit });
// in draw: scene.time = s.t; plume.throttle = v.throttle;
```

Particles run on the GPU (transform feedback) and are depth tested against the solids. They are deterministic: a particle's birth, speed, and life come from a hash of `seed`, slot, and generation, and the state steps on a fixed time grid, so the picture at `scene.time` (or the system's own `time`) is the same every time. Drive time from the figure's `step`; nothing moves by itself, so reduced motion is respected.

| option | meaning |
|---|---|
| `count`, `seed`, `life: [min, max]` | Slots, random seed, life in seconds (`Infinity` for gas molecules that never die) |
| `style` | `"smoke"` soft lit puffs, `"fire"` additive black-body glow, `"spark"` additive streaks, `"streak"` tracer dashes along the velocity, `"sphere"` lit balls with ink (molecules), `"dot"` flat discs |
| `emitter.shape` | `"point"`, `"disk"`, `"ring"`, `"cone"` (`angle`), `"sphere"`, `"box"` (`size`), `"line"` (`from`, `to`), `"mesh"` (`mesh`: area-weighted surface points) |
| `emitter` | `position`, `direction`, `radius`, `speed: [a, b]`, `spread` (cone half-angle), `thermal` (Gaussian velocity, for gases), `along: "normal" or "radial"`, `rake` (lanes, for tracer lines) |
| `forces` | `gravity`, `drag`, `wind`, `buoyancy`, `turbulence: { strength, scale, speed }` (curl noise), `vortex: { center, axis, strength, core }`, `attractors: [{ position, strength, radius }]` |
| `colliders` | `{ plane: [nx, ny, nz, d], bounce, friction, velocity }` keeps particles where n·p ≥ d; `{ sphere: [x, y, z, r], inside }` |
| `flow` | Tracers follow ideal flow instead of forces: `{ type: "airfoil", chord, thickness, camber, alpha }` or `{ type: "cylinder", radius, circulation }`; `E3.flow.airfoil(o)` gives the same field plus `outline()` for the wing mesh and `lift` |
| `size: [start, end]`, `opacity`, `fade: [in, out]`, `color` (or `[a, b]`), `colorBy: "speed"` with `range`, `temperature: [T0, T1]` (fire), `density` (0 to 1, drawn share: throttle) | Look |
| `cpu: true`, `measure: true` | Simulate on the CPU; `measure` fills `system.hits[i]` with the momentum per second delivered to collider `i` (pressure = hits / wall area) |

`E3.plume({ radius, length, throttle, temperature, fuel, cells, spread, turbulence, intensity })` is a ray-marched exhaust: exit at its origin, flowing down -y, with a hot core, Mach diamonds every `cells` exit diameters, a turbulent mixing layer, and emission by temperature (`fuel`: `"kerosene"`, `"methane"`, `"hydrogen"`). It lights nearby parts and smoke orange.

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
- There are no image textures; surface detail is procedural (brushing, carbon weave, temper colors).
- Glass refraction is screen space: it bends what's already drawn behind it, so glass behind glass shows only the nearer pane.
- Keep each scene under a few hundred thousand triangles so it stays smooth on laptops; the headless check renders in software and is slower.
