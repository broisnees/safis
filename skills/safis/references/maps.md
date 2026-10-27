# Maps

The maps kit (`src/geo.js`) adds two things to every page:

- **`g.map(o)`**: a world map in one of five projections, drawn in the house style, with helpers for countries, choropleths, places, great-circle routes, circles of a given radius, and picking under the pointer.
- **`Geo`**: the spherical math a geography figure needs (distance, bearing, great circles, destinations), the world's 177 countries with their outlines and areas, and 66 cities on every continent.

Use them whenever a figure is about where things are on the Earth: routes, distances, time zones, day and night, the shapes of countries, data by country, or why maps distort. Compute with `Geo`, then draw with `g.map`, so every distance and area on screen is real.

The outlines are Natural Earth's 1:110m countries (public domain), from the world-atlas package (ISC). They are embedded in the page; nothing loads from the network.

Conventions everywhere:
- A place is `[lon, lat]` in degrees, **longitude first** (the GeoJSON order), or an object with `lon` and `lat` (every city in `Geo.cities`), or a city name: `"London"`, `"São Paulo"`, `"NYC"`.
- Colors are palette names (`"blue"`, `"ink"`, `"muted"`), so dark mode works.
- Positions on the canvas are px, like the rest of `g`.

## When to use what

| The figure shows | Use |
|---|---|
| The whole world, data by country | `g.map({ projection: "equalEarth" })` + `M.choropleth` |
| A globe the reader turns | `projection: "orthographic"` + `orbit` and `view: s.view`, or `drag` and `M.pan` |
| The shortest route between two places | `M.arc` (a great circle), with `Geo.distance` for the number |
| A route that is straight on the map but not on the Earth | `M.line(list, { geodesic: false })` beside `M.arc` |
| Everything within some distance | `M.circle(center, km, { fill: true })` |
| Distances and directions from one place | `projection: "azimuthalEquidistant"`, `center` on that place |
| Why Mercator inflates the poles | `M.circle` on a grid of places, switching `projection` |
| Latitude lines that mean something (tropics, polar circles) | `M.parallel`, `M.meridian` |
| One region up close | `fit: "France"` or `fit: [[west, south], [east, north]]` |
| What country is under the pointer | `hover` + `M.countryAt(p)`, then `M.country(name)` to light it |

## g.map(o)

```js
const M = g.map({ projection: "orthographic", center: "Cairo" });
M.arc("Cairo", "Tokyo", { color: "blue" });
M.marker("Tokyo", { label: true });
```

The map draws its base (sphere, graticule, land, borders, coast) as soon as it's created; every later call draws on top. Create it in `draw()` every time and keep the last one in a block variable (`let M;`) for `drag` and `hover`, which don't get `g`.

**Options**

| option | default | |
|---|---|---|
| `projection` | `"equirectangular"` | `"equirectangular"`, `"mercator"`, `"equalEarth"`, `"orthographic"` (or `"globe"`), `"azimuthalEquidistant"` (or `"azimuthal"`). See [projections](#projections). |
| `box` | whole canvas | `[x, y, w, h]` in px. Give two maps their own boxes to set them side by side. |
| `pad` | 8 | px kept clear inside the box. |
| `center` | `[0, 0]` | The place at the middle of the box. Globes and azimuthal maps turn the Earth to it; flat maps turn to its longitude and slide to its latitude. |
| `view` | | `s.view` from `orbit`: yaw turns the center east and west, pitch north and south (pitch only on globes and azimuthal maps). |
| `roll` | 0 | Degrees to turn the map about its center. |
| `rotate` | | `[lon, lat, roll]`: rotates the sphere before projecting, for oblique flat maps. Replaces `center`. |
| `fit` | the whole world | Scale to a region: a country name or a list of them, two corners `[[west, south], [east, north]]`, or a list of places. A country fits its main landmass and the land within 3,000 km of it. |
| `zoom` | 1 | Multiplies the fitted scale. |
| `clip` | true | Clip everything to the box. |
| `base` | true | `false` draws nothing on creation, for building the layers yourself. |
| `graticule` | 30 | Degrees between grid lines, `{ step, color, width, alpha }`, or `false`. |
| `land` | true | `{ fill, alpha, stroke, width }` (stroke is the coast; `false` for none), or `false`. |
| `borders` | true | `{ color, width, alpha, dash }`, or `false`. |
| `water` | `"panel"` | Fill of the sphere behind the land. |
| `shade` | true | The darkening toward the rim that makes a globe read as a ball. Globes only. |
| `cache` | true | A base that doesn't change between frames is drawn once and copied. `false` turns that off. |

**Reading the map**

| | |
|---|---|
| `M.project(at)` | `[px, py]`, or `null` where the place isn't on the map: the far side of a globe, or past Mercator's ±85°. |
| `M.invert(p)` | `[lon, lat]` under a px point, or `null` off the map. Use it in `drag.move`. |
| `M.visible(at)` | On the map and inside the box. |
| `M.near(p, at, r = 14)` | Hit test for dragging a place. |
| `M.countryAt(p)` | The country under a px point, or `null` (sea, or off the map). |
| `M.pan(delta)` | The new `[lon, lat]` center after a drag by `delta` px, so the map follows the pointer. |
| `M.lines(list, { geodesic, closed })` | The visible pieces of a line as px polylines, cut at the horizon and the map's edge, for measuring or custom drawing. |
| `M.center`, `M.scale`, `M.radius`, `M.origin`, `M.outline`, `M.box` | The center `[lon, lat]` after `view`, px per radian at the center, a globe's radius in px, the center in px, the sphere's edge as a px polygon, and the box. |

**Base layers.** Each returns `M`, so they chain. With `base: false`, call them in this order.

| call | options (defaults in brackets) |
|---|---|
| `M.sphere(o)` | `fill` ["panel"] or `false`, `stroke` ["muted"] or `false`, `width` [1] |
| `M.graticule(o)` | `step` [30] or `[lonStep, latStep]`, `color` ["faint"], `width` [0.6], `alpha` |
| `M.land(o)` | `fill` [porcelain: paper with a little ink], `alpha`, `stroke` ["ink"] (the coast; `false` for none), `width` [0.9] |
| `M.borders(o)` | `color` ["muted"], `width` [0.6], `alpha`, `dash` |
| `M.coast(o)` | `color` ["ink"], `width` [0.9], `alpha`, `dash` |
| `M.shade(o)` | `strength` [0.1]. Globes only. |

**Countries.** A country is named by its name (`"France"`), a common alternative (`"USA"`, `"UK"`, `"DR Congo"`, `"Ivory Coast"`), its ISO numeric id (`"250"` or `250`), or its ISO alpha-3 code (`"FRA"`). Matching ignores case and accents.

| call | |
|---|---|
| `M.country(which, o)` | One country or a list. `color` ["orange"], `fill` (a palette name, or `false` for outline only; default `color`), `alpha` [0.35], `stroke` (default `color`; `false` for none), `width` [1.4], `label` (`true` for its name, or text), `labelAt` (`[lon, lat]`), `labelColor` ["ink"]. Throws on an unknown name. Returns the country objects. |
| `M.countries(o)` | Every country filled by `fill(country)`, which returns a palette name or `null` to leave it as land. `alpha`, `borders` [true], `borderStyle`, `coastStyle`. |
| `M.choropleth(values, o)` | Countries shaded by a number. `values` is `{ key: number }`, a `Map`, or `country => number`. `color` ["blue"], `range` [min, max of the values], `steps` [continuous; 5 gives five bands], `diverging` [false], `low` ["red", the color below `mid`], `mid` [0 when the range spans it, else the middle], `missing` (fill for countries without a value), `borders` [true], `borderColor` ["panel"], `borderWidth` [0.7], `legend` (`true`, or `{ title, at, format, width, background }`). Returns `{ color(v), range, mid, unmatched, ramp(u), at(u), diverging }`; `unmatched` lists keys that named no country. |
| `M.legend(scale, o)` | The color bar for a choropleth's return value. `title`, `at` ["bottom-left", "bottom-right", "top-left", "top-right", or `[x, y]`], `format(v)`, `width`, `background` [true]. |

**Places and routes**

| call | |
|---|---|
| `M.points(list, o)` | A dot for each place, labeled where the label fits without covering another label or dot; earlier items win. `r` [3], `color` ["ink"] (or a function of the item), `labels` (true uses `item.name`; `false`; or a function), `size` [11.5], `weight` [500], `labelColor` ["ink"]. Returns `{ drawn: [{ item, at, p, label }], hit(p, r = 12) }`; `hit` returns the item under `p`. |
| `M.marker(at, o)` | One emphasized place: a ringed dot whose label claims its space. `color` ["red"], `r` [5], `label` (`true` for a city's name, or text), `labelColor` [the color], `side` ("e", "w", "n", "s", "ne", "nw", "se", "sw"). Returns its px, or `null` when hidden. |
| `M.label(text, at, o)` | A halo label at a place. `size` [12.5], `weight` [600], `color` ["ink"], `side`. |
| `M.arc(a, b, o)` | The great circle from `a` to `b`, the shortest path, cut correctly at the antimeridian and a globe's horizon. `color` ["blue"], `width` [2], `dash`, `alpha`, `progress` [1] (draw only the first part, for a flight in motion), `arrow` [false], `head` [9], `label`, `labelColor`. Returns `{ km, pieces, at(t) }`; `at(t)` is the px of the point a fraction `t` along, or `null` when hidden. |
| `M.line(list, o)` | A path through several places. `geodesic` [true] follows great circles; `false` runs straight in longitude and latitude (straight on an equirectangular map). `close`, `color` ["ink"], `width` [1.5], `dash`, `alpha`. Returns the px pieces. |
| `M.circle(center, km, o)` | Everything within `km` of the center: a true circle on the ground, whatever the map does to it. Handles circles that cross the antimeridian, cover a pole, or are larger than a hemisphere. `color` ["red"], `width` [1.5], `dash`, `alpha`, `fill` (`true` for the color, or a palette name), `fillAlpha` [0.14], `steps` [160]. |
| `M.parallel(lat, o)`, `M.meridian(lon, o)` | A line of latitude or longitude. `color` ["muted"], `width` [1], `dash` [[4, 4]], `alpha`, `label`, `labelColor`. |

## Projections

| name (aliases) | keeps | gives up | good for |
|---|---|---|---|
| `equirectangular` (`equirect`) | Even spacing of latitude and longitude, so coordinates read straight off the map. | Shapes and areas stretch east to west toward the poles. | Simple world maps, data given in degrees, showing that a straight line on a map isn't the shortest route. |
| `mercator` | Angles: every small shape is right, and a constant compass heading is a straight line. Stops at ±85°. | Area. Greenland draws several times larger than the DR Congo, though the two are about the same size. | Navigation, regional close-ups, and the story of its own distortion. |
| `equalEarth` | Area: every country in proportion. | Shapes shear toward the left and right edges. | World choropleths and anything where size matters. |
| `orthographic` (`globe`) | The look of the Earth from far away. | The far half, and shapes squeeze toward the rim. | Intuition, turning the world, great circles that look straight. |
| `azimuthalEquidistant` (`azimuthal`) | True distance and direction from the center. | Everything else; the point opposite the center is smeared around the rim. | Distance and range from one place, flight routes from a hub. |

## Geo

Pure functions with no drawing, usable in `state()`, `step()`, `status()`, and tests.

| | |
|---|---|
| **Distance** | `distance(a, b)` in km (haversine on a sphere of `Geo.R` = 6371.0088 km). `bearing(a, b)`: the initial compass heading from `a` toward `b`, degrees clockwise from north. `destination(a, bearing, km)`: where you end up. |
| **Great circles** | `interpolate(a, b, t)`: the place a fraction `t` along. `midpoint(a, b)`. `greatCircle(a, b, n)`: `n + 1` places along the route (one per degree by default). `circle(center, km, n = 128)`: a closed ring of places `km` from the center. |
| **Countries** | `country(key)` (or `null`), `countries` (all 177), `countryAt(at)`, `contains(key, at)`, `area(key)` in km². A country is `{ id, name, iso3, center, area, polygons, contains(at) }`; `center` is a label point inside its largest piece, `polygons` are rings of `[lon, lat]`. |
| **Cities** | `cities`: 66 objects `{ name, country, continent, lat, lon }` spread over every continent, McMurdo Station standing in for Antarctica. `city(name)` finds one, ignoring case and accents. |
| **Places** | `ll(place)`: any place as `[lon, lat]`; throws on an unknown city name. |
| **Projections** | `projection(name, o)`: the projection without a canvas, with the same options as `g.map` plus `box`. It has `forward`, `invert`, `line(list, opt)` (visible px pieces), `fill(rings)` (px paths for even-odd filling), `pan`, `outline`, `scale`, and `radius`. `projections` lists the names. |

## Dragging the globe

Two ways, both kept in plain state so the self-check can snapshot it.

**Orbit**, the least code. The runtime turns `s.view` as the reader drags, with momentum after release and arrow keys for the keyboard:

```js
demo("earth", {
  orbit: { yaw: 0, pitch: 0, minPitch: -1.3, maxPitch: 1.3 },
  draw(g, s) { g.map({ projection: "globe", center: [15, 25], view: s.view }); },
});
```

The view turns by 0.01 radians per px, so a large globe turns a little faster than the pointer.

**Drag with `M.pan`**, so the point under the pointer stays under it. Keep the center in state and let `M.pan` work out the new one:

```js
let M;
demo("earth", {
  state: () => ({ center: [15, 25] }),
  drag: { move(p, s, v, delta) { s.center = M.pan(delta); } },
  draw(g, s) { M = g.map({ projection: "globe", center: s.center }); },
});
```

On a flat map `M.pan` scrolls the central meridian, so the reader can drag the Pacific to the middle.

## Examples

### A globe you can turn and point at

Drag the globe to turn it. Pointing at a country outlines it and names it in the panel, and the panel also counts how many of the cities face the reader.

```html
<p>Drag the globe to turn it, and point at a country to name it. Only half the world faces you at once, so the count of <span class="c-blue">cities in view</span> never goes much past half:</p>
<figure class="demo" id="earth" aria-label="A globe with country borders and city dots. Dragging turns it; pointing at a country outlines it in blue and names it."></figure>
<script>
{
  let M; // the map from the last draw, for drag and hover
  demo("earth", {
    aspect: w => (w < 560 ? 1 : 1.5),
    state: () => ({ center: [15, 25], hover: null }),
    controls: [{ key: "labels", label: "City names", type: "toggle", value: true, color: "blue" }],
    caption: "The world on an orthographic globe, the view from far away. The far side is hidden.",
    drag: { move(p, s, v, delta) { s.center = M.pan(delta); } },
    hover(p, s) {
      const name = (p && M?.countryAt(p)?.name) ?? null;
      if (name === s.hover) return false;
      s.hover = name;
      return true;
    },
    status(s) {
      const n = Geo.cities.filter(c => M?.visible(c)).length;
      return `${n} of ${Geo.cities.length} cities in view${s.hover ? ` · ${s.hover}` : ""}`;
    },
    draw(g, s, v) {
      M = g.map({ projection: "globe", center: s.center });
      if (s.hover) M.country(s.hover, { color: "blue", label: true });
      M.points(Geo.cities, { labels: v.labels });
    },
  });
}
</script>
```

### The shortest route is curved

Two draggable ends on a flat map. The solid great circle is the shortest route; the dashed line is straight on the map and longer on the ground. A small globe beside it shows the same two routes.

```html
<p>Drag either end. The <span class="c-blue">solid curve</span> is the shortest route on the Earth; the dashed line only looks shorter. Try <button class="set" data-press="New York to Singapore">New York to Singapore</button>:</p>
<figure class="demo" id="route" aria-label="A flat world map with two draggable blue points joined by a dashed straight line and a solid great circle, and a globe beside it showing both routes."></figure>
<script>
{
  let F; // the flat map from the last draw, for dragging
  const trip = (s, a, b) => { s.a = Geo.ll(a); s.b = Geo.ll(b); };
  // Ground length of the line that is straight on the flat map: add it up in small steps.
  const straightKm = (a, b) => {
    const dl = ((b[0] - a[0] + 540) % 360) - 180;
    let km = 0;
    for (let i = 1; i <= 300; i++) {
      const p = [a[0] + dl * (i - 1) / 300, a[1] + (b[1] - a[1]) * (i - 1) / 300], q = [a[0] + dl * i / 300, a[1] + (b[1] - a[1]) * i / 300];
      km += Geo.distance(p, q);
    }
    return km;
  };
  demo("route", {
    aspect: w => (w < 560 ? 0.8 : 2.5),
    state: () => ({ a: Geo.ll("London"), b: Geo.ll("Tokyo"), drag: null }),
    controls: [
      { label: "London to Tokyo", type: "button", action: s => trip(s, "London", "Tokyo") },
      { label: "New York to Singapore", type: "button", action: s => trip(s, "New York", "Singapore") },
    ],
    caption: "Solid: the great circle, the shortest path. Dashed: the line that is straight on this flat map.",
    status: s => `great circle ${Math.round(Geo.distance(s.a, s.b)).toLocaleString("en-US")} km · straight on the map ${Math.round(straightKm(s.a, s.b)).toLocaleString("en-US")} km`,
    drag: {
      hit: (p, s) => !!F && (F.near(p, s.a, 18) || F.near(p, s.b, 18)),
      start(p, s) { s.drag = F.near(p, s.a, 18) ? "a" : "b"; },
      move(p, s) { const q = F.invert(p); if (q) s[s.drag] = [+q[0].toFixed(2), +q[1].toFixed(2)]; },
      end(s) { s.drag = null; },
    },
    draw(g, s) {
      const narrow = g.w < 560;
      const fb = narrow ? [0, 0, g.w, g.h * 0.52] : [0, 0, g.w * 0.64, g.h];
      const gb = narrow ? [0, g.h * 0.52, g.w, g.h * 0.48] : [g.w * 0.64, 0, g.w * 0.36, g.h];
      F = g.map({ box: fb });
      F.line([s.a, s.b], { geodesic: false, color: "muted", dash: [5, 5] });
      F.arc(s.a, s.b, { color: "blue", width: 2.5 });
      g.handle(F.project(s.a), { color: "blue", active: s.drag === "a" });
      g.handle(F.project(s.b), { color: "blue", active: s.drag === "b" });
      const G = g.map({ box: gb, projection: "globe", center: Geo.midpoint(s.a, s.b) });
      G.line([s.a, s.b], { geodesic: false, color: "muted", dash: [5, 5] });
      G.arc(s.a, s.b, { color: "blue", width: 2.5 });
      G.marker(s.a, { color: "blue", r: 4 });
      G.marker(s.b, { color: "blue", r: 4 });
    },
  });
}
</script>
```

### Distance from a city, by country

Every country shaded by how far its middle is from the chosen city, in bands, with a legend and a hover readout. The values come from `Geo.distance`, so the figure needs no data file.

```html
<p>Each country is shaded by how far its middle is from one city. Compare <button class="set" data-set="city=London">London</button> with <button class="set" data-set="city=Sydney">Sydney</button>, and point at a country to read its distance:</p>
<figure class="demo" id="far" aria-label="An Equal Earth world map with countries shaded blue by distance from a chosen city, a legend in kilometers, and the city marked in red."></figure>
<script>
{
  let M;
  demo("far", {
    aspect: w => (w < 560 ? 1.05 : 1.9),
    state: () => ({ hover: null }),
    controls: [{ key: "city", label: "From", type: "choice", options: ["London", "Tokyo", "Nairobi", "Sydney"], value: "London" }],
    caption: "Countries shaded by the great-circle distance from the chosen city to the middle of each country.",
    hover(p, s) {
      const name = (p && M?.countryAt(p)?.name) ?? null;
      if (name === s.hover) return false;
      s.hover = name;
      return true;
    },
    status: (s, v) => (s.hover ? `${s.hover}: ${Math.round(Geo.distance(v.city, Geo.country(s.hover).center)).toLocaleString("en-US")} km from ${v.city}` : "Point at a country"),
    draw(g, s, v) {
      M = g.map({ projection: "equalEarth", graticule: false });
      M.choropleth(c => Geo.distance(v.city, c.center), {
        color: "blue", range: [0, 20000], steps: 8,
        legend: { title: `Distance from ${v.city}`, format: x => (x ? `${x / 1000},000 km` : "0 km") },
      });
      if (s.hover) M.country(s.hover, { color: "orange", fill: false, width: 2, label: true });
      M.marker(v.city, { color: "red", label: true });
    },
  });
}
</script>
```

## Pitfalls

- **Longitude comes first.** `[lon, lat]`, like GeoJSON: London is `[-0.13, 51.51]`. Writing latitude first puts London in the Indian Ocean without an error.
- **`M.project` returns `null`** for the far side of a globe and for Mercator past ±85°. Check before handing the result to `g.handle` or `g.circle`; the map's own helpers already skip hidden places.
- **Keep state plain.** Store a country's `name` or a place's `[lon, lat]` in `s`, never the country object (it holds functions, and the self-check snapshots state).
- **Make the map in `draw()` every time**, and keep the last one in a block variable for `drag` and `hover`.
- **Tint overlays with a palette color.** A night side or shadow filled with `"ink"` turns light in dark mode, where ink is pale. Use a color such as `"blue"` at a low `fillAlpha`.
- **Small countries aren't there.** At 1:110m, Singapore, Malta, Bahrain, Andorra, and most small island states have no outline. A choropleth lists such keys in `unmatched`; cities still have their points.
- **Antarctica stops at the ice shelves.** The outline follows the grounding line, so McMurdo Station sits just off the land.
- **Names in the data are short forms** ("Dem. Rep. Congo", "Bosnia and Herz.", "Central African Rep."). Full names, common names, and ISO codes all work as keys; labels show the data's form unless `label` gives text.
- **Distances use a sphere.** The real Earth is slightly flattened, so true distances can differ from `Geo.distance` by up to about 0.5%.
- **Labels go first come, first served.** Draw the marker whose label matters before a crowd of `M.points`, and put the important places first in the list.
- **Keep animated maps few.** A flat base map that changes every frame (a reader panning it) costs several milliseconds to draw; one that stays still between frames is cached and costs almost nothing. A turning globe costs about half as much as a flat map.
- **Great circles between opposite points are undefined.** Every route between antipodes is equally short; `M.arc` picks one.
