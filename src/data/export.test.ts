import { describe, expect, it } from 'vitest';
import type { BoardItem, PropertyConfig } from '../types';
import { exportItems } from './export';

const status: PropertyConfig = { name: 'status', label: 'Status', type: 'select', options: [{ value: 'wip', label: 'In progress' }] };
const tags: PropertyConfig = { name: 'tags', type: 'multi' };
const n: PropertyConfig = { name: 'n', label: 'Count', type: 'number' };
const done: PropertyConfig = { name: 'done', type: 'checkbox' };
const items: BoardItem[] = [
  { id: 'a', title: 'Alpha, "one"', values: { status: 'wip', tags: ['x', 'y'], n: '3', done: true }, tags: [] },
  { id: 'b', title: 'Be|ta', values: { n: null }, tags: [] },
];
const input = { items, properties: [status, tags, n, done], titleLabel: 'Name' };

describe('export', () => {
  it('writes CSV with quoting, labels and the view order', () => {
    expect(exportItems(input, 'csv').split('\r\n')).toEqual([
      'Name,Status,tags,Count,done',
      '"Alpha, ""one""",In progress,"x, y",3,true',
      'Be|ta,,,,',
    ]);
  });

  it('writes typed JSON', () => {
    expect(JSON.parse(exportItems(input, 'json'))).toEqual([
      { Name: 'Alpha, "one"', Status: 'In progress', tags: ['x', 'y'], Count: 3, done: true },
      { Name: 'Be|ta', Status: null, tags: null, Count: null, done: null },
    ]);
  });

  it('writes a Markdown table with escaped pipes', () => {
    const lines = exportItems(input, 'md').split('\n');
    expect(lines[0]).toBe('| Name | Status | tags | Count | done |');
    expect(lines[1]).toBe('| --- | --- | --- | --- | --- |');
    expect(lines[3]).toBe('| Be\\|ta |  |  |  |  |');
  });

  it('keeps duplicate headers apart', () => {
    const dup: PropertyConfig = { name: 'other', label: 'Count', type: 'text' };
    expect(exportItems({ items: [], properties: [n, dup], titleLabel: 'Name' }, 'csv')).toBe('Name,Count,Count (2)');
  });
});
