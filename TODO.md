# TODO

## Cut to ship faster (2026-10-27 17:50 +0545)

The 3D upgrade was cut down so it could ship today. Everything below was planned and left out. Each line says what to build; the briefs were in this session, and the specs are summarized here so nothing is lost.

### E3 engine (`src/engine3d.js`, `references/engine3d.md`, `tools/test-engine.mjs`)

- [ ] **GPU particles in 3D scenes**, unless the shipped version already has them (check `engine3d.md`).
  - Transform feedback or texture ping-pong, depth-tested against the geometry.
  - Forces: gravity, drag, wind, curl-noise turbulence, vortex, point attractors, and collision with planes and spheres.
  - Emitters: point, disk, ring, cone, and mesh surface.
  - Sprite kinds: soft lit sprites for smoke and steam, additive emissive for fire and sparks, streaks for airflow tracers.
  - Deterministic from a seed and time.
- [ ] **Volumetric plume**, unless already shipped: a ray-marched volume (noise density plus emission by temperature) attached to a nozzle, with shock diamonds and a flame core, depth-tested against the geometry.
- [ ] **Proof scenes not built:**
  - the full rocket nozzle firing, with smoke billowing at the pad and a throttle slider
  - gas molecules in a piston, with pressure from the wall hits
  - airflow tracers past a wing or cylinder (potential flow)
  - a glass prism or lens with refraction and soft shadows
- [ ] **Full worked recipes** in `engine3d.md` for every new material, light, look, particle, and plume option.
- [ ] **Tests** for the new pieces (`tools/test-engine3d-pro.mjs`).
- [ ] **Optional three.js path**, only if E3 can't make convincing gas or particles. This needs a decision first: about 200 KB gzipped per standalone page.

### Parts library (`src/parts3d.js`, `references/parts3d.md`, `tools/test-parts3d.mjs`)

- [ ] **Assemblies that weren't building at the cut** (check which shipped in `parts3d.md`): `pistonEngine` (crank, rods, pistons, valves, cams), `gearbox`, `electricMotor` (stator windings, rotor, bearings, housing), `pump` (centrifugal), `bicycleDrivetrain` (chainrings, chain, derailleur), and `turbine` (a generic bladed stage).
- [ ] **Full tests:** outward normals, a plausible turbofan bypass ratio from the annulus areas, and watertight checks for every part.
- [ ] **Demo figures not built:** a parts board with every part type, and an exploded turbopump.
- [ ] **A recipe for every assembly** in `parts3d.md`, with a second worked figure example.

### Video skill: `safis-animator` (planned, nothing built)

- A storyboard of 30-90 s: a hook, 5-8 beats, and per beat a figure, a narration line, and what moves.
- Voice by text-to-speech: Kokoro (local, recommended), ElevenLabs or OpenAI (better quality, needs an API key), or espeak-ng (installed, robotic). The audio length of each line sets the beat's length.
- Render a 1080x1920 stage page in headless Chrome with frame-by-frame virtual time, with captions burned in by the page, then encode with ffmpeg (H.264 and AAC are installed) and normalize loudness.
- Checks: a contact sheet at one frame per second, captions clear of TikTok's side buttons and bottom text, and the duration and file size.
- Outputs: the MP4, a cover image, a caption with hashtags, and a closing card linking to safis.fyi.
- Later: a "watch mode" on the explainer pages that plays the same timeline with narration, but lets the reader pause and grab the figure.
- Posting to TikTok automatically needs an approved developer app, so upload by hand at first.

## Later

- **Iso:** cable drag chain, spring, and gear builders; two cut planes per part; faster sorting for big turning models (6-20 ms now).
- **Effects:** smoother airflow streaks, closer to the turbofan reference (thinner, longer, curling).
- **Runtime:** a figure clock (`fig.t`) and a per-control `ease`, so effects don't need `s.t += dt` and `Fx.follow`. Let E3 and Fx share one WebGL context.
- **Pages:**
  - The CDN page sits at 187 words per figure, over the 180 target.
  - Battery skipped its dendrite, particle-cracking, SEI, and thermal-runaway figures.
  - Several citations across the new pages were written from memory; each page's agent report listed them. Check them against the sources.
  - Thumbnails for DNS and protein show plain first figures; pick a more striking figure for each card.
- **Evals:** run the suite in `skills/safis/evals/` (its README says how, nine cases including `rocket-engine-3d`) and compare with the baseline table there.
- **GitHub:** set the repo's website to https://safis.fyi.

## Deploying

- `tools/deploy-site.sh [slug...]` checks the named pages, stages every page not in `drafts/`, rebuilds the home from `web/home.html`, and deploys to https://safis.fyi.
- `tools/finish-site.sh --deploy` is the full pass: build, test, render, thumbnails, then verify every page and deploy.
- `SAFIS_SKIP=parts3d node tools/build-template.mjs` builds without an unfinished kit.
