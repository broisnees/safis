import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { readFileSync } from "node:fs";

// Each explainer's last change (from the sync step) becomes its <lastmod>, so search engines
// recrawl what changed; the 404 page stays out of the sitemap.
const lastmod = (() => {
  try { return new Map(JSON.parse(readFileSync(new URL("./src/generated/pages.json", import.meta.url), "utf8")).map(p => [p.slug, new Date(p.modified ?? p.added).toISOString()])); }
  catch { return new Map(); }
})();
const built = new Date().toISOString();

// Static site. Each explainer is one page, and each runtime kit is its own hashed chunk that
// a page loads only if its figures use it, so a math page never downloads the 3D engine.
export default defineConfig({
  site: process.env.SAFIS_SITE ?? "https://safis.fyi",
  // SAFIS_BASE="/safis" for a GitHub project page; the sync step uses the same value.
  base: process.env.SAFIS_BASE || "/",
  trailingSlash: "always",
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  build: { format: "directory", inlineStylesheets: "never" },
  integrations: [sitemap({
    filter: page => !/\/404\/?$/.test(page),
    serialize(item) {
      const slug = new URL(item.url).pathname.split("/").filter(Boolean).pop();
      item.lastmod = (slug && lastmod.get(slug)) || built;
      return item;
    },
  })],
  vite: { build: { chunkSizeWarningLimit: 1200 } },
});
