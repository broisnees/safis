// The order fields appear in, on the examples page and in every explainer's index. Only fields
// that have at least one page are shown, so a field listed here with no pages yet stays hidden.
export const ORDER = ["Body", "Biology", "Chemistry", "Physics", "Machines", "Engineering", "Earth & Space", "Computing", "AI", "Math", "History", "Philosophy", "Language", "Economics & Society", "Art & Music"];
export const rank = (c: string) => ORDER.indexOf(c) + 1 || 99;
/** The fields that have pages, in reading order. */
export const fieldsOf = (pages: { category: string }[]) =>
  [...new Set(pages.map(p => p.category).filter(Boolean))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
