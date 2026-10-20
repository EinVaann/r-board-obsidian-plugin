/**
 * A `.factory` file in its tab: **Planner** (one tab per saved plan: graph +
 * request) and **Data** (Recipes, Items and Transport). Everything edits the
 * one file through `onChange`.
 */

import { useMemo, useState } from 'react';
import { Menu, type App } from 'obsidian';
import { ReactModal, useApp } from '../react/mount';
import { DATA_TABS, itemList, typeNames, type DataTab } from './book';
import { DataEditor, missingTransport } from './DataEditor';
import { Planner } from './Planner';
import { addPlan, applyView, deletePlan, docView, duplicatePlan, renamePlan, type FactoryDoc } from './plan';

type Top = 'planner' | 'data';

export function FactoryWorkspace({ doc, onChange }: { doc: FactoryDoc; onChange: (d: FactoryDoc) => void }) {
  const app = useApp();
  // A file with no recipes opens on its data.
  const [top, setTop] = useState<Top>(() => (doc.data.recipes.length ? 'planner' : 'data'));
  const [tab, setTab] = useState<DataTab>('recipes');
  const view = useMemo(() => docView(doc), [doc]);
  const counts: Record<DataTab, number> = { recipes: doc.data.recipes.length, items: itemList(doc.data).length, transport: typeNames(doc.data).length };
  const missing = doc.data.transport.length ? missingTransport(doc.data) : 0;

  const planMenu = (i: number, evt: MouseEvent): void => {
    const p = doc.plans[i];
    const menu = new Menu();
    menu.addItem((it) => it.setTitle('Rename…').setIcon('pencil').onClick(() => promptName(app, p.name, (name) => onChange(renamePlan(doc, i, name)))));
    menu.addItem((it) => it.setTitle('Duplicate').setIcon('copy').onClick(() => onChange(duplicatePlan(doc, i))));
    menu.addSeparator();
    menu.addItem((it) =>
      it
        .setTitle(doc.plans.length > 1 ? 'Delete plan' : 'Clear plan')
        .setIcon('trash')
        .setWarning(true)
        .onClick(() => confirmDelete(app, p.name, doc.plans.length > 1, () => onChange(deletePlan(doc, i)))),
    );
    menu.showAtMouseEvent(evt);
  };

  return (
    <div className="rb-fx">
      <div className="rb-fx-top" role="tablist">
        {(['planner', 'data'] as Top[]).map((t) => (
          <button key={t} role="tab" aria-selected={top === t} className={top === t ? 'rb-fx-toptab is-active' : 'rb-fx-toptab'} onClick={() => setTop(t)}>
            {t === 'planner' ? 'Planner' : 'Data'}
          </button>
        ))}
        {top === 'planner' && (
          <div className="rb-fx-sub" role="tablist">
            {doc.plans.map((p, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={doc.active === i}
                className={doc.active === i ? 'rb-fx-subtab is-active' : 'rb-fx-subtab'}
                title="Right-click: rename, duplicate, delete"
                onClick={(e) => (doc.active === i ? planMenu(i, e.nativeEvent) : onChange({ ...doc, active: i }))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  planMenu(i, e.nativeEvent);
                }}
              >
                {p.name}
                {doc.active === i && <span className="rb-fx-caret">▾</span>}
              </button>
            ))}
            <button className="rb-fx-subtab rb-fx-add" title="New plan" aria-label="New plan" onClick={() => onChange(addPlan(doc))}>
              +
            </button>
          </div>
        )}
        {top === 'data' && (
          <div className="rb-fx-sub" role="tablist">
            {DATA_TABS.map(({ key, label }) => (
              <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'rb-fx-subtab is-active' : 'rb-fx-subtab'} onClick={() => setTab(key)}>
                {label}
                <span className="rb-pl-count">{counts[key]}</span>
                {key === 'items' && missing > 0 && (
                  <span className="rb-pl-count rb-dx-badge" title={`${missing} without transport`}>
                    ⚠ {missing}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="rb-fx-body">
        {top === 'planner' ? (
          <Planner key={doc.active} file={view} onChange={(f) => onChange(applyView(doc, f))} openData={() => setTop('data')} />
        ) : (
          <DataEditor tab={tab} data={doc.data} onChange={(data) => onChange({ ...doc, data })} />
        )}
      </div>
    </div>
  );
}

function promptName(app: App, current: string, done: (name: string) => void): void {
  new ReactModal(
    app,
    (modal) => {
      const submit = (v: string): void => {
        if (v.trim()) done(v.trim());
        modal.close();
      };
      return (
        <form
          className="rb-fx-dialog"
          onSubmit={(e) => {
            e.preventDefault();
            submit((e.currentTarget.elements.namedItem('name') as HTMLInputElement).value);
          }}
        >
          <input name="name" type="text" defaultValue={current} autoFocus onFocus={(e) => e.currentTarget.select()} />
          <div className="rb-fx-dialog-buttons">
            <button type="button" onClick={() => modal.close()}>
              Cancel
            </button>
            <button type="submit" className="mod-cta">
              Rename
            </button>
          </div>
        </form>
      );
    },
    { title: 'Rename plan' },
  ).open();
}

function confirmDelete(app: App, name: string, deleting: boolean, done: () => void): void {
  new ReactModal(
    app,
    (modal) => (
      <div className="rb-fx-dialog">
        <p>{deleting ? `Delete the plan "${name}"? The data tables are kept.` : `"${name}" is the only plan: clear its outputs, inputs and recipe picks?`}</p>
        <div className="rb-fx-dialog-buttons">
          <button onClick={() => modal.close()}>Cancel</button>
          <button
            className="mod-warning"
            onClick={() => {
              done();
              modal.close();
            }}
          >
            {deleting ? 'Delete' : 'Clear'}
          </button>
        </div>
      </div>
    ),
    { title: deleting ? 'Delete plan' : 'Clear plan' },
  ).open();
}
