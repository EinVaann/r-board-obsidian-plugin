import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Notice, normalizePath, type App, type TFile } from 'obsidian';
import { linkTo } from '../render/values';

/** At most this many files are suggested. */
const MAX_SUGGESTIONS = 20;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
export const isImageFile = (f: TFile): boolean => IMAGE_EXTENSIONS.has(f.extension.toLowerCase());

/**
 * Vault files matching `query`: every word must appear in the path. Names that
 * start with the query come first, then names containing it; notes before other files.
 */
export function searchFiles(files: TFile[], query: string, accept?: (f: TFile) => boolean): TFile[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const rank = (f: TFile): number => {
    const name = f.basename.toLowerCase();
    return (name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2) * 2 + Number(f.extension !== 'md');
  };
  return files
    .filter((f) => (!accept || accept(f)) && words.every((w) => f.path.toLowerCase().includes(w)))
    .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
    .slice(0, MAX_SUGGESTIONS);
}

/** Text that is already a link (or a URL) and is kept as typed. */
export const isLinkText = (t: string): boolean => /^https?:\/\/|^!?\[\[/i.test(t.trim());

/** Characters a file name can't have. */
const BAD_NAME = /[\\/:*?"<>|#^[\]]/g;

type Choice = { file: TFile } | { create: string };

export interface LinkSearchProps {
  app: App;
  /** The file links are written from (shortest link text, new-note folder). */
  sourcePath: string;
  /** Only image files; no "create note". */
  image?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /** Start with this text typed. */
  seed?: string;
  /** A file was picked (or created): its link. */
  onPick: (link: string) => void;
  /** Keys the suggestions don't use. `text` is what's typed; `clear` empties the box. */
  onKey?: (e: ReactKeyboardEvent<HTMLInputElement>, text: string, clear: () => void) => void;
  onBlur?: (text: string) => void;
}

/**
 * A text box that suggests vault files as you type. Picking one hands back a
 * labelled wikilink; with no matching note it offers to create one.
 */
export function LinkSearch({ app, sourcePath, image = false, placeholder, autoFocus, className, seed, onPick, onKey, onBlur }: LinkSearchProps) {
  const [text, setText] = useState(seed ?? '');
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [anchor, setAnchor] = useState<HTMLInputElement | null>(null);

  const q = text.trim();
  const typed = q !== '' && !isLinkText(q);
  const files = typed ? searchFiles(app.vault.getFiles(), q, image ? isImageFile : undefined) : [];
  const name = q.replace(BAD_NAME, ' ').replace(/\s+/g, ' ').trim();
  const exact = files.some((f) => f.basename.toLowerCase() === name.toLowerCase());
  const choices: Choice[] = [...files.map((file) => ({ file })), ...(!image && typed && name && !exact ? [{ create: name }] : [])];
  const open = !dismissed && choices.length > 0;
  const at = Math.min(active, choices.length - 1);

  const clear = (): void => {
    setText('');
    setActive(0);
  };

  const pick = async (choice: Choice): Promise<void> => {
    clear();
    if ('file' in choice) return onPick(linkTo(app, choice.file, sourcePath, !image));
    try {
      const parent = app.fileManager.getNewFileParent(sourcePath, `${choice.create}.md`);
      const path = normalizePath(`${parent.path === '/' ? '' : `${parent.path}/`}${choice.create}.md`);
      const existing = app.vault.getAbstractFileByPath(path);
      const file = existing && 'extension' in existing ? (existing as TFile) : await app.vault.create(path, '');
      onPick(linkTo(app, file, sourcePath));
    } catch (e) {
      new Notice(`R Board: could not create "${choice.create}" — ${(e as Error).message}`);
    }
  };

  const handled = (e: ReactKeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <input
        ref={setAnchor}
        type="text"
        className={className}
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={(e) => {
          const el = e.currentTarget;
          el.setSelectionRange(el.value.length, el.value.length);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setDismissed(false);
        }}
        onBlur={() => onBlur?.(text)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (open) {
            const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
            if (step) return handled(e), setActive((at + step + choices.length) % choices.length);
            if (e.key === 'Enter') return handled(e), void pick(choices[at]);
            if (e.key === 'Escape') return handled(e), setDismissed(true);
          }
          onKey?.(e, text, clear);
        }}
      />
      {open && anchor && <Suggestions anchor={anchor} choices={choices} active={at} onHover={setActive} onPick={(c) => void pick(c)} />}
    </>
  );
}

/** The list under the box, in the document body so table cells and modals don't clip it. */
function Suggestions({
  anchor,
  choices,
  active,
  onHover,
  onPick,
}: {
  anchor: HTMLElement;
  choices: Choice[];
  active: number;
  onHover: (i: number) => void;
  onPick: (c: Choice) => void;
}) {
  const [box, setBox] = useState<DOMRect | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = (): void => setBox(anchor.getBoundingClientRect());
    place();
    const win = anchor.ownerDocument.defaultView ?? window;
    win.addEventListener('scroll', place, true);
    win.addEventListener('resize', place);
    return () => {
      win.removeEventListener('scroll', place, true);
      win.removeEventListener('resize', place);
    };
  }, [anchor]);
  useEffect(() => {
    list.current?.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  if (!box) return null;
  return createPortal(
    <div
      ref={list}
      className="rb-link-suggest"
      style={{ left: box.left, top: box.bottom + 2, minWidth: Math.max(box.width, 240) }}
      // Keep focus in the box (no blur, no grid click) while picking.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {choices.map((c, i) => (
        <div
          key={'file' in c ? c.file.path : '+create'}
          className={i === active ? 'rb-link-suggest-item is-active' : 'rb-link-suggest-item'}
          onMouseEnter={() => onHover(i)}
          onClick={(e) => {
            e.stopPropagation();
            onPick(c);
          }}
        >
          {'file' in c ? (
            <>
              <div className="rb-link-suggest-name">{c.file.extension === 'md' ? c.file.basename : c.file.name}</div>
              {c.file.path.includes('/') && <div className="rb-link-suggest-path">{c.file.path.slice(0, c.file.path.lastIndexOf('/'))}</div>}
            </>
          ) : (
            <div className="rb-link-suggest-create">Create note “{c.create}”</div>
          )}
        </div>
      ))}
    </div>,
    anchor.ownerDocument.body,
  );
}
