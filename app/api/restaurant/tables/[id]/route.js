import { NextResponse } from 'next/server';
import { TableRepository } from '@/lib/db/repositories/tables.js';
import { AuthService } from '@/lib/auth/auth.js';

const authService = new AuthService();

async function verifyAuth(request) {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.substring(7);
  const session = await authService.verifySession(token);
  
  return session;
}

// GET - Get single table details
export async function GET(request, context) {
  try {
    const session = await verifyAuth(request);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const { params } = context;
    const { id: tableId } = await params;
    const tableRepo = new TableRepository();
    
    const tables = await tableRepo.getAll({ table_id: tableId });
    const table = tables.find(t => t.table_id === parseInt(tableId));
    
    if (!table) {
      return NextResponse.json(
        { error: 'Table not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      table
    });
    
  } catch (error) {
    console.error('Table GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch table' },
      { status: 500 }
    );
  }
}
