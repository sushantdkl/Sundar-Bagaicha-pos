'use client';

/**
 * Themed input + dropdown (a combobox). Type to filter, click to pick, and —
 * when allowCustom — keep whatever was typed even if it is not in the list.
 * Replaces the native <input list>/<datalist> and <select> so every picker
 * matches the app's look instead of the browser's.
 *
 * Pass either flat `options` [{value,label,hint?}] or `groups`
 * [{label, options:[...]}]. The input mirrors `value` directly, so it works as
 * a controlled free-text field.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

const BASE = 'h-11 w-full rounded-lg border border-gray-300 bg-white pl-3 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200';

export default function Combobox({
  value,
  onChange,
  onBlur,
  options = [],
  groups = null,
  placeholder = '',
  disabled = false,
  allowCustom = true,
  className = '',
  autoFocus = false,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const listId = `cbx-${useId().replace(/:/g, '')}`;

  const flat = useMemo(
    () => (groups ? groups.flatMap((g) => g.options.map((o) => ({ ...o, group: g.label }))) : options),
    [groups, options]
  );

  const q = String(value ?? '').toLowerCase().trim();
  const filtered = useMemo(() => {
    if (!q) return flat;
    return flat.filter(
      (o) => String(o.label).toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q)
    );
  }, [flat, q]);

  // Group the filtered rows back for rendering when groups were provided.
  const rendered = useMemo(() => {
    if (!groups) return [{ label: null, options: filtered }];
    const map = new Map();
    for (const o of filtered) {
      if (!map.has(o.group)) map.set(o.group, []);
      map.get(o.group).push(o);
    }
    return Array.from(map, ([label, opts]) => ({ label, options: opts }));
  }, [filtered, groups]);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (opt) => {
    onChange(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && filtered[active]) {
      e.preventDefault();
      pick(filtered[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={value ?? ''}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={(e) => onBlur?.(e)}
        className={className || BASE}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="absolute right-0 top-0 flex h-11 w-9 items-center justify-center text-gray-400 hover:text-gray-600"
        aria-label="Toggle options"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && filtered.length > 0 && (
        <div id={listId} role="listbox" className="absolute z-[60] mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {rendered.map((group, gi) => (
            <div key={group.label ?? gi}>
              {group.label && (
                <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{group.label}</p>
              )}
              {group.options.map((o) => {
                const idx = filtered.indexOf(o);
                const selected = String(o.value).toLowerCase() === q;
                return (
                  <button
                    key={`${o.group ?? ''}-${o.value}`}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o)}
                    onMouseEnter={() => setActive(idx)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                      idx === active ? 'bg-gray-100' : ''
                    } ${selected ? 'font-medium text-gray-900' : 'text-gray-700'}`}
                  >
                    <span className="flex-1 truncate">
                      {o.label}
                      {o.hint && <span className="ml-1 text-xs text-gray-400">{o.hint}</span>}
                    </span>
                    {selected && <Check className="h-4 w-4 text-gray-900" />}
                  </button>
                );
              })}
            </div>
          ))}
          {allowCustom && q && !flat.some((o) => String(o.value).toLowerCase() === q) && (
            <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-400">Keep “{value}” as a custom entry</p>
          )}
        </div>
      )}
    </div>
  );
}
