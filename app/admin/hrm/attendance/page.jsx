'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { CheckCircle2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { apiJson } from '@/lib/authed-fetch';
import { friendlyFromError } from '@/lib/friendly-message';
import { nepalDateString } from '@/lib/report-dates';
// The very function the server stores with, so the preview and the record agree.
import { workedMinutes as workedFrom } from '@/lib/hrm';
import {
  PageHeader, DataPanel, Table, FormDialog, Field, INPUT, SMALL, PRIMARY,
} from '../hrm-ui';

const STATUSES = [
  ['PRESENT', 'Present'],
  ['LATE', 'Late'],
  ['HALF_DAY', 'Half day'],
  ['LEAVE', 'Leave'],
  ['ABSENT', 'Absent'],
  ['HOLIDAY', 'Holiday'],
];

const TONE = {
  PRESENT: 'bg-emerald-50 text-emerald-700',
  LATE: 'bg-amber-50 text-amber-700',
  HALF_DAY: 'bg-sky-50 text-sky-700',
  LEAVE: 'bg-violet-50 text-violet-700',
  ABSENT: 'bg-red-50 text-red-700',
  HOLIDAY: 'bg-gray-100 text-gray-600',
};

const hhmm = (mins) => {
  if (mins == null) return '—';
  const n = Number(mins);
  return `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, '0')}m`;
};

export default function AttendancePage() {
  const { addToast } = useToast();
  const [date, setDate] = useState(() => nepalDateString());
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [view, setView] = useState('day'); // day | month

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState([]);
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const month = date.slice(0, 7);

  const load = useCallback(async () => {
    try {
      setError(null);
      const dep = departmentFilter ? `&department_id=${departmentFilter}` : '';
      const [a, s, deps] = await Promise.all([
        view === 'day'
          ? apiJson(`/api/admin/hrm/attendance?date=${date}${dep}`)
          : apiJson(`/api/admin/hrm/attendance?view=summary&from=${month}-01&to=${month}-31${dep}`),
        apiJson(`/api/admin/hrm/staff?active_only=1${departmentFilter ? `&department_id=${departmentFilter}` : ''}`)
          .catch(() => ({ staff: [] })),
        apiJson('/api/admin/hrm/departments').catch(() => ({ departments: [] })),
      ]);
      setRows(a.attendance || []);
      setSummary(a.summary || []);
      setStaff(s.staff || []);
      setDepartments(deps.departments || []);
    } catch (e) {
      setError(e?.error || e?.message || 'Request failed.');
    } finally {
      setLoading(false);
    }
  }, [date, month, view, departmentFilter]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await apiJson('/api/admin/hrm/attendance', {
        method: 'POST',
        body: JSON.stringify({ ...form, overtime_minutes: Number(form.overtime_minutes) || 0 }),
      });
      addToast({ type: 'success', title: 'Attendance saved.' });
      setForm(null);
      await load();
    } catch (err) {
      addToast(friendlyFromError(err, 'save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const marked = new Set(rows.map((r) => Number(r.user_id)));
  const unmarked = staff.filter((s) => !marked.has(Number(s.id)));

  const openMark = (member) => setForm({
    user_id: member?.id || '',
    attendance_date: date,
    status: 'PRESENT',
    check_in: '',
    check_out: '',
    overtime_minutes: '',
    notes: '',
  });

  return (
    <AdminLayout>
      <PageHeader
        title="Attendance"
        subtitle="Who worked, when. Marking the same person twice on a day corrects that record rather than creating a second one."
        actions={
          <button type="button" onClick={() => openMark(null)} className={PRIMARY}>
            <CheckCircle2 className="h-4 w-4" />Mark attendance
          </button>
        }
      />

      <main className="space-y-4 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex border border-gray-300 bg-white">
            {[['day', 'By day'], ['month', 'Monthly summary']].map(([v, l]) => (
              <button
                key={v} type="button" onClick={() => setView(v)}
                className={`px-3 py-2 text-sm font-medium ${
                  view === v ? 'bg-gray-950 text-white' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <input
            type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className={`${INPUT} max-w-[12rem]`}
          />
          <select
            value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}
            className={`${INPUT} max-w-xs`}
          >
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        {view === 'day' ? (
          <>
            <DataPanel
              loading={loading}
              error={error}
              empty={!rows.length}
              emptyTitle={`Nothing marked for ${date}`}
              emptyHint="Mark the first person to start today's sheet."
              emptyAction={
                <button type="button" onClick={() => openMark(null)} className={PRIMARY}>
                  Mark attendance
                </button>
              }
            >
              <Table
                columns={[
                  { label: 'Staff' }, { label: 'Department' }, { label: 'Status' },
                  { label: 'In' }, { label: 'Out' }, { label: 'Worked', align: 'right' },
                  { label: 'Overtime', align: 'right' }, { label: '' },
                ]}
              >
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-900">{r.full_name}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {r.department_name || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-1 text-xs font-semibold ${TONE[r.status] || TONE.HOLIDAY}`}>
                        {STATUSES.find(([v]) => v === r.status)?.[1] || r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-700">{r.check_in || '—'}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-700">{r.check_out || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{hhmm(r.worked_minutes)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{hhmm(r.overtime_minutes)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          type="button" className={SMALL}
                          onClick={() => setForm({
                            user_id: r.user_id, attendance_date: date, status: r.status,
                            check_in: r.check_in || '', check_out: r.check_out || '',
                            overtime_minutes: r.overtime_minutes ? String(r.overtime_minutes) : '',
                            notes: r.notes || '',
                          })}
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            </DataPanel>

            {!loading && unmarked.length > 0 && (
              <section className="border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">
                  {unmarked.length} staff not yet marked for {date}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {unmarked.map((s) => (
                    <button key={s.id} type="button" onClick={() => openMark(s)} className={SMALL}>
                      {s.full_name}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <DataPanel
            loading={loading}
            error={error}
            empty={!summary.length}
            emptyTitle={`No attendance recorded in ${month}`}
            emptyHint="Mark attendance by day and the monthly totals build up here."
          >
            <Table
              columns={[
                { label: 'Staff' }, { label: 'Department' },
                { label: 'Present', align: 'right' }, { label: 'Late', align: 'right' },
                { label: 'Half day', align: 'right' }, { label: 'Leave', align: 'right' },
                { label: 'Absent', align: 'right' }, { label: 'Worked', align: 'right' },
                { label: 'Overtime', align: 'right' },
              ]}
            >
              {summary.map((r) => (
                <tr key={r.user_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-900">{r.full_name}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {r.department_name || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.present ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.late ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.half_day ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.leave_days ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.absent ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{hhmm(r.worked_minutes)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{hhmm(r.overtime_minutes)}</td>
                </tr>
              ))}
            </Table>
          </DataPanel>
        )}
      </main>

      {form && (
        <FormDialog
          title="Mark attendance"
          onClose={() => setForm(null)}
          onSubmit={submit}
          saving={saving}
          submitLabel="Save attendance"
          wide
        >
          <Field label="Staff member" required>
            <select
              required value={form.user_id} className={INPUT}
              onChange={(e) => setForm({ ...form, user_id: e.target.value })}
            >
              <option value="">Choose…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </Field>
          <Field label="Date" required>
            <input
              required type="date" value={form.attendance_date} className={INPUT}
              onChange={(e) => setForm({ ...form, attendance_date: e.target.value })}
            />
          </Field>
          <Field label="Status" required>
            <select
              value={form.status} className={INPUT}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <div />
          <Field label="Check in" hint="24-hour, e.g. 09:30">
            <input
              type="time" value={form.check_in} className={INPUT}
              onChange={(e) => setForm({ ...form, check_in: e.target.value })}
            />
          </Field>
          <Field
            label="Check out"
            hint={
              form.check_in && form.check_out
                ? `Worked ${hhmm(workedFrom(form.check_in, form.check_out))}`
                : 'Worked time is calculated from these two.'
            }
          >
            <input
              type="time" value={form.check_out} className={INPUT}
              onChange={(e) => setForm({ ...form, check_out: e.target.value })}
            />
          </Field>
          <Field label="Overtime (minutes)" hint="Recorded separately — it is not derived from check-out.">
            <input
              type="number" min="0" step="15" value={form.overtime_minutes} className={INPUT}
              placeholder="0"
              onChange={(e) => setForm({ ...form, overtime_minutes: e.target.value })}
            />
          </Field>
          <div />
          <Field label="Notes" wide>
            <input
              value={form.notes} className={INPUT}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </FormDialog>
      )}
    </AdminLayout>
  );
}
