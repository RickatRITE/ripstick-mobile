/** Minimal frontmatter parser — extract title, dates, and body from a RipStick markdown note. */

import { yamlQuote } from './note-format';

export interface ParsedNote {
  title: string;
  created: string;
  updated: string;
  tags: string[];
  body: string;
  /** The raw marker type if present, e.g. "todo", "important" */
  marker: string;
  /** Whether the marker has ":done" */
  done: boolean;
  /** The full original marker comment line, e.g. "<!-- rs:todo:done:@greg -->" */
  markerLine: string;
}

/** Parse a note's raw content into frontmatter fields + body. */
export function parseNote(raw: string): ParsedNote {
  const result: ParsedNote = { title: '', created: '', updated: '', tags: [], body: '', marker: '', done: false, markerLine: '' };

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

  // Extract marker from body (first line might be <!-- rs:todo:done:@greg -->)
  const markerMatch = result.body.match(/^(<!--\s*rs:(\w+)((?::[^\s]*)*)?\s*-->)\r?\n?/);
  if (markerMatch) {
    result.markerLine = markerMatch[1];
    result.marker = markerMatch[2];
    result.done = (markerMatch[3] || '').includes(':done');
  }

  return result;
}

/** Replace or insert a marker comment in raw file content. Returns the new full content. */
export function setMarkerInRaw(raw: string, newMarker: string, done: boolean): string {
  const parsed = parseNote(raw);
  const segments = newMarker ? [newMarker, ...(done ? ['done'] : [])] : [];
  const newMarkerLine = segments.length > 0 ? `<!-- rs:${segments.join(':')} -->` : '';

  // Strip existing marker from body
  let body = parsed.body.replace(/^<!--\s*rs:[^\n]*-->\r?\n?/, '');

  // Prepend new marker if any
  if (newMarkerLine) {
    body = `${newMarkerLine}\n${body}`;
  }

  return rebuildNote(parsed, body);
}

/** Toggle done state on an existing marker in raw content. */
export function toggleDoneInRaw(raw: string): string {
  const parsed = parseNote(raw);
  if (!parsed.marker) return raw;
  return setMarkerInRaw(raw, parsed.marker, !parsed.done);
}

/** Rebuild the full file content from parsed fields + edited body. */
export function rebuildNote(parsed: ParsedNote, newBody: string): string {
  const now = new Date().toISOString();
  const fm = `---
title: ${yamlQuote(parsed.title)}
created: ${yamlQuote(parsed.created || now)}
updated: ${yamlQuote(now)}
tags: [${parsed.tags.map((t) => yamlQuote(t)).join(', ')}]
---`;
  return `${fm}\n${newBody}\n`;
}
