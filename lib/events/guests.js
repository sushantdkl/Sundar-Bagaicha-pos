/**
 * Guest counts.
 *
 * A banquet tracks four different numbers and they are genuinely different:
 *
 *   expected     what the client thinks will come, early and soft
 *   guaranteed   the minimum the client contracts to PAY for
 *   actual       who actually turned up
 *   billable     what the invoice is calculated on
 *
 * The billable rule is configuration, not code. The industry default is
 * MAX(guaranteed, actual) — the client pays for what they guaranteed even if
 * fewer came, and pays for extras if more came — but a venue may run
 * guaranteed-only or actual-only, so the policy is a setting.
 *
 * Once an event is committed, every change to a guest count is written to the
 * audit trail with its old and new value. Guest counts drive the money, so
 * "who changed 220 to 180, and when" has to be answerable.
 */
import { ensureEventsSchema } from './schema.js';
import { logEventAudit } from './audit.js';
import { EVENT_AUDIT_ACTION, COMMITTED_STATUSES, TERMINAL_STATUSES } from './constants.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};

export const BILLABLE_POLICY = {
  MAX_GUARANTEED_ACTUAL: 'max_guaranteed_actual',
  GUARANTEED_ONLY: 'guaranteed_only',
  ACTUAL_ONLY: 'actual_only',
  EXPECTED_ONLY: 'expected_only',
};
export const BILLABLE_POLICIES = Object.values(BILLABLE_POLICY);

export const BILLABLE_POLICY_LABEL = {
  max_guaranteed_actual: 'Higher of guaranteed and actual (industry default)',
  guaranteed_only: 'Guaranteed count only',
  actual_only: 'Actual attendance only',
  expected_only: 'Expected count only',
};

export const SETTING_KEY = 'events_billable_guest_policy';
const DEFAULT_POLICY = BILLABLE_POLICY.MAX_GUARANTEED_ACTUAL;

/** Read the venue's billable-guest policy from settings. */
export async function getBillablePolicy(db) {
  try {
    const row = await db.get(
      'SELECT setting_value FROM system_settings WHERE setting_key = ?',
      [SETTING_KEY]
    );
    const value = row?.setting_value;
    return BILLABLE_POLICIES.includes(value) ? value : DEFAULT_POLICY;
  } catch {
    // Settings table missing on a bare dev database — the default still applies.
    return DEFAULT_POLICY;
  }
}

export async function setBillablePolicy(db, policy, actor = {}) {
  if (!BILLABLE_POLICIES.includes(policy)) {
    fail(`Billable guest policy must be one of: ${BILLABLE_POLICIES.join(', ')}.`);
  }
  const previous = await getBillablePolicy(db);
  await db.transaction(async (tx) => {
    const existing = await tx.get(
      'SELECT id FROM system_settings WHERE setting_key = ?', [SETTING_KEY]
    );
    if (existing) {
      await tx.run(
        'UPDATE system_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
        [policy, SETTING_KEY]
      );
    } else {
      await tx.run(
        'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
        [SETTING_KEY, policy]
      );
    }
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.PACKAGE_CONFIG_CHANGED,
      entityType: 'settings',
      actor,
      previous: { billable_guest_policy: previous },
      next: { billable_guest_policy: policy },
      detail: 'billable guest policy changed',
    });
  });
  return policy;
}

/**
 * Resolve the billable head count under a policy.
 *
 * Returns null when the policy's inputs are all absent — an unknown billable
 * count must stay unknown rather than defaulting to zero and invoicing nothing.
 */
export function billableGuests(event = {}, policy = DEFAULT_POLICY) {
  const expected = event.expected_guests == null ? null : Number(event.expected_guests);
  const guaranteed = event.guaranteed_guests == null ? null : Number(event.guaranteed_guests);
  const actual = event.actual_guests == null ? null : Number(event.actual_guests);

  switch (policy) {
    case BILLABLE_POLICY.GUARANTEED_ONLY:
      return guaranteed;
    case BILLABLE_POLICY.ACTUAL_ONLY:
      return actual;
    case BILLABLE_POLICY.EXPECTED_ONLY:
      return expected;
    case BILLABLE_POLICY.MAX_GUARANTEED_ACTUAL:
    default: {
      const candidates = [guaranteed, actual].filter((n) => n != null);
      if (candidates.length) return Math.max(...candidates);
      // Before either is set, the expected count is the only estimate there is.
      return expected;
    }
  }
}

/** Explain the resolved number, for the UI and the BEO. */
export function explainBillable(event = {}, policy = DEFAULT_POLICY) {
  const value = billableGuests(event, policy);
  const parts = {
    expected: event.expected_guests ?? null,
    guaranteed: event.guaranteed_guests ?? null,
    actual: event.actual_guests ?? null,
  };
  let basis;
  if (value == null) basis = 'No guest count has been entered yet.';
  else if (policy === BILLABLE_POLICY.MAX_GUARANTEED_ACTUAL) {
    if (parts.guaranteed != null && parts.actual != null) {
      basis = parts.actual > parts.guaranteed
        ? `${parts.actual} attended, above the ${parts.guaranteed} guaranteed.`
        : `${parts.guaranteed} guaranteed, at or above the ${parts.actual} who attended.`;
    } else if (parts.guaranteed != null) basis = `${parts.guaranteed} guaranteed; attendance not recorded yet.`;
    else if (parts.actual != null) basis = `${parts.actual} attended; no guarantee was given.`;
    else basis = `${parts.expected} expected; no guarantee or attendance yet.`;
  } else {
    basis = `${BILLABLE_POLICY_LABEL[policy]}.`;
  }
  return { policy, policy_label: BILLABLE_POLICY_LABEL[policy], billable_guests: value, basis, ...parts };
}

/**
 * Compare the guests allocated across package lines with the event head count.
 *
 * A 100-guest wedding split 15 veg / 65 chicken / 20 mutton adds to 100 and is
 * fine. 15/65/30 adds to 110 and is not — but it may be deliberate (some guests
 * take two plates), so this reports rather than blocks. Phase 14 decides what
 * to do about it at billing time.
 */
export async function packageAllocation(db, eventId) {
  await ensureEventsSchema(db);
  const event = await db.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) fail('Event not found.', 404);

  const rows = await db.all(
    `SELECT l.id, l.item_name, l.quantity, l.package_id, p.name AS package_name
       FROM event_menu_lines l
       LEFT JOIN event_packages p ON p.id = l.package_id
      WHERE l.event_id = ? AND l.line_type = 'package'
      ORDER BY l.sort_order, l.id`,
    [event.id]
  );

  const policy = await getBillablePolicy(db);
  const billable = billableGuests(event, policy);
  const allocated = rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0);

  const warnings = [];
  if (billable != null && rows.length) {
    if (allocated > billable) {
      warnings.push({
        type: 'over_allocated',
        message: `Packages cover ${allocated} guests but only ${billable} are billable — ${allocated - billable} more plates than heads.`,
      });
    } else if (allocated < billable) {
      warnings.push({
        type: 'under_allocated',
        message: `Packages cover ${allocated} guests but ${billable} are billable — ${billable - allocated} guests have no package.`,
      });
    }
  }

  return {
    event_id: event.id,
    billable_guests: billable,
    allocated_guests: allocated,
    balanced: warnings.length === 0,
    lines: rows.map((r) => ({
      line_id: r.id,
      package_id: r.package_id,
      name: r.package_name || r.item_name,
      guests: Number(r.quantity || 0),
    })),
    warnings,
  };
}

/**
 * Update guest counts with an audit entry per changed field.
 *
 * `finalize` marks the guaranteed count as contractually fixed — the number the
 * kitchen cooks to and the invoice is built on.
 */
export async function updateGuestCounts(db, eventId, data = {}, actor = {}) {
  await ensureEventsSchema(db);
  const event = await db.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) fail('Event not found.', 404);
  if (TERMINAL_STATUSES.includes(event.status)) {
    fail(`A ${event.status.toLowerCase()} event's guest counts can no longer be changed.`, 409);
  }

  const fields = {};
  for (const key of ['expected_guests', 'guaranteed_guests', 'actual_guests']) {
    if (data[key] === undefined) continue;
    if (data[key] === null || data[key] === '') { fields[key] = null; continue; }
    const n = Number(data[key]);
    if (!Number.isInteger(n)) fail(`${key.replace(/_/g, ' ')} must be a whole number of people.`);
    if (n < 0) fail(`${key.replace(/_/g, ' ')} cannot be negative.`);
    if (n > 100000) fail(`${key.replace(/_/g, ' ')} looks unrealistic.`);
    fields[key] = n;
  }
  if (!Object.keys(fields).length && !data.finalize) {
    fail('No guest counts were supplied.');
  }

  // Changing a contracted number after commitment is a decision, not a typo fix.
  const committed = COMMITTED_STATUSES.includes(event.status);
  const changingGuarantee = fields.guaranteed_guests !== undefined
    && Number(fields.guaranteed_guests ?? -1) !== Number(event.guaranteed_guests ?? -1);
  const reason = String(data.reason || '').trim();
  if (committed && changingGuarantee && !reason) {
    fail('A reason is required to change the guaranteed guest count on a committed event.', 400, {
      code: 'guest_change_reason_required',
    });
  }

  await db.transaction(async (tx) => {
    const sets = Object.keys(fields).map((k) => `${k} = ?`);
    const params = Object.values(fields);
    if (data.finalize) {
      sets.push('finalized_at = COALESCE(finalized_at, CURRENT_TIMESTAMP)');
    }
    if (sets.length) {
      await tx.run(
        `UPDATE events SET ${sets.join(', ')}, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...params, actor.id || null, event.id]
      );
    }
    if (Object.keys(fields).length) {
      await logEventAudit(tx, {
        action: EVENT_AUDIT_ACTION.GUESTS_CHANGED,
        eventId: event.id, entityType: 'event', entityId: event.id, actor, reason: reason || null,
        previous: Object.fromEntries(Object.keys(fields).map((k) => [k, event[k]])),
        next: fields,
      });
    }
    if (data.finalize) {
      await logEventAudit(tx, {
        action: EVENT_AUDIT_ACTION.GUESTS_FINALIZED,
        eventId: event.id, entityType: 'event', entityId: event.id, actor, reason: reason || null,
        next: {
          guaranteed_guests: fields.guaranteed_guests ?? event.guaranteed_guests,
          actual_guests: fields.actual_guests ?? event.actual_guests,
        },
      });
    }
  });

  const updated = await db.get('SELECT * FROM events WHERE id = ?', [event.id]);
  const policy = await getBillablePolicy(db);
  return {
    event: updated,
    billable: explainBillable(updated, policy),
    allocation: await packageAllocation(db, event.id),
  };
}

/** Every guest-count change on an event, newest first. */
export async function guestHistory(db, eventId, { limit = 50 } = {}) {
  await ensureEventsSchema(db);
  const capped = Math.min(200, Math.max(1, Number(limit) || 50));
  return db.all(
    `SELECT * FROM event_audit
      WHERE event_id = ? AND action IN (?, ?)
      ORDER BY created_at DESC, id DESC
      LIMIT ${capped}`,
    [Number(eventId), EVENT_AUDIT_ACTION.GUESTS_CHANGED, EVENT_AUDIT_ACTION.GUESTS_FINALIZED]
  );
}
