import test from 'node:test';
import assert from 'node:assert/strict';

// pos-print.js only touches `window` inside openReceiptPrint(); stub it so the
// template-building logic (the part with real branching) runs under `node --test`
// and we can assert on the exact HTML it would have sent to the print window.
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

const { printFinalBill, printProforma } = await import('../../lib/pos-print.js');

const baseReceipt = {
  bill_number: 'BIL-0012',
  order_number: 'ORD-0071',
  table_number: 'T-07',
  kot_numbers: ['KOT-001'],
  items: [
    { item_name: 'Chicken Burger', quantity: 2, price: 180, subtotal: 360 },
    { item_name: 'Chicken MoMo', quantity: 1, price: 170, subtotal: 170, variant_name: 'Steam (Full)' },
  ],
  subtotal: 1045,
  discount: 40,
  tax: 0,
  service_charge: 0,
  delivery_fee: 0,
  grand_total: 1005,
  outstanding: 0,
  change: 95,
  payment_status: 'paid',
  customer_name: '',
  processed_by: 'Pratik',
  processed_at: '2026-08-13T08:56:00Z',
  restaurant_name: 'Sundar Bagaicha Events',
  restaurant_address: '12 Bhabhar, Birendranagar, Surkhet',
  restaurant_phone: '9800000000',
  pan_number: '123456789',
  allocations: [{ method: 'cash', amount: 1005, cash_tendered: 1100, change: 95 }],
};

test('paid cash bill: shows CUSTOMER BILL, not a duplicate, with received/change', () => {
  const html = withStubbedPrintWindow(() => printFinalBill(baseReceipt, { size: '80' }));
  assert.match(html, /<div class="r-b">CUSTOMER BILL<\/div>/);
  assert.match(html, /NOT A TAX INVOICE/);
  assert.doesNotMatch(html, /<div class="r-b">TAX INVOICE<\/div>/); // never claims a bare tax invoice
  assert.doesNotMatch(html, /DUPLICATE COPY/);
  assert.match(html, /BIL-0012/); // full bill number, not compacted to B012
  assert.match(html, /1,005\.00/); // grand total
  assert.match(html, />Received</);
  assert.match(html, />Change</);
  assert.match(html, /Steam \(Full\)/); // variant shown under item
});

test('reprint flag prints DUPLICATE COPY without changing the bill number or totals', () => {
  const html = withStubbedPrintWindow(() => printFinalBill(baseReceipt, { size: '80', reprint: true }));
  assert.match(html, /DUPLICATE COPY/);
  assert.match(html, /BIL-0012/);
  assert.match(html, /1,005\.00/);
});

test('split payment lists each method plus a Total Paid line', () => {
  const receipt = {
    ...baseReceipt,
    change: 0,
    allocations: [
      { method: 'cash', amount: 500 },
      { method: 'qr', amount: 505, provider: 'eSewa' },
    ],
  };
  const html = withStubbedPrintWindow(() => printFinalBill(receipt, { size: '80' }));
  assert.match(html, /Cash/);
  assert.match(html, /QR \/ Digital/);
  assert.match(html, /eSewa/);
  assert.match(html, /Total Paid/);
});

test('credit sale shows CREDIT payment and Amount Due, not a misleading "Due" label', () => {
  const receipt = {
    ...baseReceipt,
    change: 0,
    outstanding: 1005,
    payment_status: 'partially_paid',
    customer_name: 'Ram Thapa',
    allocations: [{ method: 'credit', amount: 1005 }],
  };
  const html = withStubbedPrintWindow(() => printFinalBill(receipt, { size: '80' }));
  assert.match(html, /CREDIT/);
  assert.match(html, /Ram Thapa/);
  assert.match(html, /Amount Due/);
});

test('zero-value discount/service/tax rows are hidden, not printed as clutter', () => {
  const html = withStubbedPrintWindow(() => printFinalBill(baseReceipt, { size: '80' }));
  assert.doesNotMatch(html, />Service Charge</);
  assert.doesNotMatch(html, />VAT</);
  assert.doesNotMatch(html, />Delivery</);
  assert.match(html, />Discount</); // the one non-zero row still shows
});

test('proforma (pre-bill) is visibly different from the paid bill', () => {
  const html = withStubbedPrintWindow(() => printProforma({
    workspace: { order: { order_type: 'dine_in', table_number: 'T-03', order_number: 'ORD-0099' }, items: baseReceipt.items, kots: [] },
    totals: { subtotal: 350, discount: 0, tax: 0, serviceCharge: 0, deliveryFee: 0, total: 350 },
  }, { size: '80' }));
  assert.match(html, /<div class="r-b">PRE-BILL<\/div>/);
  assert.match(html, /PAYMENT PENDING/);
  assert.doesNotMatch(html, /<div class="r-b">CUSTOMER BILL<\/div>/);
  assert.match(html, /settle the bill at the counter/);
});

test('takeaway order shows Type: Takeaway instead of a table number', () => {
  const receipt = { ...baseReceipt, table_number: null };
  const html = withStubbedPrintWindow(() => printFinalBill(receipt, { size: '80' }));
  assert.match(html, /Takeaway/);
});

test('customer defaults to Walk-in when none is attached', () => {
  const html = withStubbedPrintWindow(() => printFinalBill(baseReceipt, { size: '80' }));
  assert.match(html, /Walk-in/);
});

test('large amounts keep grouped formatting (no broken/NaN totals)', () => {
  const receipt = { ...baseReceipt, subtotal: 123456, discount: 0, grand_total: 123456, allocations: [{ method: 'cash', amount: 123456, cash_tendered: 123456 }], change: 0 };
  const html = withStubbedPrintWindow(() => printFinalBill(receipt, { size: '80' }));
  assert.match(html, /1,23,456\.00/);
  assert.doesNotMatch(html, /NaN/);
});
