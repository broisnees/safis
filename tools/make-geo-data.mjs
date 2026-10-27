#!/usr/bin/env node
// Builds the map data embedded in src/geo.js from world-atlas's countries-110m.json.
//
// Source: Natural Earth 1:110m Admin 0 countries (public domain, naturalearthdata.com),
// as TopoJSON from the world-atlas package 2.0.2 by Mike Bostock (ISC license).
//
// The TopoJSON keeps shared borders as shared arcs, so the data stays topological:
// a country is a list of rings, a ring is a list of arc references, and an arc used by
// two countries is a border while an arc used by one is coast. This script
// re-quantizes every arc to hundredths of a degree, drops repeated points, delta-encodes
// each arc (zigzag varints, 5 bits per base64url character), and writes the result
// between the geo-data markers in src/geo.js.
//
// Usage: node tools/make-geo-data.mjs [countries-110m.json] [--print]
// Without a file it downloads the pinned version from jsDelivr. --print writes the block
// to stdout instead of into src/geo.js.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const print = args.includes("--print");
const file = args.find(a => !a.startsWith("--"));

const topo = file ? JSON.parse(await readFile(file, "utf8")) : await (await fetch(URL)).json();
if (topo.type !== "Topology" || !topo.objects?.countries || !topo.objects?.land) throw new Error("expected world-atlas countries TopoJSON");

// ISO 3166-1 alpha-3 codes by numeric code, for the 174 countries that have one in the data.
// Kosovo has no ISO code; XKX is the user-assigned code most data sets use for it.
const ISO3 = {
  "004": "AFG", "008": "ALB", "010": "ATA", "012": "DZA", "024": "AGO", "031": "AZE", "032": "ARG", "036": "AUS", "040": "AUT", "044": "BHS",
  "050": "BGD", "051": "ARM", "056": "BEL", "064": "BTN", "068": "BOL", "070": "BIH", "072": "BWA", "076": "BRA", "084": "BLZ", "090": "SLB",
  "096": "BRN", "100": "BGR", "104": "MMR", "108": "BDI", "112": "BLR", "116": "KHM", "120": "CMR", "124": "CAN", "140": "CAF", "144": "LKA",
  "148": "TCD", "152": "CHL", "156": "CHN", "158": "TWN", "170": "COL", "178": "COG", "180": "COD", "188": "CRI", "191": "HRV", "192": "CUB",
  "196": "CYP", "203": "CZE", "204": "BEN", "208": "DNK", "214": "DOM", "218": "ECU", "222": "SLV", "226": "GNQ", "231": "ETH", "232": "ERI",
  "233": "EST", "238": "FLK", "242": "FJI", "246": "FIN", "250": "FRA", "260": "ATF", "262": "DJI", "266": "GAB", "268": "GEO", "270": "GMB",
  "275": "PSE", "276": "DEU", "288": "GHA", "300": "GRC", "304": "GRL", "320": "GTM", "324": "GIN", "328": "GUY", "332": "HTI", "340": "HND",
  "348": "HUN", "352": "ISL", "356": "IND", "360": "IDN", "364": "IRN", "368": "IRQ", "372": "IRL", "376": "ISR", "380": "ITA", "384": "CIV",
  "388": "JAM", "392": "JPN", "398": "KAZ", "400": "JOR", "404": "KEN", "408": "PRK", "410": "KOR", "414": "KWT", "417": "KGZ", "418": "LAO",
  "422": "LBN", "426": "LSO", "428": "LVA", "430": "LBR", "434": "LBY", "440": "LTU", "442": "LUX", "450": "MDG", "454": "MWI", "458": "MYS",
  "466": "MLI", "478": "MRT", "484": "MEX", "496": "MNG", "498": "MDA", "499": "MNE", "504": "MAR", "508": "MOZ", "512": "OMN", "516": "NAM",
  "524": "NPL", "528": "NLD", "540": "NCL", "548": "VUT", "554": "NZL", "558": "NIC", "562": "NER", "566": "NGA", "578": "NOR", "586": "PAK",
  "591": "PAN", "598": "PNG", "600": "PRY", "604": "PER", "608": "PHL", "616": "POL", "620": "PRT", "624": "GNB", "626": "TLS", "630": "PRI",
  "634": "QAT", "642": "ROU", "643": "RUS", "646": "RWA", "682": "SAU", "686": "SEN", "688": "SRB", "694": "SLE", "703": "SVK", "704": "VNM",
  "705": "SVN", "706": "SOM", "710": "ZAF", "716": "ZWE", "724": "ESP", "728": "SSD", "729": "SDN", "732": "ESH", "740": "SUR", "748": "SWZ",
  "752": "SWE", "756": "CHE", "760": "SYR", "762": "TJK", "764": "THA", "768": "TGO", "780": "TTO", "784": "ARE", "788": "TUN", "792": "TUR",
  "795": "TKM", "800": "UGA", "804": "UKR", "807": "MKD", "818": "EGY", "826": "GBR", "834": "TZA", "840": "USA", "854": "BFA", "858": "URY",
  "860": "UZB", "862": "VEN", "887": "YEM", "894": "ZMB",
};

// ---------- arcs: absolute degrees -> hundredths of a degree ----------
const Q = 100;
const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
const arcs = topo.arcs.map(arc => {
  let x = 0, y = 0;
  const pts = arc.map(([dx, dy]) => { x += dx; y += dy; return [Math.round((x * sx + tx) * Q), Math.round((y * sy + ty) * Q)]; });
  // Drop interior points that repeat their neighbor after rounding; the ends are shared with other arcs, so they stay.
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], q = out[out.length - 1];
    if (p[0] === q[0] && p[1] === q[1] && i < pts.length - 1) continue;
    if (p[0] === q[0] && p[1] === q[1] && out.length > 1 && i === pts.length - 1) out.pop();
    out.push(p);
  }
  return out;
});

// ---------- zigzag varints, five bits per base64url character ----------
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const chars = [];
const put = n => {
  let z = n >= 0 ? 2 * n : -2 * n - 1;
  do {
    const bits = z % 32;
    z = Math.floor(z / 32);
    chars.push(ALPHA[bits + (z > 0 ? 32 : 0)]);
  } while (z > 0);
};
put(arcs.length);
let px = 0, py = 0, points = 0;
for (const a of arcs) {
  put(a.length);
  put(a[0][0] - px); put(a[0][1] - py);
  [px, py] = a[0];
  for (let i = 1; i < a.length; i++) { put(a[i][0] - a[i - 1][0]); put(a[i][1] - a[i - 1][1]); }
  points += a.length;
}
const stream = chars.join("");

// ---------- countries and land as arc references ----------
const polys = g => (g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : []);
const countries = topo.objects.countries.geometries.map(g => {
  const id = g.id == null ? "" : String(g.id).padStart(3, "0");
  const name = g.properties?.name ?? "";
  const iso3 = ISO3[id] ?? (name === "Kosovo" ? "XKX" : "");
  if (id && !ISO3[id]) throw new Error(`no alpha-3 code for ${id} ${name}`);
  return [id, name, iso3, polys(g)];
});
const land = topo.objects.land.geometries.flatMap(polys);

const wrap = (s, n) => s.match(new RegExp(`.{1,${n}}`, "g")).join("\n");
const block = [
  "  // Natural Earth 1:110m countries (public domain), from world-atlas 2.0.2 countries-110m.json",
  "  // (ISC license, Mike Bostock). Generated by tools/make-geo-data.mjs; don't edit by hand.",
  `  // ${arcs.length} arcs, ${points} points in hundredths of a degree; ${countries.length} countries.`,
  "  const DATA = {",
  `    arcs: \`\n${wrap(stream, 160)}\`,`,
  "    // [ISO numeric, name, ISO alpha-3, polygons as rings of arc indexes (~i is arc i reversed)]",
  "    countries: [",
  ...countries.map(c => `      ${JSON.stringify(c)},`),
  "    ],",
  `    land: ${JSON.stringify(land)},`,
  "  };",
].join("\n");

if (print) { process.stdout.write(block + "\n"); process.exit(0); }
const target = path.join(root, "src/geo.js");
const src = await readFile(target, "utf8");
const START = "  /* geo-data:start */", END = "  /* geo-data:end */";
const a = src.indexOf(START), b = src.indexOf(END);
if (a < 0 || b < a) throw new Error("geo-data markers not found in src/geo.js");
await writeFile(target, src.slice(0, a + START.length) + "\n" + block + "\n" + src.slice(b));
console.log(`wrote ${arcs.length} arcs (${points} points, ${(stream.length / 1024).toFixed(1)} KB) and ${countries.length} countries into src/geo.js`);
