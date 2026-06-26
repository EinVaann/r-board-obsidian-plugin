import { App, Modal, Setting, TFile } from 'obsidian';
import type { BoardItem, PropertyConfig } from '../types';
import { propertyLabel } from '../config';
import { asArray, asBoolean, asNumber } from '../render/values';

/**
 * In-place note editor. Opens when a card/row is clicked instead of opening
 * the note. Edits the note's frontmatter properties with the right control per
 * type (toggle, number, text, one-per-line list); a header button opens the
 * full note. Edits are batched and flushed to the file on close, so the board
 * (whose re-render is suspended by the caller) repaints exactly once.
 */
export class NoteEditModal extends Modal {
  /** Pending property writes, keyed by frontmatter name (null = delete key). */
  private dirty = new Map<string, unknown>();

  constructor(
    app: App,
    private item: BoardItem,
    private properties: PropertyConfig[],
    private boardFile: TFile,
    private onDone: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass('rb-edit-modal');

    // Header: note title + a button to open the full note.
    const header = contentEl.createDiv({ cls: 'rb-edit-header' });
    header.createEl('h2', { cls: 'rb-edit-title', text: this.item.title });
    const open = header.createEl('button', { cls: 'mod-cta rb-edit-open', text: 'Open note' });
    open.onclick = async () => {
      await this.flush();
      this.close();
      void this.app.workspace.openLinkText(this.item.file.path, this.boardFile.path, false);
    };

    if (this.properties.length === 0) {
      contentEl.createDiv({ cls: 'rb-edit-empty', text: 'This database has no properties to edit.' });
      return;
    }

    const fields = contentEl.createDiv({ cls: 'rb-edit-fields' });
    for (const prop of this.properties) this.renderEditor(fields, prop);
  }

  /** One labelled editor row for a property, control chosen by its type. */
  private renderEditor(parent: HTMLElement, prop: PropertyConfig): void {
    const raw = this.item.frontmatter[prop.name];
    const setting = new Setting(parent).setName(propertyLabel(prop));

    switch (prop.type) {
      case 'checkbox':
        setting.addToggle((t) =>
          t.setValue(asBoolean(raw) ?? false).onChange((v) => this.queue(prop, v)),
        );
        break;

      case 'number':
        setting.addText((t) => {
          t.inputEl.type = 'number';
          const n = asNumber(raw);
          t.setValue(n != null ? String(n) : '').onChange((v) => {
            const parsed = Number(v);
            this.queue(prop, v.trim() === '' || Number.isNaN(parsed) ? null : parsed);
          });
        });
        break;

      case 'multi':
      case 'links':
        setting.setClass('rb-edit-list');
        setting.addTextArea((t) => {
          t.setPlaceholder('one per line');
          t.setValue(asArray(raw).join('\n')).onChange((v) => {
            const arr = v.split('\n').map((s) => s.trim()).filter((s) => s !== '');
            this.queue(prop, arr.length ? arr : null);
          });
        });
        break;

      case 'image':
      case 'text':
      default:
        setting.addText((t) =>
          t.setValue(raw == null ? '' : String(raw)).onChange((v) =>
            this.queue(prop, v.trim() === '' ? null : v),
          ),
        );
    }
  }

  /** Record a pending change and mirror it onto the in-memory item. */
  private queue(prop: PropertyConfig, value: unknown): void {
    const v = value === null || value === undefined || value === '' ? null : value;
    this.dirty.set(prop.name, v);
    if (v === null) delete this.item.frontmatter[prop.name];
    else this.item.frontmatter[prop.name] = v;
  }

  /** Write all pending changes to the note's frontmatter in one pass. */
  private async flush(): Promise<void> {
    if (this.dirty.size === 0) return;
    const entries = [...this.dirty];
    this.dirty.clear();
    await this.app.fileManager.processFrontMatter(this.item.file, (fm) => {
      for (const [name, value] of entries) {
        if (value === null) delete fm[name];
        else fm[name] = value;
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
    // Persist edits, then let the board repaint once.
    void this.flush().finally(() => this.onDone());
  }
}
