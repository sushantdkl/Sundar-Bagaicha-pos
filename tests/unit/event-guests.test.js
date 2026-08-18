import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLABLE_POLICY, BILLABLE_POLICIES, billableGuests, explainBillable,
} from '../../lib/events/guests.js';

const ev = (expected, guaranteed, actual) => ({
  expected_guests: expected, guaranteed_guests: guaranteed, actual_guests: actual,
});

test('the default policy bills the higher of guaranteed and actual', () => {
  const p = BILLABLE_POLICY.MAX_GUARANTEED_ACTUAL;
  // Fewer turned up than were guaranteed — the client still pays the guarantee.
  assert.equal(billableGuests(ev(250, 220, 180), p), 220);
  // More turned up than guaranteed — the extras are billed.
  assert.equal(billableGuests(ev(250, 220, 240), p), 240);
  assert.equal(billableGuests(ev(250, 220, 220), p), 220);
});

test('before a guarantee or attendance exists it falls back sensibly', () => {
  const p = BILLABLE_POLICY.MAX_GUARANTEED_ACTUAL;
  assert.equal(billableGuests(ev(250, null, null), p), 250, 'expected is the only estimate');
  assert.equal(billableGuests(ev(250, 220, null), p), 220, 'guarantee beats expectation');
  assert.equal(billableGuests(ev(250, null, 240), p), 240, 'attendance with no guarantee');
});

test('an unknown billable count stays null rather than becoming zero', () => {
  // Defaulting to 0 would silently invoice nothing.
  assert.equal(billableGuests(ev(null, null, null)), null);
  assert.equal(billableGuests({}, BILLABLE_POLICY.GUARANTEED_ONLY), null);
  assert.equal(billableGuests(ev(250, null, null), BILLABLE_POLICY.ACTUAL_ONLY), null);
});

test('each alternative policy uses only its own input', () => {
  const e = ev(250, 220, 180);
  assert.equal(billableGuests(e, BILLABLE_POLICY.GUARANTEED_ONLY), 220);
  assert.equal(billableGuests(e, BILLABLE_POLICY.ACTUAL_ONLY), 180);
  assert.equal(billableGuests(e, BILLABLE_POLICY.EXPECTED_ONLY), 250);
});

test('an unknown policy string falls back to the default rather than throwing', () => {
  assert.equal(billableGuests(ev(250, 220, 180), 'nonsense'), 220);
});

test('the explanation names the basis a client could be shown', () => {
  const under = explainBillable(ev(250, 220, 180), BILLABLE_POLICY.MAX_GUARANTEED_ACTUAL);
  assert.equal(under.billable_guests, 220);
  assert.match(under.basis, /220 guaranteed/);

  const over = explainBillable(ev(250, 220, 240), BILLABLE_POLICY.MAX_GUARANTEED_ACTUAL);
  assert.equal(over.billable_guests, 240);
  assert.match(over.basis, /240 attended, above the 220 guaranteed/);

  const none = explainBillable(ev(null, null, null));
  assert.equal(none.billable_guests, null);
  assert.match(none.basis, /No guest count/);
});

test('the policy vocabulary is closed and complete', () => {
  assert.deepEqual(BILLABLE_POLICIES, [
    'max_guaranteed_actual', 'guaranteed_only', 'actual_only', 'expected_only',
  ]);
});

test('the brief\'s wedding scenario resolves as described', () => {
  // 250 expected, 220 guaranteed, then 230 actually attend.
  const wedding = ev(250, 220, 230);
  assert.equal(billableGuests(wedding), 230, 'ten extra guests are billed');
  // If only 200 attend, the 220 guarantee still stands.
  assert.equal(billableGuests(ev(250, 220, 200)), 220);
});
