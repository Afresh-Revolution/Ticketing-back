/** Convert watch/share URLs into embeddable iframe URLs. */
export function toEmbedUrl(rawUrl, provider = 'youtube') {
  const url = String(rawUrl || '').trim();
  if (!url) return null;

  const p = String(provider || 'youtube').toLowerCase();

  if (p === 'embed' || p === 'custom') {
    return url;
  }

  if (p === 'twitch') {
    const channelMatch = url.match(/twitch\.tv\/(?:videos\/(\d+)|([^/?#]+))/i);
    if (channelMatch?.[1]) {
      return `https://player.twitch.tv/?video=${channelMatch[1]}&parent=${getParentHost()}`;
    }
    if (channelMatch?.[2]) {
      return `https://player.twitch.tv/?channel=${channelMatch[2]}&parent=${getParentHost()}`;
    }
    return url;
  }

  // YouTube (default) — supports watch, live, youtu.be, embed
  const ytId =
    url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i)?.[1] ||
    url.match(/[?&]v=([A-Za-z0-9_-]{6,})/)?.[1];
  if (ytId) {
    return `https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0`;
  }

  return url;
}

function getParentHost() {
  try {
    const base = process.env.PUBLIC_FRONTEND_URL || 'localhost';
    return new URL(base.startsWith('http') ? base : `https://${base}`).hostname;
  } catch {
    return 'localhost';
  }
}
