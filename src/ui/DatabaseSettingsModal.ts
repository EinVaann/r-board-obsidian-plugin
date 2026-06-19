import { App, Modal, Notice, Setting } from 'obsidian';
import type { DatabaseConfig, PropertyConfig } from '../types';
import { normalizeTag } from '../config';
import { renderPropertyEditor } from './PropertyEditor';

/** Edit a database's name, base tag, and properties (views are unchanged). */
export class DatabaseSettingsModal extends Modal {
  private name: string;
  private sourceTag: string;
  private properties: PropertyConfig[];
  private readonly base: DatabaseConfig;
  private readonly onSave: (config: DatabaseConfig) => void;

  constructor(app: App, config: DatabaseConfig, onSave: (config: DatabaseConfig) => void) {
    super(app);
    this.base = config;
    this.name = config.name ?? '';
    this.sourceTag = config.sourceTag;
    this.properties = config.properties.map((p) => ({ ...p }));
    this.onSave = onSave;
  }

  onOpen(): void {
    this.titleEl.setText('Board settings');
    const { contentEl } = this;
    contentEl.addClass('rb-wizard');

    new Setting(contentEl)
      .setName('Name')
      .addText((t) => t.setValue(this.name).onChange((v) => (this.name = v)));

    new Setting(contentEl)
      .setName('Base tag')
      .addText((t) => t.setValue(this.sourceTag).onChange((v) => (this.sourceTag = v)));

    contentEl.createEl('h4', { text: 'Properties' });
    renderPropertyEditor(contentEl.createDiv(), this.properties, () => {});

    new Setting(contentEl)
      .addButton((b) => b.setButtonText('Save').setCta().onClick(() => this.submit()))
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  private submit(): void {
    const tag = normalizeTag(this.sourceTag);
    if (!tag) {
      new Notice('R Board: a base tag is required.');
      return;
    }
    this.onSave({
      ...this.base,
      name: this.name.trim() || undefined,
      sourceTag: tag,
      properties: this.properties.filter((p) => p.name.trim() !== ''),
    });
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
