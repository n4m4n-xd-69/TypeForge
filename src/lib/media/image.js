/**
 * Validate/downscale, parameterized by caller-supplied limits.
 *
 * Extracted out of `lib/community/photo.js` because chat image uploads
 * (Community Live Chat, Phase 1) need the same two checks with different
 * numbers — a 5 MB / 1600px chat image is not a 2 MB / 512px avatar — and the
 * alternative was a second copy of both functions.
 */

export class ImageError extends Error {}

/** Human-facing validation, run before any work is done. */
export function validateImage(file, { maxBytes, accepted }) {
  if (!file) return 'Choose an image first.';
  if (!accepted.includes(file.type)) {
    return 'That file type is not supported. Use a PNG, JPEG, WebP or GIF.';
  }
  if (file.size > maxBytes) {
    const limitMb = (maxBytes / 1024 / 1024).toFixed(1);
    const fileMb = Math.ceil((file.size / 1024 / 1024) * 10) / 10;
    return `That image is ${fileMb.toFixed(1)} MB. The limit is ${limitMb} MB.`;
  }
  return null;
}

/**
 * Downscales to at most `maxEdge` on the long side, preserving aspect ratio.
 *
 * Falls back to the original file on any failure rather than blocking the
 * upload — see `photo.js`'s original comment on why. An animated GIF passes
 * through untouched: drawing one to a canvas keeps only the first frame.
 */
export async function downscaleImage(file, { maxEdge }) {
  if (typeof document === 'undefined' || file.type === 'image/gif') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) {
      bitmap.close?.();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], 'image.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}
