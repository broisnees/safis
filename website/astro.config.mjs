import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

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
  integrations: [sitemap()],
  vite: { build: { chunkSizeWarningLimit: 1200 } },
});
