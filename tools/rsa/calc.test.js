// Responsive search ad checker: the rules Google applies, the pins, and the combinations they leave.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LIMITS, EXAMPLE, normalize, similar, counters, checkAd, arrangements, combinations,
  combinationAt, shuffleIndex, displayUrl
} = require('./calc.js');

const h = (text, pin = 0) => ({ text, pin });
const UNIQUE = ['Waterproof Rain Jackets', 'Free Shipping Over $50', '60-Day Free Returns', 'Taped Seams and Pit Zips',
  'Packable Hoods That Stay Put', 'Built for Real Storms', 'Shop Men and Women', 'Ships Within 24 Hours'];
const ad = (over = {}) => ({
  headlines: UNIQUE.map((t) => h(t)),
  descriptions: [h('Taped seams, packable hoods and pit zips.'), h('Free shipping over $50 on every order.')],
  url: 'https://www.northpeak.com/jackets', path1: 'rain-jackets', path2: 'mens',
  ...over
});
const codes = (warnings) => warnings.map((w) => w.code);
const find = (warnings, code) => warnings.find((w) => w.code === code);

test('normalize lowercases, drops punctuation and squeezes spaces', () => {
  assert.equal(normalize('  Free   Shipping, Over $50! '), 'free shipping over 50');
});

test('similar: same words ignoring case and punctuation, or one inside the other on word boundaries', () => {
  assert.ok(similar('Rain Jackets!', 'rain jackets'));
  assert.ok(similar('Rain Jackets', 'Waterproof Rain Jackets'));
  assert.ok(!similar('Sale', 'Wholesale Prices'), 'a word inside another word is not a match');
  assert.ok(!similar('Rain Jackets', 'Rain Boots'));
  assert.ok(!similar('', 'Rain Jackets'), 'an empty line matches nothing');
});

test('counters: live counts per field, over only past the limit, spaces at the ends ignored', () => {
  const c = counters(ad({
    headlines: [h('x'.repeat(31)), h(` ${'y'.repeat(30)} `)],
    descriptions: [h('z'.repeat(90))],
    path1: 'p'.repeat(16), path2: ''
  }));
  const byField = Object.fromEntries(c.map((x) => [x.field, x]));
  assert.deepEqual(byField.headline1, { field: 'headline1', count: 31, limit: LIMITS.headline, over: true });
  assert.equal(byField.headline2.over, false);
  assert.equal(byField.headline2.count, 30);
  assert.equal(byField.description1.over, false);
  assert.equal(byField.path1.over, true);
  assert.equal(byField.path2.count, 0);
});

test('a clean ad gets no warnings', () => {
  assert.deepEqual(checkAd(ad()), []);
});

test('over the character limit is a rejection naming each field', () => {
  const headlines = [...UNIQUE.map((t) => h(t)), h('Breathable Waterproof Shell Jackets')];
  const w = find(checkAd(ad({ headlines, path2: 'p'.repeat(16) })), 'overLimit');
  assert.equal(w.level, 'reject');
  assert.deepEqual(w.fields, ['headline9', 'path2']);
});

test('too few assets: fewer than 3 headlines or 2 descriptions, and empty rows do not count', () => {
  const w = checkAd(ad({ headlines: [h('One'), h(''), h('Two'), h('   ')], descriptions: [h('Only one description.'), h('')] }));
  assert.deepEqual(find(w, 'tooFewHeadlines'), { code: 'tooFewHeadlines', level: 'reject', count: 2, min: 3 });
  assert.deepEqual(find(w, 'tooFewDescriptions'), { code: 'tooFewDescriptions', level: 'reject', count: 1, min: 2 });
});

test('fewer than 8 unique headlines weakens Ad Strength; near-duplicates do not count as unique', () => {
  const seven = ad({ headlines: UNIQUE.slice(0, 7).map((t) => h(t)) });
  assert.deepEqual(find(checkAd(seven), 'fewUnique'), { code: 'fewUnique', level: 'weak', count: 7, target: 8 });
  const withCopy = ad({ headlines: [...UNIQUE.map((t) => h(t)), h('rain jackets')] });
  assert.equal(find(checkAd(withCopy), 'fewUnique'), undefined, '8 unique plus a copy is still 8');
  assert.equal(find(checkAd(ad()), 'fewUnique'), undefined);
});

test('duplicates and near-duplicates are reported once per pair, headlines and descriptions alike', () => {
  const w = checkAd(ad({
    headlines: [...UNIQUE.map((t) => h(t)), h('RAIN JACKETS'), h('free shipping over $50!')],
    descriptions: [h('Ships in 24 hours.'), h('ships in 24 hours')]
  }));
  const dups = w.filter((x) => x.code === 'duplicate').map((x) => x.fields);
  assert.deepEqual(dups, [['headline1', 'headline9'], ['headline2', 'headline10'], ['description1', 'description2']]);
  assert.ok(w.filter((x) => x.code === 'duplicate').every((x) => x.level === 'weak'));
});

test('editorial: no exclamation mark in a headline', () => {
  const w = find(checkAd(ad({ headlines: [...UNIQUE.map((t) => h(t)), h('Shop New Arrivals!')] })), 'headlineExclamation');
  assert.deepEqual(w, { code: 'headlineExclamation', level: 'reject', fields: ['headline9'] });
});

test('editorial: at most one exclamation mark per description; a run like !! is repeated punctuation instead', () => {
  const w = checkAd(ad({ descriptions: [h('Rain? Covered! Wind? Covered!'), h('Order today!! Ships fast.'), h('Ready for storms?? Yes.')] }));
  assert.deepEqual(find(w, 'descriptionExclamations').fields, ['description1']);
  assert.deepEqual(find(w, 'repeatedPunctuation').fields, ['description2', 'description3']);
  assert.equal(find(w, 'repeatedPunctuation').level, 'reject');
});

test('editorial: ALL-CAPS words are flagged, short acronyms are not', () => {
  const w = find(checkAd(ad({
    headlines: [...UNIQUE.map((t) => h(t)), h('Built For REAL Storms'), h('Ships to USA With GPS')],
    descriptions: [h('FREE returns. FREE shipping.'), h('Made in the USA.')]
  })), 'allCaps');
  assert.deepEqual(w, { code: 'allCaps', level: 'reject', words: ['REAL', 'FREE'] });
});

test('pins: a position with a single pinned headline always shows it', () => {
  const headlines = UNIQUE.map((t, n) => h(t, n === 0 ? 1 : 0));
  const w = checkAd(ad({ headlines }));
  assert.deepEqual(find(w, 'pinnedAlone'), { code: 'pinnedAlone', level: 'weak', kind: 'headline', position: 1, field: 'headline1' });
  const two = UNIQUE.map((t, n) => h(t, n < 2 ? 1 : 0));
  assert.equal(find(checkAd(ad({ headlines: two })), 'pinnedAlone'), undefined, 'two pins on one position rotate');
});

test('pins: every headline pinned is flagged', () => {
  const headlines = UNIQUE.map((t, n) => h(t, (n % 3) + 1));
  assert.deepEqual(find(checkAd(ad({ headlines })), 'allPinned'), { code: 'allPinned', level: 'weak' });
});

test('pins: a position nothing can fill is flagged, and so is a set of pins that leaves no full ad', () => {
  const allOnOne = UNIQUE.map((t) => h(t, 1));
  const empty = checkAd(ad({ headlines: allOnOne })).filter((x) => x.code === 'positionEmpty');
  assert.deepEqual(empty.map((x) => [x.kind, x.position]), [['headline', 2], ['headline', 3]]);
  const squeezed = [h('A one', 1), h('B two', 1), h('C three', 1), h('D four')];
  const w = checkAd(ad({ headlines: squeezed }));
  assert.equal(find(w, 'positionEmpty'), undefined, 'H2 and H3 each have a candidate');
  assert.deepEqual(find(w, 'noFullAd'), { code: 'noFullAd', level: 'weak' }, 'but one headline cannot fill both');
});

test('arrangements: every ordered pick, with pinned assets only in their own position', () => {
  const four = [h('A'), h('B'), h('C'), h('D')];
  assert.equal(arrangements(four, 3).length, 24);
  const onePinned = [h('A', 1), h('B'), h('C'), h('D')];
  const list = arrangements(onePinned, 3);
  assert.equal(list.length, 6);
  assert.ok(list.every((a) => a[0].text === 'A'));
  assert.equal(arrangements([h('A', 1), h('B', 1), h('C'), h('D')], 3).length, 4, 'two pins on H1 rotate there; C and D fill H2 and H3');
  assert.equal(arrangements([h('A', 3), h('B'), h('C')], 3).every((a) => a[2].text === 'A'), true);
});

test('combinations: 15 headlines and 4 descriptions make 32,760 full ads; pins cut that down', () => {
  const many = { ...ad(), headlines: Array.from({ length: 15 }, (_, n) => h(`Headline ${n}`)),
    descriptions: Array.from({ length: 4 }, (_, n) => h(`Description ${n}.`)) };
  const all = combinations(many);
  assert.equal(all.count, 15 * 14 * 13 * 4 * 3);
  assert.equal(all.countUnpinned, all.count);
  many.headlines[0].pin = 1;
  const pinned = combinations(many);
  assert.equal(pinned.count, 1 * 14 * 13 * 12);
  assert.equal(pinned.countUnpinned, all.count);
});

test('combinationAt maps every index to a pin-respecting ad and covers them all', () => {
  const combos = combinations(ad({ headlines: [h('A', 1), h('B'), h('C'), h('D')] }));
  const seen = new Set();
  for (let i = 0; i < combos.count; i++) {
    const c = combinationAt(combos, i);
    assert.equal(c.headlines[0], 'A');
    assert.equal(c.headlines.length, 3);
    assert.equal(c.descriptions.length, 2);
    seen.add(JSON.stringify(c));
  }
  assert.equal(seen.size, combos.count);
});

test('with no full ad possible, the preview falls back to the longest partial ad', () => {
  const combos = combinations(ad({ headlines: [h('Only'), h('Two')], descriptions: [h('One description.')] }));
  assert.equal(combos.count, 0);
  assert.deepEqual(combinationAt(combos, 0), { headlines: ['Only', 'Two'], descriptions: ['One description.'] });
  assert.deepEqual(combinationAt(combinations(ad({ headlines: [], descriptions: [] })), 0), { headlines: [], descriptions: [] });
});

test('shuffleIndex draws a different combination every time, deterministically under an injected random', () => {
  assert.equal(shuffleIndex(10, 3, () => 0), 4);
  assert.equal(shuffleIndex(10, 3, () => 0.999), 2, 'wraps round, never lands back on 3');
  for (let r = 0; r < 1; r += 0.05) assert.notEqual(shuffleIndex(5, 2, () => r), 2);
  assert.equal(shuffleIndex(1, 0, () => 0.5), 0, 'one combination: nothing else to draw');
  assert.equal(shuffleIndex(0, 0, () => 0.5), 0);
});

test('displayUrl shows the domain without www plus the two paths', () => {
  assert.equal(displayUrl(ad()), 'northpeak.com/rain-jackets/mens');
  assert.equal(displayUrl(ad({ url: 'shop.example.co.uk/x', path1: '', path2: 'sale' })), 'shop.example.co.uk/sale');
  assert.equal(displayUrl(ad({ url: '', path1: '', path2: '' })), '');
});

test('the prefilled example shows each kind of mistake it was built to show', () => {
  const w = checkAd(EXAMPLE);
  assert.deepEqual(codes(w).sort(), ['allCaps', 'duplicate', 'fewUnique', 'headlineExclamation', 'overLimit',
    'pinnedAlone', 'repeatedPunctuation'].sort());
  assert.equal(combinations(EXAMPLE).count, 1 * 7 * 6 * 3 * 2);
  assert.equal(combinations(EXAMPLE).countUnpinned, 8 * 7 * 6 * 3 * 2);
});
