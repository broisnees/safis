# Categories

Each category has its own kind of figure that works, its own accuracy traps, and its own colors. Read the section for the page's category before planning.

Contents: [Body](#body), [Biology](#biology), [Chemistry](#chemistry), [Physics](#physics), [Machines](#machines), [Engineering](#engineering), [Earth & Space](#earth--space), [Computing](#computing), [AI](#ai), [Math](#math).

## Body

Anatomy and physiology: joints, organs, the heart's valves, the inner ear, how muscles pull.

- **Figures that work:** a 3D model of the structure with labels and hover-to-name; a 2D cross-section (sagittal or transverse) with hatched bone, which is how anatomy is usually taught; the same section through a range of motion; a healthy versus a failing version side by side or behind a toggle; a small whole-body or whole-organ drawing in a corner to show where the section is.
- **Build:** start from [`E3.bio`](bio3d.md): `heart`, `eye`, `knee`, `tooth`, and `skin` are finished assemblies with real dimensions, a pose that shows them working, and a cutaway section. For anything else use its helpers: implicit surfaces blended into smooth organic shapes (`E3.bio.sd`, `polygonize`), `muscle` for fusiform muscles with tendons, `vesselTree` for vessels by Murray's law, `longBone` for cortical and cancellous bone. Bones in profile for 2D can still be `extrude` with bevels. Share one model between 2D sections and 3D.
- **Materials and colors:** `bone`, `cartilage`, `enamel`, `muscle`, `tendon`, `tissue`, `nerve`, `artery`, `vein`. In 2D: bone as hatched pale brass, cartilage and discs `blue`, muscle `red`, soft tissue `purple`, nerves `orange`.
- **Accuracy:** use real dimensions and ranges of motion from anatomy references; name structures with their anatomical names once, then plain words. Show variation honestly ("about", "usually"). Don't diagnose or prescribe; one plain sentence on when to see a clinician is enough when the page is about a disorder.
- **Example topics:** the jaw joint and why it locks; how the knee's ligaments keep it stable; heart valves; how the eye focuses; the inner ear's balance organs.

## Biology

Cells, molecules of life, genetics, ecology, evolution.

- **Figures that work:** zoom ladders (organism, tissue, cell, molecule) with each figure starting where the last ended; step-throughs of processes (mitosis, transcription) on an integer slider; population simulations with a plot; molecular machines in 3D (ATP synthase, a ribosome) simplified to their working parts.
- **Build:** `E3.bio.cell` (membrane, nucleus with pores, ER, Golgi, mitochondria with cristae, cytoskeleton, quarter cutaway) and `E3.bio.neuron` (dendrites by Rall's law, myelinated axon, saltatory conduction) are ready to use, in micrometers ([bio3d.md](bio3d.md)). Otherwise: membranes as implicit-surface shells, DNA as two `helix` backbones with bars, proteins as clusters of spheres or smoothed blobs.
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
- **Build:** for the hero machine, an `Iso` illustration: list 40 or more named parts first, build them as solids with four-tone shading, cut away the casing where the inside matters, and put the readout (rpm, thrust, temperature) beside it. Add `Fx` only where the physics shows (the flame in a combustor, the airflow through a fan). For a machine that should look real and turn freely, start from the `E3.parts` assemblies (rocket engine, turbofan, piston engine, gearbox, electric motor, pump) or compose one from its parts ([parts3d.md](parts3d.md)). For custom parts in E3: plates and brackets as `extrude` with holes and bevels, shafts as `cylinder`, wheels as `gear`, springs as `helix`, round parts as `lathe`. Drive every part from one kinematic model (a crank angle, a gear ratio) so they always mesh.
- **Accuracy:** gear ratios, strokes, and timings should be consistent with each other; if the model is simplified (fewer teeth, no clearances), say so.
- **Example topics:** how a pin tumbler lock opens; how a differential lets wheels turn at different speeds; how a four-stroke engine breathes.

## Engineering

Systems people design and run: bridges and structures, electrical circuits and the power grid, control loops, sensors, networks of pipes and wires, manufacturing processes.

- **Figures that work:** a structure under a load the reader drags, with forces as arrows and members colored by tension and compression; a circuit with current drawn as moving dots and a voltage plot under it; a feedback loop with a step response that changes as the reader tunes the gain; an `Iso` illustration of the real machine (a CNC table, a transformer, a pump) with a live readout; a map of the network when location matters (`Geo`).
- **Build:** solve the system for real, as statics with `Num` linear algebra, circuits with Kirchhoff's laws, or control loops with `Num.ode`, and draw from the solution. A diagram of the block structure (`diagrams.md`) can come before the live figure, never instead of it.
- **Accuracy:** units on every number, and state safety factors and simplifications ("pin joints, no self-weight"). Real ratings (a transformer's kVA, a cable's ampacity) need a source.
- **Example topics:** why a truss bridge is made of triangles; how the grid keeps 50 Hz; how a PID controller holds a drone level; how a plasma cutter follows a path.

## Earth & Space

Planets, orbits, seasons, tides, weather, geology.

- **Figures that work:** maps and globes (`Geo`) for anything located on Earth, such as plate boundaries, quake epicenters, tide gauges, or the path of a storm, with the projection chosen for the question (a globe for routes and distances, Equal Earth for comparing areas); dark-background 3D scenes with `lighting: "sun"`; orbits drawn from above and in 3D; a globe next to a sky view from one place on it; date and time scrubbers with `status` showing the date; time-lapse animations with an explicit speed-up.
- **Build:** planets as spheres with real proportions where possible and honest exaggeration where not ("the Moon is drawn 10 times closer"); orbits from Kepler's laws.
- **Accuracy:** dates, angles, and periods are checkable; check them. Name the time scale whenever an animation speeds time up.
- **Example topics:** why we have seasons; how tides work; why the Moon shows phases.

## Computing

Algorithms, data structures, networks, hardware.

- **Figures that work:** step-throughs on an integer slider with the current step named in `status`; the data structure as boxes and arrows with the active part colored; a live timeline of packets for protocols (a static Mermaid sequence diagram from `diagrams.md` is a fine overview before it); a world map (`Geo`) when distance is the point, with servers, cables, and round trips drawn as great circles and latency computed from the real distance; cost plots (operations versus input size) with hover readouts; the real code as a highlighted block, and a diff for what a fix changes; hardware in 3D or as an `Iso` illustration when the physical layout matters (a disk head, a server rack, a chip's layers).
- **Build:** 2D boxes with `g.rect`, arrows with `g.arrow`, code and data in `font: "mono"`; deterministic state per step so the slider can go backward; a stepper or the transport's step button for single steps.
- **Accuracy:** run the real algorithm in the figure code rather than scripting its frames, so every step is correct.
- **Example topics:** how a hash table finds things; how TCP recovers lost packets; how a B-tree stays balanced.

## AI

Neural networks, language models, learning from data.

- **Figures that work:** a tiny real model trained live in the page (a few neurons fitting points as the reader watches the loss fall); tokens as chips with their ids; probability bars over next words with a temperature slider; an attention heatmap where hovering a word shows what it attends to; embedding space as a 2D map the reader can probe; gradient descent as a ball rolling on a loss surface the reader can reshape.
- **Build:** compute everything with real arithmetic in `Num` (softmax, dot products, small matrix multiplies, a seeded random generator) so every number on screen is the output of the toy model; `g.tokens`, `g.bars`, `g.heatmap`, `g.network`, and `g.graph` from [plots.md](plots.md); 3D only for loss surfaces or embedding clouds the reader turns.
- **Accuracy:** a toy model with a stated size (8 dimensions, a 30-word vocabulary) is honest; invented numbers dressed as a real model are not. Describe what the model computes, not what it "thinks". Give real-world sizes only when sure, as orders of magnitude.
- **Example topics:** how a language model picks the next word; how attention decides what matters; how a neural network learns from its mistakes; what an embedding is.

## Math

Geometry, calculus, linear algebra, probability.

- **Figures that work:** draggable points with everything derived from them; a quantity shown both as a picture and as its formula with colored chips; transformations animated between before and after; 3D surfaces turned with `orbit`.
- **Build:** `g.graph` ([plots.md](plots.md)) for function plots with π ticks, areas, tangents, vector fields and contours; `g.fit` with `uniform: true` for geometry so angles look right; `E3.mesh.custom` or `sweep` for surfaces; `g.gizmo` to show axes in 3D; equations with `.tex` and colored symbols ([math.md](math.md)).
- **Accuracy:** derive everything from the draggable inputs, so no configuration can show a false picture.
- **Example topics:** what a derivative is; how a matrix transforms space; why the normal distribution shows up everywhere.
