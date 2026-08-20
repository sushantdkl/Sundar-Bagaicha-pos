import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_STATUS,
  EVENT_STATUSES,
  EVENT_STATUS_TRANSITIONS,
  EVENT_PAYMENT_STATUSES,
  EVENT_LINE_TYPES,
  PRICING_POLICIES,
  BLOCKING_STATUSES,
  PROVISIONAL_STATUSES,
  canTransition,
  assertTransition,
  isTerminal,
} from '../../lib/events/constants.js';

test('the happy path walks the full lifecycle up to the point of billing', () => {
  // COMPLETED is deliberately absent: an event is completed by settling it
  // (lib/events/billing.js), never by choosing the status. See the dedicated
  // test below and tests/unit/event-integration.test.js.
  const path = [
    EVENT_STATUS.INQUIRY, EVENT_STATUS.DRAFT, EVENT_STATUS.QUOTED,
    EVENT_STATUS.CONFIRMED, EVENT_STATUS.PLANNING, EVENT_STATUS.FINALIZED,
    EVENT_STATUS.IN_PROGRESS,
  ];
  for (let i = 0; i < path.length - 1; i++) {
    assert.equal(canTransition(path[i], path[i + 1]), true, `${path[i]} -> ${path[i + 1]}`);
  }
});

test('every non-terminal status can be cancelled, terminal ones cannot move', () => {
  for (const status of EVENT_STATUSES) {
    if (status === EVENT_STATUS.CANCELLED || status === EVENT_STATUS.COMPLETED) {
      assert.equal(isTerminal(status), true, `${status} should be terminal`);
      assert.deepEqual(EVENT_STATUS_TRANSITIONS[status], [], `${status} should be a dead end`);
      continue;
    }
    assert.equal(canTransition(status, EVENT_STATUS.CANCELLED), true, `${status} -> CANCELLED`);
  }
});

test('a started event cannot be un-started or skipped ahead', () => {
  // Production has been released; going back would desync stock and KOTs.
  assert.equal(canTransition(EVENT_STATUS.IN_PROGRESS, EVENT_STATUS.FINALIZED), false);
  assert.equal(canTransition(EVENT_STATUS.IN_PROGRESS, EVENT_STATUS.PLANNING), false);
  // A booking must be committed before it can run. Confirming is now enough —
  // Planning and Finalized are optional — but an inquiry still cannot start.
  assert.equal(canTransition(EVENT_STATUS.INQUIRY, EVENT_STATUS.IN_PROGRESS), false);
  assert.equal(canTransition(EVENT_STATUS.QUOTED, EVENT_STATUS.IN_PROGRESS), false);
  assert.equal(canTransition(EVENT_STATUS.CONFIRMED, EVENT_STATUS.IN_PROGRESS), true);
  assert.equal(canTransition(EVENT_STATUS.QUOTED, EVENT_STATUS.COMPLETED), false);
});

test('renegotiation steps backwards are allowed where the business needs them', () => {
  assert.equal(canTransition(EVENT_STATUS.QUOTED, EVENT_STATUS.DRAFT), true);
  assert.equal(canTransition(EVENT_STATUS.CONFIRMED, EVENT_STATUS.QUOTED), true);
  assert.equal(canTransition(EVENT_STATUS.FINALIZED, EVENT_STATUS.PLANNING), true);
});

test('assertTransition throws a 4xx with a readable message', () => {
  assert.throws(
    () => assertTransition(EVENT_STATUS.COMPLETED, EVENT_STATUS.IN_PROGRESS),
    (err) => err.status === 409 && /no longer change status/i.test(err.message)
  );
  // Completing is refused with advice rather than a matrix dump, because the
  // operator's next step differs by status: confirm first, or bill.
  assert.throws(
    () => assertTransition(EVENT_STATUS.INQUIRY, EVENT_STATUS.COMPLETED),
    (err) => err.status === 409 && err.code === 'complete_requires_billing'
      && /confirm it first, then bill it/i.test(err.message)
  );
  assert.throws(
    () => assertTransition(EVENT_STATUS.CONFIRMED, EVENT_STATUS.COMPLETED),
    (err) => err.status === 409 && err.code === 'complete_requires_billing'
      && /Bill the event to complete it/i.test(err.message)
  );
  assert.throws(
    () => assertTransition(EVENT_STATUS.DRAFT, 'NOT_A_STATUS'),
    (err) => err.status === 400 && /Unknown event status/i.test(err.message)
  );
  assert.throws(
    () => assertTransition(EVENT_STATUS.DRAFT, EVENT_STATUS.DRAFT),
    (err) => err.status === 409 && /already/i.test(err.message)
  );
  assert.equal(assertTransition(EVENT_STATUS.QUOTED, EVENT_STATUS.CONFIRMED), true);
});

test('blocking and provisional statuses do not overlap', () => {
  for (const status of PROVISIONAL_STATUSES) {
    assert.equal(BLOCKING_STATUSES.includes(status), false, `${status} must not block a space`);
  }
  // A confirmed booking must hold its space.
  assert.equal(BLOCKING_STATUSES.includes(EVENT_STATUS.CONFIRMED), true);
});

test('vocabularies match the values allowed by migration 045', () => {
  assert.deepEqual(EVENT_STATUSES, [
    'INQUIRY', 'DRAFT', 'QUOTED', 'CONFIRMED', 'PLANNING',
    'FINALIZED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
  ]);
  assert.deepEqual(EVENT_PAYMENT_STATUSES, [
    'UNPAID', 'DEPOSIT_DUE', 'PARTIALLY_PAID', 'PAID', 'REFUNDED',
  ]);
  assert.deepEqual(EVENT_LINE_TYPES, [
    'package', 'menu_item', 'custom_food', 'beverage', 'venue',
    'service', 'equipment', 'misc', 'complimentary',
  ]);
  assert.deepEqual(PRICING_POLICIES, ['whole_party', 'progressive', 'manual']);
});

test('every transition target is a known status', () => {
  for (const [from, targets] of Object.entries(EVENT_STATUS_TRANSITIONS)) {
    assert.ok(EVENT_STATUSES.includes(from), `${from} is not a known status`);
    for (const to of targets) {
      assert.ok(EVENT_STATUSES.includes(to), `${from} -> ${to} targets an unknown status`);
    }
  }
});
