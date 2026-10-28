// The hub is what gets linked on X every day: its preview must stay neutral, its list must be valid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const html = readFileSync(join(DOCS, 'index.html'), 'utf8');
const tools = JSON.parse(readFileSync(join(DOCS, 'tools.json'), 'utf8'));
const upcoming = JSON.parse(readFileSync(join(DOCS, '..', 'upcoming.json'), 'utf8'));
const CHALLENGE_DAYS = 10;
const OG_SIZE = { width: 1200, height: 630 };

function metaContent(attr, key) {
  const tag = html.match(new RegExp(`<meta[^>]+${attr}="${key}"[^>]*>`, 'i'));
  assert.ok(tag, `missing <meta ${attr}="${key}">`);
  return tag[0].match(/content="([^"]*)"/i)[1];
}

test('the X/link preview never mentions Omniscio', () => {
  const previewTags = [
    ['property', 'og:title'], ['property', 'og:description'], ['property', 'og:site_name'],
    ['property', 'og:image'], ['name', 'twitter:title'], ['name', 'twitter:description'],
    ['name', 'twitter:image']
  ];
  for (const [attr, key] of previewTags) {
    assert.doesNotMatch(metaContent(attr, key), /omniscio/i, `${key} mentions Omniscio`);
  }
  assert.doesNotMatch(html.match(/<title>([^<]*)<\/title>/i)[1], /omniscio/i, '<title> mentions Omniscio');
});

test('the preview image is an absolute https URL and a large card', () => {
  assert.match(metaContent('property', 'og:image'), /^https:\/\/.+\/og\.png$/);
  assert.equal(metaContent('name', 'twitter:card'), 'summary_large_image');
});

test('the page itself says Built with Omniscio', () => {
  assert.match(html.replace(/<[^>]+>/g, ''), /Built with Omniscio/);
});

test('the page carries the floating Made with Omniscio badge, like an Omniscio Share', () => {
  const badge = html.match(/<a[^>]+class="made-with"[^>]*>[\s\S]*?<\/a>/);
  assert.ok(badge, 'missing the <a class="made-with"> badge');
  assert.match(badge[0], /href="https:\/\/omniscio\.com"/, 'badge must link to omniscio.com');
  assert.match(badge[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), /Made with Omniscio/);
  assert.match(html, /\.made-with\s*\{[^}]*position:\s*fixed/, 'badge must float like the Shares badge');
});

test('tool cards are rendered as text, never as injected HTML', () => {
  assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|document\.write/);
});

function assertValidList(list, file) {
  assert.ok(Array.isArray(list), `${file} is a list`);
  const days = list.map((t) => t.day);
  assert.deepEqual(days, [...days].sort((a, b) => a - b), `${file} entries are in day order`);
  assert.equal(new Set(days).size, days.length, `no day appears twice in ${file}`);
  for (const t of list) {
    assert.ok(Number.isInteger(t.day) && t.day >= 1 && t.day <= CHALLENGE_DAYS, `day ${t.day} out of range`);
    assert.ok(t.name && t.blurb, `day ${t.day} needs a name and a blurb`);
    // Straight to the Share host: the omnisc.io short link is a second domain that can fail to resolve.
    assert.match(t.url, /^https:\/\/shares\.omniscio\.com\/s\/[a-z0-9]+$/, `day ${t.day} must link straight to shares.omniscio.com`);
    if (t.shot !== undefined) {
      assert.match(t.shot, /^shots\/[a-z0-9-]+\.png$/, `day ${t.day} shot must be a shots/*.png path`);
      assert.ok(existsSync(join(DOCS, t.shot)), `day ${t.day} shot ${t.shot} is missing`);
    }
  }
}

test('tools.json: one entry per challenge day, complete, https links, in day order', () => {
  assert.ok(tools.length > 0, 'tools.json is a non-empty list');
  assertValidList(tools, 'tools.json');
});

test('upcoming.json: finished but unreleased days are valid and come after every live day', () => {
  assertValidList(upcoming, 'upcoming.json');
  const lastLive = Math.max(...tools.map((t) => t.day));
  for (const t of upcoming) assert.ok(t.day > lastLive, `day ${t.day} is live already; remove it from upcoming.json`);
});

test('og.png is a 1200x630 PNG', () => {
  const png = readFileSync(join(DOCS, 'og.png'));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.deepEqual({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }, OG_SIZE);
});
