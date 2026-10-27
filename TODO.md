# TODO

Work stopped on 2026-10-27 to save tokens. Nothing below is committed yet; `git status` shows everything.

## 1. Finish the five new example pages

Each page in `site/<slug>/index.html` holds its latest article, and the same article is saved in `drafts/<slug>/article.html` (ignored by git). Edit the draft, then splice it in with `node skills/safis/scripts/put-article.mjs site/<slug>/index.html drafts/<slug>/article.html`. Don't run `site.mjs` while pages are half done.

| Page | Figures now | Left to do |
|---|---|---|
| `cdn` | 25 | Final verify and explore pass; check map labels and the readouts. Probably the closest to done. |
| `fourier` | 29 | Final verify and explore pass. Optional: hear the harmonics (`Sound`, sound.md) and an 8x8 DCT block for compression (`Img`, images.md). |
| `protein` | 17 | Fix the overlapping amino-acid labels in the ribosome figure (dark mode): draw residues with `g.bead`, space them 2r + 2 px apart, use `g.labels`. Then finish the remaining sections. |
| `dns` | 14 | Finish the remaining sections. Add a `Geo` map of one lookup's hops with RTT from distance, a Mermaid sequence overview, and real `dig` output as a code block. |
| `battery` | 10 | Write the wear section, the closing, and the references (the agent was on these). Discharge curves with `P.series` and `P.crosshair`. |

Prompt to resume one in a fresh session: *"Finish the safis example page site/battery. The article draft is drafts/battery/article.html; splice it with skills/safis/scripts/put-article.mjs. Use the kits in skills/safis/references. Don't run site.mjs. Verify must pass."*

## 2. Build the isometric illustration kit

Not started: the agent was stopped before it wrote any files. The build already lists `src/iso.js`, and the packages already export `Iso`. Once it exists, add it back to `SKILL.md` (the "What to produce" list and the drawing table), `references/categories.md` (Machines, Engineering), `references/runtime.md` (Globals), and the README's feature table.

What it needs (the plasma cutter and the turbofan are the target look):
- **Camera:** orthographic, azimuth 45° and elevation 30° by default. x' = ox + k·(x sinA − y cosA), y' = oy + k·((x cosA + y sinA)·sinE − z cosE), k = scale·√1.6.
- **Solids and shading:** floor plans lifted to a height, back faces culled, four shade buckets by angle to a light locked to the camera, and a lighter top.
- **Primitives:** box, cylinder, cone, sphere, extruded polygon with holes, pipe along a path with bends, plate with holes, vents, screws, knobs, screen, T-slot extrusion, cable chain, spring, gear.
- **Materials:** porcelain, steel, aluminum, brass, rubber, dark plastic, glass, and hot.
- **Painting:** painter's sort with wrapping parts split into back and front halves, plus an `Iso.audit(scene)` that finds depth conflicts. Turning works by rotating the camera, with a stable sort keyed to the last frame.
- **Lines:** a silhouette weight and a crease weight, and a soft contact shadow.
- **Cutaways:** cut planes per part, translucent shells, and blade arrays for fans.
- **Interaction:** picking, hover, `g.lit`, and dragging along an axis.
- **Motion:** exponential follow, critically damped springs, and eased one-off events.
- **Export:** `Iso.toSVG(scene)` as a standalone SVG that follows the theme, plus a download button.
- **Turbofan showcase:** the cutaway combined with `g.fx.flow` (inlet and nozzle ellipses from `project()`), with a readout like "take-off · N1 95.0% · 334 kN · TGT 860°C".
- **Files:** `src/iso.js`, `tools/test-iso.mjs` (then add it to `npm test`), and `skills/safis/references/iso.md`.

## 3. README

- `docs/hero.webp` is the jaw joint for now. Swap in the turbofan once iso exists, and update the alt text.
- Add the five new pages to the gallery once they're finished. Their `thumb.webp` files already exist.

## 4. Build, check, and deploy

One command does the whole pass: build the template, run every test, render diagrams and code, rebuild the site with thumbnails, verify every page, then stage only the passing pages and deploy them to https://safis.fyi:

```
tools/finish-site.sh            # check only
tools/finish-site.sh --deploy   # check, then deploy the passing pages
```

The deploy uses wrangler, already logged in to the `broisnees` account. `safis.fyi` and `www.safis.fyi` are attached as custom domains in `wrangler.jsonc`.

## 5. Later

- **Effects:** smoother airflow streaks, closer to the turbofan reference (thinner, longer, curling).
- **Runtime:** a figure clock (`fig.t`) and a per-control `ease`, so effects don't need `s.t += dt` and `Fx.follow`. Let E3 and Fx share one WebGL context.
- **Evals:** run the suite in `skills/safis/evals/` (its README says how) and compare with the baseline table there.
- **GitHub:** set the repo's website to https://safis.fyi, then commit and push. The CI badge in the README starts working after the first push.
