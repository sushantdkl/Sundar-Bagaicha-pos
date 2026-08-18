import { NextResponse } from 'next/server';
import { KotRepository } from '@/lib/db/repositories/kots.js';
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

// GET - Get single KOT with items
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
    const { id: kotId } = await params;
    const kotRepo = new KotRepository();
    
    const kot = await kotRepo.getById(kotId);
    
    if (!kot) {
      return NextResponse.json(
        { error: 'KOT not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      kot
    });
    
  } catch (error) {
    console.error('KOT GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch KOT' },
      { status: 500 }
    );
  }
}

// PUT - Update KOT status
export async function PUT(request, context) {
  try {
    const session = await verifyAuth(request);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const { params } = context;
    const { id: kotId } = await params;
    const body = await request.json();
    const { status, prepared_by } = body;
    
    if (!status) {
      return NextResponse.json(
        { error: 'Missing status field' },
        { status: 400 }
      );
    }
    
    const validStatuses = ['pending', 'preparing', 'ready', 'served'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }
    
    const kotRepo = new KotRepository();
    const updated = await kotRepo.updateStatus(kotId, status, prepared_by || session.user_id);
    
    if (!updated) {
      return NextResponse.json(
        { error: 'KOT not found or update failed' },
        { status: 404 }
      );
    }
    
    const kot = await kotRepo.getById(kotId);
    
    return NextResponse.json({
      success: true,
      message: `KOT status updated to ${status}`,
      kot
    });
    
  } catch (error) {
    console.error('KOT PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to update KOT' },
      { status: 500 }
    );
  }
}

// PATCH - Update individual KOT item status
export async function PATCH(request, context) {
  try {
    const session = await verifyAuth(request);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const { params } = context;
    const { id: kotId } = await params;
    const body = await request.json();
    const { item_id, status } = body;
    
    if (!item_id || !status) {
      return NextResponse.json(
        { error: 'Missing required fields: item_id, status' },
        { status: 400 }
      );
    }
    
    const kotRepo = new KotRepository();
    const updated = await kotRepo.updateItemStatus(item_id, status);
    
    if (!updated) {
      return NextResponse.json(
        { error: 'KOT item not found or update failed' },
        { status: 404 }
      );
    }
    
    const kot = await kotRepo.getById(kotId);
    
    return NextResponse.json({
      success: true,
      message: 'KOT item status updated',
      kot
    });
    
  } catch (error) {
    console.error('KOT PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update KOT item' },
      { status: 500 }
    );
  }
}
