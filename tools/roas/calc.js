// Break-even ROAS / CPA maths for an online store.
// Runs in the browser (inlined by scripts/build.mjs, exposed as window.RoasCalc) and in Node (tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RoasCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PERCENT = 100;
  const PERCENT_FIELDS = ['discountPct', 'feePct', 'returnRatePct', 'targetMarginPct'];
  const FIELDS = [
    'orderValue', 'discountPct', 'productCost', 'shippingCost',
    'feePct', 'feeFixed', 'returnRatePct', 'returnCost', 'targetMarginPct'
  ];

  // One raw field → a number, or an error key. Empty counts as 0; a comma decimal is accepted.
  function parseField(name, raw) {
    const text = String(raw ?? '').trim().replace(',', '.');
    if (text === '') return { value: 0 };
    const value = Number(text);
    if (!Number.isFinite(value)) return { error: 'notANumber' };
    if (value < 0) return { error: 'negative' };
    if (PERCENT_FIELDS.includes(name) && value > PERCENT) return { error: 'overHundred' };
    return { value };
  }

  function readInputs(raw) {
    const values = {};
    const errors = {};
    for (const name of FIELDS) {
      const { value, error } = parseField(name, raw[name]);
      if (error) errors[name] = error;
      else values[name] = value;
    }
    return { values, errors };
  }

  // Returned orders are refunded in full and the product goes back on the shelf;
  // the store still paid outbound shipping, the payment fee and the return label.
  function contributionPerOrder(v) {
    const price = v.orderValue * (1 - v.discountPct / PERCENT);
    const fee = price * (v.feePct / PERCENT) + v.feeFixed;
    const returnRate = v.returnRatePct / PERCENT;
    const contribution =
      (1 - returnRate) * (price - v.productCost) - v.shippingCost - fee - returnRate * v.returnCost;
    return { price, fee, contribution };
  }

  // ROAS needed to keep `marginShare` of revenue as profit after ads, or null if out of reach.
  function roasFor(price, contribution, marginShare) {
    const spendable = contribution - marginShare * price;
    return spendable > 0 ? price / spendable : null;
  }

  function computeBreakEven(v) {
    const { price, fee, contribution } = contributionPerOrder(v);
    if (!(contribution > 0)) {
      return { price, fee, contribution, status: 'loss',
        breakEvenCpa: null, breakEvenRoas: null, targetRoas: null, targetReachable: false };
    }
    const targetRoas = roasFor(price, contribution, v.targetMarginPct / PERCENT);
    return { price, fee, contribution, status: 'profitable',
      breakEvenCpa: contribution, breakEvenRoas: price / contribution,
      targetRoas, targetReachable: targetRoas !== null };
  }

  return { FIELDS, readInputs, computeBreakEven };
});
