import { Component, MarkdownRenderer, Modal, TFile, WorkspaceLeaf, type App } from 'obsidian';

/**
 * In-place note editor. Opens when a card/row is clicked instead of opening the
 * note. Embeds a real Obsidian editor leaf so the note looks and edits exactly
 * like the native editor (Properties widget + live-preview body). A header
 * button opens the note in the main workspace.
 *
 * The leaf is detached — it never joins the visible workspace layout, so opening
 * and closing the modal doesn't reshuffle the user's panes. `onDone` reports
 * whether the note's frontmatter actually changed, so the board only repaints
 * when it needs to.
 */
export class NoteEditModal extends Modal {
  private leaf: WorkspaceLeaf | null = null;
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

  /** Mount a real editor leaf for the file; fall back to a rendered preview. */
  private async embedEditor(parent: HTMLElement): Promise<void> {
    try {
      // WorkspaceLeaf's constructor isn't in the public typings, but a detached
      // leaf is the way to host an editor outside the layout. It must not enter
      // the visible workspace (createLeafInParent would add a real pane and make
      // every open/close reshuffle — and slowly re-render — the board), yet the
      // editor internals dereference `leaf.parentSplit` during setup and resize.
      // `parentSplit` is a getter-only accessor derived from the parent, so the
      // parent has to be supplied to the constructor. Use the container for the
      // window the modal lives in, or the editor measures the wrong document and
      // renders blank (notably in pop-out windows and on Windows).
      const ws = this.app.workspace as unknown as {
        rootSplit: { doc?: Document };
        floatingSplit?: { children?: Array<{ doc?: Document }> };
      };
      const doc = this.modalEl.ownerDocument;
      const container =
        [ws.rootSplit, ...(ws.floatingSplit?.children ?? [])].find((c) => c.doc === doc) ??
        ws.rootSplit;
      const LeafCtor = WorkspaceLeaf as unknown as new (app: App, parent?: unknown) => WorkspaceLeaf;
      const leaf = new LeafCtor(this.app, container);
      this.leaf = leaf;
      // Source mode = the same editing view you get when opening the note.
      await leaf.openFile(this.file, { active: false, state: { mode: 'source', source: false } });
      parent.empty();
      parent.appendChild((leaf as unknown as { containerEl: HTMLElement }).containerEl);
      // Let the embedded editor lay out to its new container size.
      window.setTimeout(() => leaf.view?.onResize?.(), 0);
    } catch (e) {
      console.error('[r-board] could not embed editor, falling back to preview', e);
      this.leaf?.detach();
      this.leaf = null;
      parent.empty();
      await this.renderPreview(parent);
    }
  }

  /** Read-only fallback if the editor leaf can't be embedded. */
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
    this.leaf?.detach();
    this.leaf = null;
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
