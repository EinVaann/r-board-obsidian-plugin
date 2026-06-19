import { ItemView, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type RBoardPlugin from '../../main';
import { parseDatabaseConfig } from '../config';
import { WizardModal } from '../ui/WizardModal';

export const HOME_VIEW_TYPE = 'r-board-home';

/** A hub listing every `.board` database in the vault, with a create button. */
export class BoardHomeView extends ItemView {
  plugin: RBoardPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: RBoardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return HOME_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'R Board';
  }

  getIcon(): string {
    return 'layout-dashboard';
  }

  async onOpen(): Promise<void> {
    await this.render();
    // Reflect databases added/removed/renamed while open.
    const refresh = (): void => void this.render();
    this.registerEvent(this.app.vault.on('create', refresh));
    this.registerEvent(this.app.vault.on('delete', refresh));
    this.registerEvent(this.app.vault.on('rename', refresh));
  }

  async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('rb-home');

    const header = root.createDiv({ cls: 'rb-home-header' });
    header.createEl('h2', { text: 'Boards' });
    const create = header.createEl('button', { cls: 'rb-home-create' });
    setIcon(create.createSpan({ cls: 'rb-home-create-icon' }), 'plus');
    create.createSpan({ text: 'Create board' });
    create.onclick = () => this.openCreateWizard();

    const files = this.plugin.listBoardFiles();
    if (files.length === 0) {
      root.createDiv({
        cls: 'rb-home-empty',
        text: 'No boards yet. Click “Create board” to make your first one.',
      });
      return;
    }

    const grid = root.createDiv({ cls: 'rb-home-grid' });
    for (const file of files) {
      let raw = '';
      try {
        raw = await this.app.vault.cachedRead(file);
      } catch {
        /* ignore */
      }
      this.renderCard(grid, file, raw);
    }
  }

  private renderCard(grid: HTMLElement, file: TFile, raw: string): void {
    const card = grid.createDiv({ cls: 'rb-home-card' });
    const result = parseDatabaseConfig(raw);

    setIcon(card.createDiv({ cls: 'rb-home-card-icon' }), 'layout-dashboard');
    const body = card.createDiv({ cls: 'rb-home-card-body' });
    body.createDiv({
      cls: 'rb-home-card-title',
      text: result.ok ? result.config.name ?? file.basename : file.basename,
    });

    if (result.ok) {
      const n = result.config.views.length;
      body.createDiv({
        cls: 'rb-home-card-meta',
        text: `#${result.config.sourceTag} · ${n} view${n === 1 ? '' : 's'}`,
      });
    } else {
      body.createDiv({ cls: 'rb-home-card-meta rb-home-card-error', text: 'Not configured yet' });
    }

    card.onclick = () => void this.plugin.openBoard(file);
  }

  private openCreateWizard(): void {
    new WizardModal(this.app, {}, 'Create database', (config) => {
      void this.plugin.createDatabaseFromConfig(config);
    }).open();
  }
}
