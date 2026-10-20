import { useEffect, useRef, useState } from 'react';
import type { App } from 'obsidian';
import { useBoard, useBoardContext } from '../board/context';
import { propertyLabel } from '../config';
import { newId } from '../table/format';
import { Icon } from '../react/Icon';
import { PROPERTY_TYPE_ICON } from './PropertyEditor';
import { SettingRow, Toggle } from './controls';
import { quickAddCommandId } from '../quickadd/ids';
import { canSetHotkeys, hotkeyConflicts, openHotkeySettings, printHotkey, recordHotkey, setHotkey } from '../quickadd/hotkeys';

/** Board settings → Quick add: the command, the fields its form asks for, and its hotkey. */
export function QuickAddSettings() {
  const { app, boardFile } = useBoardContext();
  const config = useBoard((s) => s.config);
  const updateConfig = useBoard((s) => s.updateConfig);
  if (!config) return null;
  const q = config.quickAdd;
  const table = config.kind === 'table';
  const name = `Quick add to ${config.name?.trim() || boardFile?.basename || 'this board'}`;

  const enable = (on: boolean): void => {
    if (!on && q) void setHotkey(app, quickAddCommandId(q.id), null);
    updateConfig((c) => {
      if (on) c.quickAdd = { id: newId('q'), properties: [] };
      else delete c.quickAdd;
    });
  };

  // Fields keep the database's property order.
  const candidates = config.properties.filter((p) => p.type !== 'formula' && p.name !== config.titleProperty);
  const toggleField = (field: string, on: boolean): void =>
    updateConfig((c) => {
      if (!c.quickAdd) return;
      const chosen = new Set(c.quickAdd.properties);
      if (on) chosen.add(field);
      else chosen.delete(field);
      c.quickAdd.properties = c.properties.map((p) => p.name).filter((n) => chosen.has(n));
    });

  return (
    <>
      <SettingRow
        name="Quick add"
        desc={
          <>
            Adds the command <b>R Board: {name}</b>. Run it from the command palette or its shortcut, from anywhere: a
            small form asks for the {table ? 'row' : 'note'} and adds it without opening the {table ? 'table' : 'board'}.
          </>
        }
        toggle
      >
        <Toggle checked={!!q} onChange={enable} label="Quick add" />
      </SettingRow>
      {q && (
        <>
          {!table && !config.newNoteFolder && (
            <div className="rb-quick-add-warning">
              <Icon name="alert-triangle" /> Set a <b>New note location</b> on the General tab: quick add creates notes there.
            </div>
          )}
          <ShortcutRow app={app} commandId={quickAddCommandId(q.id)} commandName={name} />
          {!table && (
            <SettingRow name="Open the note after adding" desc="Off: the note is created in the background." toggle>
              <Toggle
                checked={!!q.openNote}
                onChange={(on) => updateConfig((c) => void (c.quickAdd && (c.quickAdd.openNote = on || undefined)))}
                label="Open the note after adding"
              />
            </SettingRow>
          )}
          <div className="setting-item setting-item-heading">
            <div className="setting-item-info">
              <div className="setting-item-name">Fields to ask for</div>
              <div className="setting-item-description">
                The {table ? 'title column' : 'title'} is always asked first. Formulas are computed, so they aren't listed.
              </div>
            </div>
          </div>
          {candidates.length === 0 && <div className="rb-empty">No other {table ? 'columns' : 'properties'} yet.</div>}
          {candidates.map((p) => (
            <SettingRow
              key={p.name}
              name={
                <>
                  <Icon name={PROPERTY_TYPE_ICON[p.type]} className="rb-record-icon" /> {propertyLabel(p)}
                </>
              }
              toggle
            >
              <Toggle checked={q.properties.includes(p.name)} onChange={(on) => toggleField(p.name, on)} label={propertyLabel(p)} />
            </SettingRow>
          ))}
        </>
      )}
    </>
  );
}

/** The command's shortcut: press keys to set it here, or set it in Obsidian's Hotkeys settings. */
function ShortcutRow({ app, commandId, commandName }: { app: App; commandId: string; commandName: string }) {
  const [recording, setRecording] = useState(false);
  const [, refresh] = useState(0);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const direct = canSetHotkeys(app);
  const current = printHotkey(app, commandId);
  const conflicts = current && !recording ? hotkeyConflicts(app, commandId) : [];

  const record = (): void => {
    setRecording(true);
    stop.current = recordHotkey(app, (key) => {
      stop.current = null;
      setRecording(false);
      if (key) void setHotkey(app, commandId, key).then(() => refresh((n) => n + 1));
    });
  };

  return (
    <>
      <SettingRow
        name="Shortcut"
        desc={recording ? 'Press the keys… (Esc to cancel)' : direct ? 'Click the shortcut, then press the keys.' : 'Set it in Obsidian’s Hotkeys settings.'}
      >
        {direct && (
          <button className={recording ? 'rb-hotkey mod-cta' : 'rb-hotkey'} onClick={recording ? undefined : record}>
            {recording ? 'Press keys…' : current || 'Set shortcut'}
          </button>
        )}
        {direct && current && !recording && (
          <button
            className="clickable-icon"
            aria-label="Remove shortcut"
            onClick={() => void setHotkey(app, commandId, null).then(() => refresh((n) => n + 1))}
          >
            <Icon name="x" />
          </button>
        )}
        {!recording && (
          <button className="clickable-icon" aria-label="Open Hotkeys settings" onClick={() => openHotkeySettings(app, commandName)}>
            <Icon name="keyboard" />
          </button>
        )}
      </SettingRow>
      {conflicts.length > 0 && (
        <div className="rb-quick-add-warning">
          <Icon name="alert-triangle" />
          <span>
            <b>{current}</b> is also used by{' '}
            {conflicts.map((n, i) => (
              <span key={n}>
                {i > 0 && ', '}
                <b>{n}</b>
              </span>
            ))}
            . A shortcut runs only one command, so one of them won't work: pick another, or change the other in Hotkeys.
          </span>
        </div>
      )}
    </>
  );
}
