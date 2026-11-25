// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { DatabaseConfig } from '../../types/database';
import { newTableFile } from '../table/format';
import { logShapeMissing, shapeLogConfig } from './log-table';

describe('log table shape', () => {
  it('adds the four columns to a fresh table', () => {
    const { config } = newTableFile();
    expect(logShapeMissing(config.properties)).toEqual(['Game', 'Hours', 'Date', 'Type']);
    const cols = shapeLogConfig(config);
    const byName = (n: string) => config.properties.find((p) => p.name === n)!;
    expect(byName(cols.logItem)).toMatchObject({ type: 'links', label: 'Game' });
    expect(byName(cols.logHours)).toMatchObject({ type: 'number', label: 'Hours' });
    expect(byName(cols.logDate)).toMatchObject({ type: 'date', label: 'Date' });
    expect(byName(cols.logType).options!.map((o) => o.value)).toEqual(['lane', 'live', 'detour', 'trial']);
    expect(logShapeMissing(config.properties)).toEqual([]);
  });

  it('reuses matching columns and only fills in missing type values', () => {
    const config = {
      properties: [
        { name: 'notes', type: 'links' },
        { name: 'h', type: 'number' },
        { name: 'd', type: 'date' },
        { name: 't', type: 'select', label: 'Type', options: [{ value: 'lane' }, { value: 'live', color: 'red' }] },
      ],
    } as DatabaseConfig;
    expect(logShapeMissing(config.properties)).toEqual(['Type values']);
    expect(shapeLogConfig(config)).toEqual({ logItem: 'notes', logHours: 'h', logDate: 'd', logType: 't' });
    expect(config.properties).toHaveLength(4);
    expect(config.properties[3].options).toEqual([
      { value: 'lane' },
      { value: 'live', color: 'red' },
      { value: 'detour', label: 'Detour' },
      { value: 'trial', label: 'Trial' },
    ]);
  });
});
