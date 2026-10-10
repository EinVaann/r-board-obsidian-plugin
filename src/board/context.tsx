import { createContext, useContext, type RefObject } from 'react';
import { useStore } from 'zustand';
import type { App, TFile } from 'obsidian';
import type { BoardItem } from '../types';
import type { BoardState, BoardStore } from './store';

/** Imperative actions the board UI asks its Obsidian host (the BoardView) to do. */
export interface BoardActions {
  /** Open the in-place edit modal for a note. */
  editFile: (file: TFile, title?: string) => void;
  /** Open a note in the workspace (new tab when `newLeaf`). */
  openNote: (item: BoardItem, newLeaf: boolean) => void;
  openBoardSettings: () => void;
  openViewSettings: (viewIndex: number) => void;
  openFilter: (viewIndex: number) => void;
  /** Create a note tagged for this board in its "new note" folder. */
  createNewNote: () => void;
  /** Open the setup wizard for an empty / invalid `.board` file. */
  openSetup: () => void;
  /** Tell the host which notes are on the board (for change detection). */
  reportItems: (items: BoardItem[]) => void;
}

export interface BoardContextValue {
  app: App;
  store: BoardStore;
  actions: BoardActions;
  /** The `.board` file, anchoring relative link resolution. */
  boardFile: TFile;
  /** The scrolling body, for virtualized lists. */
  scrollRef: RefObject<HTMLDivElement | null>;
}

export const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoardContext(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error('useBoardContext() outside a board');
  return ctx;
}

/** Subscribe to a slice of this board's store. */
export function useBoard<T>(selector: (s: BoardState) => T): T {
  return useStore(useBoardContext().store, selector);
}
