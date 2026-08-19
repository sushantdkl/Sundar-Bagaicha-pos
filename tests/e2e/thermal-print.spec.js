/**
 * Thermal print geometry — the only test that can catch this class of bug.
 *
 * The receipt templates are just strings, so a unit test can assert what they
 * say but not what a printer does with them. This renders each document in a
 * real Chromium and asks it for the actual print output, then measures the page
 * box out of the PDF.
 *
 * It exists because `@page { size: 80mm auto }` looks correct, passes review,
 * and is silently invalid: CSS Paged Media allows `<length>{1,2}` or the bare
 * keyword `auto`, never a mix, so Chromium dropped the declaration and fell
 * back to US Letter — 161mm of blank paper after a one-item bill and a page
 * break through the middle of a long one.
 *
 * No dev server needed: the documents are built in-process and rendered with
 * setContent.
 */
import { test, expect } from '@playwright/test';
import { printFinalBill, printProforma, printKot } from '../../lib/pos-print.js';
import { primeBusinessIdentity } from '../../lib/business-identity.js';

const PT_PER_MM = 72 / 25.4;

primeBusinessIdentity({
  restaurant_name: 'Sundar Bagaicha Events',
  restaurant_address: '12 Bhabhar, Birendranagar, Surkhet',
  restaurant_phone: '083-590893 / 9848293693',
});

/** Capture the HTML a print call would have written to its pop-up window. */
function capture(run) {
  let html = '';
  globalThis.window = {
    open: () => ({ document: { write: (h) => { html += h; }, close() {} }, focus() {}, print() {}, close() {} }),
  };
  try {
    run();
    // window.close() tears down the Playwright target and cannot be overridden
    // from page JS, so the self-close is neutered here. Everything else —
    // including the sizePage() measurement under test — runs as it ships.
    return html.replace(/window\.close\(\)/g, 'void 0');
  } finally {
    delete globalThis.window;
  }
}

const item = (name, price = 380) => ({ item_name: name, quantity: 1, price, subtotal: price });
const items = (n) => Array.from({ length: n }, (_, i) => item(`Chicken Lollipop ${i + 1}`, 100 + i * 10));

const bill = (over = {}) => ({
  bill_number: 'BIL-0017',
  order_number: 'ORD-0017',
  table_number: null,
  items: [item('Chicken Lollipop')],
  subtotal: 380,
  discount: 0,
  tax: 0,
  service_charge: 0,
  delivery_fee: 0,
  grand_total: 380,
  outstanding: 0,
  change: 0,
  payment_status: 'paid',
  customer_name: '',
  processed_by: 'Restaurant Admin',
  processed_at: '2026-08-19T09:00:00Z',
  allocations: [{ method: 'cash', amount: 380, cash_tendered: 400 }],
  restaurant_name: 'Sundar Bagaicha Events',
  restaurant_address: '12 Bhabhar, Birendranagar, Surkhet',
  restaurant_phone: '083-590893 / 9848293693',
  ...over,
});

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
    { item_name: 'Chicken Momo', quantity: 1 },
    { item_name: 'Mineral Water', quantity: 1 },
  ],
};

/**
 * Render a receipt the way the POS does and report the geometry the printer
 * would actually receive.
 */
async function measure(browser, html) {
  // Matches the real pop-up (window.open(..., 'width=360,height=640')) so a
  // viewport-floored measurement cannot hide behind a large default viewport.
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  await page.addInitScript(() => { window.print = () => {}; });
  await page.setContent(html, { waitUntil: 'load' });

  const dom = await page.evaluate(() => ({
    contentMm: (Math.ceil(document.body.getBoundingClientRect().height) * 25.4) / 96,
    overflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));

  const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
  const boxes = [...pdf.matchAll(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map((m) => ({ w: Number(m[1]), h: Number(m[2]) }));
  const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length || boxes.length;
  await page.close();

  return {
    pages,
    paperMm: boxes[0].w / PT_PER_MM,
    pageMm: boxes[0].h / PT_PER_MM,
    contentMm: dom.contentMm,
    blankMm: boxes[0].h / PT_PER_MM - dom.contentMm,
    overflowsX: dom.overflowsX,
  };
}

/** Every printed document must satisfy these, whatever it contains. */
function expectThermal(m, paper) {
  expect(m.pages, 'a thermal receipt is one continuous document').toBe(1);
  expect(m.paperMm, 'page width must be the configured paper').toBeCloseTo(paper, 0);
  expect(m.blankMm, 'no blank paper beyond the cut tail').toBeGreaterThanOrEqual(0);
  expect(m.blankMm, 'no blank paper beyond the cut tail').toBeLessThan(4);
  expect(m.overflowsX, 'nothing may run off the paper width').toBe(false);
}

const CASES = [
  ['1-item bill', () => printFinalBill(bill(), { size: '80' }), 80],
  ['5-item bill', () => printFinalBill(bill({ items: items(5), grand_total: 700 }), { size: '80' }), 80],
  ['15-item bill', () => printFinalBill(bill({ items: items(15), grand_total: 2100 }), { size: '80' }), 80],
  ['30-item bill', () => printFinalBill(bill({ items: items(30), grand_total: 4200 }), { size: '80' }), 80],
  ['long product names', () => printFinalBill(bill({
    items: [
      item('Chicken Chilly Momo Special'),
      item('Mineral Water 1 Litre Bottle'),
      item('Chicken Timur Special Event Portion'),
    ],
  }), { size: '80' }), 80],
  ['discount + service charge + VAT', () => printFinalBill(bill({
    items: items(6), subtotal: 2000, discount: 100,
    service_charge: 190, service_charge_percent: 10,
    tax: 271, tax_percent: 13, grand_total: 2361,
  }), { size: '80' }), 80],
  ['cash payment with change', () => printFinalBill(bill({
    allocations: [{ method: 'cash', amount: 380, cash_tendered: 500 }], change: 120,
  }), { size: '80' }), 80],
  ['QR / digital payment', () => printFinalBill(bill({
    allocations: [{ method: 'qr', amount: 380, provider: 'Fonepay' }],
  }), { size: '80' }), 80],
  ['split payment', () => printFinalBill(bill({
    allocations: [
      { method: 'cash', amount: 200 },
      { method: 'qr', amount: 100, provider: 'eSewa' },
      { method: 'credit', amount: 80 },
    ],
  }), { size: '80' }), 80],
  ['bill reprint', () => printFinalBill(bill({ items: items(8) }), { size: '80', reprint: true }), 80],
  ['pre-bill', () => printProforma({
    workspace: { order: { order_number: 'ORD-0017' }, items: items(4) },
    totals: { subtotal: 900, total: 900 },
  }, { size: '80' }), 80],
  ['KOT', () => printKot(kot, { size: '80' }), 80],
  ['KOT reprint', () => printKot({ ...kot, reprint_count: 2 }, { size: '80', reprint: true }), 80],
  ['KOT on 58mm', () => printKot(kot, { size: '58' }), 58],
  ['12-item bill on 58mm', () => printFinalBill(bill({ items: items(12) }), { size: '58' }), 58],
];

for (const [name, build, paper] of CASES) {
  test(`thermal geometry: ${name}`, async ({ browser }) => {
    expectThermal(await measure(browser, capture(build)), paper);
  });
}

test('receipt length tracks item count and nothing else', async ({ browser }) => {
  const short = await measure(browser, capture(() => printFinalBill(bill(), { size: '80' })));
  const medium = await measure(browser, capture(() => printFinalBill(bill({ items: items(10) }), { size: '80' })));
  const long = await measure(browser, capture(() => printFinalBill(bill({ items: items(30) }), { size: '80' })));

  expect(medium.pageMm).toBeGreaterThan(short.pageMm);
  expect(long.pageMm).toBeGreaterThan(medium.pageMm);
  // A 30-item bill is long, but it is still one uninterrupted document.
  expect(long.pages).toBe(1);
});

test('the totals block prints below the items, never relocated', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  await page.addInitScript(() => { window.print = () => {}; });
  await page.setContent(capture(() => printFinalBill(bill({ items: items(20) }), { size: '80' })), { waitUntil: 'load' });

  const order = await page.evaluate(() => {
    const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
    return {
      head: y('.r-head'), doctype: y('.r-doctype'), meta: y('.r-meta'),
      table: y('table'), grand: y('.r-grand'), foot: y('.r-foot'),
    };
  });
  await page.close();

  expect(order.head).toBeLessThan(order.doctype);
  expect(order.doctype).toBeLessThan(order.meta);
  expect(order.meta).toBeLessThan(order.table);
  expect(order.table).toBeLessThan(order.grand);
  expect(order.grand).toBeLessThan(order.foot);
});
