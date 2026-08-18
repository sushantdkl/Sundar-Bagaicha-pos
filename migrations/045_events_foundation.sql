-- 045: Events / Banquet module — database foundation.
--
-- Additive and non-destructive by construction: every statement is
-- CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS. No existing row is read, rewritten or deleted, no column is dropped
-- or retyped, and no existing constraint is altered. Restaurant orders, bills,
-- payments, stock, journals and reports are untouched by this migration.
--
-- The event_id columns added to orders / expenses / purchases are NULLABLE with
-- no default, so every historical row stays valid and every existing INSERT
-- keeps working unchanged. A NULL event_id means "ordinary restaurant activity"
-- — which is exactly what all pre-existing rows are.
--
-- This phase creates structure only. It deliberately does NOT create POS orders,
-- KOTs, journals or stock movements; booking an event must never move stock.

-- ============================================================ EVENT SPACES
-- Bookable venues (garden, hall, private dining, rooftop, ...). Nothing here is
-- seeded: spaces are business configuration, entered in the admin UI.
CREATE TABLE IF NOT EXISTS event_spaces (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  min_capacity INTEGER CHECK (min_capacity IS NULL OR min_capacity >= 0),
  max_capacity INTEGER CHECK (max_capacity IS NULL OR max_capacity > 0),
  -- Standard venue/hire charge. Quoted per event unless overridden on the line.
  standard_charge NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (standard_charge >= 0),
  -- Blocking time either side of the event itself, used for overlap detection.
  setup_buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (setup_buffer_minutes >= 0),
  cleanup_buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_buffer_minutes >= 0),
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT event_spaces_capacity_order CHECK (
    min_capacity IS NULL OR max_capacity IS NULL OR max_capacity >= min_capacity
  )
);

CREATE INDEX IF NOT EXISTS idx_event_spaces_active ON event_spaces(is_active, display_order);

-- ========================================================= EVENT PACKAGES
-- Per-guest catering packages (veg / chicken / mutton buffet, ...). Prices live
-- in event_package_price_tiers, never in application code.
--
-- pricing_policy makes the tier maths explicit rather than implied:
--   whole_party  — every guest pays the tier matching the total guest count
--   progressive  — slab pricing; guests are charged per tier band they fall in
--   manual       — a negotiated rate is entered on the event, tiers are advisory
CREATE TABLE IF NOT EXISTS event_packages (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT UNIQUE,
  description TEXT,
  pricing_policy TEXT NOT NULL DEFAULT 'whole_party'
    CHECK (pricing_policy IN ('whole_party', 'progressive', 'manual')),
  -- Fallback per-guest price when no tier matches (e.g. below the lowest tier).
  base_price_per_guest NUMERIC(14,2) CHECK (base_price_per_guest IS NULL OR base_price_per_guest >= 0),
  min_guests INTEGER CHECK (min_guests IS NULL OR min_guests >= 0),
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_packages_active ON event_packages(is_active, display_order);

-- ============================================== EVENT PACKAGE PRICE TIERS
-- Guest-count bands. max_guests NULL = open-ended top band.
-- Example (configuration, not code): 1..50 -> 800, 51..NULL -> 600.
CREATE TABLE IF NOT EXISTS event_package_price_tiers (
  id SERIAL PRIMARY KEY,
  package_id INTEGER NOT NULL REFERENCES event_packages(id) ON DELETE CASCADE,
  min_guests INTEGER NOT NULL DEFAULT 1 CHECK (min_guests >= 1),
  max_guests INTEGER CHECK (max_guests IS NULL OR max_guests >= 1),
  price_per_guest NUMERIC(14,2) NOT NULL CHECK (price_per_guest >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT event_price_tier_band CHECK (max_guests IS NULL OR max_guests >= min_guests),
  CONSTRAINT event_price_tier_unique UNIQUE (package_id, min_guests)
);

CREATE INDEX IF NOT EXISTS idx_event_price_tiers_package
  ON event_package_price_tiers(package_id, min_guests);

-- ============================================== EVENT PACKAGE COMPONENTS
-- The food that makes up a package (rice, dal, chicken curry, salad, ...).
-- Reuses the existing menu/recipe engine by reference — recipes are NOT copied.
-- consumes_inventory = 0 marks a component that is deliberately not stock-backed
-- (an outsourced or service item), so nothing silently bypasses food costing.
CREATE TABLE IF NOT EXISTS event_package_components (
  id SERIAL PRIMARY KEY,
  package_id INTEGER NOT NULL REFERENCES event_packages(id) ON DELETE CASCADE,
  component_name TEXT NOT NULL,
  menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  quantity_per_guest NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (quantity_per_guest > 0),
  unit TEXT,
  is_optional INTEGER NOT NULL DEFAULT 0,
  consumes_inventory INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_package_components_package
  ON event_package_components(package_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_event_package_components_menu_item
  ON event_package_components(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_event_package_components_recipe
  ON event_package_components(recipe_id);

-- ==================================================================== EVENTS
-- One booking. status is the operational lifecycle; payment_status is tracked
-- independently so a CONFIRMED event can be UNPAID and a COMPLETED event can
-- still carry a balance.
--
-- event_type is intentionally free text backed by configuration (wedding,
-- conference, birthday, ...) rather than a CHECK list, so the venue can add
-- types without a migration. status / payment_status ARE constrained: they
-- drive money and stock behaviour and must not accept arbitrary values.
--
-- Money columns are NUMERIC(14,2) to match bills/journals. They are derived
-- totals maintained by the events service; they are not authoritative for
-- accounting — journal_lines remains the single source of financial truth.
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  event_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  -- Contact snapshot: a booking must stay readable even if the customer record
  -- is edited or unlinked later.
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  title TEXT,
  event_type TEXT NOT NULL,
  event_date DATE NOT NULL,
  -- Optional end date for events running past midnight.
  end_date DATE,
  -- 'HH:MM' local (Nepal) wall-clock, consistent with reservations.
  start_time TEXT,
  end_time TEXT,
  space_id INTEGER REFERENCES event_spaces(id) ON DELETE RESTRICT,
  expected_guests INTEGER CHECK (expected_guests IS NULL OR expected_guests >= 0),
  guaranteed_guests INTEGER CHECK (guaranteed_guests IS NULL OR guaranteed_guests >= 0),
  actual_guests INTEGER CHECK (actual_guests IS NULL OR actual_guests >= 0),
  status TEXT NOT NULL DEFAULT 'INQUIRY' CHECK (status IN (
    'INQUIRY', 'DRAFT', 'QUOTED', 'CONFIRMED', 'PLANNING',
    'FINALIZED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  )),
  payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN (
    'UNPAID', 'DEPOSIT_DUE', 'PARTIALLY_PAID', 'PAID', 'REFUNDED'
  )),
  notes TEXT,
  internal_notes TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  discount_reason TEXT,
  -- Percentages are snapshotted per event so a later settings change never
  -- silently re-prices a signed quotation. Amounts are computed with the same
  -- lib/billing-totals.js rules the restaurant bill uses.
  service_charge_percent NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (service_charge_percent >= 0),
  service_charge_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (service_charge_amount >= 0),
  tax_percent NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (tax_percent >= 0),
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  deposit_total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deposit_total >= 0),
  outstanding_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number >= 1),
  -- Lifecycle timestamps, written by the events service as status changes.
  quoted_at TIMESTAMP,
  confirmed_at TIMESTAMP,
  finalized_at TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  cancel_reason TEXT,
  -- Set when the event is STARTED (production released), not when it is booked:
  -- a future booking has no business day yet.
  business_day_id INTEGER REFERENCES business_days(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT events_date_order CHECK (end_date IS NULL OR end_date >= event_date)
);

CREATE INDEX IF NOT EXISTS idx_events_date_status ON events(event_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_payment_status ON events(payment_status);
CREATE INDEX IF NOT EXISTS idx_events_customer ON events(customer_id);
CREATE INDEX IF NOT EXISTS idx_events_space_date ON events(space_id, event_date);
CREATE INDEX IF NOT EXISTS idx_events_business_day ON events(business_day_id);

-- ======================================================= EVENT MENU LINES
-- The quotation/BEO body: packages, food, drinks, venue, services, equipment.
-- Prices here are SNAPSHOTS. menu_items.base_price is never modified for an
-- event, and a later menu price change must not alter a confirmed quotation.
CREATE TABLE IF NOT EXISTS event_menu_lines (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL CHECK (line_type IN (
    'package', 'menu_item', 'custom_food', 'beverage', 'venue',
    'service', 'equipment', 'misc', 'complimentary'
  )),
  package_id INTEGER REFERENCES event_packages(id) ON DELETE SET NULL,
  menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  -- Snapshot of the name at quotation time; survives menu edits/deactivation.
  item_name TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  -- The ordinary restaurant price at the time of quoting, kept for comparison
  -- and margin reporting. Never used to charge.
  list_price NUMERIC(14,2) CHECK (list_price IS NULL OR list_price >= 0),
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  -- Which package pricing policy produced unit_price, snapshotted for audit.
  pricing_policy TEXT CHECK (pricing_policy IS NULL OR pricing_policy IN ('whole_party', 'progressive', 'manual')),
  price_overridden INTEGER NOT NULL DEFAULT 0,
  override_reason TEXT,
  overridden_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_complimentary INTEGER NOT NULL DEFAULT 0,
  -- 0 = deliberately non-stock (hired service, outsourced item). Set explicitly
  -- so food can never silently skip inventory costing.
  consumes_inventory INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_menu_lines_event ON event_menu_lines(event_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_event_menu_lines_package ON event_menu_lines(package_id);
CREATE INDEX IF NOT EXISTS idx_event_menu_lines_menu_item ON event_menu_lines(menu_item_id);

-- ================================================= EVENT PAYMENT SCHEDULE
-- What the customer has AGREED to pay and when (deposit, installments, final).
-- This is the plan; event_deposits records money that actually moved.
CREATE TABLE IF NOT EXISTS event_payment_schedule (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  schedule_type TEXT NOT NULL DEFAULT 'installment'
    CHECK (schedule_type IN ('deposit', 'installment', 'final')),
  amount_type TEXT NOT NULL DEFAULT 'fixed' CHECK (amount_type IN ('fixed', 'percent')),
  -- Either an absolute amount or a percentage, per amount_type.
  amount_value NUMERIC(14,2) NOT NULL CHECK (amount_value >= 0),
  -- Resolved payable amount at the time the schedule was generated/refreshed.
  due_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (due_amount >= 0),
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'partial', 'paid', 'waived', 'cancelled')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_payment_schedule_event
  ON event_payment_schedule(event_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_event_payment_schedule_due
  ON event_payment_schedule(due_date, status);

-- ========================================================= EVENT DEPOSITS
-- Money actually received or refunded against an event, before final billing.
--
-- ON DELETE RESTRICT on event_id: a financial record must never disappear
-- because someone removed a booking. Events are cancelled, not deleted.
--
-- journal_id links to the existing double-entry engine. Phase 9 posts these as
-- a LIABILITY (customer advance), never as revenue — an advance is not a sale
-- until the event is fulfilled. No journal is posted by this migration.
CREATE TABLE IF NOT EXISTS event_deposits (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  schedule_id INTEGER REFERENCES event_payment_schedule(id) ON DELETE SET NULL,
  entry_type TEXT NOT NULL DEFAULT 'deposit'
    CHECK (entry_type IN ('deposit', 'refund', 'adjustment')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  provider TEXT,
  reference_number TEXT,
  received_on DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
  journal_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
  business_day_id INTEGER REFERENCES business_days(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  -- Idempotency key for the collect-deposit endpoint: a retried submit must
  -- never take the money twice.
  idempotency_key TEXT UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voided_at TIMESTAMP,
  void_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_deposits_event ON event_deposits(event_id, received_on DESC);
CREATE INDEX IF NOT EXISTS idx_event_deposits_status ON event_deposits(status);
CREATE INDEX IF NOT EXISTS idx_event_deposits_business_day ON event_deposits(business_day_id);

-- ============================================================ EVENT TASKS
-- Operational checklist per event (decoration, staffing, kitchen prep, ...).
CREATE TABLE IF NOT EXISTS event_tasks (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  due_at TIMESTAMP,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled')),
  completed_at TIMESTAMP,
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_tasks_event ON event_tasks(event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_tasks_assigned ON event_tasks(assigned_to, status);

-- ============================================================ EVENT AUDIT
-- Append-only trail for sensitive event actions: status changes, guest-count
-- changes, price overrides, deposits/refunds, cancellations, BEO revisions.
-- Mirrors the shape of the existing pos_audit_log so both read alike.
--
-- event_id is nullable with ON DELETE SET NULL so configuration changes
-- (spaces, packages) can be audited too, and so an audit row outlives its
-- subject rather than being cascaded away.
CREATE TABLE IF NOT EXISTS event_audit (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  reason TEXT,
  previous_value TEXT,
  new_value TEXT,
  detail TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_audit_event ON event_audit(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_audit_action ON event_audit(action, created_at DESC);

-- ============================== EVENT ATTRIBUTION ON EXISTING TABLES
-- Nullable, no default, no backfill. Existing rows keep event_id NULL, which
-- means "ordinary restaurant activity" — the current behaviour of every row in
-- these tables. ON DELETE SET NULL guarantees removing an event can never
-- delete an order, a bill's parent order, an expense or a purchase.

-- Links an operational order to the event that produced it. Phase 11 sets this
-- when an event is started; Phase 15 uses it to split EVENT revenue from
-- dine-in/takeaway/delivery without changing existing classification.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL;

-- Direct event costs (decoration, DJ, temporary staff, transport).
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL;

-- Procurement reference only: "this delivery was bought with that event in
-- mind". It is deliberately NOT a costing link — unused stock from a purchase
-- must not be charged to the event. Event food cost comes from actual recipe
-- consumption (Phase 16).
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL;

-- Partial indexes: event-linked rows are a small minority of these tables, so
-- only those rows are indexed.
CREATE INDEX IF NOT EXISTS idx_orders_event ON orders(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_event ON expenses(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchases_event ON purchases(event_id) WHERE event_id IS NOT NULL;
