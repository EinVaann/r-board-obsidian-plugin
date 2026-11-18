import type { Size } from './types';

/** Joins class names, skipping empty ones. */
export const cx = (...parts: (string | false | null | undefined)[]): string | undefined => parts.filter(Boolean).join(' ') || undefined;

/**
 * The styling contract of a part: `data-slot` names it (kebab-case `family-part`),
 * `data-variant` / `data-size` describe it. Themes target only these attributes.
 */
export const slot = (name: string, variant?: string, size?: Size): Record<string, string> => ({
  'data-slot': name,
  ...(variant ? { 'data-variant': variant } : {}),
  ...(size ? { 'data-size': size } : {}),
});
