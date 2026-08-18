/**
 * Event package pricing.
 *
 * Prices live in event_package_price_tiers — rows, not code. This module only
 * decides how those tiers are APPLIED, and that decision is explicit because
 * the two sensible answers give very different money.
 *
 * Take tiers "1–50 → Rs 800" and "51+ → Rs 600":
 *
 *   whole_party   50 guests → 50 × 800 = 40,000
 *                 51 guests → 51 × 600 = 30,600     ← one extra guest, Rs 9,400 LESS
 *
 *   progressive   50 guests → 50 × 800           = 40,000
 *                 51 guests → 50 × 800 + 1 × 600 = 40,600  ← always increases
 *
 * That whole_party drop is a real pricing cliff, not a rounding artefact. It is
 * a legitimate way to sell ("book 51 and the whole party gets the cheap rate"),
 * but it must be a choice someone made rather than a surprise, so the policy is
 * stored per package and the cliff is reported by `detectCliff()`.
 *
 * Every function here is pure: no database, no clock, no I/O.
 */
import { PRICING_POLICY } from './constants.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};

/**
 * Guest counts are people: whole, positive, and not absurd.
 * Returns the validated integer or throws a message a user can act on.
 */
export function assertGuestCount(value, label = 'Guest count') {
  if (value === '' || value == null) fail(`${label} is required.`);
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${label} must be a number.`);
  if (!Number.isInteger(n)) fail(`${label} must be a whole number of people — you cannot cater for ${n}.`);
  if (n <= 0) fail(`${label} must be at least 1 guest.`);
  if (n > 100000) fail(`${label} of ${n} looks unrealistic.`);
  return n;
}

/** Sort tiers by their lower bound; an unbounded top tier sorts last. */
export function sortTiers(tiers = []) {
  return [...tiers].sort((a, b) => Number(a.min_guests || 0) - Number(b.min_guests || 0));
}

/**
 * Validate a tier set as a whole.
 *
 * Progressive pricing walks the bands in order, so gaps and overlaps are not a
 * style preference — a gap silently drops guests out of the total and an
 * overlap charges them twice. Both are rejected on save.
 */
export function validateTiers(tiers = [], { policy = PRICING_POLICY.WHOLE_PARTY } = {}) {
  const sorted = sortTiers(tiers);
  const problems = [];

  sorted.forEach((t, i) => {
    const min = Number(t.min_guests);
    const max = t.max_guests == null || t.max_guests === '' ? null : Number(t.max_guests);
    const price = Number(t.price_per_guest);

    if (!Number.isInteger(min) || min < 1) problems.push(`Tier ${i + 1}: "from" must be a whole number of 1 or more.`);
    if (max != null && (!Number.isInteger(max) || max < 1)) problems.push(`Tier ${i + 1}: "to" must be a whole number of 1 or more.`);
    if (max != null && max < min) problems.push(`Tier ${i + 1}: "to" (${max}) is below "from" (${min}).`);
    if (!Number.isFinite(price) || price < 0) problems.push(`Tier ${i + 1}: price per guest must be zero or more.`);

    if (i > 0) {
      const prev = sorted[i - 1];
      const prevMax = prev.max_guests == null || prev.max_guests === '' ? null : Number(prev.max_guests);
      if (prevMax == null) {
        problems.push(`Tier ${i}: an open-ended tier must be the last one.`);
      } else if (min <= prevMax) {
        problems.push(`Tier ${i + 1} starts at ${min} but tier ${i} still covers up to ${prevMax} — bands overlap.`);
      } else if (min > prevMax + 1) {
        problems.push(`Guests between ${prevMax + 1} and ${min - 1} are not covered by any tier.`);
      }
    }
  });

  if (policy === PRICING_POLICY.PROGRESSIVE && sorted.length) {
    if (Number(sorted[0].min_guests) !== 1) {
      problems.push('Progressive pricing must start its first tier at 1 guest, or the early guests have no price.');
    }
  }

  return { ok: problems.length === 0, problems, tiers: sorted };
}

/** The tier whose band contains `guests`, or null. */
export function findTier(tiers = [], guests) {
  return sortTiers(tiers).find((t) => {
    const min = Number(t.min_guests || 1);
    const max = t.max_guests == null || t.max_guests === '' ? Infinity : Number(t.max_guests);
    return guests >= min && guests <= max;
  }) || null;
}

/**
 * Price a package for a guest count.
 *
 * @param {object}   pkg          { pricing_policy, base_price_per_guest, min_guests, name }
 * @param {Array}    tiers        event_package_price_tiers rows
 * @param {number}   guests       validated guest count
 * @param {object}   [opts]
 * @param {number}   [opts.manualRate]  required when the policy is `manual`
 * @param {string}   [opts.policy]      override the package's stored policy (preview only)
 * @returns {{policy, guests, total, effective_per_guest, breakdown, warnings}}
 */
export function priceForGuests(pkg = {}, tiers = [], guests, opts = {}) {
  const count = assertGuestCount(guests, 'Guest count');
  const policy = opts.policy || pkg.pricing_policy || PRICING_POLICY.WHOLE_PARTY;
  const warnings = [];

  if (pkg.min_guests != null && count < Number(pkg.min_guests)) {
    warnings.push(`${pkg.name || 'This package'} is sold from ${pkg.min_guests} guests; ${count} is below its minimum.`);
  }

  if (policy === PRICING_POLICY.MANUAL) {
    // A missing rate must never fall through to zero: Number(null) is 0, which
    // would quote the whole event at Rs 0 without anyone noticing.
    if (opts.manualRate == null || opts.manualRate === '') {
      fail('A negotiated per-guest rate is required for manual pricing.');
    }
    const rate = Number(opts.manualRate);
    if (!Number.isFinite(rate) || rate < 0) {
      fail('The negotiated per-guest rate must be a number of zero or more.');
    }
    return {
      policy,
      guests: count,
      total: round2(rate * count),
      effective_per_guest: round2(rate),
      breakdown: [{ label: `${count} × negotiated rate`, guests: count, price_per_guest: round2(rate), amount: round2(rate * count) }],
      warnings,
    };
  }

  const sorted = sortTiers(tiers);
  if (!sorted.length) {
    const base = Number(pkg.base_price_per_guest);
    if (!Number.isFinite(base)) {
      fail(`${pkg.name || 'This package'} has no price tiers and no base price per guest.`);
    }
    return {
      policy,
      guests: count,
      total: round2(base * count),
      effective_per_guest: round2(base),
      breakdown: [{ label: `${count} × base price`, guests: count, price_per_guest: round2(base), amount: round2(base * count) }],
      warnings,
    };
  }

  if (policy === PRICING_POLICY.PROGRESSIVE) {
    // Each band charges only the guests that fall inside it.
    let remaining = count;
    let covered = 0;
    const breakdown = [];
    for (const tier of sorted) {
      if (remaining <= 0) break;
      const min = Number(tier.min_guests || 1);
      const max = tier.max_guests == null || tier.max_guests === '' ? Infinity : Number(tier.max_guests);
      if (count < min) break;
      const bandTop = Math.min(count, max);
      const inBand = bandTop - Math.max(min - 1, covered);
      if (inBand <= 0) continue;
      const price = Number(tier.price_per_guest);
      breakdown.push({
        label: max === Infinity ? `${inBand} guest(s) above ${min - 1}` : `${inBand} guest(s) from ${min}–${max}`,
        guests: inBand,
        price_per_guest: round2(price),
        amount: round2(price * inBand),
      });
      covered += inBand;
      remaining -= inBand;
    }
    if (remaining > 0) {
      warnings.push(`${remaining} guest(s) fall outside every price tier and were not charged.`);
    }
    const total = round2(breakdown.reduce((s, b) => s + b.amount, 0));
    return {
      policy,
      guests: count,
      total,
      effective_per_guest: count ? round2(total / count) : 0,
      breakdown,
      warnings,
    };
  }

  // whole_party: one tier decides the rate for everybody.
  const tier = findTier(sorted, count);
  if (!tier) {
    const base = Number(pkg.base_price_per_guest);
    if (!Number.isFinite(base)) {
      fail(`No price tier covers ${count} guests, and ${pkg.name || 'this package'} has no base price per guest.`);
    }
    warnings.push(`No tier covers ${count} guests — the package base price was used.`);
    return {
      policy,
      guests: count,
      total: round2(base * count),
      effective_per_guest: round2(base),
      breakdown: [{ label: `${count} × base price`, guests: count, price_per_guest: round2(base), amount: round2(base * count) }],
      warnings,
    };
  }
  const price = Number(tier.price_per_guest);
  return {
    policy,
    guests: count,
    total: round2(price * count),
    effective_per_guest: round2(price),
    breakdown: [{
      label: `${count} × ${tier.max_guests == null ? `${tier.min_guests}+ tier` : `${tier.min_guests}–${tier.max_guests} tier`}`,
      guests: count,
      price_per_guest: round2(price),
      amount: round2(price * count),
    }],
    warnings,
  };
}

/**
 * Find guest counts where adding ONE more guest makes the party cheaper.
 *
 * Only whole_party can do this. Reported so a manager sees the cliff before
 * quoting, rather than discovering it when a client counts to 51.
 */
export function detectCliff(pkg = {}, tiers = []) {
  const sorted = sortTiers(tiers);
  if (!sorted.length) return [];
  const policy = pkg.pricing_policy || PRICING_POLICY.WHOLE_PARTY;
  if (policy !== PRICING_POLICY.WHOLE_PARTY) return [];

  const cliffs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const boundary = sorted[i].max_guests;
    if (boundary == null || boundary === '') continue;
    const at = Number(boundary);
    const next = at + 1;
    try {
      const before = priceForGuests(pkg, sorted, at, { policy: PRICING_POLICY.WHOLE_PARTY });
      const after = priceForGuests(pkg, sorted, next, { policy: PRICING_POLICY.WHOLE_PARTY });
      if (after.total < before.total) {
        cliffs.push({
          at,
          next,
          total_at: before.total,
          total_next: after.total,
          drop: round2(before.total - after.total),
          message: `${at} guests cost ${before.total.toLocaleString('en-IN')}, but ${next} guests cost only ${after.total.toLocaleString('en-IN')} — Rs ${round2(before.total - after.total).toLocaleString('en-IN')} less for one more guest.`,
        });
      }
    } catch {
      // A tier set too broken to price is reported by validateTiers instead.
    }
  }
  return cliffs;
}

/**
 * Side-by-side preview across every policy, for the calculator UI.
 * `manualRate` is only used for the manual row.
 */
export function previewAllPolicies(pkg = {}, tiers = [], guests, { manualRate = null } = {}) {
  const count = assertGuestCount(guests, 'Guest count');
  const out = {};
  for (const policy of [PRICING_POLICY.WHOLE_PARTY, PRICING_POLICY.PROGRESSIVE]) {
    try {
      out[policy] = priceForGuests(pkg, tiers, count, { policy });
    } catch (err) {
      out[policy] = { error: err.message };
    }
  }
  if (manualRate != null && manualRate !== '') {
    try {
      out[PRICING_POLICY.MANUAL] = priceForGuests(pkg, tiers, count, {
        policy: PRICING_POLICY.MANUAL,
        manualRate,
      });
    } catch (err) {
      out[PRICING_POLICY.MANUAL] = { error: err.message };
    }
  }
  return { guests: count, policies: out, cliffs: detectCliff(pkg, tiers) };
}
