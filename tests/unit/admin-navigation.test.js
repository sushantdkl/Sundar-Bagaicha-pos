/**
 * Admin sidebar structure.
 *
 * The sidebar is a plain array in a client component, so it is asserted against
 * the source. Two things are worth locking down and neither is cosmetic:
 *
 *  1. Every href must be a route that exists. A sidebar link to a page nobody
 *     built is a 404 with a friendly label, and it is the failure mode this
 *     reorganisation was most likely to introduce.
 *
 *  2. The group order and the ledger names are the reorganisation itself.
 *     Renaming Accounts Receivable to Customer Ledger is a UI change only —
 *     the routes, and therefore the accounting behind them, are unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = fs.readFileSync(path.join(root, 'components/admin/admin-layout.jsx'), 'utf8');

/** The admin nav array, sliced out of the component source. */
const adminNav = src.slice(
  src.indexOf('const adminNavGroups = ['),
  src.indexOf('const cashierNavGroups = [')
);

const hrefs = [...adminNav.matchAll(/href: '(\/admin[^']*)'/g)].map((m) => m[1]);
const groups = [...adminNav.matchAll(/^\s{6}label: '([^']+)',$/gm)].map((m) => m[1]);

test('every admin sidebar link points at a route that exists', () => {
  const missing = [];
  for (const href of new Set(hrefs)) {
    // /admin/orders/online -> app/admin/orders/online/page.jsx
    const dir = path.join(root, 'app', href.replace(/^\//, ''));
    const ok = ['page.jsx', 'page.js'].some((f) => fs.existsSync(path.join(dir, f)));
    if (!ok) missing.push(href);
  }
  assert.deepEqual(missing, [], `sidebar links with no page: ${missing.join(', ')}`);
});

test('the group order puts Events between Inventory and Finance', () => {
  assert.deepEqual(
    groups,
    ['Menu', 'Operations', 'Inventory', 'Events', 'Finance', 'Accounting', 'HRM'],
    'expandable groups, in order'
  );
});

test('People is gone and HRM replaces it, with the full module', () => {
  assert.ok(!groups.includes('People'), 'the People group must not survive the rename');
  assert.ok(groups.includes('HRM'));

  const hrm = adminNav.slice(adminNav.indexOf("label: 'HRM'"));
  for (const label of ['Departments', 'Designations', 'Staff', 'Attendance', 'Payroll', 'Holidays']) {
    assert.ok(hrm.includes(`label: '${label}'`), `HRM must contain ${label}`);
  }

  // Payroll is the existing screen, reused rather than forked — there must not
  // be a second payroll engine under /admin/hrm.
  assert.match(adminNav, /label: 'Payroll', href: '\/admin\/payroll'/);
});

test('Delivery Executives sits inside Operations', () => {
  const operations = adminNav.slice(
    adminNav.indexOf("label: 'Operations'"),
    adminNav.indexOf("label: 'Customers'")
  );
  assert.match(operations, /label: 'Delivery Executives', href: '\/admin\/delivery-executives'/);
});

test('the new modules are permission-gated in the sidebar', () => {
  // Hiding a link is not the security boundary — the APIs check server-side —
  // but a cashier without the permission should not be shown a door that
  // refuses them.
  for (const key of [
    'delivery_executives.view', 'hrm.departments.view', 'hrm.designations.view',
    'hrm.staff.view', 'hrm.attendance.view', 'hrm.holidays.view',
  ]) {
    assert.ok(adminNav.includes(`requiredPermission: '${key}'`), `${key} must gate its link`);
  }
});

test('the ledgers are top-level and keep their accounting routes', () => {
  assert.match(adminNav, /label: 'Customer Ledger', href: '\/admin\/accounts-receivable'/);
  assert.match(adminNav, /label: 'Supplier Ledger', href: '\/admin\/accounts-payable'/);

  // Top-level means outside every group's items array.
  const accountingGroup = adminNav.slice(adminNav.indexOf("label: 'Accounting'"));
  assert.ok(
    !accountingGroup.includes('Customer Ledger'),
    'the ledgers moved out of Accounting'
  );

  // The bookkeeping names must not appear as navigation labels any more.
  assert.ok(!/label: 'Accounts Receivable'/.test(adminNav));
  assert.ok(!/label: 'Accounts Payable'/.test(adminNav));
});

test('renaming the navigation did not touch the account codes', () => {
  const accounting = fs.readFileSync(path.join(root, 'lib/accounting.js'), 'utf8');
  // 1300 stays Accounts Receivable and 2010 stays Accounts Payable on the
  // balance sheet, whatever the sidebar calls the screens.
  assert.match(accounting, /'1300'.*Accounts Receivable.*asset/);
  assert.match(accounting, /'2010'.*Accounts Payable.*liability/);
});

test('no duplicate navigation entries', () => {
  const labels = [...adminNav.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  const seen = new Set();
  const dupes = labels.filter((l) => (seen.has(l) ? true : (seen.add(l), false)));
  assert.deepEqual(dupes, [], `duplicated sidebar labels: ${dupes.join(', ')}`);
});

test('an event settlement can be classified as a payment method', async () => {
  // Regression: event bills record the applied advance as a payment row, and
  // anything that maps a bill's methods to accounts threw on it.
  const { paymentAccountCode, PAYMENT_ACCOUNT } = await import('../../lib/accounting.js');
  assert.equal(PAYMENT_ACCOUNT.advance, '2030', 'an applied advance clears the advances liability');
  assert.equal(paymentAccountCode('advance'), '2030');
  assert.throws(() => paymentAccountCode('not_a_method'), /Unknown payment method/);
});
