import type { ReactNode, MouseEvent, CSSProperties } from 'react';
import type { App, TFile } from 'obsidian';
import type { BoardItem, PropertyConfig } from '../types';
import {
  asArray,
  asBoolean,
  asDate,
  asNumber,
  fieldValue,
  formatDateValue,
  formatNumber,
  optionFor,
  parseLink,
  relativeDate,
  resolveImageSrc,
} from '../render/values';
import { toText } from '../formula/evaluate';
import { openImageModal } from '../ui/ImageModal';

/** What field renderers need from the host. */
export interface FieldEnv {
  app: App;
  editFile: (file: TFile, title?: string) => void;
  /** The `.board` / `.table` file: resolves links and images of table rows. */
  sourceFile: TFile;
}

/** The file an item's links resolve from: its note, else the database file. */
function sourceOf(env: FieldEnv, item: BoardItem): TFile {
  return item.file ?? env.sourceFile;
}

/**
 * A field's rendered value, or null when there is nothing to show (callers
 * skip the row entirely). A plain function rather than a component so the
 * caller can decide on the wrapper.
 */
export function fieldNode(env: FieldEnv, item: BoardItem, field: PropertyConfig): ReactNode | null {
  switch (field.type) {
    case 'image':
      return imageNode(env, item, field);
    case 'multi':
      return multiNode(item, field);
    case 'number':
      return numberNode(fieldValue(item, field), field);
    case 'checkbox':
      return checkboxNode(fieldValue(item, field), field);
    case 'links':
      return linksNode(env, item, field);
    case 'select':
      return selectNode(item, field);
    case 'date':
      return dateNode(fieldValue(item, field), field);
    case 'url':
      return urlNode(item, field);
    case 'formula':
      return formulaNode(item, field);
    case 'text':
    default:
      return textNode(item, field);
  }
}

/** Inline style carrying an option color (read by the `.rb-opt` CSS). */
export function optionStyle(color: string): CSSProperties {
  return { '--oc': color } as CSSProperties;
}

function selectNode(item: BoardItem, field: PropertyConfig): ReactNode | null {
  const v = fieldValue(item, field);
  if (v === undefined || v === null || v === '') return null;
  const opt = optionFor(field, Array.isArray(v) ? asArray(v)[0] ?? '' : String(v));
  if (field.render === 'plain') return <span className="rb-text">{affix(field, opt.label)}</span>;
  return (
    <Affixed field={field}>
      <span className="rb-pill rb-opt" style={optionStyle(opt.color)}>
        {opt.label}
      </span>
    </Affixed>
  );
}

function dateNode(v: unknown, field: PropertyConfig): ReactNode | null {
  const d = asDate(v);
  if (!d) return v === undefined || v === null || v === '' ? null : <span className="rb-text">{String(v)}</span>;
  const exact = formatDateValue(d, !!field.includeTime || (typeof v === 'string' && v.length > 10));
  const text = field.render === 'relative' ? relativeDate(d) : exact;
  return (
    <span className="rb-text rb-date" title={exact}>
      {affix(field, text)}
    </span>
  );
}

function urlNode(item: BoardItem, field: PropertyConfig): ReactNode | null {
  const v = fieldValue(item, field);
  if (v === undefined || v === null || v === '') return null;
  const raw = String(v).trim();
  const href = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  return (
    <a className="rb-link rb-url" href={href} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
      {affix(field, raw.replace(/^https?:\/\//i, ''))}
    </a>
  );
}

/** A formula result, drawn by its type: numbers honor the number styles and format. */
function formulaNode(item: BoardItem, field: PropertyConfig): ReactNode | null {
  const error = item.errors?.[field.name];
  if (error) return <span className="rb-formula-error" title={error}>#ERROR</span>;
  const v = fieldValue(item, field);
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return numberNode(v, field);
  if (typeof v === 'boolean') return checkboxNode(v, { ...field, render: 'check' });
  if (v instanceof Date) return dateNode(v, { ...field, render: 'plain' });
  return <span className="rb-text">{affix(field, toText(v as never))}</span>;
}

function imageNode(env: FieldEnv, item: BoardItem, field: PropertyConfig): ReactNode | null {
  const app = env.app;
  const url = resolveImageSrc(app, sourceOf(env, item), fieldValue(item, field));
  if (!url) return null;
  const mode = field.render === 'fit' ? 'fit' : 'fill';
  return (
    <div className={`rb-img rb-img-${mode}`}>
      <img
        src={url}
        loading="lazy"
        decoding="async"
        onClick={(e) => {
          e.stopPropagation();
          openImageModal(app, url);
        }}
      />
    </div>
  );
}

/** Wrap a string with the property's optional prefix / suffix. */
function affix(field: PropertyConfig, value: string): string {
  return `${field.prefix ?? ''}${value}${field.suffix ?? ''}`;
}

/** Muted prefix (before) / suffix (after) spans around visual fields. */
function Affixed({ field, children }: { field: PropertyConfig; children: ReactNode }) {
  return (
    <>
      {field.prefix && <span className="rb-affix">{field.prefix}</span>}
      {children}
      {field.suffix && <span className="rb-affix">{field.suffix}</span>}
    </>
  );
}

function textNode(item: BoardItem, field: PropertyConfig): ReactNode | null {
  const v = fieldValue(item, field);
  if (v === undefined || v === null || v === '') return null;
  const text = affix(field, String(v));
  const render = field.render ?? 'plain';
  const cls = render === 'badge' ? 'rb-badge' : render === 'pill' ? 'rb-pill' : 'rb-text';
  return <span className={cls}>{text}</span>;
}

function multiNode(item: BoardItem, field: PropertyConfig): ReactNode | null {
  const arr = asArray(fieldValue(item, field));
  if (arr.length === 0) return null;
  const asTags = field.render === 'tags';
  return (
    <div className="rb-multi">
      <Affixed field={field}>
        {arr.map((entry, i) => {
          const opt = optionFor(field, entry);
          return (
            <span key={i} className={asTags ? 'rb-tag rb-opt' : 'rb-pill rb-opt'} style={optionStyle(opt.color)}>
              {asTags ? `#${opt.label}` : opt.label}
            </span>
          );
        })}
      </Affixed>
    </div>
  );
}

function numberNode(v: unknown, field: PropertyConfig): ReactNode | null {
  const n = asNumber(v);
  if (n === null) return null;
  const max = field.max ?? 100;
  switch (field.render ?? 'text') {
    case 'stars':
      return <Affixed field={field}><Stars value={n} max={field.max ?? 5} /></Affixed>;
    case 'bar':
      return <Affixed field={field}><Bar value={n} max={max} /></Affixed>;
    case 'circle':
      return <Affixed field={field}><Circle value={n} max={max} /></Affixed>;
    default:
      return <span className="rb-text rb-number">{affix(field, field.format ? formatNumber(n, field.format) : toText(n))}</span>;
  }
}

function linksNode(env: FieldEnv, item: BoardItem, field: PropertyConfig): ReactNode | null {
  const links = asArray(fieldValue(item, field))
    .map(parseLink)
    .filter((l): l is NonNullable<typeof l> => l !== null);
  if (links.length === 0) return null;
  const cls = field.render === 'pills' ? 'rb-link rb-link-pill' : 'rb-link';

  return (
    <div className="rb-links">
      <Affixed field={field}>
        {links.map((link, i) =>
          link.url ? (
            // External URL: open in the browser, don't trigger the card click.
            <a key={i} className={cls} href={link.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
              {link.text}
            </a>
          ) : (
            <a
              key={i}
              className={cls}
              href="#"
              onClick={(e: MouseEvent) => {
                // A plain click edits the linked note in the modal; Ctrl/Cmd opens it.
                e.preventDefault();
                e.stopPropagation();
                const newTab = e.ctrlKey || e.metaKey;
                const from = sourceOf(env, item).path;
                const dest = env.app.metadataCache.getFirstLinkpathDest(link.linkpath, from);
                if (dest && !newTab) env.editFile(dest);
                else void env.app.workspace.openLinkText(link.linkpath, from, newTab);
              }}
            >
              {link.text}
            </a>
          ),
        )}
      </Affixed>
    </div>
  );
}

function checkboxNode(v: unknown, field: PropertyConfig): ReactNode {
  // A missing or unrecognized value renders as unchecked (false), never blank.
  const b = asBoolean(v) ?? false;
  const render = field.render ?? 'check';
  if (render === 'toggle') {
    return (
      <Affixed field={field}>
        <div className={`rb-toggle ${b ? 'rb-toggle-on' : 'rb-toggle-off'}`} aria-label={b ? 'true' : 'false'}>
          <div className="rb-toggle-knob" />
        </div>
      </Affixed>
    );
  }
  // 'check' uses tick / cross glyphs; 'box' uses filled / empty boxes.
  const glyph = render === 'box' ? (b ? '☑' : '☐') : b ? '✓' : '✕';
  return (
    <Affixed field={field}>
      <span className={`rb-check ${b ? 'rb-check-on' : 'rb-check-off'}`} aria-label={b ? 'true' : 'false'}>
        {glyph}
      </span>
    </Affixed>
  );
}

function Stars({ value, max }: { value: number; max: number }) {
  const stars = [];
  for (let i = 1; i <= max; i++) {
    // Fractional fill: 1 when fully earned, 0 when empty, a decimal at the boundary.
    const fill = Math.max(0, Math.min(1, value - (i - 1)));
    stars.push(
      <span key={i} className="rb-star">
        ★{fill > 0 && <span className="rb-star-on" style={{ width: `${fill * 100}%` }}>★</span>}
      </span>,
    );
  }
  return <div className="rb-stars" aria-label={`${value} / ${max}`}>{stars}</div>;
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0)) * 100;
  return (
    <div className="rb-bar" aria-label={`${value} / ${max}`}>
      <div className="rb-bar-fill" style={{ width: `${pct}%` }} />
      <span className="rb-bar-label">{value}</span>
    </div>
  );
}

const CIRCLE_SIZE = 44;
const CIRCLE_STROKE = 4;

function Circle({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const c = CIRCLE_SIZE / 2;
  const r = (CIRCLE_SIZE - CIRCLE_STROKE) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div className="rb-circle" aria-label={`${value} / ${max}`}>
      <svg width={CIRCLE_SIZE} height={CIRCLE_SIZE} viewBox={`0 0 ${CIRCLE_SIZE} ${CIRCLE_SIZE}`}>
        <circle className="rb-circle-track" cx={c} cy={c} r={r} fill="none" strokeWidth={CIRCLE_STROKE} />
        <circle
          className="rb-circle-prog"
          cx={c}
          cy={c}
          r={r}
          fill="none"
          strokeWidth={CIRCLE_STROKE}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      <span className="rb-circle-label">{Math.round(value)}</span>
    </div>
  );
}
