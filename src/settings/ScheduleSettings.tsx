import { useMemo, useState, type ReactNode } from 'react';
import type { DatabaseConfig, PropertyConfig, ScheduleConfig, ScheduleSection, SectionCondition, SectionKind, ViewConfig } from '../types';
import { propertyLabel } from '../config';
import { useBoardContext } from '../board/context';
import { optionFor } from '../render/values';
import { Icon } from '../react/Icon';
import { defaultScheduleConfig, guessLogColumns, guessSchedule } from '../schedule/config';
import { conditionProperties, defaultSections, kindName, sectionProblems } from '../schedule/sections';
import { DEFAULT_PENALTIES, DEFAULT_SETTINGS } from '../schedule/types';
import { useLinkedTable } from '../schedule/useLinkedTable';
import { Segmented, Select, type Option } from './controls';

const KINDS: { value: SectionKind; hint: string }[] = [
  { value: 'lanes', hint: 'running now, in a lane' },
  { value: 'queue', hint: 'waiting, fills the lanes' },
  { value: 'live', hint: 'running outside the lanes; counts as live time' },
  { value: 'side', hint: 'running outside the lanes; counts as other time' },
  { value: 'finished', hint: 'ended; teaches how far estimates overrun' },
  { value: 'dropped', hint: 'ended without finishing' },
  { value: 'hidden', hint: 'out of the plan (e.g. on hold)' },
];

/** View settings → Schedule: grouped cards for the log, properties, statuses, pace and variety. */
export function ScheduleSettings({ config, view, edit }: { config: DatabaseConfig; view: ViewConfig; edit: (recipe: (d: ViewConfig) => void) => void }) {
  const { app } = useBoardContext();
  const raw = view.schedule ?? defaultScheduleConfig();
  const sc = useMemo(() => guessSchedule(config, raw), [config, raw]);
  const set = (patch: Partial<ScheduleConfig>): void => edit((d) => void (d.schedule = { ...(d.schedule ?? defaultScheduleConfig()), ...patch }));
  const log = useLinkedTable(app, sc.log);
  const logProps = log.status === 'ok' ? log.table.config.properties : [];
  const cols = guessLogColumns(logProps, sc);
  const tables = app.vault.getFiles().filter((f) => f.extension === 'table').map((f) => f.path).sort();

  const props = config.properties;
  const of = (types: PropertyConfig['type'][]): Option<string>[] => [
    { value: '', label: 'None' },
    ...props.filter((p) => types.includes(p.type)).map((p) => ({ value: p.name, label: propertyLabel(p) })),
  ];
  const logOf = (types: PropertyConfig['type'][], none = false): Option<string>[] => [
    ...(none ? [{ value: '', label: 'None' }] : []),
    ...logProps.filter((p) => types.includes(p.type)).map((p) => ({ value: p.name, label: propertyLabel(p) })),
  ];

  return (
    <div className="rb-sched-settings">
      <Card icon="table" title="Session log" desc="One row per play session. Only logged hours move the forecast.">
        <Field label="Log table">
          <Select value={sc.log ?? ''} options={[{ value: '', label: 'None' }, ...tables.map((t) => ({ value: t, label: t }))]} onChange={(v) => set({ log: v || undefined })} />
        </Field>
        {log.status === 'error' && <div className="rb-sched-error">{log.error}</div>}
        {log.status === 'ok' && (
          <div className="rb-sched-grid">
            <Field label="Game">
              <Select value={cols.logItem} options={logOf(['links', 'text'])} onChange={(v) => set({ logItem: v })} />
            </Field>
            <Field label="Hours">
              <Select value={cols.logHours} options={logOf(['number', 'formula'])} onChange={(v) => set({ logHours: v })} />
            </Field>
            <Field label="Date">
              <Select value={cols.logDate} options={logOf(['date', 'text'])} onChange={(v) => set({ logDate: v })} />
            </Field>
            <Field label="Type" hint="optional">
              <Select value={cols.logType ?? ''} options={logOf(['select', 'text'], true)} onChange={(v) => set({ logType: v || undefined })} />
            </Field>
          </div>
        )}
      </Card>

      <Card icon="list" title="Properties" desc="Which properties of the notes the schedule reads. Guessed from their names.">
        <div className="rb-sched-grid">
          <Field label="Estimated hours">
            <Select value={sc.duration ?? ''} options={of(['number', 'formula'])} onChange={(v) => set({ duration: v || undefined })} />
          </Field>
          <Field label="Score" hint="higher goes first">
            <Select value={sc.score ?? ''} options={of(['number', 'formula'])} onChange={(v) => set({ score: v || undefined })} />
          </Field>
          <Field label="Vary by" hint="e.g. genre">
            <Select value={sc.vary ?? ''} options={of(['multi', 'select', 'text'])} onChange={(v) => set({ vary: v || undefined })} />
          </Field>
          <Field label="Start date">
            <Select value={sc.startDate ?? ''} options={of(['date'])} onChange={(v) => set({ startDate: v || undefined })} />
          </Field>
          <Field label="End date">
            <Select value={sc.endDate ?? ''} options={of(['date'])} onChange={(v) => set({ endDate: v || undefined })} />
          </Field>
        </div>
      </Card>

      <SectionsCard config={config} sections={sc.sections ?? []} saved={!!raw.sections} onChange={(sections) => set({ sections })} onReset={() => set({ sections: defaultSections(config, raw) })} />

      <Card icon="gauge" title="Pace" desc="Starting guesses, replaced by your log: a quarter per full week, completely after 4.">
        <div className="rb-sched-grid">
          <Field label="Lanes" hint="side by side">
            <NumberInput label="Lanes" value={sc.lanes} min={1} max={6} step={1} onChange={(lanes) => set({ lanes: Math.round(lanes) })} />
          </Field>
          <Field label="Week starts">
            <Segmented<'mon' | 'sun'>
              value={sc.weekStart}
              options={[
                { value: 'mon', label: 'Mon' },
                { value: 'sun', label: 'Sun' },
              ]}
              onChange={(weekStart) => set({ weekStart })}
            />
          </Field>
          <Field label="Hours per week" hint="all play time">
            <NumberInput label="Hours per week" value={sc.estimates.weekly} unit="h" min={0} onChange={(weekly) => set({ estimates: { ...sc.estimates, weekly } })} />
          </Field>
          <Field label="Unlogged live" hint="dailies, always counted">
            <NumberInput label="Unlogged live hours per week" value={sc.estimates.live} unit="h/wk" min={0} onChange={(live) => set({ estimates: { ...sc.estimates, live } })} />
          </Field>
          <Field label="Long over" hint="one long game at a time">
            <NumberInput label="Long over" value={sc.longOver} unit="h" min={0} onChange={(longOver) => set({ longOver })} />
          </Field>
          <Field label="Average over">
            <NumberInput label="Average over" value={sc.paceWeeks} unit="weeks" min={1} max={52} step={1} onChange={(paceWeeks) => set({ paceWeeks: Math.round(paceWeeks) })} />
          </Field>
        </div>
      </Card>

      <Card icon="shuffle" title="Variety" desc="Taken off a game's score when picking what's next. Nothing is ever blocked.">
        <div className="rb-sched-grid">
          <Field label="Like the other lane">
            <NumberInput label="Like the other lane" value={sc.penalties.running} unit="pts" min={0} onChange={(running) => set({ penalties: { ...sc.penalties, running } })} />
          </Field>
          <Field label="Like the one before">
            <NumberInput label="Like the one before" value={sc.penalties.previous} unit="pts" min={0} onChange={(previous) => set({ penalties: { ...sc.penalties, previous } })} />
          </Field>
          <Field label="Second long game">
            <NumberInput label="Second long game" value={sc.penalties.long} unit="pts" min={0} onChange={(long) => set({ penalties: { ...sc.penalties, long } })} />
          </Field>
          <Field label="Similar counts">
            <NumberInput
              label="Similar counts"
              value={Math.round(sc.penalties.similarFactor * 100)}
              unit="%"
              min={0}
              max={100}
              step={5}
              onChange={(pct) => set({ penalties: { ...sc.penalties, similarFactor: pct / 100 } })}
            />
          </Field>
        </div>
        <SimilarGroups groups={sc.similar} onChange={(similar) => set({ similar })} />
        <button
          className="rb-sched-reset"
          onClick={() =>
            set({
              penalties: { ...DEFAULT_PENALTIES },
              lanes: DEFAULT_SETTINGS.lanes,
              longOver: DEFAULT_SETTINGS.longOver,
              paceWeeks: DEFAULT_SETTINGS.paceWeeks,
              estimates: { ...DEFAULT_SETTINGS.estimates },
            })
          }
        >
          <Icon name="rotate-ccw" /> Reset pace and variety to defaults
        </button>
      </Card>
    </div>
  );
}

function Card({ icon, title, desc, children }: { icon: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="rb-sched-card">
      <header>
        <Icon name={icon} />
        <div>
          <h4>{title}</h4>
          {desc && <p>{desc}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="rb-sched-field">
      <span className="rb-sched-field-label">
        {label}
        {hint && <span className="rb-sched-field-hint">{hint}</span>}
      </span>
      <span className="rb-sched-field-control">{children}</span>
    </label>
  );
}

/** A number box with a unit after it; keeps the typed text while it isn't a valid number yet. */
function NumberInput({ label, value, unit, min, max, step, onChange }: { label: string; value: number; unit?: string; min?: number; max?: number; step?: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className="rb-sched-number">
      <input
        type="number"
        aria-label={label}
        value={draft ?? String(value)}
        min={min}
        max={max}
        step={step ?? 'any'}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() === '' || !Number.isFinite(n)) return;
          onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
        }}
        onBlur={() => setDraft(null)}
      />
      {unit && <span className="rb-sched-unit">{unit}</span>}
    </span>
  );
}

/**
 * Sections, matched top to bottom: each has a name, a kind and conditions on
 * select or checkbox properties (all must hold).
 */
function SectionsCard({
  config,
  sections,
  saved,
  onChange,
  onReset,
}: {
  config: DatabaseConfig;
  sections: ScheduleSection[];
  saved: boolean;
  onChange: (sections: ScheduleSection[]) => void;
  onReset: () => void;
}) {
  const props = conditionProperties(config);
  const problems = sectionProblems(config, sections);
  const update = (i: number, s: ScheduleSection): void => onChange(sections.map((x, j) => (j === i ? s : x)));
  const swap = (i: number, j: number): void => {
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = (): void => {
    const first = props[0];
    onChange([...sections, { name: 'New section', kind: 'hidden', conditions: first ? [firstCondition(first)] : [] }]);
  };

  return (
    <Card
      icon="layers"
      title="Sections"
      desc="Where each note shows, checked top to bottom: the first section whose conditions all hold wins. Moving a game writes its target's conditions."
    >
      {props.length === 0 && <div className="rb-sched-hint">Sections use select and checkbox properties. Add one in Board settings → Properties.</div>}
      <div className="rb-sched-sections">
        {sections.map((s, i) => (
          <SectionRow
            key={i}
            config={config}
            section={s}
            index={i}
            last={i === sections.length - 1}
            onChange={(next) => update(i, next)}
            onUp={() => swap(i, i - 1)}
            onDown={() => swap(i, i + 1)}
            onRemove={() => onChange(sections.filter((_, j) => j !== i))}
          />
        ))}
      </div>
      {problems.length > 0 && (
        <div className="rb-sched-error">
          {problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </div>
      )}
      <div className="rb-sched-section-tools">
        <button onClick={add} disabled={props.length === 0}>
          <Icon name="plus" /> Add section
        </button>
        {saved && (
          <button className="rb-sched-reset" onClick={onReset}>
            <Icon name="rotate-ccw" /> Reset to the guessed sections
          </button>
        )}
      </div>
    </Card>
  );
}

const firstCondition = (p: PropertyConfig): SectionCondition =>
  p.type === 'checkbox' ? { property: p.name, op: 'checked' } : { property: p.name, op: 'is', value: p.options?.[0]?.value ?? '' };

function SectionRow({
  config,
  section: s,
  index,
  last,
  onChange,
  onUp,
  onDown,
  onRemove,
}: {
  config: DatabaseConfig;
  section: ScheduleSection;
  index: number;
  last: boolean;
  onChange: (s: ScheduleSection) => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const props = conditionProperties(config);
  const setCond = (j: number, c: SectionCondition): void => onChange({ ...s, conditions: s.conditions.map((x, k) => (k === j ? c : x)) });
  const kindOptions: Option<SectionKind>[] = KINDS.map((k) => ({ value: k.value, label: kindName(k.value) }));
  return (
    <div className="rb-sched-section" data-kind={s.kind}>
      <div className="rb-sched-section-head">
        <span className="rb-sched-section-n">{index + 1}</span>
        <input type="text" aria-label="Section name" value={s.name} onChange={(e) => onChange({ ...s, name: e.target.value })} />
        <Select<SectionKind> className="dropdown" value={s.kind} options={kindOptions} onChange={(kind) => onChange({ ...s, kind })} />
        <button className="clickable-icon" aria-label={`Move ${s.name} up`} disabled={index === 0} onClick={onUp}>
          <Icon name="arrow-up" />
        </button>
        <button className="clickable-icon" aria-label={`Move ${s.name} down`} disabled={last} onClick={onDown}>
          <Icon name="arrow-down" />
        </button>
        <button className="clickable-icon" aria-label={`Remove ${s.name}`} onClick={onRemove}>
          <Icon name="trash-2" />
        </button>
      </div>
      <div className="rb-sched-field-hint">{KINDS.find((k) => k.value === s.kind)?.hint}</div>
      <div className="rb-sched-conditions">
        {s.conditions.map((c, j) => {
          const p = config.properties.find((x) => x.name === c.property);
          return (
            <div key={j} className="rb-sched-condition">
              <span className="rb-sched-condition-join">{j === 0 ? 'When' : 'and'}</span>
              <Select
                className="dropdown"
                value={c.property}
                options={[...(p ? [] : [{ value: c.property, label: `${c.property} (missing)` }]), ...props.map((x) => ({ value: x.name, label: propertyLabel(x) }))]}
                onChange={(name) => {
                  const next = props.find((x) => x.name === name);
                  if (next) setCond(j, firstCondition(next));
                }}
              />
              {p?.type === 'checkbox' ? (
                <Select<'checked' | 'unchecked'>
                  className="dropdown"
                  value={c.op === 'unchecked' ? 'unchecked' : 'checked'}
                  options={[
                    { value: 'checked', label: 'is checked' },
                    { value: 'unchecked', label: 'is unchecked' },
                  ]}
                  onChange={(op) => setCond(j, { property: c.property, op })}
                />
              ) : (
                <ValuePicker prop={p} condition={c} onChange={(next) => setCond(j, next)} />
              )}
              <button className="clickable-icon" aria-label="Remove condition" onClick={() => onChange({ ...s, conditions: s.conditions.filter((_, k) => k !== j) })}>
                <Icon name="x" />
              </button>
            </div>
          );
        })}
        <button
          className="rb-sched-add-condition"
          disabled={props.length === 0}
          onClick={() => {
            const unused = props.find((x) => !s.conditions.some((c) => c.property === x.name)) ?? props[0];
            if (unused) onChange({ ...s, conditions: [...s.conditions, firstCondition(unused)] });
          }}
        >
          <Icon name="plus" /> Condition
        </button>
      </div>
    </div>
  );
}

/** Select values as toggleable pills: one picked is "is", several is "is any of". */
function ValuePicker({ prop, condition: c, onChange }: { prop: PropertyConfig | undefined; condition: SectionCondition; onChange: (c: SectionCondition) => void }) {
  const picked = c.op === 'is' ? [c.value] : c.op === 'anyOf' ? c.value : [];
  const options = prop?.options ?? [];
  const toggle = (v: string): void => {
    const next = picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v];
    if (next.length === 0) return;
    onChange(next.length === 1 ? { property: c.property, op: 'is', value: next[0] } : { property: c.property, op: 'anyOf', value: next });
  };
  if (!options.length) return <span className="rb-sched-hint">No listed values</span>;
  return (
    <span className="rb-sched-values">
      <span className="rb-sched-condition-join">{picked.length > 1 ? 'is any of' : 'is'}</span>
      {options.map((o) => {
        const opt = optionFor(prop!, o.value);
        const on = picked.includes(o.value);
        return (
          <button
            key={o.value}
            className={on ? 'rb-sched-status-pill is-on' : 'rb-sched-status-pill'}
            style={{ ['--pill' as string]: opt.color }}
            aria-pressed={on}
            onClick={() => toggle(o.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </span>
  );
}

/** Groups of values that count as alike, edited as removable chips. */
function SimilarGroups({ groups, onChange }: { groups: string[][]; onChange: (groups: string[][]) => void }) {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const group = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (group.length < 2) return;
    onChange([...groups, group]);
    setDraft('');
  };
  return (
    <div className="rb-sched-similar">
      <div className="rb-sched-field-label">
        Similar values
        <span className="rb-sched-field-hint">count as alike, at the "Similar counts" share</span>
      </div>
      {groups.length > 0 && (
        <div className="rb-sched-similar-list">
          {groups.map((g, i) => (
            <span key={i} className="rb-sched-similar-group">
              {g.join(' ≈ ')}
              <button className="clickable-icon" aria-label={`Remove ${g.join(', ')}`} onClick={() => onChange(groups.filter((_, j) => j !== i))}>
                <Icon name="x" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="rb-sched-similar-add">
        <input
          type="text"
          placeholder="JRPG, Visual novel"
          aria-label="New similar group"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <button onClick={add} disabled={draft.split(',').filter((s) => s.trim()).length < 2}>
          <Icon name="plus" /> Add
        </button>
      </div>
    </div>
  );
}
