import { useState } from "react";
import { Explainer, Figure, Scrub, SetLink, Term, Tex } from "@safis/react";
import spring from "./figures/spring.js";
import gears from "./figures/gears.js";

export default function App() {
  const [showGears, setShowGears] = useState(true);
  return (
    <main className="app safis">
      <Explainer>
        <header>
          <h1>Springs and Gears</h1>
          <p className="dek">Two figures from safis, mounted as React components.</p>
        </header>

        <p>
          Give the spring a stiffness of <Scrub figure="spring" k="k" /> and hang a mass of <Scrub figure="spring" k="m" /> on it.
          Then compare a <SetLink figure="spring" values={{ k: 2, m: 4 }}>soft spring with a heavy block</SetLink> with
          a <SetLink figure="spring" values={{ k: 18, m: 0.6 }}>stiff one with a light block</SetLink>, and watch
          the <Term color="blue" part="block" figure="spring">block</Term> on the <Term color="orange" part="spring" figure="spring">spring</Term>:
        </p>
        <Figure id="spring" spec={spring} label="A block on a spring sliding left and right." />
        <p>
          A stiffer spring pulls back harder, so the block turns around sooner; a heavier block is harder to turn around.
          The time for one swing is <Tex src="T = 2\pi\sqrt{\blue{m}/\orange{k}}" />.
        </p>

        <h2>Gears</h2>
        <p>Turn the gears by dragging them, and cut them open with the first slider:</p>

        <div className="app-bar">
          <button data-test="toggle" onClick={() => setShowGears(v => !v)}>{showGears ? "Hide" : "Show"} the gears</button>
        </div>
        {showGears && <Figure id="gears" spec={gears} label="Two meshing gears, a large porcelain wheel and a small brass pinion." wide />}
      </Explainer>
    </main>
  );
}
