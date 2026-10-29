# E3.bio: anatomy and cell biology

`E3.bio` builds 3D anatomy that looks like the real thing and works like it: a heart that beats with its valves opening and shutting on time, an eye that turns, focuses, and narrows its pupil, a knee that rolls and glides on its ligaments, a neuron that fires, a cell, a molar, a block of skin, a brain with its reward circuit. Every model has real dimensions from anatomy references and a section that opens it up. The same helpers model any organ or tissue the assemblies don't cover. Read [engine3d.md](engine3d.md) first; this file covers what the anatomy kit adds. It follows the conventions of [parts3d.md](parts3d.md), so assemblies share one interface.

Contents: [conventions](#conventions), [assemblies](#assemblies), [modeling helpers](#modeling-helpers), [materials and looks](#materials-and-looks), [recipes](#recipes), [building new anatomy](#building-new-anatomy), [what makes anatomy look fake](#what-makes-anatomy-look-fake), [limits](#limits).

## Conventions

- **Units are millimeters.** The neuron and the cell are in micrometers. `asm.info.units` says which.
- **Organic shapes are implicit surfaces.** A shape is a signed distance field (negative inside), blended smoothly and polygonized into a closed mesh with smooth normals from the field's gradient. Junctions such as a vessel leaving the aorta, a condyle flaring from the shaft, or a dendrite leaving the soma come out filleted, not stuck together.
- **Every mesh is closed with outward normals**, so `scene.cutPlane` hatches it. The assemblies also carry built-in sections: `cutaway(true)` swaps in cut versions, built the first time they're shown. The cut faces are flat with clean outlines, and parts on the removed side are hidden.
- **Assemblies are groups**: `scene.add(asm)`. They have the [parts3d interface](parts3d.md#assemblies): `pose(state)`, `explode(t)`, `labels()` (inside labels only when `cutaway(true)`), `parts[name]`, `notes[name]`, `ports`, `info` (dimensions and `sources`), and `state`, the live readouts the pose produces.
- **Options shared by all**: `detail` (0.3 to 1.5, default 1) scales grid resolution and segments; `plain: true` makes everything porcelain (diagram look) except the parts named in `subject`; `materials: { role: material }` overrides a role; `h` sets the grid spacing of the implicit surfaces.
- Build once, outside `draw`. `pose` only moves nodes and swaps cached meshes, except the eye's iris, lens, and muscles, which rebuild cheaply when their values change.

## Assemblies

| builder | about | pose | parts, triangles | ports, state |
|---|---|---|---|---|
| `heart(o)` | Adult heart, 120 mm base to apex, in anatomical position (apex to the patient's left, front, down); `upright: true` keeps the long axis vertical. Four chambers (LV wall 11 mm, RV 4 mm, atria 2.8 mm), septum, papillary muscles and chordae, mitral, tricuspid, aortic, and pulmonary valves, aorta with its arch branches, pulmonary trunk and arteries, venae cavae, pulmonary veins, coronary arteries with branches, coronary veins. Cutaway: frontal section through the four chambers. | `{ phase }` 0 to 1: one cycle (0.8 s at 75 per minute). Atrial systole 0 to 0.12, isovolumetric contraction to 0.16, ejection to 0.44, isovolumetric relaxation to 0.5, filling to 1. LV 120 mL to 50 mL. | 28 parts, 204k closed, 188k cut | `aortaOut`, `svcIn`, `ivcIn`, `lpaOut`, `rpaOut`, `pulmonaryVein1` to `4`; `state`: `phase`, `name`, `lvVolume`, `mitral`, `tricuspid`, `aortic`, `pulmonary` (0 shut, 1 open); `valves[key].leaves` |
| `eye(o)` | Right eye, 24.0 mm axial length, looking along +z; +x is temporal. Sclera, cornea (radii 7.8/6.5 mm), iris with radial ridges, lens (Le Grand), ciliary body and processes, zonules, choroid, retina with the central retinal arcades, macula, optic disc 15° nasal, vitreous, optic nerve, four recti on the spiral of Tillaux, both obliques and the trochlea. Cutaway: sagittal half (nasal side kept; the lateral rectus and inferior oblique hidden). | `{ gaze: [yaw, pitch], pupil, accommodation }`: gaze in radians (positive yaw looks temporal), pupil diameter 2 to 8 mm, accommodation 0 (far) to 1 (near: lens 4.0 to 4.5 mm thick). | 23 parts, 85k closed, 48k cut | `pupil`; `state`: `gaze`, `pupil`, `accommodation`, `lens.thickness`, and each rectus's length in mm |
| `knee(o)` | Right knee, tibia fixed with its plateau at y = 0, +z front, +x lateral. Femur, tibia, fibula (cortical shell, cancellous bone, marrow), patella, articular cartilage on femur, tibia, and patella, medial and lateral menisci, ACL, PCL, MCL, LCL, patellar and quadriceps tendons. `trabecular: true` fills the cancellous bone with a lattice of struts for close-ups. Cutaway: sagittal section through the medial condyle, x = -21 (`section` moves it), showing cortical and cancellous bone and the meniscus wedges. | `{ flex }` radians, 0 to 2.3. The femur is placed by two conditions: the ACL keeps its length and the condyles touch the tibial cartilage, which produces rolling and gliding (rollback of about 15 mm by 90°). The PCL's femoral attachment is chosen where it stays most nearly isometric (within 3%). The patella tracks its groove on a tendon of fixed length. | 15 parts, 141k closed, 179k cut | `state`: `flex`, `acl`, `pcl`, `rollback`, `contactZ`, `patellaAngle`, `patellarTendon` |
| `neuron(o)` | Motor-neuron-like cell in µm: soma 26 µm blended into its trunks and hillock, six dendritic trees by Rall's 3/2 law with spines, axon with myelin internodes and nodes of Ranvier (shortened: `internodes`, `internode`), terminal arbor and boutons. Cutaway: the soma opened, with the nucleus. | `{ signal }` 0 to 1: the action potential jumps node to node (the active node and the internode behind it light up). | 18 parts, 153k closed | `terminal1`...; `state`: `signal`, `activeNode`, `distance` |
| `cell(o)` | Animal cell in µm, about 24 µm across: membrane, nucleus (envelope, pores, nucleoplasm, nucleolus), rough ER with ribosomes, smooth ER, Golgi stack and vesicles, mitochondria (two opened to show cristae), lysosomes, centrosome, microtubules. Cutaway: a quarter wedge removed (x > 0, z > 0); the interior is hidden until then. | none | 15 parts, 80k closed, 182k open | |
| `tooth(o)` | Mandibular first molar in its socket, in mm: enamel (2.5 mm at the cusps), dentin, pulp chamber with horns, mesial and distal root canals, cementum, periodontal ligament (0.25 mm), gingiva, alveolar bone, the inferior alveolar nerve, artery, and vein in their canal with branches up into the pulp, the five cusps as named landmarks. Cutaway: section through the roots (z = 0.2). | none | 20 parts, 231k closed, 134k cut | |
| `brain(o)` | Adult brain in mm, 167 × 140 × 93, +z front, +x the patient's left. Hemispheres with lobes, the longitudinal and lateral fissures, gyri and sulci (see-through by default: `ghost(false)` for solid), prefrontal cortex as its own tinted patch, cerebellum with folia, brainstem into the cord, corpus callosum, thalamus, and paired caudate (head, body, tail), putamen, globus pallidus, nucleus accumbens, amygdala, hippocampus, ventral tegmental area, substantia nigra. Dopamine pathways (mesolimbic, mesocortical, nigrostriatal) as tubes on the left with traveling pulses. Cutaway: midsagittal section (left hemisphere's medial face). | `{ pulse, pathways }`: pulse 0 to 1 moves the beads (drive from `step`); `pathways` a list of names to show (default all). | 25 parts, 217k closed | `vta`, `nigra`, `accumbens`, `pfc`, `amygdala`, `striatum`; `pathways[name]` (point lists for drawing your own signals) |
| `skin(o)` | Block of thick skin, 4 × 4 mm: stratum corneum, epidermis ridged into dermal papillae, dermis, hypodermis fat lobules, hair shaft and follicle with sebaceous gland and arrector pili, coiled sweat gland and duct, deep and superficial vascular plexuses, capillary loops, nerve fibers, free nerve endings, Meissner and Pacinian corpuscles. Cutaway: the front half removed, cutting the vessels where they cross. | none | 17 parts, 140k closed, 77k cut | |

Build times in a browser are about 0.2 to 1.3 s per assembly at `detail: 1`, and each cutaway about the same the first time it's opened. Use `detail: 0.5` (about a quarter of the triangles) for small figures and phones.

Sources, in `info.sources`: Standring (ed.), *Gray's Anatomy*, 41st ed. (2016); Maceira et al., *J Cardiovasc Magn Reson* 8 (2006) 417 (ventricular volumes); Hall, *Guyton and Hall Textbook of Medical Physiology*, 14th ed. (2020) (cycle timing); Atchison and Smith, *Optics of the Human Eye* (2000) (Le Grand's eye); Apt, *Trans Am Ophthalmol Soc* 78 (1980) 365 (rectus insertions); Girgis, Marshall and Monajem, *Clin Orthop* 106 (1975) 216 (cruciates); O'Connor et al., *Proc Inst Mech Eng H* 203 (1989) 223 (four-bar knee); Shepherd and Seedhom, *Ann Rheum Dis* 58 (1999) 27 (cartilage); Kandel et al., *Principles of Neural Science*, 6th ed. (2021); Rall, *Exp Neurol* 1 (1959) 491; Alberts et al., *Molecular Biology of the Cell*, 6th ed. (2014); Nelson, *Wheeler's Dental Anatomy*, 11th ed. (2019); Kolarsick et al., *J Dermatol Nurses Assoc* 3 (2011) 203.

## Modeling helpers

### Implicit surfaces

`E3.bio.sd` builds signed distance fields; `E3.bio.polygonize(field, { h })` turns one into a mesh.

| builder | shape |
|---|---|
| `sphere(c, r)`, `ellipsoid(c, [a, b, c], M)`, `box(c, half, round, M)`, `torus(c, R, r, axis)` | Primitives; `M` is a rotation matrix (`E3.m4`) |
| `capsule(a, b, r)`, `cone(a, b, ra, rb)` | A rod between two points; `cone` tapers (exact round cone) |
| `tube(points, radii, k)` | A smooth tube through points with a radius per point (blended round cones) |
| `smooth(k, ...fields)`, `union(...)` | Smooth union with blend radius `k` (fillets where shapes meet); children far away are skipped, so big unions stay fast |
| `subtract(a, b, k)`, `intersect(a, b, k)` | Carve and clip, optionally blended |
| `offset(a, r)`, `shell(a, t)` | Grow or shrink (`r` may be a function of the point); a wall of thickness `t` inside the surface |
| `displace(a, amp, freq, seed)` | Organic irregularity: noise of amplitude `amp` mm at `freq` cycles per mm |
| `place(a, M)`, `plane(n, d)`, `gyroid(period, t)`, `field(d, min, max)` | Rigid placement, a half-space n·p ≤ d, a strut lattice (trabecular bone, sponges), any custom field with its bounds |

`polygonize(f, o)`: `h` grid spacing (mm; divided by `detail`). Empty space is skipped on a coarse grid first, so cost follows surface area. `caps: [{ n, d }]` names section planes (n·p = d, n pointing out of the kept side). Triangles on those planes get the plane's normal, and their outline is smoothed, so a cut face is flat with a clean edge while the rest stays smooth. `sharp: true` uses crease-split face normals for shapes that are meant to be faceted. Keep walls at least twice `h` thick, or polygonize them on a finer grid.

### Organic builders

| helper | makes |
|---|---|
| `muscle(origin, insertion, { via, belly, width, tendonLength, tendon, tendonWidth, pennation, up, shape })` | A fusiform belly tapering into a flat tendon at each end, wrapping through `via` points (over a bone, the globe). `tendonWidth` may be `[at origin, at insertion]`. Returns `{ mesh, path, length, fibers }`; pass `fibers` to the material for striations. |
| `vesselTree({ root, dir, radius, length, depth, exponent, ratio, taper, curl, seed, project })` | Branching by Murray's law (exponent 3; 1.5 is Rall's law for dendrites) at the angles that minimize flow work. `project(p)` keeps it on a surface (vessels on the heart or the retina). Returns `{ segments, mesh(), sdf() }`; `sdf()` gives smooth blended junctions. |
| `longBone(outer, { shaft, cortex, h, trabecular, section })` | Cortical shell (thick along the shaft, thin at the ends), cancellous bone, and a marrow cavity, from an outer shape. `solid` for the closed view; `cortical()`, `cancellous()`, `marrow()` built on first use. With `section` they're a ready-made cut. |
| `sheet(f(u, v), { nu, nv, thickness, closedU })` | A thin curved solid: valve leaflets, membranes, cisternae, the iris |
| `slab(low(x, z), high(x, z), [x0, x1], [z0, z1])` | A layer between two height fields: skin layers, a tissue block |
| `leaflet(center, axis, r, a0, a1, closedAt, { openness, length, dome, pocket, crown })` | A heart valve leaflet or cusp that opens and closes |
| `onSurface(f, p, lift)` | Moves a point onto a field's surface (then out by `lift`) |
| `noise`, `fbm`, `rng(seed)`, `smoothPath(points, n)`, `triangles(asm)` | Noise, seeded random numbers, a smooth evenly spaced path, an assembly's visible triangle count |

## Materials and looks

Anatomy parts use E3's tissue names as object materials: `E3.bio.tissue("muscle", { fibers })` returns `{ base: "muscle", sss, sssColor, wet, sheen, fibers }`. `E3.bio.TISSUE` lists them: muscle, tendon, ligament, bone, cancellous, marrow, cartilage, fat, tissue, myocardium, artery, vein, nerve, enamel, dentin, pulp, gum, skin, dermis, membrane, nucleus, organelle, myelin, lens, cornea, vitreous, iris, sclera, retina, choroid. With `scene.look = "anatomy"` they shade as tissue: subsurface scattering in `sssColor`, wet specular, sheen on tendons, striations along `fibers`. Every other look shows them as E3's diagram colors, so they also work as clean teaching drawings.

**Pick the look by what the figure teaches.** A simple model, a single structure, or a labeled teaching drawing should use `scene.look = "diagram"`, and often `plain: true` with the subject in color (`asm.parts["left ventricle"].traverse(n => { n.material = "red"; })`). It's fast, calm, and reads instantly. Use the `"anatomy"` look when realism is the point: a dissection, a section of real tissue, or the first view of an organ.

## Recipes

**A beating heart with its valves.**

```js
const scene = E3.scene({ look: "anatomy" });
const H = E3.bio.heart();
scene.add(H);
demo("heart", {
  orbit: { yaw: 0.2, pitch: 0.12 },
  state: () => ({ t: 0 }),
  controls: [{ key: "cut", label: "Section", type: "toggle", value: true }],
  status: () => `${H.state.name} · left ventricle ${H.state.lvVolume.toFixed(0)} mL · aortic valve ${H.state.aortic > 0.5 ? "open" : "shut"}`,
  step(dt, s) { s.t += dt / 0.8 / 3; }, // one beat every 2.4 s: a third of real speed
  draw(g, s, v) {
    H.cutaway(v.cut).pose({ phase: s.t % 1 });
    const view = g.render3d(scene, { ...s.view, fov: 26 });
    g.callouts(H.labels().map(l => ({ at: view.project(l.at), text: l.text })));
  },
});
```

A pressure-volume loop or a Wiggers diagram beside it can read `H.state.lvVolume` and the valve states for the same phase.

**The eye focusing.** `E.pose({ accommodation: v.near })` with `E.cutaway(true)` and the camera at `yaw: -1.05` (looking at the cut face). Put `E.state.lens.thickness` in the status line. For light through the eye, draw rays in 2D with `Optics` from the same radii (`E.info.cornea`, `E.info.lens`).

**The knee bending.** A "Bend" slider to `K.pose({ flex })`, `K.cutaway(true)` for the sagittal section with the camera at `yaw: 1.35`, and `K.state.acl`, `K.state.pcl`, and `K.state.rollback` in the status. A torn-ACL figure: hide `K.parts["anterior cruciate ligament"]` and explain what the linkage loses.

**A nerve impulse.** `N.pose({ signal: s.t % 1 })` from `step`; plot membrane voltage at the active node with `g.graph` beside it.

**Inside a cell.** `C.cutaway(true)`, camera at `yaw: -0.75, pitch: 0.35` (into the removed quarter), hover with `view.pick` and `C.notes`.

**The reward circuit.** `E3.bio.brain()` in the anatomy look; `B.pose({ pulse: s.t % 1, pathways: [v.path] })` from a choice control; label with `B.labels()` filtered to the structures the paragraph names, dropping any `view.hidden(l.at, l.node)` so labels don't show through the far side (passing the label's node keeps a label anchored inside its own solid part); recolor a subject with `B.parts["nucleus accumbens"].traverse(n => { n.material = "purple"; })`.

**Teeth and skin** are sections by nature: start them with `cutaway(true)`, label from `labels()`, and let the reader turn the block.

## Building new anatomy

1. **Dimensions first.** From an anatomy text or imaging study, write down 10 to 20 numbers: overall size, wall thicknesses, diameters, lengths, ranges of motion. Put them in `info` with the source.
2. **List the parts** (15 or more), with the tissue each is made of.
3. **Shape each part as a field.** Start from primitives placed at real coordinates, blend them with `smooth` (the blend radius is the fillet), carve cavities and grooves with `subtract`, give walls with `shell` or by subtracting an offset cavity, add `displace` noise at 0.2 to 0.5 mm for organic irregularity. Polygonize with `h` about a third of the thinnest wall.
4. **Thin things are not fields.** Use `sheet` for leaflets and membranes, `tube` or `muscle` for vessels, nerves, tendons, and muscles, and `vesselTree` for branching.
5. **Motion from one model**: a cycle phase, a joint angle, a constraint solved each pose (as the knee's ligament and contact conditions). Cache meshes that change with the pose.
6. **Sections**: make the cut variant with `sd.intersect(field, sd.plane(n, d))` and `caps: [{ n, d }]`, build it on first use, and hide or clip (`clippedTubes`) what lies on the removed side.
7. **Look at it** with `tools/check-3d.mjs --lab tools/lab/bio.html --scale 2` (or your own lab page): from four sides, closed and cut, in the diagram and anatomy looks.

## What makes anatomy look fake

- **Tubes and spheres stuck together.** Real junctions are filleted: blend with `smooth` and a blend radius of a few millimeters.
- **Perfect symmetry and smoothness.** Add `displace` noise; offset left and right features a little.
- **Wrong scale and proportions.** A heart is 12 cm long, an eye 24 mm, a cell 10 to 30 µm. Wall thicknesses matter as much as overall size: the LV is three times thicker than the RV.
- **One flat color.** Use the tissue materials; keep each tissue's own color (bone cream, cartilage blue-white, muscle red, fat yellow).
- **Nothing inside.** A section should show what the organ is made of: chambers and septum, cortical and cancellous bone, enamel over dentin over pulp.
- **Rigid motion.** Organs deform: chambers shrink, valves fold, ligaments stay taut while bones roll. Drive motion from the physiology, not a sine wave on a rotation.
- **Floating or interpenetrating parts.** Vessels enter their chambers, tendons attach on bone, muscles wrap the structure they cross.

## Limits

- Chamber contraction is a scale about the base; real walls thicken as they shorten, and the base descends toward the apex.
- The knee is a planar model (no screw-home rotation); the menisci slide but don't deform.
- The neuron's axon and the internodes are far shorter than life; dendritic trees are statistical, not traced from a real cell.
- Organelle counts and sizes in the cell are representative, not measured from one cell type; ribosomes, pores, and microtubules are drawn larger than life so they're visible.
- Implicit surfaces are built on the CPU when an assembly is created; build once per page, and use `detail` for many figures.
