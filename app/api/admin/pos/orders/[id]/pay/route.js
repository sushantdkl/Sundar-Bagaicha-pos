import { NextResponse } from 'next/server';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';
import { calculateBillTotals, parseSettingsRates } from '@/lib/billing-totals.js';
import { resolveCustomerForSale } from '@/lib/customers.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import {
  ensureSplitPaymentSchema,
  recordInitialSplitSettlement,
  recordSupplementalSettlement,
  validateAllocations,
} from '@/lib/split-payments.js';
import { completeReservationForOrder } from '@/lib/leads.js';
import { getOrderWorkspace, logPosEvent, ensureKotProSchema } from '@/lib/kot-service.js';
import { refundBillAdmin, recordAudit } from '@/lib/bills-admin.js';
import { diffReopenItems, parseJsonField } from '@/lib/reopen-diff.js';
import { nextDocumentNumber } from '@/lib/document-numbers.js';
import { currentBusinessDayId } from '@/lib/business-days.js';
import { ensurePermissionCache, isPermissionAllowedSync } from '@/lib/permissions.js';
import { ensureOrderColumns } from '@/lib/online-orders.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const EPS = 0.01;

/** After a bill is paid, KOTs for that order leave the Active board. */
async function completeOrderKots(tx, orderId) {
  await tx.run(
    `UPDATE kots SET status = 'completed',
       completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
     WHERE order_id = ? AND COALESCE(voided, 0) = 0
       AND COALESCE(status, '') NOT IN ('completed', 'cancelled')`,
    [orderId]
  ).catch(() => {});
}

function primaryPaymentMethod(allocations = []) {
  if (!allocations.length) return 'cash';
  const sorted = [...allocations].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
  const top = sorted[0];
  if (top?.method === 'qr' && top.provider) return String(top.provider).toLowerCase();
  return top?.method || 'cash';
}

/** Normalise incoming payment into the allocation shape the split engine expects. */
function incomingAllocations(data, total) {
  if (Array.isArray(data.allocations) && data.allocations.length) return data.allocations;
  const method = data.payment_method === 'online' ? 'qr' : (data.payment_method || 'cash');
  return [{
    method,
    amount: total,
    cash_tendered: method === 'cash' ? Number(data.cash_tendered ?? data.amount_paid ?? total) : undefined,
    provider: data.qr_provider,
    reference: data.qr_reference,
    verified: data.qr_verified === true,
    due_date: data.credit_due_date,
    notes: data.payment_notes,
  }];
}

async function existingPaidSale(db, idempotencyKey) {
  if (!idempotencyKey) return null;
  const bill = await db.get('SELECT * FROM bills WHERE idempotency_key = ?', [idempotencyKey]);
  if (!bill) return null;
  return { idempotent: true, bill_number: bill.bill_number, bill_id: bill.id, order_id: bill.order_id,
    payment_status: bill.payment_status, outstanding: Number(bill.outstanding_amount || 0) };
}

async function sumBillPayments(db, billId) {
  const row = await db.get(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM bill_payments WHERE bill_id = ?`,
    [billId]
  ).catch(() => null);
  return round2(Number(row?.s || 0));
}

/**
 * Finalise the invoice + settle it (Cash / QR / Credit / split) for a table or
 * takeaway order. Reopened bills only settle the difference vs payments already taken,
 * via a supplemental journal (never replacing the original sale journal).
 */
export async function POST(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'] });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });

    const data = await request.json();
    const idempotencyKey = String(data.idempotency_key || '').trim().slice(0, 100);
    if (!idempotencyKey) return NextResponse.json({ error: 'Missing checkout key. Please retry.' }, { status: 400 });

    const db = Database.getInstance();
    await ensureOrderColumns(db);
    await ensureKotProSchema(db);
    await ensureAccountingSchema(db);
    await ensureSplitPaymentSchema(db);

    if (Number(data.discount || 0) > 0 && auth.user.role !== 'admin') {
      await ensurePermissionCache(db);
      if (!isPermissionAllowedSync(auth.user.role, 'bills.discount')) {
        return NextResponse.json({ error: 'You do not have access to apply a discount.' }, { status: 403 });
      }
    }

    const prior = await existingPaidSale(db, idempotencyKey);
    if (prior) return NextResponse.json({ success: true, message: 'This payment was already recorded.', ...prior });

    const rows = await db.all('SELECT setting_key, setting_value FROM system_settings');
    const settings = {};
    for (const r of rows || []) settings[r.setting_key] = r.setting_value;
    const { vatPercent, servicePercent } = parseSettingsRates(settings);

    const reopenedBill = await db.get(
      `SELECT * FROM bills WHERE order_id = ? AND LOWER(status) = 'reopened' ORDER BY id DESC LIMIT 1`,
      [orderId]
    );

    // Capture the pre-settle picture for reopened bills: what the cart looked like
    // at reopen (snapshot from the reopen audit) and what had already been paid,
    // so the receipt + history can show exactly what changed and how it settled.
    let reopenSnapshotItems = [];
    let priorPayments = [];
    if (reopenedBill) {
      const revAudit = await db.get(
        `SELECT previous_value, new_value FROM bill_audit
         WHERE bill_id = ? AND event = 'bill_reopened_to_pos' ORDER BY id DESC LIMIT 1`,
        [reopenedBill.id]
      ).catch(() => null);
      const snap = parseJsonField(revAudit?.previous_value) || parseJsonField(revAudit?.new_value) || {};
      reopenSnapshotItems = Array.isArray(snap.items) ? snap.items : [];
      priorPayments = await db.all(
        `SELECT method, amount, provider, reference_number AS reference FROM bill_payment_allocations
         WHERE bill_id = ? ORDER BY id`,
        [reopenedBill.id]
      ).catch(() => []);
      if (!priorPayments.length) {
        priorPayments = await db.all(
          `SELECT payment_method AS method, amount, provider, reference_number AS reference FROM bill_payments
           WHERE bill_id = ? ORDER BY id`,
          [reopenedBill.id]
        ).catch(() => []);
      }
    }

    const result = await db.transaction(async (tx) => {
      const lock = tx.driver === 'postgres' ? ' FOR UPDATE' : '';
      const order = await tx.get(`SELECT * FROM orders WHERE id = ?${lock}`, [orderId]);
      if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });
      const businessDayId = await currentBusinessDayId(tx, { required: true, allowStale: true });
      if (Number(order.business_day_id || 0) !== Number(businessDayId)) {
        throw Object.assign(new Error('This order does not belong to the current business day.'), { status: 409 });
      }

      const paid = await tx.get("SELECT id, bill_number FROM bills WHERE order_id = ? AND status = 'paid'", [orderId]);
      if (paid && !reopenedBill) {
        throw Object.assign(new Error(`This order was already paid (Bill #${paid.bill_number}).`), { status: 409, code: 'already_paid' });
      }
      if (order.status === 'completed' || order.status === 'cancelled') {
        throw Object.assign(new Error('This order can no longer accept payment.'), { status: 409 });
      }

      // Reopened carts may have edited previously-sent lines — sync sent_quantity to quantity
      // so settle does not require reprinting a full KOT for already-served food.
      if (reopenedBill) {
        await tx.run(
          `UPDATE order_items SET sent_quantity = quantity
           WHERE order_id = ? AND COALESCE(status,'') NOT IN ('voided','cancelled')`,
          [orderId]
        );
      } else {
        const unsent = await tx.get(
          `SELECT COALESCE(SUM(quantity - COALESCE(sent_quantity,0)),0) AS u
           FROM order_items WHERE order_id = ? AND COALESCE(status,'') NOT IN ('voided','cancelled')`,
          [orderId]
        );
        if (Number(unsent?.u || 0) > 0) {
          throw Object.assign(new Error('Print or cancel the unsent items before taking payment.'), { status: 409, code: 'unsent_items' });
        }
      }

      const itemsSum = await tx.get(
        `SELECT COALESCE(SUM(subtotal),0) AS total FROM order_items
         WHERE order_id = ? AND COALESCE(status,'') NOT IN ('voided','cancelled')`,
        [orderId]
      );
      const subtotal = Number(itemsSum?.total || 0);
      if (subtotal <= 0) throw Object.assign(new Error('This order has no billable items.'), { status: 409, code: 'empty_order' });

      const isDelivery = data.delivery == null
        ? String(order.order_type || '').toLowerCase() === 'delivery'
        : Boolean(data.delivery);
      if (isDelivery && order.table_id) {
        throw Object.assign(new Error('Only a table-less takeaway can be changed to delivery at checkout.'), { status: 400 });
      }
      const finalOrderType = isDelivery ? 'delivery' : (order.table_id ? 'dine_in' : 'takeaway');
      const requestedDeliveryFee = data.delivery_fee == null
        ? Number(reopenedBill?.delivery_fee ?? order.delivery_fee ?? 0)
        : Number(data.delivery_fee);
      const deliveryFee = isDelivery
        ? Math.max(0, Number.isFinite(requestedDeliveryFee) ? requestedDeliveryFee : 0)
        : 0;
      const totals = calculateBillTotals(subtotal, {
        discountAmount: Number(data.discount || 0) > 0 ? Number(data.discount) : undefined,
        vatPercent,
        servicePercent,
        deliveryFee,
      });

      // ---- Reopened bill: settle only the difference vs payments already taken ----
      if (reopenedBill) {
        const paidSum = await sumBillPayments(tx, reopenedBill.id);
        const alreadyPaid = paidSum > EPS ? paidSum : round2(reopenedBill.grand_total);
        const due = round2(totals.total - alreadyPaid);

        const customerInfo = await resolveCustomerForSale(tx, {
          mode: data.customer_mode || (data.customer_phone || order.customer_phone ? 'customer' : 'walkin'),
          phone: data.customer_phone || order.customer_phone,
          name: data.customer_name || order.customer_name,
          address: data.customer_address,
          amount: Math.max(due, 0),
          recordSale: due > EPS,
        });

        let payment = { status: 'paid', outstanding: 0, allocations: [] };
        let deferTotals = false;

        if (due > EPS) {
          const allocations = validateAllocations(incomingAllocations(data, due), due, {
            customer: customerInfo.customer,
            allowCredit: true,
            actorRole: auth.user?.role,
          });
          // Supplemental journal — must NOT replace the original sale journal.
          payment = await recordSupplementalSettlement(tx, {
            billId: reopenedBill.id,
            billNumber: reopenedBill.bill_number,
            total: due,
            tax: 0,
            allocations,
            customer: customerInfo.customer,
            actorId: auth.user.id,
            requestKey: idempotencyKey,
            businessDayId,
          });
        } else if (due < -EPS) {
          // Refund must run while grand_total still reflects the original paid amount.
          deferTotals = true;
          payment = { status: 'paid', outstanding: 0, allocations: [], refundDue: round2(-due) };
        }

        if (!deferTotals) {
          await tx.run(
            `UPDATE bills SET
               subtotal = ?, tax = ?, vat_amount = ?, service_charge = ?, delivery_fee = ?,
               discount_amount = ?, grand_total = ?, status = 'paid',
               payment_status = 'paid', outstanding_amount = 0,
               tax_percent = ?, service_charge_percent = ?,
               paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
               idempotency_key = COALESCE(idempotency_key, ?)
             WHERE id = ?`,
            [
              totals.subtotal, totals.tax, totals.tax, totals.serviceCharge, totals.deliveryFee,
              totals.discount, totals.total, vatPercent, servicePercent,
              idempotencyKey, reopenedBill.id,
            ]
          );
        }

        await tx.run(
        `UPDATE orders SET status = 'completed', order_type = ?, customer_id = COALESCE(?, customer_id),
             customer_name = COALESCE(?, customer_name), customer_phone = COALESCE(?, customer_phone),
             payment_method = COALESCE(?, payment_method), delivery_fee = ?,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [
            finalOrderType,
            customerInfo.customer_id, customerInfo.customer_name, customerInfo.customer_phone,
            primaryPaymentMethod(payment.allocations || []), totals.deliveryFee, orderId,
          ]
        );
        await completeOrderKots(tx, orderId);
        if (order.table_id) {
          const remaining = await tx.get(
            `SELECT id FROM orders
             WHERE table_id = ? AND id != ? AND status NOT IN ('completed','cancelled')
             ORDER BY id DESC LIMIT 1`,
            [order.table_id, orderId]
          );
          if (remaining) {
            await tx.run(
              `UPDATE tables SET status = 'occupied', current_order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [remaining.id, order.table_id]
            );
          } else {
            await tx.run(
              `UPDATE tables SET status = 'available', current_order_id = NULL, waiter_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [order.table_id]
            );
          }
        }
        await completeReservationForOrder(orderId, tx).catch(() => {});

        const items = await tx.all(
          `SELECT * FROM order_items WHERE order_id = ? AND COALESCE(status,'') NOT IN ('voided','cancelled') ORDER BY id`,
          [orderId]
        );
        return {
          order: { ...order, order_type: finalOrderType, delivery_fee: deliveryFee },
          billId: reopenedBill.id,
          billNumber: reopenedBill.bill_number,
          totals,
          payment,
          customerInfo,
          items,
          allocations: payment.allocations || [],
          reopened: true,
          alreadyPaid,
          due,
          refundDue: payment.refundDue || 0,
          deferTotals,
          vatPercent,
          servicePercent,
          idempotencyKey,
        };
      }

      // ---- Normal first-time checkout ----
      const customerInfo = await resolveCustomerForSale(tx, {
        mode: data.customer_mode || (data.customer_phone || order.customer_phone ? 'customer' : 'walkin'),
        phone: data.customer_phone || order.customer_phone,
        name: data.customer_name || order.customer_name,
        address: data.customer_address,
        amount: totals.total,
        recordSale: true,
      });

      const allocations = validateAllocations(incomingAllocations(data, totals.total), totals.total, {
        customer: customerInfo.customer,
        allowCredit: true,
        actorRole: auth.user?.role,
      });

      const billNumber = await nextDocumentNumber(tx, { type: 'bill', prefix: 'BILL' });
      const billResult = await tx.run(
        `INSERT INTO bills (bill_number, order_id, customer_id, subtotal, tax, vat_amount, service_charge, delivery_fee,
           discount_amount, discount_reason, grand_total, status, payment_status, outstanding_amount,
           cashier_id, tax_percent, service_charge_percent, idempotency_key, business_day_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'unpaid', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [billNumber, orderId, customerInfo.customer_id, totals.subtotal, totals.tax, totals.tax,
          totals.serviceCharge, totals.deliveryFee, totals.discount, data.discount_reason || null, totals.total,
          totals.total, auth.user.id, vatPercent, servicePercent, idempotencyKey, businessDayId]
      );
      const billId = billResult.lastInsertRowid;

      const payment = await recordInitialSplitSettlement(tx, {
        billId, billNumber, total: totals.total, tax: totals.tax, allocations,
        customer: customerInfo.customer, actorId: auth.user.id, requestKey: idempotencyKey,
        businessDayId,
      });

      await tx.run(
        `UPDATE orders SET status = 'completed', order_type = ?, customer_id = COALESCE(?, customer_id),
           customer_name = COALESCE(?, customer_name), customer_phone = COALESCE(?, customer_phone),
           payment_method = COALESCE(?, payment_method), delivery_fee = ?,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [
          finalOrderType,
          customerInfo.customer_id, customerInfo.customer_name, customerInfo.customer_phone,
          primaryPaymentMethod(payment.allocations || allocations), totals.deliveryFee, orderId,
        ]
      );
      await completeOrderKots(tx, orderId);
      if (order.table_id) {
        const remaining = await tx.get(
          `SELECT id FROM orders
           WHERE table_id = ? AND id != ? AND status NOT IN ('completed','cancelled')
           ORDER BY id DESC LIMIT 1`,
          [order.table_id, orderId]
        );
        if (remaining) {
          await tx.run(
            `UPDATE tables SET status = 'occupied', current_order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [remaining.id, order.table_id]
          );
        } else {
          await tx.run(
            `UPDATE tables SET status = 'available', current_order_id = NULL, waiter_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [order.table_id]
          );
        }
      }
      await completeReservationForOrder(orderId, tx).catch(() => {});

      const items = await tx.all(
        `SELECT * FROM order_items WHERE order_id = ? AND COALESCE(status,'') NOT IN ('voided','cancelled') ORDER BY id`,
        [orderId]
      );
      return { order: { ...order, order_type: finalOrderType, delivery_fee: deliveryFee }, billId, billNumber, totals, payment, customerInfo, items, allocations, reopened: false, alreadyPaid: 0, due: totals.total, refundDue: 0 };
    });

    // Reopen change summary: what items were added / removed / changed vs the
    // snapshot taken when the bill was reopened. Drives receipt + history display.
    const reopenChanges = result.reopened
      ? diffReopenItems(reopenSnapshotItems, result.items)
      : null;
    const newPayments = (result.allocations || []).map((a) => ({
      method: a.method, amount: Number(a.amount || 0), provider: a.provider || null, reference: a.reference || null,
    }));

    // Refund BEFORE lowering grand_total so remaining refundable amount is correct.
    if (result.refundDue > EPS) {
      await refundBillAdmin(db, {
        billId: result.billId,
        amount: result.refundDue,
        method: data.allocations?.[0]?.method || data.payment_method || 'cash',
        reason: 'Reopened bill — items removed / total reduced',
        actorId: auth.user.id,
      });
      await db.run(
        `UPDATE bills SET
           subtotal = ?, tax = ?, vat_amount = ?, service_charge = ?, delivery_fee = ?,
           discount_amount = ?, grand_total = ?, status = 'paid',
           payment_status = 'paid', outstanding_amount = 0,
           tax_percent = ?, service_charge_percent = ?,
           paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
           idempotency_key = COALESCE(idempotency_key, ?)
         WHERE id = ?`,
        [
          result.totals.subtotal, result.totals.tax, result.totals.tax, result.totals.serviceCharge, result.totals.deliveryFee,
          result.totals.discount, result.totals.total, result.vatPercent, result.servicePercent,
          result.idempotencyKey, result.billId,
        ]
      );
      await recordAudit(db, {
        bill_id: result.billId,
        event: 'reopen_refund_settled',
        actor_id: auth.user.id,
        reason: 'Items removed after reopen',
        new_value: {
          refundDue: result.refundDue, newTotal: result.totals.total, alreadyPaid: result.alreadyPaid,
          changes: reopenChanges, priorPayments, newPayments,
        },
      }).catch(() => null);
    } else if (result.reopened) {
      await recordAudit(db, {
        bill_id: result.billId,
        event: 'reopen_settled',
        actor_id: auth.user.id,
        new_value: {
          alreadyPaid: result.alreadyPaid, due: result.due, newTotal: result.totals.total,
          changes: reopenChanges, priorPayments, newPayments,
        },
      }).catch(() => null);
    }

    const change = (result.allocations || []).reduce((s, a) => s + Number(a.change || 0), 0);

    await logPosEvent(db, { action: 'invoice_generated', actor_id: auth.user.id, actor_name: auth.user.full_name, order_id: orderId, bill_id: result.billId, new_value: result.billNumber });
    await logPosEvent(db, { action: 'payment_recorded', actor_id: auth.user.id, actor_name: auth.user.full_name, order_id: orderId, bill_id: result.billId, detail: { status: result.payment.status, outstanding: result.payment.outstanding, methods: (result.allocations || []).map((a) => a.method), reopened: !!result.reopened, due: result.due } });
    await logPosEvent(db, { action: 'bill_completed', actor_id: auth.user.id, actor_name: auth.user.full_name, order_id: orderId, bill_id: result.billId });
    if (result.order.table_id) {
      await logPosEvent(db, { action: 'table_released', actor_id: auth.user.id, actor_name: auth.user.full_name, order_id: orderId, table_id: result.order.table_id });
    }

    const kots = (await getOrderWorkspace(db, orderId))?.kots || [];
    return NextResponse.json({
      success: true,
      message: result.reopened
        ? (result.due > EPS
          ? `Reopened bill settled — collected ${result.due.toFixed(2)} extra.`
          : result.refundDue > EPS
            ? `Reopened bill settled — refunded ${result.refundDue.toFixed(2)}.`
            : 'Reopened bill settled — no balance change.')
        : 'Payment recorded.',
      bill_id: result.billId,
      bill_number: result.billNumber,
      order_number: result.order.order_number,
      payment_status: result.payment.status,
      outstanding: result.payment.outstanding,
      change,
      due: result.due,
      already_paid: result.alreadyPaid,
      receipt: {
        bill_number: result.billNumber,
        order_number: result.order.order_number,
        table_number: result.order.table_number,
        order_type: result.order.order_type,
        kot_numbers: kots.filter((k) => k.kot_type !== 'cancellation').map((k) => k.kot_number),
        items: result.items,
        subtotal: result.totals.subtotal,
        discount: result.totals.discount,
        tax: result.totals.tax,
        tax_percent: vatPercent,
        service_charge: result.totals.serviceCharge,
        service_charge_percent: servicePercent,
        delivery_fee: result.totals.deliveryFee,
        grand_total: result.totals.total,
        already_paid: result.alreadyPaid,
        due: result.due,
        allocations: result.payment.allocations,
        outstanding: result.payment.outstanding,
        change,
        payment_status: result.payment.status,
        customer_name: result.customerInfo.customer_name || '',
        customer_phone: result.customerInfo.customer_phone || '',
        processed_by: auth.user.full_name,
        processed_at: new Date().toISOString(),
        restaurant_name: settings.restaurant_name || 'Sundar Bagaicha Events',
        restaurant_address: settings.restaurant_address || '',
        restaurant_phone: settings.restaurant_phone || '',
        vat_number: settings.vat_number || '',
        pan_number: settings.pan_number || '',
        receipt_footer: settings.receipt_footer || '',
        // Reopen extras: change log + how it was paid before / now.
        reopened: !!result.reopened,
        item_changes: reopenChanges,
        prior_payments: result.reopened ? priorPayments : [],
        new_payments: result.reopened ? newPayments : [],
        refund_due: result.refundDue || 0,
      },
    });
  } catch (error) {
    if (error?.status && error.status < 500) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return handleRouteError(error, 'We could not complete this payment. Please try again.');
  }
}
