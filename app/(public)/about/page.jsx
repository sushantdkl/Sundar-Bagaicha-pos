import Link from 'next/link';
import { UtensilsCrossed, MapPin, Zap, Coffee, Store } from 'lucide-react';
import { RESTAURANT, directionsHref, telHref } from '@/lib/restaurant-info';
import DishImage from '@/components/public/dish-image';
import { getPublicAbout, getPublicContact } from '@/lib/public-content';

export const metadata = {
  title: 'About',
  description: `About ${RESTAURANT.name} — restaurant and party venue in Birendranagar, Surkhet.`,
  alternates: { canonical: '/about' },
};

const FEATURE_ICONS = [Zap, UtensilsCrossed, Coffee, Store];

export default async function AboutPage() {
  const [about, contact] = await Promise.all([getPublicAbout(), getPublicContact()]);
  if (about.visible === false) {
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-16 text-center">
        <p style={{ color: 'var(--dsp-muted)' }}>About page is currently hidden.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10 py-12">
      <div className="grid items-center gap-8 lg:grid-cols-2">
        <div>
          <h1 className="dsp-display text-4xl font-bold leading-tight sm:text-5xl" style={{ color: 'var(--dsp-ink)' }}>{about.heading}</h1>
          <div className="mt-5 space-y-4 text-[15px] leading-relaxed">
            <p style={{ color: 'var(--dsp-ink)' }}>{about.description}</p>
            {about.descriptionExtra && (
              <p style={{ color: 'var(--dsp-muted)' }}>{about.descriptionExtra}</p>
            )}
          </div>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/menu" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 font-semibold text-white dsp-focus" style={{ background: 'var(--dsp-brand)' }}>
              <UtensilsCrossed className="h-5 w-5" /> View our menu
            </Link>
            <a href={directionsHref()} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-2 rounded-xl border px-5 py-3 font-semibold dsp-focus" style={{ borderColor: 'var(--dsp-border)', color: 'var(--dsp-ink)' }}>
              <MapPin className="h-5 w-5" /> Get directions
            </a>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--dsp-border)' }}>
          <DishImage src={about.image} alt={RESTAURANT.name} rounded="" className="h-72 w-full sm:h-[26rem]" />
        </div>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {about.features.map((f, i) => {
          const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
          return (
            <div key={`${f.title}-${i}`} className="rounded-2xl border p-5" style={{ borderColor: 'var(--dsp-border)', background: 'var(--dsp-surface)' }}>
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: 'var(--dsp-brand)' }}>
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="dsp-display font-bold" style={{ color: 'var(--dsp-ink)' }}>{f.title}</h3>
              <p className="mt-1 text-sm" style={{ color: 'var(--dsp-muted)' }}>{f.text}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--dsp-border)' }}>
          <iframe src={contact.mapEmbedSrc} title={`Map to ${about.heading}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                  className="h-72 w-full lg:h-full lg:min-h-[300px]" style={{ border: 0 }} allowFullScreen />
        </div>
        <div className="flex flex-col justify-center gap-3 rounded-2xl border p-6" style={{ borderColor: 'var(--dsp-border)', background: 'var(--dsp-surface)' }}>
          <h2 className="dsp-display text-2xl font-bold" style={{ color: 'var(--dsp-ink)' }}>{about.visitHeading}</h2>
          <p className="flex items-start gap-2 text-sm" style={{ color: 'var(--dsp-muted)' }}>
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--dsp-brand)' }} /> {contact.location}
          </p>
          <a href={telHref()} className="text-sm font-semibold dsp-focus" style={{ color: 'var(--dsp-brand)' }}>{contact.phoneDisplay}</a>
        </div>
      </div>
    </div>
  );
}
