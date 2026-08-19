/**
 * The business name on a printed document must come from Admin → Settings, on
 * every document, with no template holding a brand string of its own. The KOT
 * used to carry a hard-coded name, so it kept printing whatever the source had
 * been compiled with while the customer bill already followed Settings.
 *
 * These tests pin the whole chain: settings in, same name out of bill, pre-bill,
 * KOT and KOT reprint — and no template-level brand literal anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

function withStubbedPrintWindow(run) {
  let captured = '';
  global.window = {
    open: () => ({
      document: { write: (html) => { captured += html; }, close: () => {} },
      focus: () => {},
      print: () => {},
      close: () => {},
    }),
  };
  try {
    run();
    return captured;
  } finally {
    delete global.window;
  }
}

const { printKot, printFinalBill, printProforma } = await import('../../lib/pos-print.js');
const { primeBusinessIdentity, resetBusinessIdentity, getBusinessIdentity } =
  await import('../../lib/business-identity.js');
const { RESTAURANT } = await import('../../lib/restaurant-info.js');

const kot = {
  kot_number: 'KOT-038',
  sequence: 1,
  order_number: 'ORD-0023',
  order_id: 23,
  table_number: 'T-12',
  issued_by_name: 'Restaurant Admin',
  printed_at: '2026-08-19T09:00:00Z',
  items: [
    { item_name: 'Chicken Burger', quantity: 4 },
    { item_name: 'Chicken Chilly Momo', quantity: 2 },
  ],
};

/**
 * The retired brand, in every spelling it was ever written in.
 * Deliberately NOT a bare /kathmandu/ — `Asia/Kathmandu` is the IANA timezone
 * this deployment legitimately runs on, and "Momo" alone is a real menu item.
 */
const RETIRED_BRAND = /kathmandu[\s_-]*momo|ktm[\s_-]+momo/i;

const settingsFor = (name) => ({
  restaurant_name: name,
  restaurant_address: '12 Bhabhar, Birendranagar, Surkhet',
  restaurant_phone: '083-590893',
});

test.beforeEach(() => resetBusinessIdentity());
test.after(() => resetBusinessIdentity());

test('KOT prints the name from Settings, not one compiled into the template', () => {
  primeBusinessIdentity(settingsFor('Sundar Bagaicha Events'));
  const html = withStubbedPrintWindow(() => printKot(kot, { size: '80' }));
  assert.match(html, /<div class="r-name">Sundar Bagaicha Events<\/div>/);
  assert.match(html, /KITCHEN ORDER TICKET/);
});

test('changing the setting changes the KOT — no code edit involved', () => {
  primeBusinessIdentity(settingsFor('Sundar Bagaicha Test'));
  const html = withStubbedPrintWindow(() => printKot(kot, { size: '80' }));
  assert.match(html, /<div class="r-name">Sundar Bagaicha Test<\/div>/);
  assert.doesNotMatch(html, /Sundar Bagaicha Events/);
});

test('an explicit settings object passed to printKot wins for that ticket', () => {
  primeBusinessIdentity(settingsFor('Cached Name'));
  const html = withStubbedPrintWindow(() =>
    printKot(kot, { size: '80', settings: settingsFor('Explicit Name') }));
  assert.match(html, /<div class="r-name">Explicit Name<\/div>/);
});

test('KOT reprint carries the same dynamic name and keeps its reprint marker', () => {
  primeBusinessIdentity(settingsFor('Sundar Bagaicha Test'));
  const html = withStubbedPrintWindow(() =>
    printKot({ ...kot, reprint_count: 2 }, { size: '80', reprint: true }));
  assert.match(html, /<div class="r-name">Sundar Bagaicha Test<\/div>/);
  assert.match(html, /\*\*\* REPRINT \*\*\*/);
  assert.match(html, /Reprint #2/);
  // A reprint is still a kitchen ticket: never any money on it.
  assert.doesNotMatch(html, /TOTAL|Subtotal|VAT|Rs\./);
});

test('bill, pre-bill and KOT agree on the business name from one settings load', () => {
  const settings = settingsFor('Sundar Bagaicha Test');
  primeBusinessIdentity(settings);

  const kotHtml = withStubbedPrintWindow(() => printKot(kot, { size: '80' }));
  const proformaHtml = withStubbedPrintWindow(() =>
    printProforma({ workspace: { order: {}, items: [] }, totals: {} }, { size: '80', settings }));
  const billHtml = withStubbedPrintWindow(() => printFinalBill({
    bill_number: 'BIL-1', order_number: 'ORD-1', items: [], grand_total: 0,
    payment_status: 'paid', allocations: [], processed_at: '2026-08-19T09:00:00Z',
    ...settings,
  }, { size: '80' }));

  assert.match(kotHtml, /Sundar Bagaicha Test/);
  assert.match(proformaHtml, /SUNDAR BAGAICHA TEST/);
  assert.match(billHtml, /SUNDAR BAGAICHA TEST/);
});

test('with no settings loaded the fallback is the deployment identity, not a stale brand', () => {
  const identity = getBusinessIdentity();
  assert.equal(identity.restaurant_name, RESTAURANT.name);
  const html = withStubbedPrintWindow(() => printKot(kot, { size: '80' }));
  assert.match(html, new RegExp(RESTAURANT.name));
  assert.doesNotMatch(html, RETIRED_BRAND);
});

test('a settings payload with no name never overwrites a good cached one', () => {
  primeBusinessIdentity(settingsFor('Sundar Bagaicha Events'));
  primeBusinessIdentity({});                    // screen rendered before its fetch resolved
  primeBusinessIdentity({ vat_percentage: 13 }); // unrelated settings load
  assert.equal(getBusinessIdentity().restaurant_name, 'Sundar Bagaicha Events');
});

test('no print template carries a hard-coded brand name', () => {
  for (const rel of ['lib/pos-print.js', 'lib/print-receipt.js']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(src, RETIRED_BRAND, `${rel} still mentions the old brand`);
    // The venue name may appear in prose, but never as a value the template prints.
    assert.doesNotMatch(
      src,
      /^\s*const\s+RESTAURANT\s*=\s*['"]/m,
      `${rel} declares a brand constant instead of reading Settings`
    );
  }
});

test('no source file anywhere still carries the retired brand', () => {
  const skip = new Set(['node_modules', '.next', '.git', 'test-results', 'public', 'databases', 'migrations', 'tests']);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx|mjs|css|sql)$/.test(entry.name)) {
        if (RETIRED_BRAND.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], `retired brand still present in: ${offenders.join(', ')}`);
});
