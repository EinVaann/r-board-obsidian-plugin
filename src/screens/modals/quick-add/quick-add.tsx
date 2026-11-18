import { useRef, useState } from 'react';
import { Notice, TFile, type App } from 'obsidian';
import type RBoardPlugin from '../../../../main';
import type { DatabaseConfig, PropertyConfig } from '../../../types/database';
import { parseDatabaseConfig, propertyLabel, serializeDatabase } from '../../../lib/config';
import { parseTableFile } from '../../../lib/table/format';
import { appendTableRow, openBoardView } from '../../../lib/table/append';
import { createNoteFor } from '../../../lib/data/notes';
import { queryItems } from '../../../lib/data/query';
import { toStored, type StoredValue } from '../../../lib/data/properties';
import { asArray, linkTo, parseLink } from '../../../lib/render/values';
import { saveImageDraft, type ImageDraft } from '../../../lib/data/image-import';
import { FormField } from './_components/form-field';
import { ReactModal } from '../../../obsidian/mount';
import { Icon } from '../../../components/icon';
import { TextButton as Button } from '@/components/form-controls';
import { PROPERTY_TYPE_ICON } from '../settings/_components/property-editor';
import { TABLE_EXTENSION } from '../../../obsidian/board-view';
import { quickAddCommand, quickAddCommandId } from '../../../lib/quick-add/ids';
import { addOptions } from '../../../lib/quick-add/options';

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

/** Open the quick-add form for a database file. */
export async function openQuickAdd(app: App, file: TFile): Promise<void> {
  const text = await app.vault.read(file);
  const config = openBoardView(app, file)?.currentConfig() ?? readConfig(file, text);
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
        onCancel={() => modal.close()}
      />
    ),
    { title: quickAddName(config, file), cls: 'rb-quick-add-modal' },
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
  if (config.kind === 'table') {
    const error = await appendTableRow(app, file, values, created);
    new Notice(error ? `R Board: could not add to ${label} — ${error}` : `Added ${title ? `"${title}" ` : 'a row '}to ${label}`);
    return;
  }
  const view = openBoardView(app, file);
  const newOptions = Object.keys(created).length > 0;
  if (view && newOptions) view.updateConfig((c) => addOptions(c, created));
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
export function QuickAddForm({
  app,
  config,
  known,
  sourcePath,
  initial,
  onSubmit,
  onCancel,
}: {
  app: App;
  config: DatabaseConfig;
  known: Record<string, string[]>;
  sourcePath: string;
  /** Starting values, by property name. */
  initial?: Record<string, StoredValue>;
  /** `created`: select / multi values typed in the form, by property name. */
  onSubmit: (title: string, values: Record<string, StoredValue>, created: Record<string, string[]>) => void;
  onCancel?: () => void;
}) {
  // Tables: the title column, edited like its type (text, link, url…). A formula title is computed, so not asked.
  const titleProp = config.kind === 'table' ? config.properties.find((p) => p.name === config.titleProperty && p.type !== 'formula') : undefined;
  const fields = titleProp ? [titleProp, ...quickAddFields(config)] : quickAddFields(config);
  // Editors commit on blur, just before the Add click: a ref sees that value at once.
  const values = useRef<Record<string, StoredValue>>({ ...initial });
  const [, rerender] = useState(0);
  const [title, setTitle] = useState('');
  const titleRef = useRef(title);
  const fieldsEl = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, ImageDraft | null>>({});
  const [saving, setSaving] = useState(false);

  /** Write dropped images into the vault; their links become the field values. */
  const saveDrafts = async (): Promise<boolean> => {
    for (const [name, draft] of Object.entries(drafts)) {
      if (!draft) continue;
      try {
        const file = await saveImageDraft(app, draft);
        values.current[name] = linkTo(app, file, sourcePath, false);
        setDrafts((d) => ({ ...d, [name]: null }));
      } catch (e) {
        new Notice(`R Board: could not save "${draft.name}" — ${(e as Error).message}`);
        return false;
      }
    }
    return true;
  };

  const submit = async (): Promise<void> => {
    if (done.current) return;
    done.current = true;
    setSaving(true);
    if (!(await saveDrafts())) {
      done.current = false;
      setSaving(false);
      return;
    }
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
    const t = titleProp ? asArray(stored[titleProp.name]).map((v) => parseLink(v)?.text ?? v).join(', ') : titleRef.current.trim();
    onSubmit(t, stored, created);
  };

  /** After Enter: focus the next field, or add when it was the last. */
  const next = (): void => {
    const els = Array.from(fieldsEl.current?.querySelectorAll<HTMLElement>('input:not(.rb-qa-search):not([type="file"]), select, button[role="switch"], .rb-qa-select') ?? []);
    const at = els.indexOf(document.activeElement as HTMLElement);
    if (at >= 0 && at < els.length - 1) els[at + 1].focus();
    else void submit();
  };

  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  /** The field that names the record: first, full width, focused on open. */
  const isTitle = (p: PropertyConfig): boolean => p === titleProp;

  return (
    <div
      className="rb-quick-add"
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.nativeEvent.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        // Let the focused editor commit on blur first.
        (document.activeElement as HTMLElement | null)?.blur?.();
        setTimeout(() => void submit(), 0);
      }}
    >
      <div className="rb-qa-body" ref={fieldsEl}>
        <div className="rb-qa-fields">
          {!titleProp && (
            // A board's note title is its file name: always plain text.
            <div className="rb-qa-field rb-qa-field-title" data-width="full">
              <div className="rb-qa-label-row">
                <span className="rb-qa-label">
                  <Icon name="file-text" />
                  Title
                </span>
              </div>
              <input
                type="text"
                autoFocus
                value={title}
                placeholder="Untitled"
                onChange={(e) => setTitle((titleRef.current = e.target.value))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  next();
                }}
              />
            </div>
          )}
          {fields.map((prop, i) => {
              const field = (
                <FormField
                  app={app}
                  prop={prop}
                  value={values.current[prop.name]}
                  known={known[prop.name] ?? []}
                  sourcePath={sourcePath}
                  autoFocus={!!titleProp && i === 0}
                  draft={drafts[prop.name] ?? null}
                  imageFolder={config.quickAdd?.imageFolders?.[prop.name]}
                  onDraft={(d) => setDrafts((all) => ({ ...all, [prop.name]: d }))}
                  onChange={(value) => {
                    values.current[prop.name] = value;
                    rerender((n) => n + 1);
                  }}
                  onEnter={next}
                />
              );
              const label = (
                <span className="rb-qa-label">
                  <Icon name={PROPERTY_TYPE_ICON[prop.type]} />
                  {propertyLabel(prop)}
                </span>
              );
              // A switch sits beside its label, in a box the height of the other controls.
              return prop.type === 'checkbox' ? (
                <div key={prop.name} className="rb-qa-field rb-qa-field-check" data-width="half">
                  <label className="rb-qa-check-row">
                    {label}
                    {field}
                  </label>
                </div>
              ) : (
                <div key={prop.name} className={isTitle(prop) ? 'rb-qa-field rb-qa-field-title' : 'rb-qa-field'} data-width={isTitle(prop) ? 'full' : fieldWidth(prop)}>
                  {/* Not a <label>: a click on it would re-open dropdowns and pickers. */}
                  <div className="rb-qa-label-row">{label}</div>
                  {field}
                </div>
              );
            })}
        </div>
      </div>
      <div className="rb-qa-footer">
        <span className="rb-qa-keys">
          <kbd>Enter</kbd> next field
          <span className="rb-qa-dot">·</span>
          <kbd>{mod}</kbd>
          <kbd>Enter</kbd> add
        </span>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button variant="primary" icon="plus" disabled={saving} onClick={() => void submit()}>
          {saving ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </div>
  );
}

/** Short values share a row; lists, links, images and free text take the full width. */
function fieldWidth(prop: PropertyConfig): 'half' | 'full' {
  return prop.type === 'select' || prop.type === 'number' || prop.type === 'date' || prop.type === 'checkbox' ? 'half' : 'full';
}
