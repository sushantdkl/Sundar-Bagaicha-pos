/**
 * The settlement path, driven for real.
 *
 * Everything else about event billing is asserted against hand-posted journals.
 * This test calls finaliseBilling() itself on a throwaway database and then
 * inspects what it left behind: one bill from the shared BILL sequence, one
 * journal, the advance released, the event completed, and — the point of the
 * whole exercise — the sale visible to a bills-based report exactly once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { ensureAccountingSchema } from '../../lib/accounting.js';
import { ensureEventsSchema } from '../../lib/events/schema.js';
import { ensureBusinessDaySchema } from '../../lib/business-days.js';
import { finaliseBilling, finalStatement } from '../../lib/events/billing.js';
import { collectDeposit } from '../../lib/events/deposits.js';
import { normalizedOrderTypeSql } from '../../lib/order-types.js';
import { buildSummaryReport } from '../../lib/summary-report.js';
import { ensureStockMovementsTable } from '../../lib/stock-movements.js';
import { ensureRecipeTables } from '../../lib/recipes.js';
import { ensureColumn } from '../../lib/db/schema-helpers.js';
import { collectCreditBalance } from '../../lib/split-payments.js';

const dbPath = path.join(os.tmpdir(), `event-e2e-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);
const DAY = '2026-08-20';
const actor = { id: null, full_name: 'Test Manager' };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
});

let eventId = null;

test('fixture: schema, an open business day, and a confirmed event', async () => {
  await ensureAccountingSchema(db);
  // ensureEventsSchema attaches event_id to purchases; the table exists in a
  // real deployment via migration 001.
  await db.run(`CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, supplier TEXT, status TEXT DEFAULT 'received',
    invoice_date TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
  await ensureEventsSchema(db);
  await ensureBusinessDaySchema(db);
  await db.run(
    `INSERT INTO accounts (code, name, type, subtype, is_active, is_system)
     VALUES ('2030', 'Event Customer Advances', 'liability', 'current', 1, 1)`
  ).catch(() => {});

  // finaliseBilling requires an open business day with a live store session.
  await db.run(
    `INSERT INTO business_days (business_date, status, opening_cash) VALUES (?, 'open', 0)`,
    [DAY]
  );
  const day = await db.get(`SELECT id FROM business_days WHERE business_date = ?`, [DAY]);
  await db.run(
    `INSERT INTO business_day_sessions (business_day_id, status, opened_at)
     VALUES (?, 'open', CURRENT_TIMESTAMP)`,
    [day.id]
  ).catch(() => {});

  // A confirmed Rs 35,000 booking — the simple workflow, never drafted or quoted.
  await db.run(
    `INSERT INTO events
       (event_number, event_type, title, event_date, status, payment_status,
        subtotal, discount_amount, service_charge_percent, tax_percent,
        total_amount, deposit_total, outstanding_amount, created_at, updated_at)
     VALUES ('EVT-TEST-1', 'Birthday Party', '50th birthday', ?, 'CONFIRMED', 'UNPAID',
             35000, 0, 0, 0, 35000, 0, 35000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [DAY]
  );
  const ev = await db.get(`SELECT id FROM events WHERE event_number = 'EVT-TEST-1'`);
  eventId = ev.id;

  // An event's totals derive from its quotation lines — collecting a deposit
  // recomputes them — so the fixture needs a real line, not a hand-set subtotal.
  await db.run(
    `INSERT INTO event_menu_lines
       (event_id, line_type, item_name, quantity, unit_price, line_total,
        is_complimentary, consumes_inventory, sort_order, created_at, updated_at)
     VALUES (?, 'package', 'Birthday package (50 guests)', 50, 700, 35000, 0, 1, 0,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [eventId]
  );
  assert.ok(eventId, 'event fixture created');
});

test('the statement reads the contracted total before anything is charged', async () => {
  const statement = await finalStatement(db, eventId);
  assert.equal(statement.grand_total, 35000);
  assert.equal(statement.advances_applied, 0);
  assert.equal(statement.balance_due, 35000);
  assert.equal(statement.already_billed, false);
});

test('an advance moves money without recognising revenue', async () => {
  await collectDeposit(db, eventId, { amount: 15000, payment_method: 'cash' }, actor);

  const statement = await finalStatement(db, eventId);
  assert.equal(statement.advances_applied, 15000);
  assert.equal(statement.balance_due, 20000, 'the balance drops, the total does not');
  assert.equal(statement.grand_total, 35000);

  const revenue = await db.get(
    `SELECT COALESCE(SUM(jl.credit),0) AS credited
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE a.code = '4010'`
  );
  assert.equal(Number(revenue.credited), 0, 'a deposit must never touch revenue');
});

test('settling a CONFIRMED event works without Planning, Finalized or In Progress', async () => {
  const result = await finaliseBilling(
    db, eventId,
    { payments: [{ method: 'cash', amount: 20000, reference_number: 'RCPT-1' }], entry_date: DAY },
    actor
  );

  assert.equal(result.revenue_recognised, 35000, 'the whole event is recognised at settlement');
  assert.equal(result.advances_applied, 15000, 'the advance is released, not re-earned');
  assert.equal(result.collected, 20000);
  assert.equal(result.event.status, 'COMPLETED', 'settling is what completes the event');
  assert.equal(result.event.payment_status, 'PAID');
});

test('settlement issued a real bill from the shared sequence', async () => {
  const bill = await db.get(`SELECT * FROM bills WHERE idempotency_key = ?`, [`event-sale-${eventId}`]);
  assert.ok(bill, 'an event must produce a bill, or no sales report will ever see it');
  // Same shape the POS issues (B001, B002 …) because it is the same sequence.
  assert.match(bill.bill_number, /^B\d+$/, 'it takes a number from the shared bill sequence');
  assert.equal(Number(bill.grand_total), 35000);
  assert.equal(bill.status, 'paid');
  assert.equal(Number(bill.outstanding_amount), 0);
  assert.ok(bill.business_day_id, 'and belongs to the business day it was settled on');
  assert.ok(bill.journal_id, 'and names the journal entry it belongs to');
  assert.ok(bill.order_id, 'and hangs on an order, as every bill does');
});

test('the bill records how it was paid, advance included', async () => {
  const bill = await db.get(`SELECT id FROM bills WHERE idempotency_key = ?`, [`event-sale-${eventId}`]);
  const rows = await db.all(
    `SELECT payment_method, amount FROM bill_payments WHERE bill_id = ? ORDER BY payment_method`,
    [bill.id]
  );
  const byMethod = Object.fromEntries(rows.map((r) => [r.payment_method, Number(r.amount)]));
  assert.equal(byMethod.advance, 15000, 'the advance is money the guest paid for this bill');
  assert.equal(byMethod.cash, 20000);
  assert.equal(
    Object.values(byMethod).reduce((a, b) => a + b, 0), 35000,
    'the payments must add up to the bill, or it looks short-paid'
  );
});

test('exactly one journal and one bill exist for the event', async () => {
  const journals = await db.all(
    `SELECT id FROM journal_entries WHERE source_type = 'event_sale' AND source_id = ?`, [eventId]
  );
  assert.equal(journals.length, 1, 'one settlement, one entry');

  const bills = await db.all(`SELECT id FROM bills WHERE idempotency_key = ?`, [`event-sale-${eventId}`]);
  assert.equal(bills.length, 1, 'one settlement, one bill');

  // The bill posts no journal of its own — that would double the revenue.
  const fromBills = await db.all(
    `SELECT id FROM journal_entries WHERE source_type = 'bill'`
  );
  assert.equal(fromBills.length, 0, 'the event bill must not post a second journal');
});

test('revenue was credited once, net of the advance release', async () => {
  const rows = await db.all(
    `SELECT a.code, COALESCE(SUM(jl.debit),0) AS debit, COALESCE(SUM(jl.credit),0) AS credit
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.source_type = 'event_sale' GROUP BY a.code`
  );
  const by = Object.fromEntries(rows.map((r) => [r.code, { debit: Number(r.debit), credit: Number(r.credit) }]));

  assert.equal(by['4010'].credit, 35000, 'revenue credited once, for the whole event');
  assert.equal(by['2030'].debit, 15000, 'the liability is cleared by exactly the advance held');
  assert.equal(by['1010'].debit, 20000, 'only the balance moved cash today');

  const debits = rows.reduce((s, r) => s + Number(r.debit), 0);
  const credits = rows.reduce((s, r) => s + Number(r.credit), 0);
  assert.equal(debits, credits, 'the entry balances');
});

test('a second settlement is refused', async () => {
  await assert.rejects(
    () => finaliseBilling(db, eventId, { payments: [{ method: 'cash', amount: 20000 }] }, actor),
    (e) => e.status === 409 && e.code === 'already_billed',
    'double-clicking Bill Event must not produce a second sale'
  );

  const bills = await db.all(`SELECT id FROM bills WHERE idempotency_key = ?`, [`event-sale-${eventId}`]);
  assert.equal(bills.length, 1, 'and must not leave a second bill behind');
});

test('an uncommitted event cannot be settled at all', async () => {
  await db.run(
    `INSERT INTO events
       (event_number, event_type, event_date, status, payment_status,
        subtotal, total_amount, outstanding_amount, created_at, updated_at)
     VALUES ('EVT-TEST-2', 'Enquiry', ?, 'INQUIRY', 'UNPAID', 5000, 5000, 5000,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [DAY]
  );
  const ev = await db.get(`SELECT id FROM events WHERE event_number = 'EVT-TEST-2'`);
  await assert.rejects(
    () => finaliseBilling(db, ev.id, { payments: [{ method: 'cash', amount: 5000 }] }, actor),
    (e) => e.status === 409 && e.code === 'not_billable'
  );
});

test('a bills-based report now sees the event, classified as the Event channel', async () => {
  // This is the query shape lib/analytics.js and the Sales Report use. Before
  // settlement wrote a bill, an event was invisible to every one of them.
  // Scoped to event-linked orders because the SQLite fixture ships demo bills.
  const rows = await db.all(
    `SELECT b.bill_number, b.grand_total, ${normalizedOrderTypeSql('o')} AS channel
       FROM bills b JOIN orders o ON o.id = b.order_id
      WHERE b.status IN ('paid','partially_paid') AND o.event_id IS NOT NULL`
  );
  assert.equal(rows.length, 1, 'exactly one event bill, not two');
  assert.equal(Number(rows[0].grand_total), 35000);
  assert.equal(rows[0].channel, 'event', 'and it filters as Event, not Dine in');
});

test('restaurant and event bills total correctly side by side', async () => {
  // A plain restaurant sale, through the ordinary tables, tagged so this
  // assertion is independent of the fixture's demo bills.
  const orderNo = 'ORD-REST-1';
  await db.run(
    // table_number matters: the channel rule reads a table-less order as
    // takeaway, so a dine-in fixture has to actually sit at a table.
    `INSERT INTO orders (order_number, order_type, table_number, status, notes, created_at, updated_at)
     VALUES (?, 'dine_in', 'T-04', 'completed', 'recon-fixture', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [orderNo]
  );
  const order = await db.get(`SELECT id FROM orders WHERE order_number = ?`, [orderNo]);
  await db.run(
    `INSERT INTO bills (bill_number, order_id, subtotal, tax, grand_total, status, created_at)
     VALUES ('B900', ?, 15000, 0, 15000, 'paid', CURRENT_TIMESTAMP)`,
    [order.id]
  );

  const rows = await db.all(
    `SELECT ${normalizedOrderTypeSql('o')} AS channel, COALESCE(SUM(b.grand_total),0) AS total
       FROM bills b JOIN orders o ON o.id = b.order_id
      WHERE b.status IN ('paid','partially_paid')
        AND (o.event_id IS NOT NULL OR COALESCE(o.notes,'') = 'recon-fixture')
      GROUP BY ${normalizedOrderTypeSql('o')}`
  );
  const by = Object.fromEntries(rows.map((r) => [r.channel, Number(r.total)]));

  assert.equal(by.dine_in, 15000, 'Restaurant Sales');
  assert.equal(by.event, 35000, 'Event Sales');
  assert.equal(
    Object.values(by).reduce((a, b) => a + b, 0), 50000,
    'Restaurant 15,000 + Event 35,000 = Total 50,000 — and never 85,000'
  );
});

test('the Summary Report counts the event once, even though a bill now exists', async () => {
  // The bill is what makes an event visible to Analytics and the Sales Report.
  // The risk that creates is the opposite one: the Summary Report measures
  // revenue from journals, so if the bill ever posted its own journal the event
  // would be counted twice. This is the assertion that would catch it.
  await ensureStockMovementsTable(db);
  await ensureRecipeTables(db);
  await db.run(`CREATE TABLE IF NOT EXISTS wastage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_item_id INTEGER,
    quantity REAL, reason TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
  for (const [t, c, ty] of [['expenses', 'payment_method', 'TEXT'], ['expenses', 'source_type', 'TEXT']]) {
    await ensureColumn(db, t, c, ty).catch(() => {});
  }

  const r = await buildSummaryReport(db, { start: DAY, end: DAY });

  assert.equal(r.revenue.events, 35000, 'the event is reported at its full value');
  assert.equal(r.events.settlements, 1, 'once');
  assert.equal(r.events.advances_applied, 15000);
  assert.equal(
    r.revenue.gross, round2(r.revenue.restaurant + r.revenue.events),
    'total sales is exactly restaurant + events'
  );
  assert.notEqual(r.revenue.events, 70000, 'the event must not be doubled by its own bill');
});

test('event Cash + Credit split uses the shared customer ledger and recognises the full sale once', async () => {
  await db.run(
    `INSERT INTO customers (name, phone, current_credit, credit_limit, is_blacklisted)
     VALUES ('Event Credit Guest', '9800000001', 0, 50000, 0)`
  );
  const customer = await db.get(`SELECT * FROM customers WHERE phone = '9800000001'`);
  await db.run(
    `INSERT INTO events
       (event_number, event_type, event_date, status, payment_status, customer_id,
        subtotal, total_amount, outstanding_amount, created_at, updated_at)
     VALUES ('EVT-CREDIT-1', 'Wedding', ?, 'CONFIRMED', 'UNPAID', ?,
             35000, 35000, 35000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [DAY, customer.id]
  );
  const creditEvent = await db.get(`SELECT id FROM events WHERE event_number = 'EVT-CREDIT-1'`);
  await db.run(
    `INSERT INTO event_menu_lines
       (event_id, line_type, item_name, quantity, unit_price, line_total,
        is_complimentary, consumes_inventory, sort_order, created_at, updated_at)
     VALUES (?, 'package', 'Wedding package', 50, 700, 35000, 0, 1, 0,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [creditEvent.id]
  );

  const result = await finaliseBilling(db, creditEvent.id, {
    allocations: [
      { method: 'cash', amount: 10000, cash_tendered: 10000 },
      { method: 'credit', amount: 25000, due_date: '2026-09-20', notes: 'Wedding balance' },
    ],
    entry_date: DAY,
  }, actor);

  assert.equal(result.revenue_recognised, 35000, 'credit delays cash, never revenue recognition');
  assert.equal(result.collected, 10000);
  assert.equal(result.bill.status, 'partially_paid');
  assert.equal(result.bill.outstanding, 25000);
  assert.equal(result.event.payment_status, 'PARTIALLY_PAID');
  assert.equal(Number(result.event.deposit_total), 10000, 'credit is not a deposit or receipt');

  const allocations = await db.all(
    `SELECT method, amount, settlement_status FROM bill_payment_allocations
      WHERE bill_id = ? ORDER BY method`, [result.bill.bill_id]
  );
  assert.deepEqual(allocations.map((r) => [r.method, Number(r.amount), r.settlement_status]), [
    ['cash', 10000, 'received'],
    ['credit', 25000, 'outstanding'],
  ]);
  const ledger = await db.get(
    `SELECT debit, entry_type FROM customer_ledger WHERE bill_id = ?`, [result.bill.bill_id]
  );
  assert.equal(Number(ledger.debit), 25000);
  assert.equal(ledger.entry_type, 'credit_sale');
  const afterSale = await db.get('SELECT current_credit FROM customers WHERE id = ?', [customer.id]);
  assert.equal(Number(afterSale.current_credit), 25000);

  const revenueBeforeCollection = await db.get(
    `SELECT COALESCE(SUM(jl.credit-jl.debit),0) AS amount
       FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE a.code='4010'`
  );
  const collection = await collectCreditBalance(db, {
    billId: result.bill.bill_id,
    allocations: [{ method: 'cash', amount: 10000, cash_tendered: 10000 }],
    actorRole: 'admin', requestKey: 'event-credit-collection-1',
  });
  assert.equal(collection.outstanding, 15000);
  const afterCollection = await db.get('SELECT current_credit FROM customers WHERE id = ?', [customer.id]);
  assert.equal(Number(afterCollection.current_credit), 15000);
  const eventAfterCollection = await db.get(
    'SELECT outstanding_amount, payment_status, deposit_total FROM events WHERE id=?', [creditEvent.id]
  );
  assert.equal(Number(eventAfterCollection.outstanding_amount), 15000);
  assert.equal(eventAfterCollection.payment_status, 'PARTIALLY_PAID');
  assert.equal(Number(eventAfterCollection.deposit_total), 20000,
    'the event payment history stays in sync when shared AR receives money');
  const eventCollection = await db.get(
    `SELECT amount, payment_method FROM event_deposits
      WHERE event_id=? AND notes LIKE 'Credit collection%'`, [creditEvent.id]
  );
  assert.equal(Number(eventCollection.amount), 10000);
  assert.equal(eventCollection.payment_method, 'cash');
  const revenueAfterCollection = await db.get(
    `SELECT COALESCE(SUM(jl.credit-jl.debit),0) AS amount
       FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE a.code='4010'`
  );
  assert.equal(Number(revenueAfterCollection.amount), Number(revenueBeforeCollection.amount),
    'collecting event credit moves AR to cash and must not create a second sale');
});
