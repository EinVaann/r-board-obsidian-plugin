import type { ReactNode, MouseEvent } from 'react';
import type { App, TFile } from 'obsidian';
import type { BoardItem, PropertyConfig } from '../types';
import { asArray, asBoolean, asNumber, fieldValue, parseLink, resolveImageSrc } from '../render/values';
import { openImageModal } from '../ui/ImageModal';

/** What field renderers need from the host. */
export interface FieldEnv {
  app: App;
  editFile: (file: TFile, title?: string) => void;
}

/**
 * A field's rendered value, or null when there is nothing to show (callers
 * skip the row entirely). A plain function rather than a component so the
 * caller can decide on the wrapper.
 */
export function fieldNode(env: FieldEnv, item: BoardItem, field: PropertyConfig): ReactNode | null {
  switch (field.type) {
    case 'image':
      return imageNode(env.app, item, field);
    case 'multi':
      return multiNode(item, field);
    case 'number':
      return numberNode(item, field);
    case 'checkbox':
      return checkboxNode(item, field);
    case 'links':
      return linksNode(env, item, field);
    case 'text':
    default:
      return textNode(item, field);
  }
}

function imageNode(app: App, item: BoardItem, field: PropertyConfig): ReactNode | null {
  const url = resolveImageSrc(app, item.file, fieldValue(item, field));
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

/** Curated, evenly-spaced hues so each value gets a distinct, pleasant color. */
const PILL_HUES = [0, 25, 45, 95, 150, 190, 215, 260, 290, 330];

/** Deterministic hue for a value, so the same value is always the same color. */
function pillHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return PILL_HUES[h % PILL_HUES.length];
}

function multiNode(item: BoardItem, field: PropertyConfig): ReactNode | null {
  const arr = asArray(fieldValue(item, field));
  if (arr.length === 0) return null;
  const asTags = field.render === 'tags';
  return (
    <div className="rb-multi">
      <Affixed field={field}>
        {arr.map((entry, i) => (
          <span
            key={i}
            className={asTags ? 'rb-tag' : 'rb-pill'}
            // Per-value color (read by the .rb-multi pill/tag CSS).
            style={{ '--pc': String(pillHue(entry)) } as React.CSSProperties}
          >
            {asTags ? `#${entry}` : entry}
          </span>
        ))}
      </Affixed>
    </div>
  );
}

function numberNode(item: BoardItem, field: PropertyConfig): ReactNode | null {
  const n = asNumber(fieldValue(item, field));
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
      return <span className="rb-text rb-number">{affix(field, String(n))}</span>;
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
                const dest = env.app.metadataCache.getFirstLinkpathDest(link.linkpath, item.file.path);
                if (dest && !newTab) env.editFile(dest);
                else void env.app.workspace.openLinkText(link.linkpath, item.file.path, newTab);
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

function checkboxNode(item: BoardItem, field: PropertyConfig): ReactNode {
  // A missing or unrecognized value renders as unchecked (false), never blank.
  const b = asBoolean(fieldValue(item, field)) ?? false;
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
