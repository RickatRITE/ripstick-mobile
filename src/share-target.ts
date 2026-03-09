/**
 * Web Share Target handler — parses incoming shared content and generates
 * smart titles based on known URL patterns (X, YouTube, Reddit, etc.).
 * Supports both text shares (links, tweets) and image shares (screenshots).
 */

// Must match SHARE_CACHE in public/sw.js
const SHARE_CACHE = 'ripstick-share-temp';

export interface SharePayload {
  title: string;
  body: string;
  /** Shared image file, if present. Consumed once then cleared from cache. */
  imageFile?: File;
}

interface UrlPattern {
  /** Regex to match against the URL */
  pattern: RegExp;
  /** Generate a title from the regex match groups */
  title: (match: RegExpMatchArray) => string;
}

const URL_PATTERNS: UrlPattern[] = [
  {
    // X/Twitter: https://x.com/username/status/123 or twitter.com/...
    pattern: /https?:\/\/(?:x|twitter)\.com\/([^/]+)\/status\/\d+/i,
    title: (m) => `X — @${m[1]}`,
  },
  {
    // YouTube: https://youtube.com/watch?v=... or youtu.be/...
    pattern: /https?:\/\/(?:www\.)?(?:youtube\.com\/watch|youtu\.be\/)/i,
    title: () => 'YouTube',
  },
  {
    // Reddit: https://reddit.com/r/subreddit/...
    pattern: /https?:\/\/(?:www\.)?reddit\.com\/r\/([^/]+)/i,
    title: (m) => `Reddit — r/${m[1]}`,
  },
  {
    // GitHub: https://github.com/owner/repo/...
    pattern: /https?:\/\/github\.com\/([^/]+\/[^/]+)/i,
    title: (m) => `GitHub — ${m[1]}`,
  },
  {
    // Hacker News
    pattern: /https?:\/\/news\.ycombinator\.com/i,
    title: () => 'Hacker News',
  },
  {
    // Wikipedia
    pattern: /https?:\/\/\w+\.wikipedia\.org\/wiki\/([^#?]+)/i,
    title: (m) => `Wikipedia — ${decodeURIComponent(m[1]).replace(/_/g, ' ')}`,
  },
];

/** Extract the first URL from a string, or null. */
function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/\S+/i);
  return m ? m[0] : null;
}

/**
 * Generate a smart title from a URL by matching against known patterns.
 * Falls back to the domain name if no pattern matches.
 */
function smartTitle(url: string): string {
  for (const { pattern, title } of URL_PATTERNS) {
    const m = url.match(pattern);
    if (m) return title(m);
  }
  // Fallback: extract domain name and capitalize
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '');
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch {
    return 'Shared Note';
  }
}

/**
 * Human-readable source name for the breadcrumb link.
 * Shorter than smartTitle — used as link text, not as the note title.
 */
function sourceName(url: string): string {
  for (const { pattern, title } of URL_PATTERNS) {
    const m = url.match(pattern);
    if (m) return title(m);
  }
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
  }
}

/** Format a date for the screenshot title: "Screenshot — Mar 8, 2026" */
function screenshotTitle(): string {
  const now = new Date();
  const formatted = now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `Screenshot — ${formatted}`;
}

/**
 * Retrieve a shared image from the service worker's temp cache.
 * Returns the file, or null if no image was shared. Clears the cache entry.
 */
async function consumeSharedImage(): Promise<File | null> {
  try {
    const cache = await caches.open(SHARE_CACHE);
    // Cache key must match sw.js POST handler
    const response = await cache.match('/ripstick-mobile/shared-image');
    if (!response) return null;

    // Clean up immediately — one-time consumption
    await cache.delete('/ripstick-mobile/shared-image');

    const blob = await response.blob();
    const type = response.headers.get('Content-Type') || 'image/png';
    return new File([blob], 'shared-image', { type });
  } catch {
    return null;
  }
}

/**
 * Parse the Web Share Target query params from the current URL.
 * Returns null if no share data is present.
 *
 * Handles both text shares (GET params) and image shares (POST → redirected
 * to GET with has_image=1, image stored in service worker temp cache).
 */
export async function parseShareTarget(): Promise<SharePayload | null> {
  const params = new URLSearchParams(window.location.search);
  const rawTitle = params.get('title')?.trim() || '';
  const rawText = params.get('text')?.trim() || '';
  const rawUrl = params.get('url')?.trim() || '';
  const hasImage = params.get('has_image') === '1';

  // Check for shared image in service worker cache
  const imageFile = hasImage ? await consumeSharedImage() : null;

  // Nothing shared
  if (!rawTitle && !rawText && !rawUrl && !imageFile) return null;

  // Find the canonical URL — prefer explicit `url` param, else extract from text
  const url = rawUrl || extractUrl(rawText) || '';

  // Body = the text content with the URL stripped out (it's noise in the body).
  // split/join for literal matching — String.replace treats special chars as regex.
  let body = rawText;
  if (url && body.includes(url)) {
    body = body.split(url).join('').trim();
  }

  // Title priority: smart title from URL > shared title > screenshot title > first line of body
  let title: string;
  if (url) {
    title = smartTitle(url);
  } else if (rawTitle) {
    title = rawTitle;
  } else if (imageFile) {
    title = screenshotTitle();
  } else {
    title = (body.split('\n')[0].slice(0, 80)) || 'Shared Note';
  }

  // Append a visible source breadcrumb — provenance indicator the user sees
  // in their markdown. They can edit or delete it like any other text.
  if (url) {
    const source = sourceName(url);
    const breadcrumb = `*Shared from [${source}](${url})*`;
    body = body ? body + '\n\n' + breadcrumb : breadcrumb;
  } else if (imageFile) {
    // Screenshot provenance breadcrumb
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const breadcrumb = `*Screenshot captured ${time}*`;
    body = body ? body + '\n\n' + breadcrumb : breadcrumb;
  }

  return { title, body, imageFile: imageFile ?? undefined };
}
