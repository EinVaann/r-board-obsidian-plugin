import { useBoard } from '../board/context';
import { PropertyEditor } from './PropertyEditor';
import { SettingRow, SettingsTabs, TextInput } from './controls';

/** Board settings modal content: General (name, tag, folder) and Properties. */
export function BoardSettings() {
  const config = useBoard((s) => s.config);
  const updateConfig = useBoard((s) => s.updateConfig);
  const bumpVault = useBoard((s) => s.bumpVault);
  if (!config) return null;

  const general = (
    <>
      <SettingRow name="Name">
        <TextInput value={config.name ?? ''} onChange={(v) => updateConfig((c) => void (c.name = v.trim() || undefined))} />
      </SettingRow>
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
  );

  const properties = (
    <PropertyEditor properties={config.properties} onChange={(next) => updateConfig((c) => void (c.properties = next))} />
  );

  return (
    <SettingsTabs
      tabs={[
        { id: 'general', label: 'General', icon: 'settings', content: general },
        { id: 'properties', label: 'Properties', icon: 'list', content: properties },
      ]}
    />
  );
}
