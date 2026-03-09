/**
 * BUG-38: Mobile note list shows "undefined NaN, NaN" for dates
 *
 * Root cause: formatDate() in recent.ts appended 'T00:00:00' to all input strings,
 * including full ISO datetimes from the `updated` frontmatter field. This created
 * invalid date strings like "2026-03-08T10:50:55-05:00T00:00:00", producing
 * months[NaN] → undefined, getDate() → NaN, getFullYear() → NaN.
 *
 * The fix: detect strings that already contain a time component and parse directly,
 * plus an isNaN guard to return '' instead of garbage.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock the state module so utils.ts can import without side effects
vi.mock('./state', () => ({
  state: { status: null, lastSavedPath: null, repo: null },
  render: vi.fn(),
}));

import { formatDate } from './utils';

describe('formatDate', () => {
  it('BUG-38: handles full ISO datetime strings without producing NaN', () => {
    // This is the exact scenario that caused "undefined NaN, NaN":
    // the updated field from frontmatter is a full ISO datetime
    const result = formatDate('2026-03-08T10:50:55-05:00');
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('NaN');
    expect(result).toMatch(/Mar 8/);
    // Should include AM/PM time
    expect(result).toMatch(/\d{1,2}:\d{2} [AP]M/);
  });

  it('handles ISO datetime with Z timezone', () => {
    const result = formatDate('2026-03-08T15:50:55Z');
    expect(result).not.toContain('NaN');
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/\d{1,2}:\d{2} [AP]M/);
  });

  it('handles ISO datetime with space separator', () => {
    const result = formatDate('2026-03-08 10:50:55');
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('NaN');
    expect(result).toMatch(/Mar 8/);
    expect(result).toMatch(/10:50 AM/);
  });

  it('formats 12-hour time correctly', () => {
    // Noon → 12:00 PM, not 0:00 PM
    const noon = formatDate('2026-03-08T12:00:00');
    expect(noon).toContain('12:00 PM');

    // Midnight → 12:00 AM, not 0:00 AM
    const midnight = formatDate('2026-03-08T00:05:00');
    expect(midnight).toContain('12:05 AM');

    // Afternoon
    const pm = formatDate('2026-03-08T17:30:00');
    expect(pm).toContain('5:30 PM');
  });

  it('omits time for date-only strings', () => {
    const result = formatDate('2026-03-08');
    expect(result).toMatch(/Mar 8/);
    expect(result).not.toMatch(/[AP]M/);
  });

  it('returns empty string for empty input', () => {
    expect(formatDate('')).toBe('');
  });

  it('returns empty string for NO_DATE sentinel', () => {
    expect(formatDate('0000-00-00')).toBe('');
  });

  it('returns empty string for garbage input', () => {
    expect(formatDate('not-a-date')).toBe('');
  });

  it('includes year for dates not in the current year', () => {
    const result = formatDate('2020-06-15');
    expect(result).toBe('Jun 15, 2020');
  });
});
