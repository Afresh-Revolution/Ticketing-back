// These are visual finishes, not access levels. Use unit prices, never basket size.
export function getTicketDesign(order) {
  const prices = order.items.map((item) => Number(item.price)).filter((price) => Number.isFinite(price) && price >= 0);
  const quantity = order.items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0) || 1;
  const unitPrice = prices.length ? Math.max(...prices) : Math.max(0, Number(order.totalAmount) || 0) / quantity;
  if (unitPrice >= 100000) return { name: 'OBSIDIAN', accent: '#D8CCFF', ink: '#211D36', gradient: ['#302747', '#12101F'], paper: '#F0ECFA' };
  if (unitPrice >= 25000) return { name: 'GOLD', accent: '#E9C77D', ink: '#3E2E12', gradient: ['#594222', '#1F1D18'], paper: '#FBF3DF' };
  if (unitPrice > 0) return { name: 'EMERALD', accent: '#A6E2CC', ink: '#153D32', gradient: ['#23594B', '#102A25'], paper: '#EDF5EF' };
  return { name: 'MINT', accent: '#C6E6E9', ink: '#234348', gradient: ['#355B63', '#172E34'], paper: '#EFF7F8' };
}
