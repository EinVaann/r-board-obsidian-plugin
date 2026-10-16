import { useBoard } from '../board/context';
import { propertyLabel } from '../config';
import { PropertyEditor } from './PropertyEditor';
import { Select, SettingRow, SettingsTabs, TextInput } from './controls';

/** Board settings modal content: General (name, tag, folder — or a table's title column) and Properties. */
export function BoardSettings() {
  const config = useBoard((s) => s.config);
  const updateConfig = useBoard((s) => s.updateConfig);
  const bumpVault = useBoard((s) => s.bumpVault);
  if (!config) return null;
  const table = config.kind === 'table';

  const general = (
    <>
      <SettingRow name="Name">
        <TextInput value={config.name ?? ''} onChange={(v) => updateConfig((c) => void (c.name = v.trim() || undefined))} />
      </SettingRow>
      {table ? (
        <SettingRow name="Title column" desc="Shown as each row's title on cards and first in the table.">
          <Select
            value={config.titleProperty ?? ''}
            options={config.properties
              .filter((p) => p.type === 'text' || p.type === 'formula' || p.type === 'url')
              .map((p) => ({ value: p.name, label: propertyLabel(p) }))}
            onChange={(v) => updateConfig((c) => void (c.titleProperty = v))}
          />
        </SettingRow>
      ) : (
        <>
          <SettingRow name="Base tag" desc="Notes carrying this tag become the board's items. Without the leading #.">
            <TextInput
              value={config.sourceTag}
              onChange={(v) => updateConfig((c) => void (c.sourceTag = v.replace(/^#/, '').trim().toLowerCase()))}
            />
          </SettingRow>
          <SettingRow name="New note location" desc='Folder where the "New note" button creates notes. Required for that button.'>
            <TextInput
              value={config.newNoteFolder ?? ''}
              placeholder="e.g. Games/Backlog"
              onChange={(v) => updateConfig((c) => void (c.newNoteFolder = v.trim() || undefined))}
            />
          </SettingRow>
          <SettingRow name="Refresh index" desc="Re-query notes from the vault.">
            <button onClick={bumpVault}>Refresh</button>
          </SettingRow>
        </>
      )}
    </>
  );

  const properties = (
    <PropertyEditor
      table={table}
      properties={config.properties}
      onChange={(next) =>
        updateConfig((c) => {
          c.properties = next;
          // A table always has a title column.
          if (table && !next.some((p) => p.name === c.titleProperty)) c.titleProperty = next[0]?.name;
        })
      }
    />
  );

  return (
    <SettingsTabs
      tabs={[
        { id: 'general', label: 'General', icon: 'settings', content: general },
        { id: 'properties', label: table ? 'Columns' : 'Properties', icon: 'list', content: properties },
      ]}
    />
  );
}
