/** Trim and validate http(s) URLs; returns null when empty or invalid. */
export function normalizeExternalUrl(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  try {
    const href = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}
