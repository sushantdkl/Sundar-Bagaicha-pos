/**
 * Cash In / Cash Out drawer movements — journaled, never sales revenue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { ensureAccountingSchema, accountBalance, postJournal } from '../../lib/accounting.js';
import { recordCashMovement, listCashMovements } from '../../lib/accounting-cash.js';
import { openBusinessDay, businessDaySummary } from '../../lib/business-days.js';
import { getNepaliDateString } from '../../lib/time-utils.js';

const dbPath = path.join(os.tmpdir(), `cash-movement-test-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
  }
});

const admin = { id: 1, full_name: 'Admin One', role: 'admin' };

test('owner contribution cash-in increases drawer expected cash without sales revenue', async () => {
  await ensureAccountingSchema(db);
  const day = await openBusinessDay(db, { business_date: getNepaliDateString(), opening_cash: 1000 }, admin);
  const drawer = await db.get(`SELECT id FROM cash_drawers ORDER BY id LIMIT 1`);

  const before = await accountBalance(db, '1010', { drawerId: drawer.id });
  const result = await recordCashMovement(db, {
    direction: 'in',
    movement_type: 'owner_contribution',
    amount: 500,
    reason: 'Owner put float in till',
    created_by: admin.id,
    drawer_id: drawer.id,
    business_day_id: day.id,
    external_ref: `test-in-${Date.now()}`,
  });
  assert.equal(result.direction, 'in');
  assert.equal(result.amount, 500);

  const after = await accountBalance(db, '1010', { drawerId: drawer.id });
  assert.equal(after, before + 500);

  const sales = await db.get(
    `SELECT COALESCE(SUM(jl.credit),0) AS rev
     FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id JOIN accounts a ON a.id=jl.account_id
     WHERE a.code='4010' AND je.source_type='cash_movement'`
  );
  assert.equal(Number(sales.rev), 0);

  const summary = await businessDaySummary(db, day.id);
  assert.ok(Number(summary.cash.breakdown.cash_in) >= 500);
  assert.equal(Number(summary.cash.expected_cash), Number(summary.cash.breakdown.opening_cash) + Number(summary.cash.ledger_movement));

  const history = await listCashMovements(db, { drawerId: drawer.id });
  assert.ok(history.some((row) => Number(row.cash_delta) === 500));
});

test('cash-out to safe decreases drawer cash and posts to safe asset', async () => {
  await ensureAccountingSchema(db);
  const drawer = await db.get(`SELECT id FROM cash_drawers ORDER BY id LIMIT 1`);
  const day = await db.get(`SELECT id FROM business_days WHERE status='open' ORDER BY id DESC LIMIT 1`);

  // Seed safe with a prior journal so transfer_from_safe isn't required here.
  await postJournal(db, {
    memo: 'Seed safe',
    source_type: 'manual',
    created_by: admin.id,
    business_day_id: day.id,
    lines: [
      { code: '1030', debit: 200, credit: 0 },
      { code: '3010', debit: 0, credit: 200 },
    ],
  });

  const beforeCash = await accountBalance(db, '1010', { drawerId: drawer.id });
  const beforeSafe = await accountBalance(db, '1030');

  await recordCashMovement(db, {
    direction: 'out',
    movement_type: 'transfer_to_safe',
    amount: 200,
    reason: 'Moved evening float to safe',
    created_by: admin.id,
    drawer_id: drawer.id,
    business_day_id: day.id,
    external_ref: `test-out-${Date.now()}`,
  });

  assert.equal(await accountBalance(db, '1010', { drawerId: drawer.id }), beforeCash - 200);
  assert.equal(await accountBalance(db, '1030'), beforeSafe + 200);
});

test('rejects cash-out without a reason', async () => {
  await ensureAccountingSchema(db);
  const drawer = await db.get(`SELECT id FROM cash_drawers ORDER BY id LIMIT 1`);
  await assert.rejects(
    () => recordCashMovement(db, {
      direction: 'out',
      movement_type: 'other',
      amount: 10,
      reason: 'x',
      created_by: admin.id,
      drawer_id: drawer.id,
    }),
    /reason/i
  );
});
