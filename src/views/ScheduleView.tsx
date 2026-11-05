import { useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Menu } from 'obsidian';
import { DndContext, DragOverlay, closestCenter, pointerWithin, useDraggable, useDroppable, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import type { BoardItem, DatabaseConfig, ScheduleConfig, ViewConfig } from '../types';
import { propertyLabel } from '../config';
import { applyFilter } from '../data/filter';
import { resolveImageSrc } from '../render/values';
import { useBoard, useBoardContext } from '../board/context';
import { TitleLink } from '../components/Card';
import { useDragSensors } from '../components/dnd';
import { Icon } from '../react/Icon';
import { defaultScheduleConfig, engineSettings, guessLogColumns, guessSchedule } from '../schedule/config';
import { localDate } from '../schedule/dates';
import { forecast } from '../schedule/engine';
import { formatHours, formatRange } from '../schedule/format';
import { toScheduleItems, toSessions } from '../schedule/inputs';
import { nextCandidates } from '../schedule/next';
import { movedPins, placePin, replan, setNotBefore, unpin } from '../schedule/pins';
import { randomCandidate } from '../schedule/rules';
import { logSession, setRole, type Role } from '../schedule/actions';
import type { Forecast, LaneEntry, ScheduleItem, Session, Suggestion } from '../schedule/types';
import { useLinkedTable } from '../schedule/useLinkedTable';
import { openDatePrompt, openLogSession, openNextPick, openPickAny, type Candidate, type GameOption } from './ScheduleModals';

const LANE_NAMES = 'ABCDEF';

/** The slot under the pointer; the nearest one when the pointer is between slots (or for the keyboard). */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCenter(args);
};
const laneName = (n: number): string => LANE_NAMES[n] ?? String(n + 1);

/** Forecast of the backlog worked through in lanes, from the session log, with the controls to steer it. */
export function ScheduleView({ config, view, all, viewIndex }: { config: DatabaseConfig; view: ViewConfig; all: BoardItem[]; viewIndex: number }) {
  const { app, actions } = useBoardContext();
  const updateView = useBoard((s) => s.updateView);
  const sc: ScheduleConfig = useMemo(() => guessSchedule(config, view.schedule ?? defaultScheduleConfig()), [config, view.schedule]);
  const log = useLinkedTable(app, sc.log);
  const items = useMemo(() => applyFilter(all, view.filter, config.properties), [all, view.filter, config.properties]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const scheduleItems = useMemo(() => toScheduleItems(items, sc), [items, sc]);
  const stateOf = useMemo(() => new Map(scheduleItems.map((i) => [i.id, i])), [scheduleItems]);
  const cols = useMemo(() => (log.status === 'ok' ? guessLogColumns(log.table.config.properties, sc) : null), [log, sc]);

  const sessions: Session[] = useMemo(() => {
    if (log.status !== 'ok' || !cols?.logItem || !cols.logHours || !cols.logDate) return [];
    return toSessions(log.table.rows, cols, (linkpath) => {
      const dest = app.metadataCache.getFirstLinkpathDest(linkpath, log.file.path);
      return dest && byId.has(dest.path) ? dest.path : null;
    });
  }, [app, log, cols, byId]);

  const today = localDate(new Date());
  const settings = useMemo(() => engineSettings(sc), [sc]);
  const result: Forecast = useMemo(() => forecast(scheduleItems, sessions, settings, today), [scheduleItems, sessions, settings, today]);

  const year = Number(today.slice(0, 4));
  const cover = config.properties.find((p) => p.type === 'image');
  const missing = [!sc.status && 'status', !sc.duration && 'duration'].filter(Boolean) as string[];
  const unresolved = sessions.filter((s) => !s.item).length;
  const itemOf = (id: string): BoardItem | undefined => byId.get(id);
  const titleOf = (id: string): string => itemOf(id)?.title ?? id;
  const coverOf = (item: BoardItem | undefined): string | null => (item && cover && item.file ? resolveImageSrc(app, item.file, item.values[cover.name]) : null);

  // --- Writing back --------------------------------------------------------

  /** Which lane each running item is in now; side games are -1, so they stay out of freed lanes. */
  const currentAssign = (): Record<string, number> => {
    const out: Record<string, number> = {};
    result.lanes.forEach((l, n) => {
      const cur = l.find((e) => e.current);
      if (cur) out[cur.item] = n;
    });
    for (const id of result.overflow) out[id] = -1;
    return out;
  };

  /** Change the saved schedule settings (not the guessed ones); running items keep their lanes. */
  const editSchedule = (recipe: (s: ScheduleConfig) => void): void =>
    updateView(viewIndex, (v) => {
      v.schedule ??= defaultScheduleConfig();
      v.schedule.assign = currentAssign();
      recipe(v.schedule);
      if (v.schedule.assign && !Object.keys(v.schedule.assign).length) v.schedule.assign = undefined;
    });

  const role = async (id: string, r: Role): Promise<boolean> => {
    const item = itemOf(id);
    return item ? setRole(config, sc, item, r, actions.setValue) : false;
  };

  const hoursDetail = (id: string): string | undefined => {
    const d = stateOf.get(id)?.duration;
    return d ? formatHours(d) : undefined;
  };

  /**
   * Start `id`: it becomes playing in lane `n` when that lane is free (or its
   * game just ended: `freed`), else beside the lanes as a side game.
   */
  const start = async (id: string, n: number, freed?: string): Promise<void> => {
    const pinned = sc.pins.find((p) => p.item === id);
    if (!(await role(id, 'active'))) return;
    const busy = result.lanes[n]?.find((e) => e.current && e.item !== freed);
    editSchedule((s) => {
      s.pins = unpin(s.pins, id).map((p) => (pinned && p.lane === pinned.lane && p.position > pinned.position ? { ...p, position: p.position - 1 } : p));
      if (freed && s.assign) delete s.assign[freed];
      s.assign = { ...s.assign, [id]: busy ? -1 : n };
    });
  };

  const pickAnyOptions = (accept: (i: ScheduleItem) => boolean): GameOption[] =>
    scheduleItems
      .filter(accept)
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.title.localeCompare(b.title))
      .map((i) => ({ id: i.id, title: i.title, detail: [stateLabel(i), hoursDetail(i.id)].filter(Boolean).join(' · ') }));

  /** Ask what comes next in lane `n`, after `previous` ended there. */
  const askNext = (n: number, previous: string | null): void => {
    const ranked = nextCandidates(scheduleItems, result, n, previous, settings);
    // A game pinned to the front of this lane is the suggestion.
    const front = sc.pins.filter((p) => p.lane === n).sort((a, b) => a.position - b.position)[0];
    const ordered = front ? [...ranked.filter((r) => r.item === front.item), ...ranked.filter((r) => r.item !== front.item)] : ranked;
    const toCandidate = (s: Suggestion): Candidate => ({ id: s.item, title: titleOf(s.item), detail: hoursDetail(s.item), penalty: s.penalty, reasons: s.reasons });
    openNextPick(app, {
      lane: laneName(n),
      candidates: ordered.map(toCandidate),
      random: () => {
        const r = randomCandidate(ranked);
        return r ? toCandidate(r) : null;
      },
      onPick: (id) => void start(id, n, previous ?? undefined),
      onChooseAny: () =>
        openPickAny(app, {
          title: `Start in lane ${laneName(n)}`,
          options: pickAnyOptions((i) => i.state !== 'active' && i.state !== 'live' && i.id !== previous),
          onPick: (id) => void start(id, n, previous ?? undefined),
        }),
    });
  };

  /** Finish or drop a running item, then offer the next pick for its lane. */
  const end = async (id: string, n: number, r: 'finished' | 'dropped' | 'paused'): Promise<void> => {
    if (!(await role(id, r))) return;
    editSchedule((s) => void (s.assign && delete s.assign[id]));
    if (n >= 0) askNext(n, id);
  };

  const openLog = (initial?: string): void => {
    if (!sc.log || !cols || log.status !== 'ok') {
      actions.openViewSettings(viewIndex);
      return;
    }
    const playing = scheduleItems.filter((i) => i.state === 'active' || i.state === 'live');
    const rest = scheduleItems.filter((i) => i.state !== 'active' && i.state !== 'live').sort((a, b) => a.title.localeCompare(b.title));
    const games: GameOption[] = [...playing, ...rest].map((i) => ({ id: i.id, title: i.title, detail: stateLabel(i) }));
    openLogSession(app, {
      games,
      initial,
      today,
      withType: !!cols.logType,
      typeFor: (id) => {
        const s = stateOf.get(id)?.state;
        return s === 'live' ? 'live' : s === 'active' ? 'lane' : s === 'pool' || s === 'ignored' ? 'trial' : '';
      },
      onSubmit: (s) => {
        const file = itemOf(s.item)?.file;
        if (file) void logSession(app, sc.log!, cols, file, s);
      },
    });
  };

  /** Insert a game into lane `n` at queue position `position`. */
  const insert = (n: number, position: number): void =>
    openPickAny(app, {
      title: `Insert into lane ${laneName(n)}`,
      options: pickAnyOptions((i) => i.state !== 'active' && i.state !== 'live' && !result.lanes.some((l) => l.some((e) => e.item === i.id && e.pinned))),
      onPick: async (id) => {
        if (stateOf.get(id)?.state !== 'pool' && !(await role(id, 'pool'))) return;
        editSchedule((s) => void (s.pins = placePin(s.pins, id, n, position)));
      },
    });

  const entryMenu = (e: ReactMouseEvent, entry: LaneEntry, n: number, position: number): void => {
    const menu = new Menu();
    const id = entry.item;
    const item = itemOf(id);
    if (entry.current) {
      menu.addItem((i) => i.setTitle('Log play time…').setIcon('timer').onClick(() => openLog(id)));
      menu.addItem((i) => i.setTitle('Finish').setIcon('check-circle').onClick(() => void end(id, n, 'finished')));
      menu.addItem((i) => i.setTitle('Drop').setIcon('x-circle').onClick(() => void end(id, n, 'dropped')));
      if (sc.statuses.paused.length) menu.addItem((i) => i.setTitle('Put on hold').setIcon('pause-circle').onClick(() => void end(id, n, 'paused')));
    } else {
      const laneBusy = result.lanes[n].some((x) => x.current);
      menu.addItem((i) => i.setTitle(laneBusy ? 'Start now (as a side game)' : 'Start now').setIcon('play').onClick(() => void start(id, n)));
      if (position > 0) menu.addItem((i) => i.setTitle('Move up').setIcon('arrow-up').onClick(() => editSchedule((s) => void (s.pins = placePin(s.pins, id, n, position - 1)))));
      menu.addItem((i) => i.setTitle('Move down').setIcon('arrow-down').onClick(() => editSchedule((s) => void (s.pins = placePin(s.pins, id, n, position + 1)))));
      for (let other = 0; other < result.lanes.length; other++) {
        if (other === n) continue;
        menu.addItem((i) => i.setTitle(`Move to lane ${laneName(other)}`).setIcon('arrow-right-left').onClick(() => editSchedule((s) => void (s.pins = placePin(s.pins, id, other, 0)))));
      }
      if (!entry.pinned) menu.addItem((i) => i.setTitle('Pin here').setIcon('pin').onClick(() => editSchedule((s) => void (s.pins = placePin(s.pins, id, n, position)))));
      else menu.addItem((i) => i.setTitle('Unpin').setIcon('pin-off').onClick(() => editSchedule((s) => void (s.pins = unpin(s.pins, id)))));
      const pin = sc.pins.find((p) => p.item === id);
      menu.addItem((i) =>
        i.setTitle(pin?.notBefore ? `Not before ${pin.notBefore}…` : 'Not before…').setIcon('calendar-clock').onClick(() =>
          openDatePrompt(app, {
            title: `Don't start ${titleOf(id)} before`,
            desc: 'For a release date or a DLC: the game waits until then.',
            initial: pin?.notBefore,
            onSave: (date) => editSchedule((s) => void (s.pins = setNotBefore(s.pins, id, n, position, date))),
          }),
        ),
      );
      menu.addItem((i) => i.setTitle('Insert a game before this…').setIcon('list-plus').onClick(() => insert(n, position)));
      menu.addItem((i) => i.setTitle('Log a trial…').setIcon('timer').onClick(() => openLog(id)));
    }
    menu.addSeparator();
    if (item) menu.addItem((i) => i.setTitle('Open note').setIcon('file-text').onClick(() => actions.editItem(item)));
    menu.showAtMouseEvent(e.nativeEvent);
  };

  // --- Drag a queued game to another place (it becomes a pin there) ---------

  const sensors = useDragSensors();
  const [dragging, setDragging] = useState<string | null>(null);
  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    setDragging(null);
    const target = over?.data.current as { lane: number; position: number } | undefined;
    if (!target) return;
    const id = String(active.id);
    const from = active.data.current as { lane: number; position: number };
    // Dropping below yourself in the same lane: the slot after you is your own place.
    const position = from.lane === target.lane && target.position > from.position ? target.position - 1 : target.position;
    if (from.lane === target.lane && position === from.position) return;
    editSchedule((s) => void (s.pins = placePin(s.pins, id, target.lane, position)));
  };

  const freeLanes = result.lanes.map((l, n) => (l.some((e) => e.current) ? -1 : n)).filter((n) => n >= 0);

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

      <WeekPanel result={result} itemOf={itemOf} unresolved={unresolved} onLog={log.status === 'ok' ? () => openLog() : undefined} />

      {result.live.length > 0 && (
        <section className="rb-schedule-live">
          <h4>
            <Icon name="radio" /> Live
          </h4>
          <div className="rb-schedule-live-items">
            {result.live.map((l) => {
              const item = itemOf(l.item);
              const liveMenu = (ev: ReactMouseEvent): void => {
                ev.preventDefault();
                const menu = new Menu();
                if (log.status === 'ok') menu.addItem((i) => i.setTitle('Log play time…').setIcon('timer').onClick(() => openLog(l.item)));
                if (sc.statuses.paused.length) menu.addItem((i) => i.setTitle('Put on hold').setIcon('pause-circle').onClick(() => void end(l.item, -1, 'paused')));
                menu.addItem((i) => i.setTitle('Finish').setIcon('check-circle').onClick(() => void end(l.item, -1, 'finished')));
                menu.addItem((i) => i.setTitle('Drop').setIcon('x-circle').onClick(() => void end(l.item, -1, 'dropped')));
                if (item) {
                  menu.addSeparator();
                  menu.addItem((i) => i.setTitle('Open note').setIcon('file-text').onClick(() => actions.editItem(item)));
                }
                menu.showAtMouseEvent(ev.nativeEvent);
              };
              return (
                <span key={l.item} className="rb-schedule-chip" onContextMenu={liveMenu} title="Right-click for options">
                  {item ? <TitleLink item={item} /> : l.item}
                  <span className="rb-schedule-muted">~{formatHours(l.weekly)}/wk</span>
                  {log.status === 'ok' && <IconButton icon="timer" label={`Log time for ${titleOf(l.item)}`} onClick={() => openLog(l.item)} />}
                </span>
              );
            })}
          </div>
        </section>
      )}

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={(e) => setDragging(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="rb-schedule-lanes" style={{ gridTemplateColumns: `repeat(${result.lanes.length}, minmax(0, 1fr))` }}>
          {result.lanes.map((lane, n) => {
            const queued = lane.filter((e) => !e.current);
            return (
              <section key={n} className="rb-schedule-lane" data-lane={n}>
                <div className="rb-schedule-lane-head">
                  <h4>Lane {laneName(n)}</h4>
                  {movedPins(sc.pins, n) > 0 && (
                    <IconButton icon="refresh-cw" label={`Re-plan lane ${laneName(n)}`} onClick={() => editSchedule((s) => void (s.pins = replan(s.pins, n)))} />
                  )}
                  <IconButton icon="list-plus" label={`Insert a game into lane ${laneName(n)}`} onClick={() => insert(n, queued.length)} />
                </div>
                {freeLanes.includes(n) && (
                  <button className="rb-schedule-free" onClick={() => askNext(n, null)}>
                    <Icon name="play" /> Nothing playing here — pick what's next
                  </button>
                )}
                {lane.length === 0 && <div className="rb-schedule-muted">Nothing planned.</div>}
                {lane.map((e) => {
                  const position = queued.indexOf(e);
                  const body = (
                    <Entry
                      entry={e}
                      item={itemOf(e.item)}
                      cover={coverOf(itemOf(e.item))}
                      year={year}
                      onMenu={(ev) => entryMenu(ev, e, n, position)}
                      actions={
                        e.current ? (
                          <>
                            {log.status === 'ok' && <IconButton icon="timer" label={`Log time for ${titleOf(e.item)}`} onClick={() => openLog(e.item)} />}
                            <IconButton icon="check-circle" label={`Finish ${titleOf(e.item)}`} onClick={() => void end(e.item, n, 'finished')} />
                          </>
                        ) : null
                      }
                    />
                  );
                  return e.current ? (
                    <div key={e.item}>{body}</div>
                  ) : (
                    <DraggableEntry key={e.item} id={e.item} lane={n} position={position}>
                      {body}
                    </DraggableEntry>
                  );
                })}
                {queued.length > 0 && <DropSlot lane={n} position={queued.length} />}
              </section>
            );
          })}
        </div>
        <DragOverlay>{dragging ? <div className="rb-schedule-entry rb-schedule-drag">{titleOf(dragging)}</div> : null}</DragOverlay>
      </DndContext>

      {result.overflow.length > 0 && (
        <section className="rb-schedule-side">
          <h4>Also playing</h4>
          <div className="rb-schedule-live-items">
            {result.overflow.map((id) => {
              const item = itemOf(id);
              const sideMenu = (ev: ReactMouseEvent): void => {
                ev.preventDefault();
                const menu = new Menu();
                for (const n of freeLanes) {
                  menu.addItem((i) => i.setTitle(`Move into lane ${laneName(n)}`).setIcon('arrow-right-left').onClick(() => editSchedule((s) => void (s.assign = { ...s.assign, [id]: n }))));
                }
                if (log.status === 'ok') menu.addItem((i) => i.setTitle('Log play time…').setIcon('timer').onClick(() => openLog(id)));
                if (sc.statuses.paused.length) menu.addItem((i) => i.setTitle('Put on hold').setIcon('pause-circle').onClick(() => void end(id, -1, 'paused')));
                menu.addItem((i) => i.setTitle('Finish').setIcon('check-circle').onClick(() => void end(id, -1, 'finished')));
                menu.addItem((i) => i.setTitle('Drop').setIcon('x-circle').onClick(() => void end(id, -1, 'dropped')));
                if (item) {
                  menu.addSeparator();
                  menu.addItem((i) => i.setTitle('Open note').setIcon('file-text').onClick(() => actions.editItem(item)));
                }
                menu.showAtMouseEvent(ev.nativeEvent);
              };
              return (
                <span key={id} className="rb-schedule-chip" onContextMenu={sideMenu} title="Right-click for options">
                  {item ? <TitleLink item={item} /> : id}
                  {log.status === 'ok' && <IconButton icon="timer" label={`Log time for ${titleOf(id)}`} onClick={() => openLog(id)} />}
                  <IconButton icon="check-circle" label={`Finish ${titleOf(id)}`} onClick={() => void end(id, -1, 'finished')} />
                </span>
              );
            })}
          </div>
        </section>
      )}

      {movedPins(sc.pins) > 0 && (
        <div className="rb-schedule-replan">
          <span className="rb-schedule-muted">
            {movedPins(sc.pins)} game{movedPins(sc.pins) === 1 ? '' : 's'} placed by hand
            {sc.pins.some((p) => p.notBefore) && ' · "not before" dates are kept'}
          </span>
          <button onClick={() => editSchedule((s) => void (s.pins = replan(s.pins)))}>
            <Icon name="refresh-cw" /> Re-plan all lanes
          </button>
        </div>
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

function stateLabel(i: ScheduleItem): string {
  return i.state === 'active' ? 'playing' : i.state === 'live' ? 'live' : i.state === 'pool' ? 'planned' : i.state === 'ended' ? 'ended' : '';
}

function propertyLabelOf(config: DatabaseConfig, name: string): string {
  const p = config.properties.find((q) => q.name === name);
  return p ? propertyLabel(p).toLowerCase() : name;
}

function IconButton({ icon, label, onClick }: { icon: string; label: string; onClick: (e: ReactMouseEvent) => void }) {
  return (
    <button
      className="clickable-icon rb-schedule-icon-btn"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      <Icon name={icon} />
    </button>
  );
}

function DraggableEntry({ id, lane, position, children }: { id: string; lane: number; position: number; children: ReactNode }) {
  const drag = useDraggable({ id, data: { lane, position } });
  const drop = useDroppable({ id: `slot:${id}`, data: { lane, position } });
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      className={['rb-schedule-draggable', drag.isDragging ? 'is-dragging' : '', drop.isOver && !drag.isDragging ? 'is-over' : ''].filter(Boolean).join(' ')}
      {...drag.attributes}
      {...drag.listeners}
    >
      {children}
    </div>
  );
}

function DropSlot({ lane, position }: { lane: number; position: number }) {
  const drop = useDroppable({ id: `end:${lane}`, data: { lane, position } });
  return <div ref={drop.setNodeRef} className={drop.isOver ? 'rb-schedule-slot is-over' : 'rb-schedule-slot'} />;
}

function WeekPanel({ result, itemOf, unresolved, onLog }: { result: Forecast; itemOf: (id: string) => BoardItem | undefined; unresolved: number; onLog?: () => void }) {
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
        {onLog && (
          <button className="mod-cta rb-schedule-log" onClick={onLog}>
            <Icon name="timer" /> Log time
          </button>
        )}
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

function Entry({
  entry: e,
  item,
  cover,
  year,
  onMenu,
  actions,
}: {
  entry: LaneEntry;
  item: BoardItem | undefined;
  cover: string | null;
  year: number;
  onMenu: (e: ReactMouseEvent) => void;
  actions: ReactNode;
}) {
  const cls = ['rb-schedule-entry', e.current ? 'is-current' : '', e.paused ? 'is-paused' : ''].filter(Boolean).join(' ');
  return (
    // Right-click (or a long-press on touch screens, which fires contextmenu too) opens the menu.
    <div className={cls} data-item={e.item} title={e.current ? 'Right-click for options' : 'Right-click for options · drag to move'} onContextMenu={(ev) => (ev.preventDefault(), onMenu(ev))}>
      {cover ? <img className="rb-schedule-cover" src={cover} alt="" loading="lazy" draggable={false} /> : <div className="rb-schedule-cover rb-schedule-cover-empty" />}
      <div className="rb-schedule-entry-body">
        <div className="rb-schedule-entry-title">
          {item ? <TitleLink item={item} /> : e.item}
          {e.pinned && <Icon name="pin" className="rb-schedule-flag" />}
          {e.paused && <span className="rb-schedule-tag" title="No lane time for a while: keep going, put it on hold, or drop it">paused?</span>}
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
      {actions && <div className="rb-schedule-entry-actions">{actions}</div>}
    </div>
  );
}
