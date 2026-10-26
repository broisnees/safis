# Categories

Each category has its own kind of figure that works, its own accuracy traps, and its own colors. Read the section for the page's category before planning.

Contents: [Body](#body), [Biology](#biology), [Chemistry](#chemistry), [Physics](#physics), [Machines](#machines), [Earth & Space](#earth--space), [Computing](#computing), [Math](#math).

## Body

Anatomy and physiology: joints, organs, the heart's valves, the inner ear, how muscles pull.

- **Figures that work:** a 3D model of the structure with labels and hover-to-name; a 2D cross-section (sagittal or transverse) with hatched bone, which is how anatomy is usually taught; the same section through a range of motion; a healthy versus a failing version side by side or behind a toggle; a small whole-body or whole-organ drawing in a corner to show where the section is.
- **Build:** bones in profile as `extrude` with bevels, long bones and vessels as `sweep`/`tube`, round heads as `ellipsoid`, muscles as tubes thicker in the middle. Share one model between 2D sections and 3D (extrude the section profiles across the body).
- **Materials and colors:** `bone`, `cartilage`, `enamel`, `muscle`, `tendon`, `tissue`, `nerve`, `artery`, `vein`. In 2D: bone as hatched pale brass, cartilage and discs `blue`, muscle `red`, soft tissue `purple`, nerves `orange`.
- **Accuracy:** use real dimensions and ranges of motion from anatomy references; name structures with their anatomical names once, then plain words. Show variation honestly ("about", "usually"). Don't diagnose or prescribe; one plain sentence on when to see a clinician is enough when the page is about a disorder.
- **Example topics:** the jaw joint and why it locks; how the knee's ligaments keep it stable; heart valves; how the eye focuses; the inner ear's balance organs.

## Biology

Cells, molecules of life, genetics, ecology, evolution.

- **Figures that work:** zoom ladders (organism, tissue, cell, molecule) with each figure starting where the last ended; step-throughs of processes (mitosis, transcription) on an integer slider; population simulations with a plot; molecular machines in 3D (ATP synthase, a ribosome) simplified to their working parts.
- **Build:** cells as `lathe` or `ellipsoid` shells with `opacity`, membranes as ghosted surfaces, DNA as two `helix` backbones with bars, proteins as clusters of spheres or smoothed blobs.
- **Accuracy:** scale is the big trap: say how big things are and how fast they happen, and say when a figure slows time down or enlarges things by a factor. Avoid "designed to" and other purpose language for evolved structures.
- **Example topics:** how a neuron fires; how DNA is copied; why antibiotics stop working.

## Chemistry

Atoms, bonds, reactions, states of matter.

- **Figures that work:** molecules in 3D with `E3.molecule` (ball-and-stick for geometry, space-filling for size and packing); reaction energy diagrams as 2D plots with a draggable progress marker; particle simulations for gases, diffusion, and equilibrium; orbitals as ghosted lobes; crystal lattices.
- **Build:** real bond lengths and angles (water 0.96 Å, 104.5°; methane C-H 1.09 Å, tetrahedral). Atom colors come from `E3.ELEMENTS`. For particle simulations, keep counts modest (hundreds) and use a fixed timestep.
- **Accuracy:** pictures of atoms are models; say which model (ball-and-stick, space-filling, electron density). Keep energies and rates in real units or say they're schematic.
- **Example topics:** why ice floats; how a catalyst lowers the barrier; what makes soap work.

## Physics

Mechanics, waves, light, heat, electricity, fluids.

- **Figures that work:** a scene next to a plot of one quantity over time; force arrows that update live; fields as color (`g.field`) with a `g.colorbar`; ray diagrams; simulations the reader can start from a dragged initial condition; comparisons of the simple formula and the full model.
- **Build:** semi-implicit Euler with substeps for oscillators and orbits, RK4 when comparing against a formula; real constants with units.
- **Accuracy:** state the approximation a formula rests on and show where it breaks down; check every number in the prose against the figure's readout.
- **Example topics:** how a pendulum keeps time; why the sky is blue; how a lens forms an image.

## Machines

Mechanisms and engineered things: engines, watches, locks, gearboxes, bicycles, bridges.

- **Figures that work:** the hero assembly with an explode slider; build-up figures adding one part each; cutaways with hatched sections; one subsystem in color while the rest stays porcelain; motion arrows; a plot of output (torque, pressure) under the mechanism; a scale reference at the end.
- **Build:** plates and brackets as `extrude` with holes and bevels, shafts as `cylinder`, wheels as `gear`, springs as `helix`, round parts as `lathe`. Drive every part from one kinematic model (a crank angle, a gear ratio) so they always mesh.
- **Accuracy:** gear ratios, strokes, and timings should be consistent with each other; if the model is simplified (fewer teeth, no clearances), say so.
- **Example topics:** how a pin tumbler lock opens; how a differential lets wheels turn at different speeds; how a four-stroke engine breathes.

## Earth & Space

Planets, orbits, seasons, tides, weather, geology.

- **Figures that work:** dark-background 3D scenes with `lighting: "sun"`; orbits drawn from above and in 3D; a globe next to a sky view from one place on it; date and time scrubbers with `status` showing the date; time-lapse animations with an explicit speed-up.
- **Build:** planets as spheres with real proportions where possible and honest exaggeration where not ("the Moon is drawn 10 times closer"); orbits from Kepler's laws.
- **Accuracy:** dates, angles, and periods are checkable; check them. Name the time scale whenever an animation speeds time up.
- **Example topics:** why we have seasons; how tides work; why the Moon shows phases.

## Computing

Algorithms, data structures, networks, hardware.

- **Figures that work:** step-throughs on an integer slider with the current step named in `status`; the data structure as boxes and arrows with the active part colored; a timeline or sequence diagram for protocols; cost plots (operations versus input size); hardware in 3D when the physical layout matters (a disk head, a chip's layers).
- **Build:** 2D boxes with `g.rect`, arrows with `g.arrow`, text in `font: "mono"`; deterministic state per step so the slider can go backward.
- **Accuracy:** run the real algorithm in the figure code rather than scripting its frames, so every step is correct.
- **Example topics:** how a hash table finds things; how TCP recovers lost packets; how a B-tree stays balanced.

## Math

Geometry, calculus, linear algebra, probability.

- **Figures that work:** draggable points with everything derived from them; a quantity shown both as a picture and as its formula with colored chips; transformations animated between before and after; 3D surfaces turned with `orbit`.
- **Build:** `g.fit` with `uniform: true` for geometry so angles look right; `E3.mesh.custom` or `sweep` for surfaces; `g.gizmo` to show axes in 3D.
- **Accuracy:** derive everything from the draggable inputs, so no configuration can show a false picture.
- **Example topics:** what a derivative is; how a matrix transforms space; why the normal distribution shows up everywhere.
