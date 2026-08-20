import fs from 'node:fs';
import path from 'node:path';
import { Cormorant_Garamond, Josefin_Sans, Playfair_Display } from 'next/font/google';
import LandingPageReplica from '@/components/public/landing-page-replica';
import Database from '@/lib/db/index';
import { getCmsContent } from '@/lib/cms';
import { getPublicMenuCategories } from '@/lib/public-menu';
import { RESTAURANT } from '@/lib/restaurant-info';

const playfair = Playfair_Display({ subsets: ['latin'], weight: ['400', '700', '900'], style: ['normal', 'italic'], variable: '--font-landing-playfair' });
const cormorant = Cormorant_Garamond({ subsets: ['latin'], weight: ['300', '400', '600'], style: ['normal', 'italic'], variable: '--font-landing-cormorant' });
const josefin = Josefin_Sans({ subsets: ['latin'], weight: ['300', '400', '600', '700'], variable: '--font-landing-josefin' });

export const dynamic = 'force-dynamic';

async function publishedContent() {
  return getCmsContent(Database.getInstance()).catch(() => ({}));
}

export async function generateMetadata() {
  const cms = await publishedContent();
  const seo = cms.seo?._updatedAt ? cms.seo : {};
  return {
    title: seo.title || 'Restaurant & Party Venue | Birendranagar, Surkhet',
    description: seo.description || RESTAURANT.intro,
    alternates: { canonical: seo.canonical || '/' },
    openGraph: seo.ogImage ? { images: [{ url: seo.ogImage }] } : undefined,
  };
}

function extract(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error(`Landing page ${label} could not be loaded.`);
  return match[1];
}

export default async function HomePage() {
  const [cms, menuCategories] = await Promise.all([publishedContent(), getPublicMenuCategories()]);
  const source = fs.readFileSync(path.join(process.cwd(), 'public', 'sundar-bagaicha.html'), 'utf8');
  const styles = extract(source, /<style>([\s\S]*?)<\/style>/i, 'styles')
    .replaceAll("'Playfair Display'", 'var(--font-landing-playfair)')
    .replaceAll("'Cormorant Garamond'", 'var(--font-landing-cormorant)')
    .replaceAll("'Josefin Sans'", 'var(--font-landing-josefin)');
  const body = extract(source, /<body[^>]*>([\s\S]*?)<script>/i, 'markup');
  const behavior = extract(source, /<script>([\s\S]*?)<\/script>/i, 'behavior');

  return <LandingPageReplica styles={styles} markup={body} behavior={behavior} fontClass={`${playfair.variable} ${cormorant.variable} ${josefin.variable}`} cms={cms} menuCategories={menuCategories} />;
}
