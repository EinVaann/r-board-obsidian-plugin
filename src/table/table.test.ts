import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import type { BoardItem } from '../types';
import { newTableFile, parseTableFile, serializeTableFile } from './format';
import { addRow, deleteRows, duplicateRow, rowToItem, setCell } from './rows';
import { computeItems } from '../data/compute';
import { applyFilter } from '../data/filter';
import { groupItems } from '../data/group';

// Trimmed from a real R Sheet v1 file.
const SHEET_V1 = JSON.stringify({
  version: 1,
  columns: [
    { id: 'citem', name: 'Item', type: 'text', width: 180 },
    { id: 'ctype', name: 'Type', type: 'select', options: [{ id: 'ogro', label: 'Groceries', color: '#4ECDC4' }, { id: 'osal', label: 'Salary', color: '#22C55E' }] },
    { id: 'camt', name: 'Amount', type: 'number', format: { style: 'currency', decimals: 2, currency: '$' } },
    { id: 'cdate', name: 'Date', type: 'date' },
    { id: 'ctags', name: 'Tags', type: 'multiselect', options: [{ id: 'tneed', label: 'need', color: '#60A5FA' }] },
    { id: 'cnet', name: 'Net', type: 'formula', formula: 'if({Type} = "Salary", {Amount}, -{Amount})' },
    { id: 'cmonth', name: 'Month', type: 'formula', formula: 'formatDate({Date}, "YYYY-MM")' },
    { id: 'cnote', name: 'Receipt', type: 'link' },
  ],
  rows: [
    { id: 'r01', cells: { citem: 'Monthly salary', ctype: 'osal', camt: 3200, cdate: '2026-08-01', ctags: [] } },
    { id: 'r02', cells: { citem: 'Supermarket', ctype: 'ogro', camt: 86.4, cdate: '2026-08-03', ctags: ['tneed'] } },
    { id: 'r06', cells: { citem: 'Dinner out', ctype: 'ogro', camt: 42, cdate: '2026-09-14', cnet: '=-{Amount} / 2', cnote: 'Dinner with Sam' } },
  ],
  view: {
    sort: [],
    filter: { match: 'all', filters: [] },
    hidden: ['cnote'],
    group: { columnId: 'cmonth', dateBucket: 'none', dir: 'asc', collapsed: ['2026-09'] },
  },
  charts: [
    {
      id: 'chshare', name: 'Where the money goes', type: 'donut', x: 'ctype', values: ['camt'], aggregate: 'sum',
      filter: { match: 'all', filters: [{ id: 'f', columnId: 'ctype', op: 'noneOf', value: ['osal'] }] }, sort: 'value-desc',
    },
  ],
});

const items = (rows: { id: string; cells: Record<string, unknown> }[], title: string): BoardItem[] => rows.map((r) => rowToItem(r, title));

describe('R Sheet v1 migration', () => {
  const parsed = parseTableFile(SHEET_V1);
  if (!parsed.ok) throw new Error(parsed.error);
  const { config, rows } = parsed.table;

  it('turns columns into properties keyed by id and labelled by name', () => {
    expect(parsed.migrated).toBe(true);
    expect(config.kind).toBe('table');
    expect(config.titleProperty).toBe('citem');
    expect(config.properties.map((p) => [p.name, p.label, p.type])).toEqual([
      ['citem', 'Item', 'text'],
      ['ctype', 'Type', 'select'],
      ['camt', 'Amount', 'number'],
      ['cdate', 'Date', 'date'],
      ['ctags', 'Tags', 'multi'],
      ['cnet', 'Net', 'formula'],
      ['cmonth', 'Month', 'formula'],
      ['cnote', 'Receipt', 'links'],
    ]);
    expect(config.properties[1].options?.[1]).toEqual({ value: 'osal', label: 'Salary', color: '#22C55E' });
  });

  it('keeps the table view (hidden columns, group, collapsed, widths) and charts as views', () => {
    const [table, chart] = config.views;
    expect(table).toMatchObject({ name: 'Table', type: 'table', group: 'cmonth', collapsed: ['2026-09'], widths: { citem: 180 } });
    expect(table.properties).not.toContain('cnote');
    expect(table.properties).not.toContain('citem');
    expect(chart).toMatchObject({ name: 'Where the money goes', type: 'chart', chart: { type: 'donut', x: 'ctype', values: ['camt'], sort: 'value-desc' } });
    expect(chart.filter?.conditions[0]).toMatchObject({ property: 'ctype', op: 'noneOf', value: ['osal'] });
  });

  it('computes formulas by column name, with per-row overrides', () => {
    const [salary, groceries, dinner] = computeItems(items(rows, 'citem'), config.properties);
    expect(salary.title).toBe('Monthly salary');
    expect(salary.values.cnet).toBe(3200);
    expect(groceries.values.cnet).toBe(-86.4);
    expect(dinner.values.cnet).toBe(-21);
    expect(dinner.values.cmonth).toBe('2026-09');
  });

  it('filters by option ids and groups by a formula', () => {
    const all = computeItems(items(rows, 'citem'), config.properties);
    const spent = applyFilter(all, config.views[1].filter, config.properties);
    expect(spent.map((i) => i.id)).toEqual(['r02', 'r06']);
    const month = config.properties.find((p) => p.name === 'cmonth')!;
    expect(groupItems(all, month).map((g) => [g.key, g.items.length])).toEqual([['2026-08', 2], ['2026-09', 1]]);
  });

  it('writes its own format (one row per line) and reads it back unchanged', () => {
    const text = serializeTableFile(parsed.table);
    expect(text).toContain('\n    {"id":"r02","cells":{');
    const again = parseTableFile(text);
    expect(again.ok && again.migrated).toBe(false);
    const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
    expect(again.ok && json(again.table)).toEqual(json(parsed.table));
  });
});

// Trimmed from a table the react-unify preview build rewrote.
const UNIFY = JSON.stringify({
  version: 2,
  primaryField: 'citem',
  defaultView: 'v-table',
  fields: [
    { id: 'citem', name: 'Item', type: 'text' },
    { id: 'ctype', name: 'Type', type: 'select', options: [{ id: 'ogro', label: 'Groceries', color: '#4ECDC4' }, { id: 'osal', label: 'Salary', color: '#22C55E' }] },
    { id: 'camt', name: 'Amount', type: 'number', format: { style: 'currency', decimals: 2, currency: '$' } },
    { id: 'cnet', name: 'Net', type: 'formula', formula: 'if({Type} = "Salary", {Amount}, -{Amount})' },
    { id: 'cnote', name: 'Receipt', type: 'link' },
  ],
  views: [
    { id: 'v-table', name: 'Table', type: 'table', limit: 'none', group: { field: 'ctype', dateBucket: 'none', dir: 'asc', collapsed: ['ogro', '￿'], hidden: [] }, widths: { citem: 180 } },
    {
      id: 'v-share',
      name: 'Where the money goes',
      type: 'chart',
      chart: { type: 'donut', x: 'ctype', values: ['camt'], aggregate: 'sum', sort: 'value-desc' },
      filter: { id: 'g1', conjunction: 'and', conditions: [{ id: 'f1', field: 'ctype', op: 'noneOf', value: ['osal'] }] },
      companion: { view: 'v-table', position: 'below', size: 30 },
    },
  ],
  rows: [
    { id: 'r01', cells: { citem: 'Monthly salary', ctype: 'osal', camt: 3200 } },
    { id: 'r06', cells: { citem: 'Dinner out', ctype: 'ogro', camt: 42, cnet: '=-{Amount} / 2', cnote: 'Dinner with Sam' } },
  ],
});

describe('react-unify preview tables', () => {
  const parsed = parseTableFile(UNIFY);
  if (!parsed.ok) throw new Error(parsed.error);
  const { config, rows } = parsed.table;

  it('reads fields, the title field, views by name, groups, filters, charts and split views', () => {
    expect(parsed.migrated).toBe(true);
    expect(config.titleProperty).toBe('citem');
    expect(config.defaultView).toBe('Table');
    expect(config.properties.map((p) => [p.name, p.label, p.type])).toEqual([
      ['citem', 'Item', 'text'],
      ['ctype', 'Type', 'select'],
      ['camt', 'Amount', 'number'],
      ['cnet', 'Net', 'formula'],
      ['cnote', 'Receipt', 'links'],
    ]);
    const [table, chart] = config.views;
    expect(table).toMatchObject({ group: 'ctype', collapsed: ['ogro', '__none__'], widths: { citem: 180 }, sort: { property: '$none' } });
    expect(chart).toMatchObject({ type: 'chart', chart: { type: 'donut', x: 'ctype' }, companion: { view: 'Table', position: 'below', size: 30 } });
    expect(chart.filter?.conditions[0]).toMatchObject({ property: 'ctype', op: 'noneOf', value: ['osal'] });
  });

  it('keeps rows and formula overrides', () => {
    const [, dinner] = computeItems(items(rows, 'citem'), config.properties);
    expect(dinner.values.cnet).toBe(-21);
    expect(parseTableFile(serializeTableFile(parsed.table)).ok).toBe(true);
  });
});

describe('table files', () => {
  it('opens empty files as a new table and rejects unknown shapes', () => {
    const empty = parseTableFile('');
    expect(empty.ok && empty.table.config.properties.map((p) => p.label)).toEqual(['Name', 'Notes']);
    expect(parseTableFile('{"foo": 1}').ok).toBe(false);
    expect(parseTableFile('{oops').ok).toBe(false);
  });

  it('adds, edits, duplicates and deletes rows', () => {
    const { config } = newTableFile();
    const [name, notes] = config.properties;
    let id = '';
    let rows = produce([] as { id: string; cells: Record<string, unknown> }[], (d) => void (id = addRow(d, { name: 'First' })));
    rows = produce(rows, (d) => setCell(d, id, notes, 'hello'));
    rows = produce(rows, (d) => setCell(d, id, name, ''));
    expect(rows[0].cells).toEqual({ notes: 'hello' });
    let copy: string | null = null;
    rows = produce(rows, (d) => void (copy = duplicateRow(d, id)));
    expect(rows.map((r) => r.cells.notes)).toEqual(['hello', 'hello']);
    expect(copy).not.toBe(id);
    rows = produce(rows, (d) => deleteRows(d, [id]));
    expect(rows.map((r) => r.id)).toEqual([copy]);
  });

  it('stores formula overrides as =expr, numbers or text', () => {
    const prop = { name: 'f', type: 'formula' as const, formula: '1' };
    const rows = [{ id: 'a', cells: {} as Record<string, unknown> }];
    const after = produce(rows, (d) => {
      setCell(d, 'a', prop, ' =2*3 ');
    });
    expect(after[0].cells.f).toBe('=2*3');
    expect(produce(after, (d) => setCell(d, 'a', prop, '12'))[0].cells.f).toBe(12);
    expect(produce(after, (d) => setCell(d, 'a', prop, ''))[0].cells.f).toBeUndefined();
  });
});
