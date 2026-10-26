// Renders each built tool (dist/<tool>.html) into the hub's card thumbnail (docs/shots/<tool>.png).
// Run after `npm run build`. Needs Playwright on NODE_PATH and a local Chrome; see README.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT_VIEWPORT = { width: 1280, height: 800 };

(async () => {
  const tools = fs.readdirSync(path.join(ROOT, 'dist')).filter((f) => f.endsWith('.html'));
  fs.mkdirSync(path.join(ROOT, 'docs', 'shots'), { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: SHOT_VIEWPORT, deviceScaleFactor: 1 });
  for (const file of tools) {
    await page.goto(pathToFileURL(path.join(ROOT, 'dist', file)).href);
    const out = path.join(ROOT, 'docs', 'shots', file.replace(/\.html$/, '.png'));
    await page.screenshot({ path: out });
    console.log(`wrote ${out}`);
  }
  await browser.close();
})();
