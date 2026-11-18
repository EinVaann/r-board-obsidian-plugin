import { useRef } from 'react';
import { FuzzySuggestModal, type App, type TFile } from 'obsidian';
import type { StoredValue } from '../data/properties';
import { asArray, linkTo, parseLink } from '../render/values';
import { Icon } from '../react/Icon';
import { isImageFile, isLinkText, LinkSearch } from './LinkSearch';
import type { EditMove } from './ValueEditor';

/** Typed text as a link: links and URLs as they are, anything else as `[[text]]`. */
export const typedLink = (t: string): string => (isLinkText(t) ? t.trim() : `[[${t.trim()}]]`);

/**
 * A links (or image) value: the chosen files as removable pills, then a box
 * that suggests files as you type. Each pick saves at once. Enter on an empty
 * box (or Escape / Tab) finishes; Backspace on an empty box removes the last pill.
 * `single`: a pick replaces the link and finishes.
 */
export function LinksEditor({
  app,
  value,
  sourcePath,
  image = false,
  single = false,
  seed,
  autoFocus = false,
  browse = false,
  className,
  onChange,
  onDone,
}: {
  app: App;
  value: unknown;
  sourcePath: string;
  /** One image file (with a thumbnail), not a list. */
  image?: boolean;
  /** One link at most (stored as a one-item list). */
  single?: boolean;
  seed?: string;
  autoFocus?: boolean;
  /** Show a button that browses the whole vault. */
  browse?: boolean;
  className?: string;
  onChange: (value: StoredValue) => void;
  onDone?: (move: EditMove) => void;
}) {
  const links = asArray(value);
  // Pickers call back after other edits: read the latest list from here.
  const latest = useRef(links);
  latest.current = links;
  // Enter / Tab / Escape finish, then the blur that follows must not finish again.
  const finished = useRef(false);
  const picking = useRef(false);

  const add = (link: string): void => {
    if (image) return onChange(link);
    if (single) return onChange([link]);
    if (!latest.current.includes(link)) onChange([...latest.current, link]);
  };
  const remove = (link: string): void => {
    const next = latest.current.filter((l) => l !== link);
    onChange(image || next.length === 0 ? null : next);
  };
  const finish = (text: string, move: EditMove): void => {
    if (finished.current) return;
    finished.current = true;
    if (text.trim()) add(typedLink(text));
    onDone?.(move);
  };

  /** An image link's thumbnail URL, when it resolves. */
  const thumb = (link: string): string | null => {
    const l = parseLink(link);
    if (!l) return null;
    if (l.url) return l.url;
    const dest = app.metadataCache.getFirstLinkpathDest(l.linkpath, sourcePath);
    return dest ? app.vault.getResourcePath(dest) : null;
  };

  return (
    <div className={['rb-links-editor', className].filter(Boolean).join(' ')} onFocus={() => void (finished.current = false)}>
      {links.map((l) => {
        const src = image ? thumb(l) : null;
        return (
          <span key={l} className="rb-pill rb-links-editor-pill" title={l}>
            {src && <img className="rb-links-editor-thumb" src={src} alt="" />}
            {parseLink(l)?.text ?? l}
            <button
              type="button"
              className="rb-links-editor-remove"
              aria-label="Remove"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                remove(l);
              }}
            >
              <Icon name="x" />
            </button>
          </span>
        );
      })}
      <LinkSearch
        app={app}
        sourcePath={sourcePath}
        image={image}
        seed={seed}
        autoFocus={autoFocus}
        className="rb-links-editor-input"
        placeholder={image ? (links.length ? 'Replace…' : 'Find an image or paste a URL…') : !links.length ? 'Find a note…' : single ? 'Replace…' : 'Add…'}
        onPick={(link) => {
          finished.current = false;
          add(link);
          if (single) finish('', 'down');
        }}
        onKey={(e, text, clear) => {
          finished.current = false;
          const stop = (): void => {
            e.preventDefault();
            e.stopPropagation();
          };
          if (e.key === 'Enter') {
            stop();
            if (!text.trim() || single) return finish(text, 'down');
            add(typedLink(text));
            clear();
          } else if (e.key === 'Tab') {
            stop();
            finish(text, e.shiftKey ? 'left' : 'right');
          } else if (e.key === 'Escape') {
            stop();
            finish('', null);
          } else if (e.key === 'Backspace' && !text && latest.current.length) {
            stop();
            remove(latest.current[latest.current.length - 1]);
          }
        }}
        onBlur={(text) => {
          // Focus moving to the browse picker isn't the end of the edit.
          if (!picking.current) finish(text, null);
        }}
      />
      {browse && (
        <button
          type="button"
          className="rb-links-editor-browse"
          aria-label="Browse the vault"
          title="Browse the vault"
          onMouseDown={() => void (picking.current = true)}
          onClick={() =>
            new FilePicker(
              app,
              (file) => add(linkTo(app, file, sourcePath, !image)),
              image ? isImageFile : undefined,
              () => void (picking.current = false),
            ).open()
          }
        >
          <Icon name={image ? 'image' : 'folder-open'} />
        </button>
      )}
    </div>
  );
}

/** Every file in the vault (or those `accept` allows), fuzzy-searched by path. */
export class FilePicker extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onPick: (file: TFile) => void,
    private readonly accept?: (file: TFile) => boolean,
    private readonly onClosed?: () => void,
  ) {
    super(app);
    this.setPlaceholder(accept ? 'Pick an image…' : 'Link a file…');
  }
  getItems(): TFile[] {
    const files = this.app.vault.getFiles();
    return this.accept ? files.filter(this.accept) : files;
  }
  getItemText(file: TFile): string {
    return file.path;
  }
  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
  onClose(): void {
    super.onClose();
    this.onClosed?.();
  }
}
