import test from 'node:test';
import assert from 'node:assert/strict';

import { formatNepalClock, formatNepalDate, getNepaliDateString, parseDbDate } from '../../lib/time-utils.js';
import { adaptSqlForPostgres } from '../../lib/db/sql.js';

test('database timestamps without a suffix are treated as UTC and displayed in Nepal time', () => {
  const timestamp = '2026-08-12 20:00:00';
  assert.equal(parseDbDate(timestamp).toISOString(), '2026-08-12T20:00:00.000Z');
  assert.equal(getNepaliDateString(timestamp), '2026-08-13');
  assert.equal(formatNepalDate(timestamp), '13 Aug 2026');
  assert.match(formatNepalClock(timestamp), /01:45 AM/i);
});

test('Nepal-shifted SQLite calendar dates are translated for Postgres', () => {
  const sql = adaptSqlForPostgres("SELECT date(o.created_at, '+5 hours', '+45 minutes') AS day FROM orders o");
  assert.match(sql, /Asia\/Kathmandu/);
  assert.match(sql, /::date/);
});

