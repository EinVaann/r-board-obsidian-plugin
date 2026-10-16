import { createStore, type StoreApi } from 'zustand/vanilla';
import { produce } from 'immer';
import type { DatabaseConfig, TableRow, ViewConfig } from '../types';

/**
 * State for one open board. Config edits go through `updateConfig` (an Immer
 * recipe), so every change produces a new object only along the edited path —
 * untouched views/properties keep their identity and their components skip
 * re-rendering.
 */
export interface BoardState {
  config: DatabaseConfig | null;
  /** Why the `.board` file couldn't be parsed (null when it parsed). */
  parseError: string | null;
  /** Name of the view being shown. */
  activeView: string;
  search: string;
  /** Bumped whenever notes the board reads change; drives re-querying. */
  vaultTick: number;
  /** Collapsed group labels (sections / kanban columns), for the active view. */
  collapsed: Record<string, true>;
  /** Revealed item count per paginated list, for the active view. */
  pages: Record<string, number>;
  /** Tables: the stored rows (boards: unused). */
  rows: TableRow[];

  /** Edit the rows (Immer draft); persists to the file. */
  updateRows: (recipe: (draft: TableRow[]) => void) => void;
  /** Replace the rows after (re)reading the `.table` file. */
  loadRows: (rows: TableRow[]) => void;

  /** Replace the config after (re)reading the `.board` file. */
  loadConfig: (config: DatabaseConfig | null, parseError: string | null, savedView?: string) => void;
  /** Edit the config in place (Immer draft); persists to the file. */
  updateConfig: (recipe: (draft: DatabaseConfig) => void) => void;
  /** Edit one view by index; follows a rename so it stays the active view. */
  updateView: (index: number, recipe: (draft: ViewConfig) => void) => void;
  setActiveView: (name: string) => void;
  setSearch: (search: string) => void;
  bumpVault: () => void;
  toggleCollapsed: (label: string) => void;
  setPage: (key: string, shown: number) => void;
}

export type BoardStore = StoreApi<BoardState>;

export interface BoardPersistence {
  /** Write the config back to the `.board` file. */
  saveConfig: (config: DatabaseConfig) => void;
  /** Tables: write the rows back to the `.table` file. */
  saveRows?: (rows: TableRow[]) => void;
  /** Remember the active view for this board (plugin data). */
  saveActiveView: (name: string) => void;
}

export function createBoardStore(persist: BoardPersistence): BoardStore {
  return createStore<BoardState>()((set, get) => {
    const commit = (config: DatabaseConfig): void => {
      set({ config });
      persist.saveConfig(config);
    };

    return {
      config: null,
      parseError: null,
      activeView: '',
      search: '',
      vaultTick: 0,
      collapsed: {},
      pages: {},
      rows: [],

      updateRows: (recipe) => {
        const rows = produce(get().rows, recipe);
        if (rows === get().rows) return;
        set({ rows });
        persist.saveRows?.(rows);
      },
      loadRows: (rows) => set({ rows }),

      loadConfig: (config, parseError, savedView) => {
        const keep = savedView ?? get().activeView;
        const exists = config?.views.some((v) => v.name === keep);
        set({
          config,
          parseError,
          activeView: exists ? keep : config?.defaultView ?? config?.views[0]?.name ?? '',
        });
      },

      updateConfig: (recipe) => {
        const { config } = get();
        if (config) commit(produce(config, recipe));
      },

      updateView: (index, recipe) => {
        const { config, activeView } = get();
        const view = config?.views[index];
        if (!config || !view) return;
        const wasActive = view.name === activeView;
        const next = produce(config, (draft) => recipe(draft.views[index]));
        commit(next);
        const renamed = next.views[index].name;
        if (wasActive && renamed !== activeView) {
          set({ activeView: renamed });
          persist.saveActiveView(renamed);
        }
      },

      setActiveView: (name) => {
        if (get().activeView === name) return;
        set({ activeView: name, collapsed: {}, pages: {} });
        persist.saveActiveView(name);
      },

      setSearch: (search) => set({ search }),
      bumpVault: () => set((s) => ({ vaultTick: s.vaultTick + 1 })),

      toggleCollapsed: (label) =>
        set((s) => {
          const collapsed = { ...s.collapsed };
          if (collapsed[label]) delete collapsed[label];
          else collapsed[label] = true;
          return { collapsed };
        }),

      setPage: (key, shown) => set((s) => ({ pages: { ...s.pages, [key]: shown } })),
    };
  });
}

/** The view currently shown (falls back to the first view). */
export function selectCurrentView(s: BoardState): ViewConfig | null {
  if (!s.config) return null;
  return s.config.views.find((v) => v.name === s.activeView) ?? s.config.views[0] ?? null;
}
