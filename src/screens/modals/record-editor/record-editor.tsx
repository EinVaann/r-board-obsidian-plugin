import { useMemo, useState } from 'react';
import { Notice, type App } from 'obsidian';
import { BoardContext, useBoard, useBoardContext, type BoardContextValue } from '../../../stores/board-context';
import { ReactModal } from '../../../obsidian/mount';
import { TextButton } from '@/components/form-controls';
import { FormulaEvaluator } from '../../../lib/data/compute';
import { fieldNode } from '../../../components/fields';
import { useFieldEnv } from '../../../components/card';
import { rowToItem } from '../../../lib/table/rows';
import { asArray, linkTo } from '../../../lib/render/values';
import { toStored, type StoredValue } from '../../../lib/data/properties';
import { saveImageDraft, type ImageDraft } from '../../../lib/data/image-import';
import { addOptions } from '../../../lib/quick-add/options';
import type { PropertyConfig } from '../../../types/database';
import { FieldBox, FormField } from '../quick-add/_components/form-field';

/** Open the editor for one table row. */
export function openRecordEditor(app: App, ctx: BoardContextValue, rowId: string, actions: { remove: () => void; duplicate: () => void }): void {
  new ReactModal(
    app,
    (modal) => (
      <BoardContext.Provider value={ctx}>
        <RecordEditor
          app={app}
          rowId={rowId}
          onClose={() => modal.close()}
          onRemove={() => {
            modal.close();
            actions.remove();
          }}
          onDuplicate={() => {
            modal.close();
            actions.duplicate();
          }}
        />
      </BoardContext.Provider>
    ),
    // Same frame as quick add; the row's fields laid out the same way.
    { title: 'Edit row', cls: 'rb-quick-add-modal rb-record-modal' },
  ).open();
}

/** Every property of a row in the quick-add layout; each edit saves as you go. */
function RecordEditor({ app, rowId, onClose, onRemove, onDuplicate }: { app: App; rowId: string; onClose: () => void; onRemove: () => void; onDuplicate: () => void }) {
  const { actions, boardFile } = useBoardContext();
  const env = useFieldEnv();
  const config = useBoard((s) => s.config);
  const rows = useBoard((s) => s.rows);
  const updateConfig = useBoard((s) => s.updateConfig);
  const row = rows.find((r) => r.id === rowId);
  const [drafts, setDrafts] = useState<Record<string, ImageDraft | null>>({});
  // Values used elsewhere in the table, offered in select / multi dropdowns (as quick add does).
  const known = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const p of config?.properties ?? []) {
      if (p.type === 'select' || p.type === 'multi') out[p.name] = [...new Set(rows.flatMap((r) => asArray(r.cells[p.name])))].sort((a, b) => a.localeCompare(b));
    }
    return out;
  }, [config, rows]);
  if (!config) return null;
  if (!row) return <div className="rb-empty">This row was deleted.</div>;

  const item = rowToItem(row, config.titleProperty);
  const computed = new FormulaEvaluator(config.properties).apply(item);
  // The title property first, then the rest in their order.
  const props = [...config.properties].sort((a, b) => Number(b.name === config.titleProperty) - Number(a.name === config.titleProperty));

  const save = (prop: PropertyConfig, value: StoredValue): void => {
    const stored = value === null ? null : toStored(prop, value);
    // A value typed into a select / multi that isn't an option yet becomes one.
    if (prop.type === 'select' || prop.type === 'multi') {
      const fresh = asArray(stored).filter((v) => !prop.options?.some((o) => o.value === v));
      if (fresh.length) updateConfig((c) => addOptions(c, { [prop.name]: fresh }));
    }
    void actions.setValue(item, prop, stored).catch(() => undefined);
  };

  /** A dropped / pasted image is written to the vault right away; its link becomes the value. */
  const onDraft = (prop: PropertyConfig, draft: ImageDraft | null): void => {
    setDrafts((d) => ({ ...d, [prop.name]: draft }));
    if (!draft) return;
    void saveImageDraft(app, draft)
      .then((file) => {
        save(prop, linkTo(app, file, boardFile.path, false));
        setDrafts((d) => ({ ...d, [prop.name]: null }));
      })
      .catch((e: Error) => new Notice(`R Board: could not save "${draft.name}" — ${e.message}`));
  };

  return (
    <div className="rb-quick-add rb-record">
      <div className="rb-qa-body">
        <div className="rb-qa-fields">
          {props.map((prop) =>
            prop.type === 'formula' ? (
              // Computed: shown, not edited.
              <FieldBox key={prop.name} prop={prop}>
                <div className="rb-record-result">{fieldNode(env, computed, prop) ?? '—'}</div>
              </FieldBox>
            ) : (
              <FieldBox key={prop.name} prop={prop} title={prop.name === config.titleProperty}>
                <FormField
                  app={app}
                  prop={prop}
                  value={row.cells[prop.name] as StoredValue | undefined}
                  known={known[prop.name] ?? []}
                  sourcePath={boardFile.path}
                  autoFocus={prop.name === config.titleProperty && !item.title}
                  draft={drafts[prop.name] ?? null}
                  imageFolder={config.quickAdd?.imageFolders?.[prop.name]}
                  onDraft={(d) => onDraft(prop, d)}
                  onChange={(value) => save(prop, value)}
                  onEnter={() => undefined}
                />
              </FieldBox>
            ),
          )}
        </div>
      </div>
      <div className="rb-qa-footer">
        <TextButton variant="danger" icon="trash-2" onClick={onRemove}>
          Delete row
        </TextButton>
        <TextButton icon="copy" onClick={onDuplicate}>
          Duplicate
        </TextButton>
        <span className="rb:flex-1" />
        <TextButton variant="primary" onClick={onClose}>
          Done
        </TextButton>
      </div>
    </div>
  );
}
