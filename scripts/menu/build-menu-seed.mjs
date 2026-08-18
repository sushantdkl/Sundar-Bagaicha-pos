/**
 * Regenerate the menu section of deploy/production_seed.sql from
 * data/menu/sundar-bagaicha-menu.json (the single menu source of truth,
 * transcribed from Sundar Bagaicha's own printed food and liquors cards).
 *
 * Prices are copied verbatim from the JSON — nothing is calculated here.
 * Only the block between the "6. MENU CATEGORIES" and "7. INVENTORY CATEGORIES"
 * markers is rewritten; every other part of the seed is left untouched.
 *
 * Usage:
 *   node scripts/menu/build-menu-seed.mjs            # rewrite the seed in place
 *   node scripts/menu/build-menu-seed.mjs --stdout   # print, do not write
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MENU_PATH = path.join(ROOT, 'data', 'menu', 'sundar-bagaicha-menu.json');
const SEED_PATH = path.join(ROOT, 'deploy', 'production_seed.sql');
const START_MARK = '-- ================================================= 6. MENU CATEGORIES';
const END_MARK = '-- ================================================ 7. INVENTORY CATEGORIES';

const q = (value) => (value == null || value === '' ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);

/** Flatten one category's items into menu_items rows + menu_item_variants rows. */
function expand(menu) {
  const items = [];
  const variants = [];
  for (const cat of menu.categories) {
    cat.items.forEach((item, index) => {
      const sized = Array.isArray(item.sized) ? item.sized : null;
      if (sized && (!cat.sizes || cat.sizes.length !== sized.length)) {
        throw new Error(`${cat.name} / ${item.name}: ${sized.length} prices for ${cat.sizes?.length ?? 0} sizes`);
      }
      const basePrice = sized ? sized[0] : item.price;
      if (!(Number(basePrice) > 0)) throw new Error(`${cat.name} / ${item.name}: missing price`);

      items.push({
        name: item.name,
        cat: cat.name,
        price: basePrice,
        order: index + 1,
        description: item.description || null,
        tags: item.tags || null,
      });

      if (sized) {
        cat.sizes.forEach((size, i) => {
          variants.push({ item: item.name, cat: cat.name, name: size, price: sized[i], isDefault: i === 0 });
        });
      } else if (Array.isArray(item.variants)) {
        for (const variant of item.variants) {
          variants.push({
            item: item.name, cat: cat.name, name: variant.name,
            price: variant.price, isDefault: Boolean(variant.default),
          });
        }
      }
    });
  }
  return { items, variants };
}

function buildSql(menu) {
  const { items, variants } = expand(menu);
  const beverages = menu.categories.filter((c) => c.food_group === 'beverage').map((c) => q(c.name));
  const foods = menu.categories.filter((c) => c.food_group === 'food').map((c) => q(c.name));

  const conflictNotes = menu.conflicts
    .map((c) => `--   • ${c.item}: ${c.note}`)
    .join('\n');

  const itemRows = [];
  for (const cat of menu.categories) {
    itemRows.push({ comment: `  -- ${cat.name}` });
    for (const row of items.filter((i) => i.cat === cat.name)) {
      itemRows.push({
        sql: `  (${q(row.name)},${q(row.cat)},${row.price},${row.order},${q(row.description)},${q(row.tags)})`,
      });
    }
  }
  // Join tuples with commas, but never leave a comma dangling on a comment line.
  let body = '';
  const sqlRows = itemRows.filter((r) => r.sql);
  let emitted = 0;
  for (const row of itemRows) {
    if (row.comment) { body += `${row.comment}\n`; continue; }
    emitted += 1;
    body += `${row.sql}${emitted < sqlRows.length ? ',' : ''}\n`;
  }

  return `${START_MARK} (${menu.categories.length})
-- Sundar Bagaicha Events food + bar menu. Transcribed verbatim from the
-- venue's own printed cards — see data/menu/sundar-bagaicha-menu.json for the
-- source photographs, transcription rules and the price conflicts below.
-- Regenerate with: node scripts/menu/build-menu-seed.mjs
--
-- Printed-card price conflicts the client should confirm in Admin -> Menu:
${conflictNotes}
INSERT INTO menu_categories (name, display_order)
SELECT v.name, v.ord FROM (VALUES
${menu.categories.map((c, i) => `  (${q(c.name)}, ${i + 1})`).join(',\n')}
) AS v(name, ord)
ON CONFLICT (name) DO NOTHING;

-- ================================================ 6a. MASTER FOOD GROUPS
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS food_group TEXT DEFAULT 'food';
UPDATE menu_categories SET food_group = 'beverage'
WHERE name IN (${beverages.join(', ')})
  AND COALESCE(food_group, 'food') <> 'beverage';
UPDATE menu_categories SET food_group = 'food'
WHERE name IN (${foods.join(', ')})
  AND COALESCE(food_group, '') <> 'food';

-- ================================================= 6b. MENU ITEMS (${items.length})
-- base_price is the smallest listed serving. Spirits sold by peg carry their
-- real per-size prices as menu_item_variants below, so the POS charges the
-- actual pour price instead of a multiple of the small measure.
INSERT INTO menu_items (name, category_id, base_price, is_available, display_order, image_url, description, tags)
SELECT v.name, c.id, v.price, 1, v.ord, NULL, v.descr, v.tags
FROM (VALUES
${body}) AS v(name, cat, price, ord, descr, tags)
JOIN menu_categories c ON c.name = v.cat
WHERE NOT EXISTS (
  SELECT 1 FROM menu_items m WHERE m.name = v.name AND m.category_id = c.id
);

-- =============================================== 6c. SERVING SIZES (${variants.length} rows)
-- Absolute per-size prices (not modifiers) — lib/db/repositories/orders.js
-- re-resolves the price from this table server-side on every order line.
ALTER TABLE menu_item_variants ADD COLUMN IF NOT EXISTS price DOUBLE PRECISION;
INSERT INTO menu_item_variants (menu_item_id, variant_name, price, price_modifier, is_default)
SELECT m.id, v.variant_name, v.price, 0, v.is_default
FROM (VALUES
${variants.map((v) => `  (${q(v.item)},${q(v.cat)},${q(v.name)},${v.price},${v.isDefault ? 1 : 0})`).join(',\n')}
) AS v(item_name, cat, variant_name, price, is_default)
JOIN menu_categories c ON c.name = v.cat
JOIN menu_items m ON m.name = v.item_name AND m.category_id = c.id
WHERE NOT EXISTS (
  SELECT 1 FROM menu_item_variants x WHERE x.menu_item_id = m.id AND x.variant_name = v.variant_name
);

`;
}

const menu = JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));
const sql = buildSql(menu);

if (process.argv.includes('--stdout')) {
  process.stdout.write(sql);
} else {
  const seed = fs.readFileSync(SEED_PATH, 'utf8');
  const start = seed.indexOf(START_MARK);
  const end = seed.indexOf(END_MARK);
  if (start < 0 || end < 0 || end < start) {
    throw new Error('Could not locate the menu block markers in deploy/production_seed.sql');
  }
  fs.writeFileSync(SEED_PATH, seed.slice(0, start) + sql + seed.slice(end));
  const { items, variants } = expand(menu);
  console.log(`✓ seed menu rebuilt: ${menu.categories.length} categories, ${items.length} items, ${variants.length} variant rows`);
}
