/**
 * Website CMS store.
 *
 * Content is persisted in the existing key/value `system_settings` table under
 * `cms_<section>` keys (JSON) — no new content engine. Uploaded image metadata
 * lives in a small `cms_media` table. Menu prices are intentionally NOT managed
 * here; the public menu keeps reading the POS menu source.
 *
 * Defaults are pre-filled from the approved public-site copy + `public/images/`
 * assets so the admin CMS opens with the live site content already populated.
 * Those `/images/...` paths ship with the app (and cPanel deploy); new uploads
 * go to persistent UPLOADS_DIR/cms and are served at `/uploads/cms/...`.
 */

import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { RESTAURANT } from '@/lib/restaurant-info.js';
import {
  HERO, SIGNATURE_ITEMS, POPULAR_CATEGORIES, GALLERY, STOREFRONT,
} from '@/lib/public-gallery.js';

export const CMS_SECTIONS = ['brand', 'home', 'about', 'gallery', 'contact', 'seo'];

function settingsFallback(db) {
  return db.get(
    `SELECT
       MAX(CASE WHEN setting_key='restaurant_name' THEN setting_value END) AS name,
       MAX(CASE WHEN setting_key='restaurant_address' THEN setting_value END) AS address,
       MAX(CASE WHEN setting_key='restaurant_phone' THEN setting_value END) AS phone,
       MAX(CASE WHEN setting_key='restaurant_email' THEN setting_value END) AS email
     FROM system_settings`
  );
}

/** Deep-merge so older saved CMS JSON still picks up new default fields. */
export function deepMerge(base, override) {
  if (override == null) return base;
  if (Array.isArray(base) || Array.isArray(override)) {
    if (Array.isArray(override) && override.length === 0 && Array.isArray(base) && base.length) return base;
    return override;
  }
  if (typeof base !== 'object' || typeof override !== 'object') {
    if (override === '' && base) return base;
    return override !== undefined && override !== null ? override : base;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (k.startsWith('_')) {
      out[k] = v;
      continue;
    }
    out[k] = deepMerge(base[k], v);
  }
  return out;
}

function defaults(base = {}) {
  return {
    brand: {
      businessName: base.name || RESTAURANT.name,
      shortName: RESTAURANT.shortName,
      tagline: RESTAURANT.tagline,
      logo: RESTAURANT.logo,
      favicon: '/favicon.ico',
      email: base.email || RESTAURANT.email,
      phone: base.phone || RESTAURANT.phoneDisplay,
      // Never derive WhatsApp from the display phone: the business lists a
      // landline and a mobile together ("083-590893 / 9848293693"), and
      // stripping non-digits from that concatenates into an invalid number.
      whatsapp: base.whatsapp || RESTAURANT.whatsappNumber,
      location: base.address || RESTAURANT.address.full,
      mapEmbed: RESTAURANT.mapEmbedSrc,
      social: {
        facebook: RESTAURANT.social.facebook,
        instagram: '',
        tiktok: RESTAURANT.social.tiktok,
      },
    },
    home: {
      heroHeadingLine1: 'सुन्दर बगैँचा',
      heroHeadingLine2: 'Sundar Bagaicha Events',
      heroHeadingLine3: 'Restaurant & party venue.',
      heroDescription: RESTAURANT.intro,
      heroImage: HERO.main.src,
      heroImageAlt: HERO.main.alt,
      heroInsetImage: HERO.inset.src,
      heroInsetAlt: HERO.inset.alt,
      heroBadgeValue: '197',
      heroBadgeLabel: 'dishes on the menu',
      heroEyebrow: 'Dine-in · Events · 12 Bhabhar, Birendranagar, Surkhet',
      primaryCta: { label: 'View Menu', href: '/menu' },
      secondaryCta: { label: 'WhatsApp', href: 'whatsapp' },
      tertiaryCta: { label: 'Call', href: 'tel' },

      popularTitle: 'Popular categories',
      popularLead: 'What the kitchen is known for.',
      popularCategories: POPULAR_CATEGORIES.map((c) => ({
        title: c.title,
        note: c.note || '',
        img: c.img || '',
        href: '/menu',
      })),

      signatureTitle: 'Signature dishes',
      signatureLead: 'Straight from our kitchen.',
      signatureItems: SIGNATURE_ITEMS.map((it) => ({
        name: it.name,
        category: it.category || '',
        img: it.img || '',
        href: '/menu',
      })),

      howItWorksTitle: 'How it works',
      howItWorksLead: 'Dining and celebrations in one garden venue.',
      howItWorksSteps: [
        { title: 'Book a table', text: 'Reserve online, or call the venue for larger parties.' },
        { title: 'Dine in the garden', text: 'Snacks, momo, sekuwa, choila, biryani and a full bar.' },
        { title: 'Host your event', text: 'Weddings, conferences, birthdays and DJ nights.' },
      ],

      menuTitle: 'On the menu',
      menuLead: 'Live prices, straight from our POS.',
      menuCtaLabel: 'Full menu',
      menuCtaHref: '/menu',

      aboutStripTitle: 'A garden venue in Birendranagar',
      aboutStripText:
        'At 12 Bhabhar, Birendranagar, we serve Nepali and continental favourites — snacks, momo, sekuwa, choila, biryani, thali and a full bar — and host weddings, conferences and private parties.',
      aboutStripImage: STOREFRONT[1]?.src || RESTAURANT.storefront[1],
      aboutStripImageAlt: STOREFRONT[1]?.alt || 'Sundar Bagaicha Events',
      aboutStripCtaLabel: 'More about us',
      aboutStripCtaHref: '/about',

      galleryTitle: 'Gallery',
      galleryCtaLabel: 'See more',
      galleryCtaHref: '/gallery',
      galleryLimit: 6,

      findUsTitle: 'Find us',
      findUsLead: '12 Bhabhar, Birendranagar, Surkhet — open daily 10:00 AM – 10:00 PM.',

      sections: {
        hero: true,
        popular: true,
        signature: true,
        howItWorks: true,
        menu: true,
        about: true,
        gallery: true,
        findUs: true,
      },
    },
    about: {
      heading: RESTAURANT.name,
      description: RESTAURANT.intro,
      descriptionExtra:
        'Located at 12 Bhabhar, Birendranagar in Surkhet and established in 2025, Sundar Bagaicha Events is a restaurant and party venue. The kitchen covers snacks and sadheko, momo, noodles and thukpa, fried rice, chicken and mutton specialities, traditional choila, royal biryani, khana sets and curries, alongside desserts, tea and coffee and a full bar.',
      images: [STOREFRONT[0]?.src || RESTAURANT.storefront[0], STOREFRONT[1]?.src || RESTAURANT.storefront[1]],
      features: [
        { title: 'Event venue', text: 'Weddings, conferences, birthdays and DJ nights.' },
        { title: 'Wide menu', text: '197 dishes across 20 categories, from choila to cocktails.' },
        { title: 'Full bar', text: 'Beer, wine, domestic and imported spirits.' },
        { title: 'Open daily', text: '10:00 AM – 10:00 PM, 365 days a year.' },
      ],
      visitHeading: 'Visit us',
      visible: true,
    },
    gallery: {
      heading: 'Gallery',
      lead: 'Food and venue photos from Sundar Bagaicha Events.',
      items: GALLERY.map((src, i) => ({
        url: src,
        title: '',
        alt: 'Sundar Bagaicha Events',
        order: i,
        visible: true,
      })),
    },
    contact: {
      phone: base.phone || RESTAURANT.phoneDisplay,
      whatsapp: RESTAURANT.whatsappNumber,
      email: base.email || RESTAURANT.email,
      location: base.address || RESTAURANT.address.full,
      mapEmbed: RESTAURANT.mapEmbedSrc,
      social: {
        facebook: RESTAURANT.social.facebook,
        instagram: '',
        tiktok: RESTAURANT.social.tiktok,
      },
    },
    seo: {
      title: 'Sundar Bagaicha Events | Restaurant & Party Venue | Surkhet',
      description: RESTAURANT.intro,
      ogImage: RESTAURANT.storefront[0],
      canonical: '',
    },
  };
}

export async function ensureCmsSchema(db) {
  await ensureSqliteTable(
    db,
    `CREATE TABLE IF NOT EXISTS cms_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      title TEXT,
      alt TEXT,
      section TEXT,
      width INTEGER,
      height INTEGER,
      size INTEGER,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
}

async function readSetting(db, key) {
  const row = await db.get('SELECT setting_value FROM system_settings WHERE setting_key = ?', [key]);
  if (!row || row.setting_value == null) return null;
  try {
    return JSON.parse(row.setting_value);
  } catch {
    return null;
  }
}

async function writeSetting(db, key, value) {
  const json = JSON.stringify(value);
  const existing = await db.get('SELECT id FROM system_settings WHERE setting_key = ?', [key]);
  if (existing) {
    await db.run('UPDATE system_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?', [json, key]);
  } else {
    await db.run('INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)', [key, json]);
  }
}

/** Full CMS content with defaults merged in for any unset section. */
export async function getCmsContent(db) {
  const base = (await settingsFallback(db).catch(() => null)) || {};
  const def = defaults(base);
  const out = {};
  for (const section of CMS_SECTIONS) {
    const stored = await readSetting(db, `cms_${section}`);
    out[section] = stored ? deepMerge(def[section], stored) : def[section];
  }
  return out;
}

export async function getCmsSection(db, section) {
  const all = await getCmsContent(db);
  return all[section] || null;
}

export async function setCmsSection(db, section, data, actorId = null) {
  if (!CMS_SECTIONS.includes(section)) {
    throw Object.assign(new Error('Unknown CMS section'), { status: 400 });
  }
  const payload = { ...data, _updatedBy: actorId, _updatedAt: new Date().toISOString() };
  await writeSetting(db, `cms_${section}`, payload);
  return payload;
}

/** Media library ------------------------------------------------------- */
export async function listMedia(db, { section = null } = {}) {
  await ensureCmsSchema(db);
  if (section) {
    return db.all('SELECT * FROM cms_media WHERE section = ? ORDER BY created_at DESC', [section]);
  }
  return db.all('SELECT * FROM cms_media ORDER BY created_at DESC');
}

export async function addMedia(db, { url, title = null, alt = null, section = null, width = null, height = null, size = null, uploaded_by = null }) {
  await ensureCmsSchema(db);
  const res = await db.run(
    `INSERT INTO cms_media (url, title, alt, section, width, height, size, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [url, title, alt, section, width, height, size, uploaded_by]
  );
  return db.get('SELECT * FROM cms_media WHERE id = ?', [res.lastID]);
}

/** True if a media URL is still referenced anywhere in CMS content. */
export async function isMediaReferenced(db, url) {
  const content = await getCmsContent(db);
  return JSON.stringify(content).includes(url);
}

export async function deleteMedia(db, id, { force = false } = {}) {
  await ensureCmsSchema(db);
  const row = await db.get('SELECT * FROM cms_media WHERE id = ?', [id]);
  if (!row) throw Object.assign(new Error('Media not found'), { status: 404 });
  if (!force && (await isMediaReferenced(db, row.url))) {
    throw Object.assign(new Error('This image is still used in published content. Confirm to remove it anyway.'), {
      status: 409,
      referenced: true,
    });
  }
  await db.run('DELETE FROM cms_media WHERE id = ?', [id]);
  return { deleted: true, url: row.url };
}
