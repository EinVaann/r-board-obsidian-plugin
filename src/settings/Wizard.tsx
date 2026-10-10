import { useState } from 'react';
import { Notice, type App } from 'obsidian';
import type { DatabaseConfig, PropertyConfig } from '../types';
import { normalizeTag } from '../config';
import { ReactModal } from '../react/mount';
import { PropertyEditor } from './PropertyEditor';
import { SettingRow, TextInput } from './controls';

/**
 * Guided setup for a database: name, base tag, and its properties. Used both
 * when creating a new `.board` file and when opening an empty/uninitialized
 * one. Views are added later from the board toolbar.
 */
function Wizard({ seed, onComplete, onCancel }: { seed: Partial<DatabaseConfig>; onComplete: (config: DatabaseConfig) => void; onCancel: () => void }) {
  const [name, setName] = useState(seed.name ?? '');
  const [sourceTag, setSourceTag] = useState(seed.sourceTag ?? '');
  const [properties, setProperties] = useState<PropertyConfig[]>(seed.properties ?? []);

  const submit = (): void => {
    const tag = normalizeTag(sourceTag);
    if (!tag) {
      new Notice('R Board: a base tag is required.');
      return;
    }
    onComplete({
      name: name.trim() || undefined,
      sourceTag: tag,
      properties: properties.filter((p) => p.name.trim() !== ''),
      views: [],
    });
  };

  return (
    <div className="rb-wizard">
      <SettingRow name="Name" desc="Shown in the board title.">
        <TextInput value={name} onChange={setName} />
      </SettingRow>
      <SettingRow name="Base tag" desc="Notes carrying this tag become rows (without the leading #).">
        <TextInput value={sourceTag} placeholder="backlog" onChange={setSourceTag} />
      </SettingRow>
      <h4>Properties</h4>
      <p className="rb-wizard-hint">Frontmatter keys to show on cards and in tables.</p>
      <PropertyEditor properties={properties} onChange={setProperties} />
      <div className="rb-wizard-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="mod-cta" onClick={submit}>
          Create
        </button>
      </div>
    </div>
  );
}

export function openWizard(app: App, seed: Partial<DatabaseConfig>, heading: string, onComplete: (config: DatabaseConfig) => void): void {
  new ReactModal(
    app,
    (modal) => (
      <Wizard
        seed={seed}
        onCancel={() => modal.close()}
        onComplete={(config) => {
          modal.close();
          onComplete(config);
        }}
      />
    ),
    { title: heading, cls: 'rb-wizard-modal' },
  ).open();
}
