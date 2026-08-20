import MenuBrowser from '@/components/public/menu-browser';
import { getPublicDeliveryPricing, getPublicMenuCategories } from '@/lib/public-menu';
import { RESTAURANT } from '@/lib/restaurant-info';
import { getPublicContact, getPublicHome } from '@/lib/public-content';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Menu',
  description:
    'The full menu at Sundar Bagaicha Events, Birendranagar, Surkhet — Nepali kitchen, bar and café with live prices.',
  alternates: { canonical: '/menu' },
};

export default async function MenuPage() {
  let categories = [];
  let contact = { whatsappNumber: RESTAURANT.whatsappNumber };
  let deliveryPricing = { enabled: false, mode: 'fixed', fixedFee: 0, bands: [] };
  let home = { menuTitle: 'Our Menu', menuLead: '' };
  try {
    [categories, contact, deliveryPricing, home] = await Promise.all([
      getPublicMenuCategories(), getPublicContact(), getPublicDeliveryPricing(), getPublicHome(),
    ]);
  } catch {
    categories = [];
  }

  const itemCount = categories.reduce((n, c) => n + c.items.length, 0);

  return (
    <>
      <section className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10 pt-10 pb-2">
        <h1 className="dsp-display text-3xl font-bold sm:text-4xl" style={{ color: 'var(--dsp-ink)' }}>{home.menuTitle || 'Our Menu'}</h1>
        <p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--dsp-muted)' }}>
          {itemCount > 0
            ? (home.menuLead || `${itemCount} dishes across ${categories.length} categories — biryani, momo, sekuwa, coffee, snacks and fast food, served fresh at our counter in Surkhet.`)
            : 'Our menu is being updated. Please check back shortly, or contact us for today’s dishes.'}
        </p>
      </section>

      {categories.length > 0 ? (
        <MenuBrowser categories={categories} whatsappNumber={contact.whatsappNumber} deliveryPricing={deliveryPricing} />
      ) : (
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10 py-16 text-center">
          <p className="text-sm" style={{ color: 'var(--dsp-muted)' }}>
            Menu unavailable right now. Call{' '}
            <a href={`tel:${RESTAURANT.phoneE164}`} className="font-semibold underline" style={{ color: 'var(--dsp-brand)' }}>
              {RESTAURANT.phoneDisplay}
            </a>.
          </p>
        </div>
      )}
    </>
  );
}
