import { config } from '../config/env.js';

const RTMP_INGEST_RE = /^rtmps?:\/\//i;

/** Reject ingest/broadcast URLs (e.g. OBS → YouTube RTMP) — viewers need HTTPS watch/embed links. */
export function validateStreamWatchUrl(rawUrl, provider = 'youtube') {
  const url = String(rawUrl || '').trim();
  if (!url) return { ok: false, error: 'Stream URL is required' };

  if (RTMP_INGEST_RE.test(url)) {
    return {
      ok: false,
      error:
        'RTMP URLs are for OBS/streaming software only. Use your YouTube watch or live page URL (https://www.youtube.com/watch?v=… or /live/…).',
    };
  }

  const p = String(provider || 'youtube').toLowerCase();
  const embedUrl = toEmbedUrl(url, p);

  if (!embedUrl || !/^https?:\/\//i.test(embedUrl)) {
    return {
      ok: false,
      error: 'Use a public HTTPS watch, live, or embed URL — not an RTMP ingest URL from YouTube Studio.',
    };
  }

  if (p === 'youtube' && !/youtube\.com\/embed\//i.test(embedUrl)) {
    return {
      ok: false,
      error:
        'Could not parse a YouTube video ID. Open your live stream on YouTube and copy the watch or /live/ URL.',
    };
  }

  if (p === 'twitch' && !/player\.twitch\.tv/i.test(embedUrl)) {
    return {
      ok: false,
      error: 'Use a Twitch channel or video URL (https://twitch.tv/…).',
    };
  }

  return { ok: true, embedUrl };
}

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
    return new URL(config.frontendBaseUrl).hostname;
  } catch {
    return 'gatewav.com';
  }
}
