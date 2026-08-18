'use client';

/**
 * Bill Payment container — the real checkout modal for Admin POS.
 * Customer selection, payment methods, split, discount confirmation.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X, Wallet, QrCode, Building2, Sparkles, Receipt, Truck } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import CustomerModePicker, {
  emptyCustomerSelection,
  validateCustomerSelection,
} from '@/components/billing/customer-mode-picker';
import SplitPaymentFields, { emptySplitPayment } from '@/components/billing/split-payment-fields';
import DateInput from '@/components/ui/date-input.jsx';
import QrEnlargeModal from '@/components/billing/qr-enlarge-modal';

function QrCodeButtons({ settings, onOpen }) {
  if (!settings?.esewa_qr_image && !settings?.bank_qr_image) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-center text-xs text-amber-800">
        No QR codes configured in Settings
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {settings.esewa_qr_image && (
        <button
          type="button"
          onClick={() => onOpen({ open: true, title: 'eSewa / Fonepay QR', image: settings.esewa_qr_image })}
          className="rounded-lg border border-emerald-200 bg-white p-2 text-center hover:border-emerald-400"
        >
          <p className="mb-1 text-xs font-bold text-slate-900">eSewa / Fonepay</p>
          <img src={settings.esewa_qr_image} alt="eSewa QR" className="mx-auto h-28 w-28 object-contain" />
          <p className="mt-1 text-[11px] font-semibold text-emerald-600">Tap to enlarge</p>
        </button>
      )}
      {settings.bank_qr_image && (
        <button
          type="button"
          onClick={() => onOpen({ open: true, title: 'Bank QR', image: settings.bank_qr_image })}
          className="rounded-lg border border-emerald-200 bg-white p-2 text-center hover:border-emerald-400"
        >
          <p className="mb-1 text-xs font-bold text-slate-900">Bank QR</p>
          <img src={settings.bank_qr_image} alt="Bank QR" className="mx-auto h-28 w-28 object-contain" />
          <p className="mt-1 text-[11px] font-semibold text-emerald-600">Tap to enlarge</p>
        </button>
      )}
    </div>
  );
}

export default function BillPaymentPanel({
  open,
  onClose,
  onConfirm,
  busy = false,
  totals,
  alreadyPaid = 0,
  isReopened = false,
  settings = {},
  discount = 0,
  onDiscountChange,
  discountMode = 'percent',
  onDiscountModeChange,
  customerSelection,
  onCustomerChange,
  paymentMethod,
  onPaymentMethodChange,
  amountPaid,
  onAmountPaidChange,
  splitPayment,
  onSplitPaymentChange,
  canSetDelivery = false,
  deliveryEnabled = false,
  onDeliveryEnabledChange,
  deliveryFee = '',
  onDeliveryFeeChange,
}) {
  const [qrModal, setQrModal] = useState({ open: false, title: '', image: '' });
  const customerSectionRef = useRef(null);

  const amountDue = useMemo(
    () => Math.round((Number(totals?.total || 0) - Number(alreadyPaid || 0)) * 100) / 100,
    [totals, alreadyPaid]
  );

  const collectAmount = isReopened ? Math.max(0, amountDue) : Number(totals?.total || 0);

  const change = useMemo(() => {
    const paid = parseFloat(amountPaid) || 0;
    return Math.round((paid - collectAmount) * 100) / 100;
  }, [amountPaid, collectAmount]);

  // Prefill cash tendered with the amount due whenever the panel opens on cash.
  useEffect(() => {
    if (!open || paymentMethod !== 'cash') return;
    if (amountPaid === '' || amountPaid == null) {
      onAmountPaidChange?.(String(collectAmount || ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when opening / method / due changes
  }, [open, paymentMethod, collectAmount]);

  if (!open) return null;

  const selectMethod = (id) => {
    onPaymentMethodChange?.(id);
    if (id === 'cash') {
      onAmountPaidChange?.(String(collectAmount || ''));
    }
    if (id === 'credit') {
      const next = {
        ...(customerSelection || emptyCustomerSelection),
        mode: 'customer',
        name: customerSelection?.mode === 'customer' ? (customerSelection.name || '') : '',
        phone: customerSelection?.mode === 'customer' ? (customerSelection.phone || '') : '',
        address: customerSelection?.mode === 'customer' ? (customerSelection.address || '') : '',
        customer: customerSelection?.mode === 'customer' ? (customerSelection.customer || null) : null,
        isNew: customerSelection?.mode === 'customer' ? !!customerSelection.isNew : false,
      };
      onCustomerChange?.(next);
      requestAnimationFrame(() => {
        customerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    if (id === 'online' || id === 'split') {
      onSplitPaymentChange?.({
        ...(splitPayment || emptySplitPayment),
        qrVerified: true,
        qrProvider: splitPayment?.qrProvider || 'Fonepay',
      });
    }
  };

  const handleConfirm = () => {
    const check = validateCustomerSelection(customerSelection);
    if (!check.ok) {
      onConfirm({ error: check.message });
      return;
    }
    if (paymentMethod === 'cash') {
      const tendered = parseFloat(amountPaid);
      if (!Number.isFinite(tendered) || tendered < collectAmount - 0.009) {
        onConfirm({ error: `Cash received must be at least ${formatCurrency(collectAmount)}.` });
        return;
      }
    }
    onConfirm({ ok: true });
  };

  const showPayMethods = amountDue > 0.009 || !isReopened;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <button type="button" aria-label="Close" className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-white px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-emerald-600 p-2 text-white">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Bill Payment</h2>
              <p className="text-xs text-slate-500">Choose customer and collect payment</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close payment"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <div ref={customerSectionRef}>
            <CustomerModePicker
              value={customerSelection || emptyCustomerSelection}
              onChange={onCustomerChange}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="block text-xs font-bold text-slate-900">Discount</label>
              <div className="flex rounded-lg bg-slate-100 p-0.5">
                {[
                  { id: 'percent', label: '%' },
                  { id: 'amount', label: 'Rs' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onDiscountModeChange?.(opt.id);
                      onDiscountChange?.(0);
                    }}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-bold ${
                      discountMode === opt.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                {discountMode === 'amount' ? 'Rs' : '%'}
              </span>
              <input
                type="number"
                min="0"
                max={discountMode === 'percent' ? 100 : undefined}
                step={discountMode === 'amount' ? '0.01' : '1'}
                value={discount || ''}
                onChange={(e) => onDiscountChange?.(parseFloat(e.target.value) || 0)}
                className="w-full rounded-lg border-2 border-emerald-200 py-2 pl-9 pr-3 text-sm font-semibold text-slate-900"
                placeholder="0"
              />
            </div>
          </div>

          {canSetDelivery && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={deliveryEnabled}
                  onChange={(e) => onDeliveryEnabledChange?.(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-sky-300 text-sky-600"
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><Truck className="h-4 w-4 text-sky-700" /> Deliver this takeaway</span>
                  <span className="mt-0.5 block text-xs text-slate-600">Marks this table-less order as Delivery and adds the charge to this bill.</span>
                </span>
              </label>
              {deliveryEnabled && (
                <label className="mt-3 block text-xs font-bold text-slate-900">
                  Delivery charge (Rs)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={deliveryFee}
                    onChange={(e) => onDeliveryFeeChange?.(e.target.value)}
                    className="mt-1 w-full rounded-lg border-2 border-sky-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                    placeholder="0.00"
                  />
                </label>
              )}
            </div>
          )}

          <div className="space-y-1 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-700">Subtotal</span>
              <span className="font-bold text-slate-900">{formatCurrency(totals?.subtotal || 0)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Discount ({discount}%)</span>
                <span className="font-bold">- {formatCurrency(totals?.discount || 0)}</span>
              </div>
            )}
            {Number(settings.service_charge_percentage) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-700">Service ({Number(settings.service_charge_percentage)}%)</span>
                <span className="font-bold text-slate-900">{formatCurrency(totals?.serviceCharge || 0)}</span>
              </div>
            )}
            {Number(settings.vat_percentage) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-700">Tax ({Number(settings.vat_percentage)}%)</span>
                <span className="font-bold text-slate-900">{formatCurrency(totals?.tax || 0)}</span>
              </div>
            )}
            {Number(totals?.deliveryFee || 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-700">Delivery</span>
                <span className="font-bold text-slate-900">{formatCurrency(totals.deliveryFee)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-emerald-200 pt-1.5 text-base font-bold">
              <span className="text-slate-900">Total</span>
              <span className="text-emerald-700">{formatCurrency(totals?.total || 0)}</span>
            </div>
            {isReopened && (
              <>
                <div className="flex justify-between text-sm text-emerald-700">
                  <span>Already paid</span>
                  <span className="font-bold">- {formatCurrency(alreadyPaid)}</span>
                </div>
                <div className={`flex justify-between text-base font-bold ${amountDue < -0.009 ? 'text-amber-700' : 'text-slate-900'}`}>
                  <span>{amountDue < -0.009 ? 'Refund due' : 'Due now'}</span>
                  <span>{formatCurrency(Math.abs(amountDue))}</span>
                </div>
              </>
            )}
          </div>

          {showPayMethods && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-900">
                  Payment{isReopened ? ' (extra due)' : ''}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: 'cash', label: 'Cash', Icon: Wallet },
                    { id: 'online', label: 'QR', Icon: QrCode },
                    { id: 'credit', label: 'Credit', Icon: Building2 },
                    { id: 'split', label: 'Split', Icon: Sparkles },
                  ].map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => selectMethod(id)}
                      className={`rounded-xl border-2 p-2.5 transition-colors ${
                        paymentMethod === id
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-emerald-200 bg-white text-slate-700 hover:border-emerald-400'
                      }`}
                    >
                      <Icon className="mx-auto mb-0.5 h-5 w-5" />
                      <span className="text-xs font-bold">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {paymentMethod === 'cash' && (
                <div className="space-y-2 rounded-xl border border-emerald-200 bg-white p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Amount due</span>
                    <span className="font-bold tabular-nums text-slate-900">{formatCurrency(collectAmount)}</span>
                  </div>
                  <label className="block text-xs font-bold text-slate-900">
                    Amount received
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={amountPaid ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d.]/g, '');
                        const parts = raw.split('.');
                        const next = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : raw;
                        onAmountPaidChange?.(next);
                      }}
                      onFocus={(e) => e.target.select()}
                      className="mt-1 w-full rounded-lg border-2 border-emerald-200 px-3 py-2.5 text-lg font-bold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      placeholder={String(collectAmount || '0.00')}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onAmountPaidChange?.(String(collectAmount))}
                      className="rounded-lg border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
                    >
                      Exact
                    </button>
                    {[50, 100, 500, 1000].map((n) => {
                      const rounded = Math.ceil(collectAmount / n) * n;
                      if (rounded <= collectAmount) return null;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => onAmountPaidChange?.(String(rounded))}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {formatCurrency(rounded)}
                        </button>
                      );
                    })}
                  </div>
                  {amountPaid !== '' && amountPaid != null && (
                    change >= -0.009 ? (
                      <p className="text-sm font-semibold text-green-800">
                        Change: {formatCurrency(Math.max(0, change))}
                      </p>
                    ) : (
                      <p className="text-sm font-semibold text-amber-700">
                        Still short by {formatCurrency(Math.abs(change))}
                      </p>
                    )
                  )}
                </div>
              )}

              {paymentMethod === 'online' && (
                <div className="space-y-2">
                  <select
                    value={splitPayment?.qrProvider || 'Fonepay'}
                    onChange={(e) => onSplitPaymentChange?.({
                      ...splitPayment,
                      qrProvider: e.target.value,
                      qrVerified: true,
                    })}
                    className="w-full rounded-lg border border-emerald-200 px-2 py-2 text-sm"
                  >
                    <option>Fonepay</option>
                    <option>eSewa</option>
                    <option>Khalti</option>
                    <option>Bank QR</option>
                    <option>Other</option>
                  </select>
                  <p className="text-xs text-slate-500">Show the QR, confirm the guest paid, then complete the bill.</p>
                  <QrCodeButtons settings={settings} onOpen={setQrModal} />
                </div>
              )}

              {paymentMethod === 'credit' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">
                    {customerSelection?.customer
                      ? `Credit customer: ${customerSelection.customer.name}`
                      : 'Customer section above — look up an existing customer with credit before continuing.'}
                  </p>
                  <label className="mt-2 block text-xs">
                    Due date (optional)
                    <DateInput
                      value={splitPayment?.creditDueDate || ''}
                      onChange={(v) => onSplitPaymentChange?.({ ...splitPayment, creditDueDate: v })}
                      className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-2 py-2"
                    />
                  </label>
                </div>
              )}

              {paymentMethod === 'split' && (
                <SplitPaymentFields
                  total={collectAmount}
                  value={splitPayment || emptySplitPayment}
                  onChange={onSplitPaymentChange}
                  customer={customerSelection?.customer}
                  settings={settings}
                />
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-emerald-100 bg-white p-4 sm:p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl border-2 border-slate-200 py-3 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="flex-[1.6] flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isReopened
              ? (amountDue > 0.009
                ? `Collect ${formatCurrency(amountDue)}`
                : amountDue < -0.009
                  ? `Refund ${formatCurrency(Math.abs(amountDue))}`
                  : 'Close bill')
              : `Pay ${formatCurrency(totals?.total || 0)}`}
          </button>
        </div>
      </div>

      <QrEnlargeModal
        open={qrModal.open}
        title={qrModal.title}
        image={qrModal.image}
        onClose={() => setQrModal({ open: false, title: '', image: '' })}
      />
    </div>
  );
}
