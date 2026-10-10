import { memo, useEffect, useRef } from 'react';
import { Component, MarkdownRenderer, type TFile } from 'obsidian';
import { useApp } from '../react/mount';
import { detectContentType } from '../render/contentType';

/** Remove a leading YAML frontmatter block from raw note text. */
export function stripFrontmatter(raw: string): string {
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end !== -1) {
      const after = raw.indexOf('\n', end + 1);
      return after !== -1 ? raw.slice(after + 1) : '';
    }
  }
  return raw;
}

/**
 * A short markdown excerpt of a note's body, with a content-type badge when
 * the body matches a known type. Rendered once per file version: re-renders of
 * the card don't re-run Obsidian's markdown renderer (the expensive part).
 */
export const NoteExcerpt = memo(function NoteExcerpt({
  file,
  mtime,
  maxChars = 320,
}: {
  file: TFile;
  /** The file's mtime: a prop (not read inside) so an edit re-renders the memo. */
  mtime: number;
  maxChars?: number;
}) {
  const app = useApp();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const owner = new Component();
    owner.load();
    let cancelled = false;

    void (async () => {
      try {
        const body = stripFrontmatter(await app.vault.cachedRead(file)).trim();
        if (cancelled || !body) return;
        el.empty();
        const type = detectContentType(body);
        if (type) el.createSpan({ cls: `rb-content-type rb-content-type-${type.id}`, text: type.label });
        const excerpt = body.length > maxChars ? `${body.slice(0, maxChars).trimEnd()}…` : body;
        await MarkdownRenderer.render(app, excerpt, el, file.path, owner);
      } catch {
        /* unreadable note: leave the excerpt empty */
      }
    })();

    return () => {
      cancelled = true;
      owner.unload();
      el.empty();
    };
  }, [app, file, mtime, maxChars]);

  return <div ref={ref} className="rb-card-content" />;
});
