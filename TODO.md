# TODO

## Later

- **Iso:** cable drag chain, spring, and gear builders; two cut planes per part; faster sorting for big turning models (6-20 ms now).
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
