import { query, createId } from '../../shared/config/db.js';

function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.eventId,
    userId: row.userId,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    address: row.address,
    totalAmount: row.totalAmount,
    status: row.status,
    reference: row.reference,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const orderModel = {
  async create(data) {
    const id = createId();
    const now = new Date().toISOString();
    
    // Start simple without transaction for now, but in prod use transaction
    // 1. Create Order
    await query(
      `INSERT INTO "Order" (id, "eventId", "userId", "fullName", email, phone, address, "totalAmount", status, reference, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        data.eventId,
        data.userId ?? null,
        data.fullName,
        data.email,
        data.phone ?? null,
        data.address ?? null,
        data.totalAmount,
        data.status ?? 'pending',
        data.reference ?? null,
        now,
        now
      ]
    );
    
    // 2. Create Order Items
    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        const itemId = createId();
        await query(
          `INSERT INTO "OrderItem" (id, "orderId", "ticketTypeId", quantity, price)
           VALUES ($1, $2, $3, $4, $5)`,
          [itemId, id, item.ticketTypeId, item.quantity, item.price]
        );
      }
    }
    
    return this.findById(id);
  },
  
  async findById(id) {
    const { rows } = await query('SELECT * FROM "Order" WHERE id = $1', [id]);
    const order = rowToOrder(rows[0]);
    if (!order) return null;
    
    // Fetch Items
    const { rows: items } = await query(
      `SELECT oi.*, tt.name as "ticketName" 
       FROM "OrderItem" oi
       JOIN "TicketType" tt ON oi."ticketTypeId" = tt.id
       WHERE oi."orderId" = $1`, 
      [id]
    );
    order.items = items;
    
    return order;
  },

  async updateStatus(id, status, reference) {
    const now = new Date().toISOString();
    await query(
      `UPDATE "Order" SET status = $1, reference = $2, "updatedAt" = $3 WHERE id = $4`,
      [status, reference, now, id]
    );
    return this.findById(id);
  }
};
