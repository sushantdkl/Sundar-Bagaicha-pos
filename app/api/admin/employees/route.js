import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import bcrypt from 'bcryptjs';
import { getPrimaryAdminId } from '@/lib/employees.js';
import { ensurePayrollSchema } from '@/lib/payroll.js';
import { requireAuth } from '@/lib/api-guard.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensurePayrollSchema(db);
    const primaryId = await getPrimaryAdminId(db);

    const employees = await db.all(`
      SELECT id, username, full_name, role, email, phone, is_active, created_at,
             salary, hire_date, position
      FROM users
      ORDER BY id ASC
    `);

    return NextResponse.json({
      primary_admin_id: primaryId,
      employees: employees.map((e) => ({
        ...e,
        is_active: Number(e.is_active) === 1,
        is_primary_admin: Number(e.id) === Number(primaryId),
      })),
    });
  } catch (error) {
    console.error('Get employees error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch employees' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensurePayrollSchema(db);

    // Check if username already exists
    const existing = await db.get('SELECT id FROM users WHERE username = ?', [data.username]);
    if (existing) {
      return NextResponse.json(
        { error: 'Username already exists' },
        { status: 400 }
      );
    }

    // Hash the PIN using bcrypt
    const hashedPassword = bcrypt.hashSync(data.pin, 10);

    const result = await db.run(`
      INSERT INTO users (
        username, full_name, role, password_hash, email, phone, is_active,
        salary, hire_date, position
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.username,
      data.full_name,
      data.role,
      hashedPassword,
      data.email || null,
      data.phone || null,
      data.is_active ? 1 : 0,
      data.salary === '' || data.salary == null ? null : Number(data.salary),
      data.hire_date || null,
      data.position || null
    ]);

    const employee = await db.get(`
      SELECT id, username, full_name, role, email, phone, is_active, created_at,
             salary, hire_date, position
      FROM users WHERE id = ?
    `, [result.lastInsertRowid]);

    return NextResponse.json({ 
      message: 'Employee created successfully',
      employee 
    }, { status: 201 });
  } catch (error) {
    console.error('Create employee error:', error);
    return NextResponse.json(
      { error: 'Failed to create employee' },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensurePayrollSchema(db);

    // Check if username is taken by another user
    const existing = await db.get('SELECT id FROM users WHERE username = ? AND id != ?', [data.username, data.id]);
    if (existing) {
      return NextResponse.json(
        { error: 'Username already exists' },
        { status: 400 }
      );
    }

    const salary = data.salary === '' || data.salary == null ? null : Number(data.salary);

    // Update with or without PIN
    if (data.pin) {
      // Hash the new PIN using bcrypt
      const hashedPassword = bcrypt.hashSync(data.pin, 10);

      await db.run(`
        UPDATE users
        SET username = ?, full_name = ?, role = ?, password_hash = ?,
            email = ?, phone = ?, is_active = ?, salary = ?, hire_date = ?, position = ?
        WHERE id = ?
      `, [
        data.username,
        data.full_name,
        data.role,
        hashedPassword,
        data.email || null,
        data.phone || null,
        data.is_active ? 1 : 0,
        salary,
        data.hire_date || null,
        data.position || null,
        data.id
      ]);
    } else {
      await db.run(`
        UPDATE users
        SET username = ?, full_name = ?, role = ?,
            email = ?, phone = ?, is_active = ?, salary = ?, hire_date = ?, position = ?
        WHERE id = ?
      `, [
        data.username,
        data.full_name,
        data.role,
        data.email || null,
        data.phone || null,
        data.is_active ? 1 : 0,
        salary,
        data.hire_date || null,
        data.position || null,
        data.id
      ]);
    }

    const employee = await db.get(`
      SELECT id, username, full_name, role, email, phone, is_active, created_at,
             salary, hire_date, position
      FROM users WHERE id = ?
    `, [data.id]);

    return NextResponse.json({ 
      message: 'Employee updated successfully',
      employee 
    });
  } catch (error) {
    console.error('Update employee error:', error);
    return NextResponse.json(
      { error: 'Failed to update employee' },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Employee ID is required.' }, { status: 400 });
    }

    // Prefer /api/admin/employees/[id] — keep this for compatibility
    const db = Database.getInstance();
    const { isPrimaryAdmin } = await import('@/lib/employees.js');
    const userId = Number(id);

    const existing = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!existing) {
      return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    }
    if (await isPrimaryAdmin(db, userId)) {
      return NextResponse.json(
        {
          error: 'The main admin account is protected and cannot be deleted.',
          code: 'primary_admin_protected',
        },
        { status: 403 }
      );
    }

    await db.transaction(async () => {
      try { await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]); } catch { /* optional */ }
      try { await db.run('DELETE FROM devices WHERE user_id = ?', [userId]); } catch { /* optional */ }
      try { await db.run('UPDATE tables SET waiter_id = NULL WHERE waiter_id = ?', [userId]); } catch { /* optional */ }
      try { await db.run('UPDATE orders SET waiter_id = NULL WHERE waiter_id = ?', [userId]); } catch { /* optional */ }
      try { await db.run('UPDATE bills SET cashier_id = NULL WHERE cashier_id = ?', [userId]); } catch { /* optional */ }
      await db.run('DELETE FROM users WHERE id = ?', [userId]);
    });

    return NextResponse.json({
      message: 'Employee deleted successfully.',
    });
  } catch (error) {
    console.error('Delete employee error:', error);
    const msg = String(error?.message || '');
    if (/FOREIGN KEY|foreign key/i.test(msg)) {
      return NextResponse.json(
        {
          error: 'This employee is linked to past orders or bills, so they cannot be deleted. Deactivate them instead.',
          code: 'employee_in_use',
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to delete employee' },
      { status: 500 }
    );
  }
}
