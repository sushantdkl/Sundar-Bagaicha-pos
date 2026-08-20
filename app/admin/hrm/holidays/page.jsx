'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Pencil } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { apiJson } from '@/lib/authed-fetch';
import { friendlyFromError } from '@/lib/friendly-message';
import { nepalDateString } from '@/lib/report-dates';
import {
  PageHeader, DataPanel, Table, StatusBadge, FormDialog, Field, AddButton,
  INPUT, SMALL,
} from '../hrm-ui';

const EMPTY = {
  name: '', holiday_date: '', end_date: '', description: '',
  department_id: '', is_paid: true, is_active: true,
};

const day = (v) => String(v || '').slice(0, 10);

export default function HolidaysPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [year, setYear] = useState(() => nepalDateString().slice(0, 4));
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [h, deps] = await Promise.all([
        apiJson(`/api/admin/hrm/holidays?year=${year}&all=1`),
        apiJson('/api/admin/hrm/departments').catch(() => ({ departments: [] })),
      ]);
      setRows(h.holidays || []);
      setDepartments(deps.departments || []);
    } catch (e) {
      setError(e?.error || e?.message || 'Request failed.');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const today = nepalDateString();
  const upcoming = useMemo(
    () => rows.filter((r) => r.is_active && day(r.end_date || r.holiday_date) >= today).length,
    [rows, today]
  );

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (form.end_date && form.end_date < form.holiday_date) {
      addToast({ type: 'error', title: 'The end date cannot be before the start date.' });
      return;
    }
    setSaving(true);
    try {
      const editing = Boolean(form.id);
      await apiJson('/api/admin/hrm/holidays', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...form,
          end_date: form.end_date || null,
          department_id: form.department_id || null,
        }),
      });
      addToast({ type: 'success', title: editing ? 'Holiday updated.' : 'Holiday added.' });
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
      await apiJson('/api/admin/hrm/holidays', {
        method: 'PATCH',
        body: JSON.stringify({ id: row.id, is_active: !row.is_active }),
      });
      addToast({ type: 'success', title: row.is_active ? 'Holiday archived.' : 'Holiday restored.' });
      await load();
    } catch (err) {
      addToast(friendlyFromError(err, 'save_failed'));
    }
  };

  const years = useMemo(() => {
    const now = Number(nepalDateString().slice(0, 4));
    return [now - 1, now, now + 1].map(String);
  }, []);

  return (
    <AdminLayout>
      <PageHeader
        title="Holidays"
        subtitle="The venue's holiday calendar. Attendance can be marked Holiday against these days; nothing here changes salary calculation on its own."
        actions={<AddButton onClick={() => setForm({ ...EMPTY, holiday_date: today })} label="Add Holiday" />}
      />

      <main className="space-y-4 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <select value={year} onChange={(e) => setYear(e.target.value)} className={`${INPUT} max-w-[10rem]`}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="text-sm text-gray-600">
            {rows.length} holiday{rows.length === 1 ? '' : 's'} in {year} · {upcoming} still upcoming
          </span>
        </div>

        <DataPanel
          loading={loading}
          error={error}
          empty={!rows.length}
          emptyTitle={`No holidays recorded for ${year}`}
          emptyHint="Add the days the venue closes or runs a holiday roster."
          emptyAction={<AddButton onClick={() => setForm({ ...EMPTY, holiday_date: today })} label="Add Holiday" />}
        >
          <Table
            columns={[
              { label: 'Holiday' },
              { label: 'Date' },
              { label: 'Applies to' },
              { label: 'Paid' },
              { label: 'Status' },
              { label: '' },
            ]}
          >
            {rows.map((r) => {
              const start = day(r.holiday_date);
              const end = day(r.end_date);
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{r.name}</div>
                    {r.description && <div className="text-xs text-gray-500">{r.description}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                    {start}{end && end !== start ? ` → ${end}` : ''}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {r.department_name || <span className="text-gray-500">Everyone</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{r.is_paid ? 'Paid' : 'Unpaid'}</td>
                  <td className="px-4 py-3"><StatusBadge active={Boolean(r.is_active)} /></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button" className={SMALL}
                        onClick={() => setForm({
                          id: r.id, name: r.name, holiday_date: start, end_date: end || '',
                          description: r.description || '', department_id: r.department_id || '',
                          is_paid: Boolean(r.is_paid), is_active: Boolean(r.is_active),
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
              );
            })}
          </Table>
        </DataPanel>
      </main>

      {form && (
        <FormDialog
          title={form.id ? `Edit ${form.name}` : 'Add holiday'}
          onClose={() => setForm(null)}
          onSubmit={submit}
          saving={saving}
          submitLabel={form.id ? 'Save changes' : 'Add Holiday'}
          wide
        >
          <Field label="Holiday name" required wide>
            <input
              required autoFocus value={form.name} className={INPUT}
              placeholder="Dashain, Tihar, Public holiday…"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Date" required>
            <input
              required type="date" value={form.holiday_date} className={INPUT}
              onChange={(e) => setForm({ ...form, holiday_date: e.target.value })}
            />
          </Field>
          <Field label="End date" hint="Only for a holiday spanning several days.">
            <input
              type="date" min={form.holiday_date} value={form.end_date} className={INPUT}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            />
          </Field>
          <Field label="Applies to">
            <select
              value={form.department_id} className={INPUT}
              onChange={(e) => setForm({ ...form, department_id: e.target.value })}
            >
              <option value="">Everyone</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Paid">
            <select
              value={form.is_paid ? '1' : '0'} className={INPUT}
              onChange={(e) => setForm({ ...form, is_paid: e.target.value === '1' })}
            >
              <option value="1">Paid</option>
              <option value="0">Unpaid</option>
            </select>
          </Field>
          <Field label="Description" wide>
            <input
              value={form.description} className={INPUT}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
        </FormDialog>
      )}
    </AdminLayout>
  );
}
