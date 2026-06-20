import type { App } from 'obsidian';
import type { BoardItem, PropertyConfig } from '../types';
import { asArray, asNumber, fieldValue, resolveImageSrc } from './values';
import { openImageModal } from '../ui/ImageModal';

/**
 * Render a single field's value into `parent`. Returns true if anything was
 * drawn (so callers can skip empty fields). `sourceFile` anchors wikilink
 * resolution for image fields.
 */
export function renderField(
  app: App,
  parent: HTMLElement,
  item: BoardItem,
  field: PropertyConfig,
): boolean {
  switch (field.type) {
    case 'image':
      return renderImage(app, parent, item, field);
    case 'multi':
      return renderMulti(parent, item, field);
    case 'number':
      return renderNumber(parent, item, field);
    case 'text':
    default:
      return renderText(parent, item, field);
  }
}

function renderImage(app: App, parent: HTMLElement, item: BoardItem, field: PropertyConfig): boolean {
  const url = resolveImageSrc(app, item.file, fieldValue(item, field));
  if (!url) return false;

  const mode = field.render === 'fit' ? 'fit' : 'fill';
  const wrap = parent.createDiv({ cls: `rb-img rb-img-${mode}` });
  const img = wrap.createEl('img', { attr: { src: url, loading: 'lazy' } });
  img.onclick = (e) => {
    e.stopPropagation();
    openImageModal(app, url);
  };
  return true;
}

/** Wrap a string with the property's optional prefix / suffix. */
function affix(field: PropertyConfig, value: string): string {
  return `${field.prefix ?? ''}${value}${field.suffix ?? ''}`;
}

/** Add the prefix (before) / suffix (after) as muted spans around visual fields. */
function addAffixSpans(parent: HTMLElement, field: PropertyConfig, draw: () => void): void {
  if (field.prefix) parent.createSpan({ cls: 'rb-affix', text: field.prefix });
  draw();
  if (field.suffix) parent.createSpan({ cls: 'rb-affix', text: field.suffix });
}

function renderText(parent: HTMLElement, item: BoardItem, field: PropertyConfig): boolean {
  const v = fieldValue(item, field);
  if (v === undefined || v === null || v === '') return false;
  const text = affix(field, String(v));
  const render = field.render ?? 'plain';
  if (render === 'badge') {
    parent.createSpan({ cls: 'rb-badge', text });
  } else if (render === 'pill') {
    parent.createSpan({ cls: 'rb-pill', text });
  } else {
    parent.createSpan({ cls: 'rb-text', text });
  }
  return true;
}

/** Curated, evenly-spaced hues so each value gets a distinct, pleasant color. */
const PILL_HUES = [0, 25, 45, 95, 150, 190, 215, 260, 290, 330];

/** Deterministic hue for a value, so the same value is always the same color. */
function pillHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return PILL_HUES[h % PILL_HUES.length];
}

function renderMulti(parent: HTMLElement, item: BoardItem, field: PropertyConfig): boolean {
  const arr = asArray(fieldValue(item, field));
  if (arr.length === 0) return false;
  const asTags = field.render === 'tags';
  const wrap = parent.createDiv({ cls: 'rb-multi' });
  addAffixSpans(wrap, field, () => {
    for (const entry of arr) {
      const el = wrap.createSpan({
        cls: asTags ? 'rb-tag' : 'rb-pill',
        text: asTags ? `#${entry}` : entry,
      });
      // Per-value color (read by the .rb-multi pill/tag CSS).
      el.style.setProperty('--pc', String(pillHue(entry)));
    }
  });
  return true;
}

function renderNumber(parent: HTMLElement, item: BoardItem, field: PropertyConfig): boolean {
  const n = asNumber(fieldValue(item, field));
  if (n === null) return false;
  const render = field.render ?? 'text';
  const max = field.max ?? 100;

  switch (render) {
    case 'stars':
      addAffixSpans(parent, field, () => renderStars(parent, n, field.max ?? 5));
      return true;
    case 'bar':
      addAffixSpans(parent, field, () => renderBar(parent, n, max));
      return true;
    case 'circle':
      addAffixSpans(parent, field, () => renderCircle(parent, n, max));
      return true;
    case 'text':
    default:
      parent.createSpan({ cls: 'rb-text rb-number', text: affix(field, String(n)) });
      return true;
  }
}

function renderStars(parent: HTMLElement, value: number, max: number): void {
  const wrap = parent.createDiv({ cls: 'rb-stars', attr: { 'aria-label': `${value} / ${max}` } });
  const full = Math.round(value);
  for (let i = 1; i <= max; i++) {
    wrap.createSpan({ cls: i <= full ? 'rb-star rb-star-on' : 'rb-star', text: '★' });
  }
}

function renderBar(parent: HTMLElement, value: number, max: number): void {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0)) * 100;
  const wrap = parent.createDiv({ cls: 'rb-bar', attr: { 'aria-label': `${value} / ${max}` } });
  wrap.createDiv({ cls: 'rb-bar-fill' }).style.width = `${pct}%`;
  wrap.createSpan({ cls: 'rb-bar-label', text: String(value) });
}

function renderCircle(parent: HTMLElement, value: number, max: number): void {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const size = 44;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);

  const wrap = parent.createDiv({ cls: 'rb-circle', attr: { 'aria-label': `${value} / ${max}` } });
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

  const mkCircle = (cls: string): SVGCircleElement => {
    const c = document.createElementNS(svgNs, 'circle');
    c.setAttribute('cx', String(size / 2));
    c.setAttribute('cy', String(size / 2));
    c.setAttribute('r', String(r));
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke-width', String(stroke));
    c.setAttribute('class', cls);
    return c;
  };

  svg.appendChild(mkCircle('rb-circle-track'));
  const prog = mkCircle('rb-circle-prog');
  prog.setAttribute('stroke-dasharray', String(circ));
  prog.setAttribute('stroke-dashoffset', String(offset));
  prog.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
  svg.appendChild(prog);

  wrap.appendChild(svg);
  wrap.createSpan({ cls: 'rb-circle-label', text: String(Math.round(value)) });
}
