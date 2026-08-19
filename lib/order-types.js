/**
 * Canonical channel: a table-linked order is dine-in; a table-less order is
 * takeaway.
 *
 * An order raised by an event is its own channel. The rule is strictly
 * additive: an order with no event_id classifies exactly as it always did, so
 * every historical row and every restaurant order is unaffected.
 */
export function normalizedOrderType(order = {}) {
  if (order && typeof order === 'object' && (order.event_id ?? order.eventId)) return 'event';
  if (typeof order === 'string') {
    const raw = order.toLowerCase().replace(/-/g, '_');
    if (raw === 'delivery') return 'delivery';
    if (raw === 'takeaway' || raw === 'counter' || raw === 'pickup') return 'takeaway';
    return raw || 'dine_in';
  }

  const raw = String(order.order_type ?? order.orderType ?? '').toLowerCase().replace(/-/g, '_');
  if (raw === 'delivery') return 'delivery';
  const tableId = order.table_id ?? order.tableId ?? null;
  const tableNumber = order.table_number ?? order.tableNumber ?? null;
  return tableId || String(tableNumber || '').trim() ? 'dine_in' : 'takeaway';
}

export function orderTypeLabel(order = {}) {
  const type = normalizedOrderType(order);
  if (type === 'event') return 'Event';
  if (type === 'dine_in') return 'Dine in';
  if (type === 'delivery') return 'Delivery';
  if (type === 'takeaway') return 'Takeaway';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * SQL equivalent used by reports so legacy `counter` rows group as Takeaway.
 *
 * The event branch is the only addition and comes first; every other row falls
 * through to the original rules unchanged, so existing report totals cannot
 * shift for any order that is not part of an event.
 */
export function normalizedOrderTypeSql(alias = 'o') {
  return `CASE
    WHEN ${alias}.event_id IS NOT NULL THEN 'event'
    WHEN LOWER(COALESCE(${alias}.order_type, '')) = 'delivery' THEN 'delivery'
    WHEN ${alias}.table_id IS NULL AND NULLIF(TRIM(COALESCE(${alias}.table_number, '')), '') IS NULL THEN 'takeaway'
    ELSE 'dine_in'
  END`;
}
