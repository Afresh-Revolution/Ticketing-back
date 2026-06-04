import { userPageModel } from './userPage/userPage.model.js';

/** GET /api/user/orders - paid tickets for the signed-in user (by account id or purchase email) */
export async function getMyOrders(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const profile = await userPageModel.getProfile(userId);
    const userEmail = profile?.email ?? req.user?.email ?? '';
    if (!userEmail) {
      return res.status(400).json({ error: 'Account email not found' });
    }
    await userPageModel.linkGuestOrdersToUser(userId, userEmail);
    const orders = await userPageModel.getMyOrders(userId, userEmail);
    const list = orders.map((o) => ({
      id: String(o.id),
      eventId: o.eventId != null ? String(o.eventId) : null,
      fullName: o.fullName,
      email: o.email,
      totalAmount: o.totalAmount,
      status: o.status,
      createdAt: o.createdAt,
      ticketCode: o.ticketCode ?? null,
      event: o.event
        ? {
            title: o.event.title,
            description: o.event.description,
            date: o.event.date,
            venue: o.event.venue ?? o.event.location ?? '',
            imageUrl: o.event.imageUrl,
            category: o.event.category,
            startTime: o.event.startTime,
          }
        : null,
      items: (o.items || []).map((i) => ({
        ticketName: i.ticketName ?? i.name ?? 'Ticket',
        quantity: Number(i.quantity) || 0,
        price: Number(i.price) || 0,
      })),
    }));
    return res.json(list);
  } catch (err) {
    console.error('[user.controller] getMyOrders:', err?.message || err);
    return res.json([]);
  }
}
