// Site behavior that doesn't need the figure runtime: the theme button in the bar, copy
// buttons, the mobile menu, tabs, sections settling in, and the examples filter.
const root = document.documentElement;
const KEY = "safis-theme";
const saved = () => { try { return localStorage.getItem(KEY) || "auto"; } catch { return "auto"; } };
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
  try { if (mode === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch {}
  syncTheme();
}
for (const b of document.querySelectorAll(".sbar .theme-toggle")) {
  b.addEventListener("click", () => {
    const order = ["auto", "light", "dark"];
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

// Sections settle in as they scroll into view.
const rise = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); rise.unobserve(e.target); } }, { threshold: 0.08 });
for (const el of document.querySelectorAll(".rise")) rise.observe(el);

// The examples page: a search box and category chips.
const grid = document.querySelector("[data-filter-grid]");
if (grid) {
  const cards = [...grid.querySelectorAll(".ecard")];
  const input = document.querySelector("[data-filter-search]");
  const chips = [...document.querySelectorAll("[data-filter-cat]")];
  const empty = document.querySelector("[data-filter-empty]");
  const count = document.querySelector("[data-filter-count]");
  let cat = new URLSearchParams(location.search).get("category") || "all";
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
  addEventListener("keydown", e => {
    if (e.key === "/" && document.activeElement !== input && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) { e.preventDefault(); input?.focus(); }
  });
  apply();
}
