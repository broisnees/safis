# @safis/astro

Astro and MDX components for [Safis](https://safis.fyi) interactive figures. Math renders to MathML at build time; figures mount on the client, and survive Astro's client-side navigation.

```sh
npm install @safis/astro @safis/core
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

Put each figure's spec in `src/figures/<name>.js` (default export) and mount them once in your layout:

```astro
---
import "@safis/core/style.css";
import ThemeToggle from "@safis/astro/ThemeToggle.astro";
---
<html lang="en"><body>
  <slot />
  <ThemeToggle />
  <script>
    import { mountFigures } from "@safis/astro/client";
    mountFigures(import.meta.glob("../figures/*.js"));
  </script>
</body></html>
```

Then use the components in pages and MDX posts:

```mdx
import Figure from "@safis/astro/Figure.astro";
import Tex from "@safis/astro/Tex.astro";

<Figure name="spring" label="A block on a spring." />
<Tex src="T = 2\pi\sqrt{m/k}" display />
```

Also: `Scrub.astro`, `SetLink.astro`, `Term.astro`.

Docs: the figure runtime, plots, simulations, maps, optics, sound, math, and the 3D engine are described in the [Safis skill references](https://github.com/broisnees/safis/tree/main/skills/safis/references). Examples for every framework live in [examples/](https://github.com/broisnees/safis/tree/main/examples).
