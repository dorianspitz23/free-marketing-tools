// Where Google cuts a search result or a search ad, by rendered pixel width rather than characters.
// Runs in the browser (inlined by scripts/build.mjs, exposed as window.SerpCalc) and in Node (tests).
// Every measuring function takes `measure(text, font) -> px`: the page passes canvas measureText,
// the tests pass a fake, so the maths is tested without a browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SerpCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Google publishes no limits. These are the widths SEO tools commonly use, from measured snippets:
  // desktop title ~600px at Arial 20px (Zyppy, Moz), desktop description ~920px at Arial 14px
  // (Screaming Frog measured 928px), mobile description ~680px (QuickSEO, Spotibo). Mobile titles
  // wrap to two lines of a ~340px card at Arial 16px, so ~680px in total. Treat them as estimates.
  const DEVICES = {
    desktop: { title: { font: '20px Arial', limit: 600 }, description: { font: '14px Arial', limit: 920 } },
    mobile: { title: { font: '16px Arial', limit: 680 }, description: { font: '14px Arial', limit: 680 } }
  };
  const AD_LIMITS = { headline: 30, description: 90, path: 15 };
  const ELLIPSIS = ' ...';
  const HEADLINE_JOIN = ' | ';
  const NEAR_SHARE = 0.9;
  const CRUMB = ' › ';

  const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
  const chars = (text) => [...text].length;

  // Largest n in [0, max] where fits(n) holds, assuming fits is true up to some n and false after.
  function largestFitting(max, fits) {
    let lo = 0;
    let hi = max;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid)) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // The text as Google shows it within `limit` px: whole words plus " ...", or mid-word if one
  // word alone is too wide. `width` is always the full text's width, so a meter can show the overflow.
  function fitText(text, font, limit, measure) {
    const full = clean(text);
    const width = full ? measure(full, font) : 0;
    if (width <= limit) return { text: full, cut: false, width };
    const fitsWith = (prefix) => measure(prefix + ELLIPSIS, font) <= limit;
    const words = full.split(' ');
    const n = largestFitting(words.length, (k) => fitsWith(words.slice(0, k).join(' ')));
    if (n > 0) return { text: words.slice(0, n).join(' ') + ELLIPSIS, cut: true, width };
    const letters = [...words[0]];
    const m = largestFitting(letters.length, (k) => fitsWith(letters.slice(0, k).join('')));
    return { text: letters.slice(0, m).join('') + ELLIPSIS, cut: true, width };
  }

  function meterState(width, limit) {
    if (width > limit) return 'cut';
    return width >= limit * NEAR_SHARE ? 'near' : 'ok';
  }

  function parseLink(raw) {
    const text = clean(raw);
    if (!text || /\s/.test(text)) return null;
    try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  }

  const siteName = (url) => url.hostname.replace(/^www\./, '');

  function decodePart(part) {
    try { return decodeURIComponent(part); } catch { return part; }
  }

  // "example.com › products › rain-jacket", the way Google shows the link above a result.
  function breadcrumb(raw) {
    const url = parseLink(raw);
    if (!url || !url.hostname.includes('.')) return clean(raw);
    const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
    return [siteName(url), ...parts].join(CRUMB);
  }

  function measured(text, spec, measure) {
    const fit = fitText(text, spec.font, spec.limit, measure);
    return { ...fit, limit: spec.limit, state: meterState(fit.width, spec.limit) };
  }

  function cutWarnings(code, results) {
    return Object.keys(DEVICES).filter((d) => results[d].cut).map((device) => ({ code, device }));
  }

  // Organic result: { title, url, description, keyword } -> fitted text, meters and warnings per device.
  function organicPreview(input, measure) {
    const preview = { breadcrumb: breadcrumb(input.url), warnings: [] };
    const titles = {};
    const descriptions = {};
    for (const [device, spec] of Object.entries(DEVICES)) {
      titles[device] = measured(input.title, spec.title, measure);
      descriptions[device] = measured(input.description, spec.description, measure);
      preview[device] = { title: titles[device], description: descriptions[device] };
    }
    const keyword = clean(input.keyword).toLowerCase();
    const title = clean(input.title);
    preview.warnings = [
      ...(title ? [] : [{ code: 'titleMissing' }]),
      ...cutWarnings('titleCut', titles),
      ...(clean(input.description) ? [] : [{ code: 'descriptionMissing' }]),
      ...cutWarnings('descriptionCut', descriptions),
      ...(keyword && !title.toLowerCase().includes(keyword) ? [{ code: 'keywordMissing', keyword }] : [])
    ];
    return preview;
  }

  function counter(field, text, limit) {
    const count = chars(clean(text));
    return { field, count, limit, over: count > limit };
  }

  function adCounters(ad) {
    return [
      ...ad.headlines.map((h, n) => counter(`headline${n + 1}`, h, AD_LIMITS.headline)),
      ...ad.descriptions.map((d, n) => counter(`description${n + 1}`, d, AD_LIMITS.description)),
      counter('path1', ad.path1, AD_LIMITS.path),
      counter('path2', ad.path2, AD_LIMITS.path)
    ];
  }

  // Google shows whole headlines only: it keeps adding them while the line still fits.
  function headlineLine(headlines, spec, measure) {
    const shown = headlines.slice(0, 1);
    for (const next of headlines.slice(1)) {
      if (measure([...shown, next].join(HEADLINE_JOIN), spec.font) > spec.limit) break;
      shown.push(next);
    }
    return { text: shown.join(HEADLINE_JOIN), dropped: headlines.length - shown.length };
  }

  function displayUrl(ad) {
    const url = parseLink(ad.url);
    const site = url ? siteName(url) : clean(ad.url);
    return [site, clean(ad.path1), clean(ad.path2)].filter(Boolean).join('/');
  }

  // Search ad: { headlines[3], descriptions[2], url, path1, path2 } -> counters, per-device lines, warnings.
  function adPreview(ad, measure) {
    const headlines = ad.headlines.map(clean).filter(Boolean);
    const description = ad.descriptions.map(clean).filter(Boolean).join(' ');
    const counters = adCounters(ad);
    const preview = { counters, displayUrl: displayUrl(ad), warnings: [] };
    const descriptions = {};
    const drops = [];
    for (const [device, spec] of Object.entries(DEVICES)) {
      const line = headlineLine(headlines, spec.title, measure);
      descriptions[device] = measured(description, spec.description, measure);
      preview[device] = { headline: line.text, dropped: line.dropped, description: descriptions[device] };
      if (line.dropped) drops.push({ code: 'headlineDropped', device, count: line.dropped });
    }
    const over = counters.filter((c) => c.over).map((c) => c.field);
    preview.warnings = [
      ...(over.length ? [{ code: 'overLimit', fields: over }] : []),
      ...drops,
      ...cutWarnings('descriptionCut', descriptions)
    ];
    return preview;
  }

  return { DEVICES, AD_LIMITS, ELLIPSIS, fitText, meterState, breadcrumb, organicPreview, adPreview };
});
