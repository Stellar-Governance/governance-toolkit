import { describe as suite, expect, it } from 'vitest';
import { describe } from './index.js';

suite('describe', () => {
  it('joins name and version', () => {
    expect(describe('0.1.0')).toBe('governance-toolkit 0.1.0');
  });

  it('rejects an empty version', () => {
    expect(() => describe('')).toThrow(RangeError);
  });
});
