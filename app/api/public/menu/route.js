import { NextResponse } from 'next/server'
import { getPublicDeliveryPricing, getPublicMenuCategories } from '@/lib/public-menu.js'

/** Public menu for the website — same data as admin products / menu_items */
export async function GET() {
  try {
    const [categories, deliveryPricing] = await Promise.all([getPublicMenuCategories(), getPublicDeliveryPricing()])
    return NextResponse.json(
      { categories, deliveryPricing, count: categories.reduce((n, c) => n + c.items.length, 0) },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      }
    )
  } catch (error) {
    console.error('Public menu GET error:', error)
    return NextResponse.json(
      { error: 'Could not load menu.', categories: [] },
      { status: 500 }
    )
  }
}
