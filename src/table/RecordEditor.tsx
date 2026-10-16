import type { App } from 'obsidian';
import { BoardContext, useBoard, useBoardContext, type BoardContextValue } from '../board/context';
import { propertyLabel } from '../config';
import { ReactModal } from '../react/mount';
import { Icon } from '../react/Icon';
import { PROPERTY_TYPE_ICON } from '../settings/PropertyEditor';
import { ValueEditor } from '../components/ValueEditor';
import { FormulaEvaluator } from '../data/compute';
import { fieldNode } from '../components/fields';
import { useFieldEnv } from '../components/Card';
import { rowToItem } from './rows';

/** Open the editor for one table row. */
export function openRecordEditor(app: App, ctx: BoardContextValue, rowId: string, actions: { remove: () => void; duplicate: () => void }): void {
  new ReactModal(
    app,
    (modal) => (
      <BoardContext.Provider value={ctx}>
        <RecordEditor
          rowId={rowId}
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
    { title: 'Edit row', cls: 'rb-settings-modal rb-record-modal' },
  ).open();
}

/** Every property of a row as an editable form; edits save as you go. */
function RecordEditor({ rowId, onRemove, onDuplicate }: { rowId: string; onRemove: () => void; onDuplicate: () => void }) {
  const { actions } = useBoardContext();
  const env = useFieldEnv();
  const config = useBoard((s) => s.config);
  const row = useBoard((s) => s.rows.find((r) => r.id === rowId));
  if (!config) return null;
  if (!row) return <div className="rb-empty">This row was deleted.</div>;

  const item = rowToItem(row, config.titleProperty);
  const computed = new FormulaEvaluator(config.properties).apply(item);
  // The title property first, then the rest in their order.
  const props = [...config.properties].sort((a, b) => Number(b.name === config.titleProperty) - Number(a.name === config.titleProperty));

  return (
    <div className="rb-wizard rb-record">
      {props.map((prop) => (
        <div key={prop.name} className="setting-item rb-record-row">
          <div className="setting-item-info">
            <div className="setting-item-name">
              <Icon name={PROPERTY_TYPE_ICON[prop.type]} className="rb-record-icon" />
              {propertyLabel(prop)}
            </div>
            {prop.type === 'formula' && <div className="setting-item-description rb-record-result">= {fieldNode(env, computed, prop) ?? '—'}</div>}
          </div>
          <div className="setting-item-control">
            <ValueEditor
              prop={prop}
              raw={row.cells[prop.name]}
              autoFocus={prop.name === config.titleProperty && !item.title}
              onCommit={(value) => void actions.setValue(item, prop, value).catch(() => undefined)}
            />
          </div>
        </div>
      ))}
      <div className="rb-record-actions">
        <button onClick={onDuplicate}>
          <Icon name="copy" /> Duplicate
        </button>
        <button className="mod-warning" onClick={onRemove}>
          <Icon name="trash-2" /> Delete row
        </button>
      </div>
    </div>
  );
}
