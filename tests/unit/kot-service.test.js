/**
 * Regression coverage for a real bug: cancelling a KOT (or the last sent
 * item on an order) left the order stuck "preparing"/"cooking" and the
 * table stuck showing the kitchen as busy, forever, because nothing
 * recomputed order/table status once nothing was left to cook. See
 * lib/kot-service.js's reconcileOrderAfterKotChange.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { getNepaliDateString } from '../../lib/time-utils.js';
import { businessDayIdForExistingWork, openBusinessDay } from '../../lib/business-days.js';
import { cancelKot, cancelSentItem, ensureKotProSchema } from '../../lib/kot-service.js';

const dbPath = path.join(os.tmpdir(), `kot-service-test-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);
const admin = { id: 1, full_name: 'Admin One', role: 'admin' };

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
  }
});

let businessDayId;
test('setup: open a business day so KOT operations are allowed', async () => {
  await ensureKotProSchema(db);
  const day = await openBusinessDay(db, { business_date: getNepaliDateString(), opening_cash: 0 }, admin);
  businessDayId = day.id;
  assert.ok(businessDayId);
});

async function makeOrderWithSentItem(tableNumber, quantity = 1) {
  const table = await db.run(`INSERT INTO tables (table_number, status) VALUES (?, 'cooking')`, [tableNumber]);
  const tableId = table.lastInsertRowid;
  const order = await db.run(
    `INSERT INTO orders (order_number, table_id, status, business_day_id) VALUES (?, ?, 'preparing', ?)`,
    [`ORD-${tableNumber}`, tableId, businessDayId]
  );
  const orderId = order.lastInsertRowid;
  await db.run(`UPDATE tables SET current_order_id = ? WHERE id = ?`, [orderId, tableId]);
  const item = await db.run(
    `INSERT INTO order_items (order_id, item_name, quantity, price, subtotal, sent_quantity, status)
     VALUES (?, 'Coffee', ?, 80, ?, ?, 'pending')`,
    [orderId, quantity, 80 * quantity, quantity]
  );
  const itemId = item.lastInsertRowid;
  const kot = await db.run(
    `INSERT INTO kots (kot_number, order_id, station, status, sequence, table_id, kot_type, business_day_id)
     VALUES (?, ?, 'main', 'pending', 1, ?, 'new', ?)`,
    [`KOT-${tableNumber}`, orderId, tableId, businessDayId]
  );
  const kotId = kot.lastInsertRowid;
  await db.run(
    `INSERT INTO kot_items (kot_id, order_item_id, quantity, status, item_name, is_cancellation)
     VALUES (?, ?, ?, 'pending', 'Coffee', 0)`,
    [kotId, itemId, quantity]
  );
  return { tableId, orderId, itemId, kotId };
}

test('cancelling the whole KOT un-sends the item and drops the table out of "cooking"', async () => {
  const { tableId, orderId, kotId } = await makeOrderWithSentItem('KT-1');
  await cancelKot(db, { kotId, reason: 'test', actor: admin });

  const order = await db.get('SELECT status FROM orders WHERE id=?', [orderId]);
  const table = await db.get('SELECT status FROM tables WHERE id=?', [tableId]);
  assert.equal(order.status, 'pending'); // was 'preparing'
  assert.equal(table.status, 'occupied'); // was 'cooking' — item is unsent but the table isn't busy
});

test('cancelling the last sent item resolves the order/table AND the now-empty original KOT', async () => {
  const { tableId, orderId, itemId, kotId } = await makeOrderWithSentItem('KT-2');
  await cancelSentItem(db, { orderId, orderItemId: itemId, reason: 'test', actor: admin });

  const order = await db.get('SELECT status FROM orders WHERE id=?', [orderId]);
  const table = await db.get('SELECT status FROM tables WHERE id=?', [tableId]);
  const originalKot = await db.get('SELECT status, voided FROM kots WHERE id=?', [kotId]);
  const cancellationKot = await db.get(`SELECT amends_kot_id FROM kots WHERE order_id=? AND kot_type='cancellation'`, [orderId]);

  assert.equal(order.status, 'pending'); // was 'preparing', bug: used to stay stuck here forever
  assert.equal(table.status, 'occupied'); // was 'cooking', bug: used to stay stuck here forever
  assert.equal(originalKot.status, 'cancelled'); // bug: used to stay 'pending' on the kitchen board forever
  assert.equal(originalKot.voided, 1);
  assert.equal(cancellationKot.amends_kot_id, kotId); // cancellation notice points at its source ticket
});

test('a KOT with a still-active item is left alone (only the empty one gets auto-resolved)', async () => {
  const { orderId, kotId } = await makeOrderWithSentItem('KT-3', 2);
  // Add a second item on the SAME kot that stays active.
  const item2 = await db.run(
    `INSERT INTO order_items (order_id, item_name, quantity, price, subtotal, sent_quantity, status)
     VALUES (?, 'Coke', 1, 60, 60, 1, 'pending')`,
    [orderId]
  );
  await db.run(
    `INSERT INTO kot_items (kot_id, order_item_id, quantity, status, item_name, is_cancellation) VALUES (?, ?, 1, 'pending', 'Coke', 0)`,
    [kotId, item2.lastInsertRowid]
  );
  const firstItem = await db.get('SELECT id FROM order_items WHERE order_id=? AND item_name=?', [orderId, 'Coffee']);
  await cancelSentItem(db, { orderId, orderItemId: firstItem.id, reason: 'test', actor: admin });

  const kot = await db.get('SELECT status, voided FROM kots WHERE id=?', [kotId]);
  const order = await db.get('SELECT status FROM orders WHERE id=?', [orderId]);
  assert.equal(kot.status, 'pending'); // Coke is still active on it — must not be auto-cancelled
  assert.equal(kot.voided, 0);
  assert.equal(order.status, 'preparing'); // still cooking the Coke
});

test('existing orders and KOTs remain resolvable after midnight even when the store session is closed', async () => {
  const { orderId, kotId } = await makeOrderWithSentItem('KT-4');
  await db.run('UPDATE business_days SET business_date = ? WHERE id = ?', ['1999-12-31', businessDayId]);
  await db.run("UPDATE business_day_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE business_day_id = ?", [businessDayId]);

  // Legacy rows with no attribution are repaired onto the still-open day.
  await db.run('UPDATE orders SET business_day_id = NULL WHERE id = ?', [orderId]);
  assert.equal(await businessDayIdForExistingWork(db, 'orders', orderId), businessDayId);

  await cancelKot(db, { kotId, reason: 'Guests left after midnight', actor: admin });
  const kot = await db.get('SELECT status, business_day_id FROM kots WHERE id = ?', [kotId]);
  assert.equal(kot.status, 'cancelled');
  assert.equal(Number(kot.business_day_id), Number(businessDayId));
});
