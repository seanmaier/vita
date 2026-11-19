import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { check, formatPath } from './issues.ts';

describe('formatPath', () => {
  it('writes object keys with dots and array indexes in brackets', () => {
    expect(formatPath(['experience', 0, 'title'])).toBe('experience[0].title');
    expect(formatPath([2, 'name'])).toBe('[2].name');
    expect(formatPath([])).toBe('');
  });
});

describe('check', () => {
  const schema = z.object({ items: z.array(z.object({ url: z.string({ error: 'must be a string' }) })) });

  it('returns the parsed value', () => {
    expect(check(schema, { items: [{ url: 'x' }] }, 'quoted')).toEqual({ ok: true, value: { items: [{ url: 'x' }] } });
  });

  it('formats every issue in the style the API has always used', () => {
    const input = { items: [{ url: 1 }, {}] };
    expect(check(schema, input, 'quoted')).toEqual({
      ok: false,
      errors: ['"items[0].url" must be a string', '"items[1].url" must be a string'],
    });
    expect(check(schema, input, 'colon', ['leads', 3])).toEqual({
      ok: false,
      errors: ['leads[3].items[0].url: must be a string', 'leads[3].items[1].url: must be a string'],
    });
  });

  it('leaves a message without a path as it is', () => {
    expect(check(z.string({ error: 'Expected text.' }), 5, 'quoted')).toEqual({ ok: false, errors: ['Expected text.'] });
  });
});
