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
 * Allowed transitions.
 *
 * A banquet hall runs two kinds of event and the lifecycle has to serve both
 * without forcing either through the other's paperwork:
 *
 *   simple    INQUIRY → CONFIRMED → (bill) → COMPLETED
 *             A birthday booked over the phone. Draft, Quoted, Planning and
 *             Finalized are skipped entirely — they exist for contracts, and a
 *             fifty-guest party does not have one.
 *
 *   advanced  INQUIRY → DRAFT → QUOTED → CONFIRMED → PLANNING → FINALIZED
 *                     → IN_PROGRESS → (bill) → COMPLETED
 *             A wedding, where each stage is a real handover between people.
 *
 * Backward steps are deliberate, not accidental: a quote gets revised
 * (QUOTED → DRAFT), a confirmed booking gets renegotiated (CONFIRMED → QUOTED),
 * and planning reopens after a premature finalize (FINALIZED → PLANNING).
 *
 * COMPLETED is absent from every list here on purpose. Completing an event is
 * not a status change — it is the result of settling it (lib/events/billing.js),
 * or an explicit no-charge closure that records a reason. Leaving it out of the
 * matrix is what stops a stray dropdown click from closing an event that still
 * owes money. See BILLABLE_STATUSES below.
 */
export const EVENT_STATUS_TRANSITIONS = {
  INQUIRY: ['DRAFT', 'QUOTED', 'CONFIRMED', 'CANCELLED'],
  DRAFT: ['QUOTED', 'CONFIRMED', 'CANCELLED'],
  QUOTED: ['DRAFT', 'CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['QUOTED', 'PLANNING', 'FINALIZED', 'IN_PROGRESS', 'CANCELLED'],
  PLANNING: ['CONFIRMED', 'FINALIZED', 'IN_PROGRESS', 'CANCELLED'],
  FINALIZED: ['PLANNING', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Statuses from which an event may be settled and thereby completed.
 *
 * This is what makes the simple workflow possible: a CONFIRMED birthday can be
 * billed directly, with no obligation to walk it through Planning, Finalized
 * and In Progress first. Settlement is the only path to COMPLETED, so this list
 * doubles as "may reach COMPLETED".
 */
export const BILLABLE_STATUSES = [
  EVENT_STATUS.CONFIRMED,
  EVENT_STATUS.PLANNING,
  EVENT_STATUS.FINALIZED,
  EVENT_STATUS.IN_PROGRESS,
];

export function canBill(status) {
  return BILLABLE_STATUSES.includes(status);
}

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

/**
 * Creating a booking directly as CONFIRMED reserves the date and space, but
 * does not mean its menu has already been agreed. Its initial quotation stays
 * editable until the booking came through the normal confirm transition
 * (`confirmed_at`) or a customer quotation/BEO was issued (`quoted_at`).
 * Planning and later stages are always change-controlled.
 */
export function isQuotationLocked(event = {}) {
  if (!PRICE_LOCKED_STATUSES.includes(event.status)) return false;
  if (event.status !== EVENT_STATUS.CONFIRMED) return true;
  return Boolean(event.confirmed_at || event.quoted_at);
}

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
  // COMPLETED is reached by settling the event, never by picking it from a
  // list. Saying so plainly beats "allowed next: ..." leaving the operator to
  // guess which of six statuses eventually closes the booking.
  if (to === EVENT_STATUS.COMPLETED) {
    throw Object.assign(
      new Error(
        canBill(from)
          ? 'Bill the event to complete it. Completing without settling would close a booking that still owes money.'
          : `A ${from.toLowerCase()} event cannot be completed — confirm it first, then bill it.`
      ),
      { status: 409, code: 'complete_requires_billing' }
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

/**
 * Guard for the settlement path. Mirrors assertTransition's contract — throws
 * with a `status` the API guard turns into a 4xx — but answers the question
 * billing actually asks: may this event be settled now?
 */
export function assertBillable(status) {
  if (status === EVENT_STATUS.COMPLETED) {
    throw Object.assign(new Error('This event has already been settled.'), {
      status: 409, code: 'already_billed',
    });
  }
  if (status === EVENT_STATUS.CANCELLED) {
    throw Object.assign(new Error('A cancelled event cannot be billed.'), {
      status: 409, code: 'event_cancelled',
    });
  }
  if (!canBill(status)) {
    throw Object.assign(
      new Error(`A ${status.toLowerCase()} event cannot be billed yet — confirm it first.`),
      { status: 409, code: 'not_billable' }
    );
  }
  return true;
}
