// Opens the bundled tool (under the same sandbox rules an Omniscio Share uses) and the hub,
// at phone and desktop size, and fails on sideways scrolling, console errors or dead output.
// Needs Playwright on NODE_PATH and a local Chrome; see README "Checking the pages".
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHARE_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';
const VIEWPORTS = [{ width: 390, height: 844, isMobile: true }, { width: 1280, height: 800, isMobile: false }];
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };

function serve() {
  return http.createServer((req, res) => {
    if (req.url === '/tool') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': SHARE_CSP });
      return res.end(fs.readFileSync(path.join(ROOT, 'dist', 'roas.html')));
    }
    const rel = req.url.replace(/^\/hub\/?/, '') || 'index.html';
    const file = path.join(ROOT, 'docs', path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
}

async function openPage(browser, url, vp) {
  const context = await browser.newContext({ viewport: vp, isMobile: vp.isMobile, hasTouch: vp.isMobile });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  return { context, page, errors, overflow };
}

async function checkTool(page) {
  const before = await page.textContent('#out-roas');
  await page.fill('#productCost', '25');
  const after = await page.textContent('#out-roas');
  await page.fill('#productCost', '60');
  const loss = await page.textContent('#out-verdict');
  if (before === after) return 'ROAS did not update when an input changed';
  if (!/lose money/.test(loss)) return 'loss message did not appear for a losing order';
  return null;
}

async function checkHub(page) {
  const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'tools.json'), 'utf8')).length;
  const cards = await page.locator('.tool').count();
  return cards === expected ? null : `hub shows ${cards} tool cards, tools.json has ${expected}`;
}

(async () => {
  const server = serve().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const failures = [];
  fs.mkdirSync(path.join(ROOT, 'dist', 'screens'), { recursive: true });
  for (const [name, url, check] of [['tool', `${base}/tool`, checkTool], ['hub', `${base}/hub/`, checkHub]]) {
    for (const vp of VIEWPORTS) {
      const { context, page, errors, overflow } = await openPage(browser, url, vp);
      await page.screenshot({ path: path.join(ROOT, 'dist', 'screens', `${name}-${vp.width}.png`), fullPage: true });
      const problem = await check(page);
      if (overflow > 0) failures.push(`${name} @${vp.width}px scrolls sideways by ${overflow}px`);
      if (errors.length) failures.push(`${name} @${vp.width}px console errors: ${errors.join(' | ')}`);
      if (problem) failures.push(`${name} @${vp.width}px: ${problem}`);
      await context.close();
    }
  }
  await browser.close();
  server.close();
  if (failures.length) { console.error(`FAIL\n- ${failures.join('\n- ')}`); process.exit(1); }
  console.log('PASS — tool and hub, 390px and 1280px: no sideways scroll, no console errors, outputs live');
})();
