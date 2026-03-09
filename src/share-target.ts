/**
 * Web Share Target handler — parses incoming shared content and generates
 * smart titles based on known URL patterns (X, YouTube, Reddit, etc.).
 */

export interface SharePayload {
  title: string;
  body: string;
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
 * Parse the Web Share Target query params from the current URL.
 * Returns null if no share data is present.
 *
 * The share sheet sends: ?title=...&text=...&url=...
 * - `text` often contains the main content + a URL appended by the sharing app
 * - `url` may duplicate the URL already in `text`
 * - `title` is rarely populated by most apps
 */
export function parseShareTarget(): SharePayload | null {
  const params = new URLSearchParams(window.location.search);
  const rawTitle = params.get('title')?.trim() || '';
  const rawText = params.get('text')?.trim() || '';
  const rawUrl = params.get('url')?.trim() || '';

  // Nothing shared
  if (!rawTitle && !rawText && !rawUrl) return null;

  // Find the canonical URL — prefer explicit `url` param, else extract from text
  const url = rawUrl || extractUrl(rawText) || '';

  // Body = the text content with the URL stripped out (it's noise in the body)
  let body = rawText;
  if (url && body.includes(url)) {
    body = body.replace(url, '').trim();
  }
  // If the body is empty but we have a URL, put the URL in the body so the note isn't blank
  if (!body && url) {
    body = url;
  }

  // Title priority: smart title from URL > shared title > first line of body
  let title: string;
  if (url) {
    title = smartTitle(url);
  } else if (rawTitle) {
    title = rawTitle;
  } else {
    // Use first line of body, truncated
    title = body.split('\n')[0].slice(0, 80) || 'Shared Note';
  }

  // If we have a URL, append it as a source link after the body
  if (url && body !== url) {
    body = body + '\n\n' + url;
  }

  return { title, body };
}
