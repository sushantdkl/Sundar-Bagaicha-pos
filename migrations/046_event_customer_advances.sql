-- 046: liability account for event deposits.
--
-- Money taken before an event happens is NOT revenue. The venue owes the client
-- either the event or the money back, so an advance is a liability until the
-- event is fulfilled and invoiced.
--
-- Booking a deposit posts:
--     Dr  Cash / Bank / QR clearing      (the asset that actually moved)
--     Cr  2030 Event Customer Advances   (what we now owe)
--
-- and Phase 14 releases it at final billing:
--     Dr  2030 Event Customer Advances
--     Cr  4010 Sales Revenue  (+ 2020 VAT where applicable)
--
-- Recognising it as sales on receipt would overstate revenue in the month the
-- deposit lands and understate it in the month the event runs, and would
-- overstate profit on any event that is later cancelled and refunded.
--
-- Idempotent: ON CONFLICT DO NOTHING, and the parent is resolved by code so
-- this works whether or not account ids match another installation.

INSERT INTO accounts (code, name, type, subtype, parent_id, is_active, is_system)
SELECT '2030', 'Event Customer Advances', 'liability', 'customer_advance', id, 1, 1
FROM accounts WHERE code = '2000'
ON CONFLICT (code) DO NOTHING;

-- Deposits are read per event and per business day constantly (dashboard,
-- BEO, final billing), and by journal for reconciliation.
CREATE INDEX IF NOT EXISTS idx_event_deposits_journal ON event_deposits(journal_id);
CREATE INDEX IF NOT EXISTS idx_event_deposits_schedule ON event_deposits(schedule_id);
