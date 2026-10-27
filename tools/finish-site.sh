#!/usr/bin/env bash
# Final pass: build, test, render, thumbnails, check every page, stage the passing
# pages, deploy. Prints only summary lines.
# Usage: finish.sh [--deploy]
set -u
cd "$(dirname "$0")/.."
S="${TMPDIR:-/tmp}/safis-finish"; mkdir -p "$S"
node tools/build-template.mjs | tail -1
npm test --silent >"$S/test.log" 2>&1 && echo "tests: all passed" || { echo "tests FAILED"; grep -E 'FAIL|not ok|Error' "$S/test.log" | head -8; }
for p in site/*/index.html; do node skills/safis/scripts/render.mjs "$p" >/dev/null 2>&1 || echo "render failed: $p"; done
node skills/safis/scripts/site.mjs site --shared --thumbs 2>&1 | tail -1
pass=()
for p in site/*/index.html; do
  slug=$(basename "$(dirname "$p")")
  r=$(node skills/safis/scripts/verify.mjs "$p" --out "$S/final/$slug" 2>&1)
  last=$(echo "$r" | tail -1)
  txt=$(echo "$r" | grep '^Text:' | sed 's/Text: //')
  echo "$slug: $last | $txt"
  echo "$r" | grep -E '^\s+ERROR|error:|console:' | head -3
  [[ "$last" == PASS* ]] && pass+=("$slug")
done
echo "passing: ${#pass[@]} pages"
if [[ "${1:-}" == "--deploy" ]]; then
  D="$S/deploy-site"; rm -rf "$D"; mkdir -p "$D"
  cp site/404.html site/safis.css site/safis.js "$D/"
  for s in "${pass[@]}"; do cp -r "site/$s" "$D/"; done
  node skills/safis/scripts/site.mjs "$D" | tail -1
  npx -y wrangler@4 deploy --assets "$D" 2>&1 | grep -E 'Uploaded [0-9]+ files|safis.fyi|Version ID|ERROR|error' | head -6
  for h in safis.fyi www.safis.fyi; do curl -s -o /dev/null -w "$h %{http_code}\n" --max-time 15 "https://$h/"; done
fi
