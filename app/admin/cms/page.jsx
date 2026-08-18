'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import {
  Globe, Home, Info, Image as ImageIcon, Phone, Search as SeoIcon, RotateCcw,
  Save, UploadCloud, X, Trash2, Plus, Eye, EyeOff, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { useConfirm } from '@/components/ui/confirm';

/**
 * Website CMS — /admin/cms
 * Manages public content in system_settings and images via the persistent
 * media system. Menu prices are NOT editable here (POS remains the source).
 */

const TABS = [
  { id: 'brand', label: 'Brand', icon: Globe },
  { id: 'home', label: 'Home', icon: Home },
  { id: 'about', label: 'About', icon: Info },
  { id: 'gallery', label: 'Gallery', icon: ImageIcon },
  { id: 'contact', label: 'Contact', icon: Phone },
  { id: 'seo', label: 'SEO', icon: SeoIcon },
  { id: 'media', label: 'Media Library', icon: ImageIcon },
];

function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('pos_token') : null;
  return { Authorization: `Bearer ${token}` };
}

export default function CmsPage() {
  const [tab, setTab] = useState('brand');
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/cms', { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Request failed (${res.status})`);
      const data = await res.json();
      setContent(data.content);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2500);
  };

  const saveSection = async (section, data) => {
    try {
      const res = await fetch('/api/admin/cms', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, data }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Save failed');
      setContent((c) => ({ ...c, [section]: { ...c[section], ...data } }));
      showToast('Saved');
    } catch (e) {
      showToast(e.message, 'err');
    }
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Website CMS</h1>
            <p className="mt-1 text-sm text-gray-500">Manage public content and images. Menu prices stay controlled by the POS.</p>
          </div>
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <RotateCcw className="h-4 w-4" /> Refresh
          </button>
        </div>

        <div className="mt-4 overflow-x-auto border-b border-gray-200">
          <div className="flex gap-1 pb-2">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${tab === t.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                <t.icon className="h-4 w-4" /> {t.label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="mt-16 flex flex-col items-center text-center">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <p className="mt-3 text-sm text-gray-700">{error}</p>
            <button onClick={load} className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white">Try again</button>
          </div>
        ) : loading || !content ? (
          <div className="mt-6 h-96 animate-pulse rounded-2xl bg-gray-100" />
        ) : (
          <div className="mt-6">
            {tab === 'brand' && <BrandForm data={content.brand} onSave={(d) => saveSection('brand', d)} />}
            {tab === 'home' && <HomeForm data={content.home} onSave={(d) => saveSection('home', d)} />}
            {tab === 'about' && <AboutForm data={content.about} onSave={(d) => saveSection('about', d)} />}
            {tab === 'gallery' && <GalleryForm data={content.gallery} onSave={(d) => saveSection('gallery', d)} />}
            {tab === 'contact' && <ContactForm data={content.contact} onSave={(d) => saveSection('contact', d)} />}
            {tab === 'seo' && <SeoForm data={content.seo} onSave={(d) => saveSection('seo', d)} />}
            {tab === 'media' && <MediaLibrary />}
          </div>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${toast.kind === 'err' ? 'bg-red-600' : 'bg-emerald-600'}`}>
          <span className="inline-flex items-center gap-2">
            {toast.kind === 'err' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {toast.msg}
          </span>
        </div>
      )}
    </AdminLayout>
  );
}

/* ---------- shared field components ---------- */

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

function Text({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
  );
}

function TextArea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
  );
}

function SaveBar({ onSave, dirty }) {
  return (
    <div className="mt-6 flex justify-end">
      <button type="button" onClick={onSave} disabled={!dirty}
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white ${dirty ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-300'}`}>
        <Save className="h-4 w-4" /> Save changes
      </button>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      {title && <h3 className="mb-4 text-sm font-semibold text-gray-900">{title}</h3>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

/** Upload, preview, or paste a path (e.g. /images/chicken-chilly.jpg for production). */
function ImageUpload({ value, alt, onChange, section, label = 'Image' }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState(null);
  const [altText, setAltText] = useState(alt || '');
  const inputRef = useRef(null);

  useEffect(() => { setAltText(alt || ''); }, [alt]);

  const upload = (file) => {
    if (!file) return;
    setErr(null);
    if (!altText.trim()) { setErr('Please enter alt text before uploading (accessibility).'); return; }
    setBusy(true);
    setProgress(0);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('alt', altText);
    if (section) fd.append('section', section);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/cms/media');
    const token = localStorage.getItem('pos_token');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setBusy(false);
      try {
        const r = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) onChange(r.media.url, altText);
        else setErr(r.error || 'Upload failed');
      } catch { setErr('Upload failed'); }
    };
    xhr.onerror = () => { setBusy(false); setErr('Network error'); };
    xhr.send(fd);
  };

  return (
    <div className="sm:col-span-2">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start">
        {value ? (
          <div className="relative">
            <img src={value} alt={alt || ''} className="h-28 w-28 rounded-lg border border-gray-200 object-cover" />
            <button type="button" onClick={() => onChange('', altText)} className="absolute -right-2 -top-2 rounded-full bg-red-600 p-1 text-white shadow" title="Remove">
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }}
            className="flex h-28 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 sm:w-64"
          >
            <UploadCloud className="h-6 w-6" />
            <span className="mt-1 text-xs">Click or drag an image (max 5MB)</span>
          </div>
        )}
        <div className="flex-1 space-y-2">
          <input
            value={value || ''}
            onChange={(e) => onChange(e.target.value, altText)}
            placeholder="/images/your-photo.jpg or /uploads/cms/…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono text-xs"
          />
          <input value={altText} onChange={(e) => setAltText(e.target.value)} placeholder="Alt text"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium hover:bg-gray-50">
              Upload new
            </button>
            <span className="text-[11px] text-gray-400 self-center">Keep `/images/…` paths for cPanel static folder</span>
          </div>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          {busy && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      </div>
    </div>
  );
}

/* ---------- section forms ---------- */

function useDraft(data) {
  const [draft, setDraft] = useState(data);
  useEffect(() => setDraft(data), [data]);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  return [draft, set, dirty];
}

function BrandForm({ data, onSave }) {
  const [d, set, dirty] = useDraft(data);
  const social = d.social || {};
  return (
    <>
      <Card title="Brand & Contact identity">
        <Field label="Full business name"><Text value={d.businessName} onChange={(v) => set({ businessName: v })} /></Field>
        <Field label="Short name"><Text value={d.shortName} onChange={(v) => set({ shortName: v })} /></Field>
        <Field label="Tagline"><Text value={d.tagline} onChange={(v) => set({ tagline: v })} /></Field>
        <Field label="Public email"><Text value={d.email} onChange={(v) => set({ email: v })} type="email" /></Field>
        <Field label="Phone"><Text value={d.phone} onChange={(v) => set({ phone: v })} /></Field>
        <Field label="WhatsApp"><Text value={d.whatsapp} onChange={(v) => set({ whatsapp: v })} /></Field>
        <Field label="Location"><Text value={d.location} onChange={(v) => set({ location: v })} /></Field>
        <Field label="Map embed URL" hint="Google Maps embed src"><Text value={d.mapEmbed} onChange={(v) => set({ mapEmbed: v })} /></Field>
        <ImageUpload label="Logo" value={d.logo} alt={d.businessName} section="brand" onChange={(url) => set({ logo: url })} />
      </Card>
      <div className="mt-4" />
      <Card title="Social links">
        <Field label="Facebook"><Text value={social.facebook} onChange={(v) => set({ social: { ...social, facebook: v } })} /></Field>
        <Field label="Instagram"><Text value={social.instagram} onChange={(v) => set({ social: { ...social, instagram: v } })} /></Field>
        <Field label="TikTok"><Text value={social.tiktok} onChange={(v) => set({ social: { ...social, tiktok: v } })} /></Field>
      </Card>
      <SaveBar dirty={dirty} onSave={() => onSave(d)} />
    </>
  );
}

function HomeForm({ data, onSave }) {
  const [d, set, dirty] = useDraft(data);
  const sec = d.sections || {};
  const popular = d.popularCategories || [];
  const signature = d.signatureItems || [];
  const steps = d.howItWorksSteps || [];

  const setPopular = (i, patch) => set({
    popularCategories: popular.map((x, idx) => (idx === i ? { ...x, ...patch } : x)),
  });
  const setSignature = (i, patch) => set({
    signatureItems: signature.map((x, idx) => (idx === i ? { ...x, ...patch } : x)),
  });
  const setStep = (i, patch) => set({
    howItWorksSteps: steps.map((x, idx) => (idx === i ? { ...x, ...patch } : x)),
  });

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        All fields below are pre-filled from the live site. Images under <code className="font-mono text-xs">/images/…</code> ship with the app on cPanel.
        Upload only when replacing a photo — uploads go to persistent <code className="font-mono text-xs">/uploads/cms/</code>.
      </p>

      <Card title="Hero">
        <Field label="Heading line 1"><Text value={d.heroHeadingLine1} onChange={(v) => set({ heroHeadingLine1: v })} /></Field>
        <Field label="Heading line 2 (brand color)"><Text value={d.heroHeadingLine2} onChange={(v) => set({ heroHeadingLine2: v })} /></Field>
        <Field label="Heading line 3"><Text value={d.heroHeadingLine3} onChange={(v) => set({ heroHeadingLine3: v })} /></Field>
        <Field label="Eyebrow / microcopy"><Text value={d.heroEyebrow} onChange={(v) => set({ heroEyebrow: v })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Hero description"><TextArea rows={4} value={d.heroDescription} onChange={(v) => set({ heroDescription: v })} /></Field>
        </div>
        <Field label="Primary CTA label"><Text value={d.primaryCta?.label} onChange={(v) => set({ primaryCta: { ...d.primaryCta, label: v } })} /></Field>
        <Field label="Primary CTA link"><Text value={d.primaryCta?.href} onChange={(v) => set({ primaryCta: { ...d.primaryCta, href: v } })} /></Field>
        <Field label="Secondary CTA label"><Text value={d.secondaryCta?.label} onChange={(v) => set({ secondaryCta: { ...d.secondaryCta, label: v } })} /></Field>
        <Field label="Secondary CTA link" hint="Use whatsapp, tel, or a path"><Text value={d.secondaryCta?.href} onChange={(v) => set({ secondaryCta: { ...d.secondaryCta, href: v } })} /></Field>
        <Field label="Badge value"><Text value={d.heroBadgeValue} onChange={(v) => set({ heroBadgeValue: v })} /></Field>
        <Field label="Badge label"><Text value={d.heroBadgeLabel} onChange={(v) => set({ heroBadgeLabel: v })} /></Field>
        <ImageUpload label="Hero main image" value={d.heroImage} alt={d.heroImageAlt} section="home"
          onChange={(url, a) => set({ heroImage: url, heroImageAlt: a || d.heroImageAlt })} />
        <ImageUpload label="Hero inset image" value={d.heroInsetImage} alt={d.heroInsetAlt} section="home"
          onChange={(url, a) => set({ heroInsetImage: url, heroInsetAlt: a || d.heroInsetAlt })} />
      </Card>

      <Card title="Popular categories">
        <Field label="Section title"><Text value={d.popularTitle} onChange={(v) => set({ popularTitle: v })} /></Field>
        <Field label="Section lead"><Text value={d.popularLead} onChange={(v) => set({ popularLead: v })} /></Field>
        <div className="sm:col-span-2 space-y-3">
          {popular.map((c, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3 grid gap-2 sm:grid-cols-2">
              <Field label="Title"><Text value={c.title} onChange={(v) => setPopular(i, { title: v })} /></Field>
              <Field label="Note"><Text value={c.note} onChange={(v) => setPopular(i, { note: v })} /></Field>
              <ImageUpload label="Image (blank = text tile)" value={c.img} alt={c.title} section="home"
                onChange={(url) => setPopular(i, { img: url })} />
              <button type="button" onClick={() => set({ popularCategories: popular.filter((_, idx) => idx !== i) })}
                className="text-xs text-red-600 sm:col-span-2">Remove category</button>
            </div>
          ))}
          <button type="button"
            onClick={() => set({ popularCategories: [...popular, { title: 'New', note: '', img: '', href: '/menu' }] })}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium hover:bg-gray-50">
            <Plus className="h-3.5 w-3.5" /> Add category
          </button>
        </div>
      </Card>

      <Card title="Signature dishes">
        <Field label="Section title"><Text value={d.signatureTitle} onChange={(v) => set({ signatureTitle: v })} /></Field>
        <Field label="Section lead"><Text value={d.signatureLead} onChange={(v) => set({ signatureLead: v })} /></Field>
        <div className="sm:col-span-2 space-y-3">
          {signature.map((it, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3 grid gap-2 sm:grid-cols-2">
              <Field label="Name"><Text value={it.name} onChange={(v) => setSignature(i, { name: v })} /></Field>
              <Field label="Category"><Text value={it.category} onChange={(v) => setSignature(i, { category: v })} /></Field>
              <ImageUpload label="Image" value={it.img} alt={it.name} section="home"
                onChange={(url) => setSignature(i, { img: url })} />
              <button type="button" onClick={() => set({ signatureItems: signature.filter((_, idx) => idx !== i) })}
                className="text-xs text-red-600 sm:col-span-2">Remove dish</button>
            </div>
          ))}
          <button type="button"
            onClick={() => set({ signatureItems: [...signature, { name: 'New dish', category: '', img: '', href: '/menu' }] })}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium hover:bg-gray-50">
            <Plus className="h-3.5 w-3.5" /> Add dish
          </button>
        </div>
      </Card>

      <Card title="How it works">
        <Field label="Title"><Text value={d.howItWorksTitle} onChange={(v) => set({ howItWorksTitle: v })} /></Field>
        <Field label="Lead"><Text value={d.howItWorksLead} onChange={(v) => set({ howItWorksLead: v })} /></Field>
        <div className="sm:col-span-2 space-y-3">
          {steps.map((s, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3 grid gap-2 sm:grid-cols-2">
              <Field label={`Step ${i + 1} title`}><Text value={s.title} onChange={(v) => setStep(i, { title: v })} /></Field>
              <Field label="Text"><Text value={s.text} onChange={(v) => setStep(i, { text: v })} /></Field>
            </div>
          ))}
        </div>
      </Card>

      <Card title="On the menu (preview band)">
        <Field label="Title"><Text value={d.menuTitle} onChange={(v) => set({ menuTitle: v })} /></Field>
        <Field label="Lead"><Text value={d.menuLead} onChange={(v) => set({ menuLead: v })} /></Field>
        <Field label="CTA label"><Text value={d.menuCtaLabel} onChange={(v) => set({ menuCtaLabel: v })} /></Field>
        <Field label="CTA link"><Text value={d.menuCtaHref} onChange={(v) => set({ menuCtaHref: v })} /></Field>
        <p className="sm:col-span-2 text-xs text-gray-500">Menu items and prices always come from the POS menu — edit dishes there.</p>
      </Card>

      <Card title="About strip (home)">
        <Field label="Title"><Text value={d.aboutStripTitle} onChange={(v) => set({ aboutStripTitle: v })} /></Field>
        <Field label="CTA label"><Text value={d.aboutStripCtaLabel} onChange={(v) => set({ aboutStripCtaLabel: v })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Body text"><TextArea rows={4} value={d.aboutStripText} onChange={(v) => set({ aboutStripText: v })} /></Field>
        </div>
        <ImageUpload label="About strip image" value={d.aboutStripImage} alt={d.aboutStripImageAlt} section="home"
          onChange={(url, a) => set({ aboutStripImage: url, aboutStripImageAlt: a || d.aboutStripImageAlt })} />
      </Card>

      <Card title="Gallery strip + Find us">
        <Field label="Gallery title"><Text value={d.galleryTitle} onChange={(v) => set({ galleryTitle: v })} /></Field>
        <Field label="Gallery CTA"><Text value={d.galleryCtaLabel} onChange={(v) => set({ galleryCtaLabel: v })} /></Field>
        <Field label="Home gallery count"><Text type="number" value={d.galleryLimit} onChange={(v) => set({ galleryLimit: Number(v) || 6 })} /></Field>
        <Field label="Find us title"><Text value={d.findUsTitle} onChange={(v) => set({ findUsTitle: v })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Find us lead"><Text value={d.findUsLead} onChange={(v) => set({ findUsLead: v })} /></Field>
        </div>
        <p className="sm:col-span-2 text-xs text-gray-500">Gallery photos themselves are edited under the Gallery tab.</p>
      </Card>

      <Card title="Section visibility">
        {['hero', 'popular', 'signature', 'howItWorks', 'menu', 'about', 'gallery', 'findUs'].map((s) => (
          <label key={s} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
            <span className="text-sm capitalize text-gray-700">{s.replace(/([A-Z])/g, ' $1')}</span>
            <button type="button" onClick={() => set({ sections: { ...sec, [s]: !sec[s] } })}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${sec[s] !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
              {sec[s] !== false ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              {sec[s] !== false ? 'Visible' : 'Hidden'}
            </button>
          </label>
        ))}
      </Card>

      <SaveBar dirty={dirty} onSave={() => onSave(d)} />
    </div>
  );
}

function AboutForm({ data, onSave }) {
  const [d, set, dirty] = useDraft(data);
  const features = d.features || [];
  const images = d.images || [];

  const setFeature = (i, patch) => set({
    features: features.map((x, idx) => (idx === i ? { ...x, ...patch } : x)),
  });

  return (
    <div className="space-y-4">
      <Card title="About page">
        <Field label="Heading"><Text value={d.heading} onChange={(v) => set({ heading: v })} /></Field>
        <Field label="Visit heading"><Text value={d.visitHeading} onChange={(v) => set({ visitHeading: v })} /></Field>
        <label className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
          <span className="text-sm text-gray-700">Visible on site</span>
          <button type="button" onClick={() => set({ visible: !d.visible })}
            className={`rounded-full px-2 py-1 text-xs font-medium ${d.visible !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {d.visible !== false ? 'Visible' : 'Hidden'}
          </button>
        </label>
        <div className="sm:col-span-2">
          <Field label="Main description"><TextArea rows={4} value={d.description} onChange={(v) => set({ description: v })} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Extra paragraph"><TextArea rows={5} value={d.descriptionExtra} onChange={(v) => set({ descriptionExtra: v })} /></Field>
        </div>
        <ImageUpload label="Lead image" value={images[0] || ''} alt={d.heading} section="about"
          onChange={(url) => {
            const next = [...images];
            if (url) next[0] = url; else next.shift();
            set({ images: next.filter(Boolean) });
          }} />
        <ImageUpload label="Second image (optional)" value={images[1] || ''} alt={d.heading} section="about"
          onChange={(url) => {
            const next = [images[0] || ''].filter(Boolean);
            if (url) next.push(url);
            set({ images: next });
          }} />
      </Card>

      <Card title="Feature cards">
        <div className="sm:col-span-2 space-y-3">
          {features.map((f, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3 grid gap-2 sm:grid-cols-2">
              <Field label="Title"><Text value={f.title} onChange={(v) => setFeature(i, { title: v })} /></Field>
              <Field label="Text"><Text value={f.text} onChange={(v) => setFeature(i, { text: v })} /></Field>
              <button type="button" onClick={() => set({ features: features.filter((_, idx) => idx !== i) })}
                className="text-xs text-red-600 sm:col-span-2">Remove</button>
            </div>
          ))}
          <button type="button"
            onClick={() => set({ features: [...features, { title: 'New feature', text: '' }] })}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium hover:bg-gray-50">
            <Plus className="h-3.5 w-3.5" /> Add feature
          </button>
        </div>
      </Card>
      <SaveBar dirty={dirty} onSave={() => onSave(d)} />
    </div>
  );
}

function GalleryForm({ data, onSave }) {
  const [d, setDraft] = useState(data);
  useEffect(() => setDraft(data), [data]);
  const items = d.items || [];
  const dirty = JSON.stringify(d) !== JSON.stringify(data);
  const [newAlt, setNewAlt] = useState('');
  const inputRef = useRef(null);
  const [err, setErr] = useState(null);
  const [pathInput, setPathInput] = useState('');

  const set = (patch) => setDraft((prev) => ({ ...prev, ...patch }));
  const setItems = (next) => set({ items: typeof next === 'function' ? next(items) : next });

  const uploadNew = (file) => {
    if (!file) return;
    if (!newAlt.trim()) { setErr('Enter alt text before uploading.'); return; }
    setErr(null);
    const fd = new FormData();
    fd.append('file', file); fd.append('alt', newAlt); fd.append('section', 'gallery');
    fetch('/api/admin/cms/media', { method: 'POST', headers: authHeaders(), body: fd })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) { setErr(j.error || 'Upload failed'); return; }
        setItems((it) => [...it, { url: j.media.url, title: '', alt: newAlt, order: it.length, visible: true }]);
        setNewAlt('');
      })
      .catch(() => setErr('Upload failed'));
  };

  const addPath = () => {
    const url = pathInput.trim();
    if (!url) return;
    setItems((it) => [...it, { url, title: '', alt: newAlt || 'Sundar Bagaicha', order: it.length, visible: true }]);
    setPathInput('');
    setNewAlt('');
  };

  const update = (i, patch) => setItems((it) => it.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const remove = (i) => setItems((it) => it.filter((_, idx) => idx !== i));

  return (
    <>
      <Card title="Gallery page copy">
        <Field label="Heading"><Text value={d.heading} onChange={(v) => set({ heading: v })} /></Field>
        <Field label="Lead"><Text value={d.lead} onChange={(v) => set({ lead: v })} /></Field>
      </Card>
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm text-gray-500">
          Prefills use <code className="font-mono text-xs">/images/…</code> from the project folder (also used on cPanel).
          Paste a path or upload a new file.
        </p>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input value={newAlt} onChange={(e) => setNewAlt(e.target.value)} placeholder="Alt text"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} placeholder="/images/photo.jpg"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono text-xs" />
          <button type="button" onClick={addPath} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
            <Plus className="h-4 w-4" /> Add path
          </button>
          <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
            <UploadCloud className="h-4 w-4" /> Upload
          </button>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadNew(e.target.files?.[0])} />
        </div>
        {err && <p className="mb-3 text-xs text-red-600">{err}</p>}
        {!items.length ? (
          <p className="py-8 text-center text-sm text-gray-400">No gallery images yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it, i) => (
              <div key={i} className="rounded-xl border border-gray-200 p-3">
                <img src={it.url} alt={it.alt || ''} className="h-36 w-full rounded-lg object-cover" />
                <input value={it.url || ''} onChange={(e) => update(i, { url: e.target.value })} placeholder="Image path"
                  className="mt-2 w-full rounded border border-gray-200 px-2 py-1 text-xs font-mono" />
                <input value={it.title || ''} onChange={(e) => update(i, { title: e.target.value })} placeholder="Title"
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs" />
                <input value={it.alt || ''} onChange={(e) => update(i, { alt: e.target.value })} placeholder="Alt text"
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs" />
                <div className="mt-2 flex items-center justify-between">
                  <button type="button" onClick={() => update(i, { visible: it.visible === false })}
                    className={`rounded-full px-2 py-0.5 text-xs ${it.visible !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {it.visible !== false ? 'Visible' : 'Hidden'}
                  </button>
                  <button type="button" onClick={() => remove(i)} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <SaveBar dirty={dirty} onSave={() => onSave({ ...d, items: items.map((x, i) => ({ ...x, order: i })) })} />
    </>
  );
}

function ContactForm({ data, onSave }) {
  const [d, set, dirty] = useDraft(data);
  const social = d.social || {};
  return (
    <>
      <Card title="Contact details">
        <Field label="Phone"><Text value={d.phone} onChange={(v) => set({ phone: v })} /></Field>
        <Field label="WhatsApp"><Text value={d.whatsapp} onChange={(v) => set({ whatsapp: v })} /></Field>
        <Field label="Email"><Text value={d.email} onChange={(v) => set({ email: v })} type="email" /></Field>
        <Field label="Location text"><Text value={d.location} onChange={(v) => set({ location: v })} /></Field>
        <Field label="Map embed URL"><Text value={d.mapEmbed} onChange={(v) => set({ mapEmbed: v })} /></Field>
        <Field label="Facebook"><Text value={social.facebook} onChange={(v) => set({ social: { ...social, facebook: v } })} /></Field>
        <Field label="Instagram"><Text value={social.instagram} onChange={(v) => set({ social: { ...social, instagram: v } })} /></Field>
        <Field label="TikTok"><Text value={social.tiktok} onChange={(v) => set({ social: { ...social, tiktok: v } })} /></Field>
      </Card>
      <SaveBar dirty={dirty} onSave={() => onSave(d)} />
    </>
  );
}

function SeoForm({ data, onSave }) {
  const [d, set, dirty] = useDraft(data);
  return (
    <>
      <Card title="SEO & sharing">
        <Field label="Page title"><Text value={d.title} onChange={(v) => set({ title: v })} /></Field>
        <Field label="Canonical URL"><Text value={d.canonical} onChange={(v) => set({ canonical: v })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Meta description" hint="~155 characters"><TextArea value={d.description} onChange={(v) => set({ description: v })} /></Field>
        </div>
        <ImageUpload label="Open Graph image" value={d.ogImage} alt={d.title} section="seo" onChange={(url) => set({ ogImage: url })} />
      </Card>
      <SaveBar dirty={dirty} onSave={() => onSave(d)} />
    </>
  );
}

function MediaLibrary() {
  const { confirm, prompt, alert } = useConfirm();
  const [media, setMedia] = useState([]);
  const [counts, setCounts] = useState({ uploads: 0, site: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | site | upload | in_use
  const [copied, setCopied] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/cms/media', { headers: authHeaders() });
    const j = await res.json().catch(() => ({ media: [] }));
    setMedia(j.media || []);
    setCounts(j.counts || { uploads: 0, site: 0 });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const del = async (m) => {
    if (m.source === 'site') {
      await alert({
        title: 'Cannot delete site image',
        message: 'Site images live in public/images and cannot be deleted from the CMS. Remove the file from the server folder if needed.',
      });
      return;
    }
    let res = await fetch(`/api/admin/cms/media?id=${m.id}`, { method: 'DELETE', headers: authHeaders() });
    if (res.status === 409) {
      const ok = await confirm({
        title: 'Delete image?',
        message: 'This image is still used in published content. Delete anyway?',
        tone: 'delete',
      });
      if (!ok) return;
      res = await fetch(`/api/admin/cms/media?id=${m.id}&force=1`, { method: 'DELETE', headers: authHeaders() });
    }
    if (res.ok) setMedia((x) => x.filter((i) => i.id !== m.id));
  };

  const copyPath = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      await prompt({
        title: 'Copy image path',
        message: 'Clipboard unavailable. Copy the path below:',
        defaultValue: url,
        required: false,
      });
    }
  };

  const filtered = media.filter((m) => {
    if (filter === 'site') return m.source === 'site';
    if (filter === 'upload') return m.source === 'upload';
    if (filter === 'in_use') return m.in_use;
    return true;
  });

  if (loading) return <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          <span className="font-medium text-gray-800">{counts.site}</span> site images in <code className="text-xs">public/images</code>
          {' · '}
          <span className="font-medium text-gray-800">{counts.uploads}</span> CMS uploads
        </p>
        <div className="flex flex-wrap gap-1">
          {[
            { id: 'all', label: 'All' },
            { id: 'site', label: 'Site folder' },
            { id: 'upload', label: 'Uploads' },
            { id: 'in_use', label: 'In use' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === f.id ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {!filtered.length ? (
        <p className="py-16 text-center text-sm text-gray-400">
          {filter === 'upload'
            ? 'No CMS uploads yet. Upload from any section form — files go to /uploads/cms/.'
            : 'No images found for this filter.'}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((m) => (
            <div key={m.id} className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
              <img src={m.url} alt={m.alt || ''} className="h-32 w-full rounded-lg object-cover bg-gray-50" />
              <p className="mt-2 truncate text-xs text-gray-600" title={m.alt || m.url}>{m.alt || m.url.split('/').pop()}</p>
              <p className="truncate font-mono text-[10px] text-gray-400" title={m.url}>{m.url}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${m.source === 'site' ? 'bg-sky-50 text-sky-700' : 'bg-violet-50 text-violet-700'}`}>
                  {m.source === 'site' ? 'Site' : 'Upload'}
                </span>
                {m.in_use && (
                  <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">In use</span>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400">
                <button type="button" onClick={() => copyPath(m.url)} className="font-medium text-indigo-600 hover:text-indigo-800">
                  {copied === m.url ? 'Copied' : 'Copy path'}
                </button>
                {m.source === 'upload' ? (
                  <button type="button" onClick={() => del(m)} className="text-red-500 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /></button>
                ) : (
                  <span className="text-[10px]">Folder file</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
