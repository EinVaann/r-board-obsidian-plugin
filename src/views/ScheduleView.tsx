import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Menu, Platform } from 'obsidian';
import { DndContext, DragOverlay, closestCenter, pointerWithin, useDraggable, useDroppable, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import type { BoardItem, DatabaseConfig, ScheduleConfig, ViewConfig } from '../types';
import { propertyLabel } from '../config';
import { applyFilter } from '../data/filter';
import { resolveImageSrc } from '../render/values';
import { useBoard, useBoardContext } from '../board/context';
import { TitleLink } from '../components/Card';
import { useDragSensors } from '../components/dnd';
import { useElementWidth } from '../components/layout';
import { Icon } from '../react/Icon';
import { defaultScheduleConfig, engineSettings, guessLogColumns, guessSchedule } from '../schedule/config';
import { localDate } from '../schedule/dates';
import { forecast } from '../schedule/engine';
import { formatHours, formatRange, formatShortRange } from '../schedule/format';
import { toScheduleItems, toSessions } from '../schedule/inputs';
import { nextCandidates } from '../schedule/next';
import { movedPins, placePin, replan, setNotBefore, unpin } from '../schedule/pins';
import { randomCandidate } from '../schedule/rules';
import { logSession, setRole, type Role } from '../schedule/actions';
import type { Forecast, LaneEntry, ScheduleItem, Session, Suggestion } from '../schedule/types';
import { useLinkedTable } from '../schedule/useLinkedTable';
import { openDatePrompt, openLogSession, openMovePrompt, openNextPick, openPickAny, type Candidate, type GameOption, type MoveLane } from './ScheduleModals';

const LANE_NAMES = 'ABCDEF';
/** Below this width the schedule shows one lane at a time and shorter entries. */
const COMPACT_WIDTH = 620;
/** Touch screens: no drag (it fights scrolling and the long-press menu); the menu moves items instead. */
const canDrag = (): boolean => !Platform.isMobile;
const NO_SENSORS: never[] = [];

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
      if (entry.reasons.length) menu.addItem((i) => i.setTitle(`Why here: ${entry.reasons.join(' · ')}`).setIcon('info').setDisabled(true));
    } else {
      if (entry.reasons.length) {
        menu.addItem((i) => i.setTitle(`Ranked lower: ${entry.reasons.join(' · ')}`).setIcon('info').setDisabled(true));
        menu.addSeparator();
      }
      const laneBusy = result.lanes[n].some((x) => x.current);
      const move = (lane: number, to: number): void => editSchedule((s) => void (s.pins = placePin(s.pins, id, lane, to)));
      const queuedIn = (lane: number): number => result.lanes[lane].filter((x) => !x.current).length;
      menu.addItem((i) => i.setTitle(laneBusy ? 'Start now (as a side game)' : 'Start now').setIcon('play').onClick(() => void start(id, n)));
      if (position > 0) menu.addItem((i) => i.setTitle('Move up').setIcon('arrow-up').onClick(() => move(n, position - 1)));
      if (position < queuedIn(n) - 1) menu.addItem((i) => i.setTitle('Move down').setIcon('arrow-down').onClick(() => move(n, position + 1)));
      // Every place the game can go, per lane: its own place is left out; elsewhere it adds one slot.
      const moveLanes: MoveLane[] = result.lanes.map((l, lane) => {
        const queued = l.filter((x) => !x.current);
        const count = queued.length + (lane === n ? 0 : 1);
        const slots: MoveLane['slots'] = [];
        for (let to = 0; to < count; to++) {
          if (lane === n && to === position) continue;
          const after = queued[lane === n && to > position ? to : to - 1];
          slots.push({ to, label: to === 0 ? 'Next' : after ? `After ${titleOf(after.item)}` : 'Last' });
        }
        return { name: laneName(lane), detail: `${queued.length} queued`, slots };
      });
      const openMove = (lane: number): void =>
        openMovePrompt(app, { title: `Move ${titleOf(id)}`, lanes: moveLanes, lane, onPick: (to, at) => move(to, at) });
      for (let lane = 0; lane < result.lanes.length; lane++) {
        if (lane === n && moveLanes[n].slots.length === 0) continue;
        menu.addItem((i) =>
          i
            .setTitle(lane === n ? 'Move to position…' : `Move to lane ${laneName(lane)}…`)
            .setIcon(lane === n ? 'list-ordered' : 'arrow-right-left')
            .onClick(() => openMove(lane)),
        );
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

  // Narrow (phones, side panes): one lane at a time behind tabs, single-line entries, no drag.
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const compact = Platform.isPhone || (width > 0 && width < COMPACT_WIDTH);
  const drag = canDrag() && !compact;
  const [shownLane, setShownLane] = useState(0);
  const laneShown = Math.min(shownLane, result.lanes.length - 1);

  // Collapsed sections are saved with the view, like collapsed groups elsewhere.
  const collapsed = useMemo(() => new Set(view.collapsed ?? []), [view.collapsed]);
  const toggleSection = (id: string): void =>
    updateView(viewIndex, (v) => {
      const next = new Set(v.collapsed ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      v.collapsed = next.size ? [...next] : undefined;
    });

  /** Right-click / long-press menu of a live or side game. */
  const chipMenu = (ev: ReactMouseEvent, id: string, side: boolean): void => {
    ev.preventDefault();
    const item = itemOf(id);
    const menu = new Menu();
    if (side) {
      for (const n of freeLanes) {
        menu.addItem((i) => i.setTitle(`Move into lane ${laneName(n)}`).setIcon('arrow-right-left').onClick(() => editSchedule((s) => void (s.assign = { ...s.assign, [id]: n }))));
      }
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
    <div ref={rootRef} className={compact ? 'rb-schedule is-compact' : 'rb-schedule'}>
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

      <WeekPanel result={result} itemOf={itemOf} unresolved={unresolved} compact={compact} onLog={log.status === 'ok' ? () => openLog() : undefined} />

      {result.live.length > 0 && (
        <Section id="live" title="Live" icon="radio" count={result.live.length} className="rb-schedule-live" collapsed={collapsed} onToggle={toggleSection}>
          <div className="rb-schedule-live-items">
            {result.live.map((l) => (
              <span key={l.item} className="rb-schedule-chip" onContextMenu={(ev) => chipMenu(ev, l.item, false)} title="Right-click for options">
                {itemOf(l.item) ? <TitleLink item={itemOf(l.item)!} /> : l.item}
                <span className="rb-schedule-muted">~{formatHours(l.weekly)}/wk</span>
                {log.status === 'ok' && !compact && <IconButton icon="timer" label={`Log time for ${titleOf(l.item)}`} onClick={() => openLog(l.item)} />}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section
        id="lanes"
        title="Lanes"
        icon="columns-2"
        className="rb-schedule-main"
        collapsed={collapsed}
        onToggle={toggleSection}
        hint={
          movedPins(sc.pins)
            ? `${movedPins(sc.pins)} placed by hand${sc.pins.some((p) => p.notBefore) ? ' · not-before dates are kept' : ''}`
            : drag
              ? 'Drag or right-click games to change the order'
              : 'Long-press a game to move it'
        }
        tools={
          <button className="rb-schedule-replan-btn" disabled={!movedPins(sc.pins)} onClick={() => editSchedule((s) => void (s.pins = replan(s.pins)))}>
            <Icon name="refresh-cw" /> Re-plan all
          </button>
        }
      >
      <DndContext sensors={drag ? sensors : NO_SENSORS} collisionDetection={collision} onDragStart={(e) => setDragging(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        {compact && result.lanes.length > 1 && (
          <div className="rb-schedule-lane-tabs" role="tablist">
            {result.lanes.map((lane, n) => {
              const cur = lane.find((e) => e.current);
              return (
                <button key={n} role="tab" aria-selected={n === laneShown} className={n === laneShown ? 'is-active' : ''} onClick={() => setShownLane(n)}>
                  <span className="rb-schedule-lane-tab-name">Lane {laneName(n)}</span>
                  <span className="rb-schedule-lane-tab-now">{cur ? titleOf(cur.item) : 'free'}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="rb-schedule-lanes" style={{ gridTemplateColumns: compact ? '1fr' : `repeat(${result.lanes.length}, minmax(0, 1fr))` }}>
          {result.lanes.map((lane, n) => {
            const queued = lane.filter((e) => !e.current);
            if (compact && n !== laneShown) return null;
            return (
              <section key={n} className="rb-schedule-lane" data-lane={n}>
                <div className="rb-schedule-lane-head">
                  <h4>Lane {laneName(n)}</h4>
                  <IconButton
                    icon="refresh-cw"
                    label={movedPins(sc.pins, n) ? `Re-plan lane ${laneName(n)}` : `Lane ${laneName(n)} is in its automatic order`}
                    disabled={!movedPins(sc.pins, n)}
                    onClick={() => editSchedule((s) => void (s.pins = replan(s.pins, n)))}
                  />
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
                      compact={compact}
                      index={e.current ? undefined : position + 1}
                      onMenu={(ev) => entryMenu(ev, e, n, position)}
                      actions={
                        e.current ? (
                          <>
                            {log.status === 'ok' && <IconButton icon="timer" label={`Log time for ${titleOf(e.item)}`} onClick={() => openLog(e.item)} />}
                            {!compact && <IconButton icon="check-circle" label={`Finish ${titleOf(e.item)}`} onClick={() => void end(e.item, n, 'finished')} />}
                          </>
                        ) : null
                      }
                    />
                  );
                  return e.current ? (
                    <div key={e.item}>{body}</div>
                  ) : (
                    <DraggableEntry key={e.item} id={e.item} lane={n} position={position} enabled={drag}>
                      {body}
                    </DraggableEntry>
                  );
                })}
                {queued.length > 0 && drag && <DropSlot lane={n} position={queued.length} />}
              </section>
            );
          })}
        </div>
        <DragPreview>
          {(() => {
            const lane = dragging ? result.lanes.find((l) => l.some((e) => e.item === dragging)) : undefined;
            const e = lane?.find((x) => x.item === dragging);
            if (!lane || !e) return null;
            const item = itemOf(e.item);
            const index = lane.filter((x) => !x.current).indexOf(e) + 1;
            return <Entry entry={e} item={item} cover={coverOf(item)} year={year} compact={false} index={index} onMenu={() => undefined} actions={null} />;
          })()}
        </DragPreview>
      </DndContext>
      </Section>

      {result.overflow.length > 0 && (
        <Section id="side" title="Also playing" icon="gamepad-2" count={result.overflow.length} className="rb-schedule-side" collapsed={collapsed} onToggle={toggleSection}>
          <div className="rb-schedule-live-items">
            {result.overflow.map((id) => (
              <span key={id} className="rb-schedule-chip" onContextMenu={(ev) => chipMenu(ev, id, true)} title="Right-click for options">
                {itemOf(id) ? <TitleLink item={itemOf(id)!} /> : id}
                {log.status === 'ok' && !compact && <IconButton icon="timer" label={`Log time for ${titleOf(id)}`} onClick={() => openLog(id)} />}
                {!compact && <IconButton icon="check-circle" label={`Finish ${titleOf(id)}`} onClick={() => void end(id, -1, 'finished')} />}
              </span>
            ))}
          </div>
        </Section>
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

function IconButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: (e: ReactMouseEvent) => void; disabled?: boolean }) {
  return (
    <button
      className="clickable-icon rb-schedule-icon-btn"
      aria-label={label}
      title={label}
      disabled={disabled}
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

/** A collapsible block with a header (title, count, hint, tools); the open state is saved with the view. */
function Section({
  id,
  title,
  icon,
  count,
  hint,
  tools,
  className,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: string;
  count?: number;
  hint?: string;
  tools?: ReactNode;
  className?: string;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  const closed = collapsed.has(id);
  const toggle = (): void => onToggle(id);
  return (
    <section className={['rb-schedule-section', className, closed ? 'is-collapsed' : ''].filter(Boolean).join(' ')} data-section={id} data-icon={icon}>
      {/* The whole row toggles; the tools on the right don't. */}
      <div className="rb-schedule-section-head" onClick={toggle}>
        <div
          className="rb-schedule-section-toggle"
          role="button"
          tabIndex={0}
          aria-expanded={!closed}
          aria-label={title}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle())}
        >
          <Icon name="chevron-right" className="rb-schedule-section-caret" />
          <span className="rb-schedule-section-title">{title}</span>
          {count !== undefined && <span className="rb-schedule-section-count">{count}</span>}
        </div>
        {hint && !closed && <span className="rb-schedule-section-hint">{hint}</span>}
        {tools && !closed && (
          <div className="rb-schedule-section-tools" onClick={(e) => e.stopPropagation()}>
            {tools}
          </div>
        )}
      </div>
      {!closed && <div className="rb-schedule-section-body">{children}</div>}
    </section>
  );
}

/**
 * The entry following the pointer while dragging, styled like the kanban's
 * card ghost. Portaled out of the scroll area: inside it, the fixed-position
 * overlay is placed against the pane rather than the window and lands off to
 * the side of the pointer.
 */
function DragPreview({ children }: { children: ReactNode }) {
  const { scrollRef } = useBoardContext();
  const doc = scrollRef.current?.ownerDocument ?? document;
  return createPortal(
    <DragOverlay dropAnimation={null}>{children ? <div className="rb-drag-ghost rb-schedule-ghost">{children}</div> : null}</DragOverlay>,
    doc.body,
  );
}

function DraggableEntry({ id, lane, position, enabled, children }: { id: string; lane: number; position: number; enabled: boolean; children: ReactNode }) {
  const drag = useDraggable({ id, data: { lane, position }, disabled: !enabled });
  const drop = useDroppable({ id: `slot:${id}`, data: { lane, position }, disabled: !enabled });
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      className={['rb-schedule-draggable', enabled ? 'can-drag' : '', drag.isDragging ? 'is-dragging' : '', drop.isOver && !drag.isDragging ? 'is-over' : ''].filter(Boolean).join(' ')}
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

function WeekPanel({
  result,
  itemOf,
  unresolved,
  compact,
  onLog,
}: {
  result: Forecast;
  itemOf: (id: string) => BoardItem | undefined;
  unresolved: number;
  compact: boolean;
  onLog?: () => void;
}) {
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
      {!compact && (
        <div className="rb-schedule-week-types rb-schedule-muted">
          Lanes {formatHours(week.logged.lane)} · Live {formatHours(week.logged.live)} · Other {formatHours(week.logged.detour + week.logged.trial)}
          {' · '}lane pace ~{formatHours(pace.lane)}/wk
        </div>
      )}
      {!compact && week.suggested.length > 0 && (
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
  compact,
  index,
  onMenu,
  actions,
}: {
  entry: LaneEntry;
  item: BoardItem | undefined;
  cover: string | null;
  year: number;
  compact: boolean;
  /** Queue number (1 = next); absent for the running item. */
  index?: number;
  onMenu: (e: ReactMouseEvent) => void;
  actions: ReactNode;
}) {
  const cls = ['rb-schedule-entry', e.current ? 'is-current' : '', e.paused ? 'is-paused' : ''].filter(Boolean).join(' ');
  const badge = (
    <span className={index === undefined ? 'rb-schedule-index is-now' : 'rb-schedule-index'} aria-label={index === undefined ? 'Playing now' : `Number ${index} in this lane`}>
      {index === undefined ? <Icon name="play" /> : index}
    </span>
  );
  if (compact) {
    // One title line, one detail line: hours and the done range in short form.
    const done = formatShortRange(e.end, year);
    return (
      <div className={cls} data-item={e.item} onContextMenu={(ev) => (ev.preventDefault(), onMenu(ev))}>
        {badge}
        {cover ? <img className="rb-schedule-cover" src={cover} alt="" loading="lazy" draggable={false} /> : <div className="rb-schedule-cover rb-schedule-cover-empty" />}
        <div className="rb-schedule-entry-body">
          <div className="rb-schedule-entry-title">
            {item ? <TitleLink item={item} /> : e.item}
            {e.pinned && <Icon name="pin" className="rb-schedule-flag" />}
          </div>
          <div className="rb-schedule-muted rb-schedule-entry-line">
            {e.current ? `${formatHours(e.remaining)} left · done ${done}` : `${formatHours(e.remaining)} · done ${done}`}
            {e.paused && ' · paused?'}
            {e.penalty > 0 && (
              <span className="rb-schedule-reasons-flag" title={e.reasons.join(' · ')}>
                {' · '}
                <Icon name="alert-triangle" />
              </span>
            )}
          </div>
        </div>
        {actions && <div className="rb-schedule-entry-actions">{actions}</div>}
      </div>
    );
  }
  return (
    // Right-click (or a long-press on touch screens, which fires contextmenu too) opens the menu.
    <div className={cls} data-item={e.item} title={e.current ? 'Right-click for options' : 'Right-click for options · drag to move'} onContextMenu={(ev) => (ev.preventDefault(), onMenu(ev))}>
      {badge}
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
            <Icon name="alert-triangle" />
            <span>{e.reasons.join(' · ')}</span>
          </div>
        )}
      </div>
      {actions && <div className="rb-schedule-entry-actions">{actions}</div>}
    </div>
  );
}
