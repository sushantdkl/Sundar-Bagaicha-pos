/**
 * HRM — departments, designations, staff HR facts, attendance and holidays.
 *
 * The person is a row in `users`. There is no separate employee table and this
 * module must never create one: /admin/employees edits `users`, and
 * lib/payroll.js keys salary_payments and salary_advances to users.id. A second
 * identity would let payroll and HR disagree about who someone is.
 *
 * Two things that look alike and are not:
 *
 *   users.role          a system permission — what the software allows
 *   designation         a job title — what the business calls the role
 *
 * A person can be role=cashier, designation="Senior Cashier". Changing the
 * designation must never change what they can do in the POS, so nothing here
 * touches `role`.
 *
 * Deactivation over deletion throughout. A department with staff in it, or a
 * designation someone holds, is archived rather than removed — deleting it
 * would strand history that payroll and attendance still point at.
 */
import { ensureSqliteTable } from './db/ensure-sqlite-table.js';
import { ensureColumn, serialPkSql } from './db/schema-helpers.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};

const clean = (v, max = 200) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const required = (v, label, max = 200) => {
  const s = clean(v, max);
  if (!s) fail(`${label} is required.`);
  return s;
};
const bool = (v, fallback = 1) => (v === undefined || v === null ? fallback : (v ? 1 : 0));

export const EMPLOYMENT_STATUSES = ['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED'];
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'HOLIDAY'];

/** "ON_LEAVE" -> "On leave". */
export const hrLabel = (v) => {
  const s = String(v || '').replace(/_/g, ' ').toLowerCase().trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
};

/* ------------------------------------------------------------------ schema */

let READY = false;

/**
 * SQLite parity for the dev database. Postgres gets all of this from migration
 * 051; these statements are no-ops there. Mirrors the pattern used by
 * lib/payroll.js and lib/events/schema.js.
 */
export async function ensureHrmSchema(db) {
  if (READY) return;
  const pk = serialPkSql(db);

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS hrm_departments (
    ${pk}, name TEXT NOT NULL, description TEXT, is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS hrm_designations (
    ${pk}, name TEXT NOT NULL, department_id INTEGER, description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1, created_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS hrm_attendance (
    ${pk}, user_id INTEGER NOT NULL, attendance_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'PRESENT', check_in TEXT, check_out TEXT,
    worked_minutes INTEGER, overtime_minutes INTEGER NOT NULL DEFAULT 0,
    notes TEXT, marked_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.run(`CREATE UNIQUE INDEX IF NOT EXISTS ux_hrm_attendance_person_day
    ON hrm_attendance (user_id, attendance_date)`).catch(() => {});

  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS hrm_holidays (
    ${pk}, name TEXT NOT NULL, holiday_date DATE NOT NULL, end_date DATE,
    description TEXT, department_id INTEGER, is_paid INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1, created_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  // department_id/designation_id/employment_status/address come from migration
  // 051; salary/hire_date/position are older payroll columns that the SQLite
  // seed does not carry. listStaff selects all of them, so all of them are
  // ensured — otherwise the roster 500s on a dev database.
  for (const [col, type] of [
    ['department_id', 'INTEGER'],
    ['designation_id', 'INTEGER'],
    ['employment_status', "TEXT NOT NULL DEFAULT 'ACTIVE'"],
    ['address', 'TEXT'],
    ['salary', 'REAL'],
    ['hire_date', 'DATE'],
    ['position', 'TEXT'],
  ]) {
    await ensureColumn(db, 'users', col, type).catch(() => {});
  }
  READY = true;
}

/* ------------------------------------------------------------- departments */

export async function listDepartments(db, { includeInactive = false } = {}) {
  await ensureHrmSchema(db);
  const where = includeInactive ? '' : 'WHERE COALESCE(d.is_active, 1) = 1';
  return db.all(
    `SELECT d.*,
            (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS staff_count,
            (SELECT COUNT(*) FROM hrm_designations g
              WHERE g.department_id = d.id AND COALESCE(g.is_active, 1) = 1) AS designation_count
       FROM hrm_departments d ${where}
      ORDER BY COALESCE(d.is_active, 1) DESC, d.name`
  );
}

export async function createDepartment(db, data = {}, actor = {}) {
  await ensureHrmSchema(db);
  const name = required(data.name, 'Department name', 120);
  await assertDepartmentNameFree(db, name);
  const res = await db.run(
    `INSERT INTO hrm_departments (name, description, is_active, created_by)
     VALUES (?, ?, ?, ?)`,
    [name, clean(data.description, 500), bool(data.is_active), actor.id || null]
  );
  return db.get('SELECT * FROM hrm_departments WHERE id = ?', [res.lastInsertRowid]);
}

export async function updateDepartment(db, id, data = {}) {
  await ensureHrmSchema(db);
  const existing = await db.get('SELECT * FROM hrm_departments WHERE id = ?', [Number(id)]);
  if (!existing) fail('Department not found.', 404);

  const name = data.name === undefined ? existing.name : required(data.name, 'Department name', 120);
  if (name.toLowerCase() !== String(existing.name).toLowerCase()) {
    await assertDepartmentNameFree(db, name, existing.id);
  }
  const nextActive = data.is_active === undefined ? existing.is_active : bool(data.is_active);

  // Archiving is allowed with staff attached — their history stays intact and
  // the department simply stops being offered for new assignments. Deleting it
  // is what would break them, and this module never deletes.
  await db.run(
    `UPDATE hrm_departments
        SET name = ?, description = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [name, data.description === undefined ? existing.description : clean(data.description, 500),
      nextActive, existing.id]
  );
  return db.get('SELECT * FROM hrm_departments WHERE id = ?', [existing.id]);
}

async function assertDepartmentNameFree(db, name, exceptId = null) {
  const rows = await db.all('SELECT id, name FROM hrm_departments');
  const key = name.toLowerCase();
  const clash = rows.find(
    (r) => String(r.name).trim().toLowerCase() === key && Number(r.id) !== Number(exceptId)
  );
  if (clash) fail(`A department called "${clash.name}" already exists.`, 409, { code: 'duplicate' });
}

/* ------------------------------------------------------------ designations */

export async function listDesignations(db, { includeInactive = false, departmentId = null } = {}) {
  await ensureHrmSchema(db);
  const where = [];
  const params = [];
  if (!includeInactive) where.push('COALESCE(g.is_active, 1) = 1');
  if (departmentId) { where.push('g.department_id = ?'); params.push(Number(departmentId)); }
  return db.all(
    `SELECT g.*, d.name AS department_name,
            (SELECT COUNT(*) FROM users u WHERE u.designation_id = g.id) AS staff_count
       FROM hrm_designations g
       LEFT JOIN hrm_departments d ON d.id = g.department_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY COALESCE(g.is_active, 1) DESC, d.name NULLS LAST, g.name`,
    params
  );
}

export async function createDesignation(db, data = {}, actor = {}) {
  await ensureHrmSchema(db);
  const name = required(data.name, 'Designation name', 120);
  const departmentId = data.department_id ? Number(data.department_id) : null;
  if (departmentId) await assertDepartmentExists(db, departmentId);
  await assertDesignationNameFree(db, name, departmentId);

  const res = await db.run(
    `INSERT INTO hrm_designations (name, department_id, description, is_active, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [name, departmentId, clean(data.description, 500), bool(data.is_active), actor.id || null]
  );
  return db.get('SELECT * FROM hrm_designations WHERE id = ?', [res.lastInsertRowid]);
}

export async function updateDesignation(db, id, data = {}) {
  await ensureHrmSchema(db);
  const existing = await db.get('SELECT * FROM hrm_designations WHERE id = ?', [Number(id)]);
  if (!existing) fail('Designation not found.', 404);

  const name = data.name === undefined ? existing.name : required(data.name, 'Designation name', 120);
  const departmentId = data.department_id === undefined
    ? existing.department_id
    : (data.department_id ? Number(data.department_id) : null);
  if (departmentId) await assertDepartmentExists(db, departmentId);

  const moved = Number(departmentId || 0) !== Number(existing.department_id || 0);
  if (moved || name.toLowerCase() !== String(existing.name).toLowerCase()) {
    await assertDesignationNameFree(db, name, departmentId, existing.id);
  }

  await db.run(
    `UPDATE hrm_designations
        SET name = ?, department_id = ?, description = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [
      name, departmentId,
      data.description === undefined ? existing.description : clean(data.description, 500),
      data.is_active === undefined ? existing.is_active : bool(data.is_active),
      existing.id,
    ]
  );
  return db.get('SELECT * FROM hrm_designations WHERE id = ?', [existing.id]);
}

async function assertDepartmentExists(db, id) {
  const row = await db.get('SELECT id FROM hrm_departments WHERE id = ?', [Number(id)]);
  if (!row) fail('That department no longer exists.', 400);
}

async function assertDesignationNameFree(db, name, departmentId, exceptId = null) {
  const rows = await db.all('SELECT id, name, department_id FROM hrm_designations');
  const key = name.toLowerCase();
  const clash = rows.find(
    (r) => String(r.name).trim().toLowerCase() === key
      && Number(r.department_id || 0) === Number(departmentId || 0)
      && Number(r.id) !== Number(exceptId)
  );
  if (clash) {
    fail('That designation already exists in this department.', 409, { code: 'duplicate' });
  }
}

/* -------------------------------------------------------------------- staff */

/** Staff with their HR facts. `users` remains the record; this only joins. */
export async function listStaff(db, { includeInactive = true, departmentId = null, search = null } = {}) {
  await ensureHrmSchema(db);
  const where = [];
  const params = [];
  if (!includeInactive) where.push("COALESCE(u.employment_status, 'ACTIVE') = 'ACTIVE'");
  if (departmentId) { where.push('u.department_id = ?'); params.push(Number(departmentId)); }
  if (search) {
    where.push('(LOWER(u.full_name) LIKE ? OR LOWER(COALESCE(u.username, \'\')) LIKE ? OR COALESCE(u.phone, \'\') LIKE ?)');
    const like = `%${String(search).toLowerCase()}%`;
    params.push(like, like, `%${search}%`);
  }
  return db.all(
    `SELECT u.id, u.username, u.full_name, u.role, u.email, u.phone, u.address,
            u.is_active, u.salary, u.hire_date, u.position,
            u.department_id, u.designation_id,
            COALESCE(u.employment_status, 'ACTIVE') AS employment_status,
            d.name AS department_name, g.name AS designation_name
       FROM users u
       LEFT JOIN hrm_departments d ON d.id = u.department_id
       LEFT JOIN hrm_designations g ON g.id = u.designation_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY u.full_name`,
    params
  );
}

/** One staff member with their HR facts resolved. */
export async function getStaffMember(db, userId) {
  await ensureHrmSchema(db);
  return db.get(
    `SELECT u.id, u.username, u.full_name, u.role, u.email, u.phone, u.address,
            u.is_active, u.salary, u.hire_date, u.position,
            u.department_id, u.designation_id,
            COALESCE(u.employment_status, 'ACTIVE') AS employment_status,
            d.name AS department_name, g.name AS designation_name
       FROM users u
       LEFT JOIN hrm_departments d ON d.id = u.department_id
       LEFT JOIN hrm_designations g ON g.id = u.designation_id
      WHERE u.id = ?`,
    [Number(userId)]
  );
}

/**
 * Update only the HR facts about a person.
 *
 * Deliberately cannot touch username, password or `role`: those are account and
 * permission concerns owned by /admin/employees and the permissions matrix.
 * Letting an HR screen change a system role would make "promote to Senior
 * Cashier" silently grant POS powers.
 */
export async function updateStaffHrProfile(db, userId, data = {}) {
  await ensureHrmSchema(db);
  const user = await db.get('SELECT id FROM users WHERE id = ?', [Number(userId)]);
  if (!user) fail('Staff member not found.', 404);

  if (data.department_id) await assertDepartmentExists(db, data.department_id);
  if (data.designation_id) {
    const row = await db.get('SELECT id FROM hrm_designations WHERE id = ?', [Number(data.designation_id)]);
    if (!row) fail('That designation no longer exists.', 400);
  }
  const status = data.employment_status === undefined ? undefined : String(data.employment_status).toUpperCase();
  if (status !== undefined && !EMPLOYMENT_STATUSES.includes(status)) {
    fail(`Employment status must be one of ${EMPLOYMENT_STATUSES.join(', ')}.`);
  }

  const sets = [];
  const params = [];
  const put = (col, value) => { sets.push(`${col} = ?`); params.push(value); };

  if (data.department_id !== undefined) put('department_id', data.department_id ? Number(data.department_id) : null);
  if (data.designation_id !== undefined) put('designation_id', data.designation_id ? Number(data.designation_id) : null);
  if (status !== undefined) put('employment_status', status);
  if (data.address !== undefined) put('address', clean(data.address, 300));
  if (data.phone !== undefined) put('phone', clean(data.phone, 40));
  if (data.email !== undefined) put('email', clean(data.email, 160));
  if (!sets.length) fail('Nothing to update.');

  params.push(Number(userId));
  await db.run(`UPDATE users SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);

  return getStaffMember(db, userId);
}

/* --------------------------------------------------------------- attendance */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Worked minutes between two HH:MM stamps; an overnight shift wraps midnight. */
export function workedMinutes(checkIn, checkOut) {
  if (!HHMM.test(String(checkIn || '')) || !HHMM.test(String(checkOut || ''))) return null;
  const [inH, inM] = checkIn.split(':').map(Number);
  const [outH, outM] = checkOut.split(':').map(Number);
  const start = inH * 60 + inM;
  const end = outH * 60 + outM;
  return end >= start ? end - start : 24 * 60 - start + end;
}

export async function listAttendance(db, { date = null, from = null, to = null, userId = null, departmentId = null } = {}) {
  await ensureHrmSchema(db);
  const where = [];
  const params = [];
  if (date) { where.push('a.attendance_date = ?'); params.push(date); }
  if (from) { where.push('a.attendance_date >= ?'); params.push(from); }
  if (to) { where.push('a.attendance_date <= ?'); params.push(to); }
  if (userId) { where.push('a.user_id = ?'); params.push(Number(userId)); }
  if (departmentId) { where.push('u.department_id = ?'); params.push(Number(departmentId)); }

  return db.all(
    `SELECT a.*, u.full_name, u.username, u.department_id,
            d.name AS department_name, g.name AS designation_name
       FROM hrm_attendance a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN hrm_departments d ON d.id = u.department_id
       LEFT JOIN hrm_designations g ON g.id = u.designation_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.attendance_date DESC, u.full_name`,
    params
  );
}

/**
 * Mark or correct one person's attendance for one day.
 *
 * Upsert rather than insert: the unique index on (user_id, attendance_date)
 * means marking twice corrects the existing row instead of creating a second,
 * contradictory record for the same shift.
 */
export async function markAttendance(db, data = {}, actor = {}) {
  await ensureHrmSchema(db);
  const userId = Number(data.user_id);
  if (!Number.isInteger(userId) || userId <= 0) fail('Choose a staff member.');
  const user = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) fail('Staff member not found.', 404);

  const date = required(data.attendance_date, 'Date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Date must be YYYY-MM-DD.');

  const status = String(data.status || 'PRESENT').toUpperCase();
  if (!ATTENDANCE_STATUSES.includes(status)) {
    fail(`Status must be one of ${ATTENDANCE_STATUSES.join(', ')}.`);
  }

  const checkIn = clean(data.check_in, 5);
  const checkOut = clean(data.check_out, 5);
  for (const [v, label] of [[checkIn, 'Check-in'], [checkOut, 'Check-out']]) {
    if (v && !HHMM.test(v)) fail(`${label} must be a 24-hour time like 09:30.`);
  }
  const worked = workedMinutes(checkIn, checkOut);
  const overtime = Math.max(0, Number(data.overtime_minutes || 0));

  const existing = await db.get(
    'SELECT id FROM hrm_attendance WHERE user_id = ? AND attendance_date = ?', [userId, date]
  );
  if (existing) {
    await db.run(
      `UPDATE hrm_attendance
          SET status = ?, check_in = ?, check_out = ?, worked_minutes = ?, overtime_minutes = ?,
              notes = ?, marked_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [status, checkIn, checkOut, worked, overtime, clean(data.notes, 300), actor.id || null, existing.id]
    );
    return db.get('SELECT * FROM hrm_attendance WHERE id = ?', [existing.id]);
  }

  const res = await db.run(
    `INSERT INTO hrm_attendance
       (user_id, attendance_date, status, check_in, check_out, worked_minutes, overtime_minutes, notes, marked_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, date, status, checkIn, checkOut, worked, overtime, clean(data.notes, 300), actor.id || null]
  );
  return db.get('SELECT * FROM hrm_attendance WHERE id = ?', [res.lastInsertRowid]);
}

/** Per-person totals for a window — the shape a monthly sheet needs. */
export async function attendanceSummary(db, { from, to, departmentId = null } = {}) {
  await ensureHrmSchema(db);
  const where = ['a.attendance_date >= ?', 'a.attendance_date <= ?'];
  const params = [from, to];
  if (departmentId) { where.push('u.department_id = ?'); params.push(Number(departmentId)); }

  return db.all(
    `SELECT u.id AS user_id, u.full_name, d.name AS department_name,
            COUNT(*) AS marked_days,
            SUM(CASE WHEN a.status = 'PRESENT' THEN 1 ELSE 0 END) AS present,
            SUM(CASE WHEN a.status = 'ABSENT' THEN 1 ELSE 0 END) AS absent,
            SUM(CASE WHEN a.status = 'LATE' THEN 1 ELSE 0 END) AS late,
            SUM(CASE WHEN a.status = 'HALF_DAY' THEN 1 ELSE 0 END) AS half_day,
            SUM(CASE WHEN a.status = 'LEAVE' THEN 1 ELSE 0 END) AS leave_days,
            SUM(CASE WHEN a.status = 'HOLIDAY' THEN 1 ELSE 0 END) AS holidays,
            COALESCE(SUM(a.worked_minutes), 0) AS worked_minutes,
            COALESCE(SUM(a.overtime_minutes), 0) AS overtime_minutes
       FROM hrm_attendance a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN hrm_departments d ON d.id = u.department_id
      WHERE ${where.join(' AND ')}
      GROUP BY u.id, u.full_name, d.name
      ORDER BY u.full_name`,
    params
  );
}

/* ---------------------------------------------------------------- holidays */

export async function listHolidays(db, { year = null, includeInactive = false } = {}) {
  await ensureHrmSchema(db);
  const where = [];
  const params = [];
  if (!includeInactive) where.push('COALESCE(h.is_active, 1) = 1');
  if (year) {
    where.push('h.holiday_date >= ? AND h.holiday_date <= ?');
    params.push(`${year}-01-01`, `${year}-12-31`);
  }
  return db.all(
    `SELECT h.*, d.name AS department_name
       FROM hrm_holidays h
       LEFT JOIN hrm_departments d ON d.id = h.department_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY h.holiday_date`,
    params
  );
}

export async function createHoliday(db, data = {}, actor = {}) {
  await ensureHrmSchema(db);
  const { name, date, endDate, departmentId } = await validateHoliday(db, data);
  const res = await db.run(
    `INSERT INTO hrm_holidays (name, holiday_date, end_date, description, department_id, is_paid, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, date, endDate, clean(data.description, 500), departmentId,
      bool(data.is_paid), bool(data.is_active), actor.id || null]
  );
  return db.get('SELECT * FROM hrm_holidays WHERE id = ?', [res.lastInsertRowid]);
}

export async function updateHoliday(db, id, data = {}) {
  await ensureHrmSchema(db);
  const existing = await db.get('SELECT * FROM hrm_holidays WHERE id = ?', [Number(id)]);
  if (!existing) fail('Holiday not found.', 404);

  const merged = {
    name: data.name === undefined ? existing.name : data.name,
    holiday_date: data.holiday_date === undefined ? String(existing.holiday_date).slice(0, 10) : data.holiday_date,
    end_date: data.end_date === undefined
      ? (existing.end_date ? String(existing.end_date).slice(0, 10) : null)
      : data.end_date,
    department_id: data.department_id === undefined ? existing.department_id : data.department_id,
  };
  const { name, date, endDate, departmentId } = await validateHoliday(db, merged);

  await db.run(
    `UPDATE hrm_holidays
        SET name = ?, holiday_date = ?, end_date = ?, description = ?, department_id = ?,
            is_paid = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [
      name, date, endDate,
      data.description === undefined ? existing.description : clean(data.description, 500),
      departmentId,
      data.is_paid === undefined ? existing.is_paid : bool(data.is_paid),
      data.is_active === undefined ? existing.is_active : bool(data.is_active),
      existing.id,
    ]
  );
  return db.get('SELECT * FROM hrm_holidays WHERE id = ?', [existing.id]);
}

async function validateHoliday(db, data) {
  const name = required(data.name, 'Holiday name', 160);
  const date = required(data.holiday_date, 'Date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Date must be YYYY-MM-DD.');

  const endDate = clean(data.end_date, 10);
  if (endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) fail('End date must be YYYY-MM-DD.');
    if (endDate < date) fail('The end date cannot be before the start date.');
  }
  const departmentId = data.department_id ? Number(data.department_id) : null;
  if (departmentId) await assertDepartmentExists(db, departmentId);
  return { name, date, endDate, departmentId };
}
