-- 051: HRM (departments, designations, attendance, holidays) and Delivery Executives.
--
-- ONE PERSON, ONE RECORD
--
-- There is no `employees` table in this system and there must not be one. Staff
-- are rows in `users` — /admin/employees edits `users`, and lib/payroll.js keys
-- salary_payments and salary_advances to users.id. So HRM hangs off `users`
-- rather than introducing a parallel employee identity that payroll would then
-- disagree with.
--
-- Department and designation are HR facts about a person. They are deliberately
-- NOT the same thing as `users.role`, which is a system permission:
--
--   users.role        CASHIER          what the software lets them do
--   designation       Senior Cashier   what the business calls their job
--   department        Front Office     which part of the business they sit in
--
-- DELIVERY EXECUTIVES ARE A SEPARATE ENTITY, ON PURPOSE
--
-- A rider is frequently not a system user: `users` requires a username and a
-- password hash, and creating login credentials for someone who will never open
-- the POS is both wrong and a security liability. delivery_executives therefore
-- carries its own name/phone, with an OPTIONAL user_id for the case where the
-- rider genuinely is staff. That is the "optional link" shape rather than the
-- duplicate-identity shape.
--
-- Everything here is additive. No existing table is rewritten, no column is
-- dropped, and every new column on `users` and `orders` is nullable, so every
-- existing row stays valid exactly as it is.

/* ─────────────────────────────────────────────────────────── HRM: structure */

CREATE TABLE IF NOT EXISTS hrm_departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Case- and whitespace-insensitive, so "Kitchen" and " kitchen " cannot both
-- exist and split the same department's staff across two rows.
CREATE UNIQUE INDEX IF NOT EXISTS ux_hrm_departments_name
  ON hrm_departments (LOWER(TRIM(name)));

CREATE TABLE IF NOT EXISTS hrm_designations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  department_id INTEGER REFERENCES hrm_departments(id) ON DELETE SET NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A designation is unique within its department: "Manager" may legitimately
-- exist in both Kitchen and Front Office. COALESCE keeps the unattached ones
-- (department_id IS NULL) unique among themselves rather than all colliding.
CREATE UNIQUE INDEX IF NOT EXISTS ux_hrm_designations_name
  ON hrm_designations (LOWER(TRIM(name)), COALESCE(department_id, 0));

CREATE INDEX IF NOT EXISTS idx_hrm_designations_department
  ON hrm_designations (department_id) WHERE department_id IS NOT NULL;

/* ───────────────────────────────────────────────── HRM: staff facts on users */

ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES hrm_departments(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS designation_id INTEGER REFERENCES hrm_designations(id) ON DELETE SET NULL;

-- Employment status is an HR state and is separate from users.is_active, which
-- controls whether the person can log in. Someone on leave keeps their login;
-- someone terminated does not. Existing rows default to Active, which is what
-- they effectively were.
ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_status TEXT NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;

CREATE INDEX IF NOT EXISTS idx_users_department ON users (department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_designation ON users (designation_id) WHERE designation_id IS NOT NULL;

/* ────────────────────────────────────────────────────────── HRM: attendance */

CREATE TABLE IF NOT EXISTS hrm_attendance (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'PRESENT'
    CHECK (status IN ('PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'HOLIDAY')),
  check_in TEXT,
  check_out TEXT,
  worked_minutes INTEGER CHECK (worked_minutes IS NULL OR worked_minutes >= 0),
  overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  notes TEXT,
  marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One record per person per day. Marking attendance twice updates the existing
-- row instead of quietly producing a second, contradictory one.
CREATE UNIQUE INDEX IF NOT EXISTS ux_hrm_attendance_person_day
  ON hrm_attendance (user_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_hrm_attendance_date ON hrm_attendance (attendance_date);

/* ─────────────────────────────────────────────────────────── HRM: holidays */

CREATE TABLE IF NOT EXISTS hrm_holidays (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  holiday_date DATE NOT NULL,
  end_date DATE,
  description TEXT,
  -- NULL means the holiday applies to everyone.
  department_id INTEGER REFERENCES hrm_departments(id) ON DELETE SET NULL,
  is_paid INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT hrm_holidays_date_order CHECK (end_date IS NULL OR end_date >= holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_hrm_holidays_date ON hrm_holidays (holiday_date);

/* ──────────────────────────────────────────────────── Delivery executives */

CREATE TABLE IF NOT EXISTS delivery_executives (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  -- Operational availability. Distinct from an order's delivery status: an
  -- executive is BUSY, an order is OUT_FOR_DELIVERY.
  status TEXT NOT NULL DEFAULT 'AVAILABLE'
    CHECK (status IN ('AVAILABLE', 'BUSY', 'OFF_DUTY')),
  -- Set only when the rider is also a system user. Most are not.
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Phone identifies a rider. Scoped to active rows so a deactivated executive's
-- number can be reused by a genuinely new person later.
CREATE UNIQUE INDEX IF NOT EXISTS ux_delivery_executives_phone
  ON delivery_executives (phone) WHERE is_active = 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_delivery_executives_user
  ON delivery_executives (user_id) WHERE user_id IS NOT NULL AND is_active = 1;

/* ─────────────────────────────────── Assignment lives on the existing order */

-- Attribution only. The order, its bill, its stock and its revenue are entirely
-- unchanged — this column records who carried it, so "what has Ram delivered?"
-- is answerable without inventing a second delivery-order engine or a second
-- source of sales.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_executive_id INTEGER
  REFERENCES delivery_executives(id) ON DELETE SET NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_assigned_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_executive
  ON orders (delivery_executive_id) WHERE delivery_executive_id IS NOT NULL;
