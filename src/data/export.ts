import type { BoardItem, PropertyConfig } from '../types';
import { asArray, asBoolean, asNumber, fieldValue, optionFor } from '../render/values';
import { toText, type FValue } from '../formula/evaluate';

export type ExportFormat = 'json' | 'csv' | 'md';

export const EXPORT_EXTENSION: Record<ExportFormat, string> = { json: 'json', csv: 'csv', md: 'md' };

/** What to export: the view's items (in order) and its visible columns. */
export interface ExportInput {
  items: BoardItem[];
  properties: PropertyConfig[];
  titleLabel: string;
}

/** A property value as plain text (lists comma-separated, options by label). */
export function propertyText(item: BoardItem, prop: PropertyConfig): string {
  const v = fieldValue(item, prop);
  if (v === undefined || v === null) return '';
  switch (prop.type) {
    case 'select':
    case 'multi':
      return asArray(v).map((x) => optionFor(prop, x).label).join(', ');
    case 'checkbox':
      return String(asBoolean(v) ?? false);
    case 'formula':
      return toText(v as FValue);
    default:
      return Array.isArray(v) ? asArray(v).join(', ') : String(v);
  }
}

/** A property value typed for JSON: numbers, booleans and lists stay as such. */
function propertyJson(item: BoardItem, prop: PropertyConfig): unknown {
  const v = fieldValue(item, prop);
  if (v === undefined || v === null || v === '') return null;
  switch (prop.type) {
    case 'select':
      return optionFor(prop, String(asArray(v)[0] ?? '')).label;
    case 'multi':
      return asArray(v).map((x) => optionFor(prop, x).label);
    case 'checkbox':
      return asBoolean(v) ?? false;
    case 'number':
      return asNumber(v) ?? v;
    case 'formula':
      return v instanceof Date || Array.isArray(v) ? toText(v as FValue) : v;
    default:
      return Array.isArray(v) ? asArray(v) : v;
  }
}

/** Column headers, made unique so JSON keys don't overwrite each other. */
function headers({ properties, titleLabel }: ExportInput): string[] {
  const seen = new Map<string, number>();
  return [titleLabel, ...properties.map((p) => p.label ?? p.name)].map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });
}

function toJson(input: ExportInput): string {
  const keys = headers(input);
  const rows = input.items.map((item) => {
    const row: Record<string, unknown> = { [keys[0]]: item.title };
    input.properties.forEach((p, i) => (row[keys[i + 1]] = propertyJson(item, p)));
    return row;
  });
  return JSON.stringify(rows, null, 2);
}

const csvCell = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function toCsv(input: ExportInput): string {
  const lines = [headers(input).map(csvCell).join(',')];
  for (const item of input.items) {
    lines.push([item.title, ...input.properties.map((p) => propertyText(item, p))].map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

const mdCell = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

/** Note titles become wikilinks; the alias pipe is escaped so it works inside a table. */
function mdTitle(item: BoardItem): string {
  if (!item.file) return mdCell(item.title);
  const target = item.file.path.replace(/\.md$/, '');
  return `[[${target}\\|${mdCell(item.title)}]]`;
}

function toMarkdown(input: ExportInput): string {
  const head = headers(input).map(mdCell);
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const item of input.items) {
    lines.push(`| ${[mdTitle(item), ...input.properties.map((p) => mdCell(propertyText(item, p)))].join(' | ')} |`);
  }
  return lines.join('\n');
}

/** The view's items written in `format`. */
export function exportItems(input: ExportInput, format: ExportFormat): string {
  if (format === 'json') return toJson(input);
  if (format === 'csv') return toCsv(input);
  return toMarkdown(input);
}
