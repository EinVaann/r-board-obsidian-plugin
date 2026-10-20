import { useSyncExternalStore } from 'react';
import { Notice, TextFileView, TFile, type WorkspaceLeaf } from 'obsidian';
import { mountReact } from '../react/mount';
import { FactoryWorkspace } from './Workspace';
import { parseFactoryDoc, serializeFactoryDoc, type FactoryDoc, type LegacyBook } from './plan';
import { parseData } from './book';

export const FACTORY_VIEW_TYPE = 'r-board-factory';

type State = { doc: FactoryDoc; error: null } | { doc: null; error: string };

/** A tiny external store, so the React tree follows file reloads without remounting. */
class PlanStore {
  private state: State = { doc: null, error: 'Loading…' };
  private listeners = new Set<() => void>();
  get = (): State => this.state;
  set(state: State): void {
    this.state = state;
    this.listeners.forEach((l) => l());
  }
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

/** A `.factory` file in its own tab: Data + Planner. */
export class FactoryPlanView extends TextFileView {
  private readonly store = new PlanStore();
  private unmount: (() => void) | null = null;
  /** The text this view last wrote, so its own saves don't reload it. */
  private written = '';

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return FACTORY_VIEW_TYPE;
  }

  getIcon(): string {
    return 'factory';
  }

  getDisplayText(): string {
    return this.file?.basename ?? 'Factory';
  }

  getViewData(): string {
    return this.data;
  }

  setViewData(data: string): void {
    this.data = data;
    if (data === this.written) return;
    const r = parseFactoryDoc(data);
    this.store.set(r.ok ? { doc: r.doc, error: null } : { doc: null, error: r.error });
    if (r.ok && r.legacy) void this.copyLegacyTables(r.doc, r.legacy);
  }

  /** Old files linked their tables: copy them into the file (the .table files stay where they are). */
  private async copyLegacyTables(doc: FactoryDoc, legacy: LegacyBook): Promise<void> {
    const raw: Record<string, unknown> = {};
    const copied: string[] = [];
    for (const [key, path] of Object.entries(legacy) as [keyof LegacyBook, string][]) {
      const t = this.app.vault.getAbstractFileByPath(path);
      if (!(t instanceof TFile)) continue;
      try {
        raw[key] = JSON.parse(await this.app.vault.read(t));
        copied.push(t.basename);
      } catch {
        // Not JSON: leave that table empty.
      }
    }
    if (!copied.length) return;
    this.change({ ...doc, data: parseData(raw) });
    new Notice(`R Board: copied ${copied.join(', ')} into ${this.file?.basename ?? 'this factory'}. It now keeps its own data (Data tab).`);
  }

  clear(): void {
    this.written = '';
  }

  private change = (next: FactoryDoc): void => {
    this.data = serializeFactoryDoc(next);
    this.written = this.data;
    this.store.set({ doc: next, error: null });
    this.requestSave();
  };

  async onOpen(): Promise<void> {
    this.contentEl.addClass('rb-root', 'rb-planner-root');
    const view = this;
    function Root() {
      const state = useSyncExternalStore(view.store.subscribe, view.store.get);
      if (!state.doc) return <div className="rb-pl-empty">{state.error}</div>;
      return <FactoryWorkspace doc={state.doc} onChange={view.change} />;
    }
    this.unmount = mountReact(this.app, this.contentEl, <Root />);
  }

  async onClose(): Promise<void> {
    this.unmount?.();
    this.unmount = null;
  }
}
