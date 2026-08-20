/**
 * Find — and optionally reopen — events that were completed without ever being
 * settled.
 *
 * Before this release, COMPLETED was a status anyone could pick from a list.
 * An event closed that way books no revenue and never releases the advance it
 * is holding, so the money sits in 2030 Event Customer Advances forever: the
 * customer has paid, the business has the cash, and the books show a liability
 * instead of a sale.
 *
 * The lifecycle no longer allows it (settlement is the only route to COMPLETED),
 * but events closed before the fix are still stranded. This script finds them.
 *
 *   node --env-file-if-exists=.env scripts/repair-unsettled-events.mjs
 *   node --env-file-if-exists=.env scripts/repair-unsettled-events.mjs --fix
 *
 * Without --fix it only reports. With --fix it reopens each event to CONFIRMED
 * and clears completed_at, so it can be settled properly through Bill Event.
 *
 * It deliberately does NOT post the settlement itself. How an old booking is
 * recognised — settle it at the original value, discount it, refund it — is a
 * business decision with tax consequences, and it should be made by a person
 * looking at the event, not by a script looping over rows. All this does is
 * unblock that decision, and it writes an audit entry saying it did.
 */
import Database from '../lib/db/index.js';
import { logEventAudit } from '../lib/events/audit.js';

const FIX = process.argv.includes('--fix');
const money = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
// Postgres hands back a Date, SQLite a string; both render as a plain date here.
const day = (v) => (v instanceof Date ? v.toISOString() : String(v || '')).slice(0, 10);

const db = Database.getInstance();

try {
  const stranded = await db.all(`
    SELECT e.id, e.event_number, e.event_type, e.title, e.event_date, e.status,
           e.payment_status, e.completed_at, e.total_amount,
           COALESCE((SELECT SUM(CASE WHEN d.entry_type = 'refund' THEN -d.amount ELSE d.amount END)
                       FROM event_deposits d
                      WHERE d.event_id = e.id AND d.status = 'active'), 0) AS held
      FROM events e
     WHERE e.status = 'COMPLETED'
       AND NOT EXISTS (
         SELECT 1 FROM journal_entries je
          WHERE je.source_type = 'event_sale' AND je.source_id = e.id
       )
     ORDER BY e.event_date
  `);

  if (!stranded.length) {
    console.log('No stranded events. Every completed event has a settlement journal.');
    process.exit(0);
  }

  console.log(`${stranded.length} completed event(s) with no settlement journal:\n`);
  let totalUnrecognised = 0;
  let totalHeld = 0;

  for (const e of stranded) {
    totalUnrecognised += Number(e.total_amount || 0);
    totalHeld += Number(e.held || 0);
    console.log(`  ${e.event_number}  ${e.title || e.event_type}`);
    console.log(`    event date       ${day(e.event_date)}`);
    console.log(`    completed at     ${e.completed_at}`);
    console.log(`    quoted total     ${money(e.total_amount)}`);
    console.log(`    advances held    ${money(e.held)}  ← sitting in 2030, not recognised as revenue`);
    console.log('');
  }

  console.log(`  Unrecognised sales: ${money(totalUnrecognised)}`);
  console.log(`  Advances held:      ${money(totalHeld)}\n`);

  if (!FIX) {
    console.log('Dry run. Re-run with --fix to reopen these events so they can be billed.');
    console.log('Nothing has been changed.');
    process.exit(0);
  }

  for (const e of stranded) {
    await db.transaction(async (tx) => {
      const claim = await tx.run(
        `UPDATE events
            SET status = 'CONFIRMED', completed_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'COMPLETED' AND completed_at IS NOT NULL`,
        [e.id]
      );
      if (!claim?.changes) {
        console.log(`  ${e.event_number} changed underneath us — skipped.`);
        return;
      }
      await logEventAudit(tx, {
        action: 'event_status_changed',
        eventId: e.id,
        entityType: 'event',
        entityId: e.id,
        actor: { id: null, full_name: 'repair-unsettled-events script' },
        reason: 'Reopened for settlement: completed before the lifecycle required billing, so no revenue was ever recognised.',
        previous: { status: 'COMPLETED', completed_at: e.completed_at },
        next: { status: 'CONFIRMED' },
      });
      console.log(`  ${e.event_number} reopened to CONFIRMED.`);
    });
  }

  console.log('\nDone. Open each event and use Bill Event to settle it.');
  console.log('An event whose advance already covers the total settles by collecting nothing:');
  console.log('the advance is released to revenue and a bill is issued.');
} finally {
  await Database.close();
}
