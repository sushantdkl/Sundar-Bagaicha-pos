'use client';

import { useEffect } from 'react';

/**
 * Runs the original landing-page interactions after Next.js has mounted the
 * exact server-rendered markup. The source is local, version-controlled HTML;
 * no customer or CMS value is evaluated here.
 */
const text = (selector, value) => {
  if (value == null || value === '') return;
  const element = document.querySelector(selector);
  if (element) element.textContent = String(value);
};

const link = (selector, label, href) => {
  const element = document.querySelector(selector);
  if (!element) return;
  if (label) element.textContent = label;
  if (href) element.setAttribute('href', href);
};

const lines = (value) => String(value || '').split('\n');

function setRichHeading(selector, before, accent, after) {
  const element = document.querySelector(selector);
  if (!element || (!before && !accent && !after)) return;
  element.replaceChildren();
  if (before) element.append(document.createTextNode(String(before)));
  if (accent) {
    if (before) element.append(document.createTextNode(' '));
    const span = document.createElement('span');
    span.className = 'accent';
    span.textContent = String(accent);
    element.append(span);
  }
  if (after) {
    element.append(document.createElement('br'));
    element.append(document.createTextNode(String(after)));
  }
}

function setMultiline(selector, value) {
  if (value == null || value === '') return;
  const element = document.querySelector(selector);
  if (!element) return;
  element.replaceChildren();
  lines(value).forEach((part, index) => {
    if (index) element.append(document.createElement('br'));
    element.append(document.createTextNode(part));
  });
}

function replaceOptions(selector, values, placeholder) {
  const select = document.querySelector(selector);
  if (!select || !Array.isArray(values)) return;
  select.replaceChildren();
  if (placeholder) select.add(new Option(placeholder, ''));
  values.forEach((value) => select.add(new Option(value, value)));
}

function applyPublishedContent(cms = {}, menuCategories = []) {
  // Only saved CMS sections override the original landing copy. Merged CMS
  // defaults describe the newer public shell and must not silently rewrite
  // this replica before an administrator has actually published a change.
  const brand = cms.brand?._updatedAt ? cms.brand : {};
  const home = cms.home?._updatedAt ? cms.home : {};
  const about = cms.about?._updatedAt ? cms.about : {};
  const gallery = cms.gallery?._updatedAt ? cms.gallery : {};
  const contact = cms.contact?._updatedAt ? cms.contact : {};
  const landing = cms.landing || {};

  const logo = brand.logo || '/images/brand/sundar-bagaicha-logo.jpg';
  document.querySelectorAll('.nav-logo > img, .footer-logo > img').forEach((image) => {
    image.src = logo;
    image.alt = `${brand.businessName || 'Sundar Bagaicha Events'} logo`;
  });

  const logoText = [...document.querySelectorAll('#navbar .nav-logo-text')].find((element) => element.querySelector('span'));
  if (logoText && brand.shortName) {
    const firstText = [...logoText.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (firstText) firstText.nodeValue = `${brand.shortName} `;
  }
  const footerLogoText = document.querySelector('.footer-logo-text');
  if (footerLogoText && brand.shortName) {
    const firstText = [...footerLogoText.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (firstText) firstText.nodeValue = `${brand.shortName} `;
  }

  const navItems = Array.isArray(landing.navigation) ? landing.navigation : [];
  if (navItems.length) {
    const desktop = document.querySelector('#navbar .nav-links');
    if (desktop) {
      desktop.replaceChildren();
      [...navItems, { label: landing.staffLabel || 'Staff', href: landing.staffHref || '/login', staff: true }].forEach((item) => {
        const li = document.createElement('li');
        const anchor = document.createElement('a');
        anchor.textContent = item.label;
        anchor.href = item.href;
        if (item.staff) anchor.className = 'nav-cta';
        li.append(anchor);
        desktop.append(li);
      });
    }
    const mobile = document.querySelector('#mobileMenu');
    if (mobile) {
      mobile.querySelectorAll('a').forEach((anchor) => anchor.remove());
      [...navItems, { label: landing.staffLabel || 'Staff', href: landing.staffHref || '/login' }].forEach((item) => {
        const anchor = document.createElement('a');
        anchor.textContent = item.label;
        anchor.href = item.href;
        anchor.addEventListener('click', () => window.closeMobileMenu?.());
        mobile.append(anchor);
      });
    }
  }

  text('.hero-eyebrow', home.heroEyebrow);
  text('.hero-title .line1', home.heroHeadingLine1);
  text('.hero-title .line2', home.heroHeadingLine2);
  text('.hero-subtitle', home.heroHeadingLine3 || home.heroDescription);
  text('.hero-badge span', home.heroBadgeLabel ? `${home.heroBadgeValue || ''} ${home.heroBadgeLabel}`.trim() : null);
  document.querySelectorAll('.hero-stat').forEach((stat, index) => {
    const item = landing.heroStats?.[index];
    if (!item) return;
    const value = stat.querySelector('.hero-stat-num');
    const label = stat.querySelector('.hero-stat-label');
    if (value) value.textContent = item.value || '';
    if (label) label.textContent = item.label || '';
  });
  const featureTrack = document.querySelector('#featuresScroll');
  if (featureTrack && Array.isArray(landing.featureStrip)) {
    featureTrack.replaceChildren();
    [...landing.featureStrip, ...landing.featureStrip].forEach((label) => {
      const item = document.createElement('div');
      item.className = 'features-scroll-item';
      item.append(document.createTextNode(label));
      const dot = document.createElement('span');
      dot.className = 'features-scroll-dot';
      item.append(dot);
      featureTrack.append(item);
    });
  }
  if (contact.location) {
    const heroLocation = document.querySelector('.hero-location');
    if (heroLocation) {
      [...heroLocation.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).forEach((node) => node.remove());
      heroLocation.append(document.createTextNode(` ${contact.location}`));
    }
  }
  if (home.heroImage) {
    const heroImage = document.querySelector('.hero-image-bg');
    if (heroImage) heroImage.style.backgroundImage = `url(${JSON.stringify(home.heroImage)})`;
  }
  link('.hero-btns .btn-primary span', home.primaryCta?.label, null);
  const heroPrimary = document.querySelector('.hero-btns .btn-primary');
  if (heroPrimary && home.primaryCta?.href) heroPrimary.setAttribute('href', home.primaryCta.href);
  link('.hero-btns .btn-outline', home.secondaryCta?.label, home.secondaryCta?.href === 'whatsapp' ? `https://wa.me/${String(contact.whatsapp || brand.whatsapp || '').replace(/\D/g, '')}` : home.secondaryCta?.href);

  text('#about .section-label', landing.aboutLabel);
  setRichHeading('#about .section-title', landing.aboutTitleBefore, landing.aboutTitleAccent, landing.aboutTitleAfter);
  const aboutParagraphs = document.querySelectorAll('#about .about-desc');
  if (aboutParagraphs[0] && (home.aboutStripText || about.description)) aboutParagraphs[0].textContent = home.aboutStripText || about.description;
  if (aboutParagraphs[1] && about.descriptionExtra) aboutParagraphs[1].textContent = about.descriptionExtra;
  const aboutImages = about.images || [];
  const aboutSlots = document.querySelectorAll('#about .about-card img');
  aboutSlots.forEach((image, index) => {
    const source = aboutImages[index] || (index === 0 ? home.aboutStripImage : home.heroInsetImage);
    if (source) image.setAttribute('src', source);
  });
  document.querySelectorAll('#about .about-feature-item').forEach((item, index) => {
    const feature = about.features?.[index];
    if (!feature) return;
    const name = item.querySelector('.about-feature-name');
    const description = item.querySelector('.about-feature-desc');
    if (name) name.textContent = feature.title || '';
    if (description) description.textContent = feature.text || '';
  });
  text('#about .about-card-badge-num', landing.aboutRating);
  text('#about .about-card-badge-label', landing.aboutRatingLabel);
  text('#about .btn-primary span', landing.aboutCtaLabel);

  text('#gallery .section-label', landing.galleryLabel);
  setRichHeading('#gallery .section-title', landing.galleryTitleBefore, landing.galleryTitleAccent);
  if (Array.isArray(gallery.items) && gallery.items.length) {
    const galleryItems = gallery.items.filter((item) => item.visible !== false).slice(0, Number(home.galleryLimit) || 6);
    document.querySelectorAll('#gallery .gallery-item').forEach((slot, index) => {
      const item = galleryItems[index];
      slot.style.display = item ? '' : 'none';
      if (!item) return;
      const image = slot.querySelector('img');
      const label = slot.querySelector('.gallery-item-label');
      if (image) {
        image.src = item.url;
        image.alt = item.alt || item.title || brand.businessName || 'Sundar Bagaicha Events';
      }
      if (label) label.textContent = item.title || item.alt || '';
    });
  }

  text('#menu .section-label', landing.menuLabel);
  setRichHeading('#menu .section-title', landing.menuTitleBefore, landing.menuTitleAccent);
  const menuLead = document.querySelector('#menu .menu-header p');
  if (menuLead && home.menuLead) menuLead.textContent = home.menuLead;
  const liveItems = new Map();
  for (const category of menuCategories || []) {
    for (const item of category.items || []) liveItems.set(String(item.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ''), item);
  }
  document.querySelectorAll('#menu .menu-item').forEach((row) => {
    const name = row.querySelector('.menu-item-name')?.textContent || '';
    row.setAttribute('role', 'link');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `Open full menu to order ${name}`);
    row.style.cursor = 'pointer';
    const openMenu = () => { window.location.href = '/menu'; };
    row.addEventListener('click', openMenu);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openMenu();
      }
    });
    const item = liveItems.get(name.toLowerCase().replace(/[^a-z0-9]+/g, ''));
    if (!item) return;
    const price = row.querySelector('.menu-item-price');
    if (price) price.textContent = `Rs. ${Number(item.price).toFixed(0)}`;
  });

  text('#events .section-label', landing.eventsLabel);
  setRichHeading('#events .section-title', landing.eventsTitleBefore, landing.eventsTitleAccent, landing.eventsTitleAfter);
  text('#events .events-header p', landing.eventsLead);
  const eventsGrid = document.querySelector('#events .events-grid');
  if (eventsGrid && Array.isArray(landing.events)) {
    eventsGrid.replaceChildren();
    landing.events.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = `event-card reveal${index % 3 ? ` reveal-delay-${index % 3}` : ''}`;
      card.innerHTML = '<span class="event-icon"></span><div class="event-title"></div><div class="event-desc"></div>';
      card.querySelector('.event-icon').textContent = item.icon || '';
      card.querySelector('.event-title').textContent = item.title || '';
      card.querySelector('.event-desc').textContent = item.text || '';
      eventsGrid.append(card);
    });
  }

  text('#amenities .section-label', landing.amenitiesLabel);
  setRichHeading('#amenities .section-title', landing.amenitiesTitleBefore, landing.amenitiesTitleAccent);
  const amenitiesGrid = document.querySelector('#amenities .amenities-3d-cards');
  if (amenitiesGrid && Array.isArray(landing.amenities)) {
    amenitiesGrid.replaceChildren();
    landing.amenities.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = `amenity-card reveal${index % 4 ? ` reveal-delay-${index % 4}` : ''}`;
      card.innerHTML = '<div class="amenity-num"></div><span class="amenity-icon"></span><div class="amenity-title"></div><div class="amenity-desc"></div>';
      card.querySelector('.amenity-num').textContent = String(index + 1).padStart(2, '0');
      card.querySelector('.amenity-icon').textContent = item.icon || '';
      card.querySelector('.amenity-title').textContent = item.title || '';
      card.querySelector('.amenity-desc').textContent = item.text || '';
      amenitiesGrid.append(card);
    });
  }

  text('#reviews .section-label', landing.reviewsLabel);
  setRichHeading('#reviews .section-title', landing.reviewsTitleBefore, landing.reviewsTitleAccent, landing.reviewsTitleAfter);
  text('#reviews .reviews-rating-big', landing.reviewsRating);
  text('#reviews .reviews-count', landing.reviewsCount);
  const reviewsTrack = document.querySelector('#reviews .reviews-track');
  if (reviewsTrack && Array.isArray(landing.reviews)) {
    reviewsTrack.replaceChildren();
    [...landing.reviews, ...landing.reviews].forEach((item) => {
      const card = document.createElement('div');
      card.className = 'review-card';
      card.innerHTML = '<span class="review-stars"></span><p class="review-text"></p><div class="review-author"><div class="review-avatar"></div><div class="review-author-info"><div class="review-author-name"></div><div class="review-author-source"></div></div></div>';
      card.querySelector('.review-stars').textContent = `${'★'.repeat(Number(item.rating) || 5)}${'☆'.repeat(Math.max(0, 5 - (Number(item.rating) || 5)))}`;
      card.querySelector('.review-text').textContent = item.text || '';
      card.querySelector('.review-avatar').textContent = String(item.name || '?').charAt(0).toUpperCase();
      card.querySelector('.review-author-name').textContent = item.name || '';
      card.querySelector('.review-author-source').textContent = item.source || '';
      reviewsTrack.append(card);
    });
  }

  text('#reserve .section-label', landing.reservationLabel);
  setRichHeading('#reserve .section-title', landing.reservationTitleBefore, landing.reservationTitleAccent);
  text('#reserve .reserve-info > .about-desc', landing.reservationDescription);
  setMultiline('#reserve .reserve-info-item:nth-child(2) .reserve-info-value', landing.reservationHours);
  text('#reserve .form-title', landing.reservationFormTitle);
  text('#reserveBtn', landing.reservationButton);
  text('#reserve .form-note', landing.reservationNote);
  text('#reserve .form-success-title', landing.reservationSuccessTitle);
  text('#reserve .form-success-msg', landing.reservationSuccessMessage);
  replaceOptions('#r-guests', landing.guestOptions, 'Select guests');
  replaceOptions('#r-occasion', landing.occasionOptions, 'Select occasion');

  text('#location .section-label', landing.locationLabel);
  setRichHeading('#location .section-title', landing.locationTitleBefore, landing.locationTitleAccent);
  setMultiline('#location .location-info-card:nth-child(3) .location-card-value', landing.locationHours);
  text('#location .location-info-card:nth-child(4) .location-card-value', landing.locationEstablished);

  text('#inquiry .section-label', landing.inquiryLabel);
  setRichHeading('#inquiry .section-title', landing.inquiryTitleBefore, landing.inquiryTitleAccent);
  text('#inquiry .inquiry-header p', landing.inquiryLead);
  text('#inquiryBtn', landing.inquiryButton);
  text('#inquiry .form-note', landing.inquiryNote);
  text('#inquiry .form-success-title', landing.inquirySuccessTitle);
  text('#inquiry .form-success-msg', landing.inquirySuccessMessage);
  replaceOptions('#i-subject', landing.inquirySubjects, 'Select subject');

  text('footer .footer-tagline', landing.footerTagline || brand.tagline);
  text('footer > div:last-of-type span:first-child', landing.footerCopyright);
  text('footer > div:last-of-type span:last-child', landing.footerMotto);
  const serviceLinks = document.querySelectorAll('footer .footer-container > div:nth-child(3) .footer-links li a');
  serviceLinks.forEach((anchor, index) => {
    if (landing.footerServices?.[index]) anchor.textContent = landing.footerServices[index];
  });

  const phone = contact.phone || brand.phone;
  const location = contact.location || brand.location;
  const whatsapp = String(contact.whatsapp || brand.whatsapp || '').replace(/\D/g, '');
  if (phone) {
    document.querySelectorAll('a[href^="tel:"]').forEach((anchor) => { anchor.href = `tel:${String(phone).replace(/[^0-9+]/g, '')}`; });
    text('#location .location-info-card:nth-child(2) .location-card-value', phone);
    text('#reserve .reserve-info-item:first-child .reserve-info-value', phone);
  }
  if (location) {
    text('#location .location-info-card:first-child .location-card-value', location);
    text('#reserve .reserve-info-item:nth-child(3) .reserve-info-value', location);
  }
  if (whatsapp) {
    document.querySelectorAll('a[href*="wa.me"]').forEach((anchor) => { anchor.href = `https://wa.me/${whatsapp}`; });
  }
  const social = contact.social || brand.social || {};
  document.querySelectorAll('a[title="Facebook"], #location a[href*="facebook.com"]').forEach((anchor) => { if (social.facebook) anchor.href = social.facebook; });
  document.querySelectorAll('a[title="TikTok"], #location a[href*="tiktok.com"]').forEach((anchor) => { if (social.tiktok) anchor.href = social.tiktok; });
  const map = document.querySelector('#location iframe');
  if (map && (contact.mapEmbed || brand.mapEmbed)) map.src = contact.mapEmbed || brand.mapEmbed;

  const visibility = {
    hero: '#hero',
    popular: '#features-strip',
    menu: '#menu',
    about: '#about',
    gallery: '#gallery',
    howItWorks: '#events',
    findUs: '#location',
    events: '#events',
    amenities: '#amenities',
    reviews: '#reviews',
    reservation: '#reserve',
    location: '#location',
    inquiry: '#inquiry',
  };
  for (const [key, selector] of Object.entries(visibility)) {
    const section = document.querySelector(selector);
    if (section) section.style.display = (home.sections?.[key] === false || landing.sections?.[key] === false) ? 'none' : '';
  }
}

export default function LandingPageReplica({ styles, markup, behavior, fontClass, cms, menuCategories }) {
  useEffect(() => {
    if (window.__sundarLandingInitialized) return undefined;
    window.__sundarLandingInitialized = true;
    applyPublishedContent(cms, menuCategories);
    const script = document.createElement('script');
    script.dataset.sundarLanding = 'true';
    script.text = `${behavior}\n//# sourceURL=sundar-bagaicha-landing.js`;
    document.body.appendChild(script);
    return () => {
      document.body.style.overflow = '';
    };
  }, [behavior, cms, menuCategories]);

  return (
    <div className={fontClass}>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div dangerouslySetInnerHTML={{ __html: markup }} />
    </div>
  );
}
