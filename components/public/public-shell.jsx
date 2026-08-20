'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Phone, MapPin, Menu, X, Mail, UserRound } from 'lucide-react';
import { RESTAURANT } from '@/lib/restaurant-info';

const NAV = [
  { href: '/menu', label: 'Menu' },
];

function isActive(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname?.startsWith(`${href}/`);
}

export default function PublicShell({ children, brand = {}, contact = {}, landing = {} }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef(null);
  const siteNav = (landing.navigation || NAV).filter((item) => item.href?.startsWith('/'));
  const identity = {
    name: brand.name || RESTAURANT.name,
    shortName: brand.shortName || RESTAURANT.shortName,
    tagline: landing.footerTagline || brand.tagline || RESTAURANT.tagline,
    logo: brand.logo || RESTAURANT.logo,
  };
  const hrefs = contact.hrefs || {};

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
            <img src={identity.logo} alt={`${identity.name} logo`} width={40} height={40}
                 className="w-10 h-10 rounded-lg object-cover shrink-0" />
            <span className="dsp-display font-bold text-base sm:text-lg truncate" style={{ color: 'var(--dsp-brand-dark)' }}>
              {identity.shortName}
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
            {siteNav.map((n) => (
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
            <a href={hrefs.tel || `tel:${RESTAURANT.phoneE164}`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border dsp-focus"
               style={{ borderColor: 'var(--dsp-border)', color: 'var(--dsp-ink)' }}>
              <Phone className="w-4 h-4" /> <span className="hidden lg:inline">Call</span>
            </a>
            <Link href={landing.staffHref || '/login'}
               className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white dsp-focus"
               style={{ background: 'var(--dsp-brand)' }}>
              <UserRound className="w-4 h-4" /> {landing.staffLabel || 'Staff'}
            </Link>
          </div>

          <button ref={toggleRef} type="button" onClick={() => setOpen((v) => !v)}
                  className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg border dsp-focus"
                  style={{ borderColor: 'var(--dsp-border)' }} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {open && (
          <div className="dsp-menu-enter md:hidden border-t px-4 py-3 space-y-1" style={{ borderColor: 'var(--dsp-border)', background: 'var(--dsp-surface)' }}>
            {siteNav.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
                    className="block px-3 py-2.5 rounded-lg text-sm font-medium dsp-focus"
                    style={{ color: isActive(pathname, n.href) ? 'var(--dsp-brand)' : 'var(--dsp-ink)' }}>
                {n.label}
              </Link>
            ))}
            <div className="flex gap-2 pt-2">
              <a href={hrefs.tel || `tel:${RESTAURANT.phoneE164}`} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold border"
                 style={{ borderColor: 'var(--dsp-border)' }}><Phone className="w-4 h-4" /> Call</a>
              <Link href={landing.staffHref || '/login'} onClick={() => setOpen(false)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-white dsp-focus"
                    style={{ background: 'var(--dsp-brand)' }}><UserRound className="w-4 h-4" /> {landing.staffLabel || 'Staff'}</Link>
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
              <img src={identity.logo} alt="" width={40} height={40} className="w-10 h-10 rounded-lg object-cover" />
              <span className="dsp-display font-bold" style={{ color: 'var(--dsp-brand-dark)' }}>{identity.shortName}</span>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--dsp-muted)' }}>{identity.tagline}</p>
          </div>

          <div className="space-y-2 text-sm">
            <h3 className="font-semibold mb-2" style={{ color: 'var(--dsp-ink)' }}>Explore</h3>
            {siteNav.map((n) => (
              <Link key={n.href} href={n.href} className="block dsp-focus rounded" style={{ color: 'var(--dsp-muted)' }}>{n.label}</Link>
            ))}
          </div>

          <div className="space-y-2 text-sm">
            <h3 className="font-semibold mb-2" style={{ color: 'var(--dsp-ink)' }}>Contact</h3>
            <a href={hrefs.tel || `tel:${RESTAURANT.phoneE164}`} className="flex items-center gap-2 dsp-focus rounded" style={{ color: 'var(--dsp-muted)' }}>
              <Phone className="w-4 h-4 shrink-0" /> {contact.phoneDisplay || RESTAURANT.phoneDisplay}
            </a>
            {contact.email && <a href={hrefs.mailto} className="flex items-center gap-2 dsp-focus rounded break-all" style={{ color: 'var(--dsp-muted)' }}>
              <Mail className="w-4 h-4 shrink-0" /> {contact.email}
            </a>}
            <a href={hrefs.directions} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 dsp-focus rounded" style={{ color: 'var(--dsp-muted)' }}>
              <MapPin className="w-4 h-4 shrink-0 mt-0.5" /> {contact.location || RESTAURANT.address.full}
            </a>
          </div>

          <div className="space-y-2 text-sm">
            <h3 className="font-semibold mb-2" style={{ color: 'var(--dsp-ink)' }}>Follow</h3>
            {contact.social?.facebook && <a href={contact.social.facebook} target="_blank" rel="noopener noreferrer" className="block dsp-focus rounded" style={{ color: 'var(--dsp-muted)' }}>Facebook</a>}
            {contact.social?.tiktok && <a href={contact.social.tiktok} target="_blank" rel="noopener noreferrer" className="block dsp-focus rounded" style={{ color: 'var(--dsp-muted)' }}>TikTok</a>}
            <a href={hrefs.whatsapp} target="_blank" rel="noopener noreferrer" className="block dsp-focus rounded" style={{ color: 'var(--dsp-muted)' }}>WhatsApp</a>
          </div>
        </div>
        <div className="border-t py-5 text-center text-xs" style={{ borderColor: 'var(--dsp-border)', color: 'var(--dsp-muted)' }}>
          {landing.footerCopyright || `© ${new Date().getFullYear()} ${identity.name}. All rights reserved.`}
        </div>
      </footer>
    </div>
  );
}
