// The explainers as a feed, newest first, so readers and aggregators can follow the site like a blog.
import type { APIRoute } from "astro";
import pages from "../generated/pages.json";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const GET: APIRoute = ({ site }) => {
  const origin = new URL(import.meta.env.BASE_URL, site).href;
  const list = [...pages].sort((a, b) => b.added - a.added);
  const items = list.map(p => `    <item>
      <title>${esc(p.title)}</title>
      <link>${origin}${p.slug}/</link>
      <guid isPermaLink="true">${origin}${p.slug}/</guid>
      <pubDate>${new Date(p.added).toUTCString()}</pubDate>
      <category>${esc(p.category)}</category>
      <description>${esc(p.dek)}</description>${p.thumb ? `
      <enclosure url="${origin}${p.slug}/thumb.webp" type="image/webp" length="0" />` : ""}
    </item>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Safis: how things work</title>
    <link>${origin}</link>
    <description>Interactive explainers of how things work: prose that builds the idea step by step, with live figures to drag, turn, and run.</description>
    <language>en</language>
    <lastBuildDate>${new Date(Math.max(...list.map(p => p.modified ?? p.added))).toUTCString()}</lastBuildDate>
    <atom:link href="${origin}rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};
