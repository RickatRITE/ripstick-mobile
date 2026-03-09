/**
 * Regression test: getDefaultBranch() returns the correct branch after getAllFiles().
 *
 * Bug: edit.ts hardcoded 'main' for GitHub raw URLs, breaking image display
 * for repos that use 'master' as their default branch. Fixed by caching the
 * detected branch in getAllFiles() and exposing via getDefaultBranch().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAllFiles, getDefaultBranch } from './api';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as Response;
}

describe('getAllFiles branch detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sets defaultBranch to "main" when main succeeds', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ tree: [{ path: 'general/note.md', type: 'blob', name: 'note.md', sha: 'abc' }] }),
    );

    const files = await getAllFiles('token', 'user/repo');
    expect(files).toHaveLength(1);
    expect(getDefaultBranch()).toBe('main');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('/trees/main');
  });

  it('falls back to "master" and caches it when main returns 404', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      // First call (main) fails
      .mockResolvedValueOnce(jsonResponse(null, false))
      // Second call (master) succeeds
      .mockResolvedValueOnce(
        jsonResponse({ tree: [{ path: 'general/note.md', type: 'blob', name: 'note.md', sha: 'abc' }] }),
      );

    const files = await getAllFiles('token', 'user/repo');
    expect(files).toHaveLength(1);
    expect(getDefaultBranch()).toBe('master');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][0]).toContain('/trees/master');
  });

  it('returns empty array when both branches fail', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(null, false))
      .mockResolvedValueOnce(jsonResponse(null, false));

    const files = await getAllFiles('token', 'user/repo');
    expect(files).toEqual([]);
  });

  it('filters non-md files and hidden/underscore-prefixed paths', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
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
