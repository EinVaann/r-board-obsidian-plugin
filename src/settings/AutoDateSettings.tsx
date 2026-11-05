import { useBoard } from '../board/context';
import { propertyLabel } from '../config';
import type { AutoDateRule, PropertyConfig } from '../types';
import { optionFor } from '../render/values';
import { Icon } from '../react/Icon';
import { Select, SettingRow, Toggle } from './controls';

/** Board settings → Dates: "when <property> becomes <values>, set <date> to today". */
export function AutoDateSettings() {
  const config = useBoard((s) => s.config);
  const updateConfig = useBoard((s) => s.updateConfig);
  if (!config) return null;
  const rules = config.autoDates ?? [];
  const triggers = config.properties.filter((p) => p.type === 'select' || p.type === 'multi' || p.type === 'text');
  const dates = config.properties.filter((p) => p.type === 'date');

  const edit = (index: number, recipe: (r: AutoDateRule) => void): void =>
    updateConfig((c) => {
      const r = c.autoDates?.[index];
      if (r) recipe(r);
    });
  const add = (): void =>
    updateConfig((c) => {
      const property = triggers[0]?.name ?? '';
      c.autoDates = [...(c.autoDates ?? []), { property, values: [], date: dates[0]?.name ?? '' }];
    });
  const remove = (index: number): void =>
    updateConfig((c) => {
      c.autoDates?.splice(index, 1);
      if (!c.autoDates?.length) delete c.autoDates;
    });

  return (
    <>
      <div className="setting-item setting-item-heading">
        <div className="setting-item-info">
          <div className="setting-item-name">Fill dates automatically</div>
          <div className="setting-item-description">
            When a note's property changes to one of the chosen values, an empty date property is set to today — from
            the board, a table, or the note itself. Dates already filled are never changed.
          </div>
        </div>
      </div>
      {dates.length === 0 && <div className="rb-empty">Add a date property first.</div>}
      {dates.length > 0 &&
        rules.map((rule, i) => (
          <AutoDateRow
            key={i}
            rule={rule}
            triggers={triggers}
            dates={dates}
            onChange={(recipe) => edit(i, recipe)}
            onRemove={() => remove(i)}
          />
        ))}
      {dates.length > 0 && triggers.length > 0 && (
        <SettingRow>
          <button onClick={add}>
            <Icon name="plus" /> Add rule
          </button>
        </SettingRow>
      )}
    </>
  );
}

function AutoDateRow({
  rule,
  triggers,
  dates,
  onChange,
  onRemove,
}: {
  rule: AutoDateRule;
  triggers: PropertyConfig[];
  dates: PropertyConfig[];
  onChange: (recipe: (r: AutoDateRule) => void) => void;
  onRemove: () => void;
}) {
  const prop = triggers.find((p) => p.name === rule.property);
  const options = prop?.options ?? [];
  const chosen = new Set(rule.values);
  const toggleValue = (value: string, on: boolean): void =>
    onChange((r) => {
      const set = new Set(r.values);
      if (on) set.add(value);
      else set.delete(value);
      r.values = options.map((o) => o.value).filter((v) => set.has(v)).concat([...set].filter((v) => !options.some((o) => o.value === v)));
    });

  return (
    <div className="rb-auto-date">
      <SettingRow name="When">
        <Select
          value={rule.property}
          options={triggers.map((p) => ({ value: p.name, label: propertyLabel(p) }))}
          onChange={(v) => onChange((r) => ((r.property = v), (r.values = [])))}
        />
        <button className="clickable-icon" aria-label="Remove rule" onClick={onRemove}>
          <Icon name="trash-2" />
        </button>
      </SettingRow>
      <SettingRow name="becomes" desc={options.length ? undefined : 'This property has no listed values.'}>
        <div className="rb-auto-date-values">
          {options.map((o) => {
            const on = chosen.has(o.value);
            return (
              <button
                key={o.value}
                className={on ? 'rb-auto-date-value is-on' : 'rb-auto-date-value'}
                aria-pressed={on}
                onClick={() => toggleValue(o.value, !on)}
              >
                {prop ? optionFor(prop, o.value).label : o.value}
              </button>
            );
          })}
        </div>
      </SettingRow>
      <SettingRow name="set">
        <Select value={rule.date} options={dates.map((p) => ({ value: p.name, label: propertyLabel(p) }))} onChange={(v) => onChange((r) => void (r.date = v))} />
      </SettingRow>
      <SettingRow name="Include time of day" toggle>
        <Toggle checked={!!rule.includeTime} onChange={(on) => onChange((r) => void (on ? (r.includeTime = true) : delete r.includeTime))} label="Include time of day" />
      </SettingRow>
    </div>
  );
}
