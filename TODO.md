# TODO

## In progress

- **Isometric illustration kit** (`src/iso.js`, `tools/test-iso.mjs`, `skills/safis/references/iso.md`), with the turbofan cutaway and the CNC plasma table as showcase figures. When it lands:
  - add `node tools/test-iso.mjs` to `npm test`;
  - put `Iso` back in `SKILL.md` (the "What to produce" list and the drawing table), `references/categories.md` (Machines, Engineering), `references/runtime.md` (Globals), and the README's feature table;
  - rebuild the template with `node tools/build-template.mjs`;
  - make the turbofan the hero of `web/home.html` and `docs/hero.webp`.

## Then

- Refresh every thumbnail with `npm run site`, then deploy with `tools/deploy-site.sh`.
- Commit and push.

## Later

- **Effects:** smoother airflow streaks, closer to the turbofan reference (thinner, longer, curling).
- **Runtime:** a figure clock (`fig.t`) and a per-control `ease`, so effects don't need `s.t += dt` and `Fx.follow`. Let E3 and Fx share one WebGL context.
- **Pages:**
  - The CDN page sits at 187 words per figure, over the 180 target.
  - Battery skipped its dendrite, particle-cracking, SEI, and thermal-runaway figures.
  - Several citations across the new pages were written from memory; each page's agent report listed them. Check them against the sources.
- **Evals:** run the suite in `skills/safis/evals/` (its README says how) and compare with the baseline table there.
- **GitHub:** set the repo's website to https://safis.fyi.

## Deploying

- `tools/deploy-site.sh [slug...]` checks the named pages, stages every page not in `drafts/`, rebuilds the home from `web/home.html`, and deploys to https://safis.fyi.
- `tools/finish-site.sh --deploy` is the full pass: build, test, render, thumbnails, then verify every page and deploy.
