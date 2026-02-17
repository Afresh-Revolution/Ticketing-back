/**
 * Generate a unique ticket reference/code for display or lookup.
 * @param {string} [prefix='TKT']
 * @returns {string}
 */
export function generateTicketCode(prefix = 'TKT') {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}
