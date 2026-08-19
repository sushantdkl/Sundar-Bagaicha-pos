/**
 * One source of truth for the business identity that appears on every printed
 * document — customer bill, pre-bill, KOT, KOT reprint.
 *
 * The chain is:
 *
 *   Admin → Settings → Business Information
 *     → system_settings rows (restaurant_name, restaurant_address, …)
 *       → GET /api/admin/settings
 *         → primeBusinessIdentity() on whichever screen loaded them
 *           → resolveBusinessIdentity() inside the print templates
 *
 * Print entry points are synchronous (they return a boolean so the caller can
 * fall back when a pop-up is blocked), so this cannot fetch on demand. Instead
 * every screen that already loads settings primes the cache, and the templates
 * read it. A template may also be handed a settings object directly, which
 * both wins for that call and refreshes the cache.
 *
 * Nothing here hard-codes a brand string. The last-resort fallback is the
 * deployment's own identity constant in lib/restaurant-info.js, which is what
 * the CMS, the BEO and the public site already fall back to.
 */

import { RESTAURANT } from '@/lib/restaurant-info.js';

/** Shape the print templates consume — mirrors the receipt payload keys. */
function fromSettings(settings = {}) {
  return {
    restaurant_name: settings.restaurant_name || RESTAURANT.name,
    restaurant_address: settings.restaurant_address ?? RESTAURANT.address.full,
    restaurant_phone: settings.restaurant_phone ?? RESTAURANT.phoneDisplay,
    restaurant_email: settings.restaurant_email ?? '',
    vat_number: settings.vat_number ?? '',
    pan_number: settings.pan_number ?? '',
    receipt_footer: settings.receipt_footer ?? '',
  };
}

let cached = null;

/**
 * Record the business identity from a freshly loaded settings payload.
 * Safe to call with a partial object or with nothing.
 * @param {object} settings raw `settings` object from GET /api/admin/settings
 */
export function primeBusinessIdentity(settings) {
  if (!settings || typeof settings !== 'object') return getBusinessIdentity();
  // An empty/short payload must not wipe a good cache — settings screens
  // sometimes render before their fetch resolves.
  if (!settings.restaurant_name && cached) return cached;
  cached = fromSettings(settings);
  return cached;
}

/** The identity as last primed, or the deployment fallback. Never null. */
export function getBusinessIdentity() {
  return cached || fromSettings({});
}

/**
 * Identity for one print call. An explicit settings object wins and is
 * remembered; otherwise the cache answers; otherwise the deployment fallback.
 * @param {object} [settings]
 */
export function resolveBusinessIdentity(settings) {
  if (settings && typeof settings === 'object' && settings.restaurant_name) {
    return primeBusinessIdentity(settings);
  }
  return getBusinessIdentity();
}

/** Test seam — drops the cache so one test cannot leak into the next. */
export function resetBusinessIdentity() {
  cached = null;
}
