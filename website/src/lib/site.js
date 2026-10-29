// Site behavior that doesn't need the figure runtime: the theme button in the bar, copy
// buttons, the mobile menu, tabs, and the examples filter.
const root = document.documentElement;
const KEY = "safis-theme";
// Dark unless the reader chose otherwise; "auto" (follow the system) is stored like the others.
const saved = () => { try { const t = localStorage.getItem(KEY); return t === "light" || t === "auto" ? t : "dark"; } catch { return "dark"; } };
// The button carries all three icons; CSS shows the one for html[data-theme-mode] (set before
// the first paint), so nothing in the bar changes as the page loads.
const syncTheme = () => {
  const mode = saved();
  root.dataset.themeMode = mode;
  for (const b of document.querySelectorAll(".sbar .theme-toggle")) {
    const label = `Theme: ${mode === "auto" ? "match system" : mode}`;
    if (b.getAttribute("aria-label") !== label) { b.setAttribute("aria-label", label); b.title = label; }
  }
};
// Same storage and attribute as the runtime's own switch, so figures redraw on the change.
function setTheme(mode) {
  const still = document.createElement("style");
  still.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.append(still);
  if (mode === "light" || mode === "dark") root.dataset.theme = mode; else delete root.dataset.theme;
  void getComputedStyle(document.body).opacity;
  requestAnimationFrame(() => still.remove());
  try { if (mode === "dark") localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch {}
  const light = mode === "light" || (mode === "auto" && matchMedia("(prefers-color-scheme: light)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#fcfcfc" : "#000000");
  syncTheme();
}
for (const b of document.querySelectorAll(".sbar .theme-toggle")) {
  b.addEventListener("click", () => {
    const order = ["dark", "light", "auto"];
    setTheme(order[(order.indexOf(saved()) + 1) % order.length]);
  });
}
syncTheme();

// Copy buttons.
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  const text = b.dataset.copy;
  const was = b.textContent;
  try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch { b.textContent = "Select it"; }
  setTimeout(() => (b.textContent = was), 1400);
});

// The mobile menu closes on a click outside it or Escape.
for (const m of document.querySelectorAll("details.menu")) {
  document.addEventListener("click", e => { if (m.open && !m.contains(e.target)) m.open = false; });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && m.open) { m.open = false; m.querySelector("summary").focus(); } });
}

// Tabs: [data-tabs] holds buttons with data-tab, panels with data-panel.
for (const t of document.querySelectorAll("[data-tabs]")) {
  const buttons = [...t.querySelectorAll("[data-tab]")], panels = [...t.querySelectorAll("[data-panel]")];
  const pick = id => {
    for (const b of buttons) b.setAttribute("aria-selected", String(b.dataset.tab === id));
    for (const p of panels) p.hidden = p.dataset.panel !== id;
  };
  for (const b of buttons) b.addEventListener("click", () => pick(b.dataset.tab));
  if (buttons[0]) pick(buttons[0].dataset.tab);
}

// The examples page: a search box and category chips.
const grid = document.querySelector("[data-filter-grid]");
if (grid) {
  const cards = [...grid.querySelectorAll(".ecard")];
  const input = document.querySelector("[data-filter-search]");
  const chips = [...document.querySelectorAll("[data-filter-cat]")];
  const empty = document.querySelector("[data-filter-empty]");
  const count = document.querySelector("[data-filter-count]");
  const params = new URLSearchParams(location.search);
  let cat = params.get("category") || "all";
  // ?q= fills the search (the site search that search engines link to).
  if (input && params.get("q")) input.value = params.get("q");
  // A link to a field with no pages (yet) shows them all rather than an empty page.
  if (!chips.some(b => b.dataset.filterCat === cat)) cat = "all";
  const apply = () => {
    const q = (input?.value || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const c of cards) {
      const ok = (cat === "all" || c.dataset.cat === cat) && q.every(w => c.dataset.text.includes(w));
      c.hidden = !ok;
      if (ok) shown++;
    }
    for (const b of chips) b.setAttribute("aria-pressed", String(b.dataset.filterCat === cat));
    if (empty) empty.hidden = shown > 0;
    if (count) count.textContent = String(shown);
  };
  for (const b of chips) b.addEventListener("click", () => {
    cat = b.dataset.filterCat;
    const u = new URL(location.href);
    if (cat === "all") u.searchParams.delete("category"); else u.searchParams.set("category", cat);
    history.replaceState(null, "", u);
    apply();
  });
  input?.addEventListener("input", apply);
  document.querySelector("[data-filter-reset]")?.addEventListener("click", () => {
    cat = "all";
    if (input) input.value = "";
    history.replaceState(null, "", location.pathname);
    apply();
    input?.focus();
  });
  addEventListener("keydown", e => {
    if (e.key === "Escape" && document.activeElement === input && input.value) { input.value = ""; apply(); return; }
    if (e.key === "/" && document.activeElement !== input && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) { e.preventDefault(); input?.focus(); }
  });
  apply();
}

// What it makes: the contents column marks the kind being read.
const kindsNav = document.querySelector(".kinds-nav");
if (kindsNav) {
  const links = new Map([...kindsNav.querySelectorAll("a[data-kind]")].map(a => [a.dataset.kind, a]));
  const seen = new Set();
  const mark = () => {
    const first = [...links.keys()].find(id => seen.has(id));
    for (const [id, a] of links) if (id === first) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
  };
  const io = new IntersectionObserver(es => { for (const e of es) e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id); mark(); }, { rootMargin: "-30% 0px -60% 0px" });
  for (const id of links.keys()) { const el = document.getElementById(id); if (el) io.observe(el); }
}
