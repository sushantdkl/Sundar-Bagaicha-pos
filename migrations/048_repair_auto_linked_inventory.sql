-- 048: clear the inventory-to-menu links that autoLinkBeverageStock() guessed.
--
-- That function runs on every order creation. Until this release its rule
-- accepted a match on the inventory item's FIRST WORD alone:
--
--     h.includes(n) || n.includes(h.split(' ')[0])
--
-- so any menu item whose name contained an inventory item's first token was
-- hard-linked to it. In this database that produced links such as
-- "Ice Cream" <- "Chicken Fried Rice", "Black Pepper" <- "Black Oak" (a
-- whisky) and "Red Bull Can" <- "Canvas (Red / White)" (a wine).
--
-- The link is trusted afterwards with no further checking: resolveInventoryItem()
-- returns it immediately, and deductStockForItems() deducts one unit of the
-- linked row per unit sold. Today none of these fires, because every affected
-- menu item has a recipe and the recipe branch is taken first — but the moment
-- a recipe-less item is sold (a bottled drink, a dessert, a cigarette) the
-- wrong raw material is drained silently. Phase 18 QA reproduced exactly that:
-- 20 cold drinks deducted 20 kg of paneer.
--
-- lib/stock.js now requires containment plus a length ratio of 0.6 — the same
-- rule resolveInventoryItem() uses — and refuses to link anything ambiguous.
-- This migration removes the links the old rule left behind.
--
-- DELIBERATELY SURGICAL. A link is cleared only when BOTH hold:
--   * the new rule would not have made it, and
--   * the old rule explains it,
-- so a link an operator made by hand in Products — which the old rule cannot
-- account for — is left exactly as it is. No other column is touched, and no
-- stock, price or transaction is altered.
--
-- Re-runnable: after it has run, no row satisfies the predicate.

WITH normalised AS (
  SELECT
    i.id,
    btrim(regexp_replace(regexp_replace(lower(i.item_name), '[^a-z0-9 ]', ' ', 'g'), ' +', ' ', 'g')) AS inv_name,
    btrim(regexp_replace(regexp_replace(lower(m.name), '[^a-z0-9 ]', ' ', 'g'), ' +', ' ', 'g')) AS menu_name
  FROM inventory_items i
  JOIN menu_items m ON m.id = i.menu_item_id
  WHERE i.menu_item_id IS NOT NULL
),
judged AS (
  SELECT
    id,
    -- the new rule: one name contains the other and they are close in length
    (
      (POSITION(menu_name IN inv_name) > 0 OR POSITION(inv_name IN menu_name) > 0)
      AND LEAST(LENGTH(inv_name), LENGTH(menu_name))::numeric
          / NULLIF(GREATEST(LENGTH(inv_name), LENGTH(menu_name)), 0) >= 0.6
    ) AS matches_new_rule,
    -- the old rule, including its first-word shortcut
    (
      POSITION(menu_name IN inv_name) > 0
      OR POSITION(split_part(inv_name, ' ', 1) IN menu_name) > 0
    ) AS matches_old_rule
  FROM normalised
  WHERE inv_name <> '' AND menu_name <> ''
)
UPDATE inventory_items
   SET menu_item_id = NULL
 WHERE id IN (SELECT id FROM judged WHERE matches_new_rule = FALSE AND matches_old_rule = TRUE);
