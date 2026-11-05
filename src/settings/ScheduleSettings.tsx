import { useMemo, useState, type ReactNode } from 'react';
import type { DatabaseConfig, PropertyConfig, ScheduleConfig, ViewConfig } from '../types';
import { propertyLabel } from '../config';
import { useBoardContext } from '../board/context';
import { optionFor } from '../render/values';
import { Icon } from '../react/Icon';
import { defaultScheduleConfig, guessLogColumns, guessSchedule } from '../schedule/config';
import { DEFAULT_PENALTIES, DEFAULT_SETTINGS } from '../schedule/types';
import { useLinkedTable } from '../schedule/useLinkedTable';
import { Segmented, Select, type Option } from './controls';

type Statuses = ScheduleConfig['statuses'];
type Role = keyof Statuses;

const ROLES: { value: Role | ''; label: string; hint: string }[] = [
  { value: 'pool', label: 'Waiting', hint: 'scheduled into the lanes' },
  { value: 'active', label: 'Playing', hint: 'running now (live band with the live checkbox)' },
  { value: 'finished', label: 'Finished', hint: 'teaches how far estimates overrun' },
  { value: 'dropped', label: 'Dropped', hint: 'ended without finishing' },
  { value: 'paused', label: 'On hold', hint: 'out of the plan for now' },
  { value: '', label: 'Not scheduled', hint: 'left out' },
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
          <Field label="Live checkbox" hint="e.g. gacha games">
            <Select value={sc.live ?? ''} options={of(['checkbox'])} onChange={(v) => set({ live: v || undefined })} />
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

      <StatusCard config={config} sc={sc} set={set} of={of} />

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

/** One row per status value, each with the role it plays. */
function StatusCard({
  config,
  sc,
  set,
  of,
}: {
  config: DatabaseConfig;
  sc: ScheduleConfig;
  set: (patch: Partial<ScheduleConfig>) => void;
  of: (types: PropertyConfig['type'][]) => Option<string>[];
}) {
  const prop = config.properties.find((p) => p.name === sc.status);
  const values = prop?.options?.map((o) => o.value) ?? [];
  const roleOf = (v: string): Role | '' => (Object.keys(sc.statuses) as Role[]).find((k) => sc.statuses[k].includes(v)) ?? '';
  const setRole = (value: string, role: Role | ''): void => {
    const next = Object.fromEntries((Object.keys(sc.statuses) as Role[]).map((k) => [k, sc.statuses[k].filter((v) => v !== value)])) as Statuses;
    if (role) next[role] = [...next[role], value];
    set({ statuses: next });
  };
  const missing = (['pool', 'active'] as Role[]).filter((r) => !values.some((v) => roleOf(v) === r));
  const roleOptions: Option<string>[] = ROLES.map((r) => ({ value: r.value, label: r.label }));

  return (
    <Card icon="tags" title="Statuses" desc="What each status means for the schedule. Finish, Drop and Put on hold write the first status of that kind.">
      <Field label="Status property">
        <Select value={sc.status ?? ''} options={of(['select', 'text'])} onChange={(v) => set({ status: v || undefined })} />
      </Field>
      {prop && values.length === 0 && <div className="rb-sched-hint">This property has no listed values. Add them in Board settings → Properties.</div>}
      {prop && values.length > 0 && (
        <div className="rb-sched-status-list">
          {values.map((v) => {
            const o = optionFor(prop, v);
            const role = roleOf(v);
            return (
              <div key={v} className={role ? 'rb-sched-status' : 'rb-sched-status is-off'}>
                <span className="rb-sched-status-pill" style={{ ['--pill' as string]: o.color }}>
                  {o.label}
                </span>
                <Icon name="arrow-right" className="rb-sched-status-arrow" />
                <Select className="dropdown rb-sched-status-role" value={role} options={roleOptions} onChange={(r) => setRole(v, r as Role | '')} />
                <span className="rb-sched-status-hint">{ROLES.find((r) => r.value === role)?.hint}</span>
              </div>
            );
          })}
        </div>
      )}
      {prop && missing.length > 0 && (
        <div className="rb-sched-error">
          No status is set to {missing.map((r) => ROLES.find((x) => x.value === r)!.label).join(' or ')} yet — the schedule needs one.
        </div>
      )}
    </Card>
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
