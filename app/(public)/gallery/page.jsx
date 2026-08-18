import { RESTAURANT } from '@/lib/restaurant-info';
import { getPublicGallery } from '@/lib/public-content';

export const metadata = {
  title: 'Gallery',
  description: `Photos from ${RESTAURANT.name} — storefront and dishes.`,
  alternates: { canonical: '/gallery' },
};

export const dynamic = 'force-dynamic';

export default async function GalleryPage() {
  const gallery = await getPublicGallery();
  return (
    <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10 py-14">
      <h1 className="dsp-display font-bold text-3xl sm:text-4xl mb-2" style={{ color: 'var(--dsp-ink)' }}>{gallery.heading}</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--dsp-muted)' }}>{gallery.lead}</p>

      <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 [column-fill:_balance]">
        {gallery.items.map((img, i) => (
          <div key={`${img.url}-${i}`} className="mb-3 break-inside-avoid overflow-hidden rounded-xl border" style={{ borderColor: 'var(--dsp-border)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={img.alt || img.title || RESTAURANT.name} loading="lazy" className="w-full object-cover" />
          </div>
        ))}
      </div>

      <p className="text-xs mt-8" style={{ color: 'var(--dsp-muted)' }}>
        Photos provided by the restaurant. Menu availability may vary.
      </p>
    </div>
  );
}
