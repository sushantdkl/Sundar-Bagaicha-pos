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

  // Menu and inventory setup screens are complete management surfaces, so a
  // single grant admits both the page and its matching write endpoints. Their
  // read endpoints stay available where POS, recipes and inventory pickers
  // already depend on them.
  { key: 'menu.products.manage', label: 'Manage menu items', category: 'Menu', roles: ['cashier'], description: 'Open Menu Items and create, edit, archive or add images to menu products and variants.' },
  { key: 'menu.categories.manage', label: 'Manage menu categories', category: 'Menu', roles: ['cashier'], description: 'Open Categories and create, edit, reorder or remove menu categories.' },
  { key: 'menu.recipes.manage', label: 'Manage recipes', category: 'Menu', roles: ['cashier'], description: 'Open Recipes and create, edit or remove recipes, ingredients and costing details.' },
  { key: 'inventory.dashboard.view', label: 'View inventory dashboard', category: 'Inventory', roles: ['cashier'], description: 'Open the inventory dashboard and view stock health, valuation and movement summaries.' },
  { key: 'inventory.categories.manage', label: 'Manage inventory categories', category: 'Inventory', roles: ['cashier'], description: 'Open Inventory Categories and create, rename or remove stock categories.' },
  { key: 'inventory.unit_conversions.manage', label: 'Manage unit conversions', category: 'Inventory', roles: ['cashier'], description: 'Open Unit Conversion and create, edit or remove purchase-to-consumption unit rules.' },
  { key: 'savings.manage', label: 'Manage savings & deposits', category: 'Finance', roles: ['cashier'], description: 'View savings balances, record transfers to savings and void incorrect deposits.' },

  // Events is part of the cashier workspace by default. The keys stay separate
  // so an admin can revoke high-risk actions without removing read access —
  // booking a wedding is not the same as releasing stock or settling the bill.
  { key: 'events.view', label: 'View events', category: 'Events', roles: ['cashier'], description: 'Open the Events dashboard, calendar, event detail, BEO, forecast and live board.' },
  { key: 'events.manage', label: 'Create and edit events', category: 'Events', roles: ['cashier'], description: 'Create events and edit details, menu lines, guest counts, the run sheet and the BEO.' },
  { key: 'events.discount', label: 'Discount or override a price', category: 'Events', roles: ['cashier'], description: 'Apply an event discount, change tax or service charge, or override a package or item price.' },
  { key: 'events.confirm', label: 'Move an event forward', category: 'Events', roles: ['cashier'], description: 'Quote, confirm, plan and finalize an event, including overriding a space or capacity conflict.' },
  { key: 'events.cancel', label: 'Cancel an event', category: 'Events', roles: ['cashier'], description: 'Cancel a booked event. Deposits already taken still have to be refunded separately.' },
  { key: 'events.deposits', label: 'Take, refund or void a deposit', category: 'Events', roles: ['cashier'], description: 'Record an advance against an event, refund it, or void a deposit entry. Posts to the ledger.' },
  { key: 'events.production', label: 'Start an event', category: 'Events', roles: ['cashier'], description: 'Release the event to the kitchen. This is the point stock is actually deducted and cannot be undone by re-running it.' },
  { key: 'events.billing', label: 'Settle the final bill', category: 'Events', roles: ['cashier'], description: 'Produce the final event bill, apply advances, take the balance and complete the event.' },
  { key: 'events.setup', label: 'Configure spaces and packages', category: 'Events', roles: ['cashier'], description: 'Create and edit event spaces, packages, price tiers, package menus and event settings.' },
  { key: 'events.reports', label: 'View event reporting', category: 'Events', roles: ['cashier'], description: 'Consolidated sales by channel, the events report and event profitability.' },

  // Delivery. Assignment is separated from management on purpose: a cashier
  // handing the next order to whoever is free is routine, while creating and
  // deactivating executives is not.
  { key: 'delivery_executives.view', label: 'View delivery executives', category: 'Delivery', roles: ['cashier'], description: 'See the executive list, their status and what each has delivered.' },
  { key: 'delivery_executives.manage', label: 'Add or edit delivery executives', category: 'Delivery', roles: ['cashier'], description: 'Create executives, edit their details, change status and deactivate them.' },
  { key: 'delivery_executives.assign', label: 'Assign a delivery', category: 'Delivery', roles: ['waiter', 'cashier'], description: 'Attach a delivery order to an executive, or reassign it.' },
  { key: 'delivery_executives.export', label: 'Export delivery executives', category: 'Delivery', roles: ['cashier'], description: 'Download the executive list with delivery counts and delivered sales.' },

  // HRM. View and manage are split for each area because seeing the roster is
  // very different from editing pay-relevant records.
  { key: 'hrm.departments.view', label: 'View departments', category: 'HRM', roles: ['cashier'], description: 'See the department list and how many staff sit in each.' },
  { key: 'hrm.departments.manage', label: 'Manage departments', category: 'HRM', roles: ['cashier'], description: 'Create, rename and archive departments.' },
  { key: 'hrm.designations.view', label: 'View designations', category: 'HRM', roles: ['cashier'], description: 'See job titles and the department each belongs to.' },
  { key: 'hrm.designations.manage', label: 'Manage designations', category: 'HRM', roles: ['cashier'], description: 'Create, rename and archive job titles.' },
  { key: 'hrm.staff.view', label: 'View staff records', category: 'HRM', roles: ['cashier'], description: 'See the staff roster with department, designation and employment status.' },
  { key: 'hrm.staff.manage', label: 'Edit staff HR details', category: 'HRM', roles: ['cashier'], description: 'Set a person’s department, designation, employment status and contact details. Does not change their system role or login.' },
  { key: 'hrm.attendance.view', label: 'View attendance', category: 'HRM', roles: ['cashier'], description: 'See daily attendance and the monthly summary.' },
  { key: 'hrm.attendance.manage', label: 'Mark attendance', category: 'HRM', roles: ['cashier'], description: 'Record and correct check-in, check-out and attendance status.' },
  { key: 'hrm.holidays.view', label: 'View holidays', category: 'HRM', roles: ['cashier'], description: 'See the holiday calendar.' },
  { key: 'hrm.holidays.manage', label: 'Manage holidays', category: 'HRM', roles: ['cashier'], description: 'Add, edit and archive holidays.' },
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
  'purchases.view': { waiter: false, cashier: true, kitchen: false },
  'purchases.create': { waiter: false, cashier: true, kitchen: false },
  'purchases.import': { waiter: false, cashier: true, kitchen: false },
  'purchases.edit': { waiter: false, cashier: true, kitchen: false },
  'purchases.void': { waiter: false, cashier: true, kitchen: false },
  'suppliers.view': { waiter: false, cashier: true, kitchen: false },
  'suppliers.manage': { waiter: false, cashier: true, kitchen: false },
  'payroll.view': { waiter: false, cashier: false, kitchen: false },
  'payroll.advances.create': { waiter: false, cashier: false, kitchen: false },
  // Cashier is the operational role for these modules. They are visible and
  // usable out of the box, while the permission matrix can still revoke any
  // module or high-risk Events action for a particular deployment.
  'menu.products.manage': { waiter: false, cashier: true, kitchen: false },
  'menu.categories.manage': { waiter: false, cashier: true, kitchen: false },
  'menu.recipes.manage': { waiter: false, cashier: true, kitchen: false },
  'inventory.dashboard.view': { waiter: false, cashier: true, kitchen: false },
  'inventory.categories.manage': { waiter: false, cashier: true, kitchen: false },
  'inventory.unit_conversions.manage': { waiter: false, cashier: true, kitchen: false },
  'savings.manage': { waiter: false, cashier: true, kitchen: false },
  'events.view': { waiter: false, cashier: true, kitchen: false },
  'events.manage': { waiter: false, cashier: true, kitchen: false },
  'events.discount': { waiter: false, cashier: true, kitchen: false },
  'events.confirm': { waiter: false, cashier: true, kitchen: false },
  'events.cancel': { waiter: false, cashier: true, kitchen: false },
  'events.deposits': { waiter: false, cashier: true, kitchen: false },
  'events.production': { waiter: false, cashier: true, kitchen: false },
  'events.billing': { waiter: false, cashier: true, kitchen: false },

  // Cashiers need to see and assign executives during checkout; management
  // and exports remain opt-in administrative capabilities.
  'delivery_executives.view': { waiter: false, cashier: true, kitchen: false },
  'delivery_executives.manage': { waiter: false, cashier: false, kitchen: false },
  'delivery_executives.assign': { waiter: false, cashier: true, kitchen: false },
  'delivery_executives.export': { waiter: false, cashier: false, kitchen: false },
  'hrm.departments.view': { waiter: false, cashier: false, kitchen: false },
  'hrm.departments.manage': { waiter: false, cashier: false, kitchen: false },
  'hrm.designations.view': { waiter: false, cashier: false, kitchen: false },
  'hrm.designations.manage': { waiter: false, cashier: false, kitchen: false },
  'hrm.staff.view': { waiter: false, cashier: false, kitchen: false },
  'hrm.staff.manage': { waiter: false, cashier: false, kitchen: false },
  'hrm.attendance.view': { waiter: false, cashier: false, kitchen: false },
  'hrm.attendance.manage': { waiter: false, cashier: false, kitchen: false },
  'hrm.holidays.view': { waiter: false, cashier: false, kitchen: false },
  'hrm.holidays.manage': { waiter: false, cashier: false, kitchen: false },
  'events.setup': { waiter: false, cashier: true, kitchen: false },
  'events.reports': { waiter: false, cashier: true, kitchen: false },
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
