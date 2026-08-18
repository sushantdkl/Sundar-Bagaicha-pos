'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Phone, MessageCircle, MapPin, Menu, X, Mail } from 'lucide-react';
import { RESTAURANT, telHref, whatsappHref, directionsHref, mailtoHref } from '@/lib/restaurant-info';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/menu', label: 'Menu' },
  { href: '/about', label: 'About' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/contact', label: 'Contact' },
];

function isActive(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname?.startsWith(`${href}/`);
}

export default function PublicShell({ children }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef(null);

  // Escape closes the menu and restores focus to the toggle (a11y).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="sticky top-0 z-50 border-b backdrop-blur"
        style={{ background: 'color-mix(in srgb, var(--dsp-surface) 88%, transparent)', borderColor: 'var(--dsp-border)' }}
      >
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5 min-w-0 dsp-focus rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={RESTAURANT.logo} alt={`${RESTAURANT.name} logo`} width={40} height={40}
                 className="w-10 h-10 rounded-lg object-cover shrink-0" />
            <span className="dsp-display font-bold text-base sm:text-lg truncate" style={{ color: 'var(--dsp-brand-dark)' }}>
              {RESTAURANT.shortName}
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-colors dsp-focus"
                style={{
                  color: isActive(pathname, n.href) ? 'var(--dsp-brand)' : 'var(--dsp-ink)',
                  background: isActive(pathname, n.href) ? 'color-mix(in srgb, var(--dsp-brand) 10%, transparent)' : 'transparent',
                }}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="hidden sm:flex items-center gap-2">
            <a href={telHref()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border dsp-focus"
               style={{ borderColor: 'var(--dsp-border)', color: 'var(--dsp-ink)' }}>
              <Phone className="w-4 h-4" /> <span className="hidden lg:inline">Call</span>
            </a>
            <a href={whatsappHref()} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white dsp-focus"
               style={{ background: 'var(--dsp-brand)' }}>
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </a>
          </div>

          <button ref={toggleRef} type="button" onClick={() => setOpen((v) => !v)}
                  className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg border dsp-focus"
                  style={{ borderColor: 'var(--dsp-border)' }} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {open && (
          <div className="dsp-menu-enter md:hidden border-t px-4 py-3 space-y-1" style={{ borderColor: 'var(--dsp-border)', background: 'var(--dsp-surface)' }}>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
                    className="block px-3 py-2.5 rounded-lg text-sm font-medium dsp-focus"
                    style={{ color: isActive(pathname, n.href) ? 'var(--dsp-brand)' : 'var(--dsp-ink)' }}>
                {n.label}
              </Link>
            ))}
            <div className="flex gap-2 pt-2">
              <a href={telHref()} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold border"
                 style={{ borderColor: 'var(--dsp-border)' }}><Phone className="w-4 h-4" /> Call</a>
              <a href={whatsappHref()} target="_blank" rel="noopener noreferrer"
                 className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-white"
                 style={{ background: 'var(--dsp-brand)' }}><MessageCircle className="w-4 h-4" /> WhatsApp</a>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t mt-16" style={{ borderColor: 'var(--dsp-border)', background: 'var(--dsp-surface)' }}>
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10 py-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={RESTAURANT.logo} alt="" width={40} height={40} className="w-10 h-10 rounded-lg object-cover" />
              <span className="dsp-display font-bold" style={{ color: 'var(--dsp-brand-dark)' }}>{RESTAURANT.shortName}</span>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--dsp-muted)' }}>{RESTAURANT.tagline}.</p>
          </div>

          <div className="space-y-2 text-sm">
            <h3 className="font-semibold mb-2" style={{ color: 'var(--dsp-ink)' }}>Explore</h3>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="block dsp-focus rounded" style={{ color: 'var(--dsp-muted)' }}>{n.label}</Link>
            ))}
          </div>

          <div className="space-y-2 text-sm">
            <h3 className="font-semibold mb-2" style={{ color: 'var(--dsp-ink)' }}>Contact</h3>
            <a href={telHref()} className="flex items-center gap-2 dsp-focus rounded" style={{ color: 'var(--dsp-muted)' }}>
              <Phone className="w-4 h-4 shrink-0" /> {RESTAURANT.phoneDisplay}
            </a>
            <a href={mailtoHref()} className="flex items-center gap-2 dsp-focus rounded break-all" style={{ color: 'var(--dsp-muted)' }}>
              <Mail className="w-4 h-4 shrink-0" /> {RESTAURANT.email}
            </a>
            <a href={directionsHref()} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 dsp-focus rounded" style={{ color: 'var(--dsp-muted)' }}>
              <MapPin className="w-4 h-4 shrink-0 mt-0.5" /> {RESTAURANT.address.full}
            </a>
          </div>

          <div className="space-y-2 text-sm">
            <h3 className="font-semibold mb-2" style={{ color: 'var(--dsp-ink)' }}>Follow</h3>
            <a href={RESTAURANT.social.facebook} target="_blank" rel="noopener noreferrer" className="block dsp-focus rounded" style={{ color: 'var(--dsp-muted)' }}>Facebook</a>
            <a href={RESTAURANT.social.tiktok} target="_blank" rel="noopener noreferrer" className="block dsp-focus rounded" style={{ color: 'var(--dsp-muted)' }}>TikTok</a>
            <a href={whatsappHref()} target="_blank" rel="noopener noreferrer" className="block dsp-focus rounded" style={{ color: 'var(--dsp-muted)' }}>WhatsApp</a>
          </div>
        </div>
        <div className="border-t py-5 text-center text-xs" style={{ borderColor: 'var(--dsp-border)', color: 'var(--dsp-muted)' }}>
          © {new Date().getFullYear()} {RESTAURANT.name}. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
