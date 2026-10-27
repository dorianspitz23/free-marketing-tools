<div align="center">

# Free marketing tools, one a day

**Ten free, one-page marketing tools in ten days. No sign-up, works on your phone.**

![HTML](https://img.shields.io/badge/HTML-single--file-E34F26?logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?logo=javascript&logoColor=black)
![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/hub-GitHub%20Pages-222?logo=github)

[Open the hub](https://dorianspitz23.github.io/free-marketing-tools/) · Built with [Omniscio](https://omniscio.com)

</div>

## Overview

A 10-day challenge: every day a new free tool for marketers and online store owners. Each tool is one
self-contained HTML page hosted as an Omniscio Share, and this repo's hub page lists them all as they
ship.

## Features

- **Day 1 — Break-even ROAS calculator.** The lowest ROAS where your ads stop losing money, with
  discounts, payment fees, shipping and returns counted, plus the target ROAS (as a Google Ads %) for
  the profit you want to keep.
- **Day 2 — UTM link builder.** Tagged links that land in the right GA4 channel. Flags capitals,
  spaces, stray whitespace, characters that get encoded, missing fields, UTMs already in the pasted
  link, and mediums GA4's default channel rules don't recognise, each with a one-click fix. Bulk mode
  takes rows pasted from a spreadsheet and gives back a table of finished links with Fix all and
  Copy all.
- **Day 3 — Search result preview.** A Google result and a search ad on desktop and mobile side by
  side, cut where Google would cut them, measured by pixel width in Google's fonts rather than by
  character count. Live width meters for the title and description, warnings for cut text and a focus
  keyword missing from the title, and 30/90/15 character counters for ad headlines, descriptions and
  paths. The pixel limits are commonly measured estimates; Google doesn't publish them.
- **The hub.** A brand column with a 10-segment progress bar, and a grid of all 10 days: shipped tools as cards with a screenshot, future days locked. A neutral link preview for posting on X.
- **Phone-first.** Every page is checked at 390 px wide with no sideways scrolling.
- **No accounts, no tracking, nothing stored.** Each tool runs entirely in the browser.

## Tech stack

| Part | Choice | Why |
| --- | --- | --- |
| Tools | One HTML file each, vanilla JS | An Omniscio Share hosts a single file and blocks outside requests |
| Hub | Static HTML + `tools.json` on GitHub Pages | Adding a day is one list entry |
| Look | `shared/tokens.css`: dark ink, acid-lime accent, coral for losses | One design across the hub and every tool |
| Tests | `node --test` | No dependencies to install |
| Page checks | Playwright + local Chrome | Phone and desktop, under the Share's sandbox rules |

## Project structure

```
docs/                 the hub, served by GitHub Pages
  index.html          renders tools.json; link-preview tags stay Omniscio-free
  tools.json          one entry per day: day, name, blurb, url, shot
  shots/<tool>.png    card thumbnails (written by render-shots.cjs)
  mark.svg            the brand mark
  og.png              the 1200x630 link-preview image
  tokens.css          copy of shared/tokens.css (written by the build)
shared/tokens.css     the one design-token file
tools/<tool>/         a tool: index.html, its logic, and its tests
scripts/
  build.mjs           inlines each tool into dist/<tool>.html and refreshes docs/tokens.css
  check-ui.cjs        phone/desktop checks for every tool (TOOL_CHECKS) and the hub
  render-og.cjs       regenerates docs/og.png from og-card.html
  render-shots.cjs    renders each dist/<tool>.html into docs/shots/<tool>.png
tests/hub.test.mjs    hub rules: neutral preview, valid tools.json, Built with Omniscio
```

## Getting started

**Prerequisites:** Node 18 or newer. For the page checks and the preview image: Google Chrome, and
Playwright available on `NODE_PATH` (set `CHROME_PATH` if Chrome is not in the default Windows place).

```bash
npm test              # all unit tests
npm run build         # writes dist/<tool>.html and docs/tokens.css
npm run check:ui      # phone + desktop checks (needs Playwright + Chrome)
```

### Adding a day's tool

1. Build it in `tools/<name>/`: an `index.html` that links `../../shared/tokens.css`, loads its logic
   from `calc.js`, and keeps the Built with Omniscio footer (copy the ROAS tool's), with tests beside it.
   Add the name to `TOOLS` in `scripts/build.mjs`, a marker from its `calc.js` to `LOGIC_MARKER` in
   `scripts/build.test.mjs`, and a check function to `TOOL_CHECKS` in `scripts/check-ui.cjs` (a tool
   missing from `TOOL_CHECKS` is not checked at all).
2. `npm run build`, then `node scripts/render-shots.cjs` for the card thumbnail, then `npm run check:ui`.
   The page check serves each tool under the Share's sandbox rules; if the tool copies to the
   clipboard, test every fallback (see the UTM tool's checks).
3. Publish `dist/<name>.html` as an Omniscio Share that never expires.
4. Add one entry to `docs/tools.json` (`day`, `name`, `blurb`, `url`, `shot: "shots/<name>.png"`) and push. The hub fills that day's slot itself.

### Regenerating the preview image

Edit `scripts/og-card.html`, then run `node scripts/render-og.cjs`. Keep it free of the word Omniscio;
`tests/hub.test.mjs` enforces that for the preview tags.
