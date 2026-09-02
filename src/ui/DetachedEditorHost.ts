import { WorkspaceLeaf, WorkspaceSplit, type App } from 'obsidian';

/**
 * Hosts a real Obsidian editor leaf *outside* the workspace layout.
 *
 * Two conflicting requirements make this awkward:
 *
 * 1. The editor needs a parent chain. Obsidian walks `leaf.parentSplit` upwards
 *    to find the `WorkspaceContainer` for its window and lays CodeMirror out
 *    against that container's `document`/`window`. A leaf with no parent throws
 *    `Cannot read properties of undefined (reading 'parentSplit')` during setup,
 *    and the host modal ends up empty.
 *
 * 2. The leaf must stay invisible to anything that walks the layout. Parenting
 *    it to `workspace.rootSplit` satisfies (1), but then `leaf.getRoot()` equals
 *    `workspace.rootSplit` — which is exactly how plugins decide a leaf is one
 *    of the user's real tabs. Vertical Tabs, for instance, starts tracking the
 *    modal's leaf as the active tab and dereferences `tabHeaderEl`, a property
 *    only `WorkspaceTabs` ever creates, and the modal breaks again.
 *
 * So we build a private `WorkspaceSplit` that answers the two questions
 * differently:
 *
 *   - `getRoot()` returns the split itself. It is its own root, unreachable from
 *     `workspace.rootSplit`, so no layout walker — Obsidian's or a plugin's —
 *     ever arrives at our leaf.
 *   - `getContainer()` returns the real container for the window the modal lives
 *     in, so the editor still measures against the correct document.
 *
 * None of this is public API. Everything is best-effort and the caller is
 * expected to fall back to a rendered preview if construction throws.
 */

/** The subset of `WorkspaceContainer` we rely on. */
interface ContainerLike {
  doc?: Document;
}

/** The internals of `WorkspaceSplit` we override or populate. */
interface SplitInternals {
  parent?: unknown;
  children?: unknown[];
  containerEl?: HTMLElement;
  getRoot?: () => unknown;
  getContainer?: () => unknown;
}

/** The internals of `WorkspaceLeaf` we populate. */
interface LeafInternals {
  parent?: unknown;
  parentSplit?: unknown;
  containerEl: HTMLElement;
  tabHeaderEl?: HTMLElement;
  tabHeaderInnerTitleEl?: HTMLElement;
  tabHeaderInnerIconEl?: HTMLElement;
}

export class DetachedEditorHost {
  /** The leaf to open a file in. */
  readonly leaf: WorkspaceLeaf;
  /** Mount this into the DOM; it wraps the leaf the way a real split would. */
  readonly containerEl: HTMLElement;

  private readonly split: SplitInternals;

  constructor(app: App, doc: Document) {
    const container = containerForDocument(app, doc);

    const SplitCtor = WorkspaceSplit as unknown as new (
      workspace: unknown,
      direction: string,
    ) => WorkspaceSplit;
    const split = new SplitCtor(app.workspace, 'vertical') as unknown as SplitInternals;
    split.parent = container;
    // Its own root: layout walkers and plugins never reach us from rootSplit.
    split.getRoot = () => split;
    // ...but the editor still resolves the right window to measure against.
    split.getContainer = () => container;
    this.split = split;

    const LeafCtor = WorkspaceLeaf as unknown as new (app: App, parent?: unknown) => WorkspaceLeaf;
    const leaf = new LeafCtor(app, split);
    adoptLeaf(leaf, split, doc);
    split.children = [leaf];
    this.leaf = leaf;

    this.containerEl = split.containerEl ?? doc.createElement('div');
    this.containerEl.addClass('workspace-split');
    if (!split.containerEl) split.containerEl = this.containerEl;
    this.containerEl.appendChild((leaf as unknown as LeafInternals).containerEl);
  }

  /** Unload the editor and drop the private split. */
  destroy(): void {
    this.split.children = [];
    try {
      this.leaf.detach();
    } catch (e) {
      console.error('[r-board] detaching the embedded editor failed', e);
    }
    this.containerEl.remove();
  }
}

/** The `WorkspaceContainer` whose window owns `doc`, falling back to the main one. */
function containerForDocument(app: App, doc: Document): ContainerLike {
  const ws = app.workspace as unknown as {
    rootSplit: ContainerLike;
    floatingSplit?: { children?: ContainerLike[] };
  };
  const containers = [ws.rootSplit, ...(ws.floatingSplit?.children ?? [])];
  return containers.find((c) => c.doc === doc) ?? ws.rootSplit;
}

/** Point the leaf at our split and stub what `WorkspaceTabs` would have added. */
function adoptLeaf(leaf: WorkspaceLeaf, split: SplitInternals, doc: Document): void {
  const internals = leaf as unknown as LeafInternals;
  internals.parent = split;
  if (internals.parentSplit !== split) {
    // `parentSplit` is a getter-only accessor on the prototype in current
    // builds, so a plain assignment throws. An own data property shadows it.
    Object.defineProperty(leaf, 'parentSplit', {
      value: split,
      writable: true,
      configurable: true,
    });
  }

  // A leaf that never joined a tab container has no tab header. Plugins iterate
  // leaves and assume one exists — Vertical Tabs scrolls `leaf.tabHeaderEl` into
  // view on every editor change. Hand them inert, unattached elements rather
  // than `undefined`. Purely defensive, so never let it break the embed.
  try {
    internals.tabHeaderEl ??= doc.createElement('div');
    internals.tabHeaderInnerTitleEl ??= doc.createElement('div');
    internals.tabHeaderInnerIconEl ??= doc.createElement('div');
  } catch {
    /* a build that defines these as accessors doesn't need the stubs */
  }
}
