'use strict';
// Where Google cuts a result: pixel-width truncation, breadcrumbs, warnings and the ad preview.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEVICES, AD_LIMITS, ELLIPSIS, fitText, meterState, site, breadcrumb, organicPreview, adPreview
} = require('./calc.js');

// A fake measurer: every character is 10px wide, whatever the font. Records the fonts it was asked for.
const CHAR_PX = 10;
function fakeMeasure() {
  const fonts = [];
  const measure = (text, font) => { fonts.push(font); return [...text].length * CHAR_PX; };
  measure.fonts = fonts;
  return measure;
}
const measure = fakeMeasure();
const codes = (preview) => preview.warnings.map((w) => w.device ? `${w.code}:${w.device}` : w.code);

// --- fitText -------------------------------------------------------------------------

test('text that fits is left alone and reports its width', () => {
  assert.deepEqual(fitText('Rain jackets', 'f', 200, measure), { text: 'Rain jackets', cut: false, width: 120 });
});

test('text exactly at the limit is not cut', () => {
  assert.equal(fitText('abcde', 'f', 50, measure).cut, false);
});

test('too-wide text is cut at a word boundary and ends with Google\'s " ..."', () => {
  const fit = fitText('one two three four five', 'f', 150, measure);
  assert.equal(fit.cut, true);
  assert.equal(fit.text, `one two${ELLIPSIS}`);
  assert.ok(measure(fit.text) <= 150, 'the shortened text plus the ellipsis fits the limit');
  assert.equal(fit.width, 230, 'width is the full text, so the meter can show how far over it is');
});

test('a single word wider than the limit is cut mid-word instead of disappearing', () => {
  const fit = fitText('Supercalifragilistic', 'f', 100, measure);
  assert.equal(fit.text, `Superc${ELLIPSIS}`);
  assert.ok(measure(fit.text) <= 100);
});

test('runs of spaces, tabs and line breaks collapse to one space, edges trimmed', () => {
  assert.equal(fitText('  Rain \n\t jackets  ', 'f', 500, measure).text, 'Rain jackets');
});

test('empty text is not cut and has no width', () => {
  assert.deepEqual(fitText('   ', 'f', 100, measure), { text: '', cut: false, width: 0 });
});

test('a very long paste is cut correctly with a handful of measurements, not one per word', () => {
  const counting = fakeMeasure();
  const long = Array.from({ length: 2000 }, (_, n) => `w${n}`).join(' ');
  const fit = fitText(long, 'f', 600, counting);
  assert.ok(fit.cut && counting(fit.text) <= 600);
  assert.ok(counting.fonts.length < 40, `measured ${counting.fonts.length} times`);
});

// --- meterState ------------------------------------------------------------------------

test('meter is ok below 90% of the limit, near from 90% to the limit, cut past it', () => {
  assert.equal(meterState(500, 600), 'ok');
  assert.equal(meterState(540, 600), 'near');
  assert.equal(meterState(600, 600), 'near');
  assert.equal(meterState(601, 600), 'cut');
  assert.equal(meterState(0, 600), 'ok');
});

// --- breadcrumb ------------------------------------------------------------------------

test('breadcrumb shows the domain without www, then each path part, like Google', () => {
  assert.equal(breadcrumb('https://www.example.com/products/rain-jacket?ref=x#top'),
    'example.com › products › rain-jacket');
});

test('breadcrumb accepts a link without https:// and a bare domain', () => {
  assert.equal(breadcrumb('example.com/blog/'), 'example.com › blog');
  assert.equal(breadcrumb('shop.example.com'), 'shop.example.com');
});

test('site is the domain Google names above a result, or the text as typed when it is not a link', () => {
  assert.equal(site('https://www.example.com/products?ref=x'), 'example.com');
  assert.equal(site('shop.example.com/a'), 'shop.example.com');
  assert.equal(site(' my shop '), 'my shop');
});

test('breadcrumb decodes encoded path parts and leaves non-links as typed', () => {
  assert.equal(breadcrumb('https://example.com/rain%20gear'), 'example.com › rain gear');
  assert.equal(breadcrumb('  not a link  '), 'not a link');
  assert.equal(breadcrumb(''), '');
});

// --- organicPreview ----------------------------------------------------------------------

const page = {
  title: 'Rain jackets', url: 'https://example.com/rain', description: 'Waterproof jackets.', keyword: ''
};

test('each device measures in its own fonts', () => {
  const m = fakeMeasure();
  organicPreview(page, m);
  for (const device of Object.values(DEVICES)) {
    assert.ok(m.fonts.includes(device.title.font), `title font ${device.title.font} used`);
    assert.ok(m.fonts.includes(device.description.font), `description font ${device.description.font} used`);
  }
});

test('a short result has no warnings and both devices show it whole', () => {
  const p = organicPreview(page, measure);
  assert.deepEqual(p.warnings, []);
  assert.equal(p.breadcrumb, 'example.com › rain');
  for (const d of ['desktop', 'mobile']) {
    assert.equal(p[d].title.text, 'Rain jackets');
    assert.equal(p[d].title.state, 'ok');
    assert.equal(p[d].title.limit, DEVICES[d].title.limit);
  }
});

test('a title too wide for desktop is cut there and flagged per device', () => {
  const title = 'x'.repeat(DEVICES.desktop.title.limit / CHAR_PX + 1);
  const p = organicPreview({ ...page, title }, measure);
  assert.equal(p.desktop.title.cut, true);
  assert.equal(p.desktop.title.state, 'cut');
  assert.equal(p.mobile.title.cut, DEVICES.mobile.title.limit < title.length * CHAR_PX);
  assert.ok(codes(p).includes('titleCut:desktop'));
});

test('a long description is cut on both devices and flagged', () => {
  const description = 'word '.repeat(300);
  const p = organicPreview({ ...page, description }, measure);
  assert.ok(p.desktop.description.cut && p.mobile.description.cut);
  assert.ok(p.desktop.description.text.endsWith(ELLIPSIS));
  assert.deepEqual(codes(p).filter((c) => c.startsWith('descriptionCut')), ['descriptionCut:desktop', 'descriptionCut:mobile']);
});

test('missing title or description is flagged, and Google would write its own snippet', () => {
  assert.deepEqual(codes(organicPreview({ ...page, title: ' ', description: '' }, measure)),
    ['titleMissing', 'descriptionMissing']);
});

test('focus keyword missing from the title is flagged; present in any case or spacing is fine', () => {
  assert.ok(codes(organicPreview({ ...page, keyword: 'parka' }, measure)).includes('keywordMissing'));
  assert.deepEqual(organicPreview({ ...page, keyword: '  RAIN   Jackets ' }, measure).warnings, []);
  assert.deepEqual(organicPreview({ ...page, keyword: '' }, measure).warnings, []);
});

// --- adPreview -------------------------------------------------------------------------

const ad = {
  headlines: ['Rain Jackets', 'Free Returns', 'Shop Now'],
  descriptions: ['Waterproof and breathable.', 'Ships in 24 hours.'],
  url: 'https://www.example.com/jackets', path1: 'rain', path2: 'men'
};

test('ad counters count characters per field and flag only the ones over the limit', () => {
  const p = adPreview({ ...ad, headlines: ['x'.repeat(31), 'ok', ''], path2: 'y'.repeat(16) }, measure);
  const over = p.counters.filter((c) => c.over).map((c) => c.field);
  assert.deepEqual(over, ['headline1', 'path2']);
  const h1 = p.counters.find((c) => c.field === 'headline1');
  assert.deepEqual([h1.count, h1.limit], [31, AD_LIMITS.headline]);
  assert.ok(codes(p).includes('overLimit'));
});

test('an emoji counts as one character, not two', () => {
  const p = adPreview({ ...ad, headlines: ['☔🧥', '', ''] }, measure);
  assert.equal(p.counters.find((c) => c.field === 'headline1').count, 2);
});

test('ad headlines join with " | " and the display URL is domain/path1/path2', () => {
  const p = adPreview(ad, measure);
  assert.equal(p.desktop.headline, 'Rain Jackets | Free Returns | Shop Now');
  assert.equal(p.displayUrl, 'example.com/rain/men');
  assert.equal(p.desktop.description.text, 'Waterproof and breathable. Ships in 24 hours.');
  assert.deepEqual(p.warnings, []);
});

test('a headline that does not fit is dropped whole on that device, never cut mid-way', () => {
  // 670px joined: over the desktop line (600px), inside the two mobile lines (680px).
  const long = ['Waterproof Rain Jackets', 'Free Returns Always', 'Shop the Sale Today'];
  const p = adPreview({ ...ad, headlines: long }, measure);
  assert.equal(p.desktop.headline, 'Waterproof Rain Jackets | Free Returns Always');
  assert.equal(p.mobile.headline, long.join(' | '));
  assert.ok(codes(p).includes('headlineDropped:desktop'));
  assert.ok(!codes(p).includes('headlineDropped:mobile'));
});

test('empty headlines, descriptions and paths are skipped', () => {
  const p = adPreview({ ...ad, headlines: ['', 'Only one', ' '], descriptions: ['', 'Just this.'], path1: '', path2: 'men' }, measure);
  assert.equal(p.desktop.headline, 'Only one');
  assert.equal(p.desktop.description.text, 'Just this.');
  assert.equal(p.displayUrl, 'example.com/men');
});

test('ad descriptions too wide for a device are cut with " ..." and flagged', () => {
  const p = adPreview({ ...ad, descriptions: ['a'.repeat(90), 'b'.repeat(90)] }, measure);
  assert.ok(p.mobile.description.cut);
  assert.ok(codes(p).includes('descriptionCut:mobile'));
});
