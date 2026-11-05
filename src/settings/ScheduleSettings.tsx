import { useMemo } from 'react';
import type { DatabaseConfig, PropertyConfig, ScheduleConfig, ViewConfig } from '../types';
import { propertyLabel } from '../config';
import { useBoardContext } from '../board/context';
import { optionFor } from '../render/values';
import { defaultScheduleConfig, guessLogColumns, guessSchedule } from '../schedule/config';
import { useLinkedTable } from '../schedule/useLinkedTable';
import { Segmented, Select, SettingRow, TextInput, type Option } from './controls';

type Statuses = ScheduleConfig['statuses'];

const STATUS_ROWS: { key: keyof Statuses; name: string; desc: string }[] = [
  { key: 'pool', name: 'Waiting', desc: 'Scheduled into the lanes, best first.' },
  { key: 'active', name: 'Playing', desc: 'Running now. With the live checkbox: the live band instead.' },
  { key: 'finished', name: 'Finished', desc: 'Teaches how far estimates overrun.' },
  { key: 'dropped', name: 'Dropped', desc: 'Ended without finishing.' },
  { key: 'paused', name: 'On hold', desc: 'Out of the plan for now; "Put on hold" writes this.' },
];

/** View settings → Schedule: where sessions are logged, which properties mean what, pace and penalties. */
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
  const statusProp = props.find((p) => p.name === sc.status);
  const statusValues = statusProp?.options?.map((o) => o.value) ?? [];
  const toggleStatus = (key: keyof Statuses, value: string): void => {
    const next: Statuses = {
      pool: [...sc.statuses.pool],
      active: [...sc.statuses.active],
      finished: [...sc.statuses.finished],
      dropped: [...sc.statuses.dropped],
      paused: [...sc.statuses.paused],
    };
    const on = next[key].includes(value);
    for (const k of Object.keys(next) as (keyof Statuses)[]) next[k] = next[k].filter((v) => v !== value);
    if (!on) next[key].push(value);
    set({ statuses: next });
  };
  const numberInput = (value: number, onChange: (n: number) => void) => (
    <TextInput type="number" value={String(value)} onChange={(v) => v.trim() !== '' && Number.isFinite(Number(v)) && onChange(Number(v))} />
  );

  return (
    <>
      <h4>Session log</h4>
      <SettingRow name="Log table" desc="A .table file with one row per play session. Only logged hours move the forecast.">
        <Select value={sc.log ?? ''} options={[{ value: '', label: 'None' }, ...tables.map((t) => ({ value: t, label: t }))]} onChange={(v) => set({ log: v || undefined })} />
      </SettingRow>
      {log.status === 'error' && <div className="rb-setup-error">{log.error}</div>}
      {log.status === 'ok' && (
        <>
          <SettingRow name="Item column" desc="Links to the notes of this board.">
            <Select value={cols.logItem} options={logOf(['links', 'text'])} onChange={(v) => set({ logItem: v })} />
          </SettingRow>
          <SettingRow name="Hours column">
            <Select value={cols.logHours} options={logOf(['number', 'formula'])} onChange={(v) => set({ logHours: v })} />
          </SettingRow>
          <SettingRow name="Date column">
            <Select value={cols.logDate} options={logOf(['date', 'text'])} onChange={(v) => set({ logDate: v })} />
          </SettingRow>
          <SettingRow name="Type column" desc="Optional: lane, live, detour or trial. Guessed when empty.">
            <Select value={cols.logType ?? ''} options={logOf(['select', 'text'], true)} onChange={(v) => set({ logType: v || undefined })} />
          </SettingRow>
        </>
      )}

      <h4>Properties</h4>
      <SettingRow name="Estimated hours">
        <Select value={sc.duration ?? ''} options={of(['number', 'formula'])} onChange={(v) => set({ duration: v || undefined })} />
      </SettingRow>
      <SettingRow name="Score" desc="Higher goes first.">
        <Select value={sc.score ?? ''} options={of(['number', 'formula'])} onChange={(v) => set({ score: v || undefined })} />
      </SettingRow>
      <SettingRow name="Vary by" desc="Neighbours sharing a value are ranked lower (e.g. genre).">
        <Select value={sc.vary ?? ''} options={of(['multi', 'select', 'text'])} onChange={(v) => set({ vary: v || undefined })} />
      </SettingRow>
      <SettingRow name="Similar values" desc="One group per line, comma-separated: values that count as alike (half penalty).">
        <textarea
          className="rb-schedule-similar"
          rows={3}
          defaultValue={sc.similar.map((g) => g.join(', ')).join('\n')}
          placeholder="JRPG, Visual novel"
          onChange={(e) =>
            set({
              similar: e.target.value
                .split('\n')
                .map((l) => l.split(',').map((s) => s.trim()).filter(Boolean))
                .filter((g) => g.length > 1),
            })
          }
        />
      </SettingRow>
      <SettingRow name="Status">
        <Select value={sc.status ?? ''} options={of(['select', 'text'])} onChange={(v) => set({ status: v || undefined })} />
      </SettingRow>
      {statusProp &&
        STATUS_ROWS.map((row) => (
          <SettingRow key={row.key} name={row.name} desc={row.desc}>
            <div className="rb-auto-date-values">
              {statusValues.map((v) => {
                const on = sc.statuses[row.key].includes(v);
                return (
                  <button key={v} className={on ? 'rb-auto-date-value is-on' : 'rb-auto-date-value'} aria-pressed={on} onClick={() => toggleStatus(row.key, v)}>
                    {optionFor(statusProp, v).label}
                  </button>
                );
              })}
            </div>
          </SettingRow>
        ))}
      <SettingRow name="Live checkbox" desc="Playing items with it checked run outside the lanes (e.g. gacha games).">
        <Select value={sc.live ?? ''} options={of(['checkbox'])} onChange={(v) => set({ live: v || undefined })} />
      </SettingRow>
      <SettingRow name="Start date">
        <Select value={sc.startDate ?? ''} options={of(['date'])} onChange={(v) => set({ startDate: v || undefined })} />
      </SettingRow>
      <SettingRow name="End date">
        <Select value={sc.endDate ?? ''} options={of(['date'])} onChange={(v) => set({ endDate: v || undefined })} />
      </SettingRow>

      <h4>Pace</h4>
      <SettingRow name="Lanes" desc="How many items run side by side.">
        {numberInput(sc.lanes, (lanes) => set({ lanes: Math.min(6, Math.max(1, Math.round(lanes))) }))}
      </SettingRow>
      <SettingRow name="Long over (hours)" desc="Items longer than this count as long.">
        {numberInput(sc.longOver, (longOver) => set({ longOver }))}
      </SettingRow>
      <SettingRow name="Week starts">
        <Segmented<'mon' | 'sun'>
          value={sc.weekStart}
          options={[
            { value: 'mon', label: 'Monday' },
            { value: 'sun', label: 'Sunday' },
          ]}
          onChange={(weekStart) => set({ weekStart })}
        />
      </SettingRow>
      <SettingRow name="Hours per week" desc="Starting guess of all play time. Your log takes over a quarter per full week, completely after 4.">
        {numberInput(sc.estimates.weekly, (weekly) => set({ estimates: { ...sc.estimates, weekly } }))}
      </SettingRow>
      <SettingRow name="Unlogged live hours per week" desc="Daily time on live games you don't log (e.g. gacha dailies). Always counted; logged live sessions come on top.">
        {numberInput(sc.estimates.live, (live) => set({ estimates: { ...sc.estimates, live } }))}
      </SettingRow>
      <SettingRow name="Average over (weeks)">
        {numberInput(sc.paceWeeks, (paceWeeks) => set({ paceWeeks: Math.max(1, Math.round(paceWeeks)) }))}
      </SettingRow>

      <h4>Penalties</h4>
      <div className="rb-wizard-hint">Subtracted from the score when picking what comes next. Nothing is ever blocked.</div>
      <SettingRow name="Like a running item">
        {numberInput(sc.penalties.running, (running) => set({ penalties: { ...sc.penalties, running } }))}
      </SettingRow>
      <SettingRow name="Like the item just before">
        {numberInput(sc.penalties.previous, (previous) => set({ penalties: { ...sc.penalties, previous } }))}
      </SettingRow>
      <SettingRow name="Second long item">
        {numberInput(sc.penalties.long, (long) => set({ penalties: { ...sc.penalties, long } }))}
      </SettingRow>
      <SettingRow name="Similar counts as" desc="Fraction of a full match (0–1).">
        {numberInput(sc.penalties.similarFactor, (f) => set({ penalties: { ...sc.penalties, similarFactor: Math.min(1, Math.max(0, f)) } }))}
      </SettingRow>
    </>
  );
}
