'use strict';
// Break-even maths, checked against hand-worked numbers for realistic stores.
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeBreakEven, readInputs } = require('./calc.js');

const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 0.005, `${label}: expected ${expected}, got ${actual}`);

const base = {
  orderValue: 50, discountPct: 0, productCost: 15, shippingCost: 5,
  feePct: 2.9, feeFixed: 0.3, returnRatePct: 0, returnCost: 0, targetMarginPct: 10
};

test('simple store with no returns: fee, contribution, break-even CPA and ROAS', () => {
  const r = computeBreakEven(base);
  near(r.price, 50, 'price');
  near(r.fee, 1.75, 'fee (2.9% + 0.30)');
  near(r.contribution, 28.25, 'contribution');
  near(r.breakEvenCpa, 28.25, 'break-even CPA');
  near(r.breakEvenRoas, 50 / 28.25, 'break-even ROAS');
  near(r.targetRoas, 50 / 23.25, 'target ROAS at 10% margin');
  assert.equal(r.status, 'profitable');
  assert.equal(r.targetReachable, true);
});

test('discount and returns: refunded orders keep the product, cost the return label, fees stay paid', () => {
  const r = computeBreakEven({
    ...base, orderValue: 80, discountPct: 10, productCost: 30, shippingCost: 8,
    feePct: 3, feeFixed: 0, returnRatePct: 10, returnCost: 12, targetMarginPct: 15
  });
  near(r.price, 72, 'price after 10% discount');
  near(r.fee, 2.16, 'fee on the discounted price');
  near(r.contribution, 26.44, 'contribution = 0.9*(72-30) - 8 - 2.16 - 0.1*12');
  near(r.breakEvenRoas, 72 / 26.44, 'break-even ROAS');
  near(r.targetRoas, 72 / 15.64, 'target ROAS at 15% margin');
});

test('a thin-margin store can break even but cannot reach a 10% profit target', () => {
  const r = computeBreakEven({ ...base, orderValue: 20, productCost: 12, shippingCost: 6 });
  near(r.contribution, 1.12, 'contribution');
  near(r.breakEvenRoas, 20 / 1.12, 'break-even ROAS');
  assert.equal(r.status, 'profitable');
  assert.equal(r.targetReachable, false);
  assert.equal(r.targetRoas, null);
});

test('an order that loses money before ads reports a loss and no ROAS', () => {
  const r = computeBreakEven({ ...base, orderValue: 20, productCost: 15, shippingCost: 6 });
  assert.ok(r.contribution < 0, 'contribution is negative');
  assert.equal(r.status, 'loss');
  assert.equal(r.breakEvenRoas, null);
  assert.equal(r.breakEvenCpa, null);
  assert.equal(r.targetRoas, null);
});

test('100% returns means every order loses money', () => {
  const r = computeBreakEven({ ...base, returnRatePct: 100, returnCost: 5 });
  assert.equal(r.status, 'loss');
});

test('zero contribution is a loss, never a division by zero', () => {
  const r = computeBreakEven({ ...base, orderValue: 21.5, productCost: 15, shippingCost: 5, feePct: 0, feeFixed: 1.5 });
  near(r.contribution, 0, 'contribution');
  assert.equal(r.status, 'loss');
  assert.equal(r.breakEvenRoas, null);
});

test('readInputs: empty fields count as 0, negatives and percents over 100 are flagged', () => {
  const { values, errors } = readInputs({
    orderValue: '49.90', discountPct: '', productCost: '-3', shippingCost: 'abc',
    feePct: '2.9', feeFixed: '0.3', returnRatePct: '120', returnCost: '0', targetMarginPct: '10'
  });
  assert.equal(values.orderValue, 49.9);
  assert.equal(values.discountPct, 0);
  assert.deepEqual(Object.keys(errors).sort(), ['productCost', 'returnRatePct', 'shippingCost']);
});

test('readInputs accepts a comma as the decimal separator', () => {
  const { values, errors } = readInputs({ ...base, orderValue: '49,90' });
  assert.equal(values.orderValue, 49.9);
  assert.deepEqual(errors, {});
});
