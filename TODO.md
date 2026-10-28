# TODO

## Requests in progress (2026-10-27 evening), every one to be finished

Engine and 3D (main session):
- [x] Volumetric smoke, dust, steam, and fire: a medium, not sprite blobs; lit, self-shadowed, billowy, flame-lit with falloff (`volume` on smoke/fire systems).
- [x] Plume: hits the pad and spreads (`impact`), drawn at part resolution and upsampled by depth.
- [x] See inside while it works: `cutPlane: { facing: "camera" }`, the flame inside the chamber (`rocketEngine.fire()`, `gasPath()`), pumps spinning; the hero's "Cut open" glides the camera in. (The rocket page gets it in its rewrite.)
- [x] Air that follows the engine: tube flows (`E3.flow.tube`, `turbofan.airflow()`), ribbons never thinner than 1.5 px. Heat shimmer exists in 2D (`Fx`); a 3D shimmer pass is still open (below).
- [x] Materials: spectral glass (six wavelengths) and `frosted`; mottled, muted heat tint. 3D water as a refracting surface is still open (below); 2D water is done in `Fx`.
- [x] An `anatomy` look: subsurface wrap and translucency, wet clear coat, sheen, muscle fiber stripes.
- [x] Simple models stay simple: tissue only shades as tissue in the anatomy look; "Pick fidelity by need" in engine3d.md.
- [x] Performance: hero 10.4 ms -> about 7.5 ms on an M3 Pro (coarser smoke grid, empty-space skipping, flame occlusion in the light grid, two-cell shock diamonds); compile and allocation hitches no longer drop the quality tier; leftover headless Chromes are reaped on exit.
- [x] Wire the anatomy kit (bio3d) into the website kits (the loader reads every kit from the generated list).
- [x] 3D water: the `water` material refracts (1.333), darkens with depth, and ripples with glints.
- [x] 3D heat shimmer: plumes shimmer on their own; `scene.shimmer` adds zones.
- [x] Glass containers: a glass part that holds another solid gets thin walls, so the piston rod isn't doubled and molecules don't paint the glass top.
- [x] Only the subject: no stands, tables, floors, or pads unless the idea needs them (SKILL.md, engine3d.md, parts3d.md); the hero engine and the lab figures lost theirs.
- [x] The cut stays put while you turn the model: a camera-facing cut picks its side when it is switched on, then stays fixed to the model like a real cutaway (`follow: true` keeps the old behavior).
- [x] Every particle moves by its physics: `E3.particles({ matter, units })` for smoke, exhaust, steam, fire, dust, mist, sand, water, rain, snow, spark, ember, bubble, and air (terminal speeds, hot-gas lift, real eddies, how each meets the ground); drag solved exactly; the hero's exhaust streams away as a jet instead of piling up; the rule is in SKILL.md and engine3d.md, with tests.
- [x] Pluck synth: plucking at 1/n of the string now removes every nth harmonic (44 to 50 dB down; was 35).
- [x] No flicker on the website: kits load in the head, articles are finished at build time, no loading bar or placeholders; layout shift 0.000 to 0.002 on the pages checked.
Website (website agent): done, see "Done on 2026-10-27 (website redesign)" below.
Done. Anatomy (anatomy agent): `E3.bio` with organic modeling, plus heart, eye, knee, neuron, cell, tooth, and skin assemblies.
Done. 2D kits (effects agent): water, dust, smoke, air and sound waves, fire, optics refraction and glass, and sound visuals.
After all of the above:
- [x] New explainers written and passing verify: light (28 figures), sound (25), starlink (26), reactions (25), heart (25; verify passes, its explore pass was cut).

### Cut on 2026-10-28 (the user stopped new pages to finish the physics and the website first)

Pick these up later. The shared brief for page writers is `tools/explainer-brief.md`.

- [ ] **Heart: explore pass.** `site/heart/` passes verify; run `explore.mjs` and read every contact sheet before calling it done.
- [ ] **Orbits explainer.** Partial, 14 figures, in `drafts/partial/orbits/` (move back to `site/orbits/` to continue).
- [ ] **Digestion explainer.** Not started (its writer was still researching).
- [ ] **Cell explainer.** Barely started, in `drafts/partial/cell/`.
- [ ] **Rocket engine, full-depth rewrite.** Partial rewrite (13 figures) in `drafts/partial/rocket-engine-rewrite/`; the live page is the original 8-figure version, with its physics fixed.
- [ ] **Turbofan, full-depth rewrite.** Partial rewrite (6 figures) in `drafts/partial/turbofan-rewrite/`; the live page is the original 7-figure version, with its airflow fixed.
- [ ] **Other explainers asked for:** space beyond orbits, human anatomy and disease, protein and cell depth.
- [ ] **Thumbnails for the new pages** (`site.mjs --shared --thumbs`, light and dark) and the README gallery.
- [ ] **Sound kit gaps the sound page found:** sliders have no log scale; the label helper's `prefer` takes a unit direction and silently misplaces labels given a pixel offset.
- [ ] Publish the npm packages (needs your npm login). The website is deployed (2026-10-28, commit 2985818).

## Done on 2026-10-27 (website redesign)

- **Pages.** `/` (pitch, live rocket figure, four doors, newest explainers, install), `/what-it-makes/` (15 kinds of figure, each with a 2x light/dark capture from an explainer or a live figure from the references), `/how-it-works/` (principles, the 8-step pipeline, the spec, what verify and explore catch, the fix layers, the kits), `/usage/` (install per agent, `/safis`, prompt habits, 12 example prompts and what they get, options, sites, checks, npm in React/Vue/Svelte/Astro/plain JS), `/examples/` (search, category chips, `?category=`, `/` to search). A shared slim header and footer; explainers keep their article layout under the header.
- **Design.** A research-paper look on the theme's tokens: display serif titles, numbered sections with margin labels, hairlines instead of boxes, one orange accent, Shiki code in both themes, strong dark mode, no sideways scroll on phones.
- **Loading.** A top bar from navigation start (and from the click on an internal link) until every figure has drawn; each figure holds its final aspect ratio (read from its spec at sync time) with a shimmer until it mounts; static under reduced motion; a message if a kit fails. Pages without figures load no runtime.
- **Thumbnails.** `site.mjs --thumbs` also writes `thumb-dark.webp`; cards show the one for the theme (system or toggle), lazily, so only one downloads.
- **Sidebar.** Ctrl+B / Cmd+B toggles the index (tooltip shows it), remembered across pages, animated, a drawer on narrow screens, restyled; the site header carries the button and the runtime binds it. The reading-progress bar is gone.
- **Zoom.** `s.view.zoom` on every orbit figure: Ctrl/Cmd + wheel or trackpad pinch (plain wheel still scrolls), two-finger pinch, `+` `-` `0`, corner buttons; eased, clamped by `orbit.minZoom`/`maxZoom` (0.5 to 4), reset with the figure. E3, Iso, and `g.view3d` honor it; the self-check warns if zooming changes nothing.

## Done on 2026-10-27 (the 3D upgrade's second pass)

Everything cut from the first 3D pass on 2026-10-27 was finished the same evening:

- **Engine.** Smoke is lit as a small volume (two noise octaves, self-shadow toward the light, scene shadows, backlit edges, flame light shining through, hot soot that glows and cools via `glow`). Streaks and sparks are ribbons that walk their own path back (in a `flow`, along the streamline). The plume has a growing mixing layer, an afterburning sheath, soot, a flicker, an `expansion` state (over/under-expanded, tied to throttle), normalized emission, and two point lights. Sprites split around a plume's midplane so smoke wraps the flame. `paint` is off-white. `quality` is a `demo` spec option; the runtime passes `still` so the frame after a drag or a pause is full quality. `E3.stats` reports each frame. Measured, CPU, and fixed-population particle systems keep every slot at every tier.
- **Harness.** `tools/check-3d.mjs` renders `tools/lab/article.html` (every proof figure: pad firing, plume per fuel, campfire, wing tracers, turbofan airflow, gas piston, prism and lens, piston engine, rocket with pumps open, exploded turbopump, parts board, and the five new assemblies) in headless Chrome, still and turned, and checks the MSAA path, tiers, and errors. Run it after any engine or parts change.
- **Parts.** Assemblies `gearbox`, `electricMotor`, `pump` (with `motor: true`), `bicycleDrivetrain`, `turbine`; `chain` and `liftPath` helpers; a `detail` option; rocket 343k → 226k triangles, turbofan 436k → 262k; labels with `inside`/`when` so closed casings hide their labels; `rocketEngine.cutaway(on)` opens the pumps, and `eng.rotors` spin with the pose.
- **Pages.** `site/rocket-engine/` (8 figures) and `site/turbofan/` (7 figures) carry the proof figures; the home hero is the rocket engine from `E3.parts` firing with `E3.plume` and smoke.
- **Docs.** engine3d.md (features, recipes, quality, stats), parts3d.md (assemblies, detail, labels, cutaway), runtime.md (`quality`).

## Done on 2026-10-27 (website and packages)

- **Website.** safis.fyi is now an Astro (Vite) site in `website/`, built from `site/` and `src/` by `website/scripts/sync.mjs`. The runtime is split into kits loaded per page; figure scripts stay inert in the HTML and run as classic scripts once their kits are in, so pages behave exactly like the standalone files. Fonts are files with fingerprints, hashed assets are cached for a year (`website/public/_headers`), links prefetch on hover, and there's a sitemap, canonical links, and Open Graph cards. `SAFIS_BASE` builds under a subpath. Cloudflare, Vercel, Netlify, and GitHub Pages configs all build it.
- **Checks.** `tools/check-website.mjs` checks every link, runs every page through `verify.mjs` over HTTP (verify now takes URLs), and with `--compare` races old against new on throttled mobile. `deploy-site.sh` and `finish-site.sh` build and check the website before deploying.
- **Packages.** One scope: `@safis/core` (was `safis`, a name taken on npm) plus `@safis/react`, `vue`, `svelte`, `astro`, all 0.4.0, MIT, public, each with a README and license. Packed tarballs installed into apps outside the repo pass `test-packages.mjs --apps`. `npm run publish:packages` publishes all five.
- **Thumbnails.** `site.mjs --thumbs` renders with reduced motion and a longer load limit, so heavy 3D pages get cards.

## Open

- [ ] **Publish the packages.** Needs the `@safis` organization on npmjs.com and `npm login` on this machine; then `npm run publish:packages`.
- [x] **Deploy the website.** Deployed to safis.fyi on 2026-10-28 from commit 2985818 (Cloudflare version 8f0dad41).
- [ ] **Recapture the What it makes media after the smoke work.** `node website/scripts/media.mjs plume engine-apart gas` (and `site.mjs --thumbs` for the cards) once the volumetric smoke lands; the landing hero lives in `website/src/figures/hero.html`.
- [ ] **Explainers for isometric, optics, and effects.** The What it makes page shows those three as live reference figures because no explainer uses them yet.
- [ ] **Retire the old site build?** `site/index.html` and `site/safis.{js,css}` still come from `site.mjs` for opening the folder from disk. The live site no longer uses them.
- [ ] **Plume column through smoke.** At the pad, the plume below the frame still reads faint behind the smoke; the fx layer composites effects after tonemapping, so a bright flame can't punch through sprites in front of it. Keeping the fx layer HDR until the composite would fix it.
- [ ] **Turbofan airflow follows no body.** The streaks through the engine are a uniform model flow and pass through blades; a duct-following field (or sampling the nacelle profile) would be truer.
- [ ] **Volumetric smoke at centimeter scale draws nothing** (reported by the reactions page): `E3.particles({ matter: "smoke", units: "cm", count: 1200, life: [0.8, 1.6], step: 1/120, size: [0.08, 0.9], volume: { bounds: [[-2.5, 4, -2.5], [2.5, 10.5, 2.5]] }, emitter: { shape: "sphere", radius: 0.12, position: [0, 4.5, 0], speed: [10, 30] }, forces: { drag: 12 } })` in a studio scene; sprites show the column. Without `bounds` it is one coarse blob. Likely the extinction or noise frequency doesn't scale with tiny sizes.
- [ ] **Bicycle chain slack.** The 34/11 cross-chain combination leaves about three links of slack; the drawn chain is three links shorter there.
- [ ] **Look at the new assemblies closer.** They were checked from the lab's default views only; turn each at 2x around the derailleur, the gearbox lid, and the turbine glands.

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
- **Effects:** smoother airflow streaks, closer to the turbofan reference (thinner, longer, curling). E3's ribbon streaks now do this in 3D; port the idea to `Fx`.
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
- `tools/check-3d.mjs [--figure id] [--scale 2] [--dark]` renders the 3D lab and checks the engine.
- `SAFIS_SKIP=parts3d node tools/build-template.mjs` builds without an unfinished kit.
