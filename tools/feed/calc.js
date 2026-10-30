// Reads a product feed and flags what Google Merchant Center would reject or limit.
// Runs in the browser (inlined by scripts/build.mjs, exposed as window.FeedCalc) and in Node (tests).
//
// Rules come from Google's Merchant Center help pages:
//   Product data specification   support.google.com/merchants/answer/7052112
//   id                           support.google.com/merchants/answer/6324405 (50 characters)
//   title                        support.google.com/merchants/answer/6324415 (150 characters; about 70 show)
//   description                  support.google.com/merchants/answer/6324468 (5,000 characters)
//   link / image_link            support.google.com/merchants/answer/6324416, /6324350
//   availability                 support.google.com/merchants/answer/6324448
//   price                        support.google.com/merchants/answer/6324371
//   condition                    support.google.com/merchants/answer/6324469
//   gtin                         support.google.com/merchants/answer/6324461 (8, 12, 13 or 14 digits)
//   mpn / brand                  support.google.com/merchants/answer/6324482, /6324351
//   identifier_exists            support.google.com/merchants/answer/6324478
//   Editorial requirements       support.google.com/merchants/answer/2877578 (promotional text, capitals)
// Estimates, not Google's numbers: PROMO_TEXT is our own list of common offenders, and ALL_CAPS_WORD
// (4+ letters) is our line for shouting. Google reviews both by judgement. The 70 is a display
// guide rather than a limit, so it only warns. Requirements also vary by country and category.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeedCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REQUIRED = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price'];
  const AVAILABILITY = ['in_stock', 'out_of_stock', 'preorder', 'backorder'];
  const CONDITIONS = ['new', 'refurbished', 'used'];
  const GTIN_LENGTHS = [8, 12, 13, 14];
  const MAX_ID = 50;
  const MAX_TITLE = 150;
  const SHOWN_TITLE = 70;
  const MAX_DESCRIPTION = 5000;
  const RENDER_LIMIT = 300;
  const DUPLICATES_NAMED = 3;
  const QUOTE = 34;
  const NEWLINE = 10;

  const PRICE = /^\d[\d,]*(\.\d+)?\s*[a-z]{3}$/i;
  const SCIENTIFIC = /^\d(\.\d+)?e\+?\d+$/i;
  const NO_IDENTIFIER = /^(no|false)$/i;
  const SIZE_WORD = /^X+[LS]$/;
  const ALL_CAPS_WORD = /\b[A-Z]{4,}\b/g;
  const PROMO_TEXT = /\b(free (shipping|delivery|returns)|\d+\s?% off|buy now|best price|limited (time|offer)|on sale|clearance|order now|cheapest)\b/i;

  const SEVERITY_ORDER = { error: 0, warning: 1 };
  const count = (n) => n.toLocaleString('en-US');

  // --- Parsing: one pass over the text, so the cost grows with its length and nothing else ---

  function readQuoted(text, start) {
    let value = '';
    let from = start;
    for (;;) {
      const end = text.indexOf('"', from);
      if (end < 0) return { value: value + text.slice(from), next: text.length, closed: false };
      value += text.slice(from, end);
      if (text.charCodeAt(end + 1) !== QUOTE) return { value, next: end + 1, closed: true };
      value += '"';
      from = end + 2;
    }
  }

  function readPlain(text, start, separator) {
    let i = start;
    while (i < text.length) {
      const code = text.charCodeAt(i);
      if (code === separator || code === NEWLINE) break;
      i++;
    }
    return { value: text.slice(start, i), next: i, closed: true };
  }

  function countNewlines(value) {
    let count = 0;
    for (let at = value.indexOf('\n'); at >= 0; at = value.indexOf('\n', at + 1)) count++;
    return count;
  }

  function separatorOf(text) {
    const end = text.indexOf('\n');
    return (end < 0 ? text : text.slice(0, end)).includes('\t') ? '\t' : ',';
  }

  function rawRows(text) {
    const separator = separatorOf(text).charCodeAt(0);
    const rows = [];
    let cells = [];
    let line = 1;
    let rowLine = 1;
    let unclosedQuote = null;
    let i = 0;
    const endRow = () => {
      if (cells.some((c) => c !== '')) rows.push({ line: rowLine, cells });
      cells = [];
    };
    while (i < text.length) {
      const quoted = text.charCodeAt(i) === QUOTE;
      const cell = quoted ? readQuoted(text, i + 1) : readPlain(text, i, separator);
      const rest = quoted && cell.closed ? readPlain(text, cell.next, separator) : { value: '', next: cell.next };
      if (!cell.closed) unclosedQuote = rowLine;
      if (quoted) line += countNewlines(cell.value);
      cells.push((cell.value + rest.value).trim());
      i = rest.next;
      const code = text.charCodeAt(i);
      i++;
      if (code === separator) continue;
      endRow();
      line++;
      rowLine = line;
    }
    endRow();
    return { rows, unclosedQuote };
  }

  function canonicalColumn(name) {
    return name.trim().toLowerCase().replace(/^g:/, '').replace(/[\s-]+/g, '_');
  }

  function parseFeed(input) {
    const text = String(input ?? '').replace(/^\uFEFF/, '');
    const { rows, unclosedQuote } = rawRows(text);
    const [header] = rows;
    return { header: header ? header.cells : [], rows: rows.slice(1), unclosedQuote };
  }

  // --- Row checks: each returns one problem or nothing ---

  const problem = (field, severity, label, reason) => ({ field, severity, label, reason });
  const rejected = (field, label, reason) => problem(field, 'error', label, reason);
  const weakened = (field, label, reason) => problem(field, 'warning', label, reason);

  function isHttpUrl(url) {
    if (!/^https?:\/\//i.test(url)) return false;
    try { new URL(url); return true; } catch { return false; }
  }

  function hasGoodCheckDigit(digits) {
    let sum = 0;
    for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(digits[i]) * weight;
    return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
  }

  function gtinProblem(gtin) {
    if (gtin === '') return null;
    const bad = (reason) => rejected('gtin', 'GTIN invalid', reason);
    if (SCIENTIFIC.test(gtin)) return bad('A spreadsheet turned this GTIN into scientific notation. Format the column as text and export again.');
    if (/\D/.test(gtin)) return bad('A GTIN has only digits.');
    if (!GTIN_LENGTHS.includes(gtin.length)) return bad(`This GTIN has ${gtin.length} digits. It needs 8, 12, 13 or 14.`);
    return hasGoodCheckDigit(gtin) ? null : bad('This GTIN fails its check digit, so at least one digit is wrong.');
  }

  function identifierProblems(get) {
    if (NO_IDENTIFIER.test(get('identifier_exists'))) return [];
    const found = [];
    if (get('brand') === '') found.push(rejected('brand', 'Missing brand', 'Add a brand, or set identifier_exists to no if the product has none.'));
    if (get('gtin') === '' && get('mpn') === '') {
      found.push(rejected('gtin', 'Missing GTIN or MPN', 'Add a GTIN or MPN, or set identifier_exists to no if the product has neither.'));
    }
    return found;
  }

  function titleProblem(get) {
    const title = get('title');
    if (title.length > MAX_TITLE) return rejected('title', 'Title too long', `This title has ${title.length} characters. The limit is ${MAX_TITLE}.`);
    if (title.length > SHOWN_TITLE) return weakened('title', 'Title may be cut', `Shoppers may see only the first ${SHOWN_TITLE} characters, so put the key details first.`);
    return null;
  }

  function adTextProblem(get) {
    const title = get('title');
    const promo = title.match(PROMO_TEXT);
    if (promo) return rejected('title', 'Promotional title', `Google doesn’t allow promotional text like “${promo[0]}” in a title.`);
    const brand = get('brand').toLowerCase();
    const shouted = (title.match(ALL_CAPS_WORD) || []).find((w) => !SIZE_WORD.test(w) && !brand.includes(w.toLowerCase()));
    return shouted ? weakened('title', 'ALL-CAPS title', `Capitals for emphasis, like “${shouted}”, read as spam. Use normal capitals.`) : null;
  }

  function formatProblems(get) {
    const found = [];
    const add = (bad, issue) => { if (bad) found.push(issue()); };
    const id = get('id');
    const description = get('description');
    const availability = get('availability').toLowerCase().replace(/\s+/g, '_');
    const condition = get('condition').toLowerCase();
    add(id.length > MAX_ID, () => rejected('id', 'ID too long', `This id has ${id.length} characters. The limit is ${MAX_ID}.`));
    add(description.length > MAX_DESCRIPTION, () => rejected('description', 'Description too long',
      `This description has ${count(description.length)} characters. The limit is ${count(MAX_DESCRIPTION)}.`));
    add(get('price') !== '' && !PRICE.test(get('price')), () => rejected('price', 'Price format', 'A price is a number plus a 3-letter currency, like 15.00 USD.'));
    add(availability !== '' && !AVAILABILITY.includes(availability), () => rejected('availability', 'Availability value', `Use one of ${AVAILABILITY.join(', ')}.`));
    add(condition !== '' && !CONDITIONS.includes(condition), () => rejected('condition', 'Condition value', `Use one of ${CONDITIONS.join(', ')}.`));
    add(get('link') !== '' && !isHttpUrl(get('link')), () => rejected('link', 'Bad link', 'Needs a full address starting with https://'));
    add(get('image_link') !== '' && !isHttpUrl(get('image_link')), () => rejected('image_link', 'Bad image link', 'Needs a full address starting with https://'));
    return found;
  }

  function checkRow(get, tooManyCells) {
    const issues = REQUIRED.filter((f) => get(f) === '').map((f) => rejected(f, `Missing ${f}`, `Google requires ${f} on every product.`));
    if (tooManyCells) issues.push(rejected(null, 'Extra cells', 'This row has more cells than the header. Usually a comma inside a value that isn’t in quotes.'));
    issues.push(...identifierProblems(get), ...formatProblems(get));
    for (const found of [titleProblem(get), adTextProblem(get), gtinProblem(get('gtin'))]) if (found) issues.push(found);
    return issues;
  }

  // --- Whole feed ---

  function addDuplicates(rows, idColumn) {
    const byId = new Map();
    for (const row of rows) {
      const id = row.cells[idColumn] ?? '';
      if (id === '') continue;
      if (byId.has(id)) byId.get(id).push(row); else byId.set(id, [row]);
    }
    for (const group of byId.values()) {
      if (group.length < 2) continue;
      for (const row of group) {
        const others = group.slice(0, DUPLICATES_NAMED + 1).filter((r) => r !== row).slice(0, DUPLICATES_NAMED).map((r) => r.line);
        row.issues.push(rejected('id', 'Duplicate ID', `Same id as row ${others.join(', ')}. Every product needs its own.`));
      }
    }
  }

  function stateOf(issues) {
    if (issues.length === 0) return 'ok';
    return issues.some((i) => i.severity === 'error') ? 'fix' : 'warn';
  }

  function summarize(rows) {
    const counts = new Map();
    let rejectedRows = 0;
    let weakenedRows = 0;
    for (const row of rows) {
      row.state = stateOf(row.issues);
      if (row.state === 'fix') rejectedRows++;
      if (row.state === 'warn') weakenedRows++;
      for (const { label, severity } of row.issues) {
        const entry = counts.get(label) || { label, severity, count: 0 };
        entry.count++;
        counts.set(label, entry);
      }
    }
    const breakdown = [...counts.values()].sort((a, b) => b.count - a.count || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    return { rejected: rejectedRows, weakened: weakenedRows, bad: rejectedRows + weakenedRows, breakdown };
  }

  const blankResult = (status, notice, columns) => ({
    status, notice, columns, rows: [], total: 0, bad: 0, rejected: 0, weakened: 0, breakdown: []
  });

  function quoteNotice(line) {
    return line ? `A quote opened on row ${line} never closes, so everything after it reads as one cell.` : '';
  }

  function checkFeed(text) {
    const { header, rows, unclosedQuote } = parseFeed(text);
    if (header.length === 0) return blankResult('empty', '', []);
    const columns = header.map(canonicalColumn);
    if (!columns.some((c) => REQUIRED.includes(c))) {
      return blankResult('noHeader', 'No header row found. The first line needs column names like id, title and price, split by commas or tabs.', columns);
    }
    if (rows.length === 0) return blankResult('noProducts', 'The header is here, but no products under it.', columns);
    const index = new Map();
    columns.forEach((c, i) => { if (!index.has(c)) index.set(c, i); });
    const cellOf = (cells, field) => (index.has(field) ? cells[index.get(field)] ?? '' : '');
    for (const row of rows) row.issues = checkRow((field) => cellOf(row.cells, field), row.cells.length > columns.length);
    if (index.has('id')) addDuplicates(rows, index.get('id'));
    return { status: 'ok', notice: quoteNotice(unclosedQuote), columns, rows, total: rows.length, ...summarize(rows) };
  }

  function headline({ total, bad }) {
    if (bad === 0) return total === 1 ? 'Your 1 product looks clean' : `All ${count(total)} products look clean`;
    return `${count(bad)} of ${count(total)} ${total === 1 ? 'product' : 'products'} ${bad === 1 ? 'needs' : 'need'} fixing`;
  }

  function problemList(result) {
    const idColumn = result.columns.indexOf('id');
    const lines = [headline(result), ''];
    for (const row of result.rows) {
      if (row.issues.length === 0) continue;
      const id = row.cells[idColumn];
      lines.push(`Row ${row.line}${id ? ` (${id})` : ''}: ${row.issues.map((i) => i.reason).join('; ')}`);
    }
    return lines.join('\n');
  }

  return { RENDER_LIMIT, count, parseFeed, checkFeed, headline, problemList };
});
