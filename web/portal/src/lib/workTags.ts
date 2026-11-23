/** Creator tags on works: small, public, and shared by the plaza search. */

export const MAX_WORK_TAGS = 8;
export const MAX_WORK_TAG_LENGTH = 24;

/** Trim, drop the user's leading #, remove control characters and cap length. */
export function normalizeWorkTag(value: string): string {
  const clean = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/^[#＃]+/, '')
    .trim();
  return Array.from(clean).slice(0, MAX_WORK_TAG_LENGTH).join('');
}

/** Normalize, drop blanks and dedupe case-insensitively, keeping the first spelling. */
export function normalizeWorkTags(values: readonly string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = normalizeWorkTag(value);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_WORK_TAGS) break;
  }
  return tags;
}

/** True when a work carries every selected tag (case-insensitive AND match). */
export function workHasTags(tags: readonly string[] | undefined, selected: readonly string[]): boolean {
  if (!selected.length) return true;
  const own = new Set((tags || []).map(tag => normalizeWorkTag(tag).toLowerCase()));
  return selected.every(tag => own.has(normalizeWorkTag(tag).toLowerCase()));
}

/** Read `?tag=a,b` (or repeated params) into a clean tag list. */
export function parseWorkTagsQuery(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return normalizeWorkTags(values.flatMap(value => String(value).split(',')));
}
