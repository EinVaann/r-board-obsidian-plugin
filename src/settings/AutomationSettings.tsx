import { useState } from 'react';
import { produce } from 'immer';
import { useBoard, useBoardContext } from '../board/context';
import { propertyLabel } from '../config';
import { newId } from '../table/format';
import type { Automation, AutomationEffect, AutomationTrigger, EffectOp, PropertyConfig, TriggerOp } from '../types';
import { optionFor } from '../render/values';
import {
  EFFECT_OPS,
  TRIGGER_OPS,
  describeChain,
  effectCanSkipFilled,
  effectLabel,
  effectNeedsValue,
  findChains,
  newChains,
  triggerLabel,
  triggerNeedsNumber,
  triggerNeedsValues,
  type Chain,
} from '../data/automations';
import { Button, IconButton, Input, MultiSelect, Segmented, Select, SimpleCard as SettingsCard, Switch as Toggle } from '../ui';
import { LinksEditor } from '../components/LinksEditor';
import { Icon } from '../react/Icon';

const nameOf = (a: Automation, i: number): string => a.name?.trim() || `Automation ${i + 1}`;

/** Board settings → Automations: when some values change, set others. */
export function AutomationSettings() {
  const config = useBoard((s) => s.config);
  const updateConfig = useBoard((s) => s.updateConfig);
  /** An edit refused because it would chain automations. */
  const [refused, setRefused] = useState<string[] | null>(null);
  if (!config) return null;
  const autos = config.automations ?? [];
  const props = config.properties;
  const triggerProps = props.filter((p) => TRIGGER_OPS[p.type].length);
  const effectProps = props.filter((p) => EFFECT_OPS[p.type].length);
  const label = (a: Automation): string => nameOf(a, autos.indexOf(autos.find((x) => x.id === a.id)!));

  /** Apply an edit unless it adds a chain; then say why and leave the automations as they were. */
  const change = (recipe: (draft: Automation[]) => void): void => {
    const next = produce(autos, recipe);
    const added = newChains(autos, next, props);
    if (added.length) {
      setRefused(added.map((c) => describeChain(c, props, (a) => nameOf(a, next.findIndex((x) => x.id === a.id)))));
      return;
    }
    setRefused(null);
    updateConfig((c) => {
      if (next.length) c.automations = next as Automation[];
      else delete c.automations;
    });
  };
  const edit = (i: number, recipe: (a: Automation) => void): void => change((d) => recipe(d[i]));

  const add = (): void =>
    change((d) => {
      const t = triggerProps[0];
      d.push({ id: newId('a', d.map((a) => a.id)), triggers: t ? [defaultTrigger(t)] : [], effects: [] });
    });

  // Chains already saved (from older files or hand edits): shown, and run only one step deep.
  const existing = findChains(autos, props);

  return (
    <>
      <SettingsCard
        icon="workflow"
        title="Automations"
        desc={
          config.kind === 'table'
            ? 'When a row’s values change in this table, set other values in the same row.'
            : 'When a note’s values change — from a board, a table or the note itself — set other values on it.'
        }
      >
        {refused && (
          <div className="rb-automation-warning" role="alert">
            <Icon name="triangle-alert" />
            <div>
              <strong>Not saved: that would chain automations.</strong>
              {refused.map((r) => (
                <div key={r}>{r}</div>
              ))}
              <div>An effect can’t set off another automation’s trigger, or its own.</div>
            </div>
          </div>
        )}
        {existing.length > 0 && <ChainWarning chains={existing} props={props} name={label} />}
        {autos.length === 0 && <div className="rb-empty">No automations yet.</div>}
        {autos.map((a, i) => (
          <AutomationCard
            key={a.id}
            auto={a}
            index={i}
            triggerProps={triggerProps}
            effectProps={effectProps}
            chained={existing.some((c) => c.from.id === a.id || c.to.id === a.id)}
            onChange={(recipe) => edit(i, recipe)}
            onRemove={() => change((d) => void d.splice(i, 1))}
          />
        ))}
      </SettingsCard>
      {triggerProps.length > 0 && (
        <div className="rb-settings-danger">
          <Button icon="plus" onClick={add}>
            Add automation
          </Button>
        </div>
      )}
    </>
  );
}

function ChainWarning({ chains, props, name }: { chains: Chain[]; props: PropertyConfig[]; name: (a: Automation) => string }) {
  const lines = [...new Set(chains.map((c) => describeChain(c, props, name)))];
  return (
    <div className="rb-automation-warning" role="status">
      <Icon name="triangle-alert" />
      <div>
        <strong>These automations chain.</strong>
        {lines.map((l) => (
          <div key={l}>{l}</div>
        ))}
        <div>Effects never set off other automations, so only the first one runs. Change a trigger or an effect to fix it.</div>
      </div>
    </div>
  );
}

function defaultTrigger(p: PropertyConfig): AutomationTrigger {
  return { property: p.name, op: TRIGGER_OPS[p.type][0] };
}

function defaultEffect(p: PropertyConfig): AutomationEffect {
  return { property: p.name, op: EFFECT_OPS[p.type][0] };
}

function AutomationCard({
  auto,
  index,
  triggerProps,
  effectProps,
  chained,
  onChange,
  onRemove,
}: {
  auto: Automation;
  index: number;
  triggerProps: PropertyConfig[];
  effectProps: PropertyConfig[];
  chained: boolean;
  onChange: (recipe: (a: Automation) => void) => void;
  onRemove: () => void;
}) {
  const match = auto.match ?? 'any';
  return (
    <div className={['rb-automation', auto.disabled && 'is-off', chained && 'is-chained'].filter(Boolean).join(' ')}>
      <div className="rb-automation-head">
        <Toggle checked={!auto.disabled} onChange={(on) => onChange((a) => void (on ? delete a.disabled : (a.disabled = true)))} label="Automation on" />
        <Input
          size="sm"
          className="rb-automation-name"
          aria-label="Automation name"
          placeholder={`Automation ${index + 1}`}
          defaultValue={auto.name ?? ''}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (auto.name ?? '')) onChange((a) => void (v ? (a.name = v) : delete a.name));
          }}
        />
        <IconButton icon="trash-2" label="Remove automation" size="sm" tone="danger" onClick={onRemove} />
      </div>

      <div className="rb-automation-section">
        <div className="rb-automation-section-head">
          <span className="rb-automation-kw">When</span>
          {auto.triggers.length > 1 && (
            <Segmented
              size="sm"
              label="Match"
              value={match}
              options={[
                { value: 'any', label: 'any' },
                { value: 'all', label: 'all' },
              ]}
              onChange={(v) => onChange((a) => void (v === 'all' ? (a.match = 'all') : delete a.match))}
            />
          )}
          {auto.triggers.length > 1 && <span className="rb-automation-hint">{match === 'all' ? 'of these hold, one just changed' : 'of these happens'}</span>}
        </div>
        {auto.triggers.map((t, i) => (
          <TriggerRow
            key={i}
            trigger={t}
            props={triggerProps}
            join={i === 0 ? null : match === 'all' ? 'and' : 'or'}
            onChange={(recipe) => onChange((a) => recipe(a.triggers[i]))}
            onReplace={(next) => onChange((a) => void (a.triggers[i] = next))}
            onRemove={() => onChange((a) => void a.triggers.splice(i, 1))}
          />
        ))}
        <button className="rb-automation-add" onClick={() => onChange((a) => void a.triggers.push(defaultTrigger(triggerProps[0])))}>
          <Icon name="plus" /> Add trigger
        </button>
      </div>

      <div className="rb-automation-section">
        <div className="rb-automation-section-head">
          <span className="rb-automation-kw">Then</span>
        </div>
        {auto.effects.length === 0 && <div className="rb-automation-hint">Add what should change.</div>}
        {auto.effects.map((e, i) => (
          <EffectRow
            key={i}
            effect={e}
            props={effectProps}
            onChange={(recipe) => onChange((a) => recipe(a.effects[i]))}
            onReplace={(next) => onChange((a) => void (a.effects[i] = next))}
            onRemove={() => onChange((a) => void a.effects.splice(i, 1))}
          />
        ))}
        {effectProps.length > 0 && (
          <button className="rb-automation-add" onClick={() => onChange((a) => void a.effects.push(defaultEffect(effectProps[0])))}>
            <Icon name="plus" /> Add effect
          </button>
        )}
      </div>
    </div>
  );
}

function TriggerRow({
  trigger: t,
  props,
  join,
  onChange,
  onReplace,
  onRemove,
}: {
  trigger: AutomationTrigger;
  props: PropertyConfig[];
  join: string | null;
  onChange: (recipe: (t: AutomationTrigger) => void) => void;
  onReplace: (t: AutomationTrigger) => void;
  onRemove: () => void;
}) {
  const prop = props.find((p) => p.name === t.property);
  return (
    <div className="rb-automation-line">
      <span className="rb-automation-join">{join ?? ''}</span>
      <Select
        size="sm"
        value={t.property}
        options={withMissing(props, t.property)}
        onChange={(name) => onReplace(defaultTrigger(props.find((p) => p.name === name)!))}
      />
      {prop && (
        <Select
          size="sm"
          value={t.op}
          options={TRIGGER_OPS[prop.type].map((op) => ({ value: op, label: triggerLabel(op, prop.type) }))}
          onChange={(op) => onReplace({ property: t.property, op: op as TriggerOp })}
        />
      )}
      {prop && triggerNeedsValues(t.op) && (
        <ValuesInput prop={prop} values={t.values ?? []} placeholder={t.op === 'gains' || t.op === 'loses' ? 'any' : undefined} onChange={(v) => onChange((x) => void (v.length ? (x.values = v) : delete x.values))} />
      )}
      {prop && triggerNeedsNumber(t.op, prop.type) && (
        <NumberBox value={t.number} onChange={(n) => onChange((x) => void (n === undefined ? delete x.number : (x.number = n)))} />
      )}
      {prop?.type === 'select' && t.op === 'becomes' && (
        <>
          <span className="rb-automation-join-inline">from</span>
          <ValuesInput prop={prop} values={t.from ?? []} placeholder="anything" onChange={(v) => onChange((x) => void (v.length ? (x.from = v) : delete x.from))} />
        </>
      )}
      <IconButton icon="x" label="Remove trigger" size="sm" onClick={onRemove} />
    </div>
  );
}

function EffectRow({
  effect: e,
  props,
  onChange,
  onReplace,
  onRemove,
}: {
  effect: AutomationEffect;
  props: PropertyConfig[];
  onChange: (recipe: (e: AutomationEffect) => void) => void;
  onReplace: (e: AutomationEffect) => void;
  onRemove: () => void;
}) {
  const prop = props.find((p) => p.name === e.property);
  return (
    <div className="rb-automation-line">
      <span className="rb-automation-join" />
      <Select
        size="sm"
        value={e.property}
        options={withMissing(props, e.property)}
        onChange={(name) => onReplace(defaultEffect(props.find((p) => p.name === name)!))}
      />
      {prop && (
        <Select
          size="sm"
          value={e.op}
          options={EFFECT_OPS[prop.type].map((op) => ({ value: op, label: effectLabel(op, prop.type) }))}
          onChange={(op) => onReplace({ property: e.property, op: op as EffectOp, onlyIfEmpty: e.onlyIfEmpty })}
        />
      )}
      {prop && effectNeedsValue(e.op) && <EffectValue prop={prop} effect={e} onChange={onChange} />}
      {e.op === 'today' && (
        <>
          <span className="rb-automation-join-inline">+</span>
          <NumberBox value={e.number ?? 0} onChange={(n) => onChange((x) => void (n ? (x.number = n) : delete x.number))} />
          <span className="rb-automation-join-inline">days</span>
          <label className="rb-automation-check">
            <Toggle checked={!!e.includeTime} onChange={(on) => onChange((x) => void (on ? (x.includeTime = true) : delete x.includeTime))} label="Include time of day" />
            <span>with time</span>
          </label>
        </>
      )}
      {e.op === 'increment' && <NumberBox value={e.number ?? 1} onChange={(n) => onChange((x) => void (n === undefined ? delete x.number : (x.number = n)))} />}
      {effectCanSkipFilled(e.op) && (
        <label className="rb-automation-check">
          <Toggle checked={!!e.onlyIfEmpty} onChange={(on) => onChange((x) => void (on ? (x.onlyIfEmpty = true) : delete x.onlyIfEmpty))} label="Only if empty" />
          <span>only if empty</span>
        </label>
      )}
      <IconButton icon="x" label="Remove effect" size="sm" onClick={onRemove} />
    </div>
  );
}

/** The value an effect writes, edited as its property's type is. */
function EffectValue({ prop, effect: e, onChange }: { prop: PropertyConfig; effect: AutomationEffect; onChange: (recipe: (e: AutomationEffect) => void) => void }) {
  const { app, boardFile } = useBoardContext();
  const setValue = (v: AutomationEffect['value'] | undefined): void =>
    onChange((x) => void (v === undefined || v === '' || (Array.isArray(v) && !v.length) ? delete x.value : (x.value = v)));
  const list = Array.isArray(e.value) ? e.value : e.value === undefined ? [] : [String(e.value)];
  switch (prop.type) {
    case 'select':
      return (
        <Select
          size="sm"
          value={typeof e.value === 'string' ? e.value : ''}
          options={[{ value: '', label: 'Pick a value' }, ...(prop.options ?? []).map((o) => ({ value: o.value, label: optionFor(prop, o.value).label }))]}
          onChange={(v) => setValue(v)}
        />
      );
    case 'multi':
      return <ValuesInput prop={prop} values={list} onChange={setValue} />;
    case 'links':
      return (
        <LinksEditor
          app={app}
          value={list}
          sourcePath={boardFile.path}
          single={e.op === 'set' && !!prop.single}
          className="rb-automation-links"
          onChange={(v) => setValue(v === null ? undefined : (v as string[]))}
        />
      );
    case 'number':
      return <NumberBox value={typeof e.value === 'number' ? e.value : undefined} onChange={setValue} />;
    case 'date':
      return <Input size="sm" type={prop.includeTime ? 'datetime-local' : 'date'} value={typeof e.value === 'string' ? e.value : ''} onChange={(ev) => setValue(ev.target.value)} />;
    case 'image':
      return <LinksEditor app={app} value={list} sourcePath={boardFile.path} image className="rb-automation-links" onChange={(v) => setValue(typeof v === 'string' ? v : undefined)} />;
    default:
      return <TextBox value={typeof e.value === 'string' ? e.value : ''} onChange={setValue} />;
  }
}

/** Values to match or set: the property's options as a checklist, else typed text. */
function ValuesInput({ prop, values, placeholder, onChange }: { prop: PropertyConfig; values: string[]; placeholder?: string; onChange: (v: string[]) => void }) {
  const { app, boardFile } = useBoardContext();
  if (prop.type === 'links') return <LinksEditor app={app} value={values} sourcePath={boardFile.path} className="rb-automation-links" onChange={(v) => onChange(v === null ? [] : (v as string[]))} />;
  const options = prop.options ?? [];
  if (options.length) {
    const known = new Set(options.map((o) => o.value));
    return (
      <MultiSelect
        size="sm"
        label="Values"
        placeholder={placeholder ?? 'Pick values'}
        value={values}
        options={[...options.map((o) => ({ value: o.value, label: optionFor(prop, o.value).label, color: optionFor(prop, o.value).color })), ...values.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v }))]}
        onChange={(next) => onChange([...options.map((o) => o.value).filter((v) => next.includes(v)), ...next.filter((v) => !known.has(v))])}
      />
    );
  }
  return (
    <TextBox
      value={values.join(', ')}
      placeholder={placeholder ?? 'Comma-separated'}
      onChange={(t) => onChange(prop.type === 'text' ? (t.trim() ? [t.trim()] : []) : t.split(',').map((s) => s.trim()).filter(Boolean))}
    />
  );
}

/** A text box that saves when it loses focus (each keystroke would re-check chains). */
function TextBox({ value, placeholder, onChange }: { value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <Input
      key={value}
      size="sm"
      className="rb-automation-text"
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(e) => e.target.value !== value && onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function NumberBox({ value, onChange }: { value: number | undefined; onChange: (n: number | undefined) => void }) {
  return (
    <Input
      key={value ?? ''}
      size="sm"
      type="number"
      className="rb-automation-number"
      defaultValue={value ?? ''}
      onBlur={(e) => {
        const t = e.target.value.trim();
        const n = t === '' ? undefined : Number(t);
        if (n !== value && (n === undefined || Number.isFinite(n))) onChange(n);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** Property options, plus a placeholder for one that no longer exists. */
function withMissing(props: PropertyConfig[], current: string) {
  const options = props.map((p) => ({ value: p.name, label: propertyLabel(p) }));
  return props.some((p) => p.name === current) ? options : [{ value: current, label: `${current} (missing)` }, ...options];
}
