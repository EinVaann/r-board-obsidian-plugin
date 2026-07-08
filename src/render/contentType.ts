/**
 * Content types classify a note by what's in its body (not its frontmatter).
 * The first is `recipe` (a fenced ```recipe block); more can be added by
 * appending to `CONTENT_TYPES`. Detection drives the small type badge shown on
 * cards in "show content" mode, and is the hook a future type-specific
 * renderer can dispatch on.
 */
export interface ContentType {
  /** Stable id, also used as the badge's modifier class (`rb-content-type-<id>`). */
  id: string;
  /** Human label shown on the badge. */
  label: string;
  /** True when a note body (frontmatter already stripped) is of this type. */
  matches(body: string): boolean;
}

const RECIPE: ContentType = {
  id: 'recipe',
  label: 'Recipe',
  // A fenced ```recipe block anywhere in the body (any fence length, optional
  // leading whitespace).
  matches: (body) => /^\s*`{3,}\s*recipe\b/m.test(body),
};

/** Registry, checked in order — first match wins. Append new types here. */
export const CONTENT_TYPES: ContentType[] = [RECIPE];

/** The note's content type, or null when nothing matches. */
export function detectContentType(body: string): ContentType | null {
  return CONTENT_TYPES.find((t) => t.matches(body)) ?? null;
}
