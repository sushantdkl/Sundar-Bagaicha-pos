-- 047: mark the order that fulfils an event's contracted quotation.
--
-- Starting an event creates one operational order for the food already sold on
-- the quotation. Additional orders raised during the event -- extra drinks, a
-- late round of snacks -- are genuinely new sales on top of it.
--
-- Without a way to tell them apart, summing every event-linked order counts the
-- contracted buffet twice: once in the quotation total and again as "additional
-- sales". QA caught exactly that (4,200 of extras reported as 54,200).
--
-- event_production = 1 marks the fulfilment order, so billing and the live
-- screen can add the extras without re-adding what was already quoted.
--
-- Nullable-safe and additive: every existing row defaults to 0, which is
-- correct -- no historical order fulfils an event.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS event_production INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_event_production
  ON orders(event_id, event_production) WHERE event_id IS NOT NULL;
