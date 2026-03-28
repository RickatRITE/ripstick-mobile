/** Re-exports shared note format utilities. */
export {
  type MarkerType,
  MARKERS,
  MARKER_MAP,
  type NoteFields,
  yamlQuote,
  buildFrontmatter,
  generateId,
  generateFilename,
} from '../../shared/note-format';

export { buildCommitMessage, type CommitFields } from '../../shared/commit-format';
