// Search: the meta description search engines show, and the structured data (schema.org JSON-LD)
// that tells them what each page is. Explainers are blog posts of the site; the home page is the
// site, its publisher, and the Safis skill itself.

export const SITE = "Safis";
export const REPO = "https://github.com/broisnees/safis";

// Search results show about 155 characters. A longer description is cut at the last sentence,
// clause, or word that fits, so it never ends mid-word.
export function metaDescription(text: string, max = 158): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  for (const re of [/[.!?](?=\s)[^.!?]*$/, /[;:,](?=\s)[^;:,]*$/]) {
    const m = cut.match(re);
    if (m && m.index! > max * 0.55) return /[.!?]/.test(cut[m.index!]) ? cut.slice(0, m.index! + 1) : cut.slice(0, m.index!).trim() + ".";
  }
  return cut.replace(/\s+\S*$/, "").replace(/[,;:]$/, "") + ".";
}

const iso = (ms: number) => new Date(ms).toISOString();

export const publisher = (origin: string) => ({
  "@type": "Organization",
  name: SITE,
  url: origin,
  logo: { "@type": "ImageObject", url: `${origin}favicon.svg` },
  sameAs: [REPO],
});

export const website = (origin: string) => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE,
  url: origin,
  description: "Interactive explainers of how things work, and the agent skill that writes them.",
  publisher: publisher(origin),
  potentialAction: {
    "@type": "SearchAction",
    target: { "@type": "EntryPoint", urlTemplate: `${origin}examples/?q={search_term_string}` },
    "query-input": "required name=search_term_string",
  },
});

export const software = (origin: string, description: string) => ({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Safis",
  alternateName: "Safis skill",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any",
  description,
  url: origin,
  downloadUrl: REPO,
  codeRepository: REPO,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: publisher(origin),
});

export const breadcrumbs = (items: { name: string; url: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
});

interface Page { slug: string; title: string; dek: string; category: string; words: number; minutes: number; figures: number; added: number; modified?: number }

export const article = (origin: string, page: Page, url: string, images: string[]) => ({
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: page.title,
  description: metaDescription(page.dek),
  url,
  mainEntityOfPage: { "@type": "WebPage", "@id": url },
  image: images,
  datePublished: iso(page.added),
  dateModified: iso(page.modified ?? page.added),
  articleSection: page.category,
  wordCount: page.words,
  timeRequired: `PT${page.minutes}M`,
  inLanguage: "en",
  isAccessibleForFree: true,
  learningResourceType: "Interactive explainer",
  interactivityType: "mixed",
  about: page.category,
  author: publisher(origin),
  publisher: publisher(origin),
});

export const collection = (origin: string, url: string, name: string, description: string, pages: Page[]) => ({
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name,
  description,
  url,
  isPartOf: { "@type": "WebSite", name: SITE, url: origin },
  mainEntity: {
    "@type": "ItemList",
    numberOfItems: pages.length,
    itemListElement: pages.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${origin}${p.slug}/`, name: p.title })),
  },
});

export const guide = (origin: string, url: string, name: string, description: string) => ({
  "@context": "https://schema.org",
  "@type": "TechArticle",
  headline: name,
  description: metaDescription(description),
  url,
  inLanguage: "en",
  about: { "@type": "SoftwareApplication", name: "Safis", url: origin },
  publisher: publisher(origin),
});
