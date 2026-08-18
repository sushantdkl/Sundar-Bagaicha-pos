/**
 * Corrections & reversals. Everything here is expressed as a normal journal
 * through postJournal — no new accounting logic, just mirror/contra entries:
 *
 *   - reverseJournal: post the exact opposite of an existing journal
 *   - refund:         Dr Sales Revenue / Cr the medium refunded (bill-level void
 *                     lives in bill-corrections.js, which reuses reverseJournal)
 *
 * A journal can only be reversed once (source_type='reversal', source_id = the
 * original journal id → unique index). Void reuses that guard, so a bill can't
 * be voided twice.
 */

import { postJournal, paymentAccountCode, accountBalance, currentDrawerId } from './accounting.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const conflict = (m) => Object.assign(new Error(m), { status: 409 });

/** Post the mirror of an existing journal. Debits become credits and vice versa. */
export async function reverseJournal(db, { journal_id, reason, created_by = null }) {
  const original = await db.get(`SELECT * FROM journal_entries WHERE id = ?`, [journal_id]);
  if (!original) throw bad('Journal not found.');
  if (original.source_type === 'reversal') throw conflict('That entry is itself a reversal.');
  const already = await db.get(`SELECT id FROM journal_entries WHERE source_type = 'reversal' AND source_id = ?`, [journal_id]);
  if (already) throw conflict('This journal has already been reversed.');

  const lines = await db.all(`SELECT * FROM journal_lines WHERE journal_id = ?`, [journal_id]);
  if (!lines.length) throw bad('Journal has no lines to reverse.');

  const mirror = lines.map((l) => ({
    account_id: l.account_id,
    debit: round2(l.credit),
    credit: round2(l.debit),
    drawer_id: l.drawer_id || null,
    bank_account_id: l.bank_account_id || null,
    memo: 'reversal',
  }));

  // Runs on the passed db so it composes inside a caller's transaction
  // (e.g. an operational void). Callers that need atomicity wrap it.
  return postJournal(db, {
    memo: `Reversal of #${journal_id}${reason ? ` — ${reason}` : ''}`,
    source_type: 'reversal',
    source_id: journal_id,
    created_by,
    lines: mirror,
  });
}

/** Refund: money returned to the customer. Dr Sales Revenue, Cr the medium refunded. */
export async function refund(db, { amount, method, bill_id = null, reason, created_by = null, external_ref = null, allow_negative = false, business_day_id = null }) {
  const amt = round2(amount);
  if (!(amt > 0)) throw bad('Refund amount must be greater than zero.');
  const code = paymentAccountCode(method); // throws on unknown — never silent cash
  const drawerId = code === '1010' ? await currentDrawerId(db) : null;

  if (!allow_negative && (code === '1010' || code === '1020')) {
    const bal = await accountBalance(db, code, code === '1010' ? { drawerId } : {});
    if (amt > round2(bal) + 0.001) throw bad(`Not enough ${method} to refund (have ${round2(bal)}).`);
  }

  // Runs on the passed db so it composes inside a caller's transaction.
  return postJournal(db, {
    memo: `Refund${bill_id ? ` — bill ${bill_id}` : ''}${reason ? ` — ${reason}` : ''}`,
    source_type: 'refund',
    source_id: null,
    external_ref,
    created_by,
    business_day_id,
    lines: [
      { code: '4010', debit: amt, credit: 0, memo: 'sales refund' },
      { code, debit: 0, credit: amt, drawer_id: drawerId, memo: `refunded ${method}` },
    ],
  });
}

/** Recent corrections for the page's history list. */
export async function listCorrections(db, limit = 50) {
  return db.all(
    `SELECT je.id, je.entry_date, je.memo, je.source_type, je.source_id, je.created_at, u.full_name AS by_name,
       (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE journal_id = je.id) AS amount
     FROM journal_entries je LEFT JOIN users u ON je.created_by = u.id
     WHERE je.source_type IN ('reversal','refund')
     ORDER BY je.id DESC LIMIT ${Number(limit) || 50}`
  );
}
