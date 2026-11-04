import { useMemo, useState } from 'react';
import { Notice, normalizePath } from 'obsidian';
import type { DatabaseConfig, ViewConfig } from '../types';
import { titleLabel } from '../config';
import { useBoardContext } from '../board/context';
import { useViewItems } from '../board/useItems';
import { EXPORT_EXTENSION, exportItems, type ExportFormat } from '../data/export';
import { Segmented, SettingRow } from './controls';

const PREVIEW_LINES = 40;

/** Export tab: the view's items as shown (filter, search, sort, visible columns) to JSON, CSV or Markdown. */
export function ExportSettings({ config, view }: { config: DatabaseConfig; view: ViewConfig }) {
  const { app, boardFile } = useBoardContext();
  const { items, properties } = useViewItems(config, view);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const text = useMemo(() => exportItems({ items, properties, titleLabel: titleLabel(config) }, format), [items, properties, config, format]);
  const preview = useMemo(() => {
    const lines = text.split(/\r?\n/);
    return lines.length > PREVIEW_LINES ? `${lines.slice(0, PREVIEW_LINES).join('\n')}\n…` : text;
  }, [text]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(`R Board: copied ${items.length} item${items.length === 1 ? '' : 's'} as ${format.toUpperCase()}`);
    } catch {
      new Notice('R Board: could not copy to the clipboard');
    }
  };

  const save = async (): Promise<void> => {
    const folder = boardFile.parent?.path ?? '';
    const base = `${boardFile.basename} - ${view.name}`.replace(/[\\/:*?"<>|#^[\]]/g, '-');
    const ext = EXPORT_EXTENSION[format];
    const at = (n: number): string => normalizePath(`${folder}/${base}${n > 1 ? ` ${n}` : ''}.${ext}`);
    let n = 1;
    while (app.vault.getAbstractFileByPath(at(n))) n++;
    try {
      const file = await app.vault.create(at(n), text);
      new Notice(`R Board: exported to ${file.path}`);
    } catch (e) {
      new Notice(`R Board: could not export — ${(e as Error).message}`);
    }
  };

  return (
    <>
      <SettingRow name="Format" desc={`${items.length} item${items.length === 1 ? '' : 's'} and ${properties.length + 1} columns, as the view shows them now (filter, search and sort).`}>
        <Segmented<ExportFormat>
          value={format}
          options={[
            { value: 'csv', label: 'CSV' },
            { value: 'json', label: 'JSON' },
            { value: 'md', label: 'Markdown' },
          ]}
          onChange={setFormat}
        />
      </SettingRow>
      <SettingRow name="Export" desc={`Copy to the clipboard, or save a .${EXPORT_EXTENSION[format]} file next to ${boardFile.name}.`}>
        <button onClick={() => void copy()}>Copy to clipboard</button>
        <button className="mod-cta" onClick={() => void save()}>
          Save file
        </button>
      </SettingRow>
      <pre className="rb-export-preview">{preview}</pre>
    </>
  );
}
