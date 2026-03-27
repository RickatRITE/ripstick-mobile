/**
 * Tests for mobile GitHub API wrapper.
 *
 * Covers: branch detection (getAllFiles), updateFile 409 retry (BUG-88).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAllFiles, getDefaultBranch, updateFile } from './api';

vi.mock('./log', () => ({ log: vi.fn() }));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

/** Shorthand for a successful response. */
function okResponse(body: unknown): Response { return jsonResponse(body, 200); }
/** Shorthand for a 404 response. */
function notFoundResponse(): Response { return jsonResponse(null, 404); }

describe('getAllFiles branch detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sets defaultBranch to "main" when main succeeds', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({ tree: [{ path: 'general/note.md', type: 'blob', name: 'note.md', sha: 'abc' }] }),
    );

    const files = await getAllFiles('token', 'user/repo');
    expect(files).toHaveLength(1);
    expect(getDefaultBranch()).toBe('main');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('/trees/main');
  });

  it('falls back to "master" and caches it when main returns 404', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(
        okResponse({ tree: [{ path: 'general/note.md', type: 'blob', name: 'note.md', sha: 'abc' }] }),
      );

    const files = await getAllFiles('token', 'user/repo');
    expect(files).toHaveLength(1);
    expect(getDefaultBranch()).toBe('master');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][0]).toContain('/trees/master');
  });

  it('returns empty array when both branches fail', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(notFoundResponse());

    const files = await getAllFiles('token', 'user/repo');
    expect(files).toEqual([]);
  });

  it('filters non-md files and hidden/underscore-prefixed paths', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({
        tree: [
          { path: 'general/note.md', type: 'blob', name: 'note.md', sha: '1' },
          { path: '_assets/img.webp', type: 'blob', name: 'img.webp', sha: '2' },
          { path: '.github/config.yml', type: 'blob', name: 'config.yml', sha: '3' },
          { path: 'general/readme.txt', type: 'blob', name: 'readme.txt', sha: '4' },
          { path: 'general', type: 'tree', name: 'general', sha: '5' },
        ],
      }),
    );

    const files = await getAllFiles('token', 'user/repo');
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('general/note.md');
  });
});

// ── updateFile: 409 retry logic (BUG-88) ────────────────────────────

describe('updateFile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns new SHA on successful update (no conflict)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({ content: { sha: 'new-sha-after-write' } }),
    );

    const result = await updateFile('tok', 'user/repo', 'general/note.md', 'body', 'old-sha', 'msg');
    expect(result.sha).toBe('new-sha-after-write');
  });

  it('BUG-88: retries on 409 with fresh SHA and succeeds', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      // 1st PUT → 409 (stale SHA)
      .mockResolvedValueOnce(jsonResponse({ message: 'SHA mismatch' }, 409))
      // 2nd call: getFileContent to fetch fresh SHA (Contents API returns base64)
      .mockResolvedValueOnce(okResponse({
        content: btoa('fresh content'),
        sha: 'fresh-sha-from-github',
      }))
      // 3rd call: retry PUT with fresh SHA → success
      .mockResolvedValueOnce(okResponse({
        content: { sha: 'final-sha-after-retry' },
      }));

    const result = await updateFile('tok', 'user/repo', 'general/note.md', 'edited body', 'stale-sha', 'save');

    // Should succeed with the SHA from the retry
    expect(result.sha).toBe('final-sha-after-retry');

    // Verify the call sequence: PUT, GET (fresh SHA), PUT (retry)
    expect(spy).toHaveBeenCalledTimes(3);

    // 1st call: PUT with stale SHA
    const firstPut = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(firstPut.sha).toBe('stale-sha');

    // 2nd call: GET for fresh SHA (getFileContent)
    expect(spy.mock.calls[1][1]?.method).toBeUndefined(); // GET has no method

    // 3rd call: PUT with fresh SHA
    const retryPut = JSON.parse(spy.mock.calls[2][1]?.body as string);
    expect(retryPut.sha).toBe('fresh-sha-from-github');
  });

  it('BUG-88: throws when retry also fails (double conflict)', async () => {
    vi.spyOn(globalThis, 'fetch')
      // 1st PUT → 409
      .mockResolvedValueOnce(jsonResponse({ message: 'SHA mismatch' }, 409))
      // getFileContent → fresh SHA
      .mockResolvedValueOnce(okResponse({
        content: btoa('fresh'),
        sha: 'fresh-sha',
      }))
      // retry PUT → also fails (e.g., another concurrent write)
      .mockResolvedValueOnce(jsonResponse({ message: 'still mismatched' }, 409));

    await expect(
      updateFile('tok', 'user/repo', 'general/note.md', 'body', 'old', 'msg'),
    ).rejects.toThrow('Update failed (409)');
  });

  it('throws on non-409 errors without retrying', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ message: 'forbidden' }, 403));

    await expect(
      updateFile('tok', 'user/repo', 'general/note.md', 'body', 'sha', 'msg'),
    ).rejects.toThrow('Update failed (403)');

    // Only 1 call — no retry on non-409
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('preserves the user content through the retry (not the remote content)', async () => {
    const userContent = 'The user typed this on mobile';

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({}, 409))
      .mockResolvedValueOnce(okResponse({
        content: btoa('Different content from desktop'),
        sha: 'fresh-sha',
      }))
      .mockResolvedValueOnce(okResponse({
        content: { sha: 'written-sha' },
      }));

    await updateFile('tok', 'user/repo', 'general/note.md', userContent, 'old', 'msg');

    // The retry PUT must contain the USER's content, not the remote content
    const calls = vi.mocked(fetch).mock.calls;
    const retryBody = JSON.parse(calls[2][1]?.body as string);
    const decodedContent = decodeURIComponent(escape(atob(retryBody.content)));
    expect(decodedContent).toBe(userContent);
  });
});
