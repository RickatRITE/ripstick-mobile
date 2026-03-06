/** Shared app state, types, and navigation for RipStick mobile. */

import { clearToken } from './auth';
import { getRepoFullName } from './auth';
import { type MarkerType } from './note-format';
import { type ParsedNote } from './frontmatter';

// ── localStorage Keys ─────────────────────────────────────────────────

export const LAST_GROUP_KEY = 'ripstick-last-group';
export const CACHED_GROUPS_KEY = 'ripstick-cached-groups';
export const CACHED_USERNAME_KEY = 'ripstick-cached-username';

// ── Types ─────────────────────────────────────────────────────────────

export type Screen = 'auth' | 'capture' | 'recent' | 'edit';

export interface NoteListItem {
  path: string;
  group: string;
  filename: string;
  sha: string;
  /** Extracted from filename: YYYY-MM-DD */
  date: string;
  /** Frontmatter title, fetched asynchronously */
  title?: string;
}

export interface AppState {
  screen: Screen;
  username: string;
  repo: string;
  groups: string[];
  selectedGroup: string;
  // Capture
  title: string;
  body: string;
  marker: MarkerType | '';
  markerExpanded: boolean;
  saving: boolean;
  status: { type: 'success' | 'error' | 'info'; message: string } | null;
  lastSavedPath: string | null;
  // Recent / Edit
  recentNotes: NoteListItem[];
  recentLoading: boolean;
  editNote: { path: string; sha: string; parsed: ParsedNote; raw: string } | null;
  editSaving: boolean;
}

// ── State Singleton ───────────────────────────────────────────────────

export const state: AppState = {
  screen: 'auth',
  username: localStorage.getItem(CACHED_USERNAME_KEY) || '',
  repo: getRepoFullName() || '',
  groups: JSON.parse(localStorage.getItem(CACHED_GROUPS_KEY) || '[]'),
  selectedGroup: localStorage.getItem(LAST_GROUP_KEY) || 'general',
  title: '',
  body: '',
  marker: '',
  markerExpanded: false,
  saving: false,
  status: null,
  lastSavedPath: null,
  recentNotes: [],
  recentLoading: false,
  editNote: null,
  editSaving: false,
};

// ── Render Callback ───────────────────────────────────────────────────

let _renderFn: () => void = () => {};

export function setRenderFn(fn: () => void): void {
  _renderFn = fn;
}

export function render(): void {
  _renderFn();
}

export function navigate(screen: Screen, pushHistory = true): void {
  state.screen = screen;
  if (pushHistory) {
    history.pushState({ screen }, '', '');
  }
  render();
}

// ── Shared Actions ────────────────────────────────────────────────────

export function disconnect(): void {
  clearToken();
  localStorage.removeItem(CACHED_GROUPS_KEY);
  localStorage.removeItem(CACHED_USERNAME_KEY);
  state.screen = 'auth';
  state.username = '';
  state.repo = '';
  state.groups = [];
  state.status = null;
  render();
}
