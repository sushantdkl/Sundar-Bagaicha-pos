# Events / Banquet module — architecture

Phase 1 deliverable. Part A documents how the existing restaurant POS works
today (established by reading the code, not assumed), because the Events module
must **reuse** these engines rather than reimplement them. Part B is the Events
foundation added by migration 045.

---

## Part A — how the existing system works

### Orders and order items
`lib/db/repositories/orders.js` (`OrderRepository`) is the single entry point
used by every channel — waiter, cashier POS, admin, and public QR ordering.

- `create()` runs inside `db.transaction()`: allocates `order_number` via
  `nextDocumentNumber(db, { type: 'order', prefix: 'ORD' })`, inserts the order,
  inserts each line through `_insertOrderItem()`, **deducts stock**, then
  occupies the table.
- `_insertOrderItem()` never trusts a client-supplied price. If a
  `variant_name` is given it re-resolves the price from `menu_item_variants`
  server-side (absolute `price`, else `base_price + price_modifier`).
- Every order belongs to a business day; `assertCurrentBusinessDay()` rejects
  edits belonging to a different day.
- Lines are **soft-voided** (`status = 'voided'`), never deleted. Totals and
  counts everywhere filter with `COALESCE(status,'') NOT IN ('voided','cancelled')`.

**Stock is deducted at order creation and when items are appended** —
`deductStockForItems()` in `create()` and `addItems()`. Cancelling an order or
voiding a line calls `restoreStockForItems()`, guarded so an already-cancelled
order cannot restock twice.

### Inventory deduction and the stock ledger
`lib/stock.js` resolves each sold line, in order:
1. a variant→inventory link, else
2. a recipe for the menu item — `explodeRecipe()` walks the BOM (including
   sub-recipes) and `deductRawMaterials()` applies the totals, else
3. a direct inventory item matched by name.

All movement flows through `applyStockChange()` in `lib/inventory-ledger.js`,
which writes the `stock_movements` ledger row and handles purchase/consumption
unit conversion. Nothing else writes stock quantities directly.

### KOT
`lib/kot-service.js` — `issueKot()` accepts an `idempotencyKey` (unique index on
`kots.idempotency_key`), so a double submit produces one ticket. `cancelKot()`
and `cancelSentItem()` record explicit cancellation metadata. `logPosEvent()`
appends to `pos_audit_log`.

### Recipes
`lib/recipes.js` — `recipes` + `recipe_items`, one recipe per menu item plus
reusable sub-recipes. A `recipe_items` row references **either** a raw material
**or** a component recipe, enforced by a CHECK. `getRecipeCost()` derives food
cost from current inventory cost.

### Billing, payments and split payments
- `lib/billing-totals.js` — `calculateBillTotals()` is the one place discount,
  VAT, service charge and delivery fee are combined. Percentages come from
  `system_settings` via `parseSettingsRates()`.
- `bills` + `bill_payments` + `bill_payment_allocations` (split tenders).
- `lib/split-payments.js` handles initial and supplemental settlement,
  credit collection and write-offs.
- Bills carry `idempotency_key`; the POS pay route rejects a request without one.

### Accounting
`lib/accounting.js` is the backbone. **No stored balances** — every figure is
derived from `journal_lines`.

- `postJournal()` enforces balanced debits/credits, then writes
  `journal_entries` + `journal_lines`. Passing `(source_type, source_id)` makes
  it **idempotent**: an existing journal for that event is replaced, not
  duplicated. `external_ref` is the idempotency key for source-less operations.
- `postSaleJournal()` — Dr each payment account, Cr `4010 Sales Revenue`,
  Cr `2020 VAT/Tax Payable` for the tax portion.
- `postExpenseJournal()` — Dr expense account, Cr the funding account.
- `paymentAccountCode()` **throws** on an unmapped payment method; it never
  silently posts to cash.
- Chart of accounts is seeded idempotently from `SEED_ACCOUNTS`.

### Business day
`lib/business-days.js` — explicit operating periods that may cross midnight,
with store sessions inside them. `currentBusinessDayId({ required: true })`
gates new activity; a day left open from a previous Nepal date is **stale** and
blocks new activity until an operator continues it or starts the next day.
Dates use Nepal time (`Asia/Kathmandu`, UTC+5:45) throughout — see
`lib/report-dates.js`.

### Expenses and purchases
- `expenses` — manual rows plus automated ones carrying `source_type` /
  `source_id` (purchase, wastage), which are read-only in the expenses UI.
  `lib/expense-links.js` keeps a linked expense in sync with its source.
- `purchases` + `purchase_items` — goods received; cash/bank/**credit** (credit
  posts to Accounts Payable tagged to the supplier sub-ledger).

### Customers and reservations
`lib/customers.js` (`resolveCustomerForSale`, phone-normalised lookup) and
`lib/leads.js` (`createReservation`, `createInquiry`). Table conflict detection
lives in `lib/reservation-conflicts.js` and uses an occupancy window of
hold + dining + cleaning minutes — the same shape the Events module needs for
space overlap, with setup/cleanup buffers instead.

### Reports
`lib/reports.js` builds tabbed reports from `bills` / `orders` /
`bill_payments`. `lib/order-types.js` centralises channel classification
(`normalizedOrderType`, `normalizedOrderTypeSql`) — this is the seam where an
EVENT channel is added later without disturbing dine-in/takeaway/delivery.

### Permissions
Two layers:
1. Static role map in `lib/auth/auth.js` (`admin`, `cashier`, `waiter`, `kitchen`).
2. A DB-backed matrix for a curated set of sensitive keys —
   `lib/permissions.js`, `role_permissions`, changes recorded in
   `permission_audit`. `requireAuth(request, { roles, permission, csrf })` in
   `lib/api-guard.js` is the single gate for API routes.

---

## Part B — Events foundation (migration 045)

### Tables

| Table | Purpose |
|---|---|
| `event_spaces` | Bookable venues; capacity, venue charge, setup/cleanup buffers |
| `event_packages` | Per-guest catering packages; pricing policy |
| `event_package_price_tiers` | Guest-count price bands (configuration, not code) |
| `event_package_components` | Food that makes up a package; references menu items / recipes |
| `events` | The booking: lifecycle, guests, money totals, metadata |
| `event_menu_lines` | Quotation/BEO body with **price snapshots** |
| `event_payment_schedule` | Agreed deposit/installment plan |
| `event_deposits` | Money actually received or refunded |
| `event_tasks` | Operational checklist |
| `event_audit` | Append-only trail of sensitive actions |

Plus nullable attribution columns: `orders.event_id`, `expenses.event_id`,
`purchases.event_id`.

### Lifecycle

```
INQUIRY → DRAFT → QUOTED → CONFIRMED → PLANNING → FINALIZED → IN_PROGRESS → COMPLETED
```

Any non-terminal status may move to `CANCELLED`. Limited backward steps are
allowed (`QUOTED → DRAFT`, `CONFIRMED → QUOTED`, `FINALIZED → PLANNING`)
because real bookings get renegotiated. Nothing may leave `COMPLETED` or
`CANCELLED`. Enforced by `assertTransition()` in `lib/events/constants.js` and
by a CHECK constraint in the database.

`payment_status` (`UNPAID / DEPOSIT_DUE / PARTIALLY_PAID / PAID / REFUNDED`) is
tracked **independently**: a CONFIRMED event can be UNPAID, and a COMPLETED
event can still carry a balance.

### Design rules this foundation encodes

- **Booking never moves stock.** No table here participates in stock movement.
  Inventory is only touched later, through the existing order/recipe path when
  an event is started (Phase 11).
- **Event revenue stays distinguishable.** `orders.event_id` is the seam; a NULL
  means ordinary restaurant activity, which is what every existing row is.
- **Prices are snapshots.** `event_menu_lines` stores `item_name`, `unit_price`
  and `list_price` at quotation time. `menu_items.base_price` is never modified
  for an event, and a later menu change cannot re-price a signed quotation.
- **No hard-coded business values.** Packages, tiers, spaces and event types are
  rows and configuration. Only the lifecycle vocabulary is code, because it
  governs money and stock behaviour.
- **Financial records resist deletion.** `event_deposits.event_id` is
  `ON DELETE RESTRICT`; every `event_id` added to an existing table is
  `ON DELETE SET NULL`, so removing an event can never delete an order, expense
  or purchase.
- **Advances are a liability, not revenue.** Deposits will post
  Dr Cash/Bank / Cr *Event Customer Advances* through the existing
  `postJournal()` engine (Phase 9). No second GL is created.

### Not in this phase

No POS orders, KOTs, journals, stock movements, API routes or UI. Phase 1 is
structure, vocabulary and audit plumbing only.
