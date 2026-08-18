import { Fraunces, Manrope } from 'next/font/google';
import PublicShell from '@/components/public/public-shell';

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

export default function PublicLayout({ children }) {
  return (
    <div
      className={`dsp-site ${display.variable} ${sans.variable}`}
      style={{
        // Bind loaded fonts to the tokens the theme uses.
        ['--font-display']: 'var(--font-fraunces), Georgia, serif',
        fontFamily: 'var(--font-manrope), ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <PublicShell>{children}</PublicShell>
    </div>
  );
}
