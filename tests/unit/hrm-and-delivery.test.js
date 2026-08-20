/**
 * HRM and Delivery Executives — business logic, on a real database.
 *
 * The rules worth pinning are the ones that would quietly corrupt data:
 * duplicate departments splitting a team in two, attendance marked twice for
 * one shift, an executive going off duty holding live orders, and — the one
 * that would matter most — delivery attribution inventing a second copy of a
 * sale that the Sales Report already counts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import {
  ensureHrmSchema, createDepartment, updateDepartment, listDepartments,
  createDesignation, listDesignations, updateStaffHrProfile, listStaff,
  markAttendance, listAttendance, attendanceSummary, workedMinutes,
  createHoliday, updateHoliday, listHolidays, EMPLOYMENT_STATUSES,
} from '../../lib/hrm.js';
import {
  ensureDeliveryExecutiveSchema, createExecutive, updateExecutive, listExecutives,
  assignDelivery, executiveSummary, refreshStatusFromAssignments, EXECUTIVE_STATUSES,
} from '../../lib/delivery-executives.js';

const dbPath = path.join(os.tmpdir(), `hrm-delivery-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);
const actor = { id: null, full_name: 'Test Admin' };

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
});

let staffId = null;
let kitchenId = null;

test('fixture: schema and one staff member', async () => {
  await ensureHrmSchema(db);
  await ensureDeliveryExecutiveSchema(db);
  const res = await db.run(
    `INSERT INTO users (username, password_hash, full_name, role, is_active)
     VALUES ('rsharma', 'x', 'Ram Sharma', 'waiter', 1)`
  );
  staffId = res.lastInsertRowid;
  assert.ok(staffId);
});

/* ------------------------------------------------------------- departments */

test('a department is created and counted', async () => {
  const dep = await createDepartment(db, { name: 'Kitchen', description: 'Back of house' }, actor);
  kitchenId = dep.id;
  const rows = await listDepartments(db);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].staff_count), 0, 'nobody assigned yet');
});

test('a department name cannot be duplicated, whatever the casing', async () => {
  await assert.rejects(
    () => createDepartment(db, { name: '  kitchen ' }, actor),
    (e) => e.status === 409 && e.code === 'duplicate',
    'two "Kitchen" departments would split the same team in two'
  );
});

test('a department with staff is archived, never deleted', async () => {
  await updateStaffHrProfile(db, staffId, { department_id: kitchenId });
  const archived = await updateDepartment(db, kitchenId, { is_active: false });
  assert.equal(Number(archived.is_active), 0);

  // Archiving must not orphan the person who is in it. Looked up by id because
  // the SQLite fixture ships seeded users alongside this one.
  const member = (await listStaff(db, {})).find((r) => Number(r.id) === Number(staffId));
  assert.ok(member, 'the staff member is still listed');
  assert.equal(Number(member.department_id), Number(kitchenId), 'the staff record still points at it');

  await updateDepartment(db, kitchenId, { is_active: true });
});

/* ------------------------------------------------------------ designations */

test('the same job title may exist in two departments but not twice in one', async () => {
  const service = await createDepartment(db, { name: 'Service' }, actor);
  await createDesignation(db, { name: 'Manager', department_id: kitchenId }, actor);
  await createDesignation(db, { name: 'Manager', department_id: service.id }, actor);

  await assert.rejects(
    () => createDesignation(db, { name: 'manager', department_id: kitchenId }, actor),
    (e) => e.status === 409 && e.code === 'duplicate'
  );
  const rows = await listDesignations(db);
  assert.equal(rows.filter((r) => r.name === 'Manager').length, 2);
});

/* -------------------------------------------------------------------- staff */

test('an HR edit sets department and designation but never the system role', async () => {
  const [designation] = await listDesignations(db, { departmentId: kitchenId });
  const before = await db.get('SELECT role FROM users WHERE id = ?', [staffId]);
  assert.ok(designation, 'a Kitchen designation exists to assign');

  const member = await updateStaffHrProfile(db, staffId, {
    designation_id: designation.id,
    employment_status: 'ON_LEAVE',
    phone: '9800000000',
  });

  assert.equal(Number(member.designation_id), Number(designation.id));
  assert.equal(member.employment_status, 'ON_LEAVE');
  const after = await db.get('SELECT role FROM users WHERE id = ?', [staffId]);
  assert.equal(after.role, before.role, 'a job title change must not grant POS powers');
});

test('an unknown employment status is refused', async () => {
  await assert.rejects(
    () => updateStaffHrProfile(db, staffId, { employment_status: 'FIRED' }),
    /Employment status must be one of/
  );
  assert.deepEqual(EMPLOYMENT_STATUSES, ['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED']);
});

/* --------------------------------------------------------------- attendance */

test('worked minutes handle a normal and an overnight shift', () => {
  assert.equal(workedMinutes('09:00', '17:30'), 510);
  assert.equal(workedMinutes('22:00', '06:00'), 480, 'a night shift wraps midnight');
  assert.equal(workedMinutes('', '17:00'), null);
});

test('marking the same person twice in a day corrects the record', async () => {
  await markAttendance(db, {
    user_id: staffId, attendance_date: '2026-08-20', status: 'PRESENT',
    check_in: '09:00', check_out: '17:00',
  }, actor);
  await markAttendance(db, {
    user_id: staffId, attendance_date: '2026-08-20', status: 'LATE',
    check_in: '10:15', check_out: '17:00',
  }, actor);

  const rows = await listAttendance(db, { date: '2026-08-20' });
  assert.equal(rows.length, 1, 'one shift, one record — never two contradictory ones');
  assert.equal(rows[0].status, 'LATE', 'the correction wins');
  assert.equal(Number(rows[0].worked_minutes), 405);
});

test('attendance validates its inputs', async () => {
  await assert.rejects(
    () => markAttendance(db, { user_id: staffId, attendance_date: '20-08-2026' }, actor),
    /Date must be YYYY-MM-DD/
  );
  await assert.rejects(
    () => markAttendance(db, { user_id: staffId, attendance_date: '2026-08-21', check_in: '9am' }, actor),
    /24-hour time/
  );
  await assert.rejects(
    () => markAttendance(db, { user_id: staffId, attendance_date: '2026-08-21', status: 'NAPPING' }, actor),
    /Status must be one of/
  );
});

test('the monthly summary counts each status', async () => {
  await markAttendance(db, { user_id: staffId, attendance_date: '2026-08-21', status: 'ABSENT' }, actor);
  const [row] = await attendanceSummary(db, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(Number(row.marked_days), 2);
  assert.equal(Number(row.late), 1);
  assert.equal(Number(row.absent), 1);
});

/* ----------------------------------------------------------------- holidays */

test('a holiday range cannot end before it starts', async () => {
  await assert.rejects(
    () => createHoliday(db, { name: 'Dashain', holiday_date: '2026-10-10', end_date: '2026-10-01' }, actor),
    /end date cannot be before/
  );
});

test('holidays are listed by year and archived rather than deleted', async () => {
  const h = await createHoliday(db, {
    name: 'Dashain', holiday_date: '2026-10-10', end_date: '2026-10-14',
  }, actor);
  assert.equal((await listHolidays(db, { year: '2026' })).length, 1);
  assert.equal((await listHolidays(db, { year: '2025' })).length, 0);

  await updateHoliday(db, h.id, { is_active: false });
  assert.equal((await listHolidays(db, { year: '2026' })).length, 0, 'archived drops out of the default view');
  assert.equal((await listHolidays(db, { year: '2026', includeInactive: true })).length, 1);
});

/* ------------------------------------------------------ delivery executives */

let execId = null;
let orderId = null;

test('an executive needs a name and a valid phone', async () => {
  await assert.rejects(() => createExecutive(db, { phone: '9800000001' }, actor), /Name is required/);
  await assert.rejects(() => createExecutive(db, { name: 'Hari' }, actor), /Phone is required/);
  await assert.rejects(
    () => createExecutive(db, { name: 'Hari', phone: 'abc' }, actor),
    /valid phone number/
  );
  await assert.rejects(
    () => createExecutive(db, { name: 'Hari', phone: '9800000001', email: 'nope' }, actor),
    /valid email address/
  );
  assert.deepEqual(EXECUTIVE_STATUSES, ['AVAILABLE', 'BUSY', 'OFF_DUTY']);
});

test('an executive is created and their phone is unique', async () => {
  const e = await createExecutive(db, { name: 'Hari Thapa', phone: '9800000001' }, actor);
  execId = e.id;
  assert.equal(e.status, 'AVAILABLE');
  await assert.rejects(
    () => createExecutive(db, { name: 'Someone Else', phone: '9800000001' }, actor),
    (err) => err.status === 409 && err.code === 'duplicate_phone'
  );
});

test('only a delivery order can be assigned', async () => {
  const dineIn = await db.run(
    `INSERT INTO orders (order_number, order_type, status) VALUES ('ORD-DINE', 'dine_in', 'pending')`
  );
  await assert.rejects(
    () => assignDelivery(db, dineIn.lastInsertRowid, execId),
    (e) => e.status === 409 && e.code === 'not_delivery'
  );
});

test('assigning a delivery makes the executive busy', async () => {
  const res = await db.run(
    `INSERT INTO orders (order_number, order_type, status, customer_name)
     VALUES ('ORD-D1', 'delivery', 'pending', 'Sita KC')`
  );
  orderId = res.lastInsertRowid;

  await assignDelivery(db, orderId, execId);
  const order = await db.get('SELECT delivery_executive_id, delivery_assigned_at FROM orders WHERE id = ?', [orderId]);
  assert.equal(Number(order.delivery_executive_id), Number(execId));
  assert.ok(order.delivery_assigned_at, 'the assignment is timestamped');

  const e = await db.get('SELECT status FROM delivery_executives WHERE id = ?', [execId]);
  assert.equal(e.status, 'BUSY');
});

test('an executive holding a live delivery cannot go off duty or be deactivated', async () => {
  await assert.rejects(
    () => updateExecutive(db, execId, { status: 'OFF_DUTY' }),
    (e) => e.status === 409 && e.code === 'has_active_deliveries'
  );
  await assert.rejects(
    () => updateExecutive(db, execId, { is_active: false }),
    (e) => e.status === 409 && e.code === 'has_active_deliveries'
  );
});

test('reassigning an already-assigned order needs confirmation', async () => {
  const other = await createExecutive(db, { name: 'Gita Rai', phone: '9800000002' }, actor);
  await assert.rejects(
    () => assignDelivery(db, orderId, other.id),
    (e) => e.status === 409 && e.code === 'already_assigned',
    'two admins must not silently overwrite each other'
  );
  // Deliberate takeover is allowed, and both executives are re-evaluated.
  await assignDelivery(db, orderId, other.id, { reassign: true });
  assert.equal((await db.get('SELECT status FROM delivery_executives WHERE id = ?', [other.id])).status, 'BUSY');
  assert.equal(
    (await db.get('SELECT status FROM delivery_executives WHERE id = ?', [execId])).status,
    'AVAILABLE',
    'the previous owner is free again'
  );
  await assignDelivery(db, orderId, execId, { reassign: true });
});

test('an off-duty executive is not assignable without an explicit override', async () => {
  const off = await createExecutive(db, { name: 'Bikash Off', phone: '9800000003', status: 'OFF_DUTY' }, actor);
  const res = await db.run(
    `INSERT INTO orders (order_number, order_type, status) VALUES ('ORD-D2', 'delivery', 'pending')`
  );
  await assert.rejects(
    () => assignDelivery(db, res.lastInsertRowid, off.id),
    (e) => e.status === 409 && e.code === 'off_duty'
  );
  const ok = await assignDelivery(db, res.lastInsertRowid, off.id, { allowOffDuty: true });
  assert.equal(Number(ok.delivery_executive_id), Number(off.id));
  // The override does not silently put them back on duty.
  assert.equal((await db.get('SELECT status FROM delivery_executives WHERE id = ?', [off.id])).status, 'OFF_DUTY');
});

test('completing one delivery does not free an executive who still holds another', async () => {
  const second = await db.run(
    `INSERT INTO orders (order_number, order_type, status) VALUES ('ORD-D3', 'delivery', 'pending')`
  );
  await assignDelivery(db, second.lastInsertRowid, execId);
  assert.equal((await db.get('SELECT status FROM delivery_executives WHERE id = ?', [execId])).status, 'BUSY');

  await db.run(`UPDATE orders SET status = 'completed' WHERE id = ?`, [orderId]);
  await refreshStatusFromAssignments(db, execId);
  assert.equal(
    (await db.get('SELECT status FROM delivery_executives WHERE id = ?', [execId])).status,
    'BUSY',
    'one delivery down, one still on the road'
  );

  await db.run(`UPDATE orders SET status = 'completed' WHERE id = ?`, [second.lastInsertRowid]);
  await refreshStatusFromAssignments(db, execId);
  assert.equal((await db.get('SELECT status FROM delivery_executives WHERE id = ?', [execId])).status, 'AVAILABLE');
});

test('delivered totals read the existing bill and never create a second sale', async () => {
  await db.run(
    `INSERT INTO bills (bill_number, order_id, subtotal, tax, grand_total, status)
     VALUES ('B-DEL-1', ?, 1200, 0, 1200, 'paid')`,
    [orderId]
  );

  const summary = await executiveSummary(db, execId);
  assert.equal(summary.completed_deliveries, 2);
  assert.equal(summary.delivered_amount, 1200, 'only the billed order contributes');

  // The bill is the single source of the sale. Attribution must not add a row
  // to `bills`, or the Sales Report would count 1,200 twice.
  const bills = await db.all(`SELECT id FROM bills WHERE order_id = ?`, [orderId]);
  assert.equal(bills.length, 1, 'one order, one bill — attribution creates nothing');

  const [listed] = (await listExecutives(db)).filter((r) => Number(r.id) === Number(execId));
  assert.equal(Number(listed.delivered_amount), 1200, 'the list agrees with the detail page');
  assert.equal(Number(listed.active_deliveries), 0);
});

test('clearing an assignment releases the executive', async () => {
  const res = await db.run(
    `INSERT INTO orders (order_number, order_type, status) VALUES ('ORD-D4', 'delivery', 'pending')`
  );
  await assignDelivery(db, res.lastInsertRowid, execId);
  assert.equal((await db.get('SELECT status FROM delivery_executives WHERE id = ?', [execId])).status, 'BUSY');

  await assignDelivery(db, res.lastInsertRowid, null);
  const order = await db.get('SELECT delivery_executive_id FROM orders WHERE id = ?', [res.lastInsertRowid]);
  assert.equal(order.delivery_executive_id, null);
  assert.equal((await db.get('SELECT status FROM delivery_executives WHERE id = ?', [execId])).status, 'AVAILABLE');
});

test('a closed order can no longer be reassigned', async () => {
  await assert.rejects(
    () => assignDelivery(db, orderId, execId, { reassign: true }),
    (e) => e.status === 409 && e.code === 'order_closed'
  );
});
