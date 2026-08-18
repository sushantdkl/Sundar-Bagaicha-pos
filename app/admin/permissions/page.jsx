'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, RefreshCw, Save, History } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import { apiJson } from '@/lib/authed-fetch';
import { friendlyFromError, friendlyMessage } from '@/lib/friendly-message';
import { useToast } from '@/components/ui/toast';
import { formatNepalTime } from '@/lib/time-utils';

const ROLE_LABEL = { waiter: 'Waiter', cashier: 'Cashier', kitchen: 'Kitchen' };

export default function PermissionsPage() {
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [audit, setAudit] = useState([]);
  const [showAudit, setShowAudit] = useState(false);
  const [pending, setPending] = useState({}); // { "role:key": boolean } — unsaved edits
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiJson('/api/admin/permissions'));
      setPending({});
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const loadAudit = async () => {
    if (showAudit) { setShowAudit(false); return; }
    try {
      const res = await apiJson('/api/admin/permissions?view=audit');
      setAudit(res.audit || []);
      setShowAudit(true);
    } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
  };

  const valueFor = (role, key) => {
    const pendingKey = `${role}:${key}`;
    if (pendingKey in pending) return pending[pendingKey];
    return !!data?.matrix?.[role]?.[key];
  };

  const toggle = (role, key) => {
    const pendingKey = `${role}:${key}`;
    setPending((prev) => ({ ...prev, [pendingKey]: !valueFor(role, key) }));
  };

  const dirtyCount = Object.keys(pending).length;

  const save = async () => {
    if (!dirtyCount) return;
    setSaving(true);
    try {
      const updates = Object.entries(pending).map(([id, allowed]) => {
        const [role, key] = id.split(':');
        return { role, key, allowed };
      });
      const res = await apiJson('/api/admin/permissions', { method: 'PUT', body: JSON.stringify({ updates }) });
      setData(res);
      setPending({});
      addToast(friendlyMessage('save_success', { description: `${updates.length} permission(s) updated.` }));
      if (showAudit) loadAudit();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally { setSaving(false); }
  };

  const grouped = useMemo(() => {
    const byCategory = {};
    for (const item of data?.catalog || []) {
      (byCategory[item.category] ||= []).push(item);
    }
    return byCategory;
  }, [data]);

  return <AdminLayout>
    <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center bg-red-700 text-white"><ShieldCheck className="h-5 w-5" /></div>
          <div><h1 className="text-2xl font-bold text-gray-950 sm:text-3xl">Staff Permissions</h1><p className="mt-1 text-sm text-gray-500">Control exactly which sensitive actions waiters, cashiers and kitchen staff can perform. Admin always has full access.</p></div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={loadAudit} className="inline-flex h-10 items-center gap-2 border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"><History className="h-4 w-4" />{showAudit ? 'Hide history' : 'Change history'}</button>
          <button type="button" onClick={load} disabled={loading} title="Refresh" className="inline-flex h-10 w-10 items-center justify-center border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>
    </header>

    <main className="bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
      {loading ? <div className="h-64 animate-pulse border border-gray-200 bg-white" /> : (
        <div className="border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  {(data?.roles || []).map((role) => (
                    <th key={role} className="px-4 py-3 text-center font-semibold">{ROLE_LABEL[role] || role}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {Object.entries(grouped).map(([category, items]) => (
                  <Fragment key={category}>
                    <tr className="bg-gray-50/70">
                      <td colSpan={(data?.roles?.length || 0) + 1} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{category}</td>
                    </tr>
                    {items.map((item) => (
                      <tr key={item.key}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-950">{item.label}</div>
                          <div className="text-xs text-gray-500">{item.description}</div>
                        </td>
                        {(data?.roles || []).map((role) => {
                          const available = !item.roles || item.roles.includes(role);
                          if (!available) return <td key={role} className="px-4 py-3 text-center text-gray-300">â€”</td>;
                          const checked = valueFor(role, item.key);
                          const isDirty = `${role}:${item.key}` in pending;
                          return (
                            <td key={role} className="px-4 py-3 text-center">
                              <label className="inline-flex cursor-pointer items-center justify-center">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggle(role, item.key)}
                                  className={`h-5 w-5 accent-gray-950 ${isDirty ? 'ring-2 ring-amber-500' : ''}`}
                                />
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-gray-200 px-4 py-4">
            <div className="text-sm text-gray-600">{dirtyCount === 0 ? 'No unsaved changes.' : `${dirtyCount} unsaved change(s).`}</div>
            <button type="button" disabled={saving || !dirtyCount} onClick={save} className="inline-flex h-11 items-center gap-2 bg-gray-950 px-5 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"><Save className="h-4 w-4" />Save Changes</button>
          </div>
        </div>
      )}

      {showAudit && (
        <section className="mt-6 border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4"><h2 className="text-sm font-semibold text-gray-950">Change History</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr>{['When', 'Role', 'Action', 'Change', 'Changed By'].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {audit.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-gray-600">{formatNepalTime(row.created_at)}</td>
                    <td className="px-4 py-3 text-gray-600">{ROLE_LABEL[row.role] || row.role}</td>
                    <td className="px-4 py-3 text-gray-950">{row.permission_key}</td>
                    <td className="px-4 py-3">{row.previous_value == null ? 'default' : (row.previous_value ? 'Allowed' : 'Blocked')} → <span className={row.new_value ? 'text-emerald-700' : 'text-rose-700'}>{row.new_value ? 'Allowed' : 'Blocked'}</span></td>
                    <td className="px-4 py-3 text-gray-600">{row.actor_name || '-'}</td>
                  </tr>
                ))}
                {audit.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">No permission changes yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  </AdminLayout>;
}
