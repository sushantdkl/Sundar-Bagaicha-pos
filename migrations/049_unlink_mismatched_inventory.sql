-- 049: clear inventory-to-menu links whose names do not name the same thing.
--
-- Completes the repair 048 began. 048 removed the links the old first-word
-- rule produced; this removes what a containment-plus-length rule still let
-- through, because that rule cannot tell a raw material from a dish made out
-- of it: "Mutton" and "Mutton Tas" match, as do "Mushroom" and "Mushroom
-- Soup", and selling one plate would deduct one kilogram.
--
-- lib/stock.js now links only when the two names are equal, or the stock row
-- is the menu name followed by container words (Coke -> Coke Cans, Masala Tea
-- -> Masala Tea Cups). This migration applies the same test to what is already
-- stored: a link survives only if the inventory name starts with the whole
-- menu name and adds nothing but a container word.
--
-- Only the link column is cleared. No recipe, stock level, price or
-- transaction is touched, and it is re-runnable. Any link this removes that
-- was in fact correct will be recreated automatically by the auto-linker on
-- the next order, because it satisfies the new rule.

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
    inv_name = menu_name AS exact,
    -- the remainder after stripping the menu name from the front of the
    -- inventory name, e.g. "coke cans" minus "coke" -> "cans"
    CASE
      WHEN inv_name LIKE menu_name || ' %' THEN btrim(substr(inv_name, length(menu_name) + 2))
      ELSE NULL
    END AS remainder
  FROM normalised
  WHERE inv_name <> '' AND menu_name <> ''
),
verdict AS (
  SELECT
    id,
    exact
    OR (
      remainder IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM regexp_split_to_table(remainder, ' ') AS w(word)
         WHERE w.word NOT IN (
           'can','cans','bottle','bottles','cup','cups','glass','glasses',
           'pack','packs','packet','packets','box','boxes','tin','tins',
           'piece','pieces','pcs','unit','units','sachet','sachets'
         )
      )
    ) AS keep_link
  FROM judged
)
UPDATE inventory_items
   SET menu_item_id = NULL
 WHERE id IN (SELECT id FROM verdict WHERE keep_link = FALSE);
