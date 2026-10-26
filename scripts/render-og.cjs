// Renders the neutral link-preview card (docs/og.png, 1200x630) from scripts/og-card.html.
// Needs Playwright on NODE_PATH and a local Chrome; see README "Regenerating the preview image".
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CARD = path.join(__dirname, 'og-card.html');
const OUT = path.join(__dirname, '..', 'docs', 'og.png');

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(CARD).href);
  await page.screenshot({ path: OUT });
  await browser.close();
  console.log(`wrote ${OUT}`);
})();
