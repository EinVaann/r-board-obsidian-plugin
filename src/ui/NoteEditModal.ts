import { Component, MarkdownRenderer, Modal, TFile, WorkspaceLeaf, type App } from 'obsidian';

/**
 * In-place note editor. Opens when a card/row is clicked instead of opening the
 * note. Embeds a real Obsidian editor leaf so the note looks and edits exactly
 * like the native editor (Properties widget + live-preview body). A header
 * button opens the note in the main workspace.
 *
 * The board (whose re-render is suspended by the caller) repaints once on close.
 */
export class NoteEditModal extends Modal {
  private leaf: WorkspaceLeaf | null = null;
  private fallback: Component | null = null;

  constructor(
    app: App,
    private file: TFile,
    private noteTitle: string,
    private onDone: () => void,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl, modalEl } = this;
    modalEl.addClass('rb-edit-modal');

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
      // leaf is the supported way to host an editor outside the layout.
      const LeafCtor = WorkspaceLeaf as unknown as new (app: App) => WorkspaceLeaf;
      const leaf = new LeafCtor(this.app);
      this.leaf = leaf;
      // Live-preview mode = the same view you get when opening the note.
      await leaf.openFile(this.file, { active: false, state: { mode: 'source', source: false } });
      parent.appendChild(leaf.containerEl);
      // Let the embedded editor lay out to its new container size.
      window.setTimeout(() => leaf.view?.onResize?.(), 0);
    } catch (e) {
      console.error('[r-board] could not embed editor, falling back to preview', e);
      this.leaf?.detach();
      this.leaf = null;
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

  onClose(): void {
    this.leaf?.detach();
    this.leaf = null;
    this.fallback?.unload();
    this.fallback = null;
    this.contentEl.empty();
    // The embedded editor autosaves; let the board repaint once now.
    this.onDone();
  }
}
