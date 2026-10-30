// Feed parsing and Merchant Center rules, exercised through checkFeed the way the page uses it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFeed, checkFeed, headline, problemList, RENDER_LIMIT } = require('./calc.js');

const GOOD = {
  id: 'RJ-100', title: 'Lightweight rain jacket', description: 'Packable waterproof shell.',
  link: 'https://example.com/rj-100', image_link: 'https://example.com/rj-100.jpg',
  availability: 'in_stock', price: '59.00 USD', brand: 'Northline', gtin: '012345678905',
  mpn: 'NL-100', condition: 'new'
};

// A one-product feed with the given attributes changed; undefined drops the column.
function feedOf(changes) {
  const row = { ...GOOD, ...changes };
  const names = Object.keys(row).filter((k) => row[k] !== undefined);
  const quote = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `${names.join(',')}\n${names.map((k) => quote(row[k])).join(',')}`;
}

const issuesOf = (changes) => checkFeed(feedOf(changes)).rows[0].issues;
const labels = (changes) => issuesOf(changes).map((i) => i.label);

function assertFlagged(changes, label, severity, reasonPattern) {
  const found = issuesOf(changes).find((i) => i.label === label);
  assert.ok(found, `expected "${label}" for ${JSON.stringify(changes)}, got ${JSON.stringify(labels(changes))}`);
  assert.equal(found.severity, severity);
  if (reasonPattern) assert.match(found.reason, reasonPattern);
}

test('a complete product has no problems', () => {
  const result = checkFeed(feedOf({}));
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.rows[0].issues, []);
  assert.equal(result.rows[0].state, 'ok');
  assert.equal(result.bad, 0);
});

// --- Parsing ---

test('comma and tab feeds read the same', () => {
  const comma = parseFeed('id,title\nA1,Jacket\nA2,Boots');
  const tab = parseFeed('id\ttitle\nA1\tJacket\nA2\tBoots');
  assert.deepEqual(tab.rows.map((r) => r.cells), comma.rows.map((r) => r.cells));
  assert.deepEqual(comma.rows.map((r) => r.cells), [['A1', 'Jacket'], ['A2', 'Boots']]);
});

test('a tab feed keeps commas inside cells', () => {
  assert.deepEqual(parseFeed('id\ttitle\nA1\tJacket, blue').rows[0].cells, ['A1', 'Jacket, blue']);
});

test('quoted cells hold commas, doubled quotes and line breaks', () => {
  const { rows } = parseFeed('id,title\nA1,"Jacket, ""storm"" edition\nsecond line"\nA2,Boots');
  assert.equal(rows[0].cells[1], 'Jacket, "storm" edition\nsecond line');
  assert.equal(rows[1].cells[0], 'A2');
});

test('row numbers match the spreadsheet, counting the header and line breaks inside quotes', () => {
  const { rows } = parseFeed('id,title\n\nA1,"two\nlines"\nA2,Boots\r\nA3,Hat');
  assert.deepEqual(rows.map((r) => r.line), [3, 5, 6]);
  assert.equal(rows[1].cells[1], 'Boots', 'a Windows line ending stays out of the cell');
});

test('a quote in the middle of a cell is just a character', () => {
  assert.equal(parseFeed('id,title\nA1,5" jacket').rows[0].cells[1], '5" jacket');
});

test('an unclosed quote is reported with the row it starts on', () => {
  const { unclosedQuote, rows } = parseFeed('id,title\nA1,Jacket\nA2,"Boots\nA3,Hat');
  assert.equal(unclosedQuote, 3);
  assert.equal(rows.length, 2);
  assert.match(checkFeed('id,title\nA1,"Jacket').notice, /quote/i);
});

test('a byte-order mark from Excel does not hide the first column', () => {
  assert.deepEqual(checkFeed(`﻿${feedOf({})}`).rows[0].issues, []);
});

test('headers work in any column order, any case, with the g: prefix or spaces', () => {
  const text = 'G:Price\tIMAGE LINK\tg:title\tDescription\tid\tlink\tavailability\tbrand\tgtin\n'
    + '59.00 USD\thttps://e.com/a.jpg\tJacket\tDry.\tA1\thttps://e.com/a\tin_stock\tNorthline\t012345678905';
  assert.deepEqual(checkFeed(text).rows[0].issues, []);
});

test('the same column twice: the first one counts', () => {
  const text = feedOf({}).replace('id,', 'id,id,').replace('RJ-100,', 'RJ-100,other,');
  assert.equal(checkFeed(text).rows[0].cells[0], 'RJ-100');
  assert.deepEqual(checkFeed(text).rows[0].issues, []);
});

test('text with no recognisable header says so instead of flagging every row', () => {
  const result = checkFeed('RJ-100,Rain jacket,59.00 USD\nRJ-101,Boots,20.00 USD');
  assert.equal(result.status, 'noHeader');
  assert.equal(result.total, 0);
  assert.match(result.notice, /header/i);
  assert.equal(checkFeed('id;title;price\nA;B;C').status, 'noHeader', 'semicolons are not a supported separator');
});

test('empty text and a header with no products are told apart', () => {
  assert.equal(checkFeed('  \n ').status, 'empty');
  assert.equal(checkFeed('id,title,price').status, 'noProducts');
  assert.equal(checkFeed('id,title,price').total, 0);
});

test('blank lines are skipped, not counted as products', () => {
  assert.equal(checkFeed(`${feedOf({})}\n\n   \n`).total, 1);
});

// --- Required attributes ---

for (const field of ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand']) {
  test(`a missing column or a blank ${field} is rejected`, () => {
    assertFlagged({ [field]: undefined }, `Missing ${field}`, 'error');
    assertFlagged({ [field]: '   ' }, `Missing ${field}`, 'error');
  });
}

test('a product needs a GTIN or an MPN, not both', () => {
  assertFlagged({ gtin: undefined, mpn: undefined }, 'Missing GTIN or MPN', 'error', /GTIN|MPN/);
  assert.deepEqual(labels({ gtin: undefined }), []);
  assert.deepEqual(labels({ mpn: '' }), []);
});

test('identifier_exists no lifts brand, GTIN and MPN, in any case', () => {
  for (const value of ['no', 'NO', 'false']) {
    assert.deepEqual(labels({ brand: '', gtin: '', mpn: '', identifier_exists: value }), []);
  }
  assertFlagged({ brand: '', identifier_exists: 'yes' }, 'Missing brand', 'error');
});

test('identifier_exists no still checks a GTIN that was sent', () => {
  assertFlagged({ gtin: '123', identifier_exists: 'no' }, 'GTIN invalid', 'error');
});

// --- Length limits (exactly at the limit is fine) ---

test('id: 50 characters pass, 51 are rejected', () => {
  assert.deepEqual(labels({ id: 'x'.repeat(50) }), []);
  assertFlagged({ id: 'x'.repeat(51) }, 'ID too long', 'error', /51.*50/);
});

test('title: over 70 may be cut, over 150 is rejected, and only one of those shows', () => {
  assert.deepEqual(labels({ title: 'x'.repeat(70) }), []);
  assert.deepEqual(labels({ title: 'x'.repeat(71) }), ['Title may be cut']);
  assertFlagged({ title: 'x'.repeat(71) }, 'Title may be cut', 'warning', /70/);
  assert.deepEqual(labels({ title: 'x'.repeat(150) }), ['Title may be cut']);
  assert.deepEqual(labels({ title: 'x'.repeat(151) }), ['Title too long']);
  assertFlagged({ title: 'x'.repeat(151) }, 'Title too long', 'error', /151.*150/);
});

test('description: 5,000 characters pass, 5,001 are rejected', () => {
  assert.deepEqual(labels({ description: 'x'.repeat(5000) }), []);
  assertFlagged({ description: 'x'.repeat(5001) }, 'Description too long', 'error', /5,?001.*5,?000/);
});

// --- Value formats ---

test('price needs a number and a 3-letter currency', () => {
  for (const good of ['15.00 USD', '15 USD', '1,500.00 USD', '15.00 usd']) assert.deepEqual(labels({ price: good }), [], good);
  for (const bad of ['$15.00', '15.00', 'USD 15.00', 'free', '15.00 DOLLARS', '15.00 US']) {
    assertFlagged({ price: bad }, 'Price format', 'error', /15\.00 USD/);
  }
});

test('availability takes Google\'s four values, ignoring capitals and spaces for underscores', () => {
  for (const good of ['in_stock', 'out_of_stock', 'preorder', 'backorder', 'In Stock', 'OUT_OF_STOCK']) {
    assert.deepEqual(labels({ availability: good }), [], good);
  }
  assertFlagged({ availability: 'available' }, 'Availability value', 'error', /in_stock/);
});

test('condition may be blank, otherwise new, refurbished or used', () => {
  for (const good of ['', 'new', 'Refurbished', 'USED']) assert.deepEqual(labels({ condition: good }), [], good);
  assert.deepEqual(labels({ condition: undefined }), []);
  assertFlagged({ condition: 'like new' }, 'Condition value', 'error', /refurbished/);
});

test('GTIN length, digits and check digit', () => {
  for (const good of ['96385074', '012345678905', '4006381333931', '10012345678902']) assert.deepEqual(labels({ gtin: good }), [], good);
  assertFlagged({ gtin: '123456789' }, 'GTIN invalid', 'error', /9 digits/);
  assertFlagged({ gtin: '01234567890A' }, 'GTIN invalid', 'error', /only digits/i);
  assertFlagged({ gtin: '012345678906' }, 'GTIN invalid', 'error', /check digit/i);
});

test('a GTIN a spreadsheet turned into scientific notation gets its own reason', () => {
  assertFlagged({ gtin: '1.23457E+11' }, 'GTIN invalid', 'error', /scientific/i);
});

test('link and image_link must be absolute http(s) addresses', () => {
  for (const good of ['https://a.com/x', 'http://a.com/x']) assert.deepEqual(labels({ link: good }), [], good);
  for (const bad of ['a.com/x', '/products/x', 'ftp://a.com/x', 'https://']) {
    assertFlagged({ link: bad }, 'Bad link', 'error', /https:\/\//);
    assertFlagged({ image_link: bad }, 'Bad image link', 'error', /https:\/\//);
  }
});

// --- Titles that read like ads ---

test('promotional phrases in a title are rejected', () => {
  for (const title of ['Rain jacket FREE SHIPPING', 'Rain jacket 20% off', 'Buy now rain jacket', 'Jacket on sale', 'Rain jacket free delivery']) {
    assertFlagged({ title }, 'Promotional title', 'error');
  }
  assert.deepEqual(labels({ title: 'Salem rain jacket' }), []);
  assert.deepEqual(labels({ title: 'Free-range wool jacket' }), []);
});

test('a phrase already flagged as promotional does not also count as ALL CAPS', () => {
  assert.deepEqual(labels({ title: 'Rain jacket FREE SHIPPING' }), ['Promotional title']);
});

test('ALL-CAPS words weaken a title, except the brand, sizes and short abbreviations', () => {
  assertFlagged({ title: 'WATERPROOF rain jacket' }, 'ALL-CAPS title', 'warning', /WATERPROOF/);
  assert.deepEqual(labels({ title: 'NIKE rain jacket', brand: 'Nike' }), []);
  assert.deepEqual(labels({ title: 'Rain jacket XXXL' }), []);
  assert.deepEqual(labels({ title: 'UK rain jacket USB' }), []);
});

// --- Across rows ---

test('every row sharing an id is flagged, naming the other rows', () => {
  const text = `${feedOf({})}\nRJ-100,x\nRJ-200,y\nRJ-100,z`;
  const { rows } = checkFeed(text);
  const dup = (r) => r.issues.find((i) => i.label === 'Duplicate ID');
  assert.match(dup(rows[0]).reason, /rows? 3, 5/);
  assert.match(dup(rows[1]).reason, /rows? 2, 5/);
  assert.equal(dup(rows[2]), undefined);
  assert.equal(dup(rows[1]).severity, 'error');
});

test('ids are compared after trimming, and blank ids are not duplicates of each other', () => {
  const dupes = (text) => checkFeed(text).rows.flatMap((r) => r.issues).filter((i) => i.label === 'Duplicate ID').length;
  assert.equal(dupes('id,title\n A1 ,x\nA1,y'), 2);
  assert.equal(dupes('id,title\n,x\n,y'), 0);
});

test('a row with more cells than the header is rejected, with the likely cause', () => {
  const text = 'id,title,price\nA1,Jacket, blue,59.00 USD';
  const issue = checkFeed(text).rows[0].issues.find((i) => i.label === 'Extra cells');
  assert.equal(issue.severity, 'error');
  assert.match(issue.reason, /comma/i);
});

test('a row shorter than the header reads its missing cells as blank', () => {
  const issues = checkFeed('id,title,price\nA1,Jacket').rows[0].issues.map((i) => i.label);
  assert.ok(issues.includes('Missing price'));
  assert.ok(!issues.includes('Extra cells'));
});

// --- Totals ---

const MIXED = [
  'id,title,description,link,image_link,availability,price,brand,gtin',
  'A1,Rain jacket,Dry.,https://e.com/1,https://e.com/1.jpg,in_stock,59.00 USD,Northline,012345678905',
  `A2,${'x'.repeat(80)},Dry.,https://e.com/2,https://e.com/2.jpg,in_stock,59.00 USD,Northline,012345678905`,
  'A3,Rain jacket,Dry.,https://e.com/3,https://e.com/3.jpg,available,$59,Northline,012345678905',
  'A4,Rain jacket,Dry.,https://e.com/4,https://e.com/4.jpg,available,59.00 USD,Northline,012345678905'
].join('\n');

test('totals split rejected and weakened products, and rows carry their worst state', () => {
  const result = checkFeed(MIXED);
  assert.equal(result.total, 4);
  assert.equal(result.bad, 3);
  assert.equal(result.rejected, 2);
  assert.equal(result.weakened, 1);
  assert.deepEqual(result.rows.map((r) => r.state), ['ok', 'warn', 'fix', 'fix']);
});

test('the breakdown counts each problem once per row, most common first', () => {
  assert.deepEqual(checkFeed(MIXED).breakdown.slice(0, 3).map((b) => [b.label, b.count, b.severity]), [
    ['Availability value', 2, 'error'], ['Price format', 1, 'error'], ['Title may be cut', 1, 'warning']
  ]);
});

test('the headline reads properly at every count', () => {
  assert.equal(headline(checkFeed(MIXED)), '3 of 4 products need fixing');
  assert.equal(headline({ total: 9, bad: 1 }), '1 of 9 products needs fixing');
  assert.equal(headline({ total: 1, bad: 1 }), '1 of 1 product needs fixing');
  assert.equal(headline({ total: 9, bad: 0 }), 'All 9 products look clean');
  assert.equal(headline({ total: 1, bad: 0 }), 'Your 1 product looks clean');
});

test('the problem list names each bad row and its reasons, and skips clean rows', () => {
  const list = problemList(checkFeed(MIXED));
  const lines = list.split('\n');
  assert.equal(lines[0], '3 of 4 products need fixing');
  assert.equal(lines.length, 5, list);
  assert.match(lines[2], /^Row 3 \(A2\): /);
  assert.match(lines[3], /^Row 4 \(A3\): .*; /, 'reasons are joined on one line');
  assert.doesNotMatch(list, /\(A1\)/);
});

test('a row with no id reads sensibly in the problem list', () => {
  assert.match(problemList(checkFeed(feedOf({ id: '' }))), /^Row 2: /m);
});

// --- Big feeds ---

const bigFeed = (n) => {
  const lines = [Object.keys(GOOD).join(',')];
  for (let i = 0; i < n; i++) {
    // Half the rows are bad, and every row shares an id: the worst case for the duplicate check.
    const price = i % 2 ? '59.00 USD' : '$59';
    lines.push(`SAME,Rain jacket ${i},Dry.,https://e.com/${i},https://e.com/${i}.jpg,in_stock,${price},Northline,012345678905,NL-${i},new`);
  }
  return lines.join('\n');
};

const timed = (text) => { const start = process.hrtime.bigint(); checkFeed(text); return Number(process.hrtime.bigint() - start) / 1e6; };
const fastest = (text, runs) => Math.min(...Array.from({ length: runs }, () => timed(text)));

test('the check stays linear: ten times the rows costs about ten times the work', () => {
  const small = bigFeed(5000);
  const large = bigFeed(50000);
  timed(small); // Warm the engine so the first measurement is not the slow one.
  const ratio = fastest(large, 2) / fastest(small, 3);
  // Linear is about 10, quadratic about 100. The gap leaves room for a busy machine.
  assert.ok(ratio < 30, `50,000 rows took ${ratio.toFixed(1)}x as long as 5,000`);
});

test('a 50,000-row feed is checked in full, not sampled', () => {
  const result = checkFeed(bigFeed(50000));
  assert.equal(result.total, 50000);
  assert.equal(result.rejected, 50000);
  assert.equal(result.rows[49999].line, 50001);
  assert.equal(problemList(result).split('\n').length, 50002);
});

test('the page draws only the first few hundred rows', () => {
  assert.ok(RENDER_LIMIT >= 100 && RENDER_LIMIT <= 500, `RENDER_LIMIT is ${RENDER_LIMIT}`);
});
