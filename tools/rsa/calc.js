// Checks a Google Ads responsive search ad (RSA) for the mistakes the editor lets through, and works
// out which ads the pins still allow. Runs in the browser (inlined by scripts/build.mjs, exposed as
// window.RsaCalc) and in Node (tests). An ad is { headlines: [{text, pin}], descriptions: [{text, pin}],
// url, path1, path2 }, where pin is the position an asset is pinned to (0 = not pinned).
//
// Sources, Google's own help pages:
// - Counts, limits and pinning, https://support.google.com/google-ads/answer/7684791 : 3 to 15 headlines
//   of 30 characters, 2 to 4 descriptions of 90, paths of 15. Up to 3 headlines and 2 descriptions show.
//   A pinned asset shows only in its position; pin 2 or 3 per position, or one shows every time.
// - Ad Strength, https://support.google.com/google-ads/answer/9921843 : "Provide as many unique assets as
//   possible", avoid repetitive words and pinning. Google gives no minimum; the floor of 8 unique headlines
//   below is an ESTIMATE of where Ad Strength stops complaining.
// - Punctuation, https://support.google.com/adspolicy/answer/14847994 : no punctuation repeated
//   consecutively ("flowers!!"). Editorial, https://support.google.com/adspolicy/answer/6021546 : no
//   punctuation or capitalisation used for anything but its purpose. No "!" in a headline and at most one
//   in a description are Google's long-standing reviews of that rule. The ALL-CAPS test (4+ capital letters,
//   so 3-letter acronyms pass) is an ESTIMATE; brand names in capitals can be approved on request.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RsaCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = { headline: 30, description: 90, path: 15 };
  const MIN = { headline: 3, description: 2 };
  const MAX = { headline: 15, description: 4 };
  const POSITIONS = { headline: 3, description: 2 };
  const STRONG_HEADLINES = 8; // estimate, see above
  const ALL_CAPS = /\b[A-Z]{4,}\b/g;
  const REPEATED_PUNCTUATION = /[!?]{2,}/;
  const EXCLAMATION_RUNS = /!+/g;

  const asset = (text, pin = 0) => ({ text, pin });
  const EXAMPLE = {
    headlines: [
      asset('Waterproof Rain Jackets', 1), asset('Rain Jackets'), asset('Free Shipping Over $50'),
      asset('60-Day Free Returns'), asset('Shop Our New Arrivals!'), asset('Taped Seams & Pit Zips'),
      asset('Built For REAL Storms'), asset('Breathable Waterproof Shell Jackets')
    ],
    descriptions: [
      asset('Taped seams, packable hoods and pit zips. Built for real storms, not just drizzle.'),
      asset('Shop 12 colours for men and women. Order today and it ships within 24 hours!!'),
      asset('Free shipping over $50 and 60-day free returns on every order.')
    ],
    url: 'https://www.northpeak.com/jackets', path1: 'rain-jackets', path2: 'mens'
  };

  const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
  const chars = (text) => [...clean(text)].length;
  const normalize = (text) => clean(String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' '));

  // Same words ignoring case and punctuation, or one line's words inside the other's.
  function similar(a, b) {
    const x = normalize(a);
    const y = normalize(b);
    if (!x || !y) return false;
    return ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `);
  }

  // The non-empty assets of one kind, each keeping its field name ("headline4").
  function filled(ad, kind) {
    return ad[`${kind}s`].map((a, n) => ({ text: clean(a.text), pin: Number(a.pin) || 0, field: `${kind}${n + 1}` }))
      .filter((a) => a.text);
  }

  const counter = (field, text, limit) => ({ field, count: chars(text), limit, over: chars(text) > limit });

  function counters(ad) {
    return [
      ...ad.headlines.map((a, n) => counter(`headline${n + 1}`, a.text, LIMITS.headline)),
      ...ad.descriptions.map((a, n) => counter(`description${n + 1}`, a.text, LIMITS.description)),
      counter('path1', ad.path1, LIMITS.path),
      counter('path2', ad.path2, LIMITS.path)
    ];
  }

  // Assets that may go in `position`: the ones pinned there, or every unpinned one if none is.
  function candidates(assets, position) {
    const pinned = assets.filter((a) => a.pin === position);
    return pinned.length ? pinned : assets.filter((a) => !a.pin);
  }

  // Every ordered pick of `slots` assets that respects the pins.
  function arrangements(assets, slots) {
    const pick = (position, used) => {
      if (position > slots) return [[]];
      return candidates(assets, position).filter((a) => !used.includes(a))
        .flatMap((a) => pick(position + 1, [...used, a]).map((rest) => [a, ...rest]));
    };
    return slots > 0 ? pick(1, []) : [];
  }

  // The longest arrangements that exist, for the preview when no full-length ad does.
  function longest(assets, slots) {
    for (let n = slots; n > 0; n--) {
      const list = arrangements(assets, n);
      if (list.length) return list;
    }
    return [[]];
  }

  const unpin = (assets) => assets.map((a) => ({ ...a, pin: 0 }));
  const fullCount = (h, d) => arrangements(h, POSITIONS.headline).length * arrangements(d, POSITIONS.description).length;

  // Full ads (3 headlines + 2 descriptions) the pins allow, against the count with no pins at all.
  function combinations(ad) {
    const h = filled(ad, 'headline');
    const d = filled(ad, 'description');
    return {
      count: fullCount(h, d),
      countUnpinned: fullCount(unpin(h), unpin(d)),
      headlines: longest(h, POSITIONS.headline),
      descriptions: longest(d, POSITIONS.description)
    };
  }

  function combinationAt(combos, index) {
    const n = combos.headlines.length;
    const texts = (list) => list.map((a) => a.text);
    return {
      headlines: texts(combos.headlines[index % n]),
      descriptions: texts(combos.descriptions[Math.floor(index / n) % combos.descriptions.length])
    };
  }

  // A different combination from `current` whenever there is one; `random` is injectable for tests.
  function shuffleIndex(total, current, random = Math.random) {
    if (total <= 1) return 0;
    return (current + 1 + Math.floor(random() * (total - 1))) % total;
  }

  function displayUrl(ad) {
    const raw = clean(ad.url);
    let site = raw;
    try { site = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, ''); } catch { /* keep as typed */ }
    return [site, clean(ad.path1), clean(ad.path2)].filter(Boolean).join('/');
  }

  // --- Checks. Each warning: { code, level: 'reject' (Google won't run it) | 'weak' (hurts the ad) } ---

  const warn = (code, level, extra) => ({ code, level, ...extra });
  const fieldsWhere = (assets, test) => assets.filter((a) => test(a.text)).map((a) => a.field);
  const listed = (code, level, fields) => (fields.length ? [warn(code, level, { fields })] : []);

  function sizeWarnings(ad, h, d) {
    const over = counters(ad).filter((c) => c.over).map((c) => c.field);
    return [
      ...listed('overLimit', 'reject', over),
      ...(h.length < MIN.headline ? [warn('tooFewHeadlines', 'reject', { count: h.length, min: MIN.headline })] : []),
      ...(d.length < MIN.description ? [warn('tooFewDescriptions', 'reject', { count: d.length, min: MIN.description })] : [])
    ];
  }

  // Each pair of lines that say the same thing, reported once.
  function duplicates(assets) {
    return assets.flatMap((a, i) => assets.slice(i + 1).filter((b) => similar(a.text, b.text))
      .map((b) => warn('duplicate', 'weak', { fields: [a.field, b.field] })));
  }

  function uniqueCount(assets) {
    return assets.filter((a, i) => !assets.slice(0, i).some((b) => similar(a.text, b.text))).length;
  }

  function editorialWarnings(h, d) {
    const capsWords = [...new Set([...h, ...d].flatMap((a) => a.text.match(ALL_CAPS) || []))];
    return [
      ...listed('headlineExclamation', 'reject', fieldsWhere(h, (t) => t.includes('!'))),
      ...listed('descriptionExclamations', 'reject', fieldsWhere(d, (t) => (t.match(EXCLAMATION_RUNS) || []).length > 1)),
      ...listed('repeatedPunctuation', 'reject', fieldsWhere([...h, ...d], (t) => REPEATED_PUNCTUATION.test(t))),
      ...(capsWords.length ? [warn('allCaps', 'reject', { words: capsWords })] : [])
    ];
  }

  function pinWarnings(kind, assets) {
    const out = [];
    for (let position = 1; position <= POSITIONS[kind]; position++) {
      const pinned = assets.filter((a) => a.pin === position);
      if (pinned.length === 1) out.push(warn('pinnedAlone', 'weak', { kind, position, field: pinned[0].field }));
      if (!candidates(assets, position).length) out.push(warn('positionEmpty', 'weak', { kind, position }));
    }
    return out;
  }

  function strengthWarnings(h, d) {
    const unique = uniqueCount(h);
    const pins = [...pinWarnings('headline', h), ...pinWarnings('description', d)];
    const enough = h.length >= MIN.headline && d.length >= MIN.description;
    const blocked = enough && !pins.some((w) => w.code === 'positionEmpty') && fullCount(h, d) === 0;
    return [
      ...duplicates(h), ...duplicates(d),
      ...(h.length >= MIN.headline && unique < STRONG_HEADLINES ? [warn('fewUnique', 'weak', { count: unique, target: STRONG_HEADLINES })] : []),
      ...pins,
      ...(h.length && h.every((a) => a.pin) ? [warn('allPinned', 'weak')] : []),
      ...(blocked ? [warn('noFullAd', 'weak')] : [])
    ];
  }

  function checkAd(ad) {
    const h = filled(ad, 'headline');
    const d = filled(ad, 'description');
    return [...sizeWarnings(ad, h, d), ...editorialWarnings(h, d), ...strengthWarnings(h, d)];
  }

  return {
    LIMITS, MIN, MAX, POSITIONS, STRONG_HEADLINES, EXAMPLE, normalize, similar, counters, checkAd,
    arrangements, combinations, combinationAt, shuffleIndex, displayUrl
  };
});
