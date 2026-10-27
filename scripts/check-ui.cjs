// Opens each bundled tool (under the same sandbox rules an Omniscio Share uses) and the hub,
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
const CHALLENGE_DAYS = 10;
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const COPIED = 'Copied ✓';

function serve() {
  return http.createServer((req, res) => {
    const tool = req.url.match(/^\/tool\/([a-z0-9-]+)$/);
    if (tool) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': SHARE_CSP });
      return res.end(fs.readFileSync(path.join(ROOT, 'dist', `${tool[1]}.html`)));
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
  return { context, page, errors };
}

const sidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function checkRoas(page) {
  const before = await page.textContent('#out-roas');
  await page.fill('#productCost', '25');
  const after = await page.textContent('#out-roas');
  await page.fill('#productCost', '60');
  const loss = await page.textContent('#out-verdict');
  if (before === after) return 'ROAS did not update when an input changed';
  if (!/lose money/.test(loss)) return 'loss message did not appear for a losing order';
  return null;
}

// --- UTM: the three ways Copy can go, forced one at a time by replacing the browser's own APIs ---

const stubClipboard = (page, works) => page.evaluate((ok) => {
  window.__copied = null;
  const writeText = ok ? async (t) => { window.__copied = t; } : async () => { throw new Error('blocked'); };
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}, works);

const stubCopyCommand = (page, works) => page.evaluate((ok) => {
  document.execCommand = (cmd) => {
    if (!ok || cmd !== 'copy') return false;
    window.__copied = document.activeElement && document.activeElement.value;
    return true;
  };
}, works);

async function checkCopyPaths(page) {
  const link = await page.textContent('#link');
  await stubClipboard(page, true);
  await page.click('#copy');
  if (await page.evaluate(() => window.__copied) !== link) return 'Clipboard API path did not copy the link';
  if (await page.textContent('#copy') !== COPIED) return 'Copy button did not confirm';
  await stubClipboard(page, false);
  await stubCopyCommand(page, true);
  await page.click('#copy');
  if (await page.evaluate(() => window.__copied) !== link) return 'copy-command fallback did not copy the link';
  await stubCopyCommand(page, false);
  await page.click('#copy');
  const manual = await page.evaluate(() => {
    const box = document.getElementById('copy-manual');
    return { shown: !box.hidden, value: box.value, focused: document.activeElement === box,
      selected: box.selectionStart === 0 && box.selectionEnd === box.value.length };
  });
  const told = /press (Ctrl|⌘)\+?C/i.test(await page.textContent('#copy-status'));
  if (!manual.shown || manual.value !== link || !manual.focused || !manual.selected || !told) {
    return `manual fallback did not select the link and say press Ctrl+C: ${JSON.stringify(manual)}`;
  }
  return null;
}

async function checkUtmSingle(page) {
  if (!/utm_source=Newsletter/.test(await page.textContent('#link'))) return 'example link did not render';
  if (!/to fix/i.test(await page.textContent('#chip'))) return 'example mistakes were not flagged';
  await page.click('#fix-all');
  const fixed = await page.textContent('#link');
  if (!/utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale/.test(fixed)) return `Fix all left: ${fixed}`;
  if (await page.textContent('#chip') !== 'Ready' || await page.isHidden('#clear')) return 'fixed link not shown as clean';
  await page.fill('#medium', 'facebook');
  if (!/Unassigned/.test(await page.textContent('#channel'))) return 'unknown medium not shown as Unassigned';
  await page.click('#issues .btn');
  if (await page.inputValue('#medium') !== 'social') return 'one-click medium fix did not apply';
  return null;
}

async function checkUtmBulk(page) {
  await page.click('#tab-bulk');
  if (await page.isHidden('#bulk') || await page.isVisible('#single')) return 'Bulk tab did not switch modes';
  if (await page.locator('#rows li').count() !== 4) return 'bulk did not list one row per data line';
  await page.click('#bulk-fix');
  if (!/https:\/\/example\.com\/boots,facebook,social,spring-sale/.test(await page.inputValue('#bulk-input'))) {
    return 'bulk Fix all did not rewrite the rows';
  }
  await stubClipboard(page, true);
  await page.keyboard.press('Control+Enter');
  const copied = await page.evaluate(() => window.__copied) || '';
  if (copied.split('\n').length !== 4 || copied.split('\n')[3] !== '') return `Copy all (Ctrl+Enter) gave: ${copied}`;
  const scroll = await sidewaysScroll(page);
  return scroll > 0 ? `bulk view scrolls sideways by ${scroll}px` : null;
}

// The real browser APIs under the Share's sandbox: either path is fine, silence is not.
async function checkRealCopy(page) {
  await page.click('#copy');
  await page.waitForTimeout(300);
  const copied = await page.textContent('#copy') === COPIED;
  const manual = await page.isVisible('#copy-manual');
  return copied || manual ? null : 'Copy did nothing with the real browser APIs';
}

async function checkUtm(page) {
  return await checkRealCopy(page) || await checkUtmSingle(page) || await checkCopyPaths(page) || await checkUtmBulk(page);
}

async function checkHub(page) {
  const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'tools.json'), 'utf8')).length;
  const shipped = await page.locator('.slot.shipped').count();
  const slots = await page.locator('.slot').count();
  if (slots !== CHALLENGE_DAYS) return `hub shows ${slots} day slots, expected ${CHALLENGE_DAYS}`;
  return shipped === expected ? null : `hub shows ${shipped} shipped cards, tools.json has ${expected}`;
}

const TOOL_CHECKS = { roas: checkRoas, utm: checkUtm };

(async () => {
  const server = serve().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const failures = [];
  fs.mkdirSync(path.join(ROOT, 'dist', 'screens'), { recursive: true });
  const targets = Object.entries(TOOL_CHECKS).map(([tool, check]) => [tool, `${base}/tool/${tool}`, check]);
  for (const [name, url, check] of [...targets, ['hub', `${base}/hub/`, checkHub]]) {
    for (const vp of VIEWPORTS) {
      const { context, page, errors } = await openPage(browser, url, vp);
      const overflow = await sidewaysScroll(page);
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
  console.log(`PASS — ${Object.keys(TOOL_CHECKS).join(', ')} and hub, 390px and 1280px: no sideways scroll, no console errors, outputs live`);
})();
