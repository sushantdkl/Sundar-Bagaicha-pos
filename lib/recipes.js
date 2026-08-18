/**
 * Recipe / BOM engine: recipe CRUD, BOM explosion, raw-material deduction,
 * wastage logging.
 */

import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { ensureStockMovementsTable } from '@/lib/stock-movements.js';
import { applyStockChanges, ensureLedgerSchema } from '@/lib/inventory-ledger.js';
import { upsertLinkedExpense } from '@/lib/expense-links.js';
import { buildSearch, paginateQuery, resolveOrderBy } from '@/lib/paginate.js';
import { currentBusinessDayId } from '@/lib/business-days.js';

const MAX_RECIPE_DEPTH = 10;

export async function ensureRecipeTables(db) {
  await ensureColumn(db, 'inventory_items', 'purchase_unit', 'TEXT');
  await ensureColumn(db, 'inventory_items', 'consumption_unit', 'TEXT');
  await ensureColumn(db, 'inventory_items', 'conversion_factor', 'REAL DEFAULT 1');
  await ensureColumn(db, 'inventory_items', 'category', 'TEXT');
  await ensureStockMovementsTable(db);

  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('menu_item', 'sub_recipe')),
      menu_item_id INTEGER UNIQUE REFERENCES menu_items(id) ON DELETE CASCADE,
      yield_quantity REAL DEFAULT 1,
      yield_unit TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS recipe_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      raw_material_id INTEGER REFERENCES inventory_items(id),
      component_recipe_id INTEGER REFERENCES recipes(id),
      quantity REAL NOT NULL,
      unit TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS wastage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_material_id INTEGER REFERENCES inventory_items(id),
      recipe_id INTEGER REFERENCES recipes(id),
      quantity REAL NOT NULL,
      unit TEXT,
      reason TEXT NOT NULL,
      logged_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );

  // Prep metadata the builder needs. menu_items.preparation_time only exists
  // for menu-linked recipes, so sub/batch recipes had nowhere to record either.
  await ensureColumn(db, 'recipes', 'prep_time_minutes', 'INTEGER');
  await ensureColumn(db, 'recipes', 'prep_notes', 'TEXT');
  await ensureColumn(db, 'wastage_log', 'business_day_id', 'INTEGER');

  await ensureLedgerSchema(db);
}

/**
 * Recursively explode a recipe into raw-material quantities.
 * `db` is used read-only here — safe to call inside or outside a transaction.
 * @returns {Promise<Map<number, number>>} raw_material_id -> total quantity
 */
export async function explodeRecipe(db, recipeId, multiplier, acc = new Map(), depth = 0) {
  if (depth > MAX_RECIPE_DEPTH) {
    throw new Error('Recipe nesting too deep — check for a circular sub-recipe reference.');
  }
  const lines = await db.all(`SELECT * FROM recipe_items WHERE recipe_id = ?`, [recipeId]);
  for (const line of lines) {
    const qty = Number(line.quantity) * multiplier;
    if (line.raw_material_id) {
      acc.set(line.raw_material_id, (acc.get(line.raw_material_id) || 0) + qty);
    } else if (line.component_recipe_id) {
      const sub = await db.get(`SELECT * FROM recipes WHERE id = ?`, [line.component_recipe_id]);
      if (!sub) continue;
      const subMultiplier = qty / Number(sub.yield_quantity || 1);
      await explodeRecipe(db, line.component_recipe_id, subMultiplier, acc, depth + 1);
    }
  }
  return acc;
}

/**
 * Apply a raw-material delta map (consumption units) through the ledger. Must
 * be called with a `db` handle that is already transaction-scoped by the
 * caller — this function never opens its own transaction.
 *
 * Thin wrapper kept for the existing call sites; all quantity/cost/movement
 * writing happens in lib/inventory-ledger.js.
 */
export async function deductRawMaterials(db, deltaMap, options = {}) {
  const {
    direction = -1,
    changeType = direction < 0 ? 'order_deduction' : 'order_void',
    performedBy = null,
    reason = null,
    referenceId = null,
    businessDayId = null,
  } = options;

  const entries = Array.from(deltaMap, ([inventory_item_id, amount]) => ({
    inventory_item_id,
    quantity: Number(amount) * direction,
  }));

  const { applied, warnings } = await applyStockChanges(db, entries, {
    change_type: changeType,
    performed_by: performedBy,
    reason,
    reference_id: referenceId,
    business_day_id: businessDayId,
  });

  return { deducted: applied, warnings };
}

export async function getRecipeByMenuItemId(db, menuItemId) {
  if (!menuItemId) return null;
  return db.get(`SELECT * FROM recipes WHERE menu_item_id = ?`, [menuItemId]);
}

/**
 * `withCost` prices every recipe so the list can show food cost and margin
 * without the client making one request per row. It is O(recipes) queries —
 * fine at a single restaurant's recipe count, and opt-in so the pickers that
 * only need names stay cheap.
 */
export async function listRecipes(db, { withCost = false } = {}) {
  const recipes = await db.all(`
    SELECT r.*, mi.name as menu_item_name, mi.base_price as menu_item_price,
           (SELECT COUNT(*) FROM recipe_items ri WHERE ri.recipe_id = r.id) as item_count
    FROM recipes r
    LEFT JOIN menu_items mi ON r.menu_item_id = mi.id
    ORDER BY r.type, r.name
  `);
  if (!withCost) return recipes;

  const priced = [];
  for (const recipe of recipes) {
    const cost = await getRecipeCost(db, recipe.id);
    priced.push({ ...recipe, food_cost: cost.total_cost });
  }
  return priced;
}

export async function getRecipeWithItems(db, id) {
  const recipe = await db.get(
    `SELECT r.*, mi.name as menu_item_name, mi.base_price as menu_item_price,
            mi.image_url as menu_item_image, mi.preparation_time as menu_item_prep_time
     FROM recipes r
     LEFT JOIN menu_items mi ON r.menu_item_id = mi.id
     WHERE r.id = ?`,
    [id]
  );
  if (!recipe) return null;

  const items = await db.all(
    `SELECT ri.*, im.item_name as raw_material_name, im.unit as raw_material_unit,
            cr.name as component_recipe_name
     FROM recipe_items ri
     LEFT JOIN inventory_items im ON ri.raw_material_id = im.id
     LEFT JOIN recipes cr ON ri.component_recipe_id = cr.id
     WHERE ri.recipe_id = ?
     ORDER BY ri.id`,
    [id]
  );

  // Parents, so a sub-recipe can say what it feeds. One query instead of the
  // page fetching every recipe and scanning their lines.
  const used_in = await db.all(
    `SELECT DISTINCT r.id, r.name, r.type, mi.name AS menu_item_name
     FROM recipe_items ri
     JOIN recipes r ON ri.recipe_id = r.id
     LEFT JOIN menu_items mi ON r.menu_item_id = mi.id
     WHERE ri.component_recipe_id = ?
     ORDER BY r.name`,
    [id]
  );

  return { ...recipe, items, used_in };
}

/**
 * Total raw-material cost of one yield of a recipe, exploded through any
 * sub-recipes, priced at each raw material's current cost_per_unit.
 */
export async function getRecipeCost(db, recipeId) {
  const deltaMap = await explodeRecipe(db, recipeId, 1);
  const breakdown = [];
  let total = 0;
  for (const [rawMaterialId, qty] of deltaMap) {
    const item = await db.get(`SELECT * FROM inventory_items WHERE id = ?`, [rawMaterialId]);
    if (!item) continue;
    const lineCost = qty * Number(item.cost_per_unit || 0);
    total += lineCost;
    breakdown.push({
      inventory_item_id: rawMaterialId,
      item_name: item.item_name || item.name,
      quantity: qty,
      unit: item.consumption_unit || item.unit,
      cost_per_unit: Number(item.cost_per_unit || 0),
      line_cost: lineCost,
    });
  }
  breakdown.sort((a, b) => b.line_cost - a.line_cost);
  return { total_cost: total, breakdown };
}

async function replaceRecipeItems(db, recipeId, items) {
  await db.run(`DELETE FROM recipe_items WHERE recipe_id = ?`, [recipeId]);
  for (const item of items || []) {
    if (!item.raw_material_id && !item.component_recipe_id) continue;
    if (item.raw_material_id && item.component_recipe_id) continue;
    await db.run(
      `INSERT INTO recipe_items (recipe_id, raw_material_id, component_recipe_id, quantity, unit)
       VALUES (?, ?, ?, ?, ?)`,
      [recipeId, item.raw_material_id || null, item.component_recipe_id || null, Number(item.quantity), item.unit || null]
    );
  }
}

export async function createRecipe(db, data) {
  return db.transaction(async (tx) => {
    const result = await tx.run(
      `INSERT INTO recipes (name, type, menu_item_id, yield_quantity, yield_unit, prep_time_minutes, prep_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.type,
        data.menu_item_id || null,
        Number(data.yield_quantity || 1),
        data.yield_unit || null,
        data.prep_time_minutes ? Number(data.prep_time_minutes) : null,
        data.prep_notes || null,
      ]
    );
    const recipeId = result.lastInsertRowid;
    await replaceRecipeItems(tx, recipeId, data.items);
    return getRecipeWithItems(tx, recipeId);
  });
}

export async function updateRecipe(db, id, data) {
  return db.transaction(async (tx) => {
    await tx.run(
      `UPDATE recipes SET name = ?, type = ?, menu_item_id = ?, yield_quantity = ?, yield_unit = ?,
              prep_time_minutes = ?, prep_notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        data.name,
        data.type,
        data.menu_item_id || null,
        Number(data.yield_quantity || 1),
        data.yield_unit || null,
        data.prep_time_minutes ? Number(data.prep_time_minutes) : null,
        data.prep_notes || null,
        id,
      ]
    );
    await replaceRecipeItems(tx, id, data.items);
    return getRecipeWithItems(tx, id);
  });
}

export async function deleteRecipe(db, id) {
  await db.run(`DELETE FROM recipes WHERE id = ?`, [id]);
}

/**
 * Log wastage of either a raw material or a prepared/batch recipe item.
 * Opens its own transaction — this is a fresh entry point, not nested
 * inside an existing one.
 */
export async function logWastage(db, entry) {
  const {
    raw_material_id,
    recipe_id,
    quantity,
    unit,
    reason,
    logged_by,
    notes,
    employee_id = null,
    shift = null,
    photo_url = null,
  } = entry;
  if (!raw_material_id && !recipe_id) {
    throw new Error('Select a raw material or prepared item to log wastage for.');
  }
  const qty = Number(quantity);
  if (!(qty > 0)) {
    throw new Error('Wastage quantity must be greater than zero.');
  }

  return db.transaction(async (tx) => {
    const businessDayId = await currentBusinessDayId(tx, { required: true });
    let deltaMap;
    if (recipe_id) {
      const recipe = await tx.get(`SELECT * FROM recipes WHERE id = ?`, [recipe_id]);
      if (!recipe) throw new Error('Recipe not found.');
      const multiplier = qty / Number(recipe.yield_quantity || 1);
      deltaMap = await explodeRecipe(tx, recipe_id, multiplier);
    } else {
      deltaMap = new Map([[raw_material_id, qty]]);
    }

    const result = await tx.run(
      `INSERT INTO wastage_log
         (raw_material_id, recipe_id, quantity, unit, reason, logged_by, notes, employee_id, shift, photo_url, business_day_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        raw_material_id || null,
        recipe_id || null,
        qty,
        unit || null,
        reason || 'other',
        logged_by || null,
        notes || null,
        employee_id || null,
        shift || null,
        photo_url || null,
        businessDayId,
      ]
    );
    const wastageId = result.lastInsertRowid;

    // Ledger writes the quantity, the moving-average-aware cost basis and the
    // stock_movements row in one place.
    const stock = await deductRawMaterials(tx, deltaMap, {
      direction: -1,
      changeType: 'wastage',
      performedBy: logged_by,
      reason: reason || 'other',
      referenceId: wastageId,
      businessDayId,
    });

    // Value the loss at the cost basis the ledger recorded, then post it as a
    // real expense so food cost isn't understated.
    const totalCost = stock.deducted.reduce((sum, d) => sum + Number(d.cost_value || 0), 0);
    await tx.run(`UPDATE wastage_log SET total_cost = ? WHERE id = ?`, [totalCost, wastageId]);

    let expense_id = null;
    if (totalCost > 0) {
      const label = stock.deducted.map((d) => d.name).join(', ') || 'Wastage';
      expense_id = await upsertLinkedExpense(tx, 'wastage', wastageId, {
        description: `Inventory loss — ${label} (${reason || 'other'})`,
        category: 'inventory_loss',
        amount: totalCost,
        notes: notes || null,
        payment_method: 'none',
        logged_by: logged_by || null,
        receipt_url: photo_url || null,
      });
    }

    return { id: wastageId, stock, total_cost: totalCost, expense_id, warnings: stock.warnings };
  });
}

const WASTAGE_SORTS = {
  created_at: 'w.created_at',
  item: 'im.item_name',
  quantity: 'w.quantity',
  reason: 'w.reason',
  cost: 'w.total_cost',
  employee_name: 'e.full_name',
  shift: 'w.shift',
};

const WASTAGE_SEARCH_COLUMNS = ['im.item_name', 'r.name', 'w.reason', 'w.notes', 'w.shift', 'e.full_name', 'u.full_name'];

/** @returns {{ rows: any[], pagination: object }} */
export async function listWastage(
  db,
  { reason, from, to, page = 1, pageSize = 50, exportAll = false, sort = '', dir = 'DESC', search = '' } = {}
) {
  const conditions = ['1=1'];
  const params = [];

  if (reason && reason !== 'all') {
    conditions.push('w.reason = ?');
    params.push(reason);
  }
  if (from) {
    conditions.push("date(w.created_at, '+5 hours', '+45 minutes') >= date(?)");
    params.push(from);
  }
  if (to) {
    conditions.push("date(w.created_at, '+5 hours', '+45 minutes') <= date(?)");
    params.push(to);
  }

  const searchClause = buildSearch(search, WASTAGE_SEARCH_COLUMNS);
  if (searchClause.clause) {
    conditions.push(searchClause.clause);
    params.push(...searchClause.params);
  }

  return paginateQuery(db, {
    // expense_amount replaces what the page used to work out by fetching every
    // inventory_loss expense and matching source_id in the browser.
    columns: `w.*, im.item_name as raw_material_name, r.name as recipe_name,
              u.full_name as logged_by_name, e.full_name as employee_name,
              (SELECT x.amount FROM expenses x
                WHERE x.source_type = 'wastage' AND x.source_id = w.id
                LIMIT 1) AS expense_amount`,
    from: `wastage_log w
      LEFT JOIN inventory_items im ON w.raw_material_id = im.id
      LEFT JOIN recipes r ON w.recipe_id = r.id
      LEFT JOIN users u ON w.logged_by = u.id
      LEFT JOIN users e ON w.employee_id = e.id`,
    where: conditions.join(' AND '),
    params,
    orderBy: resolveOrderBy(sort, dir, WASTAGE_SORTS, 'created_at', 'w.id'),
    page,
    pageSize,
    exportAll,
  });
}
