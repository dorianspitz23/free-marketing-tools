'use strict';
// UTM link building and the checks that keep GA4 reports from splitting.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildUrl, mediumChannel, lintRow, fixAll, parseBulk, fixBulk, bulkLinks
} = require('./calc.js');

const clean = {
  url: 'https://example.com/shop', source: 'newsletter', medium: 'email',
  campaign: 'spring-sale', term: '', content: ''
};
const codes = (row) => lintRow(row).map((i) => `${i.field}:${i.code}`);
const fixable = (row) => lintRow(row).filter((i) => i.fixed);
const fixOf = (row, field, code) => lintRow(row).find((i) => i.field === field && i.code === code).fixed;

// --- Building the link ---------------------------------------------------------------

test('builds source, medium and campaign onto a plain URL', () => {
  assert.equal(buildUrl(clean),
    'https://example.com/shop?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale');
});

test('adds term and content only when filled, in GA4 order', () => {
  assert.equal(buildUrl({ ...clean, term: 'rain-jacket', content: 'hero-button' }),
    'https://example.com/shop?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale' +
    '&utm_term=rain-jacket&utm_content=hero-button');
});

test('keeps other query params byte-for-byte and puts UTMs before the #fragment', () => {
  const url = 'https://example.com/p?ref=a%20b&q=x+y#reviews';
  assert.equal(buildUrl({ ...clean, url }),
    'https://example.com/p?ref=a%20b&q=x+y&utm_source=newsletter&utm_medium=email' +
    '&utm_campaign=spring-sale#reviews');
});

test('drops UTMs already in the pasted URL (any case) so the link carries only one of each', () => {
  const url = 'https://example.com/?UTM_SOURCE=old&id=7&utm_medium=old&utm_id=abc';
  assert.equal(buildUrl({ ...clean, url }),
    'https://example.com/?id=7&utm_id=abc&utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale');
});

test('percent-encodes values exactly as typed, so a mistake is visible in the link', () => {
  assert.equal(buildUrl({ ...clean, campaign: 'Spring Sale 50%&more' }),
    'https://example.com/shop?utm_source=newsletter&utm_medium=email&utm_campaign=Spring%20Sale%2050%25%26more');
});

test('gives no link until the URL is a real http(s) address and the required fields are filled', () => {
  assert.equal(buildUrl({ ...clean, url: '' }), null);
  assert.equal(buildUrl({ ...clean, url: 'example.com' }), null);
  assert.equal(buildUrl({ ...clean, url: 'javascript:alert(1)' }), null);
  assert.equal(buildUrl({ ...clean, url: 'https://' }), null);
  assert.equal(buildUrl({ ...clean, campaign: '   ' }), null);
  assert.equal(buildUrl({ ...clean, source: '' }), null);
});

// --- GA4 default channel group, from support.google.com/analytics/answer/9756891 ------------

test('mediums GA4 assigns a channel on their own', () => {
  const expected = {
    cpc: 'Paid', ppc: 'Paid', retargeting: 'Paid', paid_social: 'Paid', 'paid-search': 'Paid', cpv: 'Paid',
    display: 'Display', banner: 'Display', expandable: 'Display', interstitial: 'Display', cpm: 'Display',
    email: 'Email', 'e-mail': 'Email', e_mail: 'Email', 'e mail': 'Email',
    social: 'Organic Social', 'social-network': 'Organic Social', 'social-media': 'Organic Social',
    sm: 'Organic Social', 'social network': 'Organic Social', 'social media': 'Organic Social',
    organic: 'Organic Search', referral: 'Referral', app: 'Referral', link: 'Referral',
    affiliate: 'Affiliates', audio: 'Audio', sms: 'SMS', 'ai-assistant': 'AI Assistant',
    video: 'Organic Video', 'product-video': 'Organic Video',
    'web-push': 'Mobile Push Notifications', mobile: 'Mobile Push Notifications',
    notification: 'Mobile Push Notifications'
  };
  for (const [medium, channel] of Object.entries(expected)) {
    assert.ok(mediumChannel(medium)?.startsWith(channel), `${medium}: expected ${channel}, got ${mediumChannel(medium)}`);
  }
});

test('GA4 channel rules ignore case, so CPC and Email still get a channel', () => {
  assert.ok(mediumChannel('CPC').startsWith('Paid'));
  assert.equal(mediumChannel('Email'), 'Email');
});

test('mediums that land in Unassigned', () => {
  for (const medium of ['newsletter', 'facebook', 'qr', 'email-blast', 'affiliates', 'social_media', 'print', '']) {
    assert.equal(mediumChannel(medium), null, `${medium} should not map to a channel`);
  }
});

// --- Linting ---------------------------------------------------------------------------

test('a clean row has no issues', () => {
  assert.deepEqual(lintRow(clean), []);
  assert.deepEqual(lintRow({ ...clean, medium: 'cpc', term: 'rain_jacket', content: 'v2.1~a' }), []);
});

test('missing URL, source, medium and campaign are errors with no automatic fix', () => {
  const issues = lintRow({ url: '', source: '', medium: '', campaign: '' });
  assert.deepEqual(issues.map((i) => `${i.field}:${i.code}:${i.severity}`),
    ['url:missing:error', 'source:missing:error', 'medium:missing:error', 'campaign:missing:error']);
  assert.ok(issues.every((i) => i.fixed === null));
});

test('term and content are optional', () => {
  assert.deepEqual(codes({ ...clean, term: '', content: undefined }), []);
});

test('capitals: flagged because GA4 reports Email and email as two rows; the fix lowercases', () => {
  assert.deepEqual(codes({ ...clean, source: 'Newsletter' }), ['source:capitals']);
  assert.equal(fixOf({ ...clean, source: 'Newsletter' }, 'source', 'capitals').source, 'newsletter');
});

test('leading and trailing whitespace: flagged and trimmed, on the URL too', () => {
  assert.deepEqual(codes({ ...clean, campaign: ' spring-sale ' }), ['campaign:whitespace']);
  assert.equal(fixOf({ ...clean, campaign: ' spring-sale ' }, 'campaign', 'whitespace').campaign, 'spring-sale');
  assert.deepEqual(codes({ ...clean, url: ' https://example.com/shop' }), ['url:whitespace']);
});

test('spaces inside a value: flagged, and the fix joins words with a hyphen', () => {
  assert.deepEqual(codes({ ...clean, campaign: 'spring  sale' }), ['campaign:spaces']);
  assert.equal(fixOf({ ...clean, campaign: 'spring  sale' }, 'campaign', 'spaces').campaign, 'spring-sale');
});

test('characters that need encoding: flagged; the fix strips accents and swaps the rest for hyphens', () => {
  assert.deepEqual(codes({ ...clean, campaign: 'q&a/50%' }), ['campaign:encoding']);
  assert.equal(fixOf({ ...clean, campaign: 'q&a/50%' }, 'campaign', 'encoding').campaign, 'q-a-50');
  assert.equal(fixOf({ ...clean, content: 'café!' }, 'content', 'encoding').content, 'cafe');
});

test('an unrecognised medium is a warning; a known synonym gets a one-click suggestion', () => {
  const issue = lintRow({ ...clean, medium: 'newsletter' })[0];
  assert.equal(issue.code, 'unknownMedium');
  assert.equal(issue.severity, 'warning');
  assert.equal(issue.data.suggestion, 'email');
  assert.equal(issue.fixed.medium, 'email');
  assert.equal(fixOf({ ...clean, medium: 'facebook' }, 'medium', 'unknownMedium').medium, 'social');
  assert.equal(fixOf({ ...clean, medium: 'adwords' }, 'medium', 'unknownMedium').medium, 'cpc');
});

test('an unrecognised medium with no obvious synonym is flagged but left for the person to choose', () => {
  const issue = lintRow({ ...clean, medium: 'qr' })[0];
  assert.equal(issue.code, 'unknownMedium');
  assert.equal(issue.fixed, null);
});

test('a medium GA4 recognises in capitals is flagged for capitals only, not as unknown', () => {
  assert.deepEqual(codes({ ...clean, medium: 'CPC' }), ['medium:capitals']);
});

test('a URL without https:// gets a fix that adds it; other schemes are errors', () => {
  assert.deepEqual(codes({ ...clean, url: 'example.com/shop' }), ['url:noScheme']);
  assert.equal(fixOf({ ...clean, url: 'example.com/shop' }, 'url', 'noScheme').url, 'https://example.com/shop');
  assert.deepEqual(codes({ ...clean, url: 'ftp://example.com' }), ['url:badUrl']);
  assert.deepEqual(codes({ ...clean, url: 'https://exa mple.com' }), ['url:badUrl']);
});

test('UTMs already in the pasted URL: the fix moves them into empty fields and keeps typed values', () => {
  const row = { url: 'https://example.com/?utm_source=fb&x=1&utm_campaign=Old%20Promo#top', source: '', medium: 'social', campaign: 'summer' };
  const issue = lintRow(row).find((i) => i.code === 'existingUtm');
  assert.equal(issue.severity, 'warning');
  assert.deepEqual(issue.data.params, ['utm_source', 'utm_campaign']);
  assert.deepEqual(issue.fixed, {
    url: 'https://example.com/?x=1#top', source: 'fb', medium: 'social', campaign: 'summer', term: '', content: ''
  });
});

test('Fix all reaches a row with nothing left to fix, however messy the input', () => {
  const messy = [
    { url: ' example.com/a?utm_source=FB ', source: '', medium: ' Social Media ', campaign: 'Spring Sale 50%!' },
    { url: 'shop.example.com', source: 'Klaviyo Flow', medium: 'Newsletter', campaign: 'Black Friday', term: 'Rain Jacket', content: 'Héro Banner' },
    { url: 'https://x.io/?UTM_MEDIUM=CPC', source: 'Google', medium: '', campaign: 'brand' },
    { url: 'https://x.io', source: '!!!', medium: 'qr', campaign: 'x' }
  ];
  for (const row of messy) {
    const fixed = fixAll(row);
    assert.deepEqual(fixable(fixed), [], `still fixable after Fix all: ${JSON.stringify(fixed)}`);
  }
  assert.deepEqual(fixAll(messy[0]), {
    url: 'https://example.com/a', source: 'fb', medium: 'social-media', campaign: 'spring-sale-50', term: '', content: ''
  });
  assert.deepEqual(codes(fixAll(messy[3])), ['source:missing', 'medium:unknownMedium']);
});

test('a medium named like a built-in object key gets no bogus suggestion', () => {
  for (const medium of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const issue = lintRow({ ...clean, medium }).find((i) => i.code === 'unknownMedium');
    assert.equal(issue.data.suggestion, null, `${medium} got a suggestion`);
    assert.equal(issue.fixed, null);
  }
});

test('a UTM key with no value in the pasted URL moves in as empty, not as its own name', () => {
  const issue = lintRow({ ...clean, url: 'https://example.com/?utm_source', source: '' })
    .find((i) => i.code === 'existingUtm');
  assert.equal(issue.fixed.source, '');
  assert.equal(issue.fixed.url, 'https://example.com/');
});

test('the one-click spaces fix also drops edge spaces instead of turning them into hyphens', () => {
  assert.equal(fixOf({ ...clean, source: ' news letter ' }, 'source', 'spaces').source, 'news-letter');
});

// --- Bulk ------------------------------------------------------------------------------

test('bulk: commas or tabs, blank lines and a header row skipped, quoted and padded cells cleaned', () => {
  const text = 'url,source,medium,campaign\n\nhttps://a.com, google , cpc ,brand\n"https://b.com/?a=1",fb,social,"launch"\n' +
    'https://c.com\tnewsletter\temail\tweekly\tterm\tcontent';
  const rows = parseBulk(text);
  assert.deepEqual(rows.map((r) => r.line), [3, 4, 5]);
  assert.deepEqual(rows[0].row, { url: 'https://a.com', source: 'google', medium: 'cpc', campaign: 'brand', term: '', content: '' });
  assert.equal(rows[1].row.url, 'https://b.com/?a=1');
  assert.equal(rows[2].row.content, 'content');
});

test('bulk: Fix all rewrites each data line and leaves the header and blank lines alone', () => {
  const text = 'URL\tSource\tMedium\tCampaign\nexample.com\tFacebook\tFacebook\tSpring Sale\n\nhttps://a.com\tx\tqr\tq';
  assert.equal(fixBulk(text),
    'URL\tSource\tMedium\tCampaign\nhttps://example.com\tfacebook\tsocial\tspring-sale\n\nhttps://a.com\tx\tqr\tq');
});

test('bulk: Fix all keeps any extra columns after content, like a notes column', () => {
  assert.equal(fixBulk('https://a.com,Google,cpc,brand,,,keep me,and me'),
    'https://a.com,google,cpc,brand,,,keep me,and me');
});

test('bulk: Copy all gives one link per row and a blank line where a row cannot be built', () => {
  const text = 'https://a.com,google,cpc,brand\nhttps://b.com,,cpc,brand\nhttps://c.com,fb,social,x';
  assert.equal(bulkLinks(text),
    'https://a.com?utm_source=google&utm_medium=cpc&utm_campaign=brand\n\nhttps://c.com?utm_source=fb&utm_medium=social&utm_campaign=x');
});
