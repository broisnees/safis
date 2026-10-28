# E3.parts: machine parts and assemblies

`E3.parts` builds machines that look like real hardware: parametric parts (nozzles, pumps, pipes, flanges, bolts, bearings, blades, stages, nacelles) and finished assemblies with named moving parts, explode offsets, label anchors, and ports. Use it for any figure that shows a machine or device in 3D. Read [engine3d.md](engine3d.md) first; this file only covers what the parts add.

Contents: [conventions](#conventions), [assemblies](#assemblies), [parts](#parts), [helpers](#helpers), [recipes](#recipes), [building a new machine](#building-a-new-machine), [what makes a machine look fake](#what-makes-a-machine-look-fake), [pitfalls](#pitfalls).

## Conventions

- **Units are millimeters.** Engines come out a few thousand units tall; E3 frames any size.
- **Round things turn about y**, like `E3.mesh.lathe`. Angles run counterclockwise seen from +y. A part that needs another axis gets a node `rotation`, or a matrix from `E3.parts.aim(point, direction)`.
- **Parts return a mesh or a group node** whose children are named meshes (`flange.find("...")`). Every closed part is watertight with outward normals, so section cuts hatch correctly.
- **Materials are names**: `porcelain`, `ceramic`, `steel`, `brushed`, `aluminum`, `titanium`, `copper`, `brass`, `inconel`, `carbon`, `rubber`, `paint`, `glass`, `ghost`, `hot`. Assemblies assign them the way the real hardware is made (titanium fan blades, an aluminum fan case, an Inconel nozzle and turbines, steel flanges and bolts, brushed pipes). Painted covers (nacelle, cowls, cam cover, gearbox and motor housings) default to `porcelain`; `paint` is an off-white gloss, so give it a `color` when the paint color is the point. Override one role with `materials: { nozzle: "copper" }`, or pass `plain: true` for an all-porcelain model and color only the part the paragraph is about with `node.material = "blue"`.
- **`detail`** (0.4 to 1, default 1) on any assembly scales every segment count, blade section, and fastener inside it: `E3.parts.turbofan({ detail: 0.6 })` draws about 60% of the triangles. Use it for a second assembly in one figure, or for a figure where the machine is small on screen.

## Assemblies

Every assembly is a group node: `scene.add(asm)`. They share one interface:

| member | meaning |
|---|---|
| `asm.pose(state)` | Drives the moving parts from one kinematic state (fields per machine, below). Returns `asm`. |
| `asm.explode(t)` | 0 assembled, 1 fully apart; each part moves along its own direction. Returns `asm`. |
| `asm.labels()` | `[{ text, at, node }]` with `at` in world coordinates: `g.callouts(asm.labels().map(l => ({ at: view.project(l.at), text: l.text })))`. Hidden parts are skipped, and labels of parts inside a casing (`inside: true`) come back only while the assembly is open (`cutaway(true)`), so a closed machine doesn't label what can't be seen. |
| `asm.cutaway(on)` | Swaps the casings for versions with a wedge cut out and sets `asm.open`. The turbofan cuts its nacelle, fan case, and core casings; the rocket engine opens both turbopumps' pump, bearing, and turbine housings so the rotors show; the pump opens its volute. |
| `asm.parts[name]` | Named nodes, for `highlight`, `visible`, `material`, picking. |
| `asm.notes[name]` | One line per part, for a hover readout. |
| `asm.ports.<name>` | Openings as `{ center, normal, radius }` in world coordinates (normal points out of the machine), for particles and effects. |
| `asm.info` | Numbers the model was built from (radii, ratios, displacement). |

| builder | key options | pose | ports and extras |
|---|---|---|---|
| `rocketEngine(o)` | `throat` [110], `expansion` [16], `contraction` [3], `pumpSize`, `tubeCount` [84], `gimbalRange` [6°] | `{ pitch, yaw, spin, fuelSpin }` (radians) | `nozzleExit`, `oxidizerInlet`, `fuelInlet`; `gimbal` (current angles), `rotors` (both pump rotor groups, also `shafts`), `pumps`, `cutaway(on)` (opens the pump housings) |
| `turbofan(o)` | `fanRadius` [900], `fanBlades` [18], `cutaway`, `pylon`, `testStand` (only when the stand is part of the story) | `{ low, high }` spool angles | `inlet`, `fanFace`, `fanNozzle` and `nozzle` (with `inner` radius); `spools.low`, `spools.high`, `cutaway(on)`, `mounts.forward()`, `mounts.aft()` |
| `turbopump(o)` | `impeller` [75] (impeller radius), `vanes` [6], `turbineBlades` [56], `cutAngle` (where the cutaway wedge faces) | `{ spin }` | `inlet`, `discharge`, `turbineInlet`, `exhaust`; `rotor`, `cutaway(on)` |
| `pistonEngine(o)` | `cylinders` [4], `bore` [86], `stroke` [86], `rod`, `firingOrder`, `valveAngle` [20°] | `{ crank }` (cams follow at half speed) | `output` (flywheel); `cylinders`, `lift(cylinder, "intake" or "exhaust", crankAngle)` |
| `gearbox(o)` | `ratio` [12.25], `module` [3], `pinion` [17 teeth], `centerDistance` | `{ input }` (radians; the other shafts follow the tooth counts, teeth stay meshed) | `input` (+z end), `output` (-z end); `shafts`, `info.teeth`, `info.ratio`, `info.stages` |
| `electricMotor(o)` | `frame` [132] (IEC shaft height, mm; sets every other size), `poles` [4], `fins` | `{ spin }` | `shaft` (+x end); `rotor`, `info.syncRpm`, `info.span` |
| `pump(o)` | `impeller` [100] (radius), `vanes` [6], `motor` [false] (adds an `electricMotor` on the same base), `motorFrame` [132] | `{ spin }` (the motor follows) | `inlet` (+x, on the axis), `discharge` (straight up); `rotor`, `motor`, `info.shaftHeight` |
| `bicycleDrivetrain(o)` | `chainrings` [[50, 34]], `cogs` [11 to 32, eleven], `crank` [172.5], `chainstay` [410], `chainPhases` [6] | `{ crank, ring, gear }`: crank angle (forward is counterclockwise seen from the drive side), chainring index, cog index (0 is the smallest); the cassette, jockey wheels, chain, cage, and parallelogram follow | `cassette`, `cageAngle`, `info.ratios[ring][gear]`, `info.development` (meters per crank turn), `info.chainLinks` |
| `turbine(o)` | `stages` [6], `hub` [170], `bladeHeight` [34] to `exitHeight` [150], `stagePitch` [125] | `{ spin }` | `inlet` (up, from the nozzle box), `exhaust` (down, from the hood); `rotor`, `stages`, `info.bladeHeights` |

The rocket engine stands with its nozzle exit on y = 0. The turbofan's axis runs along +x with the fan face at x = 0, so air flows left to right. The piston engine's crank runs along x at the origin with the cylinders up. The gearbox's shafts run along z in the split plane y = 0, input on the left. The motor, pump, and turbine run along +x with their feet on the ground below the axis (the motor's at y = -frame). The bicycle has its bottom bracket at the origin, faces -x, and has its drive side toward +z.

Each new machine is built from real numbers: the gearbox from its module and tooth counts (a driven gear with an even count is turned half a pitch so its gap meets the pinion's tooth), the motor from the IEC frame table, the pump from its impeller radius, the bicycle from 1/2" chain pitch (sprocket radius = pitch / 2 sin(π/teeth)), chain length from the big-big combination plus two links, and the derailleur cage angle solved so the chain path equals the chain, and the turbine from blade heights that grow geometrically as the steam expands.

**Firing and the inside.** `rocketEngine` has `fire(throttle, { impact, ground, fuel, splash })`: an exhaust plume at the exit and the burning gas inside the chamber and bell (`gasPath()`: radius and temperature from the injector to the exit, isentropic through the bell), both on the gimbaled engine so they swing with it; `fire(0)` puts it out. With `scene.cutPlane = { facing: "camera", at }` and `cutaway(true)` the reader looks into the chamber while the pumps turn (`pose({ spin, fuelSpin })`).

**Air through a turbofan.** `turbofan` has `airflow({ speed, freestream })`, a tube flow built from its spinner, hub, core ducts, splitter, core cowl, nacelle, and jets, and `airflowEmitters(spec)`, emitters far upstream for the core, bypass, and outside layers. Feed each to a `"streak"` system with `flow: spec`; the tracers bend into the inlet, split at the splitter in the bypass ratio, speed up through both nozzles, and never pass through a wall.

## Parts

| builder | makes |
|---|---|
| `bellNozzle({ throat, expansion, lengthFraction, wall, tubes: { count, from, to } })` | Rao 80% bell (throat at y = 0, exit at y = -length) with a regen tube jacket, manifold, stiffeners, lip. `.contour`, `.exit`, `.outerRadiusAt(y)` |
| `combustionChamber({ throat, contraction, convergence, lstar })` | Cylinder, 1.5 Rt arc into the throat, bolted top flange; length from L*. `.info` |
| `injectorPlate({ radius, outer, pitch })` | Plate with rings of coaxial elements (dark orifices) |
| `impeller({ radius, vanes, exitAngle })`, `volute({ radius, y })` | Backswept centrifugal impeller with splitters; a hollow spiral casing whose area grows with angle |
| `pipe(points, { radius, bend, flanges, bolts })` | Hollow pipe through 3D points with true bend radii, a flange and bolt ring at each end. `.path`, `.ends` |
| `flange({ pipe, bolts })`, `bolt({ d, length })`, `nut({ d })`, `washer({ d })`, `boltCircle(n, radius, o)` | Weld-neck flange with B16.5 proportions; hex fasteners with threads and chamfers |
| `bracket(o)`, `gimbal({ size })`, `actuator({ bore, length, stroke })`, `strut(a, b)` | L bracket with fillet and gusset; universal joint (`set2(pitch, yaw)`); linear actuator (`span(a, b)`); rod-end strut |
| `tank({ radius, length, dome })` | Hollow tank with elliptical domes, weld lands, ports |
| `blade({ span, chord, twist, airfoil, sweep })` | NACA 4-digit sections lofted with twist and taper |
| `rotorStage(o)`, `statorStage(o)`, `spinner(o)`, `nacelle(o)` | n blades on a disk (optional tip shroud); vanes between bands; ogive or elliptical nose cone; nacelle with inlet lip and fan nozzle (`arc` cuts a wedge open) |
| `bearing({ bore, outer })`, `shaft({ steps, bore })`, `spring(o)`, `gear(o)`, `bellows(o)`, `valve({ pipe })`, `harness(points, o)`, `housing(o)` | Ball bearing (rings, balls, cage); stepped shaft with fillets; spring with closed ends; E3's gear with a hub; flex joint; inline valve with actuator; wire bundle with ties and connectors; hollow casing |

Values that vary along a span (`chord`, `twist`, `thickness`, `camber`) take a number, `[root, ..., tip]`, or `s => value`.

## Helpers

`revolve(profile, { loop, arc, start })` revolves `[[r, y], ...]` (a closed outline with `loop: true`; `arc` leaves a capped wedge). `fillet(points)` rounds corners given as `[x, y, radius]`. `route(points, bend)` makes a centerline with true bends; `tube(path, rOuter, rInner)` sweeps a hollow tube. `naca(code)`, `loft(section, map)`, `bellContour(o)`, `beltPath(circles)` and `belt(path)`, `chain(path3, { pitch, phase })` (a roller chain of real 1/2" proportions along a closed 3D path, `phase` 0 to 1 slides the links one pitch), `liftPath(beltPath, zs)` (lifts a belt path into 3D with each circle in its own z plane), `flip(mesh)` (inner skins), `aim(point, dir)`, `along(path, s)`, `highlight(asm, names)`.

`assembly(name)` is the base of every machine above, and the way to make a new one:

```js
const press = E3.parts.assembly("hydraulic press");
press.part("frame", frameMesh, { material: "paint", label: "frame", note: "the C-frame takes the load" });
const ram = press.part("ram", E3.parts.actuator({ bore: 120, length: 600 }), { explode: [0, 300, 0], label: "ram" });
press.port("die", press, [0, 0, 0], [0, 1, 0], 150);
press.onPose = s => ram.span([0, 900, 0], [0, 900 - 300 - s.stroke, 0]);
```

`part(name, meshOrNode, { parent, position, rotation, material, explode, label, note })` adds a named part; `label` is text or `{ text, at, inside, when }` with `at` in the part's own frame, `inside: true` for a part a closed casing hides, or `when: asm => bool` for any other rule. `cutPart(name, make, { arc, start, ...opts })` adds a casing built twice by `make(revolveOptions)`, whole and with a wedge removed, that `cutaway(on)` swaps. For parts the pose moves, call `asm.home(node, position)` or `asm.homeMatrix(node, matrix)` so explode offsets still apply.

## Recipes

**Rocket engine: orbit, cut, explode, gimbal, labels.**

```js
const scene = E3.scene({ shadow: { opacity: 0.12 } });
const eng = E3.parts.rocketEngine();
scene.add(eng);
demo("engine", {
  aspect: w => (w < 560 ? 0.8 : 1.25),
  orbit: { yaw: 0.5, pitch: 0.18 },
  state: () => ({ spin: 0 }),
  controls: [{ key: "cut", label: "Cut open", min: 0, max: 1, step: 0.01, value: 0 }, { key: "apart", label: "Take apart", min: 0, max: 1, step: 0.01, value: 0 }, { key: "pitch", label: "Gimbal", min: -6, max: 6, step: 0.1, value: 0, unit: "°" }],
  step(dt, s) { s.spin += dt * 3; },
  status: (s, v) => `gimbal ${v.pitch.toFixed(1)}°`,
  draw(g, s, v) {
    eng.explode(v.apart).pose({ pitch: (v.pitch * Math.PI) / 180, spin: s.spin });
    scene.cutPlane = v.cut > 0 ? [0, 0, 1, 700 * (1 - v.cut)] : null;
    const view = g.render3d(scene, { ...s.view, fov: 26 });
    g.callouts(eng.labels().map(l => ({ at: view.project(l.at), text: l.text })));
  },
});
```

An exhaust plume attaches at `eng.ports.nozzleExit`: project its center and draw the effect along its normal.

**Turbofan: spools at two speeds, quarter cutaway.** Same shape as above, with `E3.parts.turbofan({ cutaway: true })`, a toggle that calls `tf.cutaway(v.cut)`, and `step(dt, s) { s.low += dt * 0.8; s.high += dt * 2.6; }` feeding `tf.pose({ low: s.low, high: s.high })`. Airflow particles start on the `tf.ports.inlet` disc and leave through `fanNozzle` (an annulus: `inner` to `radius`) and `nozzle`. `tf.info.bypassRatio` is the bypass to core annulus area ratio at the splitter.

**Exploded turbopump.** `const tp = E3.parts.turbopump({ impeller: 75 })`, a "Take apart" slider into `tp.explode(v.apart)`, and `tp.pose({ spin: s.spin })` from `step`. Hover readouts: `view.pick(p)`, then `tp.notes[hit.node.name]` (walk up `hit.node.parent` until a name has a note).

**Piston engine: crank, valves, section.** `const pe = E3.parts.pistonEngine()`; drive `pe.pose({ crank: s.t * 4 })` from `step`. A section across cylinder 1 (`scene.cutPlane = [1, 0, 0, pe.cylinders[0].x]`) shows piston, rod, crank throw, both valves, and both cams together. `pe.lift(1, "intake", angle)` gives valve lift for a plot beside it.

**Rocket pumps spinning.** `eng.cutaway(true)` opens both turbopumps; `eng.pose({ spin: s.t * 40 })` turns their rotors (the fuel pump 1.35 times faster unless `fuelSpin` is given), and `eng.rotors` are the two rotor groups for highlighting.

**Gearbox: lift the cover, turn the input.** `const gb = E3.parts.gearbox({ ratio: 12 })`, a "Lift the cover" slider into `gb.explode(v.lift)` (the cover, bolts, and gasket rise; the shafts stay), and `gb.pose({ input: s.t * 6 })` from `step`. Label the shafts from `gb.labels()`; `gb.open = true` adds the gear labels while the cover is off.

**Pump and motor.** `E3.parts.pump({ motor: true })` builds the pump set on one base; `pump.cutaway(true)` opens the volute to show the impeller, and particles from `pump.ports.inlet` to `pump.ports.discharge` show the flow.

**Bicycle gears.** `const bk = E3.parts.bicycleDrivetrain()`, a "Gear" stepper 0 to 10 and a "Chainring" switch into `bk.pose({ crank: s.t * 2, gear: v.gear, ring: v.ring })`: the derailleur moves the chain across the cassette, the cage swings to take up the chain, and the cassette turns at `bk.info.ratios[ring][gear]` times the crank. The first visit to each combination builds that chain path (about 100 ms), so sweep the gear control once in a warm-up if the figure must never stall.

**Steam turbine.** `const tu = E3.parts.turbine({ stages: 7 })`, "Lift the top" into `tu.explode(v.lift)`, and `tu.pose({ spin: s.t * 50 })`. A cut plane through the axis (`scene.cutPlane = [0, 0, 1, 0]`) shows the flow path widening stage by stage; `tu.info.bladeHeights` gives the numbers for the caption.

## Building a new machine

1. **Research real dimensions.** Find a spec sheet, a drawing, or a cutaway photo with a scale, and write down 10 to 20 numbers: overall size, bore, stroke, diameters, blade counts, wall thicknesses. Use real ratios, not round guesses.
2. **List 40 or more named parts** before any geometry: housings, covers, shafts, bearings, seals, fasteners, pipes, brackets, sensors, harnesses. The list decides how real the model looks.
3. **Map each part to a builder**: round parts to `revolve` or `shaft`, plates to `E3.mesh.extrude`, plumbing to `pipe`, joints to `flange` and `boltCircle`, blading to `rotorStage` and `statorStage`. Build anything new with `revolve`, `loft`, or `Soup`, and keep it closed.
4. **Assign materials by what each part is made of** (cast housings `aluminum`, shafts and fasteners `steel`, hot sections `inconel`, tubing `brushed`, seals and wiring `rubber`, painted covers `porcelain`), then keep color for the parts the text names.
5. **Drive every moving part from one kinematic model** in `onPose`: one crank angle, one shaft angle, one gimbal pair. Gears mesh from tooth counts, rods from the slider-crank formula, valves from the cam profile.
6. **Add the views**: a cut plane or `arc` wedge for the inside, `explode` vectors along each part's natural removal direction, `label` anchors on each part's visible surface, ports for effects.
7. **Look at it** with `explore.mjs` from four sides, assembled, cut, and apart, and fix whatever reads wrong.

## What makes a machine look fake

- **Wrong proportions**: a nozzle exit the size of the chamber, a fan hub half the fan, a pump smaller than its pipe. Compute sizes from the physics (area ratios, L*, bore and stroke) or copy a real drawing.
- **Uniform wall thickness everywhere**: real castings thicken at flanges and bosses and thin out on covers.
- **No fillets or chamfers**: sharp box edges read as a toy. Round inside corners with `fillet`, bevel plates and fasteners.
- **Floating parts**: every part should touch or bolt to something; pipes end at flanges, brackets sit on surfaces.
- **Every part the same material**: mix cast, machined, brushed, and painted finishes as the real machine does.
- **Toy-like blade counts**: fans have 16 to 24 blades, compressor stages 30 to 80, turbine stages 60 to 120. Eight thick blades look like a desk fan.
- **Missing small parts**: bolts on every flange, a harness, bearings, a valve on each line. Most of the realism is in the parts nobody names.
- **Clean empty spaces**: real engines are crowded with plumbing; leave space only where the text needs a clear view.

## Pitfalls

- A scene should stay under about 450,000 triangles. The rocket engine is about 225,000 and the turbofan about 260,000 visible at `detail: 1`, the piston engine 90,000, the turbine 110,000, the pump with its motor 100,000, the bicycle 95,000, the gearbox 90,000, the motor 55,000, the turbopump 40,000. Pass `detail: 0.5` to an assembly to draw it at about 60%, and lower `segments`, `points`, or `stations` on your own parts for anything small or distant.
- Build assemblies once, outside `draw`. `pose` and `explode` only move nodes.
- Overlapping solids are fine in a normal view, but the cut face of a section shows both; keep cut-through parts from overlapping where a figure sections them.
- A part whose name matches its group returns the group from `find(name)`; use `children` or `asm.parts`.
- Labels marked `inside` stay hidden until `cutaway(true)` (or `asm.open = true`). Parts you hide yourself (`visible = false`) drop out of `labels()` on their own.
- The bicycle rebuilds the derailleur links and cage each pose (a few boxes) and caches one chain mesh per phase for each gear combination; `chainPhases: 4` halves that work on a slow page.
