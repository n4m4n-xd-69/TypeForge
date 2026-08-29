import { cx } from '../../lib/format.js';

/**
 * Forge AI, as a face.
 *
 * One definition for every place the coach appears — the hero on the blank
 * state, the header mark, the badge beside the newest answer, and the floating
 * button on every other route. They differ only in `size`, so the assistant is
 * recognisably the same object at 26px and at 132px.
 *
 * The mascot is the GIF and nothing else: no disc, no halo, no ring, no cast
 * reflection. The blob already has its own silhouette and shading, and every
 * shape drawn behind it competed with that rather than supporting it. All it
 * gets is a soft contact shadow tinted to its own orange, applied in CSS.
 *
 * `busy` is the whole state machine: idle drifts, thinking breathes faster.
 * There is deliberately no third state — a mascot with five moods reads as a
 * toy, and this one sits next to text you are trying to read.
 *
 * Marked `aria-hidden` unless given a `label`: everywhere it renders, the name
 * "Forge AI" or the message role is already adjacent in text, so announcing it
 * again would just add noise to a screen reader walking the transcript.
 */
export default function ForgeAvatar({ size = 40, busy = false, className, label }) {
  return (
    <div
      className={cx('fap-orb', busy && 'fap-orb-busy', className)}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <img
        src="/forge-ai.gif"
        alt=""
        width={size}
        height={size}
        decoding="async"
        draggable={false}
      />
    </div>
  );
}
