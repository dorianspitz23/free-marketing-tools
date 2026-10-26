// The bundled tool must stand alone: a Share serves one file and blocks outside fetches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineTool } from './build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the bundled ROAS tool has no external stylesheet or script references', () => {
  const html = inlineTool('roas');
  assert.doesNotMatch(html, /<link[^>]+stylesheet/i, 'stylesheet still linked');
  assert.doesNotMatch(html, /<script[^>]+src=/i, 'script still linked');
  assert.match(html, /computeBreakEven/, 'calc.js was inlined');
  assert.match(html, /--lime:/, 'tokens.css was inlined');
  assert.doesNotMatch(html, /<img[^>]+src="(?!data:)/i, 'an image still points at a file');
});

test('every tool says Built with Omniscio, since a Share may not show its own badge', () => {
  assert.match(inlineTool('roas'), /href="https:\/\/omniscio\.com"[\s\S]*?Built with <b>Omniscio<\/b>/);
});

test('the hub serves the same look as the tools (docs/tokens.css matches shared/tokens.css)', () => {
  const shared = readFileSync(join(ROOT, 'shared', 'tokens.css'), 'utf8');
  const hub = readFileSync(join(ROOT, 'docs', 'tokens.css'), 'utf8');
  assert.equal(hub, shared, 'run `npm run build` to refresh docs/tokens.css');
});
