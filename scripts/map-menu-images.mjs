/**
 * Attach the dish photographs in /public/images/dishes to menu items.
 *
 * Two ways a photo is matched, and one way it deliberately is not:
 *
 *   1. EXACT NAME. "Chicken Sekuwa.jpg" is the photo for Chicken Sekuwa.
 *      Punctuation, case and spacing are ignored, so "Veg. Fried Rice.jpg"
 *      finds Veg Fried Rice.
 *
 *   2. ALIASES below, for the same dish spelled differently — Chhoila/Choila,
 *      Chowmin/Chowmein, Thupka/Thukpa, Pakoda/Pakauda, Shadeko/Sadheko,
 *      Kaju/Cashewnut. Each entry is a transliteration or wording variant of
 *      the SAME dish, never a substitution of a similar one.
 *
 *   3. NOT MATCHED: a photo of a different dish. The pack contains Jhol Momo,
 *      pizzas, Chicken Shapta, Dragon Chicken, lassi and matka biryani sizes
 *      that this menu does not sell. Those stay unused rather than being put on
 *      the nearest-sounding item, because a wrong photo on a menu is worse than
 *      no photo: the customer orders what they saw.
 *
 * FOUR FILES ARE EXCLUDED BY NAME. The original four photographs were opened
 * and looked at, and none of them shows what its filename says:
 *
 *   chatamari.jpg       a whole roast chicken in a cast-iron pan
 *   chicken-chilly.jpg  breaded fried chicken strips with a mayo dip
 *   chicken-momo.jpg    byte-identical to chicken-chilly.jpg
 *   fry-momo.jpg        an avocado and vegetable salad bowl
 *
 * Left in, "chicken-chilly.jpg" would become the photo for Chicken Chilly — a
 * saucy stir-fry — on a name match alone. They are listed in MISLABELLED and
 * re-entered under CURATED only where a dish genuinely looks like them.
 *
 * Usage:
 *   node --env-file-if-exists=.env scripts/map-menu-images.mjs [--dry-run]
 *
 * Re-runnable: it clears the photos it manages (anything under
 * /images/dishes) before reassigning, so deleting an entry here removes that
 * photo from the menu on the next run. A photo set by hand elsewhere in the
 * admin is never touched.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from '../lib/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DISH_DIR = path.join(ROOT, 'public', 'images', 'dishes');
const PUBLIC_PREFIX = '/images/dishes';
const DRY = process.argv.includes('--dry-run');

/** Filenames that do not describe their contents — never matched by name. */
const MISLABELLED = new Set(['chatamari.jpg', 'chicken-chilly.jpg', 'chicken-momo.jpg', 'fry-momo.jpg']);

/**
 * Menu item name -> photo filename, for the same dish under another spelling.
 * If the two names are not the same dish, it does not belong here.
 */
const ALIASES = {
  // Breakfast
  'Aalu Paratha': 'Aloo Paratha.jpg',
  'Plain Paratha Set': 'Plain Paratha.jpg',
  'Veg Burger': 'Veg Burgar.jpg',
  // Snacks
  'Kaju Fry': 'Cashewnut Fry.jpg',
  'Peanuts Sadheko': 'Peanut Shadeko.jpg',
  'Veg Pakauda': 'Veg. Pakoda.jpg',
  'Paneer Pakauda': 'Paneer Pakoda.jpg',
  'Fruits Salad': 'Fruit Platter.jpg',
  // Momo
  'Chicken Fry Momo': 'Chcken Fried Momo.jpg',
  'Chicken Chilly / C-Momo': 'Chicken C Momo.jpg',
  // Chicken
  'Chicken Fry Sadheko': 'Chicken Shadeko BoiledFried.jpg',
  'Chicken Sausage': 'Saussage FriedBoiled.jpg',
  // Mutton
  'Mutton Fry Sadheko': 'Mutton Shadeko BoiledFried.jpg',
  'Mutton Tas': 'Mutton Tass Set.jpg',
  // Choila
  'Local Chicken Choila': 'Chicken Chhoila.jpg',
  'Mutton Choila Fry': 'Mutton Chhoila.jpg',
  // Noodles
  'Chicken Chowmein': 'Chicken Chowmin.jpg',
  'Egg Chowmein': 'Egg Chowmin.jpg',
  'Veg Chowmein': 'Veg. Chowmin.jpg',
  'Chicken Thukpa': 'Chicken Thupka.jpg',
  'Veg Thukpa': 'Veg. Thupka.jpg',
  // Rice
  'Mixed Fried Rice': 'Mix Fried Rice.jpg',
  // Soups
  'Hot and Sour Soup': 'Chicken Hot N Sour.jpg',
  // Tea & coffee
  'Black Coffee': 'Black Coffee Nascoffe.webp',
  'Milk Coffee': 'Milk Coffee Nascoffe.jpg',
  'Milk Tea': 'Milk Masala Tea.webp',
  'Cafe Latte / Honey Latte': 'Café latte.jpg',
  'Hot Lemon with Honey': 'Hot Lemon Honey.jpg',
  // Soft drinks
  'Coke / Fanta / Sprite': 'Cold Drinks.jpg',
  'Choco / Vanilla / Strawberry / Oreo Shake': 'Chocolate Milkshake.jpg',
  'Strawberry / Banana / Mango Shake': 'Banana Milkshake.jpg',
  'Fresh Lime Soda': 'Lamonade.jpg',
  'Mint Mojito': 'Virgin Mojito.jpg',
};

/**
 * The mislabelled four, re-entered against a dish that genuinely looks like
 * the photograph. `shows` is the reason each one is defensible.
 */
const CURATED = [
  {
    item: 'Chicken Roast',
    file: 'chatamari.jpg',
    shows: 'a whole roast chicken in a pan; the filename names a dish this menu does not sell',
  },
  {
    item: 'Chicken Lollipop',
    file: 'chicken-chilly.jpg',
    shows: 'breaded fried chicken pieces with a dip, which is what a lollipop plate looks like',
  },
  {
    item: 'Green Salad',
    file: 'fry-momo.jpg',
    shows: 'a fresh vegetable and avocado salad bowl, not a fried momo',
  },
];

const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/\.(jpe?g|png|webp)$/i, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const sha1 = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

async function main() {
  if (!fs.existsSync(DISH_DIR)) {
    console.error(`No dish photographs found: ${DISH_DIR} does not exist.`);
    process.exit(1);
  }
  const files = fs.readdirSync(DISH_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  const named = files.filter((f) => !/^WhatsApp/i.test(f));
  console.log(`${files.length} photograph(s) in ${PUBLIC_PREFIX} (${named.length} usable, ${files.length - named.length} unnamed WhatsApp exports)`);

  // Identical bytes under two names would show one photo as two dishes.
  const byHash = new Map();
  for (const f of named) {
    const h = sha1(path.join(DISH_DIR, f));
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(f);
  }
  const duplicates = [...byHash.values()].filter((g) => g.length > 1);
  for (const group of duplicates) console.log(`  duplicate image under ${group.length} names: ${group.join(', ')}`);

  const db = Database.getInstance();
  const items = await db.all('SELECT id, name FROM menu_items ORDER BY id');
  const byItemName = new Map(items.map((i) => [norm(i.name), i]));
  const byFileName = new Map();
  for (const f of named) {
    if (MISLABELLED.has(f)) continue;
    if (!byFileName.has(norm(f))) byFileName.set(norm(f), f);
  }

  if (!DRY) {
    await db.run('UPDATE menu_items SET image_url = NULL WHERE image_url LIKE ?', [`${PUBLIC_PREFIX}/%`]);
  }

  const usedFiles = new Set();
  const usedItems = new Set();
  const problems = [];
  const assign = async (item, file, how) => {
    if (usedFiles.has(file)) {
      problems.push(`"${file}" is already used by another dish — ${item.name} skipped`);
      return false;
    }
    if (usedItems.has(item.id)) {
      problems.push(`${item.name} already has a photo — "${file}" skipped`);
      return false;
    }
    usedFiles.add(file);
    usedItems.add(item.id);
    if (!DRY) await db.run('UPDATE menu_items SET image_url = ? WHERE id = ?', [`${PUBLIC_PREFIX}/${file}`, item.id]);
    console.log(`  ${how.padEnd(8)} ${item.name}  <-  ${file}`);
    return true;
  };

  let assigned = 0;

  // 1. curated first, so a deliberate choice always wins the file
  for (const entry of CURATED) {
    const item = byItemName.get(norm(entry.item));
    if (!item) { problems.push(`no menu item named "${entry.item}"`); continue; }
    if (!named.includes(entry.file)) { problems.push(`"${entry.file}" is not in ${PUBLIC_PREFIX}`); continue; }
    if (await assign(item, entry.file, 'curated')) {
      console.log(`           shows ${entry.shows}`);
      assigned += 1;
    }
  }

  // 2. aliases
  for (const [itemName, file] of Object.entries(ALIASES)) {
    const item = byItemName.get(norm(itemName));
    if (!item) { problems.push(`alias target "${itemName}" is not on the menu`); continue; }
    if (!named.includes(file)) { problems.push(`alias file "${file}" is not in ${PUBLIC_PREFIX}`); continue; }
    if (await assign(item, file, 'alias')) assigned += 1;
  }

  // 3. exact name, for anything a deliberate choice has not already claimed
  for (const item of items) {
    if (usedItems.has(item.id)) continue;
    const file = byFileName.get(norm(item.name));
    if (!file || usedFiles.has(file)) continue;
    if (await assign(item, file, 'exact')) assigned += 1;
  }

  const unused = named.filter((f) => !usedFiles.has(f));
  console.log(`\n${DRY ? '[DRY RUN] ' : ''}${assigned} of ${items.length} menu items have a photograph.`);
  console.log(`${unused.length} photograph(s) unused — they show dishes this menu does not sell, or duplicate one already assigned:`);
  console.log(`  ${unused.join(', ') || 'none'}`);
  if (problems.length) {
    console.log('Problems:');
    for (const p of problems) console.log(`  - ${p}`);
  }
  console.log(`\n${items.length - assigned} items still show the branded fallback tile.`);
  if (Database.close) await Database.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
