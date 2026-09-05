import { supabase } from '../supabase.js';

/**
 * Profile photo upload.
 *
 * Three things happen before a byte leaves the browser, and each exists because
 * the alternative is a failure the user cannot act on:
 *
 *   1. **Type and size are checked here as well as in the bucket.** The bucket
 *      rejects an oversized file with a 413 and a message about MIME types.
 *      Checking first turns that into "that image is 6 MB; the limit is 2 MB",
 *      which is a sentence someone can do something about.
 *   2. **The image is downscaled.** A phone photo is 4000px and several
 *      megabytes to render a 38px avatar. Resizing to 512px costs a moment on
 *      one device and saves the download on every device that ever sees it.
 *   3. **The path is namespaced by user id.** The storage policy requires the
 *      first path segment to equal `auth.uid()`, so this is not a convention —
 *      a path built any other way is refused by Postgres.
 */

export const MAX_BYTES = 2 * 1024 * 1024; // 2 MB, matching the bucket's own limit
export const MAX_EDGE = 512;              // px, the largest this is ever displayed at
export const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const ACCEPT_ATTR = ACCEPTED.join(',');

export class PhotoError extends Error {}

/** Human-facing validation, run before any work is done. */
export function validatePhoto(file) {
  if (!file) return 'Choose an image first.';
  if (!ACCEPTED.includes(file.type)) {
    return 'That file type is not supported. Use a PNG, JPEG, WebP or GIF.';
  }
  if (file.size > MAX_BYTES) {
    return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`;
  }
  return null;
}

/**
 * Downscales to at most MAX_EDGE on the long side, preserving aspect ratio.
 *
 * Falls back to the original file on any failure rather than blocking the
 * upload: a resize is an optimisation, and refusing to save someone's photo
 * because a canvas call failed would be trading their goal for ours. An
 * animated GIF is passed through untouched — drawing one to a canvas would
 * silently keep only the first frame.
 */
export async function downscale(file) {
  if (typeof document === 'undefined' || file.type === 'image/gif') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
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
    return new File([blob], 'photo.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}

/**
 * Uploads and returns the public URL.
 *
 * `onProgress` is called with 0..1. Supabase's storage client does not report
 * upload progress, so the values are staged around the two real milestones
 * (resize done, upload done) rather than invented per byte — a progress bar
 * that animates smoothly to 90% and then stalls is a worse lie than one that
 * moves in steps it can actually justify.
 */
export async function uploadProfilePhoto(userId, file, onProgress = () => {}) {
  if (!supabase) throw new PhotoError('Cloud sync is not configured, so uploads are unavailable.');
  if (!userId) throw new PhotoError('Sign in before uploading a photo.');

  const invalid = validatePhoto(file);
  if (invalid) throw new PhotoError(invalid);

  onProgress(0.1);
  const prepared = await downscale(file);
  onProgress(0.4);

  const ext = prepared.type === 'image/webp' ? 'webp' : (prepared.name.split('.').pop() || 'jpg');
  // Cache-busting by filename, not by query string. The bucket is public and
  // CDN-cached, so replacing a photo at a fixed path leaves the old bytes
  // served for as long as the cache holds them.
  const path = `${userId}/photo-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, prepared, { cacheControl: '3600', upsert: true, contentType: prepared.type });

  if (error) {
    if (/exceeded the maximum allowed size|413/i.test(error.message)) {
      throw new PhotoError('That image is too large. The limit is 2 MB.');
    }
    if (/mime type|not supported/i.test(error.message)) {
      throw new PhotoError('That file type is not supported. Use a PNG, JPEG, WebP or GIF.');
    }
    if (/row-level security|Unauthorized|403/i.test(error.message)) {
      throw new PhotoError('You are not allowed to upload here. Try signing in again.');
    }
    throw new PhotoError(error.message || 'The upload failed. Try again.');
  }

  onProgress(0.9);
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  onProgress(1);
  return data.publicUrl;
}

/**
 * Removes a previously uploaded photo.
 *
 * Best-effort on the storage object: the profile column is what the app reads,
 * so clearing that is what the user asked for, and a stale orphaned object is a
 * housekeeping problem rather than a visible failure. Only ever touches a path
 * inside the caller's own folder — the storage policy enforces the same.
 */
export async function deleteProfilePhoto(userId, photoUrl) {
  if (!supabase || !photoUrl) return;
  const marker = '/avatars/';
  const at = photoUrl.indexOf(marker);
  if (at === -1) return;
  const path = photoUrl.slice(at + marker.length);
  if (!path.startsWith(`${userId}/`)) return;
  await supabase.storage.from('avatars').remove([path]).catch(() => {});
}
