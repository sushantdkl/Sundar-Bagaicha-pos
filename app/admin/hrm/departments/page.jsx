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

const EMPTY = { name: '', description: '', is_active: true };

export default function DepartmentsPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const d = await apiJson(`/api/admin/hrm/departments${showArchived ? '?all=1' : ''}`);
      setRows(d.departments || []);
    } catch (e) {
      setError(e?.error || e?.message || 'Request failed.');
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const editing = Boolean(form.id);
      await apiJson('/api/admin/hrm/departments', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      });
      addToast({ type: 'success', title: editing ? 'Department updated.' : 'Department created.' });
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
      await apiJson('/api/admin/hrm/departments', {
        method: 'PATCH',
        body: JSON.stringify({ id: row.id, is_active: !row.is_active }),
      });
      addToast({ type: 'success', title: row.is_active ? 'Department archived.' : 'Department restored.' });
      await load();
    } catch (err) {
      addToast(friendlyFromError(err, 'save_failed'));
    }
  };

  const q = search.trim().toLowerCase();
  const visible = q ? rows.filter((r) => String(r.name).toLowerCase().includes(q)) : rows;

  return (
    <AdminLayout>
      <PageHeader
        title="Departments"
        subtitle="The parts of the business staff belong to. A department with people in it is archived, never deleted, so their history stays intact."
        actions={<AddButton onClick={() => setForm({ ...EMPTY })} label="Add Department" />}
      />

      <main className="space-y-4 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search departments" className={`${INPUT} max-w-xs`}
          />
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
          empty={!visible.length}
          emptyTitle={q ? 'No departments match that search' : 'No departments yet'}
          emptyHint={q ? 'Try a different name.' : 'Add your first department to start organising staff.'}
          emptyAction={!q && <AddButton onClick={() => setForm({ ...EMPTY })} label="Add Department" />}
        >
          <Table
            columns={[
              { label: 'Department' },
              { label: 'Description' },
              { label: 'Staff', align: 'right' },
              { label: 'Designations', align: 'right' },
              { label: 'Status' },
              { label: '' },
            ]}
          >
            {visible.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-semibold text-gray-900">{r.name}</td>
                <td className="px-4 py-3 text-gray-600">{r.description || <span className="text-gray-400">—</span>}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.staff_count ?? 0}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.designation_count ?? 0}</td>
                <td className="px-4 py-3"><StatusBadge active={Boolean(r.is_active)} /></td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button" className={SMALL}
                      onClick={() => setForm({
                        id: r.id, name: r.name, description: r.description || '', is_active: Boolean(r.is_active),
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
          title={form.id ? `Edit ${form.name}` : 'Add department'}
          onClose={() => setForm(null)}
          onSubmit={submit}
          saving={saving}
          submitLabel={form.id ? 'Save changes' : 'Add Department'}
        >
          <Field label="Department name" required wide>
            <input
              required autoFocus value={form.name} className={INPUT}
              placeholder="Kitchen, Service, Housekeeping…"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Description" wide>
            <input
              value={form.description} className={INPUT}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <Field label="Status" wide hint="Archived departments stay on existing staff records but are not offered for new assignments.">
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
