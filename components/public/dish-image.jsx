'use client';

import { useState } from 'react';

/**
 * Public menu/gallery image. Reserves its box (no layout shift) and uses the
 * browser's native lazy-loading (reliable, SSR-friendly — no IntersectionObserver
 * that can stall offscreen). Shows a deliberate branded, named fallback when a
 * dish has no approved photo or the request fails — never a blank panel.
 */
export default function DishImage({ src, alt, className = '', rounded = 'rounded-xl' }) {
  const [failed, setFailed] = useState(false);
  const showFallback = !src || failed;

  return (
    <div
      className={`relative overflow-hidden ${rounded} ${className}`}
      style={{ background: 'var(--dsp-border)' }}
    >
      {showFallback ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center"
          style={{ background: 'linear-gradient(135deg, var(--dsp-brand) 0%, var(--dsp-brand-dark) 100%)' }}
        >
          <svg viewBox="0 0 64 64" className="h-7 w-7 opacity-85" fill="none" style={{ color: '#f6e7d6' }} aria-hidden>
            <ellipse cx="32" cy="42" rx="22" ry="6" stroke="currentColor" strokeWidth="2.5" />
            <path d="M12 40c2-14 12-22 20-22s18 8 20 22" stroke="currentColor" strokeWidth="2.5" />
          </svg>
          <span className="dsp-display text-xs font-semibold leading-tight line-clamp-2" style={{ color: '#fdf6ec' }}>
            {alt || 'Sundar Bagaicha'}
          </span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 hover:scale-[1.04]"
        />
      )}
    </div>
  );
}
