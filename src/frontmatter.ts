/** Minimal frontmatter parser — extract title, dates, and body from a RipStick markdown note. */

export interface ParsedNote {
  title: string;
  created: string;
  updated: string;
  tags: string[];
  body: string;
  /** The raw marker comment if present, e.g. "todo", "important" */
  marker: string;
}

/** Parse a note's raw content into frontmatter fields + body. */
export function parseNote(raw: string): ParsedNote {
  const result: ParsedNote = { title: '', created: '', updated: '', tags: [], body: '', marker: '' };

  // Split frontmatter from body
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    result.body = raw;
    return result;
  }

  const fm = fmMatch[1];
  result.body = fmMatch[2];

  // Simple YAML extraction (no full parser needed for our known fields)
  const titleMatch = fm.match(/^title:\s*"?([^"\n]*)"?\s*$/m);
  if (titleMatch) result.title = titleMatch[1];

  const createdMatch = fm.match(/^created:\s*"?([^"\n]*)"?\s*$/m);
  if (createdMatch) result.created = createdMatch[1];

  const updatedMatch = fm.match(/^updated:\s*"?([^"\n]*)"?\s*$/m);
  if (updatedMatch) result.updated = updatedMatch[1];

  // Extract marker from body (first line might be <!-- rs:type -->)
  const markerMatch = result.body.match(/^<!--\s*rs:(\w+)(?::[^\s]*)*\s*-->\r?\n?/);
  if (markerMatch) {
    result.marker = markerMatch[1];
  }

  return result;
}

/** Rebuild the full file content from parsed fields + edited body. */
export function rebuildNote(parsed: ParsedNote, newBody: string): string {
  const now = new Date().toISOString();
  const title = parsed.title.replace(/"/g, '\\"');
  const fm = `---
title: "${title}"
created: "${parsed.created || now}"
updated: "${now}"
tags: [${parsed.tags.map((t) => `"${t}"`).join(', ')}]
---`;
  return `${fm}\n${newBody}\n`;
}
