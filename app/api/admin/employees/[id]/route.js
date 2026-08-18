import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import bcrypt from 'bcryptjs';
import { getPrimaryAdminId, isPrimaryAdmin } from '@/lib/employees.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';

function employeeSelect(id) {
  return [
    `SELECT id, username, full_name, role, email, phone, is_active, created_at
     FROM users WHERE id = ?`,
    [id],
  ];
}

export async function PUT(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const { id } = await params;
    const data = await request.json();
    const db = Database.getInstance();

    const existingUser = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!existingUser) {
      return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    }

    const primary = await isPrimaryAdmin(db, id);

    if (primary) {
      if (data.role && data.role !== 'admin') {
        return NextResponse.json(
          {
            error: 'The main admin account must stay as Admin. Role cannot be changed.',
            code: 'primary_admin_protected',
          },
          { status: 403 }
        );
      }
      if (data.is_active === false || data.is_active === 0) {
        return NextResponse.json(
          {
            error: 'The main admin account cannot be deactivated.',
            code: 'primary_admin_protected',
          },
          { status: 403 }
        );
      }
    }

    const username = data.username ?? existingUser.username;
    const taken = await db.get(
      'SELECT id FROM users WHERE username = ? AND id != ?',
      [username, id]
    );
    if (taken) {
      return NextResponse.json({ error: 'Username already exists.' }, { status: 400 });
    }

    const isActive = data.is_active === undefined
      ? existingUser.is_active
      : (data.is_active ? 1 : 0);

    if (data.pin) {
      const hashedPassword = bcrypt.hashSync(String(data.pin), 10);
      await db.run(
        `UPDATE users
         SET username = ?, full_name = ?, role = ?, password_hash = ?,
             email = ?, phone = ?, is_active = ?
         WHERE id = ?`,
        [
          username,
          data.full_name ?? existingUser.full_name,
          primary ? 'admin' : (data.role ?? existingUser.role),
          hashedPassword,
          data.email || null,
          data.phone || null,
          isActive,
          id,
        ]
      );
    } else {
      await db.run(
        `UPDATE users
         SET username = ?, full_name = ?, role = ?,
             email = ?, phone = ?, is_active = ?
         WHERE id = ?`,
        [
          username,
          data.full_name ?? existingUser.full_name,
          primary ? 'admin' : (data.role ?? existingUser.role),
          data.email || null,
          data.phone || null,
          isActive,
          id,
        ]
      );
    }

    const [sql, args] = employeeSelect(id);
    const employee = await db.get(sql, args);

    return NextResponse.json({
      message: 'Employee updated successfully.',
      employee,
    });
  } catch (error) {
    console.error('Update employee error:', error);
    return NextResponse.json(
      { error: 'Could not update this employee. Please try again.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const { id } = await params;
    const data = await request.json();
    const db = Database.getInstance();

    const existingUser = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!existingUser) {
      return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    }

    if (data.action === 'activate' || data.action === 'deactivate' || data.is_active !== undefined) {
      const activate =
        data.action === 'activate'
          ? true
          : data.action === 'deactivate'
            ? false
            : !!data.is_active;

      if (!activate && (await isPrimaryAdmin(db, id))) {
        return NextResponse.json(
          {
            error: 'The main admin account cannot be deactivated.',
            code: 'primary_admin_protected',
          },
          { status: 403 }
        );
      }

      await db.run('UPDATE users SET is_active = ? WHERE id = ?', [activate ? 1 : 0, id]);
    }

    const [sql, args] = employeeSelect(id);
    const employee = await db.get(sql, args);

    return NextResponse.json({
      message: Number(employee.is_active) === 1
        ? 'Employee activated successfully.'
        : 'Employee deactivated successfully.',
      employee,
    });
  } catch (error) {
    console.error('Patch employee error:', error);
    return NextResponse.json(
      { error: 'Could not update this employee. Please try again.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const { id } = await params;
    const userId = Number(id);
    const db = Database.getInstance();

    const existingUser = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!existingUser) {
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

    // Clear FK references first — live DBs often use NO ACTION (not SET NULL/CASCADE)
    await db.transaction(async () => {
      try { await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]); } catch { /* table may not exist */ }
      try { await db.run('DELETE FROM devices WHERE user_id = ?', [userId]); } catch { /* optional */ }
      try { await db.run('UPDATE tables SET waiter_id = NULL WHERE waiter_id = ?', [userId]); } catch { /* optional */ }
      try { await db.run('UPDATE orders SET waiter_id = NULL WHERE waiter_id = ?', [userId]); } catch { /* optional */ }
      try { await db.run('UPDATE bills SET cashier_id = NULL WHERE cashier_id = ?', [userId]); } catch { /* optional */ }
      try { await db.run('UPDATE kots SET prepared_by = NULL WHERE prepared_by = ?', [userId]); } catch { /* optional */ }

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
      { error: 'Could not delete this employee. Please try again.' },
      { status: 500 }
    );
  }
}

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const { id } = await params;
    const db = Database.getInstance();
    const [sql, args] = employeeSelect(id);
    const employee = await db.get(sql, args);
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    }
    const primaryId = await getPrimaryAdminId(db);
    return NextResponse.json({
      employee: {
        ...employee,
        is_primary_admin: Number(employee.id) === Number(primaryId),
      },
    });
  } catch (error) {
    return handleRouteError(error, 'Could not load employee.');
  }
}
