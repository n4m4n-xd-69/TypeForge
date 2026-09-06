import { describe, expect, it } from 'vitest';
import { validateImage, downscaleImage } from './image.js';

function file(type, size) {
  const f = new File([new Uint8Array(size)], 'x', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('validateImage', () => {
  const opts = { maxBytes: 1000, accepted: ['image/png', 'image/jpeg'] };

  it('accepts a file within type and size bounds', () => {
    expect(validateImage(file('image/png', 500), opts)).toBeNull();
  });

  it('rejects an unsupported type', () => {
    expect(validateImage(file('application/pdf', 500), opts)).toMatch(/not supported/);
  });

  it('rejects a file over the byte limit, naming the actual size', () => {
    const message = validateImage(file('image/png', 2 * 1024 * 1024), { maxBytes: 1 * 1024 * 1024, accepted: ['image/png'] });
    expect(message).toMatch(/2 MB/);   // whole-number MB: no decimal
    expect(message).toMatch(/limit is 1 MB/);
  });

  it('formats fractional MB in size and limit', () => {
    const bytes = 3 * 1024 * 1024;
    const maxBytes = 1.5 * 1024 * 1024;
    const message = validateImage(file('image/png', bytes), { maxBytes, accepted: ['image/png'] });
    expect(message).toMatch(/3 MB/);
    expect(message).toMatch(/limit is 1\.5 MB/);
  });

  it('accepts a file exactly at the byte limit', () => {
    expect(validateImage(file('image/png', 1000), opts)).toBeNull();
  });

  it('rejects a missing file', () => {
    expect(validateImage(null, opts)).toMatch(/Choose an image/);
  });
});

describe('downscaleImage', () => {
  it('passes the file through unchanged outside a DOM environment', async () => {
    // vitest runs with environment: 'node' — no `document`, so this exercises
    // the same early-return branch downscale() already relies on.
    const f = file('image/png', 500);
    await expect(downscaleImage(f, { maxEdge: 512 })).resolves.toBe(f);
  });

  it('passes an animated GIF through untouched regardless of environment', async () => {
    const f = file('image/gif', 500);
    await expect(downscaleImage(f, { maxEdge: 512 })).resolves.toBe(f);
  });
});
