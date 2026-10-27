# TODO

## Cut to ship faster (2026-10-27 17:50 +0545)

The 3D upgrade was cut down so it could ship today. Everything below was planned and left out. Each line says what to build; the briefs were in this session, and the specs are summarized here so nothing is lost.

### E3 engine (`src/engine3d.js`, `references/engine3d.md`, `tools/test-engine3d-pro.mjs`)

Shipped on 2026-10-27:
- physically based materials and a studio environment generated on the GPU
- the `scene.look` presets
- soft shadows, bloom, and tone mapping
- temperature tint and glow
- GPU particles with forces, emitters, and styles
- the `E3.plume` ray-marched exhaust
- adaptive quality tiers
- the "Making 3D that looks real" workflow and checklist
- tests: material names, black-body colors, particles, gas pressure, airfoil flow

Still open:
- [ ] **Proof figures not built.** The engine supports all of these; only the figures are missing:
  - gas molecules in a piston (pressure from wall hits);
  - airflow tracers past a wing (potential flow);
  - a glass prism or lens with refraction and soft shadows;
  - the full nozzle firing at a pad with a throttle.
- [ ] **`spec.quality` on `demo()`.** It's read from the scene or camera today. Wire it through the runtime.
- [ ] **Reduced tier after a drag.** On screens with a pixel ratio of 1, the frame right after a drag can stay at the reduced tier until the next redraw.
- [ ] **MSAA path unchecked.** It only runs while moving, so verify never exercises it. Check it by hand.
- [ ] **`paint` is a saturated red gloss.** Give it a neutral default, or require a color.
- [ ] **Recipes.** More worked recipes in `engine3d.md` for particles and the plume.

### Parts library (`src/parts3d.js`, `references/parts3d.md`, `tools/test-parts3d.mjs`)

Shipped on 2026-10-27:
- `E3.parts` with about 30 parametric parts plus helpers
- assemblies: `rocketEngine`, `turbofan`, `turbopump`, `pistonEngine`
- the recipe book, the "building a new machine" workflow, and the fake-looking checklist
- 40 tests

Still open:
- [ ] **Assemblies not started:** `gearbox`, `electricMotor`, `pump` (centrifugal), `bicycleDrivetrain`, `turbine`. The belt and chain path helpers they need already exist.
- [ ] **Render `pistonEngine` and look at it.** It builds and passes its kinematic tests, but nobody has seen it yet.
- [ ] **Triangle counts are heavy:** about 340k for the rocket and 420k for the turbofan. Add level of detail, or fewer segments on small parts.
- [ ] **Turbofan labels for hidden parts.** `labels()` returns parts inside the casing when the cutaway is off; filter by visibility.
- [ ] **Show the rocket's pump rotors** spinning, with a cutaway on the pump housings.
- [ ] **Demo figures not built:** a parts board with every part type, and an exploded turbopump.
- [ ] **Combine the two kits** into one figure: the rocket engine from `E3.parts` firing with `E3.plume` and smoke, and the turbofan with airflow particles. Then make it the home page hero.

### Re-check after the 3D upgrade (2026-10-27 18:05 +0545)

- [ ] **Re-verify every page on the new engine.** Run `tools/finish-site.sh`. The 3D upgrade was deployed with only the tests, the home page, and jaw-joint and ice checked; the other 15 explainers were not re-verified for speed.

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
