import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedOrderType, orderTypeLabel, normalizedOrderTypeSql } from '../../lib/order-types.js';

test('table-less counter and legacy orders normalize to takeaway', () => {
  assert.equal(normalizedOrderType({ order_type: 'counter', table_id: null, table_number: null }), 'takeaway');
  assert.equal(normalizedOrderType({ order_type: null, table_id: null, table_number: '' }), 'takeaway');
  assert.equal(orderTypeLabel({ order_type: 'counter' }), 'Takeaway');
});

test('table-linked orders normalize to dine in and delivery remains delivery', () => {
  assert.equal(normalizedOrderType({ order_type: 'counter', table_id: 4 }), 'dine_in');
  assert.equal(normalizedOrderType({ order_type: 'takeaway', table_number: 'T-06' }), 'dine_in');
  assert.equal(normalizedOrderType({ order_type: 'delivery', table_id: null }), 'delivery');
  assert.equal(orderTypeLabel({ order_type: 'delivery' }), 'Delivery');
});

test('report SQL uses the same table-less takeaway rule', () => {
  const sql = normalizedOrderTypeSql('o');
  assert.match(sql, /order_type/);
  assert.match(sql, /table_id IS NULL/);
  assert.match(sql, /table_number/);
  assert.match(sql, /'takeaway'/);
});

test('an event order is its own channel, and nothing else changes', () => {
  // The event branch is additive: it only fires when event_id is present.
  assert.equal(normalizedOrderType({ event_id: 7, table_id: 3 }), 'event');
  assert.equal(normalizedOrderType({ event_id: 7, order_type: 'delivery' }), 'event');
  assert.equal(orderTypeLabel({ event_id: 7 }), 'Event');

  // Every existing shape classifies exactly as before.
  assert.equal(normalizedOrderType({ event_id: null, table_id: 4 }), 'dine_in');
  assert.equal(normalizedOrderType({ table_id: 4 }), 'dine_in');
  assert.equal(normalizedOrderType({ order_type: 'delivery' }), 'delivery');
  assert.equal(normalizedOrderType({ order_type: 'counter', table_id: null }), 'takeaway');
});

test('the report SQL classifies event orders first, leaving other rules intact', () => {
  const sql = normalizedOrderTypeSql('o');
  assert.match(sql, /o\.event_id IS NOT NULL THEN 'event'/);
  // The original branches must still be present and in order.
  assert.match(sql, /'delivery'/);
  assert.match(sql, /table_id IS NULL/);
  assert.match(sql, /'takeaway'/);
  assert.ok(
    sql.indexOf('event_id IS NOT NULL') < sql.indexOf("= 'delivery'"),
    'the event branch must be evaluated before the channel rules'
  );
});
