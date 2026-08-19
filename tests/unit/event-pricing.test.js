import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertGuestCount, validateTiers, findTier, priceForGuests,
  detectCliff, previewAllPolicies, sortTiers,
} from '../../lib/events/pricing.js';
import { PRICING_POLICY } from '../../lib/events/constants.js';

/**
 * The venue's stated packages, expressed as configuration exactly as they would
 * be stored — nothing here is hard-coded in application logic.
 */
const CHICKEN = { name: 'Chicken Buffet', pricing_policy: PRICING_POLICY.WHOLE_PARTY };
const CHICKEN_TIERS = [
  { min_guests: 1, max_guests: 50, price_per_guest: 800 },
  { min_guests: 51, max_guests: null, price_per_guest: 600 },
];
const VEG_TIERS = [
  { min_guests: 1, max_guests: 50, price_per_guest: 600 },
  { min_guests: 51, max_guests: null, price_per_guest: 400 },
];
const MUTTON_TIERS = [
  { min_guests: 1, max_guests: 50, price_per_guest: 1000 },
  { min_guests: 51, max_guests: null, price_per_guest: 800 },
];

/* ------------------------------------------------------- guest validation */

test('guest counts must be whole, positive people', () => {
  assert.equal(assertGuestCount(1), 1);
  assert.equal(assertGuestCount('100'), 100);
  for (const bad of [0, -5, 12.5, 'abc', '', null, undefined, NaN]) {
    assert.throws(() => assertGuestCount(bad), (e) => e.status === 400, `${bad} should be rejected`);
  }
});

test('a fractional guest count is rejected with a human message', () => {
  assert.throws(
    () => assertGuestCount(12.5),
    (e) => /whole number of people/.test(e.message) && /12\.5/.test(e.message)
  );
});

/* -------------------------------------------- the spec's exact guest counts */

test('whole-party pricing at 1, 49, 50, 51 and 100 guests', () => {
  const at = (n) => priceForGuests(CHICKEN, CHICKEN_TIERS, n).total;
  assert.equal(at(1), 800);
  assert.equal(at(49), 39200);
  assert.equal(at(50), 40000);
  assert.equal(at(51), 30600);   // the cliff the brief calls out
  assert.equal(at(100), 60000);
});

test('progressive pricing at the same counts always increases', () => {
  const at = (n) => priceForGuests(CHICKEN, CHICKEN_TIERS, n, { policy: PRICING_POLICY.PROGRESSIVE }).total;
  assert.equal(at(1), 800);
  assert.equal(at(49), 39200);
  assert.equal(at(50), 40000);
  assert.equal(at(51), 40600);   // 50×800 + 1×600
  assert.equal(at(100), 70000);  // 50×800 + 50×600
  // Monotonic across the boundary, which is the whole point of the policy.
  for (let n = 1; n < 120; n++) assert.ok(at(n + 1) >= at(n), `progressive dipped at ${n} → ${n + 1}`);
});

test('all three venue packages price correctly under both policies', () => {
  const cases = [
    ['Veg', VEG_TIERS, 50, 30000, 30000],
    ['Veg', VEG_TIERS, 51, 20400, 30400],
    ['Chicken', CHICKEN_TIERS, 50, 40000, 40000],
    ['Chicken', CHICKEN_TIERS, 51, 30600, 40600],
    ['Mutton', MUTTON_TIERS, 50, 50000, 50000],
    ['Mutton', MUTTON_TIERS, 51, 40800, 50800],
  ];
  for (const [name, tiers, guests, whole, progressive] of cases) {
    assert.equal(priceForGuests({ name }, tiers, guests, { policy: PRICING_POLICY.WHOLE_PARTY }).total, whole,
      `${name} whole_party @${guests}`);
    assert.equal(priceForGuests({ name }, tiers, guests, { policy: PRICING_POLICY.PROGRESSIVE }).total, progressive,
      `${name} progressive @${guests}`);
  }
});

/* ------------------------------------------------------------ the cliff */

test('the pricing cliff is detected and quantified for whole-party', () => {
  const cliffs = detectCliff(CHICKEN, CHICKEN_TIERS);
  assert.equal(cliffs.length, 1);
  assert.equal(cliffs[0].at, 50);
  assert.equal(cliffs[0].next, 51);
  assert.equal(cliffs[0].total_at, 40000);
  assert.equal(cliffs[0].total_next, 30600);
  assert.equal(cliffs[0].drop, 9400);
});

test('progressive pricing has no cliff to report', () => {
  assert.deepEqual(detectCliff({ ...CHICKEN, pricing_policy: PRICING_POLICY.PROGRESSIVE }, CHICKEN_TIERS), []);
});

/* ------------------------------------------------------------ manual rate */

test('manual pricing uses the negotiated rate and requires one', () => {
  const r = priceForGuests({ name: 'X', pricing_policy: PRICING_POLICY.MANUAL }, CHICKEN_TIERS, 220, { manualRate: 550 });
  assert.equal(r.total, 121000);
  assert.equal(r.effective_per_guest, 550);
  assert.throws(
    () => priceForGuests({ pricing_policy: PRICING_POLICY.MANUAL }, CHICKEN_TIERS, 100),
    (e) => /negotiated per-guest rate is required/.test(e.message)
  );
});

test("a missing manual rate never falls through to a zero quote", () => {
  // Number(null) is 0, so a null rate once priced the whole event at Rs 0.
  for (const missing of [null, undefined, ""]) {
    assert.throws(
      () => priceForGuests({ pricing_policy: PRICING_POLICY.MANUAL }, CHICKEN_TIERS, 100, { manualRate: missing }),
      (e) => /negotiated per-guest rate is required/.test(e.message),
      `manualRate=${JSON.stringify(missing)} must be refused`
    );
  }
  // An explicit zero is a real decision (a complimentary package) and is kept.
  assert.equal(priceForGuests({ pricing_policy: PRICING_POLICY.MANUAL }, CHICKEN_TIERS, 100, { manualRate: 0 }).total, 0);
  assert.throws(
    () => priceForGuests({ pricing_policy: PRICING_POLICY.MANUAL }, CHICKEN_TIERS, 100, { manualRate: "abc" }),
    (e) => /must be a number/.test(e.message)
  );
});

/* ------------------------------------------------------------ tier shapes */

test('tier bands must not overlap or leave gaps', () => {
  assert.equal(validateTiers(CHICKEN_TIERS).ok, true);

  const overlap = validateTiers([
    { min_guests: 1, max_guests: 50, price_per_guest: 800 },
    { min_guests: 40, max_guests: null, price_per_guest: 600 },
  ]);
  assert.equal(overlap.ok, false);
  assert.match(overlap.problems.join(' '), /overlap/i);

  const gap = validateTiers([
    { min_guests: 1, max_guests: 50, price_per_guest: 800 },
    { min_guests: 60, max_guests: null, price_per_guest: 600 },
  ]);
  assert.equal(gap.ok, false);
  assert.match(gap.problems.join(' '), /between 51 and 59 are not covered/i);
});

test('an open-ended tier must be last, and progressive must start at 1', () => {
  const openMiddle = validateTiers([
    { min_guests: 1, max_guests: null, price_per_guest: 800 },
    { min_guests: 51, max_guests: 100, price_per_guest: 600 },
  ]);
  assert.equal(openMiddle.ok, false);
  assert.match(openMiddle.problems.join(' '), /open-ended tier must be the last/i);

  const notFromOne = validateTiers(
    [{ min_guests: 10, max_guests: null, price_per_guest: 500 }],
    { policy: PRICING_POLICY.PROGRESSIVE }
  );
  assert.equal(notFromOne.ok, false);
  assert.match(notFromOne.problems.join(' '), /must start its first tier at 1/i);
});

test('negative prices and non-integer bands are rejected', () => {
  const r = validateTiers([{ min_guests: 1.5, max_guests: 50, price_per_guest: -10 }]);
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 2);
});

/* ---------------------------------------------------------------- lookups */

test('findTier picks the band containing the count, unbounded top included', () => {
  assert.equal(findTier(CHICKEN_TIERS, 1).price_per_guest, 800);
  assert.equal(findTier(CHICKEN_TIERS, 50).price_per_guest, 800);
  assert.equal(findTier(CHICKEN_TIERS, 51).price_per_guest, 600);
  assert.equal(findTier(CHICKEN_TIERS, 100000).price_per_guest, 600);
});

test('sortTiers orders by lower bound regardless of input order', () => {
  const sorted = sortTiers([CHICKEN_TIERS[1], CHICKEN_TIERS[0]]);
  assert.equal(sorted[0].min_guests, 1);
  assert.equal(sorted[1].min_guests, 51);
});

/* ------------------------------------------------------------- fallbacks */

test('a package with no tiers falls back to its base price', () => {
  const r = priceForGuests({ name: 'Flat', base_price_per_guest: 450 }, [], 30);
  assert.equal(r.total, 13500);
  assert.equal(r.effective_per_guest, 450);
});

test('no tier and no base price is an error, not a silent zero', () => {
  assert.throws(
    () => priceForGuests({ name: 'Broken' }, [], 30),
    (e) => /no price tiers and no base price/.test(e.message)
  );
});

test('a count below the lowest tier falls back to base price and warns', () => {
  const pkg = { name: 'Bulk', base_price_per_guest: 900 };
  const tiers = [{ min_guests: 20, max_guests: null, price_per_guest: 700 }];
  const r = priceForGuests(pkg, tiers, 5);
  assert.equal(r.total, 4500);
  assert.match(r.warnings.join(' '), /No tier covers 5 guests/);
});

test('a package minimum warns without blocking the quote', () => {
  const r = priceForGuests({ name: 'Chicken Buffet', min_guests: 25 }, CHICKEN_TIERS, 10);
  assert.equal(r.total, 8000);
  assert.match(r.warnings.join(' '), /sold from 25 guests/);
});

/* ---------------------------------------------------------------- preview */

test('the preview compares policies side by side and reports the cliff', () => {
  const p = previewAllPolicies(CHICKEN, CHICKEN_TIERS, 51, { manualRate: 500 });
  assert.equal(p.guests, 51);
  assert.equal(p.policies.whole_party.total, 30600);
  assert.equal(p.policies.progressive.total, 40600);
  assert.equal(p.policies.manual.total, 25500);
  assert.equal(p.cliffs.length, 1);
});

test('the preview rejects an impossible guest count outright', () => {
  assert.throws(() => previewAllPolicies(CHICKEN, CHICKEN_TIERS, 0), (e) => e.status === 400);
  assert.throws(() => previewAllPolicies(CHICKEN, CHICKEN_TIERS, 7.5), (e) => e.status === 400);
});

test('breakdown lines explain how a progressive total was reached', () => {
  const r = priceForGuests(CHICKEN, CHICKEN_TIERS, 100, { policy: PRICING_POLICY.PROGRESSIVE });
  assert.equal(r.breakdown.length, 2);
  assert.deepEqual(r.breakdown.map((b) => b.guests), [50, 50]);
  assert.deepEqual(r.breakdown.map((b) => b.price_per_guest), [800, 600]);
  assert.equal(r.breakdown.reduce((s, b) => s + b.amount, 0), r.total);
});

test('a package line charges the tier total, not a rounded rate times the guests', () => {
  // 100 guests at 1200 plus 20 at 1000 is exactly 140,000, but the blended
  // rate is 1,166.666... a head. Multiplying the rounded rate back out gives
  // 140,000.40, and QA saw a 150,000 quotation billed as 150,000.40.
  const tiers = [
    { min_guests: 1, max_guests: 100, price_per_guest: 1200 },
    { min_guests: 101, max_guests: null, price_per_guest: 1000 },
  ];
  const priced = priceForGuests({ pricing_policy: 'progressive', name: 'Buffet' }, tiers, 120);
  assert.equal(priced.total, 140000);
  assert.equal(priced.effective_per_guest, 1166.67);
  assert.notEqual(Math.round(priced.effective_per_guest * 120 * 100) / 100, priced.total,
    'the rounded rate must not reproduce the total — that is the whole point');
  assert.equal(priced.breakdown.reduce((s, b) => s + b.amount, 0), 140000);
});
