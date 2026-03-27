/**
 * BUG-47: Mobile note edits silently discarded on save
 *
 * Root cause: saveEditMutation() called render() before prepare(), which calls
 * getMarkdown(). Since render() → renderEdit() destroys the TipTap editor and
 * recreates it with the original body (state.editNote.parsed.body), getMarkdown()
 * read the original content instead of the user's edits. The save succeeded but
 * saved back the original content.
 *
 * Fix: moved prepare() (which calls getMarkdown()) above the render() call in
 * saveEditMutation(), so editor content is captured before the DOM is rebuilt.
 *
 * This test verifies: when render() resets getMarkdown() output (simulating
 * editor destruction/recreation), updateFile() still receives the edited content.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track call ordering between getMarkdown and render
let callLog: string[] = [];
let getMarkdownReturnValue = 'Original body';

// ── Mocks ────────────────────────────────────────────────────────────
// Paths are relative to this file (mobile/src/screens/)

vi.mock('../auth', () => ({
  getToken: () => 'mock-token',
}));

vi.mock('../api', () => ({
  getDefaultBranch: () => 'main',
  updateFile: vi.fn(async () => ({ sha: 'new-sha-from-update' })),
  getFileContent: vi.fn(async () => ({
    content: '---\ntitle: "Test"\ncreated: "2026-03-11"\nupdated: "2026-03-11"\ntags: []\n---\nEdited body',
    sha: 'new-sha',
  })),
}));

vi.mock('../editor', () => ({
  createEditor: vi.fn(),
  getMarkdown: vi.fn(() => {
    callLog.push('getMarkdown');
    return getMarkdownReturnValue;
  }),
}));

vi.mock('../state', () => {
  const state = {
    editNote: null as any,
    editSaving: false,
    editOptionsPanelOpen: false,
    editTitle: null as string | null,
    status: null as any,
    repo: 'user/repo',
  };
  return {
    state,
    render: vi.fn(() => {
      callLog.push('render');
      // Simulate what real render() does: the editor is destroyed and
      // recreated with the ORIGINAL body, so getMarkdown() would now
      // return the original content instead of the user's edits.
      getMarkdownReturnValue = 'Original body';
    }),
  };
});

vi.mock('../note-format', () => ({
  MARKERS: [],
  MARKER_MAP: {},
  buildCommitMessage: () => 'test commit',
}));

vi.mock('../frontmatter', () => ({
  parseNote: (raw: string) => ({
    title: 'Test', title_source: '', created: '2026-03-11', updated: '2026-03-11',
    tags: [], body: raw, marker: '', done: false, markerLine: '', extraYaml: [],
  }),
  rebuildNote: (_parsed: any, body: string) => `---\ntitle: "Test"\n---\n${body}\n`,
  setMarkerInRaw: vi.fn(),
  toggleDoneInRaw: vi.fn(),
}));

vi.mock('../utils', () => ({
  escapeHtml: (s: string) => s,
  clearStatusAfterDelay: vi.fn(),
}));

vi.mock('../log', () => ({
  log: vi.fn(),
}));

// ── Tests ────────────────────────────────────────────────────────────

describe('handleSaveEdit', () => {
  beforeEach(async () => {
    callLog = [];
    getMarkdownReturnValue = 'Edited body';
    vi.clearAllMocks();

    const { state } = await import('../state');
    state.editNote = {
      path: 'general/2026-03-11-test.md',
      sha: 'old-sha',
      raw: '---\ntitle: "Test"\n---\nOriginal body\n',
      parsed: {
        title: 'Test', title_source: '', created: '2026-03-11', updated: '2026-03-11',
        tags: [], body: 'Original body', marker: '', done: false, markerLine: '', extraYaml: [],
      },
    };
    state.editSaving = false;
    state.editTitle = null;
    state.status = null;
  });

  it('BUG-47: captures editor content before render() destroys the editor', async () => {
    const { handleSaveEdit } = await import('./edit');
    const { updateFile } = await import('../api');

    await handleSaveEdit();

    // getMarkdown must be called BEFORE render — this is the invariant
    const getMarkdownIdx = callLog.indexOf('getMarkdown');
    const renderIdx = callLog.indexOf('render');
    expect(getMarkdownIdx).toBeGreaterThanOrEqual(0);
    expect(renderIdx).toBeGreaterThanOrEqual(0);
    expect(getMarkdownIdx).toBeLessThan(renderIdx);

    // The content sent to GitHub must contain the EDITED body, not the original
    expect(updateFile).toHaveBeenCalledTimes(1);
    const savedContent = (updateFile as ReturnType<typeof vi.fn>).mock.calls[0][3];
    expect(savedContent).toContain('Edited body');
    expect(savedContent).not.toMatch(/^---[\s\S]*---\nOriginal body\n$/);
  });
});
