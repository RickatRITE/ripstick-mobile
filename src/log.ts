/**
 * Structured logging for RipStick mobile.
 *
 * Logs are stored in a ring buffer (in-memory) and persisted to localStorage
 * so they survive page reloads. Keeps the last 200 entries.
 *
 * ## GitHub sync
 *
 * Logs are automatically synced to `__mobile_log_{username}.jsonl` at the repo
 * root via the GitHub Contents API — the same transport the rest of the app
 * uses. This means we can investigate mobile bugs from the desktop without
 * asking the user to open dev tools. The file sits alongside the desktop's
 * `__debug_log_{machine}.jsonl` and is gitignored on desktop.
 *
 * Flush triggers (chosen to minimize API calls):
 * - After a successful note save (GitHub is already warm)
 * - On visibilitychange → hidden (app backgrounding — last chance)
 *
 * Format matches the desktop debug log convention:
 *   {"ts":"...","src":"mobile","tag":"...","data":{...}}
 *
 * Usage:
 *   log('save', { path, sha, status: 409 })
 *   log('visibility', { from: 'hidden', to: 'visible' })
 */

const LS_KEY = 'ripstick-mobile-log';
const SHA_KEY = 'ripstick-mobile-log-sha';
const MAX_ENTRIES = 200;

export interface LogEntry {
  ts: string;
  src: 'mobile';
  tag: string;
  data: Record<string, unknown>;
}

let _buffer: LogEntry[] = [];
let _flushing = false;

// Hydrate from localStorage on module load
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) _buffer = JSON.parse(raw);
} catch {
  _buffer = [];
}

/** Append a structured log entry. */
export function log(tag: string, data: Record<string, unknown> = {}): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    src: 'mobile',
    tag,
    data,
  };
  _buffer.push(entry);
  if (_buffer.length > MAX_ENTRIES) {
    _buffer = _buffer.slice(-MAX_ENTRIES);
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(_buffer));
  } catch {
    // localStorage full — drop oldest half
    _buffer = _buffer.slice(Math.floor(_buffer.length / 2));
    try { localStorage.setItem(LS_KEY, JSON.stringify(_buffer)); } catch { /* give up */ }
  }
}

/** Get all log entries (oldest first). */
export function getLogs(): LogEntry[] {
  return [..._buffer];
}

/** Dump all logs as a newline-delimited JSON string (for copy-paste debugging). */
export function dumpLogs(): string {
  return _buffer.map((e) => JSON.stringify(e)).join('\n');
}

/** Clear all logs. */
export function clearLogs(): void {
  _buffer = [];
  localStorage.removeItem(LS_KEY);
}

// ── GitHub Sync ────────────────────────────────────────────────────────

const GITHUB_API = 'https://api.github.com';

/**
 * Flush the current log buffer to GitHub as a JSONL file.
 *
 * Writes to `__mobile_log_{username}.jsonl` at the repo root. The file is
 * overwritten each flush (not appended) — previous versions live in git
 * history. The SHA is cached in localStorage to avoid a GET on every flush.
 *
 * Fire-and-forget — errors are swallowed. Logging should never break the app.
 */
export async function flushLogsToGitHub(token: string, repo: string, username: string): Promise<void> {
  if (_flushing || _buffer.length === 0) return;
  _flushing = true;

  const path = `__mobile_log_${username}.jsonl`;
  const content = _buffer.map((e) => JSON.stringify(e)).join('\n') + '\n';
  const encoded = btoa(unescape(encodeURIComponent(content)));

  try {
    // Try with cached SHA first (avoids a GET round-trip).
    // If the SHA is stale (409), fetch fresh and retry.
    // If no cached SHA, GET the file to discover it (or create if missing).
    let sha = localStorage.getItem(SHA_KEY);

    if (sha) {
      const ok = await tryPut(token, repo, path, encoded, sha);
      if (ok) return;
      // Stale SHA — fall through to GET + retry
    }

    // GET current file SHA (or discover file doesn't exist)
    sha = await fetchSha(token, repo, path);

    // PUT with correct SHA (update) or without SHA (create)
    await tryPut(token, repo, path, encoded, sha);
  } catch {
    // Swallowed — logging must never break the app. Logs persist in
    // localStorage and will flush on the next opportunity.
  } finally {
    _flushing = false;
  }
}

/** PUT the log file. Returns true on success. Updates cached SHA. */
async function tryPut(
  token: string,
  repo: string,
  path: string,
  encodedContent: string,
  sha: string | null,
): Promise<boolean> {
  const body: Record<string, string> = {
    message: 'Mobile log sync',
    content: encodedContent,
  };
  if (sha) body.sha = sha;

  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    const data = (await res.json()) as { content: { sha: string } };
    localStorage.setItem(SHA_KEY, data.content.sha);
    return true;
  }

  // 409 = stale SHA, 422 = file already exists (need SHA) — both mean retry with fresh SHA
  if (res.status === 409 || res.status === 422) {
    return false;
  }

  // Other errors (auth, rate limit, server) — give up this flush
  return false;
}

/** Fetch the current SHA of the log file. Returns null if file doesn't exist. */
async function fetchSha(token: string, repo: string, path: string): Promise<string | null> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    localStorage.removeItem(SHA_KEY);
    return null; // File doesn't exist yet — will be created
  }

  const data = (await res.json()) as { sha: string };
  localStorage.setItem(SHA_KEY, data.sha);
  return data.sha;
}
