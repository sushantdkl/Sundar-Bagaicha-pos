'use client';

import { Loader2, Plus, X } from 'lucide-react';

/**
 * Shared chrome for the HRM screens.
 *
 * The five HRM pages are the same shape — header, filters, a table, a modal
 * form — so the shell lives here once. Styling follows the existing admin
 * pages (white cards, gray-200 hairlines, gray-950 primary) rather than
 * introducing a sixth look for one module.
 */

export const INPUT = 'h-10 w-full border border-gray-300 bg-white px-3 text-sm text-gray-900';
export const BTN = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
export const PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-950 bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black disabled:opacity-50 [color:#fff!important]';
export const SMALL = 'inline-flex h-8 items-center gap-1 border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">HRM</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-gray-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** One panel wrapping a table, with its own loading / empty / error states. */
export function DataPanel({ loading, error, empty, emptyTitle, emptyHint, emptyAction, children }) {
  if (loading) {
    return (
      <section className="flex items-center justify-center border border-gray-200 bg-white py-16">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">Loading…</span>
      </section>
    );
  }
  if (error) {
    return (
      <section className="border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        <p className="font-semibold">Could not load this page.</p>
        <p className="mt-1">{error}</p>
      </section>
    );
  }
  if (empty) {
    return (
      <section className="border border-gray-200 bg-white px-6 py-16 text-center">
        <p className="text-base font-semibold text-gray-900">{emptyTitle}</p>
        {emptyHint && <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">{emptyHint}</p>}
        {emptyAction && <div className="mt-5 flex justify-center">{emptyAction}</div>}
      </section>
    );
  }
  return <section className="border border-gray-200 bg-white">{children}</section>;
}

export function Table({ columns, children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            {columns.map((c) => (
              <th key={c.key || c.label} className={`px-4 py-3 font-semibold ${c.align === 'right' ? 'text-right' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  );
}

export function StatusBadge({ active, activeLabel = 'Active', inactiveLabel = 'Archived' }) {
  return (
    <span
      className={`inline-block whitespace-nowrap px-2 py-1 text-xs font-semibold ${
        active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}

/** Modal form. Submitting is disabled while saving so one click means one write. */
export function FormDialog({ title, onClose, onSubmit, saving, submitLabel = 'Save', wide, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <form
        onSubmit={onSubmit}
        className={`my-8 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} border border-gray-200 bg-white shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="font-bold text-gray-900">{title}</h2>
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">{children}</div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="submit" disabled={saving} className={PRIMARY}>
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export function Field({ label, hint, required, wide, children }) {
  return (
    <label className={`text-sm font-medium text-gray-700 ${wide ? 'sm:col-span-2' : ''}`}>
      {label}{required && <span className="text-red-600"> *</span>}
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs font-normal text-gray-500">{hint}</p>}
    </label>
  );
}

export function AddButton({ onClick, label }) {
  return (
    <button type="button" onClick={onClick} className={PRIMARY}>
      <Plus className="h-4 w-4" />{label}
    </button>
  );
}
