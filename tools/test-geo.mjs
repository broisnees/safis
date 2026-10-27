#!/usr/bin/env node
// Tests for the maps kit in src/geo.js (window.Geo and g.map): spherical math against
// known distances, projection round trips, clipping at the horizon, the antimeridian,
// and Mercator's limit, filled areas that agree with point-in-country tests in every
// projection, country lookup and areas, and a smoke run of every g.map helper on a
// recording canvas.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
new Function(await readFile(path.join(root, "src/geo.js"), "utf8"))();
const Geo = window.Geo;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const BOX = [0, 0, 800, 400];
const lonDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// ---------- spherical math ----------
{
  const d = Geo.distance("London", "New York");
  check("London to New York is about 5,570 km", close(d, 5570, 10), `${d.toFixed(1)} km`);
  const d2 = Geo.distance([0, 0], [180, 0]);
  check("half the equator is π R", close(d2, Math.PI * Geo.R, 1e-6), `${d2.toFixed(3)} km`);
  check("bearing due north is 0°", close(Geo.bearing([10, 0], [10, 30]), 0, 1e-9));
  check("bearing due east along the equator is 90°", close(Geo.bearing([0, 0], [20, 0]), 90, 1e-9));
  const b = Geo.bearing("London", "New York");
  check("London to New York starts out west-northwest", b > 280 && b < 295, `${b.toFixed(2)}°`);
  const there = Geo.destination("London", b, d), ny = Geo.city("New York");
  check("destination(bearing, distance) lands on New York", close(Geo.distance(there, ny), 0, 0.01), `${Geo.distance(there, ny).toFixed(4)} km off`);
  const mid = Geo.interpolate("London", "New York", 0.5);
  check("the great-circle midpoint is equidistant", close(Geo.distance("London", mid), d / 2, 1e-6) && close(Geo.distance(mid, "New York"), d / 2, 1e-6));
  check("the great circle from London to New York bulges north of both", mid[1] > 51.5, `midpoint at ${mid[1].toFixed(2)}°N`);
  const ends = [Geo.interpolate([170, 10], [-170, -10], 0), Geo.interpolate([170, 10], [-170, -10], 1)];
  check("interpolate hits both ends", close(Geo.distance(ends[0], [170, 10]), 0, 1e-6) && close(Geo.distance(ends[1], [-170, -10]), 0, 1e-6));
  const ring = Geo.circle("Suva", 1000, 64);
  const worst = Math.max(...ring.map(p => Math.abs(Geo.distance("Suva", p) - 1000)));
  check("a 1,000 km circle is 1,000 km from its center all round", worst < 1e-6, `worst ${worst.toExponential(1)} km`);
  check("cities cover every continent", new Set(Geo.cities.map(c => c.continent)).size === 7 && Geo.cities.length >= 60, `${Geo.cities.length} cities`);
  check("city lookup ignores case and accents", Geo.city("sao paulo")?.name === "São Paulo" && Geo.city("NYC")?.name === "New York");
}

// ---------- projections: round trips ----------
for (const name of Geo.projections) {
  for (const center of [[0, 0], [100, 30], [-150, -60]]) {
    const P = Geo.projection(name, { box: BOX, center });
    let worst = 0, n = 0;
    for (let lon = -180; lon < 180; lon += 7.5) for (let lat = -84; lat <= 84; lat += 6) {
      const q = P.forward([lon, lat]);
      if (!q) continue;
      const r = P.invert(q);
      if (!r) { worst = Infinity; continue; }
      const e = Geo.distance([lon, lat], r);
      worst = Math.max(worst, e); n++;
    }
    check(`${name} centered on ${center} round-trips`, worst < 1e-3 && n > 100, `${n} points, worst ${worst.toExponential(1)} km`);
  }
}
{
  const P = Geo.projection("equirectangular", { box: BOX, pad: 0 });
  check("equirectangular fits the box exactly", JSON.stringify(P.forward([-180, 90])) === "[0,0]" && JSON.stringify(P.forward([0, 0])) === "[400,200]");
  const E = Geo.projection("equalEarth", { box: BOX, pad: 0 });
  check("Equal Earth puts the poles on flat lines", close(E.forward([0, 90])[1], E.forward([120, 90])[1], 1e-9) && E.forward([120, 90])[0] > E.forward([0, 90])[0] + 50);
  const G = Geo.projection("orthographic", { box: BOX, center: "New York", pad: 10 });
  check("a globe's radius fits the shorter side less padding", close(G.radius, 190, 1e-9), `${G.radius}`);
  const c = G.forward("New York");
  check("the globe's center is the chosen place", close(c[0], 400, 1e-6) && close(c[1], 200, 1e-6));
  const F = Geo.projection("mercator", { box: BOX, fit: "France" });
  const paris = F.forward("Paris");
  check("fit: \"France\" zooms so France fills the box", F.scale > 1000 && paris[0] > 0 && paris[0] < 800 && paris[1] > 0 && paris[1] < 400, `scale ${F.scale.toFixed(0)}`);
}

// ---------- clipping ----------
{
  const G = Geo.projection("orthographic", { box: BOX, center: [0, 0] });
  check("orthographic hides the far side", G.forward([180, 0]) === null && G.forward([100, 10]) === null && G.forward([80, 10]) !== null);
  const N = Geo.projection("orthographic", { box: BOX, center: "New York" });
  check("from New York, London shows and Sydney doesn't", N.forward("London") !== null && N.forward("Sydney") === null);
  check("invert is null off the globe", G.invert([2, 2]) === null && G.invert([400, 200]) !== null);

  const pieces = N.line(["New York", "Sydney"]);
  const r = N.radius, o = N.origin;
  const endR = pieces.length ? Math.hypot(pieces[0].at(-1)[0] - o[0], pieces[0].at(-1)[1] - o[1]) : 0;
  check("a great circle over the horizon stops at the rim", pieces.length === 1 && close(endR, r, 0.01), `${pieces.length} piece, ends ${(endR - r).toFixed(4)} px from the rim`);

  const P = Geo.projection("equirectangular", { box: BOX, pad: 0 });
  const cut = P.line([[170, 0], [-170, 0]]);
  check("a line across the antimeridian is split in two", cut.length === 2, `${cut.length} pieces`);
  check("the two halves end on the map's edges", cut.length === 2 && close(cut[0].at(-1)[0], 800, 1e-6) && close(cut[1][0][0], 0, 1e-6));
  const P180 = Geo.projection("equirectangular", { box: BOX, pad: 0, center: [180, 0] });
  check("centered on 180°, the same line is whole", P180.line([[170, 0], [-170, 0]]).length === 1);
  const fiji = Geo.projection("equalEarth", { box: BOX }).line(Geo.circle("Suva", 1500));
  check("a circle round Suva splits at the antimeridian", fiji.length === 2, `${fiji.length} pieces`);

  const M = Geo.projection("mercator", { box: BOX, pad: 0 });
  check("Mercator drops points past 85°", M.forward([0, 86]) === null && M.forward([0, -86]) === null && M.forward([0, 84.9]) !== null);
  const top = M.forward([0, 85])[1], up = M.line([[0, 60], [0, 89]]);
  check("Mercator cuts a meridian at 85°", up.length === 1 && close(up[0].at(-1)[1], top, 1e-3), `ends at y = ${up[0].at(-1)[1].toFixed(3)}, 85° is at ${top.toFixed(3)}`);
  const sq = 400 / (2 * Math.log(Math.tan(Math.PI / 4 + 85 * Math.PI / 360)));
  check("Mercator to ±85° is about square", close(M.scale, Math.min(800 / (2 * Math.PI), sq), 1e-9) && close(top, 0, 1e-6), `${M.scale.toFixed(2)} px per radian`);
  check("Mercator invert is null past 85°", M.invert([400, -5]) === null);
}

// ---------- filled areas agree with point-in-country ----------
// Even-odd point in path, as the canvas fills it.
function inPaths(paths, p) {
  let c = false;
  for (const pts of paths) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}
function inOutline(P, p) { return inPaths([P.outline], p); }
function agree(label, P, rings, truth, step = 9) {
  const f = P.fill(rings);
  let bad = 0, n = 0, on = 0;
  for (let y = step / 2; y < BOX[3]; y += step) for (let x = step / 2; x < BOX[2]; x += step) {
    const q = P.invert([x, y]);
    if (!q || (f.clip && !inOutline(P, [x, y]))) continue;
    // Skip pixels right on a coast, where rounding decides.
    const t = truth(q);
    if ([[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].some(([dx, dy]) => truth(P.invert([x + dx, y + dy]) ?? q) !== t)) continue;
    n++;
    if (t) on++;
    if (inPaths(f.paths, [x, y]) !== t) bad++;
  }
  check(`${label}: fill matches containment`, bad === 0 && n > 500, `${n} px tested, ${on} inside, ${bad} wrong`);
}
{
  const land = c => Geo.countries.some(k => k.contains(c));
  const landRings = Geo.countries.flatMap(c => c.rings);
  const views = [
    ["equirectangular", [0, 0]], ["equirectangular", [150, 0]], ["mercator", [-100, 0]], ["equalEarth", [10, 0]],
    ["orthographic", [0, 0]], ["orthographic", [0, -90]], ["orthographic", [0, 90]], ["orthographic", [178, -17]], ["orthographic", [100, -60]],
    ["azimuthalEquidistant", [0, 90]], ["azimuthalEquidistant", [-74, 40.7]],
  ];
  for (const [name, center] of views) agree(`land, ${name} on ${center}`, Geo.projection(name, { box: BOX, center }), landRings, land);
  const P = Geo.projection("equirectangular", { box: BOX, rotate: [30, 50, 20] });
  agree("land, oblique equirectangular", P, landRings, land);

  for (const [name, center, place, km] of [
    ["equirectangular", [0, 0], "Suva", 3000], ["equalEarth", [0, 0], [0, 85], 2500], ["mercator", [0, 0], "Ushuaia", 4000],
    ["equirectangular", [0, 0], [20, 10], 15000], ["orthographic", [-30, 20], "London", 6000], ["orthographic", [150, 0], [0, 0], 13000],
    ["azimuthalEquidistant", [0, 0], [170, 0], 1500],
  ]) {
    const c = Geo.ll(place);
    agree(`${km} km circle round ${place}, ${name}`, Geo.projection(name, { box: BOX, center }), [{ dense: Geo.circle(c, km, 160), contains: q => Geo.distance(c, q) < km }], q => Geo.distance(c, q) < km);
  }
}

// ---------- countries ----------
{
  check("countries by name, alias, id, and alpha-3", Geo.country("France") === Geo.country("250") && Geo.country(250) === Geo.country("fra") && Geo.country("DR Congo")?.name === "Dem. Rep. Congo" && Geo.country("Ivory Coast")?.iso3 === "CIV");
  check("177 countries, 174 with ISO ids", Geo.countries.length === 177 && Geo.countries.filter(c => c.id).length === 174);
  const inside = [["London", "United Kingdom"], ["Paris", "France"], ["Suva", "Fiji"], [[0, -80], "Antarctica"], [[0, -90], "Antarctica"],
    [[-175, 66.5], "Russia"], [[176, 66], "Russia"], ["Kinshasa", "Dem. Rep. Congo"], ["Nairobi", "Kenya"], ["Sydney", "Australia"], [[28.2, -29.5], "Lesotho"]];
  for (const [p, name] of inside) check(`${typeof p === "string" ? p : JSON.stringify(p)} is in ${name}`, Geo.countryAt(p)?.name === name, Geo.countryAt(p)?.name ?? "nowhere");
  check("the middle of the Atlantic is in no country", Geo.countryAt([-30, 30]) === null && Geo.countryAt([0, 0]) === null);
  check("Lesotho is a hole in South Africa", !Geo.contains("South Africa", [28.2, -29.5]) && Geo.contains("South Africa", "Johannesburg"));
  check("the Caspian Sea is not land", Geo.countryAt([50.5, 42]) === null);
  const P = Geo.projection("orthographic", { box: BOX, center: "Paris" });
  check("pick by pixel: the globe's center is France", Geo.countryAt(P.invert([400, 200]))?.name === "France");
  // Areas from the 110m outlines, against official totals (land and inland water).
  for (const [name, km2, tol] of [["Brazil", 8.516e6, 0.04], ["Australia", 7.692e6, 0.04], ["Russia", 17.1e6, 0.05], ["Greenland", 2.166e6, 0.06]]) {
    const a = Geo.area(name);
    check(`area of ${name} is about ${(km2 / 1e6).toFixed(2)} million km²`, Math.abs(a - km2) / km2 < tol, `${(a / 1e6).toFixed(3)} million km²`);
  }
  // Natural Earth's 110m Antarctica follows the grounding line and leaves out the ice shelves, so McMurdo Station,
  // on the edge of the Ross Ice Shelf, is just off it, and the continent comes out near 12 rather than 14 million km².
  check("McMurdo Station sits on the ice shelf, off the 110m outline", Geo.countryAt("McMurdo Station") === null);
  const total = Geo.countries.reduce((s, c) => s + c.area, 0) - Geo.area("Antarctica");
  check("land outside Antarctica adds up to about 134.7 million km²", Math.abs(total - 134.7e6) / 134.7e6 < 0.04, `${(total / 1e6).toFixed(1)} million km²`);
  const outside = Geo.countries.filter(c => !c.contains(c.center)).map(c => c.name);
  check("every country's label point lies inside it", outside.length === 0, outside.join(", ") || "177 of 177");
  const usa = Geo.country("USA").center;
  check("label point of the USA is in the lower 48", usa[0] > -110 && usa[0] < -85 && usa[1] > 33 && usa[1] < 45, usa.map(v => v.toFixed(1)).join(", "));
}

// ---------- g.map on a recording canvas ----------
{
  const calls = [];
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (k === "createRadialGradient" ? () => ({ addColorStop() {} }) : (...a) => { calls.push(k); })),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const g = {
    ctx, w: 640, h: 360, circle() { calls.push("circle"); }, text() { calls.push("text"); }, rect() {}, path() { calls.push("path"); },
    measure: s => String(s).length * 6.5,
  };
  const util = { color: c => c, rgb: c => (c === "ink" ? [17, 17, 17] : [252, 252, 252]), rgba: (c, a) => `rgba(${c},${a})`, mix: (a, b, t) => `mix(${a},${b},${t})` };
  for (const ext of window.__safisG) ext(g, util);
  let ok = true, err = "";
  try {
    for (const projection of Geo.projections) {
      const M = g.map({ projection, center: [20, 10] });
      M.country(["Brazil", "FRA"], { color: "blue", label: true });
      M.choropleth({ Brazil: 3, France: 7, Narnia: 2, "840": 5 }, { legend: { title: "Value" } });
      M.choropleth(c => c.area / 1e6, { diverging: true, steps: 5, legend: true });
      M.countries({ fill: c => (c.name.length % 2 ? "green" : null) });
      const pts = M.points(Geo.cities);
      M.marker("Tokyo", { label: true });
      const a = M.arc("London", "Tokyo", { arrow: true, label: "9,560 km", progress: 0.7 });
      M.line(["London", "Cairo", "Delhi"]);
      M.circle("Suva", 2000, { fill: true });
      M.parallel(23.44, { label: "Tropic of Cancer" });
      M.meridian(0, { label: "Greenwich" });
      M.label("Pacific", [-150, 0]);
      M.graticule({ step: [15, 10] });
      if (!pts.drawn.length || typeof a.km !== "number") throw new Error(`${projection}: nothing drawn`);
      if (M.countryAt(M.project("Paris") ?? [0, 0]) && M.countryAt(M.project("Paris")).name !== "France") throw new Error(`${projection}: countryAt`);
      const c2 = M.pan([30, -20]);
      if (!Array.isArray(c2) || !c2.every(Number.isFinite)) throw new Error(`${projection}: pan`);
    }
    g.map({ projection: "globe", view: { yaw: 0.5, pitch: 0.2 }, fit: ["Japan"] });
    g.map({ projection: "mercator", fit: [[-10, 35], [30, 60]], graticule: 10, land: { fill: "panel" }, borders: false });
  } catch (e) { ok = false; err = e.stack; }
  check("every g.map helper runs in every projection", ok, err || `${calls.length} canvas calls`);
  check("unknown countries in a choropleth are reported, not drawn", (() => {
    const M = g.map({ base: false });
    return JSON.stringify(M.choropleth({ Narnia: 1, Chile: 2 }).unmatched) === '["Narnia"]';
  })());
  let threw = false;
  try { g.map({ base: false }).country("Atlantis"); } catch (e) { threw = /unknown country/.test(e.message); }
  check("a misspelled country name throws a clear error", threw);
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
