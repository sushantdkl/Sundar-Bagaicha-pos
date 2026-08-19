/**
 * Guards on the two mistakes that made thermal receipts print on US Letter.
 *
 * The real proof lives in tests/e2e/thermal-print.spec.js, which measures the
 * PDF a browser actually produces. These are the cheap tripwires that run on
 * every `npm run test:unit`, because both bugs are invisible on screen and only
 * show up on paper:
 *
 *   1. `@page { size: 80mm auto }` is invalid CSS — Paged Media accepts
 *      `<length>{1,2}` or the bare keyword `auto`, never a mix — so Chromium
 *      dropped it and fell back to the default paper.
 *   2. Measuring `documentElement.scrollHeight` floors the height at the print
 *      window's viewport (640px ≈ 170mm), padding every short receipt back out
 *      with blank paper even once the page size was valid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { receiptStyle, RECEIPT_SIZES, normalizeSize } from '../../lib/print-receipt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

/** Capture the document a print call would have written. */
function capturePrintDocument(run) {
  let html = '';
  global.window = {
    open: () => ({ document: { write: (h) => { html += h; }, close() {} }, focus() {}, print() {}, close() {} }),
  };
  try {
    run();
    return html;
  } finally {
    delete global.window;
  }
}

const { printKot, printFinalBill } = await import('../../lib/pos-print.js');
const { primeBusinessIdentity } = await import('../../lib/business-identity.js');

primeBusinessIdentity({ restaurant_name: 'Sundar Bagaicha Events' });

const kot = {
  kot_number: 'KOT-1', sequence: 1, order_number: 'ORD-1', order_id: 1,
  printed_at: '2026-08-19T09:00:00Z', items: [{ item_name: 'Chicken Momo', quantity: 1 }],
};
const bill = {
  bill_number: 'BIL-1', order_number: 'ORD-1', items: [{ item_name: 'Momo', quantity: 1, price: 100, subtotal: 100 }],
  subtotal: 100, grand_total: 100, payment_status: 'paid', allocations: [],
  processed_at: '2026-08-19T09:00:00Z',
};

for (const size of ['58', '80']) {
  test(`${size}mm stylesheet never emits the invalid "<length> auto" page size`, () => {
    const css = receiptStyle(size, { layout: 'bill' });
    assert.match(css, /@page\s*\{\s*margin:\s*0;\s*\}/, 'the static @page rule should carry margin only');
    assert.doesNotMatch(
      css.replace(/\/\*[\s\S]*?\*\//g, ''),
      /size:\s*[\d.]+mm\s+auto/,
      'a length paired with `auto` is invalid CSS and gets dropped, falling back to Letter/A4'
    );
  });
}

for (const [label, run, size] of [
  ['KOT', () => printKot(kot, { size: '80' }), '80'],
  ['bill', () => printFinalBill(bill, { size: '80' }), '80'],
  ['KOT 58mm', () => printKot(kot, { size: '58' }), '58'],
]) {
  test(`${label} writes a runtime @page rule using the configured paper width`, () => {
    const html = capturePrintDocument(run);
    const paper = RECEIPT_SIZES[normalizeSize(size)].page;
    assert.match(html, new RegExp(`@page \\{ size: ${paper} ' \\+ mm \\+ 'mm; margin: 0; \\}`),
      'the print document must build its page size from the measured height');
  });
}

test('the height is measured off the body, not the viewport-floored root', () => {
  const html = capturePrintDocument(() => printFinalBill(bill, { size: '80' }));
  assert.match(html, /body\.getBoundingClientRect\(\)\.height|b\.getBoundingClientRect\(\)\.height/);
  // Match a real property access, not the comment that explains why it is wrong.
  assert.doesNotMatch(
    html,
    /document\.documentElement\.scrollHeight|d\.scrollHeight/,
    'documentElement.scrollHeight is floored at the print window viewport'
  );
});

test('px→mm uses the CSS definition of an inch', () => {
  const html = capturePrintDocument(() => printFinalBill(bill, { size: '80' }));
  assert.match(html, /25\.4\s*\/\s*96/, '1in = 96px = 25.4mm');
});

test('the item table cannot be widened by one long product name', () => {
  const css = receiptStyle('80', { layout: 'bill' });
  assert.match(css, /table-layout:\s*fixed/);
  assert.match(css, /\.c-name\s*\{[^}]*word-break:\s*break-word/);
});

test('short sections stay whole; the item table stays free to flow', () => {
  const css = receiptStyle('80', { layout: 'bill' });
  assert.match(css, /\.r-totals[^{]*\{[^}]*break-inside:\s*avoid/s);
  // A forced break would split a receipt that is meant to be continuous.
  assert.doesNotMatch(css, /page-break-(before|after)\s*:\s*(always|page)/);
  assert.doesNotMatch(css, /break-(before|after)\s*:\s*(always|page)/);
});

test('no thermal template reserves page-height or positions sections absolutely', () => {
  for (const rel of ['lib/print-receipt.js', 'lib/pos-print.js', 'components/billing/walk-in-billing.jsx']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    // Only the print CSS strings matter; the on-screen POS shell legitimately
    // uses viewport heights, so scope the check to the printed stylesheets.
    const printCss = src.match(/@media print[\s\S]*?<\/style>|<style>[\s\S]*?<\/style>/g) || [];
    for (const block of printCss) {
      assert.doesNotMatch(block, /(min-)?height:\s*100vh/, `${rel} reserves a viewport page height`);
      assert.doesNotMatch(block, /position:\s*(fixed|absolute)/, `${rel} positions a receipt section out of flow`);
      assert.doesNotMatch(block, /justify-content:\s*space-between[^}]*}\s*[^{]*\{[^}]*min-height/, `${rel} pushes a footer to the page bottom`);
    }
  }
});

test('the retired 10mm tail spacer is gone from the cashier bill template', () => {
  const src = fs.readFileSync(path.join(root, 'components/billing/walk-in-billing.jsx'), 'utf8');
  assert.doesNotMatch(src, /<div style="height:\s*10mm;"><\/div>/);
});
