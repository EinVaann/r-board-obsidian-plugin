import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Menu, Platform } from 'obsidian';
import { DndContext, DragOverlay, closestCenter, pointerWithin, useDraggable, useDroppable, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import type { BoardItem, DatabaseConfig, ScheduleConfig, ViewConfig } from '../types';
import { propertyLabel } from '../config';
import { resolveImageSrc } from '../render/values';
import { useBoard, useBoardContext } from '../board/context';
import { TitleLink } from '../components/Card';
import { useDragSensors } from '../components/dnd';
import { useElementWidth } from '../components/layout';
import { Icon } from '../react/Icon';
import { defaultScheduleConfig, engineSettings, guessLogColumns, guessSchedule } from '../schedule/config';
import { fromDay, localDate, toDay } from '../schedule/dates';
import { forecast } from '../schedule/engine';
import { formatHours, formatRange, formatShortRange } from '../schedule/format';
import { toScheduleItems, toSessions } from '../schedule/inputs';
import { nextCandidates } from '../schedule/next';
import { movedPins, placePin, placeQueued, replan, togglePin, unpin } from '../schedule/pins';
import { randomCandidate } from '../schedule/rules';
import { logSession, moveToSection } from '../schedule/actions';
import { addSideSection, matchSection, moveWrites, sectionProblems } from '../schedule/sections';
import type { Forecast, LaneEntry, ScheduleItem, Session, Suggestion } from '../schedule/types';
import { useLinkedTable } from '../schedule/useLinkedTable';
import { showMenu } from '../ui/menu';
import {
  openLogSession,
  openMoveModal,
  openNextPick,
  openPickAny,
  type Candidate,
  type GameOption,
  type MoveChoice,
  type MoveFrom,
  type MoveLane,
  type MoveSection,
  NEW_SIDE,
} from './ScheduleModals';

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
  const updateConfig = useBoard((s) => s.updateConfig);
  const sc: ScheduleConfig = useMemo(() => guessSchedule(config, view.schedule ?? defaultScheduleConfig()), [config, view.schedule]);
  const log = useLinkedTable(app, sc.log);
  // No filter: sections decide what the schedule shows.
  const items = all;
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
  const sections = sc.sections ?? [];
  const problems = useMemo(() => sectionProblems(config, sections), [config, sections]);
  const missing = [!sc.duration && 'duration'].filter(Boolean) as string[];
  const unresolved = sessions.filter((s) => !s.item).length;
  const itemOf = (id: string): BoardItem | undefined => byId.get(id);
  const titleOf = (id: string): string => itemOf(id)?.title ?? id;
  const coverOf = (item: BoardItem | undefined): string | null => (item && cover && item.file ? resolveImageSrc(app, item.file, item.values[cover.name]) : null);

  // --- Writing back --------------------------------------------------------

  /** Which lane each running item is in now, so a change elsewhere doesn't reshuffle them. */
  const currentAssign = (): Record<string, number> => {
    const out: Record<string, number> = {};
    result.lanes.forEach((l, n) => {
      const cur = l.find((e) => e.current);
      if (cur) out[cur.item] = n;
    });
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

  const hoursDetail = (id: string): string | undefined => {
    const d = stateOf.get(id)?.duration;
    return d ? formatHours(d) : undefined;
  };

  const lanesSection = sections.findIndex((s) => s.kind === 'lanes');
  const sectionOf = (id: string): number => {
    const item = itemOf(id);
    return item ? matchSection(item.values, sections) : -1;
  };

  /**
   * Put `id` where a Move choice says: write the properties that select the
   * section, then place it in the plan (queue pin / hold, or lane number).
   */
  const move = async (id: string, c: MoveChoice): Promise<void> => {
    const item = itemOf(id);
    if (!item) return;
    if (c.section === NEW_SIDE) {
      const added = addSideSection(config, sections);
      if (!added) return;
      const { property } = added;
      const withProp = property ? { ...config, properties: [...config.properties, property] } : config;
      if (!(await moveToSection(withProp, added.sections, item, added.index, actions.setValue))) return;
      if (property) updateConfig((d) => void d.properties.push(property));
      editSchedule((s) => {
        s.sections = added.sections;
        s.pins = unpin(s.pins, id);
        if (s.assign) delete s.assign[id];
      });
      return;
    }
    if (c.section < 0) return;
    if (c.section !== sectionOf(id) && !(await moveToSection(config, sections, item, c.section, actions.setValue))) return;
    const kind = sections[c.section].kind;
    // Placing into a busy lane would bump its game; the item waits for a free lane instead.
    const busy = c.lane !== null && result.lanes[c.lane]?.some((e) => e.current && e.item !== id);
    editSchedule((s) => {
      const old = s.pins.find((p) => p.item === id && p.lane >= 0);
      if (kind === 'queue') s.pins = placeQueued(s.pins, id, c.lane, c.position, c.notBefore);
      else s.pins = unpin(s.pins, id).map((p) => (old && p.lane === old.lane && p.position > old.position ? { ...p, position: p.position - 1 } : p));
      const assign = { ...s.assign };
      delete assign[id];
      if (kind === 'lanes' && c.lane !== null && !busy) assign[id] = c.lane;
      s.assign = assign;
    });
  };

  /** Start `id` in lane `n` (from the next-pick prompt). */
  const start = (id: string, n: number): Promise<void> => move(id, { section: lanesSection, lane: n, position: null, notBefore: null });

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
      onPick: (id) => void start(id, n),
      onChooseAny: () =>
        openPickAny(app, {
          title: `Start in lane ${laneName(n)}`,
          options: pickAnyOptions((i) => !RUNNING.has(i.state) && i.id !== previous),
          onPick: (id) => void start(id, n),
        }),
    });
  };

  const openLog = (initial?: string): void => {
    if (!sc.log || !cols || log.status !== 'ok') {
      actions.openViewSettings(viewIndex);
      return;
    }
    const playing = scheduleItems.filter((i) => RUNNING.has(i.state));
    const rest = scheduleItems.filter((i) => !RUNNING.has(i.state)).sort((a, b) => a.title.localeCompare(b.title));
    const games: GameOption[] = [...playing, ...rest].map((i) => ({
      id: i.id,
      title: i.title,
      detail: stateLabel(i),
      running: RUNNING.has(i.state),
      cover: coverOf(itemOf(i.id)),
    }));
    openLogSession(app, {
      games,
      initial,
      today,
      withType: !!cols.logType,
      typeFor: (id) => {
        const s = stateOf.get(id)?.state;
        return s === 'live' ? 'live' : s === 'active' ? 'lane' : s === 'side' ? 'detour' : s === 'pool' || s === 'ignored' ? 'trial' : '';
      },
      onSubmit: (s) => {
        const file = itemOf(s.item)?.file;
        if (file) void logSession(app, sc.log!, cols, file, s);
      },
    });
  };

  /** Where `id` is in the plan now: its section, and for lane / queue items the lane and queue position. */
  const whereIs = (id: string): MoveFrom => {
    const section = sectionOf(id);
    const pin = sc.pins.find((p) => p.item === id);
    for (const [n, lane] of result.lanes.entries()) {
      const e = lane.find((x) => x.item === id);
      if (!e) continue;
      if (e.current) return { section, lane: n };
      return { section, lane: n, position: lane.filter((x) => !x.current).indexOf(e), pinned: e.pinned, notBefore: pin?.notBefore };
    }
    return { section, notBefore: pin?.notBefore };
  };

  /** The Move modal for `id`: section, then lane and place, then not-before; or an End section. */
  const openMove = (id: string): void => {
    const item = itemOf(id);
    if (!item) return;
    const from = whereIs(id);
    const moveSections: MoveSection[] = sections.map((s, index) => ({
      index,
      name: s.name,
      kind: s.kind,
      blocked: index === from.section || moveWrites(item.values, sections, index) ? undefined : 'A section above would still catch it',
    }));
    // Sections switched off (no conditions) can't be moved into.
    const usable = moveSections.filter((s) => sections[s.index].conditions.length > 0);
    // Also playing switched off: offer it anyway; picking it fills it in (and adds a "casual" checkbox).
    const newSide = addSideSection(config, sections);
    if (newSide) usable.splice(usable.findIndex((s) => s.kind === 'lanes'), 0, { index: NEW_SIDE, name: newSide.sections[newSide.index].name, kind: 'side' });
    const lanes: MoveLane[] = result.lanes.map((l, n) => {
      const cur = l.find((x) => x.current);
      return {
        name: laneName(n),
        running: cur ? titleOf(cur.item) : null,
        mine: cur?.item === id,
        queue: l.filter((x) => !x.current && x.item !== id).map((x) => titleOf(x.item)),
      };
    });
    /** What a move into a section writes, in words ("status → planned, casual off"). */
    const describe = (index: number): string => {
      const writes = (index === NEW_SIDE && newSide ? moveWrites(item.values, newSide.sections, newSide.index) : moveWrites(item.values, sections, index)) ?? {};
      return Object.entries(writes)
        .map(([name, v]) => {
          const label = config.properties.find((p) => p.name === name);
          const n = label ? propertyLabel(label) : name;
          return typeof v === 'boolean' ? `${n} ${v ? 'on' : 'off'}` : `${n} → ${v}`;
        })
        .join(', ');
    };
    openMoveModal(app, { title: `Move ${item.title}`, itemTitle: item.title, sections: usable, lanes, from, describe, onMove: (c) => void move(id, c) });
  };

  /** Right-click / long-press: the same short menu for every item. */
  const itemMenu = (ev: ReactMouseEvent, id: string): void => {
    ev.preventDefault();
    const item = itemOf(id);
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('Move…').setIcon('arrow-right-left').onClick(() => openMove(id)));
    if (log.status === 'ok') menu.addItem((i) => i.setTitle('Log play time…').setIcon('timer').onClick(() => openLog(id)));
    if (item) {
      menu.addSeparator();
      menu.addItem((i) => i.setTitle('Open note').setIcon('file-text').onClick(() => actions.editItem(item)));
    }
    showMenu(menu, ev.nativeEvent);
  };

  /** Double-click a queued entry: pin it where it is, or unpin it. */
  const onEntryDoubleClick = (ev: ReactMouseEvent, entry: LaneEntry, n: number, position: number): void => {
    if (entry.current || (ev.target as HTMLElement).closest('a, button')) return;
    ev.preventDefault();
    editSchedule((s) => void (s.pins = togglePin(s.pins, entry.item, n, position)));
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

  // Live and side cards, live first, each in section order.
  const liveWeekly = new Map(result.live.map((l) => [l.item, l.weekly]));
  const cards = [
    ...result.live.map((l) => ({ id: l.item, kind: 'live' as const })),
    ...result.side.map((id) => ({ id, kind: 'side' as const })),
  ].sort((a, b) => (a.kind === b.kind ? sectionOf(a.id) - sectionOf(b.id) : a.kind === 'live' ? -1 : 1));
  const sideCount = result.side.length;
  const groupTitle = [result.live.length && `${result.live.length} live`, sideCount && `${sideCount} ${sections.find((s) => s.kind === 'side')?.name.toLowerCase() ?? 'side'}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <div ref={rootRef} className={compact ? 'rb-schedule is-compact' : 'rb-schedule'}>
      {(missing.length > 0 || problems.length > 0 || log.status !== 'ok') && (
        <div className="rb-schedule-notice">
          <Icon name="info" />
          <div>
            {missing.length > 0 && <div>Choose the {missing.join(' and ')} property in the view's Schedule settings.</div>}
            {problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
            {log.status === 'none' && <div>No session log yet: dates use your starting estimates. Pick a log table in the Schedule settings.</div>}
            {log.status === 'error' && <div>{log.error}</div>}
          </div>
          <button onClick={() => actions.openViewSettings(viewIndex)}>Settings…</button>
        </div>
      )}

      <WeekPanel result={result} itemOf={itemOf} unresolved={unresolved} compact={compact} onLog={log.status === 'ok' ? () => openLog() : undefined} />

      {cards.length > 0 && (
        <Section id="live-side" title="Live & side" icon="radio" hint={groupTitle} className="rb-schedule-live-side" collapsed={collapsed} onToggle={toggleSection}>
          <div className="rb-schedule-cards">
            {cards.map((c) => {
              const item = itemOf(c.id);
              const section = sections[sectionOf(c.id)];
              const weekly = liveWeekly.get(c.id);
              const hours = hoursDetail(c.id);
              return (
                <div
                  key={c.id}
                  className={`rb-schedule-card is-${c.kind}`}
                  data-item={c.id}
                  title="Right-click for options"
                  onContextMenu={(ev) => itemMenu(ev, c.id)}
                >
                  {coverOf(item) ? <img className="rb-schedule-cover" src={coverOf(item)!} alt="" loading="lazy" draggable={false} /> : <div className="rb-schedule-cover rb-schedule-cover-empty" />}
                  <div className="rb-schedule-entry-body">
                    <div className="rb-schedule-entry-title">{item ? <TitleLink item={item} /> : c.id}</div>
                    <div className="rb-schedule-muted rb-schedule-card-line">
                      <span className="rb-schedule-kind">{section?.name ?? (c.kind === 'live' ? 'Live' : 'Side')}</span>
                      {(c.kind === 'live' && weekly !== undefined ? `~${formatHours(weekly)}/wk` : hours) && (
                        <span>· {c.kind === 'live' && weekly !== undefined ? `~${formatHours(weekly)}/wk` : hours}</span>
                      )}
                    </div>
                  </div>
                  {log.status === 'ok' && (
                    <div className="rb-schedule-entry-actions">
                      <IconButton icon="timer" label={`Log time for ${titleOf(c.id)}`} onClick={() => openLog(c.id)} />
                    </div>
                  )}
                </div>
              );
            })}
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
        {result.overflow.length > 0 && (
          <div className="rb-schedule-overflow">
            <span className="rb-schedule-muted">
              {result.overflow.length + result.lanes.filter((l) => l.some((e) => e.current)).length} playing, {result.lanes.length} lanes · waiting for a lane:
            </span>
            {result.overflow.map((id) => (
              <span key={id} className="rb-schedule-chip" data-item={id} onContextMenu={(ev) => itemMenu(ev, id)} title="Right-click for options">
                {itemOf(id) ? <TitleLink item={itemOf(id)!} /> : id}
              </span>
            ))}
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
                  <span className="rb-schedule-muted rb-schedule-lane-count">{queued.length} queued</span>
                  <IconButton
                    icon="refresh-cw"
                    label={movedPins(sc.pins, n) ? `Re-plan lane ${laneName(n)}` : `Lane ${laneName(n)} is in its automatic order`}
                    disabled={!movedPins(sc.pins, n)}
                    onClick={() => editSchedule((s) => void (s.pins = replan(s.pins, n)))}
                  />
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
                      onMenu={(ev) => itemMenu(ev, e.item)}
                      onDoubleClick={(ev) => onEntryDoubleClick(ev, e, n, position)}
                      actions={
                        e.current && log.status === 'ok' ? <IconButton icon="timer" label={`Log time for ${titleOf(e.item)}`} onClick={() => openLog(e.item)} /> : null
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

/** States that are running now (in a lane, live or on the side). */
const RUNNING = new Set<ScheduleItem['state']>(['active', 'live', 'side']);

function stateLabel(i: ScheduleItem): string {
  return i.state === 'active' ? 'playing' : i.state === 'live' ? 'live' : i.state === 'side' ? 'side' : i.state === 'pool' ? 'planned' : i.state === 'ended' ? 'ended' : '';
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
  // Day bars share one scale: the busiest day, or a typical day's share of the budget.
  const todayIndex = (toDay(result.today) ?? 0) - (toDay(week.start) ?? 0);
  const dayMax = Math.max(...week.days, week.budget / 7, 1);
  const dayNames = Array.from({ length: 7 }, (_, i) => new Date(`${fromDay((toDay(week.start) ?? 0) + i)}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' }));
  return (
    <section className="rb-schedule-week">
      <div className="rb-schedule-week-sum">
        <h4>This week</h4>
        <div className="rb-schedule-week-total">
          <b>{formatHours(logged)}</b> <span className="rb-schedule-muted">of ~{formatHours(week.budget)}</span>
        </div>
        {!compact && (
          <div className="rb-schedule-week-types rb-schedule-muted">
            <span>
              Lanes <b>{formatHours(week.logged.lane)}</b>
            </span>
            <span>
              Live <b>{formatHours(week.logged.live)}</b>
            </span>
            <span>
              Other <b>{formatHours(week.logged.detour + week.logged.trial)}</b>
            </span>
            <span>
              Pace <b>~{formatHours(pace.lane)}/wk</b>
            </span>
          </div>
        )}
      </div>
      {compact ? (
        <div className="rb-schedule-bar" role="progressbar" aria-valuenow={Math.round(share)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${share}%` }} />
        </div>
      ) : (
        <div className="rb-schedule-days" role="img" aria-label={`${formatHours(logged)} logged this week`}>
          {week.days.map((h, i) => (
            <div key={i} className={['rb-schedule-day', i === todayIndex ? 'is-today' : '', i > todayIndex ? 'is-future' : ''].filter(Boolean).join(' ')} title={`${dayNames[i]}: ${formatHours(h)}`}>
              <span className="rb-schedule-day-v">{h > 0 ? formatHours(h) : ''}</span>
              <span className="rb-schedule-day-bar">
                <i style={{ height: `${Math.min(100, (h / dayMax) * 100)}%` }} />
              </span>
              <span className="rb-schedule-day-name">{dayNames[i]}</span>
            </div>
          ))}
        </div>
      )}
      {onLog && (
        <button className="mod-cta rb-schedule-log" onClick={onLog}>
          <Icon name="timer" /> Log time
        </button>
      )}
      {!compact && week.suggested.length > 0 && (
        <ul className="rb-schedule-split rb-schedule-week-left">
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
  onDoubleClick,
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
  onDoubleClick?: (e: ReactMouseEvent) => void;
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
      <div className={cls} data-item={e.item} onContextMenu={(ev) => (ev.preventDefault(), onMenu(ev))} onDoubleClick={onDoubleClick}>
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
    <div
      className={cls}
      data-item={e.item}
      title={e.current ? 'Right-click for options' : `Right-click for options · drag to move · double-click to ${e.pinned ? 'unpin' : 'pin'}`}
      onContextMenu={(ev) => (ev.preventDefault(), onMenu(ev))}
      onDoubleClick={onDoubleClick}
    >
      {badge}
      {cover ? <img className="rb-schedule-cover" src={cover} alt="" loading="lazy" draggable={false} /> : <div className="rb-schedule-cover rb-schedule-cover-empty" />}
      <div className="rb-schedule-entry-body">
        <div className="rb-schedule-entry-title">
          {item ? <TitleLink item={item} /> : e.item}
          {e.pinned && <Icon name="pin" className="rb-schedule-flag" />}
          {e.paused && <span className="rb-schedule-tag" title="No lane time for a while: keep going, put it on hold, or drop it">paused?</span>}
          {e.overEstimate && <span className="rb-schedule-tag" title="Played past its estimate">past estimate</span>}
        </div>
        {e.current ? (
          <div className="rb-schedule-muted rb-schedule-entry-line">
            Done <b>{formatRange(e.end, year)}</b>
          </div>
        ) : (
          <div className="rb-schedule-muted rb-schedule-entry-line">
            Starts <b>{formatRange(e.start, year)}</b> · {formatHours(e.remaining)} · done <b>{formatRange(e.end, year)}</b>
          </div>
        )}
        {e.penalty > 0 && (
          <div className="rb-schedule-reasons" title={`Ranked ${e.penalty} lower`}>
            <Icon name="alert-triangle" />
            <span>{e.reasons.join(' · ')}</span>
          </div>
        )}
      </div>
      {/* Running: what's left, at the right edge, like the preview. */}
      {e.current && (
        <div className="rb-schedule-entry-state">
          <span>Playing</span>
          <b>{formatHours(e.remaining)} left</b>
        </div>
      )}
      {actions && <div className="rb-schedule-entry-actions">{actions}</div>}
    </div>
  );
}
