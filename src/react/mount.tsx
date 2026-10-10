import { StrictMode, createContext, useContext, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MarkdownRenderChild, Modal, type App } from 'obsidian';
import { applySheet } from '../ui/sheet';

/** The Obsidian app, available to every React tree the plugin mounts. */
const AppContext = createContext<App | null>(null);

export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp() outside an R Board React root');
  return app;
}

/**
 * Mount a React tree into an Obsidian-owned element. Returns the unmount
 * function — call it from the owner's close/unload hook, or the tree (and its
 * event listeners) leaks across Hot-Reloads.
 */
export function mountReact(app: App, container: HTMLElement, node: ReactNode): () => void {
  const root: Root = createRoot(container);
  root.render(
    <StrictMode>
      <AppContext.Provider value={app}>{node}</AppContext.Provider>
    </StrictMode>,
  );
  return () => root.unmount();
}

/** An Obsidian modal whose content is a React tree. */
export class ReactModal extends Modal {
  private unmount: (() => void) | null = null;

  constructor(
    app: App,
    private readonly render: (modal: ReactModal) => ReactNode,
    private readonly opts: { title?: string; cls?: string } = {},
  ) {
    super(app);
  }

  onOpen(): void {
    if (this.opts.title) this.titleEl.setText(this.opts.title);
    if (this.opts.cls) this.modalEl.addClass(this.opts.cls);
    applySheet(this);
    this.unmount = mountReact(this.app, this.contentEl, this.render(this));
  }

  onClose(): void {
    this.unmount?.();
    this.unmount = null;
  }
}

/** A markdown post-processor child (e.g. a ```recipe block) rendered with React. */
export class ReactRenderChild extends MarkdownRenderChild {
  private unmount: (() => void) | null = null;

  constructor(
    private readonly app: App,
    containerEl: HTMLElement,
    private readonly node: ReactNode,
  ) {
    super(containerEl);
  }

  onload(): void {
    this.unmount = mountReact(this.app, this.containerEl, this.node);
  }

  onunload(): void {
    this.unmount?.();
    this.unmount = null;
  }
}
