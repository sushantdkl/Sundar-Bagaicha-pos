/**
 * Shared API authentication / authorization helpers.
 */

import { NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth/auth.js';
import { clientError, logger } from '@/lib/logger.js';
import { assertCsrf } from '@/lib/csrf.js';
import { ensurePermissionCache, DYNAMIC_PERMISSION_KEYS } from '@/lib/permissions.js';

const authService = new AuthService();

export function extractBearerToken(request) {
  const header = request.headers.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  // Cookie fallback (production cookie sessions)
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)pos_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function requireAuth(request, { roles = null, permission = null, csrf = null } = {}) {
  const method = (request.method || 'GET').toUpperCase();
  const needsCsrf =
    csrf === true || (csrf !== false && !['GET', 'HEAD', 'OPTIONS'].includes(method));
  if (needsCsrf) {
    const csrfError = assertCsrf(request);
    if (csrfError) return { error: csrfError };
  }

  const token = extractBearerToken(request);
  if (!token) {
    return { error: NextResponse.json(clientError('Please sign in again to continue.'), { status: 401 }) };
  }

  const user = await authService.verifySession(token);
  if (!user) {
    return { error: NextResponse.json(clientError('Please sign in again to continue.'), { status: 401 }) };
  }

  if (roles && roles.length && !roles.includes(user.role) && user.role !== 'admin') {
    return { error: NextResponse.json(clientError('You do not have access to this action.'), { status: 403 }) };
  }

  if (permission) {
    if (DYNAMIC_PERMISSION_KEYS.has(permission)) await ensurePermissionCache(authService.db);
    if (!authService.hasPermission(user.role, permission)) {
      return { error: NextResponse.json(clientError('You do not have access to this action.'), { status: 403 }) };
    }
  }

  return { user, token };
}

export function jsonError(message, status = 400, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function handleRouteError(error, fallback = 'Request failed. Please try again.') {
  logger.error('api_error', {
    message: error?.message,
    code: error?.code,
    status: error?.status,
    stack: error?.stack,
  });
  const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
  const message =
    status >= 500 || /sqlite|postgres|constraint|pragma|undefined/i.test(String(error?.message || ''))
      ? fallback
      : error.message || fallback;
  // Errors thrown as Object.assign(new Error(msg), {status, code, ...extra}) carry
  // machine-readable fields (code, business_day_id, blockers, ...) the client needs
  // to branch on (e.g. a stale business day vs. a missing store session).
  const extra = {};
  if (status < 500) {
    for (const key of Object.keys(error || {})) {
      if (key !== 'status') extra[key] = error[key];
    }
  }
  return NextResponse.json(
    {
      ...clientError(message),
      ...extra,
      debugMessage: error?.message,
      debugStack: error?.stack,
    },
    { status: status >= 400 && status < 600 ? status : 500 }
  );
}

/** Disable legacy multi-shop / distribution endpoints. */
export function goneLegacy(feature = 'This endpoint') {
  return NextResponse.json(
    {
      error: `${feature} was removed from this production build. Use the restaurant POS APIs instead.`,
      code: 'legacy_removed',
    },
    { status: 410 }
  );
}
