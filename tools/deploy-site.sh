#!/usr/bin/env bash
# Builds the website (website/, Astro) from the explainers in site/ and the runtime in src/,
# checks it, and deploys it to https://safis.fyi. Pages with a folder in drafts/ are left out.
# Every link is always checked; pass slugs to also verify those pages (the home always is).
# Usage: tools/deploy-site.sh [slug...]
set -eu
cd "$(dirname "$0")/.."
npm run site:build --silent >/dev/null
only="home"; for s in "$@"; do only="$only,$s"; done
node tools/check-website.mjs --only "$only" || { echo "the website fails its check; not deploying"; exit 1; }
npx -y wrangler@4 deploy 2>&1 | grep -E 'Uploaded [0-9]+ files|Version ID|ERROR' | head -3
curl -s -o /dev/null -w "safis.fyi %{http_code}\n" --max-time 15 https://safis.fyi/
