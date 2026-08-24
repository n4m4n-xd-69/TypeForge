import { describe, expect, it } from 'vitest';
import { MODE_REGISTRY } from './registry.js';

describe('MODE_REGISTRY', () => {
  it('is an array', () => {
    expect(Array.isArray(MODE_REGISTRY)).toBe(true);
  });
});
