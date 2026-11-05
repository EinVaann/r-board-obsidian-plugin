import { useMemo, useState } from 'react';
import type { App } from 'obsidian';
import { ReactModal } from '../react/mount';
import { Select, SettingRow } from '../settings/controls';
import type { SessionType } from '../schedule/types';

export interface GameOption {
  id: string;
  title: string;
  /** Shown after the title (e.g. "playing", "8 h"). */
  detail?: string;
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
  const [item, setItem] = useState(initial ?? games[0]?.id ?? '');
  const [hours, setHours] = useState('');
  const [date, setDate] = useState(today);
  const [type, setType] = useState<SessionType | ''>(typeFor(item));
  const h = Number(hours);
  const valid = !!item && hours.trim() !== '' && Number.isFinite(h) && h > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const submit = (): void => {
    if (!valid) return;
    onSubmit({ item, hours: Math.round(h * 100) / 100, date, ...(withType && type ? { type } : {}) });
    onDone();
  };
  return (
    <form
      className="rb-schedule-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <SettingRow name="Game">
        <Select
          value={item}
          options={games.map((g) => ({ value: g.id, label: g.detail ? `${g.title} · ${g.detail}` : g.title }))}
          onChange={(v) => {
            setItem(v);
            setType(typeFor(v));
          }}
        />
      </SettingRow>
      <SettingRow name="Hours">
        <input type="number" min="0" step="0.1" autoFocus aria-label="Hours" value={hours} onChange={(e) => setHours(e.target.value)} />
      </SettingRow>
      <SettingRow name="Date">
        <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
      </SettingRow>
      {withType && (
        <SettingRow name="Type" desc="Trial: trying a game you haven't started. Detour: a game outside the plan.">
          <Select<'' | SessionType> value={type} options={TYPE_OPTIONS as { value: '' | SessionType; label: string }[]} onChange={(v) => setType(v)} />
        </SettingRow>
      )}
      <div className="rb-schedule-form-buttons">
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="mod-cta" disabled={!valid}>
          Log
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

/** A lane in the move prompt: where the game can go, as 0-based queue positions. */
export interface MoveLane {
  name: string;
  /** Shown under the lane name in the tabs (e.g. "5 queued"). */
  detail: string;
  slots: { to: number; label: string }[];
}

/** Pick a lane (tabs) and a numbered place in its queue. */
export function openMovePrompt(app: App, opts: { title: string; lanes: MoveLane[]; lane: number; onPick: (lane: number, to: number) => void }): void {
  new ReactModal(app, (modal) => <MovePrompt lanes={opts.lanes} initial={opts.lane} onPick={(lane, to) => (modal.close(), opts.onPick(lane, to))} />, {
    title: opts.title,
    cls: 'rb-schedule-modal',
  }).open();
}

function MovePrompt({ lanes, initial, onPick }: { lanes: MoveLane[]; initial: number; onPick: (lane: number, to: number) => void }) {
  const [lane, setLane] = useState(initial);
  const slots = lanes[lane]?.slots ?? [];
  return (
    <div className="rb-schedule-any">
      {lanes.length > 1 && (
        <div className="rb-schedule-lane-tabs" role="tablist">
          {lanes.map((l, n) => (
            <button key={n} role="tab" aria-selected={n === lane} className={n === lane ? 'is-active' : ''} onClick={() => setLane(n)}>
              <span className="rb-schedule-lane-tab-name">Lane {l.name}</span>
              <span className="rb-schedule-lane-tab-now">{l.detail}</span>
            </button>
          ))}
        </div>
      )}
      <div className="rb-schedule-any-list">
        {slots.length === 0 && <div className="rb-schedule-muted">It's the only game queued here.</div>}
        {slots.map((s) => (
          <button key={s.to} className="rb-schedule-option rb-schedule-move-slot" onClick={() => onPick(lane, s.to)}>
            <span className="rb-schedule-index">{s.to + 1}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Ask for a date; `null` clears it. */
export function openDatePrompt(app: App, opts: { title: string; desc: string; initial?: string; onSave: (date: string | null) => void }): void {
  new ReactModal(app, (modal) => <DatePrompt {...opts} onDone={() => modal.close()} />, { title: opts.title, cls: 'rb-schedule-modal' }).open();
}

function DatePrompt({ desc, initial, onSave, onDone }: { desc: string; initial?: string; onSave: (date: string | null) => void; onDone: () => void }) {
  const [date, setDate] = useState(initial ?? '');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(date || null);
        onDone();
      }}
    >
      <SettingRow name="Date" desc={desc}>
        <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
      </SettingRow>
      <div className="rb-schedule-form-buttons">
        {initial && (
          <button
            type="button"
            onClick={() => {
              onSave(null);
              onDone();
            }}
          >
            Clear
          </button>
        )}
        <button type="submit" className="mod-cta" disabled={date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date)}>
          Save
        </button>
      </div>
    </form>
  );
}
