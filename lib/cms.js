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

export const CMS_SECTIONS = ['brand', 'home', 'about', 'gallery', 'landing', 'contact', 'seo'];

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
    landing: {
      navigation: [
        { label: 'About', href: '#about' },
        { label: 'Menu', href: '/menu' },
        { label: 'Events', href: '#events' },
        { label: 'Amenities', href: '#amenities' },
        { label: 'Reviews', href: '#reviews' },
        { label: 'Reserve', href: '#reserve' },
        { label: 'Location', href: '#location' },
      ],
      staffLabel: 'Staff',
      staffHref: '/login',
      heroStats: [
        { value: '1+', label: 'Years Operating' },
        { value: '500+', label: 'Happy Guests' },
        { value: '7', label: 'Event Types' },
      ],
      featureStrip: ['🍽️ Fine Dining', '🎂 Birthday Parties', '💍 Wedding Venue', '🎵 DJ Night', '🏢 Conference Hall', '👨‍👩‍👧 Kids Zone', '🚗 Ample Parking', '🫂 Private Cabins', '🎊 Anniversary Celebrations', '☕ Bakery & Pastry'],
      aboutLabel: 'About Us',
      aboutTitleBefore: "Surkhet's",
      aboutTitleAccent: 'Finest',
      aboutTitleAfter: 'Dining Experience',
      aboutRating: '4.8',
      aboutRatingLabel: 'Google Rating',
      aboutCtaLabel: 'Book Your Experience',
      galleryLabel: 'Gallery',
      galleryTitleBefore: 'See Our',
      galleryTitleAccent: 'World',
      menuLabel: 'Our Menu',
      menuTitleBefore: 'Crafted with',
      menuTitleAccent: 'Passion',
      eventsLabel: 'Events & Occasions',
      eventsTitleBefore: 'We Host',
      eventsTitleAccent: 'Every',
      eventsTitleAfter: 'Celebration',
      eventsLead: 'From intimate gatherings to grand celebrations',
      events: [
        { icon: '💍', title: 'Wedding Party', text: 'Create the wedding of your dreams with our stunning venue, expert planning team, and world-class catering. Your perfect day awaits.' },
        { icon: '🎂', title: 'Birthday Party', text: 'Make every birthday unforgettable with our custom cakes, decorations, entertainment, and dedicated staff to make the birthday star feel truly special.' },
        { icon: '🎵', title: 'DJ Night', text: 'Dance the night away with our premium sound system, professional DJ setups, and vibrant atmosphere designed for the ultimate party experience.' },
        { icon: '💼', title: 'Conference & Meeting', text: 'State-of-the-art conference facilities, audio-visual equipment, and professional catering for corporate events that leave lasting impressions.' },
        { icon: '💞', title: 'Anniversary', text: 'Celebrate years of love with our romantic setups, candlelit dinners, and personalized experiences crafted for couples and families.' },
        { icon: '🍽️', title: 'Fine Dining', text: 'Savor an exceptional culinary journey with our diverse menu of Nepali classics, international cuisine, and expertly crafted dishes.' },
      ],
      amenitiesLabel: 'Facilities',
      amenitiesTitleBefore: 'World-Class',
      amenitiesTitleAccent: 'Amenities',
      amenities: [
        { icon: '🏛️', title: 'Grand Event Hall', text: 'Spacious banquet hall accommodating 50 to 500+ guests. Perfect for weddings, conferences, and large-scale celebrations with state-of-the-art facilities.' },
        { icon: '🚗', title: 'Ample Parking', text: 'Spacious, secure parking area accommodating cars, bikes, and larger vehicles. Stress-free arrival for all your guests.' },
        { icon: '👨‍👩‍👧', title: 'Kids Zone', text: 'A dedicated, safe, and fun play zone designed to keep the little ones entertained while parents enjoy their meals in peace.' },
        { icon: '🫂', title: 'Private Cabins', text: 'Intimate private cabins for families and couples seeking a more personal dining experience with complete privacy and personalized service.' },
        { icon: '🎂', title: 'In-House Bakery', text: 'Freshly baked cakes, pastries, and desserts made daily by our skilled pastry chefs. Custom cakes for every occasion, every size.' },
        { icon: '🌿', title: 'Garden Seating', text: 'Lush garden seating area surrounded by greenery, perfect for outdoor dining, tea breaks, and social gatherings in a natural setting.' },
        { icon: '🎙️', title: 'Event Production', text: 'Professional sound, lighting, and AV setup for concerts, DJ nights, stage performances, and all types of entertainment events.' },
        { icon: '📶', title: 'Free WiFi', text: 'High-speed complimentary WiFi throughout the venue — keep your guests connected throughout their stay and events.' },
      ],
      reviewsLabel: 'Guest Reviews',
      reviewsTitleBefore: 'What Our',
      reviewsTitleAccent: 'Guests',
      reviewsTitleAfter: 'Say',
      reviewsRating: '4.8',
      reviewsCount: 'Based on Google Reviews',
      reviews: [
        { rating: 5, name: 'Ramesh Bhattarai', source: 'Google Review', text: 'Amazing place! The food is incredibly delicious and the ambiance is perfect for family dinners. The staff was very warm and welcoming. Will definitely come back again!' },
        { rating: 5, name: 'Sita Acharya', source: 'Google Review', text: 'We celebrated our anniversary here and it was absolutely magical. The private cabin was beautifully decorated, food was outstanding, and the service exceeded our expectations.' },
        { rating: 5, name: 'Bikash Thapa', source: 'Google Review', text: 'Best restaurant in Surkhet! The traditional choila is excellent. Clean environment, friendly staff, great parking, and a useful kids zone.' },
        { rating: 5, name: 'Kamala Poudel', source: 'Google Review', text: "Hosted my daughter's birthday here — from the custom cake to the DJ setup, everything was perfect. The team was incredibly professional." },
        { rating: 4, name: 'Pradeep Karki', source: 'Google Review', text: 'Great conference facilities. We held our company meeting here and were impressed with the AV setup, catering, and food during breaks.' },
        { rating: 5, name: 'Maya Gurung', source: 'Google Review', text: "The cakes are wonderful. Our custom Red Velvet cake was the highlight of my husband's surprise party." },
      ],
      reservationLabel: 'Reservations',
      reservationTitleBefore: 'Reserve Your',
      reservationTitleAccent: 'Table',
      reservationDescription: 'Book your table in advance and ensure a seamless experience. We recommend reservations for groups of 4 or more.',
      reservationHours: 'Daily: 10:00 AM – 10:00 PM\nOpen 365 days a year',
      reservationFormTitle: 'Make a Reservation',
      reservationButton: 'Confirm Reservation',
      reservationNote: "We'll confirm your booking via phone/WhatsApp within 2 hours",
      reservationSuccessTitle: 'Reservation Received!',
      reservationSuccessMessage: "Thank you! We'll confirm your table via phone or WhatsApp within 2 hours. We look forward to welcoming you.",
      guestOptions: ['1-2 guests', '3-5 guests', '6-10 guests', '11-20 guests', '20-50 guests', '50+ guests'],
      occasionOptions: ['Regular Dining', 'Birthday Party', 'Anniversary', 'Wedding', 'Conference', 'DJ Night', 'Corporate Event', 'Other'],
      locationLabel: 'Find Us',
      locationTitleBefore: 'Visit',
      locationTitleAccent: 'Sundar Bagaicha',
      locationHours: 'Daily: 10:00 AM – 10:00 PM\nOpen 7 days a week · 365 days a year',
      locationEstablished: '2025 · Serving Surkhet',
      inquiryLabel: 'Get in Touch',
      inquiryTitleBefore: 'Send Us an',
      inquiryTitleAccent: 'Inquiry',
      inquiryLead: "We'd love to hear from you. We respond within 24 hours.",
      inquiryButton: 'Send Message',
      inquiryNote: "Your message goes directly to our team · We'll respond within 24 hours",
      inquirySuccessTitle: 'Message Sent!',
      inquirySuccessMessage: 'Thank you for reaching out! Our team will get back to you within 24 hours.',
      inquirySubjects: ['Table Reservation', 'Event Booking', 'Custom Cake Order', 'Wedding Inquiry', 'Conference Booking', 'Feedback', 'Other'],
      footerTagline: "Surkhet's premier restaurant and party venue. Where every gathering becomes an unforgettable memory. Located in the heart of Birendranagar.",
      footerServices: ['Fine Dining', 'Wedding Party', 'Birthday Party', 'DJ Night', 'Conference', 'Bakery & Cakes'],
      footerCopyright: '© 2025 Sundar Bagaicha Events. All rights reserved. Birendranagar, Surkhet, Nepal.',
      footerMotto: '🌿 Where Every Gathering Becomes a Memory 🌿',
      sections: { events: true, amenities: true, reviews: true, reservation: true, location: true, inquiry: true },
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
