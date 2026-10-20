import { describe, expect, it } from 'vitest';
import { bookFromData, itemList, newData, parseData, renameItem, setItemTransport, type FactoryData } from './book';

const sample = (): FactoryData => ({
  recipes: [
    { id: 'r1', name: 'Ingot', machine: 'Smelter', time: 2, inputs: [{ item: 'Iron Ore', qty: 1 }], outputs: [{ item: 'Iron Ingot', qty: 1 }] },
    { id: 'r2', name: '', machine: 'Refinery', time: 6, inputs: [{ item: 'Iron Ore', qty: 2 }, { item: 'Water', qty: 1 }], outputs: [{ item: 'Iron Ingot', qty: 3 }] },
    { id: 'r3', name: 'Half done', machine: '', time: 1, inputs: [{ item: 'Iron Ore', qty: 1 }], outputs: [] },
  ],
  items: [{ name: 'Water', transport: 'Pipe' }, { name: 'Old Thing', transport: 'Belt' }],
  transport: [{ id: 't1', name: 'Belt Mk1', type: 'Belt', rate: 60 }, { id: 't2', name: 'Pipe Mk1', type: 'Pipe', rate: 300 }],
});

describe('factory data', () => {
  it('registers every item the recipes name, with use counts', () => {
    expect(itemList(sample()).map((i) => [i.name, i.transport ?? '', i.made, i.used])).toEqual([
      ['Iron Ingot', '', 2, 0],
      ['Iron Ore', '', 0, 3],
      ['Water', 'Pipe', 0, 1],
      ['Old Thing', 'Belt', 0, 0],
    ]);
  });

  it('builds the solver book and flags items without transport', () => {
    const b = bookFromData(sample());
    expect(b.recipes.map((r) => r.name)).toEqual(['Ingot', 'Iron Ingot']); // unnamed: its main product; half-done rows skipped
    expect(b.unassigned).toEqual(['Iron Ingot', 'Iron Ore']);
    expect(b.transport?.types.get('water')).toBe('Pipe');
    expect(bookFromData({ ...sample(), transport: [] }).unassigned).toBeUndefined(); // no transport at all: nothing to flag
  });

  it('asks for a time', () => {
    const d = sample();
    d.recipes[0].time = 0;
    expect(bookFromData(d).errors).toEqual(['Recipe "Ingot" needs a time.']);
  });

  it('sets transport per item and renames an item everywhere', () => {
    let d = setItemTransport(sample(), 'Iron Ore', 'Belt');
    expect(itemList(d).find((i) => i.name === 'Iron Ore')?.transport).toBe('Belt');
    d = renameItem(d, 'iron ore', 'Raw Iron');
    expect(d.recipes[1].inputs[0].item).toBe('Raw Iron');
    expect(d.items.find((i) => i.name === 'Raw Iron')?.transport).toBe('Belt');
    expect(setItemTransport(d, 'Raw Iron', null).items.some((i) => i.name === 'Raw Iron')).toBe(false);
  });

  it('converts data saved as R Board tables', () => {
    const table = (properties: unknown[], rows: unknown[]) => ({ version: 1, kind: 'table', properties, views: [{ name: 'Table', type: 'table' }], rows });
    const d = parseData({
      recipes: table(
        [{ name: 'recipe', label: 'Recipe', type: 'text' }, { name: 'machine', label: 'Machine', type: 'text' }, { name: 'time', label: 'Time', type: 'number' }, { name: 'inputs', label: 'Inputs', type: 'text' }, { name: 'outputs', label: 'Outputs', type: 'text' }],
        [{ id: 'a', cells: { recipe: 'Ingot', machine: 'Smelter', time: 2, inputs: '1 Iron Ore', outputs: '1 Iron Ingot' } }, { id: 'b', cells: {} }],
      ),
      items: table([{ name: 'item', label: 'Item', type: 'text' }, { name: 'transport', label: 'Transport', type: 'text' }], [{ id: 'i', cells: { item: 'iron ore', transport: 'Belt' } }]),
      transport: table([{ name: 'name', label: 'Name', type: 'text' }, { name: 'type', label: 'Type', type: 'text' }, { name: 'rate', label: 'Rate', type: 'number' }], [{ id: 't', cells: { name: 'Belt Mk1', type: 'Belt', rate: 60 } }]),
    });
    expect(d.recipes.map((r) => [r.name, r.inputs, r.outputs])).toEqual([['Ingot', [{ item: 'Iron Ore', qty: 1 }], [{ item: 'Iron Ingot', qty: 1 }]]]);
    expect(d.items).toEqual([{ name: 'Iron Ore', transport: 'Belt' }]); // recipe spelling restored
    expect(d.transport.map((t) => [t.name, t.type, t.rate])).toEqual([['Belt Mk1', 'Belt', 60]]);
    expect(parseData(undefined)).toEqual(newData());
  });
});
