/**
 * Forge AI's face.
 *
 * The animated character from /Fap Bot (464-frame cycle, true alpha), served
 * from /brand/forge-ai.gif. An <img> rather than inlined SVG on purpose: the
 * cycle is far richer than anything we'd re-keyframe, and a raster at 320px
 * stays clean down to the smallest size we mount it at. Draggable is off —
 * an avatar that drags itself out of its own header is a support ticket.
 *
 * Reduced motion: an <img> gif cannot be paused without canvas surgery; at
 * avatar sizes it is decorative and small, so it plays. Everything else in
 * the surfaces it appears on honours the preference.
 */
const SRC = '/brand/forge-ai.gif';

export default function ForgeAvatar({ size = 28, className, style, ...rest }) {
  return (
    <img
      src={SRC}
      width={size}
      height={size}
      alt=""
      draggable={false}
      decoding="async"
      loading="eager"
      className={className}
      style={style}
      {...rest}
    />
  );
}
