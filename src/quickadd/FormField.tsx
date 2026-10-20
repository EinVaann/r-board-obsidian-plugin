import { useEffect, useRef, useState } from 'react';
import { AbstractInputSuggest, FuzzySuggestModal, type App, type TFile } from 'obsidian';
import type { PropertyConfig } from '../types';
import type { StoredValue } from '../data/properties';
import { asArray, optionFor, parseLink } from '../render/values';
import { optionStyle } from '../components/fields';
import { ValueEditor } from '../components/ValueEditor';
import { Toggle } from '../settings/controls';
import { Icon } from '../react/Icon';

/**
 * One quick-add field, edited the way its type is picked: a dropdown for
 * select / multi, a file picker for links, a switch for checkboxes, a numeric
 * box for numbers, and the shared editor for the rest. `onEnter` moves on.
 */
export function FormField({
  app,
  prop,
  value,
  known,
  sourcePath,
  autoFocus,
  onChange,
  onEnter,
}: {
  app: App;
  prop: PropertyConfig;
  value: StoredValue | undefined;
  /** Values already used in the database (select / multi), offered beside the options. */
  known: string[];
  /** The database file, for shortest link text. */
  sourcePath: string;
  autoFocus: boolean;
  onChange: (value: StoredValue) => void;
  onEnter: () => void;
}) {
  switch (prop.type) {
    case 'checkbox':
      return <Toggle checked={value === true} onChange={onChange} label={prop.label ?? prop.name} />;
    case 'select':
    case 'multi':
      return <Dropdown prop={prop} value={value} known={known} autoFocus={autoFocus} onChange={onChange} onEnter={onEnter} />;
    case 'links':
    case 'image':
      return (
        <Links
          app={app}
          value={value}
          image={prop.type === 'image'}
          sourcePath={sourcePath}
          autoFocus={autoFocus}
          onChange={onChange}
          onEnter={onEnter}
        />
      );
    case 'number':
      return <NumberInput value={value} autoFocus={autoFocus} onChange={onChange} onEnter={onEnter} />;
    default:
      return (
        <ValueEditor
          prop={prop}
          raw={value}
          autoFocus={autoFocus}
          onCommit={onChange}
          onDone={(move) => {
            if (move === 'down') onEnter();
          }}
        />
      );
  }
}

/** Digits, sign, decimal point / comma and spaces only. */
const NUMERIC = /^[-+]?[\d\s.,]*$/;

function NumberInput({
  value,
  autoFocus,
  onChange,
  onEnter,
}: {
  value: StoredValue | undefined;
  autoFocus: boolean;
  onChange: (value: StoredValue) => void;
  onEnter: () => void;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      autoFocus={autoFocus}
      onChange={(e) => {
        if (NUMERIC.test(e.target.value)) setDraft(e.target.value);
      }}
      onBlur={() => onChange(draft.trim() || null)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        onChange(draft.trim() || null);
        onEnter();
      }}
    />
  );
}

/** A choice in the open list: a value, or "Create" for the typed text. */
type Item = { value: string; create?: boolean };

/**
 * A dropdown: the chosen value(s) as pills; open it to search the options and
 * values in use, or create a new one. Single select closes on pick; multi stays open.
 */
function Dropdown({
  prop,
  value,
  known,
  autoFocus,
  onChange,
  onEnter,
}: {
  prop: PropertyConfig;
  value: StoredValue | undefined;
  known: string[];
  autoFocus: boolean;
  onChange: (value: StoredValue) => void;
  onEnter: () => void;
}) {
  const multi = prop.type === 'multi';
  const chosen = asArray(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLDivElement>(null);

  const choices = [...new Set([...(prop.options?.map((o) => o.value) ?? []), ...known, ...chosen])];
  const q = query.trim().toLowerCase();
  const matches = (v: string): boolean => v.toLowerCase().includes(q) || optionFor(prop, v).label.toLowerCase().includes(q);
  const exact = choices.some((v) => v.toLowerCase() === q || optionFor(prop, v).label.toLowerCase() === q);
  const items: Item[] = [...choices.filter(matches).map((v) => ({ value: v })), ...(q && !exact ? [{ value: query.trim(), create: true }] : [])];

  useEffect(() => {
    if (autoFocus) trigger.current?.focus();
  }, [autoFocus]);

  // Close on a click outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  });

  const show = (seed = ''): void => {
    setQuery(seed);
    setActive(0);
    setOpen(true);
  };
  const close = (refocus = true): void => {
    setOpen(false);
    setQuery('');
    if (refocus) trigger.current?.focus();
  };

  const pick = (item: Item, viaKey: boolean): void => {
    if (multi) {
      onChange(chosen.includes(item.value) ? chosen.filter((c) => c !== item.value) : [...chosen, item.value]);
      setQuery('');
      return;
    }
    onChange(chosen[0] === item.value ? null : item.value);
    close();
    if (viaKey) onEnter();
  };

  const remove = (v: string): void => onChange(multi ? chosen.filter((c) => c !== v) : null);

  return (
    <div className="rb-qa-dropdown" ref={root}>
      <div
        ref={trigger}
        className={open ? 'rb-qa-select is-open' : 'rb-qa-select'}
        role="combobox"
        aria-expanded={open}
        tabIndex={0}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (open) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            onEnter();
          } else if (e.key === 'ArrowDown' || e.key === ' ') {
            e.preventDefault();
            show();
          } else if (e.key === 'Backspace' && chosen.length) {
            e.preventDefault();
            remove(chosen[chosen.length - 1]);
          } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            show(e.key);
          }
        }}
      >
        {chosen.length === 0 && <span className="rb-qa-placeholder">{multi ? 'Select values…' : 'Select…'}</span>}
        {chosen.map((v) => {
          const opt = optionFor(prop, v);
          return (
            <span key={v} className="rb-pill rb-opt rb-qa-chip" style={optionStyle(opt.color)}>
              {opt.label}
              <button
                type="button"
                className="rb-qa-remove"
                aria-label={`Remove ${opt.label}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(v);
                }}
              >
                <Icon name="x" />
              </button>
            </span>
          );
        })}
        <Icon name="chevron-down" className="rb-qa-caret" />
      </div>
      {open && (
        <div className="rb-qa-menu">
          <input
            type="text"
            className="rb-qa-search"
            autoFocus
            value={query}
            placeholder={multi ? 'Search or create… (Esc to close)' : 'Search or create…'}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const n = items.length;
                if (n) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                const item = items[active];
                if (item && (q || !multi)) pick(item, true);
                else {
                  close();
                  onEnter();
                }
              } else if (e.key === 'Escape' || e.key === 'Tab') {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                }
                close(e.key === 'Escape');
              }
            }}
          />
          <div className="rb-qa-options" role="listbox" aria-multiselectable={multi}>
            {items.length === 0 && <div className="rb-qa-empty">Type to create a value</div>}
            {items.map((item, i) => {
              const opt = optionFor(prop, item.value);
              const on = !item.create && chosen.includes(item.value);
              return (
                <div
                  key={item.create ? '\0create' : item.value}
                  role="option"
                  aria-selected={on}
                  className={i === active ? 'rb-qa-option is-active' : 'rb-qa-option'}
                  onMouseEnter={() => setActive(i)}
                  // Keep focus in the search box.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(item, false)}
                >
                  <span className="rb-qa-check">{on && <Icon name="check" />}</span>
                  {item.create && <span className="rb-qa-create">Create</span>}
                  <span className="rb-pill rb-opt" style={optionStyle(opt.color)}>
                    {opt.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const isImage = (f: TFile): boolean => IMAGE_EXTENSIONS.has(f.extension.toLowerCase());

/**
 * Chosen files as removable chips, a box that suggests files as you type, and
 * a browse button. `image`: one image file (a thumbnail shows), not a list.
 */
function Links({
  app,
  value,
  image,
  sourcePath,
  autoFocus,
  onChange,
  onEnter,
}: {
  app: App;
  value: StoredValue | undefined;
  image: boolean;
  sourcePath: string;
  autoFocus: boolean;
  onChange: (value: StoredValue) => void;
  onEnter: () => void;
}) {
  const links = asArray(value);
  const input = useRef<HTMLInputElement>(null);
  // Pickers call back long after render: they read the latest list from here.
  const latest = useRef(links);
  latest.current = links;
  const add = (link: string): void => {
    if (image) onChange(link);
    else if (!latest.current.includes(link)) onChange([...latest.current, link]);
  };
  const addFile = (file: TFile): void => add(`[[${app.metadataCache.fileToLinktext(file, sourcePath, true)}]]`);
  const accept = image ? isImage : undefined;

  useEffect(() => {
    const el = input.current;
    return el ? attachFileSuggest(app, el, addFile, accept) : undefined;
  }, [app, sourcePath, image]); // eslint-disable-line react-hooks/exhaustive-deps

  /** An image link's thumbnail URL, when it resolves. */
  const thumb = (link: string): string | null => {
    const l = parseLink(link);
    if (!l) return null;
    if (l.url) return l.url;
    const dest = app.metadataCache.getFirstLinkpathDest(l.linkpath, sourcePath);
    return dest ? app.vault.getResourcePath(dest) : null;
  };

  return (
    <div className="rb-qa-choices">
      {links.map((l) => {
        const src = image ? thumb(l) : null;
        return (
          <span key={l} className="rb-pill rb-qa-link">
            {src && <img className="rb-qa-thumb" src={src} alt="" />}
            {parseLink(l)?.text ?? l}
            <button type="button" className="rb-qa-remove" aria-label="Remove" onClick={() => onChange(image ? null : links.filter((x) => x !== l))}>
              <Icon name="x" />
            </button>
          </span>
        );
      })}
      <input
        ref={input}
        type="text"
        className="rb-qa-new"
        autoFocus={autoFocus}
        placeholder={image ? (links.length ? 'Replace…' : 'Find an image or paste a URL…') : 'Find a file…'}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          e.stopPropagation();
          const el = e.currentTarget;
          // A picked suggestion clears the box first; only leftover text is added as typed.
          setTimeout(() => {
            const t = el.value.trim();
            if (!t) return onEnter();
            add(/^https?:\/\/|^\[\[/i.test(t) ? t : `[[${t}]]`);
            el.value = '';
          });
        }}
      />
      <button
        type="button"
        className="rb-qa-browse"
        aria-label="Browse the vault"
        title="Browse the vault"
        onClick={() => new FilePicker(app, addFile, accept).open()}
      >
        <Icon name={image ? 'image' : 'folder-open'} />
      </button>
    </div>
  );
}

/** Every file in the vault (or those `accept` allows), fuzzy-searched by path. */
class FilePicker extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onPick: (file: TFile) => void,
    private readonly accept?: (file: TFile) => boolean,
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
}

/** Suggest files under an input (Obsidian 1.4.10+; plain typing otherwise). Returns a cleanup. */
function attachFileSuggest(
  app: App,
  el: HTMLInputElement,
  onPick: (file: TFile) => void,
  accept?: (file: TFile) => boolean,
): (() => void) | undefined {
  if (typeof AbstractInputSuggest !== 'function') return undefined;
  class FileSuggest extends AbstractInputSuggest<TFile> {
    protected getSuggestions(query: string): TFile[] {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const starts = (f: TFile): number => Number(!f.basename.toLowerCase().startsWith(q));
      return app.vault
        .getFiles()
        .filter((f) => (!accept || accept(f)) && f.path.toLowerCase().includes(q))
        .sort((a, b) => starts(a) - starts(b) || Number(a.extension !== 'md') - Number(b.extension !== 'md'))
        .slice(0, 20);
    }
    renderSuggestion(file: TFile, cell: HTMLElement): void {
      cell.createDiv({ text: file.extension === 'md' ? file.basename : file.name });
      if (file.parent?.path && file.parent.path !== '/') cell.createDiv({ cls: 'rb-qa-suggest-path', text: file.parent.path });
    }
  }
  const suggest = new FileSuggest(app, el);
  suggest.onSelect((file) => {
    onPick(file);
    suggest.setValue('');
    suggest.close();
  });
  return () => suggest.close();
}
