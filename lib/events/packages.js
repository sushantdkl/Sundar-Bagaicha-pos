/**
 * Event package configuration.
 *
 * A package is a per-guest catering offer (veg / chicken / mutton buffet, ...).
 * Its prices live in event_package_price_tiers and its pricing policy is stored
 * explicitly — see lib/events/pricing.js for why that choice matters.
 *
 * Nothing here is seeded: packages, tiers and prices are all entered by the
 * venue. `scripts/events/seed-packages.mjs` exists as an opt-in convenience for
 * a fresh install and is never run automatically.
 */
import { ensureEventsSchema } from './schema.js';
import { toId } from './ids.js';
import { logEventAudit } from './audit.js';
import { EVENT_AUDIT_ACTION, PRICING_POLICIES, PRICING_POLICY } from './constants.js';
import { validateTiers, detectCliff, priceForGuests, previewAllPolicies } from './pricing.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};

const cleanText = (value, max = 1000) => {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : null;
};

function parseOptionalInt(value, label, { min = 0 } = {}) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${label} must be a number.`);
  if (!Number.isInteger(n)) fail(`${label} must be a whole number.`);
  if (n < min) fail(`${label} cannot be less than ${min}.`);
  return n;
}

function parseOptionalMoney(value, label) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${label} must be a number.`);
  if (n < 0) fail(`${label} cannot be negative.`);
  return Math.round(n * 100) / 100;
}

function validatePackageFields(data, { partial = false } = {}) {
  const out = {};
  if (!partial || data.name !== undefined) {
    const name = cleanText(data.name, 120);
    if (!name) fail('Enter a name for the package.');
    out.name = name;
  }
  if (data.code !== undefined) out.code = cleanText(data.code, 40);
  if (data.description !== undefined) out.description = cleanText(data.description);
  if (data.pricing_policy !== undefined) {
    if (!PRICING_POLICIES.includes(data.pricing_policy)) {
      fail(`Pricing policy must be one of: ${PRICING_POLICIES.join(', ')}.`);
    }
    out.pricing_policy = data.pricing_policy;
  }
  if (data.base_price_per_guest !== undefined) {
    out.base_price_per_guest = parseOptionalMoney(data.base_price_per_guest, 'Base price per guest');
  }
  if (data.min_guests !== undefined) out.min_guests = parseOptionalInt(data.min_guests, 'Minimum guests');
  if (data.display_order !== undefined) out.display_order = parseOptionalInt(data.display_order, 'Display order') ?? 0;
  if (data.is_active !== undefined) out.is_active = data.is_active ? 1 : 0;
  return out;
}

/* ------------------------------------------------------------------ reads */

export async function listPackages(db, { activeOnly = false, withTiers = true } = {}) {
  await ensureEventsSchema(db);
  const rows = await db.all(
    `SELECT * FROM event_packages ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY display_order, name`
  );
  if (!withTiers || !rows.length) return rows;

  const tiers = await db.all(
    `SELECT * FROM event_package_price_tiers ORDER BY package_id, min_guests`
  );
  const byPackage = new Map();
  for (const t of tiers) {
    const list = byPackage.get(Number(t.package_id)) || [];
    list.push(t);
    byPackage.set(Number(t.package_id), list);
  }
  return rows.map((p) => {
    const list = byPackage.get(Number(p.id)) || [];
    return { ...p, tiers: list, cliffs: detectCliff(p, list) };
  });
}

export async function getPackage(db, id) {
  await ensureEventsSchema(db);
  const pkg = await db.get('SELECT * FROM event_packages WHERE id = ?', [toId(id, 'package')]);
  if (!pkg) fail('Event package not found.', 404);
  const tiers = await db.all(
    'SELECT * FROM event_package_price_tiers WHERE package_id = ? ORDER BY min_guests',
    [pkg.id]
  );
  return { ...pkg, tiers, cliffs: detectCliff(pkg, tiers) };
}

/* ----------------------------------------------------------------- writes */

/** Tiers are replaced wholesale — the editor always submits the complete set. */
async function replaceTiers(tx, packageId, tiers = []) {
  await tx.run('DELETE FROM event_package_price_tiers WHERE package_id = ?', [packageId]);
  const sorted = [...tiers].sort((a, b) => Number(a.min_guests) - Number(b.min_guests));
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    await tx.run(
      `INSERT INTO event_package_price_tiers
         (package_id, min_guests, max_guests, price_per_guest, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [
        packageId,
        Number(t.min_guests),
        t.max_guests == null || t.max_guests === '' ? null : Number(t.max_guests),
        Number(t.price_per_guest),
        i,
      ]
    );
  }
}

/** Shared guard: a package must be priceable by something. */
function assertPriceable(pkg, tiers) {
  const policy = pkg.pricing_policy || PRICING_POLICY.WHOLE_PARTY;
  if (policy === PRICING_POLICY.MANUAL) return;
  if (!tiers.length && pkg.base_price_per_guest == null) {
    fail('Add at least one price tier, or a base price per guest.');
  }
  const check = validateTiers(tiers, { policy });
  if (!check.ok) fail(check.problems[0], 400, { code: 'invalid_tiers', problems: check.problems });
}

export async function createPackage(db, data = {}, actor = {}) {
  await ensureEventsSchema(db);
  const fields = validatePackageFields(data);
  const tiers = Array.isArray(data.tiers) ? data.tiers : [];
  assertPriceable(fields, tiers);

  const clash = await db.get('SELECT id FROM event_packages WHERE LOWER(name) = LOWER(?)', [fields.name]);
  if (clash) fail('A package with that name already exists.', 409);

  const id = await db.transaction(async (tx) => {
    const res = await tx.run(
      `INSERT INTO event_packages
         (name, code, description, pricing_policy, base_price_per_guest, min_guests,
          is_active, display_order, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        fields.name,
        fields.code ?? null,
        fields.description ?? null,
        fields.pricing_policy || PRICING_POLICY.WHOLE_PARTY,
        fields.base_price_per_guest ?? null,
        fields.min_guests ?? null,
        fields.is_active === 0 ? 0 : 1,
        fields.display_order ?? 0,
        actor.id || null,
      ]
    );
    const newId = res.lastInsertRowid;
    await replaceTiers(tx, newId, tiers);
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.PACKAGE_CONFIG_CHANGED,
      entityType: 'package',
      entityId: newId,
      actor,
      next: { ...fields, tiers },
      detail: 'created',
    });
    return newId;
  });

  return getPackage(db, id);
}

const UPDATABLE = [
  'name', 'code', 'description', 'pricing_policy',
  'base_price_per_guest', 'min_guests', 'is_active', 'display_order',
];

export async function updatePackage(db, id, data = {}, actor = {}) {
  const existing = await getPackage(db, id);
  const fields = validatePackageFields(data, { partial: true });
  const tiers = Array.isArray(data.tiers) ? data.tiers : existing.tiers;
  assertPriceable({ ...existing, ...fields }, tiers);

  if (fields.name && fields.name.toLowerCase() !== String(existing.name).toLowerCase()) {
    const clash = await db.get(
      'SELECT id FROM event_packages WHERE LOWER(name) = LOWER(?) AND id != ?',
      [fields.name, existing.id]
    );
    if (clash) fail('A package with that name already exists.', 409);
  }

  const sets = [];
  const params = [];
  for (const key of UPDATABLE) {
    if (fields[key] === undefined) continue;
    sets.push(`${key} = ?`);
    params.push(fields[key]);
  }

  await db.transaction(async (tx) => {
    if (sets.length) {
      await tx.run(
        `UPDATE event_packages SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...params, existing.id]
      );
    }
    if (Array.isArray(data.tiers)) await replaceTiers(tx, existing.id, tiers);

    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.PACKAGE_CONFIG_CHANGED,
      entityType: 'package',
      entityId: existing.id,
      actor,
      previous: {
        ...Object.fromEntries(Object.keys(fields).map((k) => [k, existing[k]])),
        ...(Array.isArray(data.tiers) ? { tiers: existing.tiers } : {}),
      },
      next: { ...fields, ...(Array.isArray(data.tiers) ? { tiers } : {}) },
    });
  });

  return getPackage(db, existing.id);
}

/**
 * Packages are deactivated, not deleted: quoted events reference them, and a
 * confirmed quotation must keep meaning what it meant when it was signed.
 */
export async function deactivatePackage(db, id, actor = {}) {
  return updatePackage(db, id, { is_active: 0 }, actor);
}

/* --------------------------------------------------------------- preview */

/**
 * Price calculator used before saving. Accepts either a stored package id or an
 * unsaved draft, so the editor can preview tiers that do not exist yet.
 */
export async function previewPackagePrice(db, {
  packageId = null, draft = null, guests, manualRate = null, policy = null,
}) {
  await ensureEventsSchema(db);
  let pkg;
  let tiers;

  if (draft) {
    pkg = validatePackageFields({ name: draft.name || 'Draft package', ...draft }, { partial: true });
    pkg.name = draft.name || 'Draft package';
    tiers = Array.isArray(draft.tiers) ? draft.tiers : [];
    const check = validateTiers(tiers, { policy: policy || pkg.pricing_policy || PRICING_POLICY.WHOLE_PARTY });
    if (!check.ok) fail(check.problems[0], 400, { code: 'invalid_tiers', problems: check.problems });
  } else {
    const stored = await getPackage(db, packageId);
    pkg = stored;
    tiers = stored.tiers;
  }

  const preview = previewAllPolicies(pkg, tiers, guests, { manualRate });
  const selected = priceForGuests(pkg, tiers, guests, {
    policy: policy || pkg.pricing_policy,
    manualRate,
  });
  return { package: { name: pkg.name, pricing_policy: pkg.pricing_policy, min_guests: pkg.min_guests }, selected, ...preview };
}
