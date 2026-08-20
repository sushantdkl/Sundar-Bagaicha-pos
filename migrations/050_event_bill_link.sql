-- 050: give an event settlement a real bill, and index the paths that read it.
--
-- Until now an event's revenue existed only as a journal entry
-- (source_type = 'event_sale'). That reaches the trial balance and the P&L, but
-- every operational sales surface in this system -- the Dashboard, Analytics,
-- the Sales Report -- reads FROM bills. The result was a business whose
-- accounts showed a Rs 320,000 wedding that its own sales report did not.
--
-- Settlement now writes a bill from the shared BILL sequence, so an event sale
-- is reported, filtered and printed exactly like a restaurant sale.
--
-- journal_id links the bill back to the single authoritative entry. It is not
-- decoration: the bill must never post a journal of its own, because the
-- settlement already posted one, and this column is what records which entry a
-- bill belongs to. Nullable, because every historical restaurant bill predates
-- it and its journal is found by source_type/source_id instead.
--
-- Additive and nullable-safe throughout: no existing row changes value.

ALTER TABLE bills ADD COLUMN IF NOT EXISTS journal_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL;

-- Settlement looks up "the order this event's bill hangs on", preferring the
-- fulfilment order. 047 already indexes (event_id, event_production); this
-- covers the plain event_id lookups that billing and reporting both make.
CREATE INDEX IF NOT EXISTS idx_orders_event_id
  ON orders(event_id) WHERE event_id IS NOT NULL;

-- The duplicate-settlement guard reads journal_entries by source before every
-- settlement, and the Summary Report aggregates event_sale entries by date.
CREATE INDEX IF NOT EXISTS idx_journal_entries_source
  ON journal_entries(source_type, source_id);

-- Event expenses are attributed by event_id and read per event on the
-- profitability screen.
CREATE INDEX IF NOT EXISTS idx_expenses_event_id
  ON expenses(event_id) WHERE event_id IS NOT NULL;

-- One settled bill per event, enforced by the database rather than by the
-- application remembering to check. Settlement writes idempotency_key
-- 'event-sale-<id>', so a retry or a double-click collides here even if every
-- guard above it were removed.
-- (ux_bills_idempotency_key from migration 026 already provides this; the
--  comment records why event billing depends on it.)
