/**
 * Events module vocabulary and lifecycle rules.
 *
 * These mirror the CHECK constraints in migration 045 exactly. The database is
 * the last line of defence; this module is what the service layer validates
 * against so a bad transition fails with a readable message rather than a
 * constraint violation.
 *
 * Deliberately NOT here: event types, package names and prices. Those are
 * business configuration (rows in event_packages / event_package_price_tiers
 * and settings), not code constants.
 */

/* ------------------------------------------------------------- lifecycle */

export const EVENT_STATUS = {
  INQUIRY: 'INQUIRY',
  DRAFT: 'DRAFT',
  QUOTED: 'QUOTED',
  CONFIRMED: 'CONFIRMED',
  PLANNING: 'PLANNING',
  FINALIZED: 'FINALIZED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

export const EVENT_STATUSES = Object.values(EVENT_STATUS);

/**
 * Allowed forward transitions. Every non-terminal state may also be CANCELLED.
 *
 * The happy path is linear:
 *   INQUIRY → DRAFT → QUOTED → CONFIRMED → PLANNING → FINALIZED → IN_PROGRESS → COMPLETED
 *
 * A few backward steps are permitted because real bookings move backwards:
 * a quote gets revised (QUOTED → DRAFT), and a confirmed event can go back to
 * quoting if the customer renegotiates. Anything after FINALIZED is one-way —
 * once production has been released, the event cannot be un-started.
 */
export const EVENT_STATUS_TRANSITIONS = {
  INQUIRY: ['DRAFT', 'QUOTED', 'CANCELLED'],
  DRAFT: ['QUOTED', 'CANCELLED'],
  QUOTED: ['DRAFT', 'CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['QUOTED', 'PLANNING', 'FINALIZED', 'CANCELLED'],
  PLANNING: ['FINALIZED', 'CANCELLED'],
  FINALIZED: ['IN_PROGRESS', 'PLANNING', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** Statuses at which the booking is a firm commitment. */
export const COMMITTED_STATUSES = [
  EVENT_STATUS.CONFIRMED,
  EVENT_STATUS.PLANNING,
  EVENT_STATUS.FINALIZED,
  EVENT_STATUS.IN_PROGRESS,
  EVENT_STATUS.COMPLETED,
];

/** Statuses that must not overlap another event in the same space. */
export const BLOCKING_STATUSES = COMMITTED_STATUSES;

/** Provisional statuses — an overlap here warns rather than blocks. */
export const PROVISIONAL_STATUSES = [
  EVENT_STATUS.INQUIRY,
  EVENT_STATUS.DRAFT,
  EVENT_STATUS.QUOTED,
];

/** No further operational or financial activity is allowed. */
export const TERMINAL_STATUSES = [EVENT_STATUS.COMPLETED, EVENT_STATUS.CANCELLED];

/**
 * Once quoted-and-accepted, line prices are snapshots and must not drift with
 * the restaurant menu. Used by Phase 5/6 to protect confirmed quotations.
 */
export const PRICE_LOCKED_STATUSES = [
  EVENT_STATUS.CONFIRMED,
  EVENT_STATUS.PLANNING,
  EVENT_STATUS.FINALIZED,
  EVENT_STATUS.IN_PROGRESS,
  EVENT_STATUS.COMPLETED,
];

export function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from, to) {
  if (!EVENT_STATUSES.includes(from) || !EVENT_STATUSES.includes(to)) return false;
  return (EVENT_STATUS_TRANSITIONS[from] || []).includes(to);
}

/**
 * Throwing variant used by the service layer. Errors carry `status` so
 * lib/api-guard.js turns them into a 4xx with the message intact.
 */
export function assertTransition(from, to) {
  if (from === to) {
    throw Object.assign(new Error(`This event is already ${to}.`), { status: 409 });
  }
  if (!EVENT_STATUSES.includes(to)) {
    throw Object.assign(new Error(`Unknown event status "${to}".`), { status: 400 });
  }
  if (isTerminal(from)) {
    throw Object.assign(
      new Error(`A ${from.toLowerCase()} event can no longer change status.`),
      { status: 409 }
    );
  }
  if (!canTransition(from, to)) {
    const allowed = (EVENT_STATUS_TRANSITIONS[from] || []).join(', ') || 'nothing';
    throw Object.assign(
      new Error(`An event cannot move from ${from} to ${to}. Allowed next: ${allowed}.`),
      { status: 409 }
    );
  }
  return true;
}

/* --------------------------------------------------------- payment status */

// Independent of the operational lifecycle: a CONFIRMED event may be UNPAID and
// a COMPLETED event may still carry a balance.
export const EVENT_PAYMENT_STATUS = {
  UNPAID: 'UNPAID',
  DEPOSIT_DUE: 'DEPOSIT_DUE',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
};

export const EVENT_PAYMENT_STATUSES = Object.values(EVENT_PAYMENT_STATUS);

/* -------------------------------------------------------------- line types */

export const EVENT_LINE_TYPE = {
  PACKAGE: 'package',
  MENU_ITEM: 'menu_item',
  CUSTOM_FOOD: 'custom_food',
  BEVERAGE: 'beverage',
  VENUE: 'venue',
  SERVICE: 'service',
  EQUIPMENT: 'equipment',
  MISC: 'misc',
  COMPLIMENTARY: 'complimentary',
};

export const EVENT_LINE_TYPES = Object.values(EVENT_LINE_TYPE);

/** Line types that represent food and therefore have a food cost. */
export const FOOD_LINE_TYPES = [
  EVENT_LINE_TYPE.PACKAGE,
  EVENT_LINE_TYPE.MENU_ITEM,
  EVENT_LINE_TYPE.CUSTOM_FOOD,
  EVENT_LINE_TYPE.BEVERAGE,
];

/* ---------------------------------------------------------------- pricing */

export const PRICING_POLICY = {
  /** Every guest pays the tier matching the total guest count. */
  WHOLE_PARTY: 'whole_party',
  /** Slab pricing: guests are charged per tier band they fall into. */
  PROGRESSIVE: 'progressive',
  /** A negotiated rate is entered on the event; tiers are advisory only. */
  MANUAL: 'manual',
};

export const PRICING_POLICIES = Object.values(PRICING_POLICY);

/* ------------------------------------------------------ payment schedule */

export const SCHEDULE_TYPE = { DEPOSIT: 'deposit', INSTALLMENT: 'installment', FINAL: 'final' };
export const SCHEDULE_TYPES = Object.values(SCHEDULE_TYPE);

export const SCHEDULE_AMOUNT_TYPE = { FIXED: 'fixed', PERCENT: 'percent' };
export const SCHEDULE_AMOUNT_TYPES = Object.values(SCHEDULE_AMOUNT_TYPE);

export const SCHEDULE_STATUS = {
  PENDING: 'pending', PARTIAL: 'partial', PAID: 'paid',
  WAIVED: 'waived', CANCELLED: 'cancelled',
};
export const SCHEDULE_STATUSES = Object.values(SCHEDULE_STATUS);

export const DEPOSIT_ENTRY_TYPE = { DEPOSIT: 'deposit', REFUND: 'refund', ADJUSTMENT: 'adjustment' };
export const DEPOSIT_ENTRY_TYPES = Object.values(DEPOSIT_ENTRY_TYPE);

/* -------------------------------------------------------------- audit actions */

export const EVENT_AUDIT_ACTION = {
  CREATED: 'event_created',
  UPDATED: 'event_updated',
  STATUS_CHANGED: 'event_status_changed',
  GUESTS_CHANGED: 'event_guests_changed',
  GUESTS_FINALIZED: 'event_guests_finalized',
  LINE_ADDED: 'event_line_added',
  LINE_UPDATED: 'event_line_updated',
  LINE_REMOVED: 'event_line_removed',
  PRICE_OVERRIDDEN: 'event_price_overridden',
  DEPOSIT_COLLECTED: 'event_deposit_collected',
  DEPOSIT_REFUNDED: 'event_deposit_refunded',
  DEPOSIT_VOIDED: 'event_deposit_voided',
  CANCELLED: 'event_cancelled',
  STARTED: 'event_started',
  COMPLETED: 'event_completed',
  BEO_REVISED: 'event_beo_revised',
  FINAL_BILLED: 'event_final_billed',
  SPACE_OVERRIDE: 'event_space_override',
  CAPACITY_OVERRIDE: 'event_capacity_override',
  SPACE_CONFIG_CHANGED: 'event_space_config_changed',
  PACKAGE_CONFIG_CHANGED: 'event_package_config_changed',
};

/* --------------------------------------------------------------- numbering */

/** Feeds nextDocumentNumber(db, EVENT_DOCUMENT) → "EVT-001", "EVT-002", ... */
export const EVENT_DOCUMENT = { type: 'event', prefix: 'EVT' };
