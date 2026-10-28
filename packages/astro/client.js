// Mounts every <Figure name="..."> on the page from the spec modules you hand it,
// and keeps them right across Astro's client-side navigation (<ClientRouter />).
//
//   <script>
//     import { mountFigures } from "@safis/astro/client";
//     mountFigures(import.meta.glob("../figures/*.js"));
//   </script>
import { enhance, mount, typeset } from "@safis/core";

const live = new Map(); // figure element -> handle

async function run(modules) {
  const names = Object.keys(modules);
  const fresh = [...document.querySelectorAll("figure[data-safis-figure]")].filter(el => !live.has(el));
  for (const el of fresh) live.set(el, null); // claimed, so an overlapping run skips it
  // Load the spec modules together, then mount in page order.
  const specs = await Promise.all(fresh.map(async el => {
    const name = el.dataset.safisFigure;
    const file = names.find(f => f.replace(/\.[cm]?[jt]s$/, "").endsWith(`/${name}`));
    if (!file) { console.error(`[safis] no spec module named "${name}" (looked in ${names.length} modules)`); return null; }
    const mod = await modules[file]();
    return mod.default ?? mod.spec;
  }));
  fresh.forEach((el, i) => { if (specs[i] && el.isConnected) live.set(el, mount(el, specs[i])); });
  enhance(document);
  typeset(document.body);
}

function stop() {
  for (const handle of live.values()) handle?.destroy();
  live.clear();
}

/** modules: the result of import.meta.glob("../figures/*.js") (lazy loaders) or an eager map of modules. */
export function mountFigures(modules) {
  const loaders = Object.fromEntries(Object.entries(modules).map(([k, m]) => [k, typeof m === "function" ? m : () => Promise.resolve(m)]));
  const go = () => run(loaders).catch(e => console.error("[safis]", e));
  document.addEventListener("astro:before-swap", stop);
  document.addEventListener("astro:page-load", go);
  go();
}
