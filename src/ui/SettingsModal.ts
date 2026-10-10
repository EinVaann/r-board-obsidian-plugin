import { App, Modal, setIcon } from 'obsidian';

/** One tab of a settings modal. */
export interface SettingsTab {
  id: string;
  label: string;
  icon: string;
  render: (container: HTMLElement) => void;
}

/**
 * A modal with a row of tabs over a scrolling body. The tab list is re-read on
 * every `refresh()`, so tabs can depend on live state (e.g. a "Columns" tab
 * that only exists for kanban views).
 */
export class SettingsModal extends Modal {
  private active: string;

  constructor(
    app: App,
    private readonly heading: string,
    private readonly getTabs: () => SettingsTab[],
    initialTab?: string,
  ) {
    super(app);
    this.active = initialTab ?? '';
  }

  onOpen(): void {
    this.modalEl.addClass('rb-settings-modal');
    this.titleEl.setText(this.heading);
    this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Re-render the tab strip and the active tab, keeping its scroll position. */
  refresh(): void {
    const { contentEl } = this;
    const tabs = this.getTabs();
    const switched = !tabs.some((t) => t.id === this.active);
    if (switched) this.active = tabs[0]?.id ?? '';
    const scrollTop = switched ? 0 : contentEl.querySelector('.rb-settings-body')?.scrollTop ?? 0;

    contentEl.empty();
    contentEl.addClass('rb-wizard', 'rb-settings');

    const strip = contentEl.createDiv({ cls: 'rb-settings-tabs' });
    for (const tab of tabs) {
      const btn = strip.createEl('button', {
        cls: tab.id === this.active ? 'rb-settings-tab rb-active' : 'rb-settings-tab',
      });
      setIcon(btn.createSpan({ cls: 'rb-settings-tab-icon' }), tab.icon);
      btn.createSpan({ text: tab.label });
      btn.onclick = () => {
        if (this.active === tab.id) return;
        this.active = tab.id;
        this.refresh();
        this.contentEl.querySelector('.rb-settings-body')?.scrollTo(0, 0);
      };
    }

    const body = contentEl.createDiv({ cls: 'rb-settings-body' });
    tabs.find((t) => t.id === this.active)?.render(body);
    body.scrollTop = scrollTop;
  }
}
