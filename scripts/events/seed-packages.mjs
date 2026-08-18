/**
 * OPTIONAL: create the venue's three stated buffet packages.
 *
 * This is a convenience for a fresh install and is NEVER run automatically —
 * packages are business configuration and belong to the venue. Run it once, or
 * enter the same values in Admin -> Events -> Event Packages.
 *
 * Prices are the ones supplied in the project brief:
 *   Veg      up to 50 -> 600/guest,  above 50 -> 400/guest
 *   Chicken  up to 50 -> 800/guest,  above 50 -> 600/guest
 *   Mutton   up to 50 -> 1000/guest, above 50 -> 800/guest
 *
 * NOTE the pricing policy. With `whole_party` (the default), 51 chicken guests
 * cost LESS in total than 50 — a real pricing cliff. This script therefore asks
 * you to choose explicitly:
 *
 *   node scripts/events/seed-packages.mjs --policy=whole_party
 *   node scripts/events/seed-packages.mjs --policy=progressive
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/events/seed-packages.mjs --policy=progressive
 *   ... --dry-run    show what would be created, write nothing
 */
import Database from '../../lib/db/index.js';
import { listPackages, createPackage } from '../../lib/events/packages.js';
import { priceForGuests } from '../../lib/events/pricing.js';

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : null;
};
const DRY_RUN = process.argv.includes('--dry-run');
const policy = arg('policy');

if (!policy || !['whole_party', 'progressive', 'manual'].includes(policy)) {
  console.error('Choose a pricing policy explicitly:\n' +
    '  --policy=whole_party   every guest pays the tier the total falls into (has a cliff at 50/51)\n' +
    '  --policy=progressive   guests are charged per band, so a bigger party never costs less\n' +
    '  --policy=manual        tiers advisory only; a negotiated rate is set per event');
  process.exit(1);
}

const PACKAGES = [
  { name: 'Veg Buffet', code: 'VEG', description: 'Vegetarian buffet, per guest.', tiers: [600, 400] },
  { name: 'Chicken Buffet', code: 'CHK', description: 'Chicken buffet, per guest.', tiers: [800, 600] },
  { name: 'Mutton Buffet', code: 'MTN', description: 'Mutton buffet, per guest.', tiers: [1000, 800] },
];

const db = Database.getInstance();
const existing = await listPackages(db, { withTiers: false });
const have = new Set(existing.map((p) => String(p.name).toLowerCase()));

let created = 0;
for (const [i, spec] of PACKAGES.entries()) {
  const tiers = [
    { min_guests: 1, max_guests: 50, price_per_guest: spec.tiers[0] },
    { min_guests: 51, max_guests: null, price_per_guest: spec.tiers[1] },
  ];
  const preview = [50, 51, 100].map((g) => {
    const r = priceForGuests({ name: spec.name, pricing_policy: policy }, tiers, g, { policy });
    return `${g} guests = Rs ${r.total.toLocaleString('en-IN')}`;
  }).join('  |  ');
  console.log(`${spec.name.padEnd(16)} ${preview}`);

  if (have.has(spec.name.toLowerCase())) { console.log('  already exists — skipped'); continue; }
  if (DRY_RUN) { console.log('  (dry run — not created)'); continue; }

  await createPackage(db, {
    name: spec.name, code: spec.code, description: spec.description,
    pricing_policy: policy, display_order: i + 1, is_active: true, tiers,
  }, { id: null, full_name: 'seed-packages script' });
  created += 1;
  console.log('  created');
}

console.log(`\n${DRY_RUN ? 'Would create' : 'Created'} ${DRY_RUN ? PACKAGES.length - existing.length : created} package(s) with ${policy} pricing.`);
await Database.close();
