'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { Pencil, UserPlus } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { apiJson } from '@/lib/authed-fetch';
import { friendlyFromError } from '@/lib/friendly-message';
import {
  PageHeader, DataPanel, Table, FormDialog, Field, INPUT, SMALL, BTN,
} from '../hrm-ui';

const EMPLOYMENT_STATUSES = [
  ['ACTIVE', 'Active'],
  ['ON_LEAVE', 'On leave'],
  ['INACTIVE', 'Inactive'],
  ['TERMINATED', 'Terminated'],
];

const STATUS_TONE = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  ON_LEAVE: 'bg-amber-50 text-amber-700',
  INACTIVE: 'bg-gray-100 text-gray-600',
  TERMINATED: 'bg-red-50 text-red-700',
};

export default function StaffPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (departmentFilter) params.set('department_id', departmentFilter);
      if (search.trim()) params.set('search', search.trim());
      const qs = params.toString();
      const [s, deps, desigs] = await Promise.all([
        apiJson(`/api/admin/hrm/staff${qs ? `?${qs}` : ''}`),
        apiJson('/api/admin/hrm/departments').catch(() => ({ departments: [] })),
        apiJson('/api/admin/hrm/designations').catch(() => ({ designations: [] })),
      ]);
      setRows(s.staff || []);
      setDepartments(deps.departments || []);
      setDesignations(desigs.designations || []);
    } catch (e) {
      setError(e?.error || e?.message || 'Request failed.');
    } finally {
      setLoading(false);
    }
  }, [departmentFilter, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await apiJson('/api/admin/hrm/staff', {
        method: 'PATCH',
        body: JSON.stringify({
          id: form.id,
          department_id: form.department_id || null,
          designation_id: form.designation_id || null,
          employment_status: form.employment_status,
          phone: form.phone,
          email: form.email,
          address: form.address,
        }),
      });
      addToast({ type: 'success', title: 'Staff record updated.' });
      setForm(null);
      await load();
    } catch (err) {
      addToast(friendlyFromError(err, 'save_failed'));
    } finally {
      setSaving(false);
    }
  };

  // Only designations belonging to the chosen department (plus unassigned ones)
  // are offered, so a Kitchen Helper cannot be filed under Front Office.
  const designationOptions = form?.department_id
    ? designations.filter((d) => !d.department_id || String(d.department_id) === String(form.department_id))
    : designations;

  return (
    <AdminLayout>
      <PageHeader
        title="Staff"
        subtitle="The people who work here, with their department, job title and employment status. Logins, passwords and system roles are managed separately under Staff Permissions."
        actions={
          <Link href="/admin/employees" className={BTN}>
            <UserPlus className="h-4 w-4" />Add or edit accounts
          </Link>
        }
      />

      <main className="space-y-4 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, username or phone" className={`${INPUT} max-w-xs`}
          />
          <select
            value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}
            className={`${INPUT} max-w-xs`}
          >
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        <DataPanel
          loading={loading}
          error={error}
          empty={!rows.length}
          emptyTitle="No staff match this view"
          emptyHint="Staff accounts are created under Staff Permissions; their HR details are set here."
          emptyAction={<Link href="/admin/employees" className={BTN}>Go to accounts</Link>}
        >
          <Table
            columns={[
              { label: 'Name' },
              { label: 'Department' },
              { label: 'Designation' },
              { label: 'System role' },
              { label: 'Contact' },
              { label: 'Employment' },
              { label: '' },
            ]}
          >
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-semibold text-gray-900">{r.full_name}</div>
                  <div className="text-xs text-gray-500">{r.username}</div>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {r.department_name || <span className="text-gray-400">Unassigned</span>}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {r.designation_name || <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-block bg-gray-100 px-2 py-1 text-xs font-medium uppercase text-gray-600">
                    {r.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {r.phone || <span className="text-gray-400">—</span>}
                  {r.email && <div className="text-xs text-gray-500">{r.email}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block whitespace-nowrap px-2 py-1 text-xs font-semibold ${STATUS_TONE[r.employment_status] || STATUS_TONE.INACTIVE}`}>
                    {EMPLOYMENT_STATUSES.find(([v]) => v === r.employment_status)?.[1] || r.employment_status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <button
                      type="button" className={SMALL}
                      onClick={() => setForm({
                        id: r.id, full_name: r.full_name,
                        department_id: r.department_id || '',
                        designation_id: r.designation_id || '',
                        employment_status: r.employment_status || 'ACTIVE',
                        phone: r.phone || '', email: r.email || '', address: r.address || '',
                      })}
                    >
                      <Pencil className="h-3.5 w-3.5" />Edit HR details
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
          title={`HR details — ${form.full_name}`}
          onClose={() => setForm(null)}
          onSubmit={submit}
          saving={saving}
          submitLabel="Save changes"
          wide
        >
          <Field label="Department">
            <select
              value={form.department_id} className={INPUT}
              onChange={(e) => setForm({ ...form, department_id: e.target.value, designation_id: '' })}
            >
              <option value="">Unassigned</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Designation">
            <select
              value={form.designation_id} className={INPUT}
              onChange={(e) => setForm({ ...form, designation_id: e.target.value })}
            >
              <option value="">None</option>
              {designationOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field
            label="Employment status"
            hint="Separate from their login. Someone on leave keeps their account."
          >
            <select
              value={form.employment_status} className={INPUT}
              onChange={(e) => setForm({ ...form, employment_status: e.target.value })}
            >
              {EMPLOYMENT_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Phone">
            <input
              value={form.phone} className={INPUT}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <input
              type="email" value={form.email} className={INPUT}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Address" wide>
            <input
              value={form.address} className={INPUT}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>
        </FormDialog>
      )}
    </AdminLayout>
  );
}
