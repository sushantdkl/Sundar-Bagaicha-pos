import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { getNepaliDateString } from '../../lib/time-utils.js';
import { businessDayContext, openBusinessDay } from '../../lib/business-days.js';

const actor = { id: 1, full_name: 'Admin One', role: 'admin' };
const yesterday = (() => {
  const date = new Date(`${getNepaliDateString()}T12:00:00+05:45`);
  date.setUTCDate(date.getUTCDate() - 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(date);
})();

async function withDb(run) {
  const dbPath = path.join(os.tmpdir(), `business-day-auto-close-${process.pid}-${Date.now()}-${Math.random()}.db`);
  const db = new PosDatabase(dbPath);
  try { await run(db); }
  finally {
    try { db.close(); } catch { /* already closed */ }
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
    }
  }
}

test('a stale day with no unresolved work closes automatically on the next status request', async () => withDb(async (db) => {
  const opened = await openBusinessDay(db, { business_date: yesterday, opening_cash: 500 }, actor);
  const context = await businessDayContext(db);
  assert.equal(context.current, null);
  assert.equal(context.previous.id, opened.id);
  assert.equal(context.previous.status, 'closed');
  assert.equal(Number(context.previous.counted_cash), 500);
  const audit = await db.get(`SELECT action FROM business_day_audit WHERE business_day_id=? ORDER BY id DESC LIMIT 1`, [opened.id]);
  assert.equal(audit.action, 'business_day_auto_closed');

  const todayDay = await openBusinessDay(db, { business_date: getNepaliDateString(), opening_cash: 500 }, actor);
  const twoDaysAgo = new Date(`${yesterday}T12:00:00+05:45`);
  twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 1);
  const staleDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(twoDaysAgo);
  await db.run(`UPDATE business_days SET business_date=? WHERE id=?`, [staleDate, todayDay.id]);
  await db.run(`INSERT INTO orders (order_number,status,business_day_id,created_at) VALUES ('AUTO-BLOCK','pending',?,CURRENT_TIMESTAMP)`, [todayDay.id]);
  const blocked = await businessDayContext(db);
  assert.equal(blocked.current.id, todayDay.id);
  assert.equal(blocked.current.isStale, true);
  assert.ok(blocked.activeSession);
}));
