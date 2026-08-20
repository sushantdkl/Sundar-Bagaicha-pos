/**
 * Quotation and Banquet Event Order (BEO).
 *
 * Three audiences, one event:
 *
 *   customer   the quotation — prices, terms, what they are buying
 *   internal   operations — timeline, setup, staffing, vendors, and prices
 *   kitchen    production — dishes and counts, deliberately WITHOUT prices
 *
 * The kitchen copy hides money on purpose: a printed sheet on a pass is the
 * least controlled document in the building, and food cost is not the line
 * cooks' business.
 *
 * This module only assembles and snapshots data. Rendering is the caller's job
 * (the print route builds HTML with the existing thermal/A4 print helpers).
 *
 * Revisions are append-only. Finalised BEO data is never overwritten: a new
 * revision is stored and the previous one stays readable, because "which
 * version did the client sign" has to be answerable months later.
 */
import { ensureEventsSchema } from './schema.js';
import { toId } from './ids.js';
import { logEventAudit } from './audit.js';
import { EVENT_AUDIT_ACTION } from './constants.js';
import { listLines } from './lines.js';
import { getBillablePolicy, explainBillable, packageAllocation } from './guests.js';
import { RESTAURANT } from '../restaurant-info.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const BEO_AUDIENCE = { CUSTOMER: 'customer', INTERNAL: 'internal', KITCHEN: 'kitchen' };
export const BEO_AUDIENCES = Object.values(BEO_AUDIENCE);

/** Lines the kitchen needs to cook; everything else is commercial noise. */
const KITCHEN_LINE_TYPES = new Set(['package', 'menu_item', 'custom_food', 'beverage', 'complimentary']);

/**
 * Business identity for the document header.
 * Live settings win over the build-time defaults so a rebranded venue prints
 * correctly without a redeploy.
 */
async function businessHeader(db) {
  const keys = ['restaurant_name', 'restaurant_address', 'restaurant_phone', 'restaurant_email',
    'vat_number', 'pan_number', 'receipt_footer'];
  let settings = {};
  try {
    const rows = await db.all(
      `SELECT setting_key, setting_value FROM system_settings
        WHERE setting_key IN (${keys.map(() => '?').join(',')})`,
      keys
    );
    settings = Object.fromEntries((rows || []).map((r) => [r.setting_key, r.setting_value]));
  } catch {
    // A bare database still prints, using the build-time identity.
  }
  return {
    name: settings.restaurant_name || RESTAURANT.name,
    address: settings.restaurant_address || RESTAURANT.address.full,
    phone: settings.restaurant_phone || RESTAURANT.phoneDisplay,
    email: settings.restaurant_email || RESTAURANT.email,
    vat_number: settings.vat_number || '',
    pan_number: settings.pan_number || '',
    footer: settings.receipt_footer || '',
  };
}

/**
 * Default terms. Stored per event once a BEO is issued, so a later change to
 * the venue's standard terms cannot rewrite what a client already agreed.
 */
export const DEFAULT_TERMS = [
  'A confirmed booking requires the agreed deposit. Dates are held only once it is received.',
  'The guaranteed guest count is due seven days before the event and is the minimum charged.',
  'Final attendance above the guaranteed count is charged at the same per-guest rate.',
  'Menu changes within 72 hours of the event may not be possible.',
  'Prices are quoted in NPR and include only the taxes and charges shown.',
];
export const DEFAULT_CANCELLATION_TERMS = [
  'More than 30 days before the event: the deposit is transferable to another date.',
  'Between 7 and 30 days: the deposit is retained.',
  'Less than 7 days: the full guaranteed amount is payable.',
];

/**
 * Assemble everything a BEO needs. `audience` decides what is included —
 * pricing is stripped for the kitchen copy rather than merely hidden in CSS.
 */
export async function buildBeo(db, eventId, { audience = BEO_AUDIENCE.CUSTOMER } = {}) {
  if (!BEO_AUDIENCES.includes(audience)) {
    fail(`Audience must be one of: ${BEO_AUDIENCES.join(', ')}.`);
  }
  await ensureEventsSchema(db);

  const event = await db.get(
    `SELECT e.*, s.name AS space_name, s.description AS space_description,
            s.setup_buffer_minutes, s.cleanup_buffer_minutes,
            c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email
       FROM events e
       LEFT JOIN event_spaces s ON s.id = e.space_id
       LEFT JOIN customers c ON c.id = e.customer_id
      WHERE e.id = ?`,
    [toId(eventId, 'event')]
  );
  if (!event) fail('Event not found.', 404);

  const [lines, policy] = await Promise.all([listLines(db, event.id), getBillablePolicy(db)]);
  const allocation = await packageAllocation(db, event.id);
  const billable = explainBillable(event, policy);
  const business = await businessHeader(db);

  const showPrices = audience !== BEO_AUDIENCE.KITCHEN;
  const visibleLines = audience === BEO_AUDIENCE.KITCHEN
    ? lines.filter((l) => KITCHEN_LINE_TYPES.has(l.line_type))
    : lines;

  const documentLines = visibleLines.map((l) => {
    const base = {
      id: l.id,
      type: l.line_type,
      name: l.item_name,
      description: l.description,
      quantity: Number(l.quantity),
      complimentary: l.is_complimentary === 1,
    };
    if (!showPrices) return base;
    return {
      ...base,
      unit_price: round2(l.unit_price),
      list_price: l.list_price == null ? null : round2(l.list_price),
      line_total: round2(l.line_total),
      price_overridden: l.price_overridden === 1,
    };
  });

  const deposits = await db.all(
    `SELECT received_on, amount, payment_method, reference_number, entry_type
       FROM event_deposits WHERE event_id = ? AND status = 'active'
      ORDER BY received_on, id`,
    [event.id]
  );

  const doc = {
    audience,
    generated_at: new Date().toISOString(),
    revision: Number(event.revision_number || 1),
    business,
    event: {
      event_number: event.event_number,
      title: event.title,
      event_type: event.event_type,
      status: event.status,
      event_date: event.event_date,
      end_date: event.end_date,
      start_time: event.start_time,
      end_time: event.end_time,
      space: event.space_name,
      space_description: event.space_description,
      setup_from: event.setup_buffer_minutes ? `${event.setup_buffer_minutes} minutes before` : null,
      cleanup_until: event.cleanup_buffer_minutes ? `${event.cleanup_buffer_minutes} minutes after` : null,
    },
    client: {
      name: event.customer_name || event.contact_name,
      phone: event.contact_phone || event.customer_phone,
      email: event.contact_email || event.customer_email,
    },
    guests: {
      expected: event.expected_guests,
      guaranteed: event.guaranteed_guests,
      actual: event.actual_guests,
      billable: billable.billable_guests,
      basis: billable.basis,
      allocation: allocation.lines,
      allocation_warnings: allocation.warnings,
    },
    lines: documentLines,
    notes: {
      client: event.notes,
      // Internal and kitchen copies carry the internal note; the client's does not.
      internal: audience === BEO_AUDIENCE.CUSTOMER ? null : event.internal_notes,
    },
  };

  if (showPrices) {
    doc.totals = {
      subtotal: round2(event.subtotal),
      discount: round2(event.discount_amount),
      discount_reason: event.discount_reason,
      service_charge_percent: Number(event.service_charge_percent || 0),
      service_charge: round2(event.service_charge_amount),
      tax_percent: Number(event.tax_percent || 0),
      tax: round2(event.tax_amount),
      total: round2(event.total_amount),
      deposits_received: round2(event.deposit_total),
      outstanding: round2(event.outstanding_amount),
    };
    doc.payments = deposits.map((d) => ({
      date: d.received_on,
      amount: round2(d.entry_type === 'refund' ? -d.amount : d.amount),
      method: d.payment_method,
      reference: d.reference_number,
      type: d.entry_type,
    }));
    doc.terms = DEFAULT_TERMS;
    doc.cancellation_terms = DEFAULT_CANCELLATION_TERMS;
  }

  if (audience !== BEO_AUDIENCE.CUSTOMER) {
    const tasks = await db.all(
      `SELECT title, description, category, due_at, status FROM event_tasks
        WHERE event_id = ? ORDER BY sort_order, id`,
      [event.id]
    );
    doc.operations = {
      tasks,
      timeline: [
        event.start_time && { at: event.start_time, what: 'Guests arrive / event starts' },
        event.end_time && { at: event.end_time, what: 'Event ends' },
      ].filter(Boolean),
    };
  }

  return doc;
}

/**
 * Issue a revision.
 *
 * The full document is snapshotted into event_audit as the new value, so the
 * exact content of revision 2 survives even after revision 3 changes it. The
 * event's revision_number is bumped in the same transaction.
 */
export async function issueRevision(db, eventId, { audience = BEO_AUDIENCE.CUSTOMER, reason = null, final = false } = {}, actor = {}) {
  const doc = await buildBeo(db, eventId, { audience });
  const event = await db.get('SELECT id, revision_number FROM events WHERE id = ?', [toId(eventId, 'event')]);
  const nextRevision = Number(event.revision_number || 1) + 1;

  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE events SET revision_number = ?,
         quoted_at = CASE WHEN ? = 'customer' THEN COALESCE(quoted_at, CURRENT_TIMESTAMP) ELSE quoted_at END,
         updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [nextRevision, audience, actor.id || null, event.id]
    );
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.BEO_REVISED,
      eventId: event.id,
      entityType: 'beo',
      entityId: event.id,
      actor,
      reason,
      previous: { revision: Number(event.revision_number || 1) },
      next: { revision: nextRevision, final: Boolean(final), audience },
      // The snapshot is what makes this append-only rather than a counter.
      detail: doc,
    });
  });

  return { ...doc, revision: nextRevision, final: Boolean(final) };
}

/** Every revision ever issued, newest first, with its snapshot intact. */
export async function revisionHistory(db, eventId, { limit = 25 } = {}) {
  await ensureEventsSchema(db);
  const capped = Math.min(100, Math.max(1, Number(limit) || 25));
  const rows = await db.all(
    `SELECT id, actor_name, reason, previous_value, new_value, detail, created_at
       FROM event_audit
      WHERE event_id = ? AND action = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ${capped}`,
    [toId(eventId, 'event'), EVENT_AUDIT_ACTION.BEO_REVISED]
  );
  return rows.map((r) => {
    let snapshot = null;
    try { snapshot = r.detail ? JSON.parse(r.detail) : null; } catch { snapshot = null; }
    let next = {};
    try { next = r.new_value ? JSON.parse(r.new_value) : {}; } catch { next = {}; }
    return {
      id: r.id,
      revision: next.revision ?? null,
      final: Boolean(next.final),
      audience: next.audience ?? null,
      issued_by: r.actor_name,
      reason: r.reason,
      issued_at: r.created_at,
      snapshot,
    };
  });
}
