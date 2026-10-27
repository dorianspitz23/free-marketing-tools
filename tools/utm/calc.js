// UTM link building, plus the checks that stop one campaign showing up as several rows in GA4.
// Runs in the browser (inlined by scripts/build.mjs, exposed as window.UtmCalc) and in Node (tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UtmCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FIELDS = ['url', 'source', 'medium', 'campaign', 'term', 'content'];
  const PARAMS = ['source', 'medium', 'campaign', 'term', 'content'];
  const REQUIRED = ['url', 'source', 'medium', 'campaign'];
  const SEPARATOR = '-';
  const MAX_FIX_PASSES = 20;
  const HEADER_CELL = /^(url|link|website( url)?|landing page|page)$/i;

  // GA4 default channel group (support.google.com/analytics/answer/9756891): the mediums that
  // earn a channel on their own. GA4 compares case-insensitively and lists are exact matches.
  const MEDIUM_LISTS = [
    ['Display', ['display', 'banner', 'expandable', 'interstitial', 'cpm']],
    ['Organic Social', ['social', 'social-network', 'social-media', 'sm', 'social network', 'social media']],
    ['Email', ['email', 'e-mail', 'e_mail', 'e mail']],
    ['Referral', ['referral', 'app', 'link']],
    ['Organic Search', ['organic']],
    ['Affiliates', ['affiliate']],
    ['Audio', ['audio']],
    ['SMS', ['sms']],
    ['AI Assistant', ['ai-assistant']]
  ];
  const PAID = /^(.*cp.*|ppc|retargeting|paid.*)$/;
  const PAID_LABEL = 'Paid Search, Social, Shopping, Video or Other (set by the source)';
  const PUSH = /push$|mobile|notification/;
  const VIDEO = /video/;

  // Common mediums GA4 does not recognise, and the one it does that they usually mean.
  const MEDIUM_SYNONYMS = {
    newsletter: 'email', mail: 'email', emailing: 'email', mailchimp: 'email', klaviyo: 'email',
    facebook: 'social', fb: 'social', instagram: 'social', ig: 'social', linkedin: 'social',
    twitter: 'social', x: 'social', tiktok: 'social', pinterest: 'social', reddit: 'social',
    threads: 'social', social_media: 'social', social_network: 'social', socialmedia: 'social',
    youtube: 'video', ads: 'cpc', ad: 'cpc', adwords: 'cpc', google_ads: 'cpc', 'google-ads': 'cpc',
    googleads: 'cpc', sem: 'cpc', seo: 'organic', blog: 'referral', partner: 'affiliate',
    affiliates: 'affiliate', text: 'sms', banners: 'banner'
  };

  const UNSAFE = /[^A-Za-z0-9_.~\-\s]/;
  const UNSAFE_RUNS = /[^A-Za-z0-9_.~\-\s]+/g;
  const ACCENTS = /[̀-ͯ]/g;
  const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

  function mediumChannel(medium) {
    const m = String(medium ?? '').trim().toLowerCase();
    if (m === '') return null;
    for (const [channel, list] of MEDIUM_LISTS) if (list.includes(m)) return channel;
    if (PAID.test(m)) return PAID_LABEL;
    if (PUSH.test(m)) return 'Mobile Push Notifications';
    if (VIDEO.test(m)) return 'Organic Video';
    return null;
  }

  function normalizeRow(row) {
    return Object.fromEntries(FIELDS.map((f) => [f, String(row[f] ?? '')]));
  }

  function isHttpUrl(url) {
    if (!/^https?:\/\//i.test(url)) return false;
    try { new URL(url); return true; } catch { return false; }
  }

  // The URL split so the query can be edited without re-encoding anything the person pasted.
  function splitUrl(url) {
    const hashAt = url.indexOf('#');
    const hash = hashAt < 0 ? '' : url.slice(hashAt);
    const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
    const queryAt = beforeHash.indexOf('?');
    const path = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
    const query = queryAt < 0 ? [] : beforeHash.slice(queryAt + 1).split('&').filter(Boolean);
    return { path, query, hash };
  }

  function joinUrl(path, query, hash) {
    return path + (query.length ? `?${query.join('&')}` : '') + hash;
  }

  function decode(text) {
    try { return decodeURIComponent(text.replace(/\+/g, ' ')); } catch { return text; }
  }

  // Which of our five UTM params a query pair sets, or null.
  function utmParamOf(pair) {
    const key = decode(pair.split('=')[0]).toLowerCase();
    const name = key.startsWith('utm_') ? key.slice(4) : '';
    return PARAMS.includes(name) ? name : null;
  }

  function buildUrl(input) {
    const row = normalizeRow(input);
    const url = row.url.trim();
    if (!isHttpUrl(url) || REQUIRED.some((f) => row[f].trim() === '')) return null;
    const { path, query, hash } = splitUrl(url);
    const kept = query.filter((pair) => utmParamOf(pair) === null);
    const added = PARAMS.filter((p) => row[p] !== '').map((p) => `utm_${p}=${encodeURIComponent(row[p])}`);
    return joinUrl(path, kept.concat(added), hash);
  }

  // --- Checks: each returns an issue with the whole row as it would be after a one-click fix --

  const withField = (row, field, value) => ({ ...row, [field]: value });

  function issue(field, code, severity, fixed, data) {
    return { field, code, severity, fixed: fixed || null, data: data || {} };
  }

  function encodingFix(value) {
    return value.normalize('NFD').replace(ACCENTS, '').replace(UNSAFE_RUNS, SEPARATOR)
      .replace(/-{2,}/g, SEPARATOR).replace(/^-+|-+$/g, '');
  }

  function valueIssues(row, field) {
    const value = row[field];
    const trimmed = value.trim();
    const issues = [];
    if (value !== trimmed) issues.push(issue(field, 'whitespace', 'error', withField(row, field, trimmed)));
    if (trimmed !== trimmed.toLowerCase()) {
      issues.push(issue(field, 'capitals', 'error', withField(row, field, value.toLowerCase())));
    }
    if (/\s/.test(trimmed)) issues.push(issue(field, 'spaces', 'error', withField(row, field, value.replace(/\s+/g, SEPARATOR))));
    if (UNSAFE.test(trimmed)) issues.push(issue(field, 'encoding', 'error', withField(row, field, encodingFix(value))));
    return issues;
  }

  function mediumIssue(row) {
    if (mediumChannel(row.medium) !== null) return [];
    const suggestion = MEDIUM_SYNONYMS[row.medium.trim().toLowerCase()] || null;
    const fixed = suggestion && withField(row, 'medium', suggestion);
    return [issue('medium', 'unknownMedium', 'warning', fixed, { suggestion })];
  }

  function existingUtmIssue(row, url) {
    const { path, query, hash } = splitUrl(url);
    const found = query.filter((pair) => utmParamOf(pair) !== null);
    if (found.length === 0) return [];
    const fixed = { ...row, url: joinUrl(path, query.filter((pair) => utmParamOf(pair) === null), hash) };
    for (const pair of found) {
      const name = utmParamOf(pair);
      if (fixed[name].trim() === '') fixed[name] = decode(pair.slice(pair.indexOf('=') + 1));
    }
    const params = found.map((pair) => `utm_${utmParamOf(pair)}`);
    return [issue('url', 'existingUtm', 'warning', fixed, { params })];
  }

  function urlIssues(row) {
    const url = row.url.trim();
    const issues = [];
    if (row.url !== url) issues.push(issue('url', 'whitespace', 'error', withField(row, 'url', url)));
    if (!HAS_SCHEME.test(url)) issues.push(issue('url', 'noScheme', 'error', withField(row, 'url', `https://${url}`)));
    else if (!isHttpUrl(url)) issues.push(issue('url', 'badUrl', 'error'));
    return issues.concat(existingUtmIssue(row, url));
  }

  function fieldIssues(row, field) {
    if (row[field].trim() === '') return REQUIRED.includes(field) ? [issue(field, 'missing', 'error')] : [];
    if (field === 'url') return urlIssues(row);
    const issues = valueIssues(row, field);
    return field === 'medium' ? issues.concat(mediumIssue(row)) : issues;
  }

  function lintRow(input) {
    const row = normalizeRow(input);
    return FIELDS.flatMap((field) => fieldIssues(row, field));
  }

  // Applies one fix at a time and re-checks, so each fix sees the result of the last.
  function fixAll(input) {
    let row = normalizeRow(input);
    for (let pass = 0; pass < MAX_FIX_PASSES; pass++) {
      const next = lintRow(row).find((i) => i.fixed);
      if (!next) break;
      row = next.fixed;
    }
    return row;
  }

  // --- Bulk: one row per line, tab-separated if the line has tabs (a spreadsheet), else commas --

  const separatorOf = (line) => (line.includes('\t') ? '\t' : ',');

  function cleanCell(cell) {
    const trimmed = cell.trim();
    const quoted = trimmed.match(/^"(.*)"$/);
    return quoted ? quoted[1] : trimmed;
  }

  function parseBulk(text) {
    const rows = [];
    let seenData = false;
    String(text).split(/\r?\n/).forEach((line, index) => {
      if (line.trim() === '') return;
      const cells = line.split(separatorOf(line)).map(cleanCell);
      const isHeader = !seenData && HEADER_CELL.test(cells[0]);
      seenData = true;
      if (isHeader) return;
      const row = Object.fromEntries(FIELDS.map((f, i) => [f, cells[i] || '']));
      rows.push({ line: index + 1, row });
    });
    return rows;
  }

  function formatRow(row, separator) {
    const cells = FIELDS.map((f) => (row[f].includes(separator) ? `"${row[f]}"` : row[f]));
    while (cells.length > REQUIRED.length && cells[cells.length - 1] === '') cells.pop();
    return cells.join(separator);
  }

  function fixBulk(text) {
    const lines = String(text).split(/\r?\n/);
    for (const { line, row } of parseBulk(text)) {
      if (lintRow(row).some((i) => i.fixed)) lines[line - 1] = formatRow(fixAll(row), separatorOf(lines[line - 1]));
    }
    return lines.join('\n');
  }

  function bulkLinks(text) {
    return parseBulk(text).map(({ row }) => buildUrl(row) || '').join('\n');
  }

  return { FIELDS, REQUIRED, buildUrl, mediumChannel, lintRow, fixAll, parseBulk, fixBulk, bulkLinks };
});
