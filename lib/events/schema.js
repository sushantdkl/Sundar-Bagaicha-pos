/**
 * Events schema readiness.
 *
 * Postgres gets the real schema from migration 045 — this module only verifies
 * it is installed and fails loudly (503) if it is not, exactly like
 * lib/permissions.js does for migration 038. It never creates Postgres tables,
 * so production schema changes stay in migrations where they can be reviewed.
 *
 * The SQLite dev fallback has no migration runner, so the same tables are
 * created here for local development only.
 */
import { ensureSqliteTable } from '../db/ensure-sqlite-table.js';
import { serialPkSql, ensureColumn } from '../db/schema-helpers.js';

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};

let SQLITE_READY = false;

export async function ensureEventsSchema(db) {
  if (db.driver === 'postgres') {
    const ready = await db.get(`SELECT to_regclass('public.events') AS t`);
    if (!ready?.t) {
      fail('Events schema is not installed. Run database migration 045.', 503);
    }
    return;
  }

  if (SQLITE_READY) return;
  const pk = serialPkSql(db);

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS event_spaces (
    ${pk}, name TEXT NOT NULL UNIQUE, description TEXT,
    min_capacity INTEGER, max_capacity INTEGER,
    standard_charge REAL NOT NULL DEFAULT 0,
    setup_buffer_minutes INTEGER NOT NULL DEFAULT 0,
    cleanup_buffer_minutes INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1, display_order INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS event_packages (
    ${pk}, name TEXT NOT NULL UNIQUE, code TEXT UNIQUE, description TEXT,
    pricing_policy TEXT NOT NULL DEFAULT 'whole_party',
    base_price_per_guest REAL, min_guests INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1, display_order INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS event_package_price_tiers (
    ${pk}, package_id INTEGER NOT NULL REFERENCES event_packages(id) ON DELETE CASCADE,
    min_guests INTEGER NOT NULL DEFAULT 1, max_guests INTEGER,
    price_per_guest REAL NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (package_id, min_guests))`);

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS event_package_components (
    ${pk}, package_id INTEGER NOT NULL REFERENCES event_packages(id) ON DELETE CASCADE,
    component_name TEXT NOT NULL, menu_item_id INTEGER, recipe_id INTEGER,
    quantity_per_guest REAL NOT NULL DEFAULT 1, unit TEXT,
    is_optional INTEGER NOT NULL DEFAULT 0, consumes_inventory INTEGER NOT NULL DEFAULT 1,
    notes TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS events (
    ${pk}, event_number TEXT NOT NULL UNIQUE, customer_id INTEGER,
    contact_name TEXT, contact_phone TEXT, contact_email TEXT,
    title TEXT, event_type TEXT NOT NULL,
    event_date DATE NOT NULL, end_date DATE, start_time TEXT, end_time TEXT,
    space_id INTEGER, expected_guests INTEGER, guaranteed_guests INTEGER, actual_guests INTEGER,
    status TEXT NOT NULL DEFAULT 'INQUIRY', payment_status TEXT NOT NULL DEFAULT 'UNPAID',
    notes TEXT, internal_notes TEXT,
    subtotal REAL NOT NULL DEFAULT 0, discount_amount REAL NOT NULL DEFAULT 0, discount_reason TEXT,
    service_charge_percent REAL NOT NULL DEFAULT 0, service_charge_amount REAL NOT NULL DEFAULT 0,
    tax_percent REAL NOT NULL DEFAULT 0, tax_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0, deposit_total REAL NOT NULL DEFAULT 0,
    outstanding_amount REAL NOT NULL DEFAULT 0, revision_number INTEGER NOT NULL DEFAULT 1,
    quoted_at DATETIME, confirmed_at DATETIME, finalized_at DATETIME, started_at DATETIME,
    completed_at DATETIME, cancelled_at DATETIME, cancel_reason TEXT,
    business_day_id INTEGER, created_by INTEGER, updated_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS event_menu_lines (
    ${pk}, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    line_type TEXT NOT NULL, package_id INTEGER, menu_item_id INTEGER, recipe_id INTEGER,
    item_name TEXT NOT NULL, description TEXT,
    quantity REAL NOT NULL DEFAULT 1, unit_price REAL NOT NULL DEFAULT 0,
    list_price REAL, line_total REAL NOT NULL DEFAULT 0, pricing_policy TEXT,
    price_overridden INTEGER NOT NULL DEFAULT 0, override_reason TEXT, overridden_by INTEGER,
    is_complimentary INTEGER NOT NULL DEFAULT 0, consumes_inventory INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0, created_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS event_payment_schedule (
    ${pk}, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    label TEXT NOT NULL, schedule_type TEXT NOT NULL DEFAULT 'installment',
    amount_type TEXT NOT NULL DEFAULT 'fixed', amount_value REAL NOT NULL,
    due_amount REAL NOT NULL DEFAULT 0, paid_amount REAL NOT NULL DEFAULT 0,
    due_date DATE, status TEXT NOT NULL DEFAULT 'pending',
    sort_order INTEGER NOT NULL DEFAULT 0, created_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS event_deposits (
    ${pk}, event_id INTEGER NOT NULL REFERENCES events(id), schedule_id INTEGER,
    entry_type TEXT NOT NULL DEFAULT 'deposit', amount REAL NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash', provider TEXT, reference_number TEXT,
    received_on DATE NOT NULL DEFAULT CURRENT_DATE, notes TEXT,
    status TEXT NOT NULL DEFAULT 'active', journal_id INTEGER, business_day_id INTEGER,
    customer_id INTEGER, idempotency_key TEXT UNIQUE, created_by INTEGER,
    voided_by INTEGER, voided_at DATETIME, void_reason TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS event_tasks (
    ${pk}, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL, description TEXT, category TEXT, due_at DATETIME,
    assigned_to INTEGER, status TEXT NOT NULL DEFAULT 'pending',
    completed_at DATETIME, completed_by INTEGER, sort_order INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS event_audit (
    ${pk}, event_id INTEGER, action TEXT NOT NULL, entity_type TEXT, entity_id INTEGER,
    actor_id INTEGER, actor_name TEXT, reason TEXT,
    previous_value TEXT, new_value TEXT, detail TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  // Event attribution on existing tables. SQLite cannot add a column with an
  // inline FK to a table it did not declare one against, so these are plain
  // nullable INTEGERs in dev; Postgres carries the real foreign keys.
  await ensureColumn(db, 'orders', 'event_id', 'INTEGER');
  await ensureColumn(db, 'orders', 'event_production', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'expenses', 'event_id', 'INTEGER');
  await ensureColumn(db, 'purchases', 'event_id', 'INTEGER');

  SQLITE_READY = true;
}
