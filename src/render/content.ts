import { type App, type Component, MarkdownRenderer, type TFile } from 'obsidian';
import { detectContentType } from './contentType';

/** Remove a leading YAML frontmatter block from raw note text. */
function stripFrontmatter(raw: string): string {
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
 * Render a short excerpt of a note's body into `el` as markdown. Owned by
 * `component` for cleanup. Best-effort: failures leave the element empty.
 */
export async function renderNoteExcerpt(
  app: App,
  el: HTMLElement,
  file: TFile,
  component: Component,
  maxChars = 320,
): Promise<void> {
  try {
    const raw = await app.vault.cachedRead(file);
    const body = stripFrontmatter(raw).trim();
    if (!body) return;

    // A type badge (Recipe, …) when the body matches a known content type.
    const type = detectContentType(body);
    if (type) {
      el.createSpan({
        cls: `rb-content-type rb-content-type-${type.id}`,
        text: type.label,
      });
    }

    const excerpt = body.length > maxChars ? `${body.slice(0, maxChars).trimEnd()}…` : body;
    await MarkdownRenderer.render(app, excerpt, el, file.path, component);
  } catch {
    /* ignore unreadable notes */
  }
}
