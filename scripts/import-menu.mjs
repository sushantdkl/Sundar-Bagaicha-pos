/**
 * Idempotent menu importer for Sundar Bagaicha Events.
 *
 * Reads data/menu/sundar-bagaicha-menu.json — the menu transcribed verbatim
 * from the venue's own printed food card (photographed, see the `sources`
 * block in that file) and printed liquors card — and upserts
 * menu_categories / menu_items / menu_item_variants keyed by a stable
 * `source_ref`, so re-running updates rather than duplicates.
 *
 * Prices are only ever copied from the JSON — never calculated or retyped.
 * Nothing is deleted: `--deactivate-unmanaged` hides unmanaged legacy rows
 * (is_available = 0) so historical orders and reports stay intact.
 *
 * Usage:
 *   node scripts/import-menu.mjs                     # apply to the active DB
 *   node scripts/import-menu.mjs --dry-run           # diff only, no writes
 *   node scripts/import-menu.mjs --deactivate-unmanaged
 *       # additionally hide (is_available=0) legacy items not in this import
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from '../lib/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MENU_PATH = path.join(ROOT, 'data', 'menu', 'sundar-bagaicha-menu.json');
const REPORT_PATH = path.join(ROOT, 'menu-import-report.md');

const DRY_RUN = process.argv.includes('--dry-run');
const DEACTIVATE_UNMANAGED = process.argv.includes('--deactivate-unmanaged');

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Expand the JSON into flat item rows, resolving sized spirits into variants. */
function parseMenu() {
  const menu = JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));
  const categories = [];
  const items = [];

  menu.categories.forEach((cat, catIndex) => {
    categories.push({ name: cat.name, order: catIndex + 1, foodGroup: cat.food_group });

    cat.items.forEach((item, index) => {
      const sized = Array.isArray(item.sized) ? item.sized : null;
      if (sized && (!cat.sizes || cat.sizes.length !== sized.length)) {
        throw new Error(`${cat.name} / ${item.name}: ${sized.length} prices for ${cat.sizes?.length ?? 0} sizes`);
      }
      const basePrice = sized ? sized[0] : item.price;
      if (!(Number(basePrice) > 0)) throw new Error(`${cat.name} / ${item.name}: missing price`);

      let variants = null;
      if (sized) {
        variants = cat.sizes.map((size, i) => ({ name: size, price: sized[i] }));
      } else if (Array.isArray(item.variants)) {
        variants = item.variants.map((v) => ({ name: v.name, price: v.price }));
      }

      items.push({
        sourceRef: `sb:${slug(cat.name)}:${slug(item.name)}`,
        displayName: item.name,
        category: cat.name,
        basePrice: Number(basePrice),
        description: item.description || null,
        tags: item.tags || null,
        displayOrder: index + 1,
        variants,
      });
    });
  });

  return { menu, categories, items };
}

// ---- Schema safety -------------------------------------------------------
async function ensureSourceRefColumn(db) {
  try {
    await db.get('SELECT source_ref FROM menu_items LIMIT 1');
    return; // column already exists
  } catch {
    /* add it below */
  }
  try {
    await db.run('ALTER TABLE menu_items ADD COLUMN source_ref TEXT');
    console.log('  + added menu_items.source_ref column');
  } catch (err) {
    if (!/duplicate|exists/i.test(String(err.message))) throw err;
  }
}

async function ensureVariantPriceColumn(db) {
  try {
    await db.get('SELECT price FROM menu_item_variants LIMIT 1');
    return;
  } catch {
    /* add it below */
  }
  try {
    await db.run('ALTER TABLE menu_item_variants ADD COLUMN price DOUBLE PRECISION');
    console.log('  + added menu_item_variants.price column');
  } catch (err) {
    if (!/duplicate|exists/i.test(String(err.message))) throw err;
  }
}

async function ensureFoodGroupColumn(db) {
  try {
    await db.get('SELECT food_group FROM menu_categories LIMIT 1');
    return;
  } catch {
    /* add it below */
  }
  try {
    await db.run("ALTER TABLE menu_categories ADD COLUMN food_group TEXT DEFAULT 'food'");
    console.log('  + added menu_categories.food_group column');
  } catch (err) {
    if (!/duplicate|exists/i.test(String(err.message))) throw err;
  }
}

// ---- DB upserts ----------------------------------------------------------
async function upsertCategory(db, cat, changes) {
  const existing = await db.get('SELECT id FROM menu_categories WHERE name = ?', [cat.name]);
  if (existing) {
    if (!DRY_RUN) {
      await db.run(
        'UPDATE menu_categories SET display_order = ?, food_group = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [cat.order, cat.foodGroup, existing.id]
      );
    }
    changes.categories.updated.push(cat.name);
    return existing.id;
  }
  changes.categories.created.push(cat.name);
  if (DRY_RUN) return -1;
  await db.run(
    'INSERT INTO menu_categories (name, display_order, food_group, is_active) VALUES (?, ?, ?, 1)',
    [cat.name, cat.order, cat.foodGroup]
  );
  const row = await db.get('SELECT id FROM menu_categories WHERE name = ?', [cat.name]);
  return row.id;
}

async function upsertItem(db, item, categoryId, changes) {
  const existing = await db.get(
    'SELECT id, base_price, name, category_id FROM menu_items WHERE source_ref = ?',
    [item.sourceRef]
  );
  let itemId;
  if (existing) {
    changes.items.updated.push({
      ref: item.sourceRef,
      name: item.displayName,
      price: item.basePrice,
      priceWas: Number(existing.base_price),
      priceChanged: Number(existing.base_price) !== item.basePrice,
    });
    itemId = existing.id;
    if (!DRY_RUN) {
      await db.run(
        `UPDATE menu_items
           SET name = ?, category_id = ?, base_price = ?, display_order = ?,
               description = COALESCE(?, description), tags = COALESCE(?, tags),
               is_available = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [item.displayName, categoryId, item.basePrice, item.displayOrder, item.description, item.tags, itemId]
      );
    }
  } else {
    changes.items.created.push({ ref: item.sourceRef, name: item.displayName, price: item.basePrice });
    if (DRY_RUN) return;
    await db.run(
      `INSERT INTO menu_items (name, category_id, base_price, display_order, description, tags, is_available, source_ref)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [item.displayName, categoryId, item.basePrice, item.displayOrder, item.description, item.tags, item.sourceRef]
    );
    const row = await db.get('SELECT id FROM menu_items WHERE source_ref = ?', [item.sourceRef]);
    itemId = row.id;
  }

  // Variants: rebuild idempotently. Both the absolute price and the legacy
  // modifier are written so either read path resolves to the same amount.
  if (!DRY_RUN && itemId) {
    await db.run('DELETE FROM menu_item_variants WHERE menu_item_id = ?', [itemId]);
    if (item.variants) {
      for (let i = 0; i < item.variants.length; i++) {
        const v = item.variants[i];
        await db.run(
          'INSERT INTO menu_item_variants (menu_item_id, variant_name, price, price_modifier, is_default) VALUES (?, ?, ?, ?, ?)',
          [itemId, v.name, v.price, v.price - item.basePrice, i === 0 ? 1 : 0]
        );
      }
    }
  }
}

// ---- Report --------------------------------------------------------------
function writeReport(menu, parsed, changes) {
  const L = [];
  L.push('# Menu import report — Sundar Bagaicha Events', '');
  L.push(`Run: ${new Date().toISOString()}${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`, '');
  L.push(`- Source: \`data/menu/sundar-bagaicha-menu.json\``);
  L.push(`- Categories in source: **${parsed.categories.length}**`);
  L.push(`- Items in source: **${parsed.items.length}**`);
  L.push(`- Categories created: **${changes.categories.created.length}**, updated: **${changes.categories.updated.length}**`);
  L.push(`- Items created: **${changes.items.created.length}**, updated: **${changes.items.updated.length}**`);
  if (DEACTIVATE_UNMANAGED) {
    L.push(`- Legacy items hidden (is_available=0, not deleted): **${changes.deactivated}**`);
  }
  L.push('');

  const repriced = changes.items.updated.filter((i) => i.priceChanged);
  if (repriced.length) {
    L.push('## Price changes applied', '', '| Item | Was | Now |', '|---|---:|---:|');
    for (const i of repriced) L.push(`| ${i.name} | ${i.priceWas} | ${i.price} |`);
    L.push('');
  }

  if (menu.conflicts?.length) {
    L.push('## Printed-card conflicts — confirm with the client', '');
    for (const c of menu.conflicts) L.push(`- **${c.item}** — ${c.note}`);
    L.push('');
  }

  if (changes.items.created.length) {
    L.push('## Items created', '', '| Item | Price (Rs) | source_ref |', '|---|---:|---|');
    for (const i of changes.items.created) L.push(`| ${i.name} | ${i.price} | \`${i.ref}\` |`);
    L.push('');
  }

  fs.writeFileSync(REPORT_PATH, L.join('\n'));
  console.log(`  report written to ${path.relative(ROOT, REPORT_PATH)}`);
}

// ---- Main ----------------------------------------------------------------
const parsed = parseMenu();
console.log(`Sundar Bagaicha menu: ${parsed.categories.length} categories, ${parsed.items.length} items${DRY_RUN ? ' (dry run)' : ''}`);

const db = Database.getInstance();
const changes = {
  categories: { created: [], updated: [] },
  items: { created: [], updated: [] },
  deactivated: 0,
};

await ensureSourceRefColumn(db);
await ensureVariantPriceColumn(db);
await ensureFoodGroupColumn(db);

const categoryIds = new Map();
for (const cat of parsed.categories) {
  categoryIds.set(cat.name, await upsertCategory(db, cat, changes));
}
for (const item of parsed.items) {
  await upsertItem(db, item, categoryIds.get(item.category), changes);
}

if (DEACTIVATE_UNMANAGED && !DRY_RUN) {
  const res = await db.run('UPDATE menu_items SET is_available = 0 WHERE source_ref IS NULL');
  changes.deactivated = res?.changes ?? res?.rowCount ?? 0;
  // Hide legacy categories left with no imported items so the menu screens
  // do not show empty groups. Rows are kept for historical reporting.
  await db.run(
    `UPDATE menu_categories SET is_active = 0
     WHERE id NOT IN (SELECT DISTINCT category_id FROM menu_items WHERE source_ref IS NOT NULL)`
  );
}

writeReport(parsed.menu, parsed, changes);
console.log(
  `✓ ${DRY_RUN ? 'would apply' : 'applied'}: +${changes.categories.created.length}/${changes.categories.updated.length} categories, ` +
  `+${changes.items.created.length}/${changes.items.updated.length} items` +
  (DEACTIVATE_UNMANAGED && !DRY_RUN ? `, ${changes.deactivated} legacy items hidden` : '')
);
await Database.close();
