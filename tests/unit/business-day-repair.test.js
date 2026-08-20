/**
 * The sale-journal repair that runs when a business day closes.
 *
 * It exists to back-post a journal for a settled bill that never got one. Two
 * things went wrong with it and both were found in production:
 *
 *  1. It treated an event bill as unjournalled. Event settlements post under
 *     source_type 'event_sale', not 'bill', so the repair saw a paid bill with
 *     no sale journal and would have posted a SECOND revenue entry — doubling
 *     that event's sale in the P&L.
 *
 *  2. It built entry_date with String(bill.paid_at).slice(0, 10). Postgres
 *     returns a Date, whose toString is "Thu Aug 20 2026 …", so the slice
 *     produced "Thu Aug 20" and the INSERT died on an invalid date. That took
 *     the whole business-day open down with it — the user saw only
 *     "Could not open the business day."
 *
 * The guard is a SQL WHERE clause and the date fix is one call, so both are
 * asserted against the source. The behavioural half — that a Date coerces to a
 * real ISO day — is exercised directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { nepalDateString } from '../../lib/report-dates.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = fs.readFileSync(path.join(root, 'lib/business-days.js'), 'utf8');

/** Just the repair function. */
const repair = src.slice(
  src.indexOf('async function repairMissingSaleJournals'),
  src.indexOf('export async function businessDayContext')
);

test('the repair skips a bill that already names its journal', () => {
  assert.match(
    repair, /AND b\.journal_id IS NULL/,
    'a bill carrying journal_id is already journalled and must not be repaired'
  );
});

test('the repair skips event-linked bills', () => {
  assert.match(
    repair,
    /NOT EXISTS \(\s*SELECT 1 FROM orders o WHERE o\.id = b\.order_id AND o\.event_id IS NOT NULL\s*\)/,
    'an event bill is journalled under source_type event_sale, not bill'
  );
});

test('the repair still fixes an ordinary unjournalled bill', () => {
  // The guards must narrow the query, not disable it: a genuine restaurant bill
  // with payments and no journal is exactly what this function is for.
  assert.match(repair, /source_type = 'bill' AND je\.source_id = b\.id/);
  assert.match(repair, /FROM bill_payments p WHERE p\.bill_id = b\.id/);
  assert.match(repair, /postSaleJournal\(/);
});

test('entry_date is built with the date-aware helper, not a string slice', () => {
  assert.match(repair, /entry_date: businessDateKey\(bill\.paid_at \|\| bill\.created_at\)/);
  assert.ok(
    !/entry_date: String\(bill\.paid_at/.test(repair),
    'String(Date).slice(0, 10) yields "Thu Aug 20" and Postgres rejects it'
  );
});

test('a Date coerces to an ISO day, which is what broke', () => {
  const stamp = new Date('2026-08-20T00:58:44.000Z');

  // The old expression, shown failing.
  assert.equal(String(stamp).slice(0, 10).includes('-'), false);
  assert.match(String(stamp).slice(0, 10), /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2}$/);

  // What the helper produces instead.
  assert.match(nepalDateString(stamp), /^\d{4}-\d{2}-\d{2}$/);
});

test('businessDateKey handles every shape a driver returns', async () => {
  // Not exported, so it is re-derived here from the same source to prove the
  // branches it relies on exist.
  assert.match(src, /const businessDateKey = \(value\) => \{/);
  assert.match(src, /if \(value instanceof Date\) return nepalDateString\(value\)/,
    'a Date must go through nepalDateString');
  assert.match(src, /if \(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(raw\)\) return raw/,
    'an ISO string passes through untouched');
});
