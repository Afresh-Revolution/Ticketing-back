import { orderModel } from './order.model.js';

export async function create(req, res, next) {
  try {
    const { eventId, items, fullName, email, phone, address, totalAmount } = req.body;
    
    // Basic validation
    if (!eventId || !items || items.length === 0 || !fullName || !email || !totalAmount) {
      return res.status(400).json({ error: 'Missing required fields: eventId, items, fullName, email, totalAmount' });
    }

    // Identify user if logged in
    const userId = req.user ? req.user.id : null;

    const order = await orderModel.create({
      eventId,
      userId,
      fullName,
      email,
      phone,
      address,
      items,
      totalAmount,
      status: 'pending'
    });

    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
}

export async function verify(req, res, next) {
  try {
    const { reference, orderId } = req.body;
    
    if (!reference || !orderId) {
      return res.status(400).json({ error: 'Missing reference or orderId' });
    }

    // In a real app, verify with Paystack API here
    // const paystackRes = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, ...);
    
    // For now, assume success if reference is provided
    const order = await orderModel.updateStatus(orderId, 'paid', reference);
    
    res.json(order);
  } catch (err) {
    next(err);
  }
}
