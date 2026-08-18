import { Phone, MessageCircle, Mail, MapPin, Facebook, Music2 } from 'lucide-react';
import { RESTAURANT } from '@/lib/restaurant-info';
import { getPublicContact } from '@/lib/public-content';

export const metadata = {
  title: 'Contact',
  description: `Contact ${RESTAURANT.name} in Birendranagar, Surkhet. Call ${RESTAURANT.phoneDisplay} or message on WhatsApp.`,
  alternates: { canonical: '/contact' },
};

// Contact details are CMS-managed (Website CMS → Contact), with the approved
// restaurant-info constant as a guaranteed fallback.
export default async function ContactPage() {
  const info = await getPublicContact();
  // Skip empty email row when no address is configured.
  const rows = [
    { icon: Phone, label: 'Phone', value: info.phoneDisplay, href: info.hrefs.tel },
    { icon: MessageCircle, label: 'WhatsApp', value: info.phoneDisplay, href: info.hrefs.whatsapp, external: true },
    info.email ? { icon: Mail, label: 'Email', value: info.email, href: info.hrefs.mailto } : null,
    { icon: MapPin, label: 'Address', value: info.location, href: info.hrefs.directions, external: true },
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10 py-14">
      <h1 className="dsp-display font-bold text-3xl sm:text-4xl mb-8" style={{ color: 'var(--dsp-ink)' }}>Contact &amp; location</h1>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          {rows.map((r) => (
            <a key={r.label} href={r.href} {...(r.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
               className="flex items-start gap-4 rounded-2xl p-5 border transition-colors dsp-focus hover:shadow-sm"
               style={{ borderColor: 'var(--dsp-border)', background: 'var(--dsp-surface)' }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ background: 'var(--dsp-brand)' }}>
                <r.icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold" style={{ color: 'var(--dsp-ink)' }}>{r.label}</p>
                <p className="text-sm break-words" style={{ color: 'var(--dsp-muted)' }}>{r.value}</p>
              </div>
            </a>
          ))}

          {(info.social.facebook || info.social.tiktok) && (
          <div className="flex gap-3 pt-1">
            {info.social.facebook ? (
            <a href={info.social.facebook} target="_blank" rel="noopener noreferrer"
               className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold border dsp-focus"
               style={{ borderColor: 'var(--dsp-border)', color: 'var(--dsp-ink)' }} aria-label={`${RESTAURANT.name} on Facebook`}>
              <Facebook className="w-5 h-5" /> Facebook
            </a>
            ) : null}
            {info.social.tiktok ? (
            <a href={info.social.tiktok} target="_blank" rel="noopener noreferrer"
               className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold border dsp-focus"
               style={{ borderColor: 'var(--dsp-border)', color: 'var(--dsp-ink)' }} aria-label={`${RESTAURANT.name} on TikTok`}>
              <Music2 className="w-5 h-5" /> TikTok
            </a>
            ) : null}
          </div>
          )}
        </div>

        <div className="rounded-2xl overflow-hidden border min-h-[360px]" style={{ borderColor: 'var(--dsp-border)' }}>
          <iframe
            src={info.mapEmbedSrc}
            title={`Map to ${RESTAURANT.name}`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="w-full h-full min-h-[360px]"
            style={{ border: 0 }}
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}
