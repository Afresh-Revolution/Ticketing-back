import 'dotenv/config';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { reconcileUnpaidPaystackOrders } = await import('../src/modules/order/order.controller.js');
const results = await reconcileUnpaidPaystackOrders({ limit: 30 });
console.log(JSON.stringify(results, null, 2));
process.exit(0);
