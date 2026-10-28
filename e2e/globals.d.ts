/** Hooks the dev harness (dev/harness.tsx) puts on `window`, as seen from page.evaluate in tests. */
import type { BoardStore } from '../src/board/store';

declare global {
  interface Window {
    __store: BoardStore;
    __saved: string;
    __notes: Record<string, Record<string, unknown>>;
    __log: string[];
  }
}
