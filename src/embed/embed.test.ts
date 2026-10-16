import { describe, expect, it } from 'vitest';
import { parseEmbed } from './Embed';

describe('embed blocks', () => {
  it('reads file, view and height', () => {
    expect(parseEmbed('file: Games/Backlog.board\nview: Board\nheight: 400')).toEqual({ file: 'Games/Backlog.board', view: 'Board', height: 400 });
  });

  it("reads R Sheet's table-chart blocks: chart names a view; ids are ignored", () => {
    expect(parseEmbed('file: R Sheet/Expenses.table\nchart: Monthly spending by type\nid: chmonthly')).toEqual({
      file: 'R Sheet/Expenses.table',
      view: 'Monthly spending by type',
      height: undefined,
    });
  });

  it('accepts wikilinks and asks for a file when missing', () => {
    expect(parseEmbed('file: [[Expenses.table]]')).toMatchObject({ file: 'Expenses.table' });
    expect(parseEmbed('view: Board')).toHaveProperty('error');
  });
});
