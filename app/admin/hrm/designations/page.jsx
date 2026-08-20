'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Pencil } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { apiJson } from '@/lib/authed-fetch';
import { friendlyFromError } from '@/lib/friendly-message';
import {
  PageHeader, DataPanel, Table, StatusBadge, FormDialog, Field, AddButton,
  INPUT, SMALL,
} from '../hrm-ui';

const EMPTY = { name: '', department_id: '', description: '', is_active: true };

export default function DesignationsPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (showArchived) params.set('all', '1');
      if (departmentFilter) params.set('department_id', departmentFilter);
      const qs = params.toString();
      const [d, deps] = await Promise.all([
        apiJson(`/api/admin/hrm/designations${qs ? `?${qs}` : ''}`),
        apiJson('/api/admin/hrm/departments').catch(() => ({ departments: [] })),
      ]);
      setRows(d.designations || []);
      setDepartments(deps.departments || []);
    } catch (e) {
      setError(e?.error || e?.message || 'Request failed.');
    } finally {
      setLoading(false);
    }
  }, [showArchived, departmentFilter]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const editing = Boolean(form.id);
      await apiJson('/api/admin/hrm/designations', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...form, department_id: form.department_id || null }),
      });
      addToast({ type: 'success', title: editing ? 'Designation updated.' : 'Designation created.' });
      setForm(null);
      await load();
    } catch (err) {
      addToast(friendlyFromError(err, 'save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row) => {
    try {
      await apiJson('/api/admin/hrm/designations', {
        method: 'PATCH',
        body: JSON.stringify({ id: row.id, is_active: !row.is_active }),
      });
      addToast({ type: 'success', title: row.is_active ? 'Designation archived.' : 'Designation restored.' });
      await load();
    } catch (err) {
      addToast(friendlyFromError(err, 'save_failed'));
    }
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Designations"
        subtitle="Job titles, optionally scoped to a department. A designation is what the business calls the role — it is not a system role and never changes what someone can do in the POS."
        actions={<AddButton onClick={() => setForm({ ...EMPTY })} label="Add Designation" />}
      />

      <main className="space-y-4 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}
            className={`${INPUT} max-w-xs`}
          >
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox" className="h-4 w-4"
              checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>

        <DataPanel
          loading={loading}
          error={error}
          empty={!rows.length}
          emptyTitle="No designations yet"
          emptyHint="Add job titles like Chef, Waiter or Delivery Executive so staff records can carry one."
          emptyAction={<AddButton onClick={() => setForm({ ...EMPTY })} label="Add Designation" />}
        >
          <Table
            columns={[
              { label: 'Designation' },
              { label: 'Department' },
              { label: 'Description' },
              { label: 'Staff', align: 'right' },
              { label: 'Status' },
              { label: '' },
            ]}
          >
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-semibold text-gray-900">{r.name}</td>
                <td className="px-4 py-3 text-gray-700">
                  {r.department_name || <span className="text-gray-400">Unassigned</span>}
                </td>
                <td className="px-4 py-3 text-gray-600">{r.description || <span className="text-gray-400">—</span>}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.staff_count ?? 0}</td>
                <td className="px-4 py-3"><StatusBadge active={Boolean(r.is_active)} /></td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button" className={SMALL}
                      onClick={() => setForm({
                        id: r.id, name: r.name, department_id: r.department_id || '',
                        description: r.description || '', is_active: Boolean(r.is_active),
                      })}
                    >
                      <Pencil className="h-3.5 w-3.5" />Edit
                    </button>
                    <button type="button" className={SMALL} onClick={() => toggleActive(r)}>
                      {r.is_active ? 'Archive' : 'Restore'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </DataPanel>
      </main>

      {form && (
        <FormDialog
          title={form.id ? `Edit ${form.name}` : 'Add designation'}
          onClose={() => setForm(null)}
          onSubmit={submit}
          saving={saving}
          submitLabel={form.id ? 'Save changes' : 'Add Designation'}
        >
          <Field label="Designation name" required>
            <input
              required autoFocus value={form.name} className={INPUT}
              placeholder="Chef, Waiter, Delivery Executive…"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Department" hint="Optional. The same title can exist in two departments.">
            <select
              value={form.department_id} className={INPUT}
              onChange={(e) => setForm({ ...form, department_id: e.target.value })}
            >
              <option value="">Unassigned</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Description" wide>
            <input
              value={form.description} className={INPUT}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <Field label="Status" wide>
            <select
              value={form.is_active ? '1' : '0'} className={INPUT}
              onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}
            >
              <option value="1">Active</option>
              <option value="0">Archived</option>
            </select>
          </Field>
        </FormDialog>
      )}
    </AdminLayout>
  );
}
