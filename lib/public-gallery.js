/**
 * Curated public-site imagery.
 *
 * Sundar Bagaicha venue photography has NOT been supplied yet, so every
 * storefront/room slot is intentionally empty. `components/public/dish-image.jsx`
 * renders a branded, named tile whenever `src` is empty or fails to load, so an
 * empty entry degrades to a deliberate placeholder rather than a blank panel.
 *
 * Only dishes that genuinely appear on the Sundar Bagaicha menu are given a
 * photo — never label a photo as a dish the venue does not sell. Drop real
 * photos under public/images/ and point the entries below at them.
 */

/** Venue/storefront photography — awaiting real Sundar Bagaicha photos. */
export const STOREFRONT = [];

/** Hero imagery. Empty until venue photography is supplied. */
export const HERO = {
  main: { src: '', alt: 'Sundar Bagaicha Events, Birendranagar' },
  inset: { src: '', alt: 'Dining at Sundar Bagaicha Events' },
};

/** Signature dishes on the home page — names must exist on the live menu. */
export const SIGNATURE_ITEMS = [
  { name: 'Chicken Chilly', img: '/images/dishes/chicken-chilly.jpg', category: 'Chicken Specialties' },
  { name: 'Mutton Sekuwa', img: '', category: 'Mutton Specialties' },
  { name: 'Local Chicken Choila', img: '', category: 'Traditional Choila' },
  { name: 'Paneer Pakauda', img: '', category: 'Snacks' },
];

/** Popular categories — `img: ''` renders a branded tile. */
export const POPULAR_CATEGORIES = [
  { title: 'Snacks', note: 'Sadheko · pakauda · khaja', img: '' },
  { title: 'Traditional Choila', note: 'Chicken · duck · mutton', img: '' },
  { title: 'Cakes & Pastries', note: 'Baked fresh daily', img: '' },
  { title: 'Beverages', note: 'Coffee, shakes & more', img: '' },
];

/** Gallery grid — food photography currently on file. */
export const GALLERY = [
  '/images/dishes/chicken-chilly.jpg',
];
