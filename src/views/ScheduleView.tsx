import { useMemo } from 'react';
import type { BoardItem, DatabaseConfig, ScheduleConfig, ViewConfig } from '../types';
import { propertyLabel } from '../config';
import { applyFilter } from '../data/filter';
import { resolveImageSrc } from '../render/values';
import { useBoardContext } from '../board/context';
import { TitleLink } from '../components/Card';
import { Icon } from '../react/Icon';
import { defaultScheduleConfig, engineSettings, guessLogColumns, guessSchedule } from '../schedule/config';
import { localDate } from '../schedule/dates';
import { forecast } from '../schedule/engine';
import { formatHours, formatRange } from '../schedule/format';
import { toScheduleItems, toSessions } from '../schedule/inputs';
import type { Forecast, LaneEntry, Session } from '../schedule/types';
import { useLinkedTable } from '../schedule/useLinkedTable';

const LANE_NAMES = 'ABCDEF';

/** Forecast of the backlog worked through in lanes, from the session log. Read-only for now. */
export function ScheduleView({ config, view, all, viewIndex }: { config: DatabaseConfig; view: ViewConfig; all: BoardItem[]; viewIndex: number }) {
  const { app, actions } = useBoardContext();
  const sc: ScheduleConfig = useMemo(() => guessSchedule(config, view.schedule ?? defaultScheduleConfig()), [config, view.schedule]);
  const log = useLinkedTable(app, sc.log);
  const items = useMemo(() => applyFilter(all, view.filter, config.properties), [all, view.filter, config.properties]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const sessions: Session[] = useMemo(() => {
    if (log.status !== 'ok') return [];
    const cols = guessLogColumns(log.table.config.properties, sc);
    if (!cols.logItem || !cols.logHours || !cols.logDate) return [];
    return toSessions(log.table.rows, cols, (linkpath) => {
      const dest = app.metadataCache.getFirstLinkpathDest(linkpath, log.file.path);
      return dest && byId.has(dest.path) ? dest.path : null;
    });
  }, [app, log, sc, byId]);

  const today = localDate(new Date());
  const result: Forecast = useMemo(
    () => forecast(toScheduleItems(items, sc), sessions, engineSettings(sc), today),
    [items, sc, sessions, today],
  );

  const year = Number(today.slice(0, 4));
  const cover = config.properties.find((p) => p.type === 'image');
  const missing = [!sc.status && 'status', !sc.duration && 'duration'].filter(Boolean) as string[];
  const unresolved = sessions.filter((s) => !s.item).length;

  const itemOf = (id: string): BoardItem | undefined => byId.get(id);
  const coverOf = (item: BoardItem | undefined): string | null =>
    item && cover && item.file ? resolveImageSrc(app, item.file, item.values[cover.name]) : null;

  return (
    <div className="rb-schedule">
      {(missing.length > 0 || log.status !== 'ok') && (
        <div className="rb-schedule-notice">
          <Icon name="info" />
          <div>
            {missing.length > 0 && <div>Choose the {missing.join(' and ')} property in the view's Schedule settings.</div>}
            {log.status === 'none' && <div>No session log yet: dates use your starting estimates. Pick a log table in the Schedule settings.</div>}
            {log.status === 'error' && <div>{log.error}</div>}
          </div>
          <button onClick={() => actions.openViewSettings(viewIndex)}>Settings…</button>
        </div>
      )}

      <WeekPanel result={result} itemOf={itemOf} unresolved={unresolved} />

      {result.live.length > 0 && (
        <section className="rb-schedule-live">
          <h4>
            <Icon name="radio" /> Live
          </h4>
          <div className="rb-schedule-live-items">
            {result.live.map((l) => {
              const item = itemOf(l.item);
              return (
                <span key={l.item} className="rb-schedule-chip">
                  {item ? <TitleLink item={item} /> : l.item}
                  <span className="rb-schedule-muted">~{formatHours(l.weekly)}/wk</span>
                </span>
              );
            })}
          </div>
        </section>
      )}

      <div className="rb-schedule-lanes" style={{ gridTemplateColumns: `repeat(${result.lanes.length}, minmax(0, 1fr))` }}>
        {result.lanes.map((lane, n) => (
          <section key={n} className="rb-schedule-lane">
            <h4>Lane {LANE_NAMES[n] ?? n + 1}</h4>
            {lane.length === 0 && <div className="rb-schedule-muted">Nothing planned.</div>}
            {lane.map((e) => (
              <Entry key={e.item} entry={e} item={itemOf(e.item)} cover={coverOf(itemOf(e.item))} year={year} />
            ))}
          </section>
        ))}
      </div>

      {result.overflow.length > 0 && (
        <section className="rb-schedule-side">
          <h4>Also playing</h4>
          <div className="rb-schedule-live-items">
            {result.overflow.map((id) => {
              const item = itemOf(id);
              return <span key={id} className="rb-schedule-chip">{item ? <TitleLink item={item} /> : id}</span>;
            })}
          </div>
        </section>
      )}

      <footer className="rb-schedule-footer">
        {result.finish ? (
          <span>
            <Icon name="flag" /> All planned done around <b>{formatRange(result.finish, year)}</b>
          </span>
        ) : (
          <span>Nothing planned.</span>
        )}
        <span className="rb-schedule-muted">
          {result.pace.history ? `Pace from the last ${result.pace.history} week${result.pace.history === 1 ? '' : 's'}` : 'Pace from your estimates'}
          {result.overrun !== 1 && ` · ranges allow ×${result.overrun} overrun`}
          {sc.vary && ` · varies ${propertyLabelOf(config, sc.vary)}`}
        </span>
      </footer>
    </div>
  );
}

function propertyLabelOf(config: DatabaseConfig, name: string): string {
  const p = config.properties.find((q) => q.name === name);
  return p ? propertyLabel(p).toLowerCase() : name;
}

function WeekPanel({ result, itemOf, unresolved }: { result: Forecast; itemOf: (id: string) => BoardItem | undefined; unresolved: number }) {
  const { week, pace } = result;
  const logged = week.logged.lane + week.logged.live + week.logged.detour + week.logged.trial;
  const share = Math.min(100, week.budget ? (logged / week.budget) * 100 : 0);
  return (
    <section className="rb-schedule-week">
      <div className="rb-schedule-week-head">
        <h4>This week</h4>
        <span>
          <b>{formatHours(logged)}</b> of ~{formatHours(week.budget)}
        </span>
      </div>
      <div className="rb-schedule-bar" role="progressbar" aria-valuenow={Math.round(share)} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${share}%` }} />
      </div>
      <div className="rb-schedule-week-types rb-schedule-muted">
        Lanes {formatHours(week.logged.lane)} · Live {formatHours(week.logged.live)} · Other {formatHours(week.logged.detour + week.logged.trial)}
        {' · '}lane pace ~{formatHours(pace.lane)}/wk
      </div>
      {week.suggested.length > 0 && (
        <ul className="rb-schedule-split">
          {week.suggested.map((s) => {
            const item = itemOf(s.item);
            return (
              <li key={s.item}>
                {item ? <TitleLink item={item} /> : s.item}
                <span className="rb-schedule-muted">{s.hours > 0 ? `~${formatHours(s.hours)} left this week` : 'done for the week'}</span>
              </li>
            );
          })}
        </ul>
      )}
      {unresolved > 0 && (
        <div className="rb-schedule-muted">
          {unresolved} logged session{unresolved === 1 ? '' : 's'} link to notes outside this view; counted as other time.
        </div>
      )}
    </section>
  );
}

function Entry({ entry: e, item, cover, year }: { entry: LaneEntry; item: BoardItem | undefined; cover: string | null; year: number }) {
  const cls = ['rb-schedule-entry', e.current ? 'is-current' : '', e.paused ? 'is-paused' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {cover ? <img className="rb-schedule-cover" src={cover} alt="" loading="lazy" /> : <div className="rb-schedule-cover rb-schedule-cover-empty" />}
      <div className="rb-schedule-entry-body">
        <div className="rb-schedule-entry-title">
          {item ? <TitleLink item={item} /> : e.item}
          {e.pinned && <Icon name="pin" className="rb-schedule-flag" />}
          {e.paused && <span className="rb-schedule-tag" title="No lane time for a while">paused</span>}
          {e.overEstimate && <span className="rb-schedule-tag" title="Played past its estimate">past estimate</span>}
        </div>
        <div className="rb-schedule-muted">
          {e.current ? `Playing · ${formatHours(e.remaining)} left` : `Starts ${formatRange(e.start, year)} · ${formatHours(e.remaining)}`}
        </div>
        <div className="rb-schedule-entry-end">Done {formatRange(e.end, year)}</div>
        {e.penalty > 0 && (
          <div className="rb-schedule-reasons" title={`Ranked ${e.penalty} lower`}>
            {e.reasons.join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
