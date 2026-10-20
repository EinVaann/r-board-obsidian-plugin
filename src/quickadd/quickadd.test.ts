import { describe, expect, it } from 'vitest';
import { parseDatabaseConfig, parseQuickAdd, serializeDatabase } from '../config';
import { newTableFile, parseTableFile, serializeTableFile } from '../table/format';
import type { DatabaseConfig } from '../types';
import { addOptions } from './options';

describe('quick add config', () => {
  it('parses only configs with an id, keeping string fields', () => {
    expect(parseQuickAdd(undefined)).toBeUndefined();
    expect(parseQuickAdd({ properties: ['a'] })).toBeUndefined();
    expect(parseQuickAdd({ id: 'q1', properties: ['a', 3, 'b'], openNote: true })).toEqual({ id: 'q1', properties: ['a', 'b'], openNote: true });
    expect(parseQuickAdd({ id: 'q1' })).toEqual({ id: 'q1', properties: [], openNote: undefined });
  });

  it('round-trips through a .board file', () => {
    const text = JSON.stringify({ sourceTag: 'game', properties: [], views: [], quickAdd: { id: 'q1', properties: ['status'], openNote: true } });
    const r = parseDatabaseConfig(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.config.quickAdd).toEqual({ id: 'q1', properties: ['status'], openNote: true });
    const again = parseDatabaseConfig(serializeDatabase(r.config));
    expect(again.ok && again.config.quickAdd).toEqual({ id: 'q1', properties: ['status'], openNote: true });
  });

  it('round-trips through a .table file', () => {
    const table = newTableFile('T');
    table.config.quickAdd = { id: 'q2', properties: ['notes'] };
    const r = parseTableFile(serializeTableFile(table));
    if (!r.ok) throw new Error(r.error);
    expect(r.table.config.quickAdd).toEqual({ id: 'q2', properties: ['notes'], openNote: undefined });
  });

  it('adds created values to their properties, once, after the existing options', () => {
    const config: DatabaseConfig = {
      sourceTag: 'x',
      views: [],
      properties: [
        { name: 'type', type: 'select', options: [{ value: 'Food', color: 'red' }] },
        { name: 'tags', type: 'multi' },
      ],
    };
    addOptions(config, { type: ['Fuel', 'Food'], tags: ['need', 'want'] });
    addOptions(config, { tags: ['need'] });
    expect(config.properties[0].options).toEqual([{ value: 'Food', color: 'red' }, { value: 'Fuel' }]);
    expect(config.properties[1].options).toEqual([{ value: 'need' }, { value: 'want' }]);
  });

  it('leaves files without quick add unchanged', () => {
    expect(serializeDatabase({ sourceTag: 'x', properties: [], views: [] })).not.toContain('quickAdd');
    expect(serializeTableFile(newTableFile())).not.toContain('quickAdd');
  });
});
