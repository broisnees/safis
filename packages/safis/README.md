# @safis/core

The runtime behind [Safis](https://safis.fyi) interactive explainers: live 2D figures with instrument-like controls, a WebGL 3D engine with real materials, smoke, plumes, and a machine parts library, TeX math, plots, simulations, maps, optics, and sound, styled like a science book.

```sh
npm install @safis/core
```

A figure is a spec: controls, state, and a `draw` function. The same spec runs in every framework.

```js
// figures/spring.js
export default () => ({
  controls: [{ key: "k", label: "Stiffness", min: 1, max: 10, value: 4, unit: "N/m" }],
  state: () => ({ x: 1, v: 0 }),
  step(dt, s, v) { s.v -= v.k * s.x * dt; s.x += s.v * dt; },
  draw(g, s) { g.circle([g.w / 2 + 120 * s.x, g.h / 2], 16, { fill: "blue" }); },
});
```

```js
import "@safis/core/scoped.css"; // the book theme inside .safis elements ("@safis/core/style.css" styles the whole page)
import { mount, enhance } from "@safis/core";
import spring from "./figures/spring.js";

mount(document.querySelector("figure#spring"), spring); // returns a handle; handle.destroy() unmounts
enhance(document); // binds <span class="scrub" data-figure="spring" data-key="k"> and other prose links
```

Exports: `mount`, `enhance`, `typeset`, `toMathML`, `setTheme`, `ready`, and the kits `E3` (3D, with `E3.parts`), `Num`, `Sim`, `Geo`, `Optics`, `Sound`, `Img`, `Fx`, `Iso`. They draw in the browser; import them anywhere, but mount from an effect or a client script. `@safis/core/tex` turns TeX into MathML on a server, and `@safis/core/iife` is a classic script that sets `window.Safis`.

Framework components: [`@safis/react`](https://www.npmjs.com/package/@safis/react), [`@safis/vue`](https://www.npmjs.com/package/@safis/vue), [`@safis/svelte`](https://www.npmjs.com/package/@safis/svelte), [`@safis/astro`](https://www.npmjs.com/package/@safis/astro).

Docs: the figure runtime, plots, simulations, maps, optics, sound, math, and the 3D engine are described in the [Safis skill references](https://github.com/broisnees/safis/tree/main/skills/safis/references). Examples for every framework live in [examples/](https://github.com/broisnees/safis/tree/main/examples).

MIT licensed. The bundled fonts (Source Serif 4, Source Sans 3, STIX Two Math) are under the SIL Open Font License; see `dist/fonts/`.
