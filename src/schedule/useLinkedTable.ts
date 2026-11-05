import { useEffect, useState } from 'react';
import { TFile, type App } from 'obsidian';
import { parseTableFile, type TableFile } from '../table/format';

export type LinkedTable = { status: 'none' } | { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; file: TFile; table: TableFile };

/** Another `.table` file, read and re-read whenever it changes on disk. */
export function useLinkedTable(app: App, path: string | undefined): LinkedTable {
  const [state, setState] = useState<LinkedTable>(path ? { status: 'loading' } : { status: 'none' });

  useEffect(() => {
    if (!path) return setState({ status: 'none' });
    let alive = true;
    const load = async (): Promise<void> => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return alive ? setState({ status: 'error', error: `Log table not found: ${path}` }) : undefined;
      const r = parseTableFile(await app.vault.cachedRead(file));
      if (!alive) return;
      setState(r.ok ? { status: 'ok', file, table: r.table } : { status: 'error', error: r.error });
    };
    void load();
    const ref = app.vault.on('modify', (f) => {
      if (f.path === path) void load();
    });
    const renamed = app.vault.on('rename', (f, old) => {
      if (f.path === path || old === path) void load();
    });
    return () => {
      alive = false;
      app.vault.offref(ref);
      app.vault.offref(renamed);
    };
  }, [app, path]);

  return state;
}
