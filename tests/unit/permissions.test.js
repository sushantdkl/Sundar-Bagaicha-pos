import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { AuthService } from '../../lib/auth/auth.js';
import {
  PERMISSION_CATALOG,
  MANAGED_ROLES,
  ensurePermissionCache,
  invalidatePermissionCache,
  listRolePermissions,
  setRolePermissions,
  permissionAuditHistory,
} from '../../lib/permissions.js';

const dbPath = path.join(os.tmpdir(), `permissions-test-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);
const hasPermission = AuthService.prototype.hasPermission.bind({ db });
const admin = { id: 1, full_name: 'Admin One' };

test.after(() => {
  invalidatePermissionCache();
  try { db.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
  }
});

test('defaults reproduce today\'s hardcoded behavior before any admin edit', async () => {
  await ensurePermissionCache(db);
  assert.equal(hasPermission('cashier', 'orders.cancel'), true);
  assert.equal(hasPermission('waiter', 'orders.cancel'), true);
  assert.equal(hasPermission('kitchen', 'orders.cancel'), false);
  assert.equal(hasPermission('waiter', 'bills.void'), false);
  assert.equal(hasPermission('cashier', 'bills.void'), true);
  assert.equal(hasPermission('admin', 'bills.void'), true); // admin always allowed
  assert.equal(hasPermission('cashier', 'purchases.view'), true);
  assert.equal(hasPermission('cashier', 'purchases.create'), true);
  assert.equal(hasPermission('cashier', 'purchases.import'), true);
  assert.equal(hasPermission('cashier', 'purchases.edit'), true);
  assert.equal(hasPermission('cashier', 'purchases.void'), true);
  assert.equal(hasPermission('cashier', 'suppliers.view'), true);
  assert.equal(hasPermission('cashier', 'suppliers.manage'), true);
  assert.equal(hasPermission('cashier', 'payroll.view'), false);
  assert.equal(hasPermission('cashier', 'payroll.advances.create'), false);
  assert.equal(hasPermission('cashier', 'menu.products.manage'), true);
  assert.equal(hasPermission('cashier', 'inventory.dashboard.view'), true);
  assert.equal(hasPermission('cashier', 'savings.manage'), true);
  assert.equal(hasPermission('cashier', 'delivery_executives.view'), true);
});

test('every curated key has a default for every managed role', async () => {
  const { catalog, roles, matrix } = await listRolePermissions(db);
  assert.deepEqual(new Set(catalog.map((c) => c.key)), new Set(PERMISSION_CATALOG.map((c) => c.key)));
  assert.deepEqual(roles, MANAGED_ROLES);
  for (const role of roles) {
    for (const { key } of catalog) {
      assert.equal(typeof matrix[role][key], 'boolean');
    }
  }
});

test('admin can grant a role a previously-blocked action, and it takes effect immediately', async () => {
  invalidatePermissionCache();
  assert.equal(hasPermission('waiter', 'bills.void'), false); // cold-cache fallback matches default

  await setRolePermissions(db, [{ role: 'waiter', key: 'bills.void', allowed: true }], admin);
  await ensurePermissionCache(db);
  assert.equal(hasPermission('waiter', 'bills.void'), true);
});

test('admin can revoke destructive purchase actions without removing routine access', async () => {
  await setRolePermissions(db, [
    { role: 'cashier', key: 'purchases.void', allowed: false },
    { role: 'cashier', key: 'suppliers.manage', allowed: false },
  ], admin);
  invalidatePermissionCache();
  await ensurePermissionCache(db);
  assert.equal(hasPermission('cashier', 'purchases.view'), true);
  assert.equal(hasPermission('cashier', 'purchases.create'), true);
  assert.equal(hasPermission('cashier', 'purchases.import'), true);
  assert.equal(hasPermission('cashier', 'purchases.edit'), true);
  assert.equal(hasPermission('cashier', 'purchases.void'), false);
  assert.equal(hasPermission('cashier', 'suppliers.manage'), false);
});

test('admin can revoke a role\'s default access', async () => {
  await setRolePermissions(db, [{ role: 'cashier', key: 'kots.cancel', allowed: false }], admin);
  invalidatePermissionCache();
  await ensurePermissionCache(db);
  assert.equal(hasPermission('cashier', 'kots.cancel'), false);
});

test('admin can let a cashier give advances without granting salary payment control', async () => {
  await setRolePermissions(db, [
    { role: 'cashier', key: 'payroll.view', allowed: true },
    { role: 'cashier', key: 'payroll.advances.create', allowed: true },
  ], admin);
  invalidatePermissionCache();
  await ensurePermissionCache(db);
  assert.equal(hasPermission('cashier', 'payroll.view'), true);
  assert.equal(hasPermission('cashier', 'payroll.advances.create'), true);
  assert.equal(PERMISSION_CATALOG.some((entry) => entry.key === 'payroll.payments.create'), false);
});

test('every permission change writes an audit row with before/after values', async () => {
  const rows = await permissionAuditHistory(db);
  const grant = rows.find((r) => r.role === 'waiter' && r.permission_key === 'bills.void');
  assert.ok(grant);
  assert.equal(grant.previous_value, 0);
  assert.equal(grant.new_value, 1);
  assert.equal(grant.actor_name, admin.full_name);

  const revoke = rows.find((r) => r.role === 'cashier' && r.permission_key === 'kots.cancel');
  assert.ok(revoke);
  assert.equal(revoke.previous_value, 1); // default was true, no row existed yet
  assert.equal(revoke.new_value, 0);
});

test('saving the same value again does not write a duplicate audit row', async () => {
  const before = (await permissionAuditHistory(db)).length;
  await setRolePermissions(db, [{ role: 'waiter', key: 'bills.void', allowed: true }], admin); // already true
  const after = (await permissionAuditHistory(db)).length;
  assert.equal(after, before);
});

test('invalid role/key updates are silently ignored, valid ones in the same batch still apply', async () => {
  await setRolePermissions(db, [
    { role: 'not_a_role', key: 'bills.void', allowed: true },
    { role: 'waiter', key: 'not_a_key', allowed: true },
    { role: 'waiter', key: 'purchases.view', allowed: true },
    { role: 'kitchen', key: 'kots.cancel', allowed: true },
  ], admin);
  invalidatePermissionCache();
  await ensurePermissionCache(db);
  assert.equal(hasPermission('kitchen', 'kots.cancel'), true);
  assert.equal(hasPermission('waiter', 'purchases.view'), false);
});

test('non-curated permission keys are unaffected by this system (static map still governs them)', async () => {
  assert.equal(hasPermission('cashier', 'business_days.open'), true);
  assert.equal(hasPermission('cashier', 'business_days.force_close'), false);
  assert.equal(hasPermission('kitchen', 'orders.view'), true); // kitchen's static 'orders.view'
});

/* ------------------------------------------------------------------ events */

const EVENT_KEYS = [
  'events.view', 'events.manage', 'events.discount', 'events.confirm', 'events.cancel',
  'events.deposits', 'events.production', 'events.billing', 'events.setup', 'events.reports',
];

test('every events permission is in the catalogue exactly once, under one category', () => {
  const events = PERMISSION_CATALOG.filter((p) => p.key.startsWith('events.'));
  assert.deepEqual(events.map((p) => p.key).sort(), [...EVENT_KEYS].sort());
  for (const p of events) {
    assert.equal(p.category, 'Events', `${p.key} should sit in the Events category`);
    assert.ok(p.label && p.description, `${p.key} needs a label and a description`);
  }
});

test('cashier receives the Events module by default while other staff roles do not', async () => {
  invalidatePermissionCache();
  await ensurePermissionCache(db);
  for (const key of EVENT_KEYS) {
    assert.equal(hasPermission('admin', key), true, `admin must always hold ${key}`);
    assert.equal(hasPermission('cashier', key), true, `cashier must hold ${key} by default`);
    assert.equal(hasPermission('waiter', key), false, `waiter must not hold ${key} by default`);
    assert.equal(hasPermission('kitchen', key), false, `kitchen must not hold ${key} by default`);
  }
});

test('an events permission can be revoked one key at a time without revoking the module', async () => {
  await setRolePermissions(db, [{ role: 'cashier', key: 'events.discount', allowed: false }], admin);
  invalidatePermissionCache();
  await ensurePermissionCache(db);

  assert.equal(hasPermission('cashier', 'events.view'), true);
  assert.equal(hasPermission('cashier', 'events.discount'), false);
  for (const key of EVENT_KEYS.filter((k) => k !== 'events.discount')) {
    assert.equal(hasPermission('cashier', key), true, `revoking events.discount must not revoke ${key}`);
  }
  // Nobody else was affected.
  assert.equal(hasPermission('waiter', 'events.view'), false);
  assert.equal(hasPermission('kitchen', 'events.view'), false);
});

test('revoking an events permission is written to the audit trail', async () => {
  await setRolePermissions(db, [{ role: 'cashier', key: 'events.billing', allowed: false }], admin);
  const [latest] = await permissionAuditHistory(db, { limit: 1 });
  assert.equal(latest.permission_key, 'events.billing');
  assert.equal(latest.role, 'cashier');
  assert.equal(latest.previous_value, 1);
  assert.equal(latest.new_value, 0);
  assert.equal(latest.actor_name, 'Admin One');
});

test('events permissions are only offered to cashier, so no route can be handed to the kitchen', async () => {
  // The catalogue entry names cashier, so the update is filtered out; with
  // nothing valid left the whole batch is rejected rather than silently
  // writing a row the matrix would never show.
  await assert.rejects(
    () => setRolePermissions(db, [{ role: 'kitchen', key: 'events.production', allowed: true }], admin),
    /No valid permission changes supplied/
  );
  invalidatePermissionCache();
  await ensurePermissionCache(db);
  assert.equal(hasPermission('kitchen', 'events.production'), false);
  assert.equal(hasPermission('waiter', 'events.production'), false);
});
