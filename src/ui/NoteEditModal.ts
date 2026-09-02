import { Component, MarkdownRenderer, Modal, TFile, type App, type WorkspaceLeaf } from 'obsidian';
import { DetachedEditorHost } from './DetachedEditorHost';

/**
 * In-place note editor. Opens when a card/row is clicked instead of opening the
 * note. Embeds a real Obsidian editor so the note looks and edits exactly like
 * the native editor (Properties widget + live-preview body). A header button
 * opens the note in the main workspace.
 *
 * The editor lives on a private split (see {@link DetachedEditorHost}) that no
 * layout walker can reach, so opening the modal neither reshuffles the user's
 * panes nor exposes a half-real leaf to other plugins. `onDone` reports whether
 * the note's frontmatter actually changed, so the board only repaints when it
 * needs to.
 */
export class NoteEditModal extends Modal {
  private host: DetachedEditorHost | null = null;
  private fallback: Component | null = null;
  private fmAtOpen = '';

  constructor(
    app: App,
    private file: TFile,
    private noteTitle: string,
    private onDone: (changed: boolean) => void,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl, modalEl } = this;
    modalEl.addClass('rb-edit-modal');
    this.fmAtOpen = this.frontmatterSnapshot();

    // Header: note title + a button to open the note in the workspace.
    const header = contentEl.createDiv({ cls: 'rb-edit-header' });
    header.createEl('h2', { cls: 'rb-edit-title', text: this.noteTitle });
    const open = header.createEl('button', { cls: 'mod-cta rb-edit-open', text: 'Open note' });
    open.onclick = () => {
      this.close();
      void this.app.workspace.getLeaf(false).openFile(this.file);
    };

    // Custom red close button in the header (the default modal × is hidden).
    const close = header.createEl('button', { cls: 'rb-edit-close', text: '✕', attr: { 'aria-label': 'Close' } });
    close.onclick = () => this.close();

    const embed = contentEl.createDiv({ cls: 'rb-edit-embed' });
    await this.embedEditor(embed);
  }

  /** Mount a real editor for the file; fall back to a rendered preview. */
  private async embedEditor(parent: HTMLElement): Promise<void> {
    try {
      const host = new DetachedEditorHost(this.app, this.modalEl.ownerDocument);
      this.host = host;

      // Opening must not steal the workspace's active leaf: that is what makes
      // other plugins treat the modal's editor as the user's current tab.
      const previous = this.app.workspace.activeLeaf;
      // Source mode = the same editing view you get when opening the note.
      await host.leaf.openFile(this.file, { active: false, state: { mode: 'source', source: false } });
      this.restoreActiveLeaf(previous);

      parent.empty();
      parent.appendChild(host.containerEl);
      // Let the embedded editor lay out to its new container size.
      window.setTimeout(() => host.leaf.view?.onResize?.(), 0);
    } catch (e) {
      console.error('[r-board] could not embed editor, falling back to preview', e);
      this.host?.destroy();
      this.host = null;
      parent.empty();
      await this.renderPreview(parent);
    }
  }

  /** Put the workspace's active leaf back if opening the file moved it. */
  private restoreActiveLeaf(previous: WorkspaceLeaf | null): void {
    const workspace = this.app.workspace;
    if (!previous || workspace.activeLeaf === previous) return;
    workspace.setActiveLeaf(previous, { focus: false });
  }

  /** Read-only fallback if the editor can't be embedded. */
  private async renderPreview(parent: HTMLElement): Promise<void> {
    parent.addClass('rb-edit-preview');
    const comp = new Component();
    comp.load();
    this.fallback = comp;
    const content = await this.app.vault.cachedRead(this.file);
    await MarkdownRenderer.render(this.app, content, parent, this.file.path, comp);
  }

  /** Stable string of the note's frontmatter, for change detection on close. */
  private frontmatterSnapshot(): string {
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? null;
    return JSON.stringify(fm);
  }

  onClose(): void {
    this.host?.destroy();
    this.host = null;
    this.fallback?.unload();
    this.fallback = null;
    this.contentEl.empty();
    // The embedded editor autosaves. Only ask the board to repaint if the
    // frontmatter the board reads from has actually changed; otherwise a stray
    // full rebuild of every card is a visible hitch on slower machines. Real
    // edits whose cache update lands later are still caught by BoardView's
    // metadata-change listener.
    this.onDone(this.frontmatterSnapshot() !== this.fmAtOpen);
  }
}
