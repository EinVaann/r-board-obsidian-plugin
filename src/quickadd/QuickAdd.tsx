import { useRef, useState } from 'react';
import { Notice, TFile, type App } from 'obsidian';
import type RBoardPlugin from '../../main';
import type { DatabaseConfig, PropertyConfig } from '../types';
import { parseDatabaseConfig, propertyLabel, serializeDatabase } from '../config';
import { parseTableFile, serializeTableFile } from '../table/format';
import { addRow } from '../table/rows';
import { createNoteFor } from '../data/notes';
import { queryItems } from '../data/query';
import { toStored, type StoredValue } from '../data/properties';
import { asArray } from '../render/values';
import { FormField } from './FormField';
import { ReactModal } from '../react/mount';
import { Icon } from '../react/Icon';
import { PROPERTY_TYPE_ICON } from '../settings/PropertyEditor';
import { BOARD_VIEW_TYPE, BoardView, TABLE_EXTENSION } from '../BoardView';
import { quickAddCommand, quickAddCommandId } from './ids';
import { addOptions } from './options';

/** The command's display name, as the palette shows it after "R Board: ". */
export const quickAddName = (config: DatabaseConfig, file: TFile): string => `Quick add to ${config.name?.trim() || file.basename}`;

/**
 * One palette command per database with quick add set up. Commands come and go
 * at runtime (no restart); each is keyed by the config's stable id.
 */
export class QuickAddCommands {
  /** Quick-add id → the file it adds to and the command name registered. */
  private readonly entries = new Map<string, { path: string; name: string }>();

  constructor(private readonly plugin: RBoardPlugin) {}

  /** Read every `.board` / `.table` file once and register their commands. */
  async scan(): Promise<void> {
    for (const file of this.plugin.listBoardFiles()) {
      const config = readConfig(file, await this.plugin.app.vault.cachedRead(file));
      if (config?.quickAdd) this.sync(file, config);
    }
  }

  /** Bring the file's command in line with its (just loaded or saved) config. */
  sync(file: TFile, config: DatabaseConfig | null): void {
    const q = config?.quickAdd;
    for (const [id, e] of this.entries) if (e.path === file.path && id !== q?.id) this.remove(id);
    if (!config || !q) return;
    const name = quickAddName(config, file);
    const current = this.entries.get(q.id);
    // A copied file shares its original's id: the original keeps the command.
    if (current && current.path !== file.path && this.plugin.app.vault.getAbstractFileByPath(current.path)) return;
    if (current?.name === name) {
      current.path = file.path;
      return;
    }
    if (current) this.removeCommand(q.id);
    this.entries.set(q.id, { path: file.path, name });
    this.plugin.addCommand({ id: quickAddCommand(q.id), name, callback: () => void this.run(q.id) });
  }

  /** Follow a renamed file; re-read it, since an unnamed database's command uses the file name. */
  async rename(oldPath: string, file: TFile): Promise<void> {
    let moved = false;
    for (const e of this.entries.values()) if (e.path === oldPath) (e.path = file.path), (moved = true);
    if (moved) this.sync(file, readConfig(file, await this.plugin.app.vault.cachedRead(file)));
  }

  deleted(path: string): void {
    for (const [id, e] of this.entries) if (e.path === path) this.remove(id);
  }

  private remove(id: string): void {
    this.entries.delete(id);
    this.removeCommand(id);
  }

  private removeCommand(id: string): void {
    const plugin = this.plugin as RBoardPlugin & { removeCommand?: (id: string) => void };
    if (typeof plugin.removeCommand === 'function') plugin.removeCommand(quickAddCommand(id));
    else (this.plugin.app as App & { commands?: { removeCommand(id: string): void } }).commands?.removeCommand(quickAddCommandId(id));
  }

  private async run(id: string): Promise<void> {
    const entry = this.entries.get(id);
    const file = entry && this.plugin.app.vault.getAbstractFileByPath(entry.path);
    if (file instanceof TFile) await openQuickAdd(this.plugin.app, file);
  }
}

/** The config of a `.board` / `.table` file's text, or null if it can't be read. */
function readConfig(file: TFile, text: string): DatabaseConfig | null {
  if (file.extension === TABLE_EXTENSION) {
    const r = parseTableFile(text);
    return r.ok ? r.table.config : null;
  }
  const r = parseDatabaseConfig(text);
  return r.ok ? r.config : null;
}

/** The pane showing `file`, if one is open. */
function openView(app: App, file: TFile): BoardView | null {
  for (const leaf of app.workspace.getLeavesOfType(BOARD_VIEW_TYPE)) {
    if (leaf.view instanceof BoardView && leaf.view.file?.path === file.path) return leaf.view;
  }
  return null;
}

/** Open the quick-add form for a database file. */
export async function openQuickAdd(app: App, file: TFile): Promise<void> {
  const text = await app.vault.read(file);
  const config = openView(app, file)?.currentConfig() ?? readConfig(file, text);
  if (!config?.quickAdd) {
    new Notice(`R Board: quick add is not set up for ${file.basename}.`);
    return;
  }
  if (config.kind !== 'table' && !config.newNoteFolder?.trim()) {
    new Notice('R Board: set a "New note location" in board settings to use quick add.');
    return;
  }
  new ReactModal(
    app,
    (modal) => (
      <QuickAddForm
        app={app}
        config={config}
        known={knownValues(app, config, text)}
        sourcePath={file.path}
        onSubmit={(title, values, created) => {
          modal.close();
          void addRecord(app, file, config, title, values, created);
        }}
      />
    ),
    { title: quickAddName(config, file), cls: 'rb-settings-modal rb-quick-add-modal' },
  ).open();
}

/** Values already used by the form's select / multi fields, by property name. */
function knownValues(app: App, config: DatabaseConfig, text: string): Record<string, string[]> {
  const props = quickAddFields(config).filter((p) => p.type === 'select' || p.type === 'multi');
  if (!props.length) return {};
  const parsed = config.kind === 'table' ? parseTableFile(text) : null;
  const records = parsed ? (parsed.ok ? parsed.table.rows.map((r) => r.cells) : []) : queryItems(app, config).map((i) => i.values);
  const out: Record<string, string[]> = {};
  for (const p of props) out[p.name] = [...new Set(records.flatMap((r) => asArray(r[p.name])))].sort((a, b) => a.localeCompare(b));
  return out;
}

/** Write the record: a tagged note for boards, a row for tables. */
async function addRecord(
  app: App,
  file: TFile,
  config: DatabaseConfig,
  title: string,
  values: Record<string, StoredValue>,
  created: Record<string, string[]>,
): Promise<void> {
  const label = config.name?.trim() || file.basename;
  const view = openView(app, file);
  const newOptions = Object.keys(created).length > 0;
  if (view && newOptions) view.updateConfig((c) => addOptions(c, created));
  if (config.kind === 'table') {
    if (view) view.appendRow(values);
    else {
      let error = '';
      await app.vault.process(file, (text) => {
        const r = parseTableFile(text);
        if (!r.ok) {
          error = r.error;
          return text;
        }
        addOptions(r.table.config, created);
        addRow(r.table.rows, values);
        return serializeTableFile(r.table);
      });
      if (error) {
        new Notice(`R Board: could not add to ${label} — ${error}`);
        return;
      }
    }
    new Notice(`Added ${title ? `"${title}" ` : 'a row '}to ${label}`);
    return;
  }
  if (!view && newOptions) {
    await app.vault.process(file, (text) => {
      const r = parseDatabaseConfig(text);
      if (!r.ok) return text;
      addOptions(r.config, created);
      return serializeDatabase(r.config);
    });
  }
  const open = config.quickAdd?.openNote === true;
  const note = await createNoteFor(app, config, values, { title, open });
  if (note && !open) new Notice(`Added "${note.basename}" to ${label}`);
}
/** The properties a form asks for, besides the title: listed, existing, not formulas. */
export function quickAddFields(config: DatabaseConfig): PropertyConfig[] {
  const byName = new Map(config.properties.map((p) => [p.name, p]));
  return (config.quickAdd?.properties ?? [])
    .map((name) => byName.get(name))
    .filter((p): p is PropertyConfig => !!p && p.type !== 'formula' && p.name !== config.titleProperty);
}

/** Title first, then the chosen fields. Enter moves to the next field; on the last, it adds. */
function QuickAddForm({
  app,
  config,
  known,
  sourcePath,
  onSubmit,
}: {
  app: App;
  config: DatabaseConfig;
  known: Record<string, string[]>;
  sourcePath: string;
  /** `created`: select / multi values typed in the form, by property name. */
  onSubmit: (title: string, values: Record<string, StoredValue>, created: Record<string, string[]>) => void;
}) {
  const titleProp = config.kind === 'table' ? config.properties.find((p) => p.name === config.titleProperty) : undefined;
  const fields = titleProp ? [titleProp, ...quickAddFields(config)] : quickAddFields(config);
  // Editors commit on blur, just before the Add click: a ref sees that value at once.
  const values = useRef<Record<string, StoredValue>>({});
  const [, rerender] = useState(0);
  const [title, setTitle] = useState('');
  const titleRef = useRef(title);
  const fieldsEl = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  const submit = (): void => {
    if (done.current) return;
    done.current = true;
    const stored: Record<string, StoredValue> = {};
    const created: Record<string, string[]> = {};
    for (const p of fields) {
      const v = values.current[p.name];
      const s = v === undefined ? null : toStored(p, v);
      if (s === null) continue;
      stored[p.name] = s;
      if (p.type !== 'select' && p.type !== 'multi') continue;
      const added = asArray(s).filter((x) => !p.options?.some((o) => o.value === x) && !known[p.name]?.includes(x));
      if (added.length) created[p.name] = added;
    }
    const t = titleProp ? String(stored[titleProp.name] ?? '') : titleRef.current.trim();
    onSubmit(t, stored, created);
  };

  /** After Enter: focus the next field, or add when it was the last. */
  const next = (): void => {
    const els = Array.from(fieldsEl.current?.querySelectorAll<HTMLElement>('input:not(.rb-qa-search), select, button[role="switch"], .rb-qa-select') ?? []);
    const at = els.indexOf(document.activeElement as HTMLElement);
    if (at >= 0 && at < els.length - 1) els[at + 1].focus();
    else submit();
  };

  return (
    <div className="rb-wizard rb-record rb-quick-add">
      <div ref={fieldsEl}>
        {!titleProp && (
          <div className="setting-item rb-record-row">
            <div className="setting-item-info">
              <div className="setting-item-name">
                <Icon name="file-text" className="rb-record-icon" />
                Title
              </div>
            </div>
            <div className="setting-item-control">
              <input
                type="text"
                autoFocus
                value={title}
                placeholder="Untitled"
                onChange={(e) => setTitle((titleRef.current = e.target.value))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  next();
                }}
              />
            </div>
          </div>
        )}
        {fields.map((prop, i) => (
          <div key={prop.name} className="setting-item rb-record-row">
            <div className="setting-item-info">
              <div className="setting-item-name">
                <Icon name={PROPERTY_TYPE_ICON[prop.type]} className="rb-record-icon" />
                {propertyLabel(prop)}
              </div>
            </div>
            <div className="setting-item-control">
              <FormField
                app={app}
                prop={prop}
                value={values.current[prop.name]}
                known={known[prop.name] ?? []}
                sourcePath={sourcePath}
                autoFocus={!!titleProp && i === 0}
                onChange={(value) => {
                  values.current[prop.name] = value;
                  rerender((n) => n + 1);
                }}
                onEnter={next}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="rb-record-actions">
        <button className="mod-cta" onClick={submit}>
          <Icon name="plus" /> Add
        </button>
      </div>
    </div>
  );
}
