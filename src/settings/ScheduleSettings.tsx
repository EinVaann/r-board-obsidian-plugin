import { useMemo, useState, type ReactNode } from 'react';
import type { DatabaseConfig, PropertyConfig, ScheduleConfig, ScheduleSection, SectionCondition, SectionKind, ViewConfig } from '../types';
import { propertyLabel } from '../config';
import { useBoardContext } from '../board/context';
import { optionFor } from '../render/values';
import { defaultScheduleConfig, guessLogColumns, guessSchedule } from '../schedule/config';
import { conditionProperties, defaultSections, kindName, sectionProblems } from '../schedule/sections';
import { DEFAULT_PENALTIES, DEFAULT_SETTINGS } from '../schedule/types';
import { useLinkedTable } from '../schedule/useLinkedTable';
import { Button, FieldHint, FieldLabel, IconButton, Input, LabeledField as Field, MultiSelect, NumberInput, Pill, Segmented, Select, SimpleCard, type Option } from '../ui';

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
            <NumberInput aria-label="Lanes" value={sc.lanes} min={1} max={6} step={1} onChange={(lanes) => set({ lanes: Math.round(lanes) })} />
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
            <NumberInput aria-label="Hours per week" value={sc.estimates.weekly} unit="h" min={0} onChange={(weekly) => set({ estimates: { ...sc.estimates, weekly } })} />
          </Field>
          <Field label="Unlogged live" hint="dailies, always counted">
            <NumberInput aria-label="Unlogged live hours per week" value={sc.estimates.live} unit="h/wk" min={0} onChange={(live) => set({ estimates: { ...sc.estimates, live } })} />
          </Field>
          <Field label="Long over" hint="one long game at a time">
            <NumberInput aria-label="Long over" value={sc.longOver} unit="h" min={0} onChange={(longOver) => set({ longOver })} />
          </Field>
          <Field label="Average over">
            <NumberInput aria-label="Average over" value={sc.paceWeeks} unit="weeks" min={1} max={52} step={1} onChange={(paceWeeks) => set({ paceWeeks: Math.round(paceWeeks) })} />
          </Field>
        </div>
      </Card>

      <Card icon="shuffle" title="Variety" desc="Taken off a game's score when picking what's next. Nothing is ever blocked.">
        <div className="rb-sched-grid is-four">
          <Field label="Like the other lane">
            <NumberInput aria-label="Like the other lane" value={sc.penalties.running} unit="pts" min={0} onChange={(running) => set({ penalties: { ...sc.penalties, running } })} />
          </Field>
          <Field label="Like the one before">
            <NumberInput aria-label="Like the one before" value={sc.penalties.previous} unit="pts" min={0} onChange={(previous) => set({ penalties: { ...sc.penalties, previous } })} />
          </Field>
          <Field label="Second long game">
            <NumberInput aria-label="Second long game" value={sc.penalties.long} unit="pts" min={0} onChange={(long) => set({ penalties: { ...sc.penalties, long } })} />
          </Field>
          <Field label="Similar counts">
            <NumberInput
              aria-label="Similar counts"
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
        <Button
          variant="ghost"
          size="sm"
          icon="rotate-ccw"
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
          Reset pace and variety to defaults
        </Button>
      </Card>
    </div>
  );
}

/** A schedule settings card: the shared card, with the schedule's spacing for its fields. */
function Card({ icon, title, desc, children }: { icon: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <SimpleCard icon={icon} title={title} desc={desc} className="rb-sched-card">
      {children}
    </SimpleCard>
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

  return (
    <Card
      icon="layers"
      title="Sections"
      desc="Where each note shows, checked top to bottom: the first section whose conditions all hold wins. A section with no conditions is off. Moving a game writes its target's conditions."
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
      {saved && (
        <div className="rb-sched-section-tools">
          <Button variant="ghost" size="sm" icon="rotate-ccw" className="rb-sched-reset" onClick={onReset}>
            Reset to the guessed sections
          </Button>
        </div>
      )}
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
}: {
  config: DatabaseConfig;
  section: ScheduleSection;
  index: number;
  last: boolean;
  onChange: (s: ScheduleSection) => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const props = conditionProperties(config);
  const setCond = (j: number, c: SectionCondition): void => onChange({ ...s, conditions: s.conditions.map((x, k) => (k === j ? c : x)) });
  const off = s.conditions.length === 0;
  return (
    <div className={off ? 'rb-sched-section is-off' : 'rb-sched-section'} data-kind={s.kind}>
      <div className="rb-sched-section-head">
        <span className="rb-sched-section-n">{index + 1}</span>
        <span className="rb-sched-section-name">{kindName(s.kind)}</span>
        {off && <span className="rb-sched-section-off">Off</span>}
        <IconButton icon="arrow-up" label={`Move ${kindName(s.kind)} up`} disabled={index === 0} onClick={onUp} />
        <IconButton icon="arrow-down" label={`Move ${kindName(s.kind)} down`} disabled={last} onClick={onDown} />
      </div>
      <div className="rb-sched-field-hint">{KINDS.find((k) => k.value === s.kind)?.hint}</div>
      <div className="rb-sched-conditions">
        {s.conditions.map((c, j) => {
          const p = config.properties.find((x) => x.name === c.property);
          return (
            <div key={j} className="rb-sched-condition">
              <span className="rb-sched-condition-join">{j === 0 ? 'When' : 'and'}</span>
              <Select
                size="sm"
                value={c.property}
                options={[...(p ? [] : [{ value: c.property, label: `${c.property} (missing)` }]), ...props.map((x) => ({ value: x.name, label: propertyLabel(x) }))]}
                onChange={(name) => {
                  const next = props.find((x) => x.name === name);
                  if (next) setCond(j, firstCondition(next));
                }}
              />
              {p?.type === 'checkbox' ? (
                <span className="rb-sched-values">
                  <span className="rb-sched-condition-join">is</span>
                  <Select<'checked' | 'unchecked'>
                    size="sm"
                    value={c.op === 'unchecked' ? 'unchecked' : 'checked'}
                    options={[
                      { value: 'checked', label: 'checked' },
                      { value: 'unchecked', label: 'unchecked' },
                    ]}
                    onChange={(op) => setCond(j, { property: c.property, op })}
                  />
                </span>
              ) : (
                <ValuePicker prop={p} condition={c} onChange={(next) => setCond(j, next)} />
              )}
              <IconButton icon="x" label="Remove condition" size="sm" tone="danger" onClick={() => onChange({ ...s, conditions: s.conditions.filter((_, k) => k !== j) })} />
            </div>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          icon="plus"
          className="rb-sched-add-condition"
          disabled={props.length === 0}
          onClick={() => {
            const unused = props.find((x) => !s.conditions.some((c) => c.property === x.name)) ?? props[0];
            if (unused) onChange({ ...s, conditions: [...s.conditions, firstCondition(unused)] });
          }}
        >
          Condition
        </Button>
      </div>
    </div>
  );
}

/** A condition's values: one picked is "is", several is "is any of". */
function ValuePicker({ prop, condition: c, onChange }: { prop: PropertyConfig | undefined; condition: SectionCondition; onChange: (c: SectionCondition) => void }) {
  const picked = c.op === 'is' ? [c.value] : c.op === 'anyOf' ? c.value : [];
  if (!prop?.options?.length) return <span className="rb-sched-hint">No listed values</span>;
  const options: Option[] = prop.options.map((o) => ({ value: o.value, label: optionFor(prop, o.value).label, color: optionFor(prop, o.value).color }));
  return (
    <span className="rb-sched-values">
      <span className="rb-sched-condition-join">{picked.length > 1 ? 'is any of' : 'is'}</span>
      <MultiSelect
        size="sm"
        required
        label={`Values of ${propertyLabel(prop)}`}
        value={picked}
        options={options}
        onChange={(next) => onChange(next.length === 1 ? { property: c.property, op: 'is', value: next[0] } : { property: c.property, op: 'anyOf', value: next })}
      />
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
      <FieldLabel>
        Similar values
        <FieldHint>count as alike, at the "Similar counts" share</FieldHint>
      </FieldLabel>
      {groups.length > 0 && (
        <div className="rb-sched-similar-list">
          {groups.map((g, i) => (
            <Pill key={i} className="rb-sched-similar-group" removeLabel={`Remove ${g.join(', ')}`} onRemove={() => onChange(groups.filter((_, j) => j !== i))}>
              {g.join(' ≈ ')}
            </Pill>
          ))}
        </div>
      )}
      <div className="rb-sched-similar-add">
        <Input
          placeholder="JRPG, Visual novel"
          aria-label="New similar group"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <Button icon="plus" onClick={add} disabled={draft.split(',').filter((s) => s.trim()).length < 2}>
          Add
        </Button>
      </div>
    </div>
  );
}
