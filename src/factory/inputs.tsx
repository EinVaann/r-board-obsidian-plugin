/** Inputs that commit on blur / Enter (so the plan doesn't re-solve on every keystroke). */

import { useEffect, useState } from 'react';

export function TextCommit({ value, onCommit, placeholder, list }: { value: string; onCommit: (v: string) => void; placeholder?: string; list?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (): void => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <input
      type="text"
      className="rb-pl-text"
      value={draft}
      list={list}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function NumCommit({ value, onCommit, label }: { value: number | undefined; onCommit: (v: number) => void; label: string }) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  useEffect(() => setDraft(value === undefined ? '' : String(value)), [value]);
  const commit = (): void => {
    const n = Number(draft);
    if (draft !== '' && Number.isFinite(n) && n >= 0 && n !== value) onCommit(n);
    else setDraft(value === undefined ? '' : String(value));
  };
  return (
    <input
      type="number"
      className="rb-pl-num"
      min={0}
      step="any"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

