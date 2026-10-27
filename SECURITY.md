# Security

## What runs where

- **Pages** are static HTML. The runtime makes no network requests, stores only the theme choice in `localStorage`, and runs nothing but the page's own figure scripts.
- **Skill scripts** (`skills/safis/scripts/`) run on the machine of whoever uses the skill. They start a local headless Chrome with a throwaway profile, load the page from disk, and write screenshots to the temp folder.
- **Render step** (`scripts/render.mjs`) installs its pinned npm dependencies into a cache folder on first use and runs them in Node.

## Supported versions

Only `main` gets fixes. Pages carry their runtime inside them, so after a fix, rebuild old pages with `scripts/upgrade.mjs`, or rerun `site.mjs` for a site built with `--shared`.

## Reporting a vulnerability

Report it privately through GitHub: [open a security advisory](https://github.com/broisnischal/safis/security/advisories/new). Please don't open a public issue for it.

Include what's affected (the runtime, a script, a package), how to reproduce it, and what an attacker gets. I'll confirm I've received it, keep you updated while I work on a fix, and credit you in the release notes unless you'd rather not be named.

## In scope

- Script injection through page content the runtime processes: TeX, prose bindings, citations, Mermaid or code blocks.
- Skill scripts that read or write outside the paths they're given, or that reach the network when they shouldn't.
- Anything in `packages/` that runs untrusted input on a server.

Figure code that a page's own author writes runs with the page's full privileges by design, so it's out of scope.
