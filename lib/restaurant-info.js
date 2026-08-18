/**
 * Central factual identity for Sundar Bagaicha Events.
 *
 * Sourced from the venue's own published landing page and printed menu
 * (public/sundar-bagaicha.html). Do NOT invent opening hours, ratings, email
 * addresses or registration numbers — only verified fields belong here.
 *
 * Live installations override the customer-facing subset (name, address,
 * phone, receipt footer) from `system_settings` via Admin -> Settings; these
 * values are the fallback used before any settings row exists.
 */

export const RESTAURANT = {
  name: 'Sundar Bagaicha Events',
  shortName: 'Sundar Bagaicha',
  tagline: 'Restaurant & party venue in Birendranagar, Surkhet',
  intro:
    'Fine dining, weddings, conferences, birthday parties and DJ nights at Sundar Bagaicha Events, Birendranagar, Surkhet. Established 2025.',
  established: 2025,
  address: {
    line: '12 Bhabhar, Birendranagar',
    city: 'Surkhet',
    postalCode: '',
    country: 'Nepal',
    full: '12 Bhabhar, Birendranagar, Surkhet, Karnali Province, Nepal',
  },
  coords: { lat: 28.596526700000016, lng: 81.6322494789315 },
  phoneDisplay: '083-590893',
  phoneE164: '+97783590893',
  mobileDisplay: '9848293693',
  mobileE164: '+9779848293693',
  whatsappNumber: '9779848293693',
  email: '',
  openingHours: 'Daily 10:00 AM – 10:00 PM',
  social: {
    facebook: 'https://www.facebook.com/profile.php?id=61583095972640',
    tiktok: 'https://www.tiktok.com/@sundar.bagaicha.e',
  },
  mapsUrl: 'https://maps.app.goo.gl/GYW23QXRfwtjnUB76',
  mapEmbedSrc:
    'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d4533.970940913082!2d81.6322494789315!3d28.596526700000016!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x39a285dc556bf545%3A0x98300fb234f2ce9e!2sSundar%20Bagaicha%20Events!5e1!3m2!1sen!2snp!4v1778685146839!5m2!1sen!2snp',
  logo: '/images/brand/sundar-bagaicha-logo.jpg',
  storefront: [],
  themeColor: '#0d1a0d',
  accentColor: '#C5A55A',
  // No public domain has been supplied yet — set NEXT_PUBLIC_SITE_URL at
  // deploy time. This placeholder only feeds metadataBase when that is unset.
  siteUrl: 'https://sundarbagaicha.com.np',
};

export function telHref() {
  return `tel:${RESTAURANT.phoneE164}`;
}

export function mobileHref() {
  return `tel:${RESTAURANT.mobileE164}`;
}

export function mailtoHref() {
  return `mailto:${RESTAURANT.email}`;
}

export function whatsappHref(message = "Hello Sundar Bagaicha! I'd like to place an order.") {
  return `https://wa.me/${RESTAURANT.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

/** External "Open in Google Maps" link (search by name near coordinates). */
export function directionsHref() {
  const { lat, lng } = RESTAURANT.coords;
  const q = encodeURIComponent(`${RESTAURANT.name}, ${RESTAURANT.address.full}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}&center=${lat},${lng}`;
}

/** "Read reviews on Google" — points to the live listing rather than copying reviews. */
export function googleReviewsHref() {
  const q = encodeURIComponent(`${RESTAURANT.name} ${RESTAURANT.address.city}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
