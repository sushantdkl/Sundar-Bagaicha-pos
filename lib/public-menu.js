import { MenuRepository } from '@/lib/db/repositories/menu.js'
import { formatMenuPrice } from '@/lib/menu-format.js'
import Database from '@/lib/db/index.js'
import { loadDeliveryPricing } from '@/lib/delivery-pricing.js'

export { formatMenuPrice }

export async function getPublicDeliveryPricing() {
  return loadDeliveryPricing(Database.getInstance())
}

function slugify(name, id) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return base || `category-${id}`
}

function mapDiet(item) {
  if (item.is_vegetarian === 1 || item.is_vegetarian === true || item.is_veg === 1) {
    return 'veg'
  }
  return 'nonveg'
}

function mapImage(url) {
  if (!url) return null
  const s = String(url).trim()
  if (!s) return null
  return s
}

/**
 * Build the public /menu payload from the same menu_items + menu_categories
 * tables the admin panel uses. Only available items in active categories.
 */
export async function getPublicMenuCategories() {
  const menuRepo = new MenuRepository()

  let categories = []
  let items = []

  try {
    categories = await menuRepo.getCategories()
  } catch (e) {
    console.error('getPublicMenuCategories categories:', e)
    categories = []
  }

  try {
    items = await menuRepo.getAllItems({ available: true })
  } catch (e) {
    console.error('getPublicMenuCategories items:', e)
    items = []
  }

  // Attach variants (e.g. Boiled/Fried) so the public menu shows their prices.
  const variantsByItem = new Map()
  try {
    const rows = await menuRepo.db.all(`
      SELECT v.menu_item_id, v.variant_name, v.price, v.price_modifier, v.is_default, mi.base_price
      FROM menu_item_variants v
      JOIN menu_items mi ON mi.id = v.menu_item_id
      WHERE mi.is_available = 1
      ORDER BY v.is_default DESC, COALESCE(v.price, mi.base_price + v.price_modifier)
    `)
    for (const r of rows || []) {
      const key = r.menu_item_id
      if (!variantsByItem.has(key)) variantsByItem.set(key, [])
      variantsByItem.get(key).push({
        name: r.variant_name,
        price: r.price != null ? Number(r.price) : Number(r.base_price) + Number(r.price_modifier || 0),
      })
    }
  } catch (e) {
    console.error('getPublicMenuCategories variants:', e)
  }

  const byCategoryId = new Map()
  for (const item of items) {
    const cid = item.category_id
    if (!byCategoryId.has(cid)) byCategoryId.set(cid, [])
    const itemId = item.item_id || item.id
    byCategoryId.get(cid).push({
      id: String(itemId),
      name: item.item_name || item.name,
      description: item.description || '',
      price: Number(item.price ?? item.base_price) || 0,
      diet: mapDiet(item),
      image: mapImage(item.image_url),
      variants: variantsByItem.get(itemId) || [],
      chefRecommend: false,
    })
  }

  return categories
    .map((cat) => {
      const list = byCategoryId.get(cat.id) || []
      if (list.length === 0) return null
      return {
        id: slugify(cat.name, cat.id),
        title: cat.name,
        subtitle: cat.description || 'From our kitchen',
        items: list,
      }
    })
    .filter(Boolean)
}
