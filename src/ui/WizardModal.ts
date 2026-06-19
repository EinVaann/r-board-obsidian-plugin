import { App, Modal, Notice, Setting } from 'obsidian';
import type { DatabaseConfig, PropertyConfig } from '../types';
import { normalizeTag } from '../config';
import { renderPropertyEditor } from './PropertyEditor';

/**
 * Guided setup for a database: name, base tag, and its properties. Used both
 * when creating a new `.board` file and when opening an empty/uninitialized
 * one. Views are added later from the board toolbar.
 */
export class WizardModal extends Modal {
  private name: string;
  private sourceTag: string;
  private properties: PropertyConfig[];
  private readonly heading: string;
  private readonly onComplete: (config: DatabaseConfig) => void;

  constructor(
    app: App,
    seed: Partial<DatabaseConfig>,
    heading: string,
    onComplete: (config: DatabaseConfig) => void,
  ) {
    super(app);
    this.name = seed.name ?? '';
    this.sourceTag = seed.sourceTag ?? '';
    this.properties = (seed.properties ?? []).map((p) => ({ ...p }));
    this.heading = heading;
    this.onComplete = onComplete;
  }

  onOpen(): void {
    this.titleEl.setText(this.heading);
    const { contentEl } = this;
    contentEl.addClass('rb-wizard');

    new Setting(contentEl)
      .setName('Name')
      .setDesc('Shown in the board title.')
      .addText((t) => t.setValue(this.name).onChange((v) => (this.name = v)));

    new Setting(contentEl)
      .setName('Base tag')
      .setDesc('Notes carrying this tag become rows (without the leading #).')
      .addText((t) =>
        t.setPlaceholder('backlog').setValue(this.sourceTag).onChange((v) => (this.sourceTag = v)),
      );

    contentEl.createEl('h4', { text: 'Properties' });
    contentEl.createEl('p', {
      cls: 'rb-wizard-hint',
      text: 'Frontmatter keys to show on cards and in tables.',
    });
    const propsEl = contentEl.createDiv();
    renderPropertyEditor(propsEl, this.properties, () => {});

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText('Create').setCta().onClick(() => this.submit()),
      )
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  private submit(): void {
    const tag = normalizeTag(this.sourceTag);
    if (!tag) {
      new Notice('R Board: a base tag is required.');
      return;
    }
    this.onComplete({
      name: this.name.trim() || undefined,
      sourceTag: tag,
      properties: this.properties.filter((p) => p.name.trim() !== ''),
      views: [],
    });
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
