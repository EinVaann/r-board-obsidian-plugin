import type { App } from 'obsidian';
import { BoardContext, type BoardContextValue } from '../board/context';
import { ReactModal } from '../react/mount';
import { BoardSettings } from './BoardSettings';
import { ViewSettings } from './ViewSettings';
import { FilterBuilder } from './FilterBuilder';

/*
 * Settings modals render inside the board's own context, so they read and
 * write the same store: every edit shows on the board behind the modal live.
 */

export function openBoardSettings(app: App, ctx: BoardContextValue): void {
  new ReactModal(
    app,
    () => (
      <BoardContext.Provider value={ctx}>
        <BoardSettings />
      </BoardContext.Provider>
    ),
    { title: 'Board settings', cls: 'rb-settings-modal' },
  ).open();
}

export function openViewSettings(app: App, ctx: BoardContextValue, viewIndex: number, onDelete: () => void): void {
  new ReactModal(
    app,
    (modal) => (
      <BoardContext.Provider value={ctx}>
        <ViewSettings
          viewIndex={viewIndex}
          onDelete={() => {
            modal.close();
            onDelete();
          }}
        />
      </BoardContext.Provider>
    ),
    { title: 'View settings', cls: 'rb-settings-modal' },
  ).open();
}

export function openFilterModal(app: App, ctx: BoardContextValue, viewIndex: number): void {
  const { config, updateView } = ctx.store.getState();
  const view = config?.views[viewIndex];
  if (!config || !view) return;
  new ReactModal(
    app,
    (modal) => (
      <FilterBuilder
        initial={view.filter}
        properties={config.properties}
        onClose={() => modal.close()}
        onSave={(group) => updateView(viewIndex, (v) => void (v.filter = group))}
      />
    ),
    { title: 'Filters' },
  ).open();
}
