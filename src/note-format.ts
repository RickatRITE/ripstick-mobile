/** Shared knowledge about RipStick note format. */

const MARKER_TYPES = ['todo', 'idea', 'question', 'important', 'reference', 'followup'] as const;
export type MarkerType = (typeof MARKER_TYPES)[number];

export interface NoteFields {
  group: string;
  title: string;
  body: string;
  marker?: MarkerType;
}

/** Build YAML frontmatter for a new note. */
export function buildFrontmatter(title: string, now: Date): string {
  const iso = now.toISOString();
  return `---
title: "${title.replace(/"/g, '\\"')}"
created: "${iso}"
updated: "${iso}"
tags: []
---`;
}

/** Generate the next available filename for today. */
export function generateFilename(existingFiles: string[]): string {
  const now = new Date();
  const datePrefix = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const existing = existingFiles
    .filter((f) => f.startsWith(datePrefix) && f.endsWith('.md'))
    .map((f) => {
      const match = f.match(/-(\d+)\.md$/);
      return match ? parseInt(match[1], 10) : 0;
    });
  const maxCounter = existing.length > 0 ? Math.max(...existing) : 0;
  const counter = maxCounter + 1;
  return `${datePrefix}-${String(counter).padStart(3, '0')}.md`;
}

/** Build the semantic commit message for a note-created action. */
export function buildCommitMessage(group: string, filename: string, title: string): string {
  return `[note-created] ${group}/${filename}

ripstick-action: note-created
ripstick-file: ${group}/${filename}
ripstick-detail: Created note: ${title}
ripstick-priority: medium`;
}
