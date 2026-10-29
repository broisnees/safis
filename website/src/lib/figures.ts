// Figure scripts embedded in a page wait as inert blocks; the layout runs them in page order once
// the deferred kits have loaded (see layouts/Base.astro), so text paints before the kits arrive.
export const inertFigures = (html: string) => html.replace(/<script>([\s\S]*?)<\/script>/g, (_m, js) => `<script type="text/safis-figure">${js}</script>`);
