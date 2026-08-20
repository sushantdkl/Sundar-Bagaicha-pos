/**
 * §46 reconciliation, executed rather than asserted on paper.
 *
 * Builds a real business day on a throwaway SQLite database, puts restaurant
 * revenue and a settled event through the actual accounting code, then reads
 * the shared Summary Report back and checks the arithmetic:
 *
 *     Restaurant Sales + Event Sales = Total Sales
 *
 * and — the failure this is really guarding against — that the event is not
 * counted twice, once as its quotation and again as its settlement.
 *
 * The deposit case is the other half: money taken in advance must move cash
 * without moving revenue, until the event is actually settled.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { ensureAccountingSchema, postJournal } from '../../lib/accounting.js';
import { ensureStockMovementsTable } from '../../lib/stock-movements.js';
import { ensureColumn } from '../../lib/db/schema-helpers.js';
import { ensureRecipeTables } from '../../lib/recipes.js';
import { buildSummaryReport } from '../../lib/summary-report.js';

const dbPath = path.join(os.tmpdir(), `event-recon-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);
const DAY = '2026-08-20';

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
});

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * A restaurant bill, posted the way lib/bills-admin.js posts one:
 * money in, revenue and tax out.
 */
const postRestaurantBill = (net, tax, method = '1010') => postJournal(db, {
  entry_date: DAY,
  memo: 'Restaurant bill',
  source_type: 'bill',
  lines: [
    { code: method, debit: round2(net + tax), credit: 0 },
    { code: '4010', debit: 0, credit: net },
    ...(tax ? [{ code: '2020', debit: 0, credit: tax }] : []),
  ],
});

/** An advance: cash in, liability up. Deliberately no revenue line. */
const postEventDeposit = (amount, method = '1010') => postJournal(db, {
  entry_date: DAY,
  memo: 'Event advance',
  source_type: 'event_deposit',
  lines: [
    { code: method, debit: amount, credit: 0 },
    { code: '2030', debit: 0, credit: amount },
  ],
});

/**
 * An event settlement, matching the shape lib/events/billing.js writes:
 * the advance is released and the balance collected, against revenue and tax.
 */
const postEventSettlement = ({ net, tax, advance = 0, collected = 0, method = '1010' }) => postJournal(db, {
  entry_date: DAY,
  memo: 'Event settlement',
  source_type: 'event_sale',
  lines: [
    ...(advance ? [{ code: '2030', debit: advance, credit: 0 }] : []),
    ...(collected ? [{ code: method, debit: collected, credit: 0 }] : []),
    { code: '4010', debit: 0, credit: net },
    ...(tax ? [{ code: '2020', debit: 0, credit: tax }] : []),
  ],
});

test('accounting schema is available', async () => {
  await ensureAccountingSchema(db);
  // Migration 046 adds 2030 in Postgres; on a bare SQLite fixture it is seeded
  // here so the advance has somewhere to land.
  await db.run(
    `INSERT INTO accounts (code, name, type, subtype, is_active, is_system)
     VALUES ('2030', 'Event Customer Advances', 'liability', 'current', 1, 1)`
  ).catch(() => {});
  await ensureStockMovementsTable(db);
  await ensureRecipeTables(db);
  // buildSummaryReport runs the ledger/payroll ensurers, which expect tables
  // that migrations create in a real deployment. Stubbed here so the fixture
  // exercises the report rather than the migration runner.
  await db.run(`CREATE TABLE IF NOT EXISTS wastage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_item_id INTEGER,
    quantity REAL, reason TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
  for (const [table, column, type] of [
    ['expenses', 'payment_method', 'TEXT'],
    ['expenses', 'source_type', 'TEXT'],
    ['expenses', 'event_id', 'INTEGER'],
  ]) {
    await ensureColumn(db, table, column, type).catch(() => {});
  }

  const advances = await db.get(`SELECT code FROM accounts WHERE code = '2030'`);
  assert.ok(advances, '2030 Event Customer Advances must exist for deposits to post');
});

test('restaurant sales alone: total equals the restaurant channel', async () => {
  await postRestaurantBill(10000, 0);           // dine-in
  await postRestaurantBill(5000, 0);            // takeaway
  const r = await buildSummaryReport(db, { start: DAY, end: DAY });

  assert.equal(r.revenue.restaurant, 15000, 'restaurant channel');
  assert.equal(r.revenue.events, 0, 'no events settled yet');
  assert.equal(r.revenue.gross, 15000, 'total is the restaurant total');
});

test('a deposit moves cash but is not a sale', async () => {
  await postEventDeposit(15000);
  const r = await buildSummaryReport(db, { start: DAY, end: DAY });

  assert.equal(r.revenue.events, 0, 'an advance is a liability, never revenue');
  assert.equal(r.revenue.gross, 15000, 'total sales must not move when an advance is taken');
  assert.equal(r.events.settlements, 0);
});

test('settling the event adds it to total sales exactly once', async () => {
  // Rs 35,000 event: Rs 15,000 already held as an advance, Rs 20,000 collected now.
  await postEventSettlement({ net: 35000, tax: 0, advance: 15000, collected: 20000 });
  const r = await buildSummaryReport(db, { start: DAY, end: DAY });

  assert.equal(r.revenue.restaurant, 15000, 'restaurant is untouched by the event');
  assert.equal(r.revenue.events, 35000, 'the whole event is recognised, not just the balance');
  assert.equal(r.revenue.gross, 50000, 'Restaurant 15,000 + Event 35,000 = 50,000');

  // The failure mode this test exists for: 15,000 + 35,000 + 35,000 = 85,000.
  assert.notEqual(r.revenue.gross, 85000, 'the event must not be counted twice');
  assert.equal(r.events.settlements, 1, 'exactly one settlement in the window');
  assert.equal(r.events.advances_applied, 15000, 'the advance was released, not re-earned');
});

test('cash received reconciles with the money actually moved', async () => {
  const r = await buildSummaryReport(db, { start: DAY, end: DAY });
  // Restaurant 15,000 + the 20,000 balance collected at settlement. The 15,000
  // advance is NOT here: it is cash, but it was banked under event_deposit and
  // is not a sale receipt.
  assert.equal(r.received.gross_cash, 35000, 'restaurant cash + settlement cash');
});

test('tax from an event lands in the same tax total as the restaurant', async () => {
  const before = await buildSummaryReport(db, { start: DAY, end: DAY });
  await postEventSettlement({ net: 10000, tax: 1300, collected: 11300 });
  const after = await buildSummaryReport(db, { start: DAY, end: DAY });

  assert.equal(round2(after.revenue.events - before.revenue.events), 11300,
    'an event sale is reported gross of tax, like a bill');
  assert.equal(round2(after.revenue.gross - before.revenue.gross), 11300);
  assert.equal(after.events.tax, 1300, 'event tax is visible for the VAT return');
});

test('a settlement outside the window does not leak into it', async () => {
  await postJournal(db, {
    entry_date: '2026-09-15',
    memo: 'Later event settlement',
    source_type: 'event_sale',
    lines: [
      { code: '1010', debit: 90000, credit: 0 },
      { code: '4010', debit: 0, credit: 90000 },
    ],
  });
  const day = await buildSummaryReport(db, { start: DAY, end: DAY });
  assert.equal(day.revenue.events, 46300, 'September must not appear in August');

  const september = await buildSummaryReport(db, { start: '2026-09-15', end: '2026-09-15' });
  assert.equal(september.revenue.events, 90000);
  assert.equal(september.revenue.restaurant, 0);
  assert.equal(september.revenue.gross, 90000);
});
