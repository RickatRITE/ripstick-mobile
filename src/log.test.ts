/**
 * Tests for mobile structured logging + GitHub sync.
 *
 * Covers: log buffer management, flushLogsToGitHub (BUG-88 observability).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// log.ts reads localStorage at module scope, so we need a stub in Node env.
// Use vi.stubGlobal so vitest can restore it. Must be before the import.
if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
}

// Now safe to import
const logModule = await import('./log');
const { log, getLogs, clearLogs, flushLogsToGitHub, dumpLogs } = logModule;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

describe('log buffer', () => {
  beforeEach(() => {
    clearLogs();
  });

  it('appends entries with src:"mobile"', () => {
    log('test-tag', { key: 'value' });
    const logs = getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].src).toBe('mobile');
    expect(logs[0].tag).toBe('test-tag');
    expect(logs[0].data).toEqual({ key: 'value' });
    expect(logs[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('persists to localStorage on every log call', () => {
    log('persist-test', {});
    const raw = localStorage.getItem('ripstick-mobile-log');
    expect(raw).toBeTruthy();
    expect(raw).toContain('"tag":"persist-test"');
  });

  it('dumpLogs returns JSONL', () => {
    log('a', { x: 1 });
    log('b', { y: 2 });
    const dump = dumpLogs();
    const lines = dump.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).tag).toBe('a');
    expect(JSON.parse(lines[1]).tag).toBe('b');
  });
});

describe('flushLogsToGitHub', () => {
  beforeEach(() => {
    clearLogs();
    vi.restoreAllMocks();
    localStorage.removeItem('ripstick-mobile-log-sha');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when buffer is empty', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await flushLogsToGitHub('tok', 'user/repo', 'alice');
    expect(spy).not.toHaveBeenCalled();
  });

  it('creates file on first flush (no existing SHA)', async () => {
    log('hello', { world: true });

    const spy = vi.spyOn(globalThis, 'fetch')
      // 1st: GET to discover SHA → 404 (file doesn't exist)
      .mockResolvedValueOnce(jsonResponse({}, 404))
      // 2nd: PUT to create → success
      .mockResolvedValueOnce(jsonResponse({ content: { sha: 'new-sha-abc' } }));

    await flushLogsToGitHub('tok', 'user/repo', 'alice');

    expect(spy).toHaveBeenCalledTimes(2);

    // The PUT should not include a sha field (creating, not updating)
    const putCall = spy.mock.calls[1];
    const putBody = JSON.parse(putCall[1]?.body as string);
    expect(putBody.sha).toBeUndefined();
    expect(putBody.message).toBe('Mobile log sync');

    // SHA should be cached for next flush
    expect(localStorage.getItem('ripstick-mobile-log-sha')).toBe('new-sha-abc');
  });

  it('uses cached SHA on subsequent flush (avoids GET)', async () => {
    log('second-flush', {});
    localStorage.setItem('ripstick-mobile-log-sha', 'cached-sha-123');

    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ content: { sha: 'updated-sha-456' } }));

    await flushLogsToGitHub('tok', 'user/repo', 'alice');

    // Should skip the GET entirely — only 1 fetch call
    expect(spy).toHaveBeenCalledTimes(1);

    const putBody = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(putBody.sha).toBe('cached-sha-123');

    expect(localStorage.getItem('ripstick-mobile-log-sha')).toBe('updated-sha-456');
  });

  it('recovers from stale cached SHA (409 → GET → retry)', async () => {
    log('stale-sha-test', {});
    localStorage.setItem('ripstick-mobile-log-sha', 'stale-sha');

    const spy = vi.spyOn(globalThis, 'fetch')
      // 1st: PUT with stale SHA → 409
      .mockResolvedValueOnce(jsonResponse({}, 409))
      // 2nd: GET to fetch fresh SHA
      .mockResolvedValueOnce(jsonResponse({ sha: 'fresh-sha-789' }))
      // 3rd: PUT with fresh SHA → success
      .mockResolvedValueOnce(jsonResponse({ content: { sha: 'final-sha-xyz' } }));

    await flushLogsToGitHub('tok', 'user/repo', 'alice');

    expect(spy).toHaveBeenCalledTimes(3);

    // Retry PUT should use the fresh SHA
    const retryBody = JSON.parse(spy.mock.calls[2][1]?.body as string);
    expect(retryBody.sha).toBe('fresh-sha-789');

    expect(localStorage.getItem('ripstick-mobile-log-sha')).toBe('final-sha-xyz');
  });

  it('swallows errors — never throws', async () => {
    log('error-test', {});
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network down'));
    await expect(flushLogsToGitHub('tok', 'user/repo', 'alice')).resolves.toBeUndefined();
  });

  it('writes to per-user path', async () => {
    log('path-test', {});

    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ content: { sha: 'sha' } }));

    await flushLogsToGitHub('tok', 'user/repo', 'bob');

    const getUrl = spy.mock.calls[0][0] as string;
    expect(getUrl).toContain('__mobile_log_bob.jsonl');
  });

  it('content is JSONL with src:"mobile"', async () => {
    log('format-check', { detail: 42 });

    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ content: { sha: 'sha' } }));

    await flushLogsToGitHub('tok', 'user/repo', 'alice');

    const putBody = JSON.parse(spy.mock.calls[1][1]?.body as string);
    const decoded = decodeURIComponent(escape(atob(putBody.content)));
    const lines = decoded.trim().split('\n');
    const entry = JSON.parse(lines[0]);
    expect(entry.src).toBe('mobile');
    expect(entry.tag).toBe('format-check');
    expect(entry.data.detail).toBe(42);
  });
});
