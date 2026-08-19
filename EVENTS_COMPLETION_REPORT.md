# Sundar Bagaicha — Restaurant + Events/Banquet Management System
## Final Completion Report

**Date:** 19 August 2026
**Target:** PostgreSQL 17.5 (`sundarbagaicha`), Next.js 16.0.7, Node 22.16
**Verification environment:** production build (`npm run build` + `NODE_ENV=production node server.js`), not the dev server

---

## 1. What was built

The existing Sundar Bagaicha Restaurant POS was extended into a combined
restaurant and events business. The events module is a separate operational
area with its own screens, permissions and documents, but it shares one
database and every existing business engine: the same order repository, the
same stock deduction path, the same KOT service, the same double-entry
accounting, the same bill arithmetic, the same customer records and the same
reporting spine.

**Delivered across 20 phases:**

| Area | What exists now |
|---|---|
| Architecture and schema | 10 events tables, 42 indexes, `event_id` on `orders`, `expenses` and `purchases`, migration 045 |
| Dashboard and calendar | Events dashboard with today/this-week counts, month calendar, conflict-aware date view |
| Spaces | Named venues with min/max capacity, setup and cleanup buffers, standard charge, occupancy conflict detection |
| Packages | Tiered per-guest pricing with three policies (whole party, progressive, manual), gap and overlap validation, cliff detection |
| Package menus | Components resolved through the existing recipe engine, so a package knows its own food cost |
| Quotation builder | Eight line types, price snapshots, override with a recorded reason, event-level discount, tax and service charge |
| Guest counts | Expected / guaranteed / actual, a configurable billable policy, allocation across packages, change reasons |
| Quotation and BEO | Customer and kitchen audiences, append-only revisions each keeping a full snapshot |
| Deposits | Advances posted to a new liability account, payment schedules, refunds, voids, idempotency |
| Inventory forecast | Read-only explosion of the whole quotation into raw materials with shortages and purchase cost |
| Start event | The single point stock moves — one fulfilment order through the existing POS path, one KOT, atomic claim |
| Live operations | Live board, additional orders during the event, each its own event-linked order |
| Event expenses | Booked against the event through the existing expense engine |
| Final billing | Contracted value plus additional sales, advance applied, split payment, one settlement journal |
| Consolidated reporting | Restaurant and event sales side by side without a competing total |
| Profitability | Estimated before, actual after — actual read from the stock ledger, never from the quote |
| Permissions and audit | Ten `events.*` keys, all admin-only by default; every sensitive action audited with its actor |

**Code added:** 21 modules in `lib/events/`, 27 API routes, 11 admin screens,
5 migrations (045–049).

---

## 2. What was verified, and how

Every figure below came from a script run against real PostgreSQL on a
production build. Nothing here is inferred from reading the code.

| Phase | Checks | Result |
|---|---:|---|
| 15 — Consolidated reporting | 30 | 30 passed |
| 17 — Permissions and audit | 32 | 32 passed |
| 18 — End-to-end wedding scenario | 70 | 70 passed |
| 19 — Restaurant regression | 36 | 36 passed |
| 20 — Production readiness audit | 37 | 37 passed |
| Lifecycle re-verification after the Phase 20 concurrency work | 27 | 27 passed |

**Automated suites:**

- Unit tests: **155 passing, 0 failing** (`npm run test:unit`)
- Playwright end-to-end: **15 of 16 passing on desktop, 15 of 16 on mobile.**
  The one failure is described in section 6 — it is a data-configuration gap,
  not a code fault, and it is reported rather than hidden.
- Lint: 64 problems / 27 errors — **unchanged from the pre-project baseline.**
  All 27 are pre-existing `react-hooks/*` findings in files this project did
  not introduce. No new lint error was added.
- Production build: clean.

**The brief's wedding scenario, run end to end:** 250 expected / 220 guaranteed
in the Main Garden; 20 veg, 160 chicken, 40 mutton; a recipe-backed paneer
tikka, decoration, sound system and venue hire. Quoted at Rs 3,72,800, took a
Rs 1,50,000 advance, raised the guarantee to 240, revised the BEO, finalized,
forecast, started, sold drinks and chicken chilli during the reception, booked
a Rs 35,000 expense, settled Rs 4,96,145.10 with the advance applied and a
split cash/bank payment, completed. Food cost of Rs 49,712 came from the stock
ledger. All 25 audited steps named who took them.

---

## 3. The rules that were held, and the evidence

**Event bookings never deduct inventory.** Proven repeatedly: quoting,
confirming, taking a deposit and running a 300-guest forecast all left the
inventory snapshot byte-identical. Stock moves in exactly one place —
`startEvent` — and nowhere else in the module.

**Stock is deducted exactly once.** Both paths were checked: menu items through
`OrderRepository.create`, recipe-only components through `deductRawMaterials`.
No raw material was deducted twice for any event order, and the quantity of
every item this work touched equals its opening balance plus every recorded
movement.

**Deposits are a liability, not revenue.** A Rs 1,50,000 advance credited
account 2030 Event Customer Advances and left 4010 Sales Revenue untouched.
Revenue is recognised only at settlement, net of tax, and the advance is
consumed rather than re-earned — account 2030 returns to zero.

**Event revenue stays distinguishable.** `orders.event_id` and the EVENT
channel in `lib/order-types.js` were added strictly additively: the event
branch is evaluated first, so every order without an `event_id` classifies
exactly as before. Reported event sales equal the ledger to the paisa.

**No competing sales total.** Three figures are kept apart on purpose —
recognised sales, committed value (quotations for events that have not
happened) and deposits held. Only the first sits beside restaurant sales. An
Rs 80,000 quotation and Rs 20,000 of deposits stayed out of sales in the
Phase 15 QA.

**Existing restaurant behaviour is unchanged.** The Phase 19 regression run
confirmed: stock still commits when an item is added, a repeated KOT key issues
no second ticket, a replayed payment produces no second bill, the sale posts to
4010 and cash as before, all 32 restaurant endpoints answer 200 including the
four financial statements, and inventory returned byte-identical after
teardown.

**Migrations only, non-destructive.** Five migrations, all re-runnable, all
using `IF NOT EXISTS` / guarded predicates. Migrations 048 and 049 clear a
single link column and touch no recipe, stock level, price or transaction.
No table was dropped, no data reset, no financial value rewritten.

**Foreign-key delete rules protect history.** `event_deposits` is RESTRICT — an
event holding money cannot be deleted. `orders`, `expenses` and `purchases` are
SET NULL, so trading history survives. The audit trail is SET NULL too, so it
outlives the event it describes.

---

## 4. Defects found and fixed

Ten defects were found by QA during these phases. Six are in the events module;
four were pre-existing in the restaurant POS and are noted as such.

**In the events module:**

1. **Revenue double-count (Phase 12).** Production order items were counted as
   additional sales — Rs 4,200 of drinks reported as Rs 54,200. Fixed with
   `orders.event_production` (migration 047).

2. **Second double-count (Phase 14).** After settlement `events.total_amount`
   becomes the grand total, so profitability added the extras again —
   Rs 1,17,260 instead of Rs 1,02,000. Fixed by reading recognised revenue from
   the settlement journal, which is also correctly net of VAT.

3. **Concurrent starts each deducted stock (Phase 20).** Three simultaneous
   presses of Start all passed a read-then-check guard: 60 kg consumed by a
   20 kg event, three fulfilment orders. Replaced with an atomic conditional
   UPDATE that claims the event before anything moves, released on failure.

4. **Concurrent settlements both succeeded (Phase 20).** Same shape in
   `finaliseBilling`, each writing its own payment rows against one sale. The
   claim now happens inside the settlement transaction, so the loser rolls
   back.

5. **Progressive package rounding (Phase 20).** `line_total` was a rounded
   per-guest rate times the guest count. 100 guests at 1,200 plus 20 at 1,000
   is exactly 140,000 but blends to 1,166.666… a head, so a Rs 1,50,000
   quotation was billed as Rs 1,50,000.40. A package priced by its tiers now
   carries the engine's exact total.

6. **A malformed id answered 500 (Phase 20).** `Number('1 OR 1=1')` is NaN and
   NaN in an integer parameter raised a driver error. Nothing was injectable —
   values were always parameterised — but the status was wrong. All 37 id
   coercions now go through `toId()`, which answers 400.

Also fixed along the way: Postgres has no two-argument `date()`, so date
arithmetic moved into JavaScript; a Postgres DATE serialised through UTC landed
a Nepal booking a day early; override flags were not forwarded at confirm time;
`Number(null) === 0` let a manual quote total Rs 0; and a racing deposit
returned 500 instead of the idempotent success it had already achieved.

**Pre-existing, in the restaurant POS:**

7. **`autoLinkBeverageStock` bound unrelated items together.** Its rule matched
   on the inventory item's *first word* alone, and it runs on every order
   creation. QA reproduced 20 cold drinks deducting 20 kg of paneer. In this
   database it had already produced 34 links including "Ice Cream" ←
   "Chicken Fried Rice", "Black Pepper" ← "Black Oak" (a whisky) and
   "Red Bull Can" ← "Canvas (Red / White)" (a wine). None was firing, because
   every affected menu item has a recipe and the recipe branch is taken first —
   but the first recipe-less item sold would have drained the wrong raw
   material silently. The rule now requires the names to be equal, or the stock
   row to be the menu name plus container words. Migrations 048 and 049 cleared
   the 36 bad links and kept the 5 correct ones.

8. **`pgRun` appended `RETURNING id` to every INSERT.** `role_permissions` is
   keyed on `(role, permission_key)` and has no `id` column, so saving the
   permission matrix failed with `column "id" does not exist` — the
   admin-configurable permissions feature had never worked on PostgreSQL.

9. **The e2e admin suite hardcoded a PIN of 1234.** It had stopped matching the
   deployment, so eight tests failed at the login step and read as regressions
   in whatever they were meant to cover.

10. **A new event always started at 0% VAT and 0% service charge.** The columns
    default to 0 and `createEvent` never read the restaurant's configuration. A
    new event now inherits `vat_percentage` and `service_charge_percentage`
    from settings, still editable per event.

---

## 5. Known defects NOT fixed

These are stated plainly rather than hidden. Neither was fixed because both are
decisions for the business, not for the implementer.

**A. VAT is charged on the subtotal, not on subtotal plus service charge.**

`calculateBillTotals` computes both VAT and service charge from the net
subtotal, so VAT is not applied to the service charge. On the Phase 18 wedding
this was Rs 52,438.10 where charging on subtotal + service would have been
Rs 57,681.91 — a difference of Rs 5,243.81.

This is the **existing restaurant billing engine**, shared by every restaurant
bill; the events module deliberately reuses it rather than inventing a second
tax rule. It is inert for this business today because both configured rates are
0% and no VAT number is registered. Changing the tax base would alter every
future restaurant bill and is a tax decision with legal consequences, so it is
reported for the owner and their accountant rather than changed unilaterally.
The change, if wanted, is one line in `lib/billing-totals.js`.

**B. Growing a package line holds the agreed rate rather than re-tiering.**

Prices are snapshots by design: a chicken package quoted at 160 guests blends
to Rs 1,162.50 a head, and growing it to 180 charges 180 × 1,162.50 rather than
re-running the tier table (which would give Rs 2,08,000 instead of
Rs 2,09,250). This is the documented rule and it protects the client from a
silent price change, but for a *progressive* package the tier table is
effectively only applied when the line is created. Worth confirming with the
business that this is the intended commercial behaviour.

---

## 6. Configuration required before going live

These are not defects. They are things only the owner can supply, and the
system will report zero or empty until they do.

**1. Recipes have no ingredients.** All 197 menu items have a recipe shell with
zero ingredients (`recipe_items` is empty, and there has never been a single
`order_deduction` movement). Until bills of materials are entered:

- selling food deducts **no** inventory,
- food cost and gross margin read **zero** on every report,
- the event inventory forecast finds nothing to forecast.

The events module handles this correctly — it reports the food as untracked
rather than inventing a cost — but stock and profit figures are not meaningful
until the BOMs exist. **This is the single largest gap before go-live.**

**2. VAT and service charge are 0% and no VAT number is set.** If Sundar
Bagaicha is VAT-registered, set `vat_percentage`, `service_charge_percentage`
and `vat_number` in Settings before issuing bills. New events inherit whatever
is configured at the moment they are created.

**3. Menu photos are not mapped.** 0 of 197 menu items have an `image_url`, so
the public menu shows no photographs — this is the one failing Playwright test
(`menu images with a stored source actually load`), on both desktop and mobile.
Only four dish photos exist in `public/images/dishes/`, and two of them
(`chicken-chilly.jpg` and `chicken-momo.jpg`) are **byte-identical**, so one is
mislabelled. Mapping them was deliberately not done: putting a momo photograph
on Chicken Chilly to make a test pass would be exactly the kind of invented data
the brief forbids. Supply real photographs, then run `npm run map:menu-images`.

**4. The admin PIN is 987898** as requested. It is not stored in any tracked
file; `.env.example` carries a placeholder only. Change it in production and
supply it to the e2e suite via `E2E_ADMIN_PIN`.

**5. Events permissions are admin-only.** All ten `events.*` keys default to
off for every other role, which reproduces today's behaviour exactly. Delegate
from `/admin/permissions` when you want a cashier to handle bookings; note that
`events.production` releases stock and `events.billing` recognises revenue, so
those two deserve the most thought.

---

## 7. Operational notes

- **Run `npm run db:migrate` before deploying this build.** Migrations 045–049
  must be applied. All are re-runnable and none is destructive.
- **Migrations 048 and 049 will clear wrong inventory-to-menu links** on your
  production database, as they did here (34 + 2 of 41). Any link that was
  genuinely correct is recreated automatically by the fixed auto-linker on the
  next order. Review Products → inventory linking afterwards if you had made
  any deliberately.
- **Account 2030 Event Customer Advances** now appears on the balance sheet as
  a liability. It should read zero when no event is holding an advance; a
  non-zero balance is the money you owe back if events are cancelled.
- **The events module never moves stock except at Start.** If a wedding is
  cancelled before it starts, nothing needs to be returned to inventory.
- Three source files were left modified in the working tree at the end of this
  work — `lib/stock.js`, `components/pos/admin-pos.jsx` and
  `app/api/admin/products/route.js` — containing a POS stock-display feature
  that was not part of this project. They were deliberately not committed or
  reverted.

---

## 8. Verdict

The events module does what the brief asked, on the same database and the same
business engines as the restaurant, with every financial and inventory rule
verified against real PostgreSQL rather than asserted. The restaurant POS
behaves exactly as it did. Ten defects were found and fixed, including four
that predate this project and one — the inventory auto-linker — that would
eventually have corrupted stock and food cost silently.

Two known issues remain unfixed, both stated in section 5, and both are
business decisions rather than implementation gaps. Neither blocks operation:
the VAT base is inert at the current 0% rate, and the pricing snapshot rule is
defensible as written.

What does block confident operation is section 6, item 1. With every recipe
empty, the system cannot deduct stock, cannot cost food and cannot forecast for
an event. That is configuration the owner must supply, not code that is
missing — but until it is supplied, the inventory and profitability figures the
system produces are structurally correct and numerically meaningless.

**Verdict: NOT PRODUCTION READY**

It becomes production ready once section 6 is completed — principally the
recipe bills of materials, and the VAT configuration if the business is
registered. No further code work is required for that; the remaining steps are
data entry and a decision on the two items in section 5.
