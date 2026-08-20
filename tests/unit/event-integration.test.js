/**
 * Events ↔ POS integration rules.
 *
 * These pin the behaviours that decide whether an event is a workflow of the
 * restaurant or a parallel business: which lifecycle paths staff may take, that
 * settlement is the only route to COMPLETED, that a sale is recognised once,
 * and that the shared Summary Report reports restaurant + events as one total.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_STATUS_TRANSITIONS, BILLABLE_STATUSES,
  canTransition, canBill, assertTransition, assertBillable,
} from '../../lib/events/constants.js';

/* ------------------------------------------------------------- lifecycle */

test('the simple workflow needs three clicks: inquiry, confirm, bill', () => {
  // A birthday booked over the phone must not be dragged through a contract.
  assert.ok(canTransition('INQUIRY', 'CONFIRMED'), 'inquiry must confirm directly');
  assert.ok(canBill('CONFIRMED'), 'a confirmed event must be billable straight away');
});

test('the advanced workflow is still available end to end', () => {
  const path = ['INQUIRY', 'DRAFT', 'QUOTED', 'CONFIRMED', 'PLANNING', 'FINALIZED', 'IN_PROGRESS'];
  for (let i = 0; i < path.length - 1; i += 1) {
    assert.ok(canTransition(path[i], path[i + 1]), `${path[i]} → ${path[i + 1]} must be allowed`);
  }
  assert.ok(canBill('IN_PROGRESS'));
});

test('bookings move backwards, because real ones do', () => {
  assert.ok(canTransition('QUOTED', 'DRAFT'), 'a quote gets revised');
  assert.ok(canTransition('CONFIRMED', 'QUOTED'), 'a confirmed booking gets renegotiated');
  assert.ok(canTransition('PLANNING', 'CONFIRMED'), 'planning reverts');
  assert.ok(canTransition('FINALIZED', 'PLANNING'), 'a premature finalize reopens');
});

test('every live status can be cancelled, and terminal ones cannot move', () => {
  for (const [from, targets] of Object.entries(EVENT_STATUS_TRANSITIONS)) {
    if (from === 'COMPLETED' || from === 'CANCELLED') {
      assert.deepEqual(targets, [], `${from} must be terminal`);
    } else {
      assert.ok(targets.includes('CANCELLED'), `${from} must be cancellable`);
    }
  }
});

test('COMPLETED is not reachable by picking it from a list', () => {
  // This is the guard that stops a stray click closing an unpaid booking.
  for (const targets of Object.values(EVENT_STATUS_TRANSITIONS)) {
    assert.ok(!targets.includes('COMPLETED'), 'no status may transition straight to COMPLETED');
  }
  assert.throws(
    () => assertTransition('CONFIRMED', 'COMPLETED'),
    (e) => e.code === 'complete_requires_billing' && /Bill the event/i.test(e.message),
    'a confirmed event must be told to bill, not given a generic refusal'
  );
  assert.throws(
    () => assertTransition('IN_PROGRESS', 'COMPLETED'),
    (e) => e.code === 'complete_requires_billing'
  );
});

test('an uncommitted event cannot be billed', () => {
  for (const status of ['INQUIRY', 'DRAFT', 'QUOTED']) {
    assert.ok(!canBill(status), `${status} must not be billable`);
    assert.throws(() => assertBillable(status), (e) => e.code === 'not_billable');
  }
  assert.deepEqual(BILLABLE_STATUSES, ['CONFIRMED', 'PLANNING', 'FINALIZED', 'IN_PROGRESS']);
});

test('a settled or cancelled event refuses a second settlement', () => {
  assert.throws(() => assertBillable('COMPLETED'), (e) => e.code === 'already_billed');
  assert.throws(() => assertBillable('CANCELLED'), (e) => e.code === 'event_cancelled');
});

test('an unknown status is rejected rather than silently allowed', () => {
  assert.equal(canTransition('INQUIRY', 'NONSENSE'), false);
  assert.throws(() => assertTransition('INQUIRY', 'NONSENSE'), /Unknown event status/);
  assert.throws(() => assertTransition('INQUIRY', 'INQUIRY'), /already INQUIRY/);
});

/* --------------------------------------------- no double counting in POS */

test('the POS payment route refuses an event order', async () => {
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../../app/api/admin/pos/orders/[id]/pay/route.js', import.meta.url), 'utf8'));
  assert.match(src, /if \(order\.event_id\)/, 'the pay route must check event_id');
  assert.match(src, /code: 'event_order'/, 'and refuse with a code the client can act on');
  // The guard has to sit before any bill row is written.
  assert.ok(
    src.indexOf('order.event_id') < src.indexOf('INSERT INTO bills'),
    'the event guard must run before the bill insert'
  );
});

/* ------------------------------------------- shared sales reporting split */

test('the summary report totals restaurant and event sales together', async () => {
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../../lib/summary-report.js', import.meta.url), 'utf8'));

  assert.match(src, /async function eventSales/, 'event revenue needs its own measure');
  assert.match(
    src,
    /grossRevenue=round2\(restaurantRevenue\+events\.gross\)/,
    'the headline must be restaurant + events'
  );
  assert.match(src, /restaurant:restaurantRevenue/, 'the split must stay reportable');
  assert.match(src, /events:events\.gross/);

  // Events are measured on what was recognised, not on money moved, because an
  // advance arrives on a different day from the sale.
  assert.match(src, /a\.code='4010'/, 'event revenue comes from the revenue account');
  assert.match(src, /je\.source_type='event_sale'/);

  // Deposits must never be read as revenue.
  assert.ok(
    !/journalMedia\(db,start,end,\['event_deposit'\]\)/.test(src),
    'event deposits must not be summed as sales'
  );
});

test('settlement money reaches the shared payment media split', async () => {
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../../lib/summary-report.js', import.meta.url), 'utf8'));
  assert.match(src, /journalMedia\(db,start,end,\['event_sale'\]\)/, 'settlement cash/bank must be measured');
  assert.match(src, /gross_cash:round2\(revenue\.cash\+eventMedia\.cash\+ledger\.cash\)/);
  assert.match(src, /gross_bank:round2\(revenue\.bank\+eventMedia\.bank\+ledger\.bank\)/);
});

test('event revenue is recognised in exactly one place', async () => {
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../../lib/events/billing.js', import.meta.url), 'utf8'));

  // One settlement journal per event, claimed inside the transaction.
  assert.match(src, /source_type: 'event_sale'/);
  assert.match(
    src,
    /UPDATE events SET completed_at = CURRENT_TIMESTAMP WHERE id = \? AND completed_at IS NULL/,
    'the claim is what makes two simultaneous settlements safe'
  );
  assert.match(src, /code: 'already_billed'/);
  // The advance is released, never re-earned.
  assert.match(src, /ADVANCES_ACCOUNT_CODE, debit: advanceApplied/);
  // Contracted food is not charged twice: the fulfilment order is excluded.
  assert.match(src, /orders\.filter\(\(o\) => !Number\(o\.event_production\)\)/);
});
