#!/usr/bin/env bash
# Joins the article parts in order and splices them into the page.
set -e
cd "$(dirname "$0")/.."
cat parts/[0-9]*.html > article.html
node ../../skills/safis/scripts/put-article.mjs index.html article.html
