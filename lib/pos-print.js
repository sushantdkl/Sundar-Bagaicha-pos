/**
 * Admin POS thermal print layouts. Reuses the shared print window + @page CSS
 * from lib/print-receipt.js so KOT and bill share paper-size handling (58/80mm)
 * but keep DISTINCT templates. The KOT template never shows prices/tax/totals.
 *
 * Silent printing is NOT claimed — a normal browser opens the print dialog.
 */

import { openReceiptPrint, formatReceiptMoney } from '@/lib/print-receipt.js';
import { compactOrderNumber } from '@/lib/document-display.js';
import { formatNepalTime, formatNepalDate, formatNepalClock } from '@/lib/time-utils.js';
import { resolveBusinessIdentity } from '@/lib/business-identity.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtTime(iso) {
  return formatNepalTime(iso || new Date());
}

/**
 * Kitchen Order Ticket. Quantities are visually prominent; no prices.
 *
 * The business name comes from the same Admin → Settings values the customer
 * bill uses (see lib/business-identity.js). Pass `settings` when the caller
 * already has them; otherwise the cache primed by the screen's own settings
 * load answers, and only then the deployment fallback.
 *
 * @param {object} kot   KOT snapshot (from the POS API)
 * @param {object} opts  { size, reprint, settings }
 */
export function printKot(kot, { size = '80', reprint = false, settings } = {}) {
  const business = resolveBusinessIdentity(settings);
  const isCancel = kot.kot_type === 'cancellation';
  const isReprint = reprint || kot.is_reprint || Number(kot.reprint_count || 0) > 0;
  const tag = isCancel ? 'CANCELLATION' : (kot.kot_type === 'additional' ? 'ADDITIONAL' : 'NEW');
  const dest = kot.order_type === 'delivery' ? 'DELIVERY'
    : kot.table_number ? `TABLE ${esc(kot.table_number)}` : 'TAKEAWAY';

  const rows = (kot.items || []).map((it) => `
    <tr>
      <td style="width:22%;text-align:center;font-size:20px;font-weight:bold;">${esc(it.quantity)}×</td>
      <td style="width:78%;">
        <div style="font-weight:bold;${isCancel ? 'text-decoration:line-through;' : ''}">${esc(it.item_name)}</div>
        ${it.variant_name ? `<div class="r-sm">↳ ${esc(it.variant_name)}</div>` : ''}
        ${it.special_instructions ? `<div class="r-sm">» ${esc(it.special_instructions)}</div>` : ''}
      </td>
    </tr>`).join('');

  const body = `
    <div class="r-head">
      <div class="r-name">${esc(business.restaurant_name)}</div>
      <div class="r-sm r-b">KITCHEN ORDER TICKET</div>
      ${isCancel ? '<div class="r-sm r-b">*** CANCELLATION ***</div>' : ''}
      ${isReprint ? '<div class="r-sm r-b">*** REPRINT ***</div>' : ''}
    </div>
    <div class="r-meta">
      <div style="font-size:16px;font-weight:800;text-align:center;margin-bottom:2px;">${dest}</div>
      <div class="r-meta-row"><span class="l">KOT</span><span class="v">${esc(kot.kot_number)}</span></div>
      <div class="r-meta-row"><span class="l">Seq</span><span class="v">#${esc(kot.sequence)} (${tag})</span></div>
      <div class="r-meta-row"><span class="l">Order</span><span class="v">${esc(compactOrderNumber(kot.order_number) || kot.order_id)}</span></div>
      <div class="r-meta-row"><span class="l">By</span><span class="v">${esc(kot.issued_by_name || '—')}</span></div>
      <div class="r-meta-row"><span class="l">Time</span><span class="v">${esc(fmtTime(kot.printed_at))}</span></div>
    </div>
    <table><tbody style="page-break-inside:auto;">${rows}</tbody></table>
    ${kot.order_notes ? `<div class="r-hr"></div><div class="r-sm"><b>KOT note:</b> ${esc(kot.order_notes)}</div>` : ''}
    <div class="r-foot">${isReprint ? `Reprint #${esc(kot.reprint_count)} · ` : ''}${esc(fmtTime())}</div>
  `;
  return openReceiptPrint({ title: `KOT ${kot.kot_number}`, size, body, layout: 'kot' });
}

function money(n) {
  return formatReceiptMoney(n);
}

function billRows(items) {
  return (items || []).map((it) => {
    const modifier = it.variant_name
      ? `<tr class="r-item-sub"><td></td><td colspan="3" class="r-mod">• ${esc(it.variant_name)}</td></tr>`
      : '';
    return `
    <tr>
      <td class="c-qty r-num">${esc(it.quantity)}</td>
      <td class="c-name">${esc(it.item_name)}</td>
      <td class="c-price r-num">${formatReceiptMoney(it.price)}</td>
      <td class="c-total r-num">${formatReceiptMoney(it.subtotal ?? it.price * it.quantity)}</td>
    </tr>${modifier}`;
  }).join('');
}

function itemsTable(items) {
  return `<table>
    <thead><tr><th class="c-qty">Qty</th><th class="c-name">Item</th><th class="c-price">Rate</th><th class="c-total">Amount</th></tr></thead>
    <tbody>${billRows(items)}</tbody>
  </table>`;
}

function totalsBlock({ subtotal, discount, tax, tax_percent, service_charge, service_charge_percent, delivery_fee, grand_total }) {
  return `
    <div class="r-totals">
      <div class="r-row"><span>Subtotal</span><span class="r-num">${money(subtotal)}</span></div>
      ${Number(discount) > 0 ? `<div class="r-row"><span>Discount</span><span class="r-num">-${money(discount)}</span></div>` : ''}
      ${Number(service_charge) > 0 ? `<div class="r-row"><span>Service Charge${service_charge_percent ? ` (${service_charge_percent}%)` : ''}</span><span class="r-num">${money(service_charge)}</span></div>` : ''}
      ${Number(tax) > 0 ? `<div class="r-row"><span>VAT${tax_percent ? ` (${tax_percent}%)` : ''}</span><span class="r-num">${money(tax)}</span></div>` : ''}
      ${Number(delivery_fee) > 0 ? `<div class="r-row"><span>Delivery</span><span class="r-num">${money(delivery_fee)}</span></div>` : ''}
    </div>
    <div class="r-grand"><span>TOTAL</span><span class="r-num">${formatReceiptMoney(grand_total, { prefix: true })}</span></div>`;
}

/** Restaurant header — only prints configured lines, never empty labels. */
function headerBlock(receipt) {
  // The receipt payload already carries the settings values; the resolver only
  // fills gaps, so a bill and a KOT printed a second apart can never disagree.
  const business = resolveBusinessIdentity(receipt);
  const lines = [
    receipt.restaurant_address ?? business.restaurant_address,
    [receipt.restaurant_phone ?? business.restaurant_phone,
      receipt.pan_number ? `PAN: ${receipt.pan_number}` : (receipt.vat_number ? `VAT: ${receipt.vat_number}` : '')]
      .filter(Boolean).join(' · '),
  ].filter(Boolean);
  return `
    <div class="r-head">
      <div class="r-name">${esc((receipt.restaurant_name || business.restaurant_name).toUpperCase())}</div>
      ${lines.map((l) => `<span class="r-sm">${esc(l)}</span>`).join('')}
    </div>`;
}

/** Document-type banner. Never claims TAX INVOICE — this system only issues customer bills. */
function doctypeBlock(mainLabel, tags = []) {
  const tag = tags.filter(Boolean).join(' · ');
  return `<div class="r-doctype"><div class="r-b">${esc(mainLabel)}</div>${tag ? `<div class="r-tag">${esc(tag)}</div>` : ''}</div>`;
}

function metaRow(label, value) {
  return `<div class="r-meta-row"><span class="l">${esc(label)}</span><span class="v">${esc(value)}</span></div>`;
}
function metaFull(label, value) {
  return `<div class="r-meta-full"><span>${esc(label)}: </span><span class="r-b">${esc(value)}</span></div>`;
}

const payLabel = (m) => ({ cash: 'Cash', qr: 'QR / Digital', card: 'Card', credit: 'Credit' }[m] || String(m || '').toUpperCase());

/** Payment section: reflects actual allocations/payment_status, never a visual guess. */
function paymentBlock(receipt) {
  const allocations = (receipt.allocations || []).filter((a) => Number(a.amount) > 0);
  const isSplit = allocations.length > 1;
  const isCreditOnly = allocations.length === 1 && allocations[0].method === 'credit';
  const rows = [];

  if (isCreditOnly) {
    rows.push(metaFull('Payment', 'CREDIT'));
    if (receipt.customer_name) rows.push(metaFull('Customer', receipt.customer_name));
    const due = Number(receipt.outstanding) > 0 ? receipt.outstanding : allocations[0].amount;
    rows.push(`<div class="r-row"><span class="r-b">Amount Due</span><span class="r-num r-b">${formatReceiptMoney(due, { prefix: true })}</span></div>`);
  } else if (allocations.length) {
    for (const a of allocations) {
      rows.push(isSplit
        ? `<div class="r-row"><span>${esc(payLabel(a.method))}${a.provider ? ` · ${esc(a.provider)}` : ''}</span><span class="r-num">${money(a.amount)}</span></div>`
        : metaFull('Payment', `${payLabel(a.method)}${a.provider ? ` · ${a.provider}` : ''}`));
    }
    if (isSplit) {
      const totalPaid = allocations.reduce((s, a) => s + Number(a.amount || 0), 0);
      rows.push(`<div class="r-row"><span class="r-b">Total Paid</span><span class="r-num r-b">${money(totalPaid)}</span></div>`);
    } else {
      const cashLeg = allocations.find((a) => a.method === 'cash' && Number(a.cash_tendered) > 0);
      if (cashLeg) {
        rows.push(`<div class="r-row"><span>Received</span><span class="r-num">${money(cashLeg.cash_tendered)}</span></div>`);
      }
    }
  } else if (receipt.payment_status === 'paid') {
    rows.push(metaFull('Payment', 'Recorded'));
  }

  if (Number(receipt.change) > 0) {
    rows.push(`<div class="r-row"><span>Change</span><span class="r-num">${money(receipt.change)}</span></div>`);
  }
  if (Number(receipt.outstanding) > 0 && !isCreditOnly) {
    rows.push(`<div class="r-row"><span class="r-b">Outstanding</span><span class="r-num r-b">${money(receipt.outstanding)}</span></div>`);
  }
  return rows.length ? `<div class="r-totals">${rows.join('')}</div>` : '';
}

function footerBlock(receipt, { pending = false } = {}) {
  const custom = receipt.receipt_footer && receipt.receipt_footer.trim();
  if (pending) {
    return `<div class="r-foot">Please settle the bill at the counter.<br/><span class="r-xs">${esc(fmtTime())}</span></div>`;
  }
  const thanks = custom || 'Thank you for your visit!';
  return `<div class="r-foot"><div class="r-thanks">${esc(thanks)}</div><span class="r-xs">${esc(fmtTime())}</span></div>`;
}

/** Proforma (unpaid) — pre-bill, visibly different from a paid receipt. */
export function printProforma(proforma, { size = '80', settings = {} } = {}) {
  const w = proforma.workspace || proforma;
  const t = proforma.totals || {};
  const order = w.order || {};
  const isDelivery = order.order_type === 'delivery';
  const isTakeaway = !order.table_number && !isDelivery;

  const body = `
    ${headerBlock(resolveBusinessIdentity(settings))}
    ${doctypeBlock('PRE-BILL', ['PAYMENT PENDING'])}
    <div class="r-meta">
      ${metaRow(isTakeaway || isDelivery ? 'Type' : 'Table', isDelivery ? 'Delivery' : isTakeaway ? 'Takeaway' : (order.table_number || '—'))}
      ${order.order_number ? metaFull('Order', compactOrderNumber(order.order_number)) : ''}
      <div class="r-meta-row"><span class="l">Date</span><span class="v">${esc(formatNepalDate())}</span></div>
      <div class="r-meta-row"><span class="l">Time</span><span class="v">${esc(formatNepalClock())}</span></div>
    </div>
    ${itemsTable(w.items)}
    ${totalsBlock({ subtotal: t.subtotal, discount: t.discount, tax: t.tax, tax_percent: t.taxPercent, service_charge: t.serviceCharge, service_charge_percent: t.servicePercent, delivery_fee: t.deliveryFee, grand_total: t.total })}
    ${footerBlock({}, { pending: true })}`;
  return openReceiptPrint({ title: 'Bill (unpaid)', size, body, layout: 'bill' });
}

/** Final customer bill (paid / partially paid). */
export function printFinalBill(receipt, { size = '80', reprint = false } = {}) {
  const statusLabel = { paid: 'PAID', partially_paid: 'PARTIALLY PAID', unpaid: 'UNPAID' }[receipt.payment_status] || String(receipt.payment_status || '').toUpperCase();

  // Reopened-bill change log + prior/new payment split, shown only when present.
  const ch = receipt.item_changes || null;
  const signMoney = (n) => formatReceiptMoney(n, { sign: true });
  const changeLine = (marker, name, qtyText, amount, strike = false) =>
    `<div class="r-row" style="font-size:10px;"><span>${marker} ${strike ? `<s>${esc(name)}</s>` : esc(name)} <b>${esc(qtyText)}</b></span><span class="r-num">${signMoney(amount)}</span></div>`;
  const changeRows = [];
  if (receipt.reopened && ch) {
    for (const r of ch.added || []) changeRows.push(changeLine('+', r.name, `×${r.toQty}`, r.deltaValue));
    for (const r of ch.changed || []) {
      const up = r.deltaQty > 0;
      changeRows.push(changeLine(up ? '+' : '−', r.name, `${r.fromQty}→${r.toQty}`, r.deltaValue));
    }
    for (const r of ch.removed || []) changeRows.push(changeLine('−', r.name, `×${r.fromQty}`, r.deltaValue, true));
  }
  const changeBlock = changeRows.length
    ? `<div class="r-totals"><div class="r-row"><span class="r-b">Changes after reopen</span><span></span></div>${changeRows.join('')}</div>`
    : '';

  const priorRows = (receipt.prior_payments || []).filter((p) => Number(p.amount) > 0)
    .map((p) => `<div class="r-row"><span>${esc(payLabel(p.method))}${p.provider ? ` · ${esc(p.provider)}` : ''}</span><span class="r-num">${money(p.amount)}</span></div>`).join('');
  const newRows = (receipt.new_payments || []).filter((p) => Number(p.amount) > 0)
    .map((p) => `<div class="r-row"><span>${esc(payLabel(p.method))}${p.provider ? ` · ${esc(p.provider)}` : ''}</span><span class="r-num">${money(p.amount)}</span></div>`).join('');
  const reopenPayBlock = receipt.reopened
    ? `<div class="r-totals">
        ${Number(receipt.already_paid) > 0 ? `<div class="r-row"><span class="r-b">Previously paid</span><span class="r-num r-b">${money(receipt.already_paid)}</span></div>${priorRows}` : ''}
        ${Number(receipt.due) > 0 ? `<div class="r-row"><span class="r-b">New payment</span><span class="r-num r-b">${money(receipt.due)}</span></div>${newRows}` : ''}
        ${Number(receipt.refund_due) > 0 ? `<div class="r-row"><span class="r-b">Refunded</span><span class="r-num r-b">${money(receipt.refund_due)}</span></div>` : ''}
      </div>`
    : '';

  const isDelivery = receipt.order_type === 'delivery';
  const isTakeaway = !receipt.table_number && !isDelivery;
  const docTags = ['NOT A TAX INVOICE'];
  if (receipt.reopened) docTags.push('REVISED');
  if (reprint) docTags.push('DUPLICATE COPY');
  if (receipt.payment_status !== 'paid') docTags.push(statusLabel);

  const body = `
    ${headerBlock(receipt)}
    ${doctypeBlock('CUSTOMER BILL', docTags)}
    <div class="r-meta">
      ${metaRow('Bill', receipt.bill_number)}
      ${metaRow(isTakeaway || isDelivery ? 'Type' : 'Table', isDelivery ? 'Delivery' : isTakeaway ? 'Takeaway' : receipt.table_number)}
      ${metaFull('Order', compactOrderNumber(receipt.order_number))}
      <div class="r-meta-row"><span class="l">Date</span><span class="v">${esc(formatNepalDate(receipt.processed_at))}</span></div>
      <div class="r-meta-row"><span class="l">Time</span><span class="v">${esc(formatNepalClock(receipt.processed_at))}</span></div>
      ${receipt.processed_by ? metaFull('Cashier', receipt.processed_by) : ''}
      ${metaFull('Customer', receipt.customer_name || 'Walk-in')}
    </div>
    ${itemsTable(receipt.items)}
    ${totalsBlock({ subtotal: receipt.subtotal, discount: receipt.discount, tax: receipt.tax, tax_percent: receipt.tax_percent, service_charge: receipt.service_charge, service_charge_percent: receipt.service_charge_percent, delivery_fee: receipt.delivery_fee, grand_total: receipt.grand_total })}
    ${changeBlock}
    ${reopenPayBlock}
    ${paymentBlock(receipt)}
    ${footerBlock(receipt)}`;
  return openReceiptPrint({ title: `Bill ${receipt.bill_number}`, size, body, layout: 'bill' });
}
