/** Normalize buyer/account emails for consistent matching in queries. */
export function normalizeBuyerEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}
