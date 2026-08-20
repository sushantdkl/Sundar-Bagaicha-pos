import { Fraunces, Manrope } from 'next/font/google';
import PublicShell from '@/components/public/public-shell';
import { getPublicBrand, getPublicContact, getPublicLanding } from '@/lib/public-content';

const display = Fraunces({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-fraunces',
  display: 'swap',
});

const sans = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-manrope',
  display: 'swap',
});

export default async function PublicLayout({ children }) {
  const [brand, contact, landing] = await Promise.all([getPublicBrand(), getPublicContact(), getPublicLanding()]);
  return (
    <div
      className={`dsp-site ${display.variable} ${sans.variable}`}
      style={{
        // Bind loaded fonts to the tokens the theme uses.
        ['--font-display']: 'var(--font-fraunces), Georgia, serif',
        ['--dsp-bg']: '#0d1a0d',
        ['--dsp-surface']: '#152015',
        ['--dsp-brand']: '#9b7425',
        ['--dsp-brand-dark']: '#e8d48b',
        ['--dsp-accent']: '#c5a55a',
        ['--dsp-ink']: '#fefcf3',
        ['--dsp-muted']: '#c7bea7',
        ['--dsp-border']: '#344434',
        ['--dsp-success']: '#74b995',
        ['--dsp-danger']: '#e07a6d',
        fontFamily: 'var(--font-manrope), ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <PublicShell brand={brand} contact={contact} landing={landing}>{children}</PublicShell>
    </div>
  );
}
