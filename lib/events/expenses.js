/**
 * Event expenses.
 *
 * There is deliberately no event-expense engine here. Costs are created through
 * the ordinary /api/admin/expenses endpoint with event_id set, so they post the
 * same journal (Dr expense / Cr the funding account) through
 * postExpenseJournal() and appear in the expense reports exactly as any other
 * cost does. This module only reads them back grouped by event.
 *
 * What is deliberately NOT counted as event cost:
 *
 *   a whole purchase invoice
 *     Buying 50kg of chicken for a wedding and using 30kg leaves 20kg on the
 *     shelf. Charging the invoice to the event overstates its cost and
 *     understates the restaurant's. Food cost comes from actual recipe
 *     consumption instead (lib/events/profitability.js), which is what the
 *     stock ledger already records.
 *
 * purchases.event_id exists as a procurement reference — "this delivery was
 * bought with that event in mind" — and is never summed into event cost.
 */
import { ensureEventsSchema } from './schema.js';
import { toId } from './ids.js';

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export async function eventExpenses(db, eventId) {
  await ensureEventsSchema(db);
  const event = await db.get('SELECT id, event_number FROM events WHERE id = ?', [toId(eventId, 'event')]);
  if (!event) fail('Event not found.', 404);

  const rows = await db.all(
    `SELECT e.id, e.description, e.category, e.amount, e.expense_date,
            e.payment_method, e.supplier, e.notes, e.source_type, e.receipt_url,
            u.full_name AS logged_by_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.logged_by
      WHERE e.event_id = ?
      ORDER BY e.expense_date DESC, e.id DESC`,
    [event.id]
  );

  const byCategory = new Map();
  for (const r of rows) {
    const key = r.category || 'Uncategorised';
    byCategory.set(key, round2((byCategory.get(key) || 0) + Number(r.amount || 0)));
  }

  // Deliveries bought with this event in mind — shown for reference, and
  // explicitly excluded from the cost total.
  let purchases = [];
  try {
    purchases = await db.all(
      `SELECT id, invoice_number, supplier, total, invoice_date
         FROM purchases WHERE event_id = ? ORDER BY id DESC`,
      [event.id]
    );
  } catch {
    // purchases.event_id arrives with migration 045; a database without it
    // simply has no procurement references to show.
  }

  return {
    event_id: event.id,
    event_number: event.event_number,
    expenses: rows,
    total: round2(rows.reduce((s, r) => s + Number(r.amount || 0), 0)),
    by_category: [...byCategory].map(([category, amount]) => ({ category, amount })),
    linked_purchases: purchases,
    purchases_note:
      'Linked purchases are a procurement reference only. Unused stock from a delivery stays with the restaurant, so invoices are never charged to an event — event food cost comes from actual consumption.',
  };
}
