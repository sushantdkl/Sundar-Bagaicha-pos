import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { deductStockForItems, autoLinkBeverageStock } from '@/lib/stock.js';
import { resolveCustomerForSale } from '@/lib/customers.js';
import { calculateBillTotals, parseSettingsRates } from '@/lib/billing-totals.js';
import { requireAuth } from '@/lib/api-guard.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { ensureSplitPaymentSchema, recordInitialSplitSettlement, validateAllocations } from '@/lib/split-payments.js';
import { nextDocumentNumber } from '@/lib/document-numbers.js';
import { currentBusinessDayId } from '@/lib/business-days.js';
import { ensureOrderColumns } from '@/lib/online-orders.js';
import { ensurePermissionCache, isPermissionAllowedSync } from '@/lib/permissions.js';

async function loadSettingsRates(db) {
  const rows = await db.all('SELECT setting_key, setting_value FROM system_settings');
  const settings = {};
  for (const row of rows || []) settings[row.setting_key] = row.setting_value;
  return parseSettingsRates(settings);
}

async function resolveSaleItems(db, incoming) {
  const items = [];
  for (const item of incoming || []) {
    const quantity = Math.max(1, Math.min(999, parseInt(item.quantity, 10) || 1));
    if (item.is_custom) {
      const name = String(item.name || '').trim().slice(0, 160);
      const price = Number(item.price);
      if (!name || !Number.isFinite(price) || price <= 0) throw Object.assign(new Error('Custom items require a name and positive price.'), { status: 400 });
      items.push({ menu_item_id: null, name, price, quantity, subtotal: price * quantity, is_custom: true });
      continue;
    }
    const menuId = Number(item.menu_item_id || item.id);
    const menu = await db.get('SELECT id, name, base_price, is_available FROM menu_items WHERE id=?', [menuId]);
    if (!menu || !menu.is_available) throw Object.assign(new Error('One of the selected menu items is no longer available.'), { status: 409 });
    const price = Number(menu.base_price);
    items.push({ menu_item_id: menu.id, name: menu.name, price, quantity, subtotal: price * quantity, is_custom: false });
  }
  return items;
}

function incomingAllocations(data, total) {
  if (Array.isArray(data.allocations)) return data.allocations;
  const method = data.payment_method === 'online' ? 'qr' : (data.payment_method || 'cash');
  return [{
    method,
    amount: total,
    cash_tendered: method === 'cash' ? Number(data.amount_paid ?? total) : undefined,
    provider: data.qr_provider,
    reference: data.qr_reference,
    verified: data.qr_verified === true,
    due_date: data.credit_due_date,
    notes: data.payment_notes,
  }];
}

async function existingSale(db, idempotencyKey) {
  if (!idempotencyKey) return null;
  const bill = await db.get('SELECT * FROM bills WHERE idempotency_key=?', [idempotencyKey]);
  if (!bill) return null;
  const order = await db.get('SELECT order_number FROM orders WHERE id=?', [bill.order_id]);
  const allocations = await db.all(
    `SELECT a.method, a.amount, a.provider, a.reference_number AS reference, a.due_date,
            p.cash_tendered, p.change_amount AS change
     FROM bill_payment_allocations a
     LEFT JOIN bill_payments p ON p.id = a.payment_id
     WHERE a.bill_id=? ORDER BY a.id`,
    [bill.id]
  );
  return { idempotent: true, orderId: bill.order_id, billId: bill.id, order_number: order?.order_number, bill_number: bill.bill_number, payment: { status: bill.payment_status, outstanding: Number(bill.outstanding_amount || 0), allocations } };
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'] });
    if (auth.error) return auth.error;
    const data = await request.json();
    if (!data.items?.length) return NextResponse.json({ error: 'Please add at least one item to the bill.', code: 'empty_cart' }, { status: 400 });
    const idempotencyKey = String(data.idempotency_key || '').trim().slice(0, 100);
    if (!idempotencyKey) return NextResponse.json({ error: 'Missing checkout idempotency key. Please retry.' }, { status: 400 });

    const db = Database.getInstance();
    await ensureOrderColumns(db);
    await autoLinkBeverageStock(db);
    await ensureAccountingSchema(db);
    await ensureSplitPaymentSchema(db);

    if ((Number(data.discount || 0) > 0 || Number(data.discount_percent || 0) > 0) && auth.user.role !== 'admin') {
      await ensurePermissionCache(db);
      if (!isPermissionAllowedSync(auth.user.role, 'bills.discount')) {
        return NextResponse.json({ error: 'You do not have access to apply a discount.' }, { status: 403 });
      }
    }

    const prior = await existingSale(db, idempotencyKey);
    if (prior) return NextResponse.json({ message: 'Sale was already completed.', ...prior });

    const items = await resolveSaleItems(db, data.items);
    const { vatPercent, servicePercent } = await loadSettingsRates(db);
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const totals = calculateBillTotals(subtotal, {
      discountAmount: Number(data.discount || 0) > 0 ? Number(data.discount) : undefined,
      discountPercent: Number(data.discount || 0) > 0 ? undefined : Number(data.discount_percent || 0),
      vatPercent,
      servicePercent,
    });

    const result = await db.transaction(async (tx) => {
      const businessDayId = await currentBusinessDayId(tx, { required: true });
      let customerInfo;
      try {
        customerInfo = await resolveCustomerForSale(tx, {
          mode: data.customer_mode || (data.customer_phone ? 'customer' : 'walkin'),
          phone: data.customer_phone,
          name: data.customer_name,
          address: data.customer_address,
          amount: totals.total,
          recordSale: true,
        });
      } catch (error) {
        throw Object.assign(new Error(error.message || 'Please check customer details.'), { status: 400, code: 'customer_invalid' });
      }

      const allocations = validateAllocations(incomingAllocations(data, totals.total), totals.total, {
        customer: customerInfo.customer,
        allowCredit: true,
        actorRole: auth.user?.role,
      });
      const orderNumber = await nextDocumentNumber(tx, { type: 'order', prefix: 'ORD' });
      const billNumber = await nextDocumentNumber(tx, { type: 'bill', prefix: 'BILL' });
      const orderResult = await tx.run(
        `INSERT INTO orders (order_number, table_id, table_number, order_type, status, payment_status,
           waiter_id, customer_id, customer_name, customer_phone, notes, stock_consumed, business_day_id, created_at, updated_at)
         VALUES (?, NULL, NULL, ?, 'completed', 'unpaid', NULL, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [orderNumber, data.order_type || 'takeaway', customerInfo.customer_id, customerInfo.customer_name,
          customerInfo.customer_phone, data.notes || 'POS walk-in sale', businessDayId]
      );
      const orderId = orderResult.lastInsertRowid;
      for (const item of items) {
        await tx.run(
          `INSERT INTO order_items (order_id, item_id, menu_item_id, item_name, quantity, price, subtotal, special_instructions, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'served', CURRENT_TIMESTAMP)`,
          [orderId, item.menu_item_id, item.menu_item_id, item.name, item.quantity, item.price, item.subtotal, item.is_custom ? 'Custom item' : null]
        );
      }
      const billResult = await tx.run(
        `INSERT INTO bills (bill_number, order_id, customer_id, subtotal, tax, vat_amount, service_charge,
           discount_amount, grand_total, status, payment_status, outstanding_amount, idempotency_key, business_day_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'unpaid', ?, ?, ?, CURRENT_TIMESTAMP)`,
        [billNumber, orderId, customerInfo.customer_id, totals.subtotal, totals.tax, totals.tax,
          totals.serviceCharge, totals.discount, totals.total, totals.total, idempotencyKey, businessDayId]
      );
      const billId = billResult.lastInsertRowid;
      const payment = await recordInitialSplitSettlement(tx, {
        billId, billNumber, total: totals.total, tax: totals.tax, allocations,
        customer: customerInfo.customer, actorId: auth.user?.id || null, requestKey: idempotencyKey,
        businessDayId,
      });
      const stock = await deductStockForItems(tx, items, { orderId, performedBy: auth.user?.id || null });
      await tx.run('UPDATE orders SET payment_status=?, payment_method=?, stock_consumed=1 WHERE id=?', [payment.status, allocations.length > 1 ? 'split' : allocations[0].method, orderId]);
      return { orderId, billId, order_number: orderNumber, bill_number: billNumber, customer: customerInfo, stock, totals, payment };
    });

    return NextResponse.json({ message: 'Sale complete! Bill saved successfully.', ...result, warnings: result.stock?.warnings || [] }, { status: 201 });
  } catch (error) {
    console.error('Create billing order error:', error);
    const status = error?.status || (/unique|duplicate/i.test(String(error?.message || '')) ? 409 : 500);
    return NextResponse.json({
      error: status >= 500 ? 'We could not complete this sale. Please try again.' : error.message,
      code: error?.code || (status === 409 ? 'duplicate' : 'sale_failed'),
      details: process.env.NODE_ENV === 'development' && status >= 500 ? error.message : undefined,
    }, { status });
  }
}
