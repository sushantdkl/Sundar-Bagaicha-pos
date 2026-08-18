/**
 * Admin-configurable permissions for a curated set of sensitive actions.
 *
 * Everything else (routes/menus/etc.) keeps using the static role arrays
 * already in lib/auth/auth.js — only these keys are toggle-able from
 * /admin/permissions. Defaults reproduce today's hardcoded behavior exactly,
 * so nothing changes for anyone until an admin edits the matrix.
 */
import { ensureColumn, serialPkSql } from './db/schema-helpers.js';
import { ensureSqliteTable } from './db/ensure-sqlite-table.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export const MANAGED_ROLES = ['waiter', 'cashier', 'kitchen'];

export const PERMISSION_CATALOG = [
  { key: 'orders.cancel', label: 'Cancel an order', category: 'Orders', description: 'Cancel or void an in-progress order from POS/admin.' },
  { key: 'orders.cancel_item', label: 'Remove a sent item', category: 'Orders', description: 'Remove an already-sent item from an order.' },
  { key: 'kots.cancel', label: 'Cancel a KOT', category: 'Kitchen', description: 'Cancel a kitchen order ticket.' },
  { key: 'bills.void', label: 'Void a paid bill', category: 'Billing', description: 'Void a bill that has already been paid.' },
  { key: 'bills.refund', label: 'Refund a bill', category: 'Billing', description: 'Issue a full or partial refund on a bill.' },
  { key: 'bills.reopen', label: 'Reopen a closed bill', category: 'Billing', description: 'Reopen a paid bill to add or change items.' },
  { key: 'bills.discount', label: 'Apply a discount', category: 'Billing', description: 'Apply or override a discount on a bill.' },
  { key: 'purchases.view', label: 'View purchases', category: 'Purchases & Suppliers', roles: ['cashier'], description: 'View purchase history, delivery lines and linked stock/expense records.' },
  { key: 'purchases.create', label: 'Receive a purchase', category: 'Purchases & Suppliers', roles: ['cashier'], description: 'Record a received delivery and update inventory and expenses.' },
  { key: 'purchases.import', label: 'Import purchases', category: 'Purchases & Suppliers', roles: ['cashier'], description: 'Upload and commit multiple invoice lines from CSV after previewing them.' },
  { key: 'purchases.edit', label: 'Edit a purchase', category: 'Purchases & Suppliers', roles: ['cashier'], description: 'Correct an existing delivery and safely re-apply its stock movement.' },
  { key: 'purchases.void', label: 'Void a purchase', category: 'Purchases & Suppliers', roles: ['cashier'], description: 'Reverse a purchase, its stock and its linked expense.' },
  { key: 'suppliers.view', label: 'View suppliers', category: 'Purchases & Suppliers', roles: ['cashier'], description: 'View supplier contact details and purchase history.' },
  { key: 'suppliers.manage', label: 'Create or edit suppliers', category: 'Purchases & Suppliers', roles: ['cashier'], description: 'Create suppliers and update their contact details. Supplier merging remains admin-only.' },
  { key: 'payroll.view', label: 'View salary & advances', category: 'Payroll', roles: ['cashier'], description: 'View employee salary amounts, advance balances and payroll history.' },
  { key: 'payroll.advances.create', label: 'Give salary advances', category: 'Payroll', roles: ['cashier'], description: 'Pay and record a salary advance for an employee. Salary payments remain admin-only.' },
];
const CATALOG_KEYS = new Set(PERMISSION_CATALOG.map((p) => p.key));
const CATALOG_BY_KEY = new Map(PERMISSION_CATALOG.map((p) => [p.key, p]));
export const DYNAMIC_PERMISSION_KEYS = CATALOG_KEYS;

// Reproduces the role arrays / in-handler checks these actions were gated by
// before this feature existed. Used to seed new rows and as the fallback
// while the cache is cold.
const DEFAULTS = {
  'orders.cancel': { waiter: true, cashier: true, kitchen: false },
  'orders.cancel_item': { waiter: true, cashier: true, kitchen: false },
  'kots.cancel': { waiter: true, cashier: true, kitchen: false },
  'bills.void': { waiter: false, cashier: true, kitchen: false },
  'bills.refund': { waiter: false, cashier: true, kitchen: false },
  'bills.reopen': { waiter: false, cashier: true, kitchen: false },
  'bills.discount': { waiter: true, cashier: true, kitchen: false },
  'purchases.view': { waiter: false, cashier: false, kitchen: false },
  'purchases.create': { waiter: false, cashier: false, kitchen: false },
  'purchases.import': { waiter: false, cashier: false, kitchen: false },
  'purchases.edit': { waiter: false, cashier: false, kitchen: false },
  'purchases.void': { waiter: false, cashier: false, kitchen: false },
  'suppliers.view': { waiter: false, cashier: false, kitchen: false },
  'suppliers.manage': { waiter: false, cashier: false, kitchen: false },
  'payroll.view': { waiter: false, cashier: false, kitchen: false },
  'payroll.advances.create': { waiter: false, cashier: false, kitchen: false },
};

export async function ensurePermissionsSchema(db) {
  if (db.driver === 'postgres') {
    const ready = await db.get(`SELECT to_regclass('public.role_permissions') AS t`);
    if (!ready?.t) fail('Permissions schema is not installed. Run database migration 038.', 503);
    return;
  }
  const pk = serialPkSql(db);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS role_permissions (
    role TEXT NOT NULL, permission_key TEXT NOT NULL, allowed INTEGER NOT NULL DEFAULT 0,
    updated_by INTEGER, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role, permission_key))`);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS permission_audit (
    ${pk}, role TEXT NOT NULL, permission_key TEXT NOT NULL, previous_value INTEGER,
    new_value INTEGER NOT NULL, actor_id INTEGER, actor_name TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await ensureColumn(db, 'role_permissions', 'updated_by', 'INTEGER');
}

function defaultFor(key, role) {
  return !!DEFAULTS[key]?.[role];
}

/* --------------------------------------------------------- sync read path */
// hasPermission() in lib/auth/auth.js must stay synchronous (it's called
// without await from a handful of unrelated routes) — so the DB-backed
// matrix is loaded into this module-level cache ahead of time (see
// ensurePermissionCache, awaited once per request in api-guard.js) and
// checked here without touching the database.

let CACHE = null;

export async function ensurePermissionCache(db) {
  if (CACHE) return CACHE;
  await ensurePermissionsSchema(db);
  const rows = await db.all(`SELECT role, permission_key, allowed FROM role_permissions`);
  const cache = {};
  for (const role of MANAGED_ROLES) cache[role] = {};
  for (const row of rows || []) {
    if (!cache[row.role]) cache[row.role] = {};
    cache[row.role][row.permission_key] = !!row.allowed;
  }
  CACHE = cache;
  return CACHE;
}

export function invalidatePermissionCache() {
  CACHE = null;
}

export function isPermissionAllowedSync(role, key) {
  if (role === 'admin') return true;
  const cached = CACHE?.[role]?.[key];
  if (cached != null) return cached;
  return defaultFor(key, role);
}

/* ------------------------------------------------------------- admin CRUD */

export async function listRolePermissions(db) {
  await ensurePermissionsSchema(db);
  const rows = await db.all(`SELECT role, permission_key, allowed FROM role_permissions`);
  const matrix = {};
  for (const role of MANAGED_ROLES) {
    matrix[role] = {};
    for (const { key } of PERMISSION_CATALOG) matrix[role][key] = defaultFor(key, role);
  }
  for (const row of rows || []) {
    if (matrix[row.role]) matrix[row.role][row.permission_key] = !!row.allowed;
  }
  return { catalog: PERMISSION_CATALOG, roles: MANAGED_ROLES, matrix };
}

export async function setRolePermissions(db, updates, actor) {
  await ensurePermissionsSchema(db);
  const clean = (updates || []).filter((u) => {
    if (!MANAGED_ROLES.includes(u?.role) || !CATALOG_KEYS.has(u?.key)) return false;
    const allowedRoles = CATALOG_BY_KEY.get(u.key)?.roles;
    return !allowedRoles || allowedRoles.includes(u.role);
  });
  if (!clean.length) fail('No valid permission changes supplied.');

  await db.transaction(async (tx) => {
    for (const { role, key, allowed } of clean) {
      const prev = await tx.get(`SELECT allowed FROM role_permissions WHERE role=? AND permission_key=?`, [role, key]);
      const nextValue = allowed ? 1 : 0;
      await tx.run(
        `INSERT INTO role_permissions (role, permission_key, allowed, updated_by, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (role, permission_key) DO UPDATE SET allowed = excluded.allowed, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [role, key, nextValue, actor?.id || null]
      );
      const previousValue = prev ? (prev.allowed ? 1 : 0) : (defaultFor(key, role) ? 1 : 0);
      if (previousValue !== nextValue) {
        await tx.run(
          `INSERT INTO permission_audit (role, permission_key, previous_value, new_value, actor_id, actor_name)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [role, key, previousValue, nextValue, actor?.id || null, actor?.full_name || actor?.username || null]
        );
      }
    }
  });

  invalidatePermissionCache();
  return listRolePermissions(db);
}

export async function permissionAuditHistory(db, { limit = 100 } = {}) {
  await ensurePermissionsSchema(db);
  return db.all(`SELECT * FROM permission_audit ORDER BY created_at DESC, id DESC LIMIT ${Math.min(500, Math.max(1, Number(limit) || 100))}`);
}
