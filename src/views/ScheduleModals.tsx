import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { App } from 'obsidian';
import { ReactModal } from '../react/mount';
import { Icon } from '../react/Icon';
import type { SessionType } from '../schedule/types';
import type { SectionKind } from '../types';
import { isShown } from '../schedule/sections';

export interface GameOption {
  id: string;
  title: string;
  /** Shown after the title (e.g. "playing", "8 h"). */
  detail?: string;
  /** Running now (lane, live or side): shown as a chip in the log form. */
  running?: boolean;
  /** Cover image URL, for the chip. */
  cover?: string | null;
}

export interface LoggedSession {
  item: string;
  hours: number;
  date: string;
  type?: SessionType;
}

const TYPE_OPTIONS: { value: '' | SessionType; label: string }[] = [
  { value: '', label: 'Guess' },
  { value: 'lane', label: 'Lane' },
  { value: 'live', label: 'Live' },
  { value: 'detour', label: 'Detour' },
  { value: 'trial', label: 'Trial' },
];

/** Log one play session: game, hours, date, and (when the log has a type column) its type. */
export function openLogSession(
  app: App,
  opts: { games: GameOption[]; initial?: string; today: string; withType: boolean; typeFor: (item: string) => SessionType | ''; onSubmit: (s: LoggedSession) => void },
): void {
  new ReactModal(app, (modal) => <LogSessionForm {...opts} onDone={() => modal.close()} />, { title: 'Log play time', cls: 'rb-schedule-modal' }).open();
}

function LogSessionForm({
  games,
  initial,
  today,
  withType,
  typeFor,
  onSubmit,
  onDone,
}: {
  games: GameOption[];
  initial?: string;
  today: string;
  withType: boolean;
  typeFor: (item: string) => SessionType | '';
  onSubmit: (s: LoggedSession) => void;
  onDone: () => void;
}) {
  // Opened from the toolbar (no game given): nothing is picked yet.
  const [item, setItem] = useState(initial ?? '');
  const [hours, setHours] = useState('');
  const [date, setDate] = useState(today);
  const [type, setType] = useState<SessionType | ''>(initial ? typeFor(initial) : '');
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const hoursRef = useRef<HTMLInputElement>(null);
  const h = Number(hours);
  const valid = !!item && hours.trim() !== '' && Number.isFinite(h) && h > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const picked = games.find((g) => g.id === item);
  // Running games are chips; a game picked from the search joins them.
  const chips = games.filter((g) => g.running || g.id === item);
  const others = useMemo(() => {
    const s = q.trim().toLowerCase();
    return games.filter((g) => !g.running && (!s || g.title.toLowerCase().includes(s)));
  }, [games, q]);
  useEffect(() => {
    if (initial) hoursRef.current?.focus();
  }, [initial]);

  const pick = (id: string): void => {
    setItem(id);
    setType(typeFor(id));
    setSearching(false);
    setQ('');
    setTimeout(() => hoursRef.current?.focus(), 0);
  };
  const submit = (): void => {
    if (!valid) return;
    onSubmit({ item, hours: Math.round(h * 100) / 100 || h, date, ...(withType && type ? { type } : {}) });
    onDone();
  };
  const summary = !item ? 'Pick a game' : !valid ? 'How long did you play?' : `${Math.round(h * 100) / 100} h · ${picked?.title ?? ''}`;

  return (
    <form
      className="rb-log"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="rb-log-field">
        <span className="rb-log-label">Game</span>
        <div className="rb-log-games" role="radiogroup" aria-label="Game">
          {chips.map((g) => (
            <button key={g.id} type="button" role="radio" aria-checked={g.id === item} className="rb-log-game" onClick={() => pick(g.id)}>
              {g.cover ? <img className="rb-log-game-cover" src={g.cover} alt="" /> : <span className="rb-log-game-cover" />}
              {g.title}
            </button>
          ))}
          <button type="button" className={searching ? 'rb-log-game rb-log-other is-open' : 'rb-log-game rb-log-other'} aria-expanded={searching} onClick={() => setSearching((s) => !s)}>
            Other…
          </button>
        </div>
        {searching && (
          <div className="rb-log-search">
            <input type="search" autoFocus placeholder="Search games…" aria-label="Search games" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="rb-log-search-list">
              {others.length === 0 && <div className="rb-schedule-muted">No match.</div>}
              {others.slice(0, 50).map((g) => (
                <button key={g.id} type="button" className="rb-log-search-row" onClick={() => pick(g.id)}>
                  <span>{g.title}</span>
                  {g.detail && <span className="rb-schedule-muted">{g.detail}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rb-log-row">
        <div className="rb-log-field">
          <span className="rb-log-label">Hours</span>
          <div className="rb-log-hours">
            {[1, 2].map((n) => (
              <button key={n} type="button" className="rb-log-quick" aria-pressed={hours === String(n)} onClick={() => setHours(String(n))}>
                {n} h
              </button>
            ))}
            <input ref={hoursRef} type="number" min="0" step="any" aria-label="Hours" placeholder="0" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
        </div>
        <label className="rb-log-field">
          <span className="rb-log-label">Date</span>
          <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      {withType && (
        <div className="rb-log-field">
          <span className="rb-log-label">Type</span>
          <div className="rb-log-types" role="radiogroup" aria-label="Type">
            {TYPE_OPTIONS.map((t) => (
              <button key={t.value} type="button" role="radio" aria-checked={type === t.value} onClick={() => setType(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
          <span className="rb-log-hint">Trial: trying a game you haven't started. Detour: a game outside the plan.</span>
        </div>
      )}

      <div className="rb-log-footer">
        <span className="rb-log-summary">{summary}</span>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="mod-cta" disabled={!valid}>
          <Icon name="timer" /> Log
        </button>
      </div>
    </form>
  );
}

export interface Candidate extends GameOption {
  penalty: number;
  reasons: string[];
}

/** A lane freed up: the best next game, two alternatives, a random pick, or any game. */
export function openNextPick(
  app: App,
  opts: { lane: string; candidates: Candidate[]; random: () => Candidate | null; onPick: (id: string) => void; onChooseAny: () => void },
): void {
  new ReactModal(app, (modal) => <NextPick {...opts} onDone={() => modal.close()} />, { title: `What's next in lane ${opts.lane}?`, cls: 'rb-schedule-modal' }).open();
}

function NextPick({
  candidates,
  random,
  onPick,
  onChooseAny,
  onDone,
}: {
  candidates: Candidate[];
  random: () => Candidate | null;
  onPick: (id: string) => void;
  onChooseAny: () => void;
  onDone: () => void;
}) {
  const pick = (id: string): void => {
    onDone();
    onPick(id);
  };
  if (!candidates.length) {
    return (
      <div className="rb-schedule-next">
        <div className="rb-schedule-muted">Nothing is waiting. Add games to the plan to fill this lane.</div>
        <div className="rb-schedule-form-buttons">
          <button onClick={onDone}>Close</button>
        </div>
      </div>
    );
  }
  return (
    <div className="rb-schedule-next">
      {candidates.slice(0, 3).map((c, i) => (
        <button key={c.id} className={i === 0 ? 'rb-schedule-option is-best' : 'rb-schedule-option'} onClick={() => pick(c.id)}>
          <span className="rb-schedule-option-title">
            {c.title}
            {i === 0 && <span className="rb-schedule-tag">suggested</span>}
          </span>
          {c.detail && <span className="rb-schedule-muted">{c.detail}</span>}
          {c.reasons.length > 0 && <span className="rb-schedule-reasons">{c.reasons.join(' · ')}</span>}
        </button>
      ))}
      <div className="rb-schedule-form-buttons">
        <button onClick={onDone}>Not now</button>
        <button
          onClick={() => {
            onDone();
            onChooseAny();
          }}
        >
          Choose another…
        </button>
        <button
          className="mod-cta"
          onClick={() => {
            const c = random();
            if (c) pick(c.id);
          }}
        >
          🎲 Random
        </button>
      </div>
    </div>
  );
}

/** Pick any game from a searchable list. */
export function openPickAny(app: App, opts: { title: string; options: GameOption[]; onPick: (id: string) => void }): void {
  new ReactModal(app, (modal) => <PickAny options={opts.options} onPick={(id) => (modal.close(), opts.onPick(id))} />, { title: opts.title, cls: 'rb-schedule-modal' }).open();
}

function PickAny({ options, onPick }: { options: GameOption[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.title.toLowerCase().includes(s)) : options;
  }, [options, q]);
  return (
    <div className="rb-schedule-any">
      <input type="search" autoFocus placeholder="Search…" aria-label="Search games" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="rb-schedule-any-list">
        {shown.length === 0 && <div className="rb-schedule-muted">No match.</div>}
        {shown.map((o) => (
          <button key={o.id} className="rb-schedule-option" onClick={() => onPick(o.id)}>
            <span className="rb-schedule-option-title">{o.title}</span>
            {o.detail && <span className="rb-schedule-muted">{o.detail}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Section index for a side section that doesn't exist yet; choosing it creates one. */
export const NEW_SIDE = -2;

/** A section in the Move modal. */
export interface MoveSection {
  index: number;
  name: string;
  kind: SectionKind;
  /** Why it can't be picked (a section above would still catch the item). */
  blocked?: string;
}

/** A lane in the Move modal: what runs there and what's queued. */
export interface MoveLane {
  name: string;
  /** The running game's title, if any. */
  running: string | null;
  /** The moved item is the one running here. */
  mine: boolean;
  /** Titles queued here, in order, without the moved item. */
  queue: string[];
}

/** Where the item is now. */
export interface MoveFrom {
  section: number;
  lane?: number;
  /** Queue position, for a queued item. */
  position?: number;
  pinned?: boolean;
  notBefore?: string;
}

/** What the Move modal asks for. `lane` / `position` are null for "let the schedule decide". */
export interface MoveChoice {
  section: number;
  lane: number | null;
  position: number | null;
  notBefore: string | null;
}

interface MoveOpts {
  title: string;
  itemTitle: string;
  sections: MoveSection[];
  lanes: MoveLane[];
  from: MoveFrom;
  /** The property writes a move into a section makes, in words ("" for none). */
  describe: (section: number) => string;
  onMove: (c: MoveChoice) => void;
}

/** One modal for every move: section (Plan / End tabs), then lane and queue place, then not-before. */
export function openMoveModal(app: App, opts: MoveOpts): void {
  new ReactModal(app, (modal) => <MoveModal {...opts} onDone={() => modal.close()} />, { title: opts.title, cls: 'rb-schedule-modal rb-schedule-move' }).open();
}

const KIND_INFO: Record<SectionKind, { icon: string; hint: string }> = {
  lanes: { icon: 'play', hint: 'Play it now, in a lane' },
  queue: { icon: 'list-ordered', hint: 'Wait for a free lane' },
  live: { icon: 'radio', hint: 'Live service, beside the lanes' },
  side: { icon: 'gamepad-2', hint: 'Casual, beside the lanes' },
  finished: { icon: 'check-circle', hint: 'Done; teaches the estimates' },
  dropped: { icon: 'x-circle', hint: 'Stopped without finishing' },
  hidden: { icon: 'pause-circle', hint: 'Out of the plan for now' },
};



function MoveModal({ itemTitle, sections, lanes, from, describe, onMove, onDone }: MoveOpts & { onDone: () => void }) {
  const kindOf = (i: number): SectionKind | undefined => sections.find((s) => s.index === i)?.kind;
  const firstFree = lanes.findIndex((l) => !l.running || l.mine);
  const [section, setSection] = useState(from.section);
  const [lane, setLane] = useState<number | null>(from.lane ?? null);
  // null = let the schedule decide (no pin).
  const [position, setPosition] = useState<number | null>(from.pinned ? (from.position ?? null) : null);
  const [notBefore, setNotBefore] = useState(from.notBefore ?? '');
  const [showDate, setShowDate] = useState(!!from.notBefore);

  const kind = kindOf(section);
  const same = section === from.section;
  const plan = sections.filter((s) => isShown(s.kind));
  const end = sections.filter((s) => !isShown(s.kind));

  const apply = (c: Partial<MoveChoice> = {}): void => {
    onDone();
    onMove({ section, lane, position, notBefore: notBefore || null, ...c });
  };
  const pickSection = (s: MoveSection): void => {
    const back = s.index === from.section;
    setSection(s.index);
    setLane(back ? (from.lane ?? null) : s.kind === 'lanes' ? (firstFree >= 0 ? firstFree : 0) : null);
    setPosition(back && from.pinned ? (from.position ?? null) : null);
    setNotBefore(back ? (from.notBefore ?? '') : '');
    setShowDate(back && !!from.notBefore);
  };
  const pickLane = (n: number | null): void => {
    setLane(n);
    if (kind !== 'queue') return;
    // Keep the place when coming back to the item's own lane; elsewhere start at the end.
    setPosition(n === null ? null : n === from.lane && from.pinned ? (from.position ?? 0) : (lanes[n]?.queue.length ?? 0));
  };

  const queue = lane !== null ? (lanes[lane]?.queue ?? []) : [];
  const pinned = kind === 'queue' && lane !== null && position !== null;

  const unchanged =
    same &&
    (kind === 'queue'
      ? lane === (from.lane ?? null) && position === (from.pinned ? (from.position ?? null) : null) && (notBefore || '') === (from.notBefore ?? '')
      : kind === 'lanes'
        ? lane === (from.lane ?? null)
        : true);
  const validDate = notBefore === '' || /^\d{4}-\d{2}-\d{2}$/.test(notBefore);
  const busy = kind === 'lanes' && lane !== null && !!lanes[lane]?.running && !lanes[lane].mine;

  const summary = [
    kind === 'lanes' && lane !== null ? `Lane ${lanes[lane]?.name}${busy ? ' (when free)' : ''}` : '',
    kind === 'queue' ? (pinned ? `Lane ${lanes[lane!]?.name}, ${ordinal(position! + 1)}` : 'Placed by the schedule') : '',
    kind === 'queue' && notBefore ? `not before ${notBefore}` : '',
    !same ? describe(section) : '',
  ].filter(Boolean);

  const card = (s: MoveSection) => {
    const info = KIND_INFO[s.kind];
    const now = s.index === from.section;
    const on = s.index === section;
    return (
      <button
        key={s.index}
        role="radio"
        aria-checked={on}
        className={['rb-move-dest', `is-${s.kind}`, on ? 'is-active' : '', now ? 'is-now' : ''].filter(Boolean).join(' ')}
        disabled={!!s.blocked}
        title={s.blocked}
        onClick={() => pickSection(s)}
      >
        <span className="rb-move-dest-icon">
          <Icon name={info.icon} />
        </span>
        <span className="rb-move-dest-text">
          <span className="rb-move-dest-name">
            {s.name}
            {now && <span className="rb-schedule-tag">now</span>}
          </span>
          <span className="rb-move-dest-hint">{s.blocked ?? (now ? info.hint : describe(s.index) || info.hint)}</span>
        </span>
      </button>
    );
  };

  const fromName = sections.find((s) => s.index === from.section)?.name;
  const where =
    kindOf(from.section) === 'queue' && from.lane !== undefined && lanes[from.lane]
      ? `Now queued in lane ${lanes[from.lane].name}${from.position !== undefined ? `, ${ordinal(from.position + 1)}` : ''}`
      : fromName
        ? `Now in ${fromName}`
        : '';

  return (
    <div className="rb-move">
      {where && <div className="rb-move-where">{where}</div>}
      <div className="rb-move-dests-wrap" role="radiogroup" aria-label="Section">
        <div className="rb-move-dests">{plan.map(card)}</div>
        {end.length > 0 && (
          <>
            <div className="rb-move-divider">
              <span>Or end it</span>
            </div>
            <div className="rb-move-dests is-end">{end.map(card)}</div>
          </>
        )}
      </div>

      {(kind === 'lanes' || kind === 'queue') && lanes.length > 0 && (
        <div className="rb-move-step">
          <div className="rb-move-label">{kind === 'queue' ? 'Queue in' : 'Play in'}</div>
          <div className="rb-move-lanes" role="radiogroup" aria-label="Lane">
            {kind === 'queue' && (
              <button role="radio" aria-checked={lane === null} className={lane === null ? 'rb-move-lane is-active' : 'rb-move-lane'} onClick={() => pickLane(null)}>
                <span className="rb-move-lane-name">Any lane</span>
                <span className="rb-move-lane-now">the schedule picks</span>
              </button>
            )}
            {lanes.map((l, n) => (
              <button key={n} role="radio" aria-checked={lane === n} className={lane === n ? 'rb-move-lane is-active' : 'rb-move-lane'} onClick={() => pickLane(n)}>
                <span className="rb-move-lane-name">Lane {l.name}</span>
                <span className="rb-move-lane-now">{l.mine ? 'here now' : l.running ? `▶ ${l.running}` : 'free'}</span>
              </button>
            ))}
          </div>
          {busy && <div className="rb-move-note">{lanes[lane!].running} is playing there; this game waits above the lanes until it's done.</div>}
        </div>
      )}

      {kind === 'queue' && lane !== null && (
        <div className="rb-move-step">
          <div className="rb-move-label-row">
            <span className="rb-move-label">Position</span>
            <label className="rb-move-auto">
              <input type="checkbox" checked={!pinned} onChange={(e) => setPosition(e.target.checked ? null : (from.lane === lane && from.position !== undefined ? from.position : queue.length))} />
              Let the schedule decide
            </label>
          </div>
          {pinned ? (
            <QueuePicker queue={queue} position={position!} running={lanes[lane]?.running ?? null} title={itemTitle} onPick={setPosition} />
          ) : (
            <div className="rb-move-note">Placed by score and variety; it may move as the plan changes.</div>
          )}
        </div>
      )}

      {kind === 'queue' &&
        (showDate ? (
          <div className="rb-move-step">
            <div className="rb-move-label">Not before</div>
            <div className="rb-move-date">
              <input type="date" aria-label="Not before" value={notBefore} onChange={(e) => setNotBefore(e.target.value)} autoFocus={!from.notBefore} />
              <button className="rb-move-link" onClick={() => (setNotBefore(''), setShowDate(false))}>
                Remove
              </button>
            </div>
            <div className="rb-move-note">For a release date or a DLC: it won't start before then.</div>
          </div>
        ) : (
          <button className="rb-move-link rb-move-add-date" onClick={() => setShowDate(true)}>
            <Icon name="calendar-plus" /> Don't start before a date…
          </button>
        ))}

      <div className="rb-move-footer">
        <span className="rb-move-summary">{summary.join(' · ')}</span>
        <button onClick={onDone}>Cancel</button>
        <button className="mod-cta" disabled={unchanged || !validDate} onClick={() => apply()}>
          Move
        </button>
      </div>
    </div>
  );
}

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/**
 * The whole lane queue, with the moved game shown where it will go. Click a
 * game to put this one right after it; the top row puts it first. The list
 * scrolls, and opens scrolled to the game.
 */
function QueuePicker({ queue, position, running, title, onPick }: { queue: string[]; position: number; running: string | null; title: string; onPick: (p: number) => void }) {
  const meRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    meRef.current?.scrollIntoView({ block: 'nearest' });
  }, [position]);
  const me = (
    <div key="me" ref={meRef} className="rb-move-row is-me" aria-current="true">
      <span className="rb-schedule-index">{position + 1}</span>
      <span className="rb-move-row-title">{title}</span>
      <span className="rb-move-row-tag">goes here</span>
    </div>
  );
  const rows: ReactNode[] = [];
  if (position === 0) rows.push(me);
  else {
    rows.push(
      <button key="top" className="rb-move-row is-pick is-top" aria-label="Put it first" onClick={() => onPick(0)}>
        <span className="rb-schedule-index">
          <Icon name="arrow-up-to-line" />
        </span>
        <span className="rb-move-row-title">{running ? `First, right after ${running}` : 'First in the queue'}</span>
        <span className="rb-move-row-action">Put first</span>
      </button>,
    );
  }
  queue.forEach((t, p) => {
    // Clicking a game puts the moved one right after it: at p + 1 in the queue without it.
    const already = position === p + 1;
    rows.push(
      <button key={`q-${p}`} className="rb-move-row is-pick" aria-label={`Put it after ${t}`} disabled={already} onClick={() => onPick(p + 1)}>
        <span className="rb-schedule-index">{p < position ? p + 1 : p + 2}</span>
        <span className="rb-move-row-title">{t}</span>
        <span className="rb-move-row-action">Add after</span>
      </button>,
    );
    if (already) rows.push(me);
  });
  return (
    <div className="rb-move-queue-wrap">
      {running && (
        <div className="rb-move-row is-running">
          <span className="rb-schedule-index is-now">
            <Icon name="play" />
          </span>
          <span className="rb-move-row-title">{running}</span>
          <span className="rb-move-row-tag">playing</span>
        </div>
      )}
      <div className="rb-move-queue">{rows}</div>
    </div>
  );
}
