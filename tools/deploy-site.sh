#!/usr/bin/env bash
# Deploys site/ to Cloudflare without the pages still in drafts/: stages the finished
# pages, rebuilds the home page for them, and uploads. Pass slugs to verify them first.
# Usage: tools/deploy-site.sh [slug...]
set -eu
cd "$(dirname "$0")/.."
for s in "$@"; do node skills/safis/scripts/verify.mjs "site/$s/index.html" | tail -1 | grep -q '^PASS' || { echo "$s fails verify; not deploying"; exit 1; }; done
D="${TMPDIR:-/tmp}/safis-deploy"; rm -rf "$D"; mkdir -p "$D"
cp site/404.html site/safis.css site/safis.js "$D/"
for p in site/*/index.html; do s=$(basename "$(dirname "$p")"); [ -d "drafts/$s" ] || cp -r "site/$s" "$D/"; done
node skills/safis/scripts/site.mjs "$D" --shared --home web/home.html | tail -1
npx -y wrangler@4 deploy --assets "$D" 2>&1 | grep -E 'Uploaded [0-9]+ files|Version ID|ERROR' | head -3
curl -s -o /dev/null -w "safis.fyi %{http_code}\n" --max-time 15 https://safis.fyi/
