import { useBoard } from '../board/context';
import { propertyLabel } from '../config';
import type { AutoDateRule, PropertyConfig } from '../types';
import { optionFor } from '../render/values';
import { Button, IconButton, MultiSelect, Select, SimpleCard as SettingsCard, Switch as Toggle } from '../ui';

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
      <SettingsCard
        icon="calendar-check"
        title="Fill dates automatically"
        desc="When a note's property changes to one of the chosen values, an empty date property is set to today — from the board, a table, or the note itself. Dates already filled are never changed."
      >
        {dates.length === 0 && <div className="rb-empty">Add a date property first.</div>}
        {dates.length > 0 && rules.length === 0 && <div className="rb-empty">No rules yet.</div>}
        {dates.length > 0 && rules.length > 0 && (
          <div className="rb-auto-date-list">
            {rules.map((rule, i) => (
              <AutoDateRow key={i} rule={rule} triggers={triggers} dates={dates} onChange={(recipe) => edit(i, recipe)} onRemove={() => remove(i)} />
            ))}
          </div>
        )}
      </SettingsCard>
      {dates.length > 0 && triggers.length > 0 && (
        <div className="rb-settings-danger">
          <Button icon="plus" onClick={add}>
            Add rule
          </Button>
        </div>
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

  return (
    <div className="rb-auto-date">
      <div className="rb-auto-date-line">
        <span className="rb-auto-date-join">When</span>
        <Select
          size="sm"
          value={rule.property}
          options={triggers.map((p) => ({ value: p.name, label: propertyLabel(p) }))}
          onChange={(v) => onChange((r) => ((r.property = v), (r.values = [])))}
        />
        <span className="rb-auto-date-join">becomes</span>
        {options.length === 0 ? (
          <span className="rb-auto-date-none">This property has no listed values.</span>
        ) : (
          <MultiSelect
            size="sm"
            label="Values"
            placeholder="Pick values"
            value={rule.values}
            options={options.map((o) => ({ value: o.value, label: prop ? optionFor(prop, o.value).label : o.value, color: prop ? optionFor(prop, o.value).color : undefined }))}
            onChange={(next) => {
              const known = new Set(options.map((o) => o.value));
              onChange((r) => void (r.values = [...options.map((o) => o.value).filter((v) => next.includes(v)), ...next.filter((v) => !known.has(v))]));
            }}
          />
        )}
        <IconButton icon="trash-2" label="Remove rule" size="sm" tone="danger" onClick={onRemove} />
      </div>
      <div className="rb-auto-date-line">
        <span className="rb-auto-date-join">set</span>
        <Select size="sm" value={rule.date} options={dates.map((p) => ({ value: p.name, label: propertyLabel(p) }))} onChange={(v) => onChange((r) => void (r.date = v))} />
        <span className="rb-auto-date-join">to today</span>
        <label className="rb-auto-date-time">
          <Toggle checked={!!rule.includeTime} onChange={(on) => onChange((r) => void (on ? (r.includeTime = true) : delete r.includeTime))} label="Include time of day" />
          <span>with time</span>
        </label>
      </div>
    </div>
  );
}
