# E3: the 3D engine

E3 is a small WebGL 2 engine built into every page. It draws solid objects the way a technical illustration does: matte porcelain-like surfaces, ink outlines on every silhouette, crease, and part boundary (tinted to match each part), hatched faces where a section cuts through, see-through parts, and a soft shadow on the ground. Parts can also be physically based (steel that reflects a studio, brushed and heat-tinted metal, refracting glass, glowing hot parts) with soft shadows, bloom, GPU particles, and a ray-marched rocket plume. It's meant for explainer figures, not games: scenes of a few dozen parts and up to a few hundred thousand triangles.

## Making 3D that looks real

Follow these steps in order for every 3D figure of a real object.

1. **Real dimensions first.** Look up the real sizes and write them down in one unit (millimeters for a lock, meters for an engine). Model to those numbers; proportions are what make a part read as real.
2. **Name the parts.** List every part the prose mentions and the ones a reader expects to see, with what each is made of.
3. **Use the parts library.** Build from `E3.parts` (see [parts3d.md](parts3d.md)) before writing meshes by hand.
4. **Materials by what the part is made of.** Steel shafts `steel` or `brushed`, housings `aluminum`, seals `rubber`, windows `glass`, hot sections `inconel` with a `temperature`. Keep context parts `porcelain` and color only the subject.
5. **Pick a look.** `scene.look = "studio"` for machines, `"night"` when glow carries the story, `"outdoor"` for vehicles and buildings, `"diagram"` for teaching drawings. Don't tune lights by hand.
6. **Only the subject.** Don't add stands, tables, floors, pads, plinths, or rooms unless the idea needs them. E3 already grounds an object with a soft contact shadow on an invisible ground, and props only compete with the subject and push it smaller. Add a surface when the physics involves it (a jet hitting a pad, a ball bouncing, water in a tank) and a stand only when the stand is part of the story.
7. **Camera and framing.** A three-quarter view from slightly above (`pitch` 0.2 to 0.5), `fov` 26 to 32, the subject filling most of the frame; set `target` and `distance` when context parts make it small.
8. **Cutaway and explode.** A section cut (`scene.cutPlane`) or an exploded slider to show what's inside, with the housing ghosted.
9. **Labels.** `g.callouts` on `view.project` of named points, a few at a time.
10. **Check turntable views at 2x.** Run explore.mjs and read the "view" row, and crop the screenshots at 2x around joints and edges.

Checklist (verify and explore can't catch these):

- Proportions match the real numbers; nothing is a toy-sized thickness.
- No gaps where parts should touch, no parts sunk into each other, no z-fighting on coplanar faces.
- Metal doesn't look flat: curved metal shows soft-box highlights; a flat metal face that looks dull grey needs a bevel (`round`) or a slight angle.
- Glass doesn't look like white plastic: something should sit behind it to bend.
- Nothing floats: parts that rest on something touch it, and the shadow grounds the object.
- No props the idea doesn't need: no display stand, table, floor slab, or test rig unless the paragraph is about it.
- One material everywhere reads as a toy; real assemblies mix two to four.
- Dark mode: metals still read and glowing parts stay the brightest thing.

Contents: [making 3D that looks real](#making-3d-that-looks-real), [scenes](#scenes-and-nodes), [meshes](#meshes), [materials](#materials), [looks](#looks), [cuts, ghosts, shadows](#cuts-ghosts-shadows-and-light), [particles and plumes](#particles-and-plumes), [water](#water), [camera](#camera), [picking and labels](#picking-and-labels), [molecules](#molecules), [math helpers](#math-helpers), [recipes](#recipes), [limits](#limits).

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
| `paint` | Glossy clear-coated paint, off-white by default; set the node's `color` (`"red"` gives the full subject color) |
| `concrete` | Rough grey, for pads and floors |
| `glass` | Refracts the scene behind it, with dispersion across six wavelengths (soft fringes at strong edges only), Fresnel edges, ink on its edges, a lighter shadow. `dispersion` (0.008, crown glass) and `ior` tune it |
| `frosted` | Glass that blurs what's behind it (`roughness` sets how much) |
| `water` | A water surface and volume: refracts with water's index (1.333), turns blue-green with depth, and its top carries moving swells and chop that wobble the refracted picture and break the sun into glints (drive `scene.time`). `ripples` (0.35), `wavelength` (world units), `depthColor` (0.5), `thickness` (default: the body's depth). With a node `opacity` it is an x-ray ghost as before. For water that is the subject (a pool, a glass, the sea) use [`E3.water`](#water) |
| `ghost` | See-through x-ray parts (clear in the middle, denser at the edges) |
| `hot` | Oxidized metal glowing by `temperature` (default 1400 K) |
| any `#rrggbb` | Diagram shading in that color |

The object form is `{ color, metal, roughness, emissive, temperature, opacity }`, plus `base` (start from a named material), `clearcoat`, `anisotropy`, `ior`, `thickness` (glass, world units), and `f0` (measured metal reflectance, linear RGB). An object with `metal` or `roughness` is physically based; `{ color }` alone keeps diagram shading. `{ color, metal: true }` from older pages is a physical metal of that color.

**Temperature.** `temperature` on a node (or material) is kelvin, or a field along a local axis: `{ axis: [0, 1, 0], stops: [[y, T], ...] }` (up to four stops). Metals take temper colors from about 450 K (straw, brown, purple, blue, then grey; inconel 150 K later) and glow by black-body color from about 750 K. `E3.blackbody(T)` returns the glow color as hex, `E3.heatTint(T)` the temper color.

**Pick fidelity by need.** A simple model (a molecule, a geometric construction, a joint drawn to explain one motion) stays in the diagram look: porcelain and the anatomy names as flat diagram colors, ink outlines, no physical materials. It reads faster, prints well, and draws cheaply. Reach for physical materials, `"studio"`, `"outdoor"`, `"night"`, or `"anatomy"` when the figure is about what a real thing looks like: a machine, an organ, a material, a flame.

`E3.dark` is true on a dark page; a figure can pick its look by it in `draw` (`scene.look = E3.dark ? "night" : "outdoor"`).

The house style: nearly everything `porcelain` or a natural material, and only the parts the current paragraph talks about in a subject color. Real machines use real materials: steel, aluminum, inconel, rubber, glass, by what the part is made of.

## Looks

`scene.look` picks the whole light rig in one word: the environment metals reflect, key, fill and rim lights locked to the camera, shadow strength, outline weight, and bloom. Every look adapts to dark pages.

| look | for |
|---|---|
| `"studio"` (default) | Soft boxes on a neutral sweep. Real parts, product shots, machines |
| `"diagram"` | Flatter and lighter, for teaching drawings with only a few physical materials |
| `"night"` | Dark surround, strong cool rim light; glowing parts carry the picture (engines firing, furnaces) |
| `"outdoor"` | Sky dome and a warm sun, firmer shadows (vehicles, buildings, terrain) |
| `"anatomy"` | A soft surgical studio in which the anatomy names (`bone`, `muscle`, `tendon`, `cartilage`, `tissue`, `fat`, `nerve`, `artery`, `vein`, `enamel`) shade as living tissue: light scatters under the surface and wraps past the terminator tinted by blood and fat, thin edges glow when backlit, wet surfaces carry a clear coat, fibers add sheen and stripes. Material objects tune it with `{ base, sss, sssColor, wet, sheen, fibers }` (`fibers` is the local fiber direction). Use it with [bio3d.md](bio3d.md) |

`scene.exposure` (1) brightens or darkens physical materials, `scene.bloom` (`false` or a strength) sets the glow around hot parts, `scene.lights = [{ position, color, intensity, range }]` adds up to two point lights. Physical materials are tone mapped with a neutral filmic curve, so base colors stay true and highlights roll off to white; diagram materials are never tone mapped and look exactly as before.

## Cuts, ghosts, shadows, and light

| scene property | meaning |
|---|---|
| `scene.cutPlane = [nx, ny, nz, d]` | Removes everything where `n · p > d`. Cut solids show a hatched section face, the way technical drawings show cut material. `null` turns it off. Drive `d` from a slider to cut progressively. `{ facing: "camera", at, offset }` cuts through `at` on the side facing the viewer at the moment the cut is switched on, then stays fixed to the model while the reader turns it, like a real cutaway, so dragging never re-slices the parts. `follow: true` re-faces the camera every frame (only for a figure that doesn't turn). `view.kept(p)` is false for a point the cut removed (drop its label), and `view.cut` is the plane used. |
| `scene.shadow` | `true` (default), `false`, or `{ opacity, scale, y, strength, parts, softness, cast }`. Soft shadows from the key light (contact-hardening PCF) fall on an invisible ground and on other parts, over a soft contact shadow. `opacity` is the contact shadow, `strength` the cast shadow on the ground, `parts` (0 to 1) how dark parts shade each other, `cast: false` keeps only the contact shadow. A node with `castShadow: false` casts none. |
| `scene.light` | `"camera"` (default: a studio light that follows the view, so every side looks lit), or a world direction like `[1, 0.2, 0]` (the Sun). |
| `scene.lighting` | `"soft"` (default porcelain shading) or `"sun"` (hard day/night terminator, for planets and phases). |
| `scene.ink` | Outline weight multiplier; `0` turns outlines off. Night and outdoor looks already draw lighter ink; drop to about `0.5` for a photographic scene. |
| `scene.ao` | Ambient occlusion strength, default `0.5`: surfaces crowded by nearer ones (the crease between packed atoms, the inside of a socket) darken a little, so dense models read as solid shapes. `false` turns it off; up to `1` for very crowded scenes. |

Quality is automatic. Still frames are supersampled 2x with full shadow and volume quality. While the view moves or an animation plays, E3 measures the time between frames and picks a tier: `high`, `medium`, or `low` (render scale, MSAA, shadow map size, particle count, plume steps). Phones start lower; desktops start high. A figure's `quality: "low"` (in its `demo` spec), `E3.scene({ quality: "low" })`, or `quality` in the camera forces a tier, and `E3.quality.tier` reads the current one. The runtime tells the engine which frames are still (the frame after a drag, a paused animation), so those always come back at full quality. The page checker always renders at `high`, so screenshots are stable. `E3.stats` (also `scene.stats`) reports the last frame: tier, supersampling, MSAA samples, size, and triangle and particle counts.

Section cuts work best on closed meshes that don't overlap each other. For an "x-ray" view, give the outer parts `opacity: 0.3` and keep the inner parts solid.

## Physical light

For figures *about* light (shadows, brightness, color mixing, bounce light, the sky), use real lights instead of the studio rig. A light with a `type` or a `power` is physical: brightness falls with the square of the distance and the cosine of the angle, its shadow has a dark core and soft edges that harden as the light shrinks, and every shadow, bounce, and beam is ray traced against the scene's triangles. Still frames refine over about half a second (the runtime keeps drawing until `view.converging` is false); dragging shows a lighter, slightly grainy preview.

```js
const scene = E3.scene({ look: "darkroom", units: "m" });           // black room, only these lights
scene.add(E3.mesh.box(2, 0.01, 2), { name: "floor" });
scene.add(E3.mesh.box(0.8, 0.8, 0.02), { name: "wall", position: [0, 0.4, 0] });
scene.lights = [{ type: "rect", position: [0.3, 1.3, -0.3], size: [0.5, 0.25], power: 120 }];
// in draw: light.size = [v.size, v.size / 2]; g.render3d(scene, { ...s.view });
```

| light (`scene.lights`, up to 8) | |
|---|---|
| `{ type: "point", position, power, visible }` | A point; `visible: 0.02` draws a dot of that radius |
| `{ type: "sphere", position, radius, power }` | A glowing ball (a bulb) |
| `{ type: "disk", position, radius, normal or target, power, twoSided }` | A round panel shining toward `normal` (default down) |
| `{ type: "rect", position, size: [w, h], normal or target or rotation, power, twoSided }` | A panel, a window, a screen |
| `{ type: "sun", direction, power, angle }` | Parallel light from far away; `power` is W/m² |

`power` is in watts (default 100), `color` any color (the power stays the same), `on: false` switches it off, `visible: false` hides its shape. Distances use `scene.units` (world units per meter: `"m"`, `"cm"`, `"mm"`, or a number), so a 100 W bulb gives P / (4πr²) W/m² at r meters. The shapes draw themselves at their real brightness: a 1 W bulb looks dim, a one-sided panel is gray from behind. Old `{ position, color, intensity, range }` lights stay the studio's soft point lights.

| scene property | |
|---|---|
| `look: "darkroom"` | Black background (`scene.background` to change, `"none"` for the page), nothing but the scene's lights and sky, diagram materials as ideal matte (Lambertian) surfaces. Other looks add physical lights on top of the studio rig. `exposure` (0.15 in the darkroom) is the camera's: keep it fixed so the reader sees power and distance change brightness. |
| `bounces` | 0 (default) to 6: light bounced between surfaces. 1 to 2 shows a red wall tinting a white floor; each bounce costs another ray. |
| `sky` | `{ color, intensity }`: light from every direction (an overcast sky, the inside of a lampshade); with a tile above a floor it gives the soft, distance-dependent shadow. Or the physical sky (below). |
| `haze` | `{ density, g, color }` (density per meter, 0.05 to 0.5; `g` 0 to 0.9 forward scattering): air that scatters, so beams show and are blocked where something stands in the light. Pair with `matter: "motes"` particles for dust glinting in a beam (motes are dark outside it). |
| `samples` | Frames to refine over (48). |

**Physical sky.** `scene.sky = { sun: { elevation, azimuth } (degrees, or a direction), haze, intensity, altitude, stars }` draws the real sky behind the scene (Rayleigh and Mie scattering, ozone, stars after dusk), lights the scene with it (metals reflect it), and makes the key light the Sun at its real color: white at noon, orange and dim at sunset. Use it with `look: "outdoor"`; in the darkroom it adds the Sun as a traced light. `E3.sunlight(dir)` is the Sun's color for a 2D label.

**Helpers for teaching light.**

| call | gives |
|---|---|
| `E3.photons(scene, light, { count, direction, cone, seed })` | Rays from a light traced through the scene, `[{ from, to, hit }]`; draw with `g.line(view.project(a), view.project(b))` and mark `hit.point` |
| `view.trace(origin, dir)`, `E3.trace(scene, origin, dir)` | The first surface along a ray: `{ t, point, normal, node }` or null |
| `E3.solidAngle(point, normal, light, { radius })` | `omega` (sr), `projected` (cosine-weighted), `share` of the hemisphere's light, and meshes `cap` (the light projected on a hemisphere) and `disk` (that patch flattened on its base) |
| `g.inset([x, y, r], [fx, fy, fr], box => ..., { background })` | A round magnifier joined to the spot it enlarges; draw a closer `g.render3d(..., { box })` inside |

**The Moon.** `E3.moon({ radius, map })`: a procedural near side (the maria in their real places, craters, Tycho's rays) that needs no file, or `map` a real equirectangular photo as a data URL. `moon.at(lat, lon)` as for the Earth.

**The Earth and textures.** `E3.earth({ radius, atmosphere })` is a globe with coastlines (from the maps kit, when Geo is on the page), ice caps, glossy seas that glint, and a thin glow of air; `earth.at(lat, lon)` is a surface point (north +y, longitude 0 toward +z, east +x). Light it with `lighting: "sun"` and `scene.light` toward the Sun. Any part can carry a picture (texture mapping): `material: { map, mapping, mapBox, mapRoughness }`. `map` is a canvas, an image, ImageData, `(u, v) => color`, or a URL / data URL (the figure redraws when it loads). `mapping` is `"sphere"` (an equirectangular map, longitude 0 toward +z: planets, moons, a globe), `"planar"` (the local x-z plane over `mapBox: [x, z, w, d]`: floors, maps, a painting), `"box"` (each face by its axis), or `"project"` with `projector: { position, target, fov, aspect }` (projective texture mapping: the picture is cast like a slide projector onto whatever it hits, blocked by what stands in the way). `mapRoughness: true` reads roughness from the alpha (glossy seas). Pages stay one file: embed a photo with `node scripts/embed-image.mjs photo.jpg --max 1024` and paste the data URL; public-domain maps (NASA's CGI Moon Kit, Blue Marble) are the usual sources, credited in the references.

**Water.** See [water](#water) for a simulated pool or sea.

**Grass.** `E3.grass({ size, count, height, width, color, units, seed, soil, ground })` is a lawn of tapered, curved blades on a block of soil (6 to 14 cm tall by default); `lawn.wind` is the wind in m/s (the bend grows with v², gusts roll across at the wind's speed), `lawn.windDirection` `[x, z]`, `lawn.push = [x, y, z, radius]` parts the blades around something passing through. Drive `scene.time`. About 9,000 blades per 40 cm square; blades are two-sided and translucent when backlit.

## Water

`E3.water(options)` is a body of water with a simulated surface, for any figure where the water itself is the subject: a pool, a pond, a glass, the open sea. The `water` material is still the cheap choice for water that only needs to look wet in passing.

```js
const scene = E3.scene({ look: "outdoor", units: "m" });
scene.sky = { sun: { elevation: 58, azimuth: 35 } };
const pool = scene.add(E3.water({ size: [4, 2.6], depth: 1.4, ripples: 0.0005 }));  // a tiled pool, level at y = 0
const ball = scene.add(E3.mesh.sphere(0.13), { material: { color: "#e2533b", roughness: 0.35 } });
pool.objects = [ball];                                  // it pushes the water aside as it moves
pool.drop([0.6, -0.4], { r: 0.03, amp: -0.006 });       // in draw or a click: a drop, now
// in draw: scene.time = s.t;
const sea = E3.water({ mode: "ocean", size: 600, wind: 9, windDirection: [0.3, 1] });
```

Both modes solve linear waves exactly in Fourier space, so every wavelength travels at the speed water gives it, ω² = (g k + σk³/ρ) tanh(k h): a drop spreads as a ring whose short ripples and long waves separate as they should, and long waves in shallow water run at √(g h). A pool's walls reflect (its field is mirrored at the walls); waves die by water's viscosity plus `damping`. The sea is Tessendorf's statistical ocean: a Phillips spectrum for the wind, scaled to the fully developed sea (significant height 0.21 U²/g), choppy crests, two cascades so nothing visibly repeats, and the slopes too small to draw become roughness (Cox and Munk's measured slope variance). Everything is deterministic: the same `seed`, drops, and `scene.time` give the same water, and scrubbing time backward replays the drops.

| option | |
|---|---|
| `mode` | `"pool"` (default) or `"ocean"` |
| `size`, `depth`, `units` | Width or `[w, d]` and depth in world units; `units` as for particles (`"m"`, `"cm"`). Default pool 2 x 2 x 1.5 m, sea 400 m |
| `shape`, `meniscus` | `"round"` for water in a glass or a round tank (the surface is a disk); `meniscus: { height, length }` lifts it at the wall (about 0.3 cm over the capillary length, 0.27 cm, for clean glass) |
| `basin` | A pool's tiled shell, coping, and paved deck (default on for square pools; `deck`, `coping`, `tile`, `freeboard` tune it). The water ray-traces its own basin, so refraction shows floor that the walls hide from a dry view |
| `ripples`, `rippleLength` | A pool's standing wind ripples: rms height (0.0005 m is a breezy day) and typical wavelength (8 cm) |
| `rain` | Drops per second over the whole surface |
| `wind`, `windDirection`, `waveHeight`, `choppy`, `patch` | The sea: wind in m/s and its direction `[x, z]`; `waveHeight` overrides the significant height |
| `body` | `"clear"` (pool), `"sea"`, `"pond"` (dissolved plant matter and silt), or set `absorb` and `scatter` per meter |
| `caustics`, `reflections`, `foam`, `shore` | Caustics on the floor (pool, default on), screen-space reflections (on), foam on breaking crests (sea), foam where the water thins to `shore` world units |
| `resolution`, `seed`, `tension`, `damping` | Sim cells across (256 on desktops, 128 on phones), random seed, surface tension, extra damping per second |

`depth` and the node's `position` can change every frame (a glass filling, a level that rises as water warms).

`water.drop(point, { r, amp, time })` drops a crater of radius `r` and depth `amp` (negative is a dip) at `[x, z]` in the water's own coordinates or a world point; `water.objects` lists nodes that push the water as they move; `water.heightAt(x, z, t)` is the CPU height for labels; `water.clear()` removes the drops. `E3.water.omega(k, depth)` is the dispersion relation.

How it looks: Fresnel (n = 1.333) between reflection (the sky or studio, the physical `scene.sky`, and the scene where a reflected ray finds it on screen) and refraction of what's below (marched against the depth buffer, so a straw or a leg bends at the surface); Beer–Lambert absorption by water's measured spectrum along the real path, down from the surface and back up (Pope and Fry 1997: red about 0.45 /m, green 0.07, blue 0.015), so depth turns a white floor cyan and then blue; light scattered back out of the water; sharp sun glints; caustics computed from the simulated surface (each cell's sunlight spread over the area it lands on) on the floor and on anything under the surface. Anything under the water's level is dimmed and tinted by the water the light crossed on its way down. Seen through a tank's side from below the level, the surface is a mirror outside Snell's window. Where nothing is drawn behind the water (a glass on an empty page), it refracts the page itself.

Keep the water unrotated (move it, don't turn it). One water body per scene lights what's under it (caustics and tint). A pool with a basin and the sea turn off the ground's contact shadow. Use `"outdoor"` with a `scene.sky` or a fixed `scene.light`: caustics follow the Sun, and a camera-locked studio light would move them as the view turns. Cost at 1280 x 800 on a laptop GPU: about 1.6 ms to simulate a 256² pool and 2 ms to shade it; the sea about 3.5 ms in all. Moving frames use fewer ray-march steps and a coarser drawn grid. Needs float render targets; without them the surface falls back to the `water` material.

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
| `focal`, `fNumber`, `focus` | A real lens: focal length in mm (sets the field of view on a 36 x 24 mm sensor when `fov` isn't given), f-number, and focus distance (world units; default the target). Depth of field is rendered for real (the view is averaged over the aperture), so blur grows with distance from the focus plane, with occlusion right. At real sizes it's subtle; `aperture` (diameter, world units) exaggerates it for teaching. |

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
  matter: "smoke", units: "m", count: 800, seed: 4, ground: 0,
  emitter: { shape: "disk", radius: 0.2, position: [0, 0.3, 0], speed: [0.5, 1.2], spread: 0.3 },
  forces: { wind: [0.4, 0, 0] },
}));
const plume = scene.add(E3.plume({ radius: 0.45, length: 4.3, fuel: "kerosene" }), { position: nozzleExit });
// in draw: scene.time = s.t; plume.throttle = v.throttle;
```

**Every particle moves by the physics of what it is.** Give a system its `matter` and its `units` (world units per meter: `"m"`, `"cm"`, `"mm"`, or a number), and E3 sets the forces from real numbers: gravity and the drag that brings a falling thing to its terminal speed in still air, Archimedes' lift on hot gas, `g (T - Ta) / T` at its birth `temperature`, fading as it mixes and cools, and eddies the size and speed of real air swirl. It also sets the look (style, size growing as it entrains air, color, life) and how it meets a collider. Anything you pass yourself wins, so `forces: { wind }` or a different `temperature` adjusts the preset without breaking it. `ground: y` adds a floor collider with the matter's bounce.

| matter | moves like | numbers |
|---|---|---|
| `"smoke"` | rises from a fire, slows as it cools and mixes, spreads along a ceiling or floor, rides the wind | 600 K at birth, lift 5 m/s², entrainment drag 1.6/s |
| `"exhaust"` | hot engine exhaust: strong lift, big slow eddies | 1100 K, lift 7 m/s² |
| `"steam"` | rises gently, white, gone in seconds as it evaporates | 373 K, lift 2 m/s² |
| `"fire"` | flame gas: fast rise, short life, black-body glow | 1300 K, about 2 m/s rise |
| `"dust"` | falls slowly through the air, rides every eddy, stays where it lands | terminal 0.3 m/s |
| `"mist"` | fine spray: hangs, drifts, settles slowly | terminal 0.25 m/s |
| `"sand"` | grains thrown in arcs, settle quickly | terminal 2.5 m/s |
| `"water"` | drops in near-ballistic arcs, splash a little and run | terminal 5.5 m/s |
| `"rain"` | falls straight and fast | terminal 8.5 m/s |
| `"snow"` | drifts down, swirling | terminal 1 m/s |
| `"spark"` | hot metal: flies in arcs, cools from white to red, skips | terminal 7 m/s |
| `"ember"` | carried up by the fire's heat, then drifts and falls | terminal 1.5 m/s |
| `"bubble"` | rises through water at a steady pace, wobbling | 0.25 m/s up |
| `"air"` | massless tracer: goes exactly where the air goes | follows `wind` or a `flow` |

Choose the matter instead of tuning forces by hand. Hand-tuned forces are how smoke ends up hanging in one place, dust floating, or water drifting like gas. Then set the emitter from the source: a fire's smoke leaves at about 1 m/s, a jet's exhaust at its exit speed, a splash at the speed of what hit the water. A jet's momentum outlasts its lift for hundreds of meters (Morton's jet length), so exhaust leaving an engine streams away from the nozzle with `buoyancy: 0` inside the frame. It only billows and rises where it hits the ground or once it has slowed far downstream. Particles that collect in one spot, sit still mid-air, or fall when they should rise are a bug: fix the matter, units, or emitter. `E3.matter` lists the presets and their numbers.

Particles run on the GPU (transform feedback) and are depth tested against the solids. Drag is solved exactly over each step, so stiff drag (dust, bubbles) stays stable. They are deterministic: a particle's birth, speed, and life come from a hash of `seed`, slot, and generation, and the state steps on a fixed time grid, so the picture at `scene.time` (or the system's own `time`) is the same every time. Drive time from the figure's `step`; nothing moves by itself, so reduced motion is respected.

| option | meaning |
|---|---|
| `count`, `seed`, `life: [min, max]` | Slots, random seed, life in seconds (`Infinity` for gas molecules that never die) |
| `style` | `"smoke"` lit puffs: two octaves of noise, self-shadowed toward the light, shadowed by the scene, glowing at thin edges when backlit, lit through by nearby flames; `"fire"` additive black-body glow; `"spark"` additive ribbons; `"streak"` tracer ribbons that follow the path just travelled (in a `flow`, they bend with the streamline); `"sphere"` lit balls with ink (molecules); `"dot"` flat discs |
| `emitter.shape` | `"point"`, `"disk"`, `"ring"`, `"cone"` (`angle`), `"sphere"`, `"box"` (`size`), `"line"` (`from`, `to`), `"mesh"` (`mesh`: area-weighted surface points) |
| `emitter` | `position`, `direction`, `radius`, `speed: [a, b]`, `spread` (cone half-angle), `thermal` (Gaussian velocity, for gases), `along: "normal" or "radial"`, `rake` (lanes, for tracer lines) |
| `matter`, `units`, `ground` | Physical preset (above), world units per meter, a floor collider at that height |
| `forces` | `gravity`, `drag`, `wind`, `buoyancy`, `turbulence: { strength, scale, speed }` (curl noise), `vortex: { center, axis, strength, core }`, `attractors: [{ position, strength, radius }]` |
| `colliders` | `{ plane: [nx, ny, nz, d], bounce, friction, velocity }` keeps particles where n·p ≥ d; `{ sphere: [x, y, z, r], inside }` |
| `flow` | Tracers follow ideal flow instead of forces: `{ type: "airfoil", chord, thickness, camber, alpha }`, `{ type: "cylinder", radius, circulation }`, or a tube flow; `E3.flow.airfoil(o)` gives the same field plus `outline()` for the wing mesh and `lift` |
| `size: [start, end]`, `opacity`, `fade: [in, out]`, `color` (or `[a, b]`), `colorBy: "speed"` with `range`, `temperature: [T0, T1]` (fire, and hot smoke), `glow` (smoke: how much its soot glows by `temperature` while young, 0 to 1), `density` (0 to 1, drawn share: throttle) | Look |
| `trail` (seconds of path behind the head), `width` (world units), `segments` (ribbon segments, 10 for streaks) | Ribbons (`"streak"`, `"spark"`) |
| `cpu: true`, `measure: true` | Simulate on the CPU; `measure` fills `system.hits[i]` with the momentum per second delivered to collider `i` (pressure = hits / wall area) |
| `volume: true` or `{ ... }` | Draw a `"smoke"` or `"fire"` system as a continuous medium instead of sprites (below) |

**Volumetric smoke, dust, steam, and fire.** With `volume`, each frame the particles are splatted into a 3D density grid on the GPU (a puff thins as it grows), a second grid holds how much key light reaches each cell, and the view ray is marched through it at part resolution: billow noise erodes the thin edges (cauliflower billows, not blobs), light scatters toward the eye with a two-lobed phase (bright when backlit), thick smoke shadows itself and stays lit inside by a multiple-scattering term, flames and plumes light it with distance falloff and occlusion, and young soot glows by black-body color (`glow`, `temperature`). A depth-aware upsample composites it with no halo around solid parts, and plumes are split so the flame sits inside its smoke. Options: `density` (1), `erosion` (0.6), `detail` (noise frequency per world unit), `flow` (drift velocity of the detail; default the wind and the rise), `ambient` (0.8), `shadow` (1), `powder` (0.5), `occlusion` (0.25), `hot` (share of life the soot glows: 0.3, fire 1), `thin` (1), `resolution` (cells along the longest side: 36 to 60 by device), `bounds` (default: found by simulating the system), `albedo`. `opacity` is the density at birth. With `style: "fire"` the medium only emits. Needs float render targets; without them the system falls back to sprites. Use about a thousand to fifteen hundred particles; the medium fills the gaps.

`impact: true` (or a distance along the jet) makes the plume hit the plane `y = ground` (0): the jet bulges near it, turns along it as a hot ragged sheet that cools outward (`splash` scales its radius), and the second plume light moves into the splash to light the pad and the cloud from below. `profile: [[radius, distance, temperature], ...]` (up to 24 stations from the origin down the axis) turns a plume into the burning gas inside a duct: it fills the profile to its walls and is seen through a section cut (it obeys `scene.cutPlane`). Plumes are marched at part resolution and upsampled by depth.

**Heat shimmer.** Hot gas bends the light from what's behind it. Every lit plume shimmers on its own; `scene.shimmer = [{ from, to, radius: [r0, r1], strength }]` adds a tapered zone in world space (a jet engine's core exhaust, a hot road, a chimney), with `strength` in pixels (2 to 3). Solids seen through the zone waver with noise that drifts along it; the zone itself draws nothing. `shimmer: false` on a plume turns its own off.

**Tube flows** (`E3.flow.tube(spec)`, `flow: spec` on tracers): air in axisymmetric stream layers between surfaces of revolution, for engines, ducts, nozzles, and pipes. The spec samples five boundary radii along the axis (`rows: [[c0, c1, b0, b1, x0, heat], ...]` from `y0` every `dy`: a core layer, a bypass layer, and the outside air beyond `x0`), with each layer's volume flux in `q` and the free-stream speed `U0`; `matrix` places it. Within a layer the stream function is linear in r², so the axial speed is flux over area (air speeds up where a duct narrows), the streamlines follow both walls exactly, and tracers can't cross a wall. `heat` scales the core's volume flow where gas expands. `E3.parts.turbofan` builds one from its own surfaces (`airflow()`).

`E3.plume({ radius, length, throttle, temperature, fuel, cells, spread, turbulence, intensity, expansion })` is a ray-marched exhaust: exit at its origin, flowing down -y, with a hot core, Mach diamonds every `cells` exit diameters, a mixing layer whose eddies grow downstream, an afterburning sheath where fuel-rich exhaust meets air, soot that absorbs, a slow flicker, and emission by temperature (`fuel`: `"kerosene"`, `"methane"`, `"hydrogen"`, `"solid"`). `expansion` is exit pressure over ambient (0.8): below 1 the jet necks in and the diamonds are strong, at 1 they nearly vanish, above 1 the plume balloons; throttling down lowers it. The plume lights nearby parts and smoke with two point lights (one at the nozzle, one down the jet). Smoke in front of a plume's midplane draws over it and smoke behind draws under it, so the flame sits inside its smoke; the same particle system is split in two draws.

Keep particle counts to what the figure needs: a pad firing reads well with about 2,000 smoke sprites at opacity 0.2 to 0.3, a campfire with 900. Each ribbon costs its `segments` twice over in vertices.

### Backends

Particles step on one of three integrators with the same physics, hashes, and time grid, so a seed gives the same picture on each, within float rounding. WebGL2 draws all of them.

| backend | used | |
|---|---|---|
| `"webgpu"` | with a hardware WebGPU adapter (the default there) | A compute shader: each slot is a thread that runs a whole run of steps in one dispatch. Re-simulating (a jump in time, a slider that changes the forces) is 2 to 2.7 times faster than transform feedback; a running frame costs about the same. The state comes back without stalling, so a running system is drawn a frame behind its clock and a still one settles on exactly its time. Transform feedback draws it until the first copy is back. |
| `"webgl2"` | everywhere else, and in the checker (SwiftShader has no WebGPU) | Transform feedback. |
| `"cpu"` | `cpu: true`, `measure: true`, Node | The reference integrator. |

`E3.backend` reads what's in use; setting it forces one for the page (`"auto"` undoes it). A system's `backend` option overrides it, and `?backend=webgl2` in the page URL (or `window.SAFIS_BACKEND` set before the scripts) forces one for a test. A software adapter is skipped unless forced. `E3.webgpu` describes the device (`state`, `name`, `errors`, `ready`), and `await E3.webgpu.sync(system)` waits for a system's copy. On an M3 Pro, 100,000 smoke particles step and draw at 60 fps on either GPU backend with small puffs; big lit puffs are limited by fill rate, not stepping. `node tools/time-backends.mjs --gpu` times every lab figure on each backend.

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

- **Engine firing at a pad.** `E3.parts.rocketEngine()` on a frame above a `concrete` pad, `look: "night"`; a plume at `eng.ports.nozzleExit` with `radius: exit.radius` and `length` reaching the ground; smoke from a `ring` emitter at the impact point, `along: "radial"`, `speed` several meters per second, `glow: 0.9` with `temperature: [1500, 450]` so it starts orange and cools to grey, low `buoyancy`, a `wind`, a floor `plane` collider, and a `sphere` collider around the jet so the blast keeps the smoke out of it. Drive `plume.throttle` and `smoke.density` from one slider. (The home page and the rocket-engine explainer do this.)
- **Fire and smoke in one system.** A `"fire"` system with a short `life` and `temperature: [2100, 1100]` for the flame, and a `"smoke"` system from the same spot with `glow: 0.6`, `temperature: [1500, 400]`, `buoyancy`, and `turbulence`; a steel pole nearby shows the smoke's shadow.
- **Air past a wing.** `E3.flow.airfoil(o)` for the field and its `outline()` for the wing mesh; a `"streak"` system with `flow: o`, a `box` emitter upstream with `rake` lanes, `trail: 0.45`, `segments: 14`, `colorBy: "speed"`, and a `kill` box past the trailing edge. Change `alpha` by assigning `air.flow` and rebuilding the wing.
- **Air through an engine.** One `"streak"` system per stream: a `ring` emitter on the inlet port moving in, another on the fan nozzle annulus and one on the core nozzle moving out (`forces: { drag, wind }`), colored `blue` and `orange`, with `density` from the throttle.
- **Gas in a cylinder.** `"sphere"` particles with `life: Infinity`, a `box` emitter with `thermal`, six `plane` colliders with `bounce: 1`, `cpu: true, measure: true`; pressure on wall i is `system.hits[i]` over its area, and a slider moving one plane's `d` is the piston.

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
