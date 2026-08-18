import { AuthService } from '@/lib/auth/auth.js';
import Database from '@/lib/db/index.js';

async function verifyAuth(request) {
  const token = request.headers.get('authorization')?.split(' ')[1];
  if (!token) {
    throw new Error('No authorization token');
  }
  
  const authService = new AuthService();
  const user = await authService.verifySession(token);
  
  if (!user) {
    throw new Error('Invalid session');
  }
  
  return user;
}

// PUT - Update order item status
export async function PUT(request, context) {
  try {
    const user = await verifyAuth(request);
    const { params } = context;
    const { id: itemId } = await params;
    const { status } = await request.json();
    
    // Validate status
    const validStatuses = ['pending', 'preparing', 'ready', 'served'];
    if (!validStatuses.includes(status)) {
      return Response.json(
        { error: 'Invalid status' },
        { status: 400 }
      );
    }
    
    const db = Database.getInstance();
    
    // Update item status
    await db.run(`
      UPDATE order_items 
      SET status = ?
      WHERE id = ?
    `, [status, itemId]);
    
    // Get updated item
    const item = await db.get(`
      SELECT oi.*, 
             oi.id as item_id,
             COALESCE(oi.price, 0) as price,
             COALESCE(oi.item_name, mi.name) as item_name, 
             mc.name as category, 
             mi.is_vegetarian as is_veg
      FROM order_items oi
      LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
      LEFT JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE oi.id = ?
    `, [itemId]);
    
    return Response.json({ success: true, item });
    
  } catch (error) {
    console.error('Update order item status error:', error);
    return Response.json(
      { error: error.message },
      { status: error.message.includes('authorization') ? 401 : 500 }
    );
  }
}
