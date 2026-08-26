/**
 * Forge AI's face.
 *
 * The animated character from /brand/forge-ai.gif (464-frame cycle, true alpha).
 * An <img> rather than inlined SVG on purpose: the cycle is far richer than
 * anything we'd re-keyframe, and a raster at 320px stays clean down to the
 * smallest size we mount it at. Draggable is off — an avatar that drags itself
 * out of its own header is a support ticket.
 *
 * Reduced motion: the GIF cannot be paused natively; we swap to a static SVG
 * avatar when prefers-reduced-motion is set so vestibular-sensitive users are
 * not subjected to perpetual animation.
 */

import { useReducedMotionSafe } from '../../lib/motion.js';
import { motion } from 'framer-motion';

const SRC = '/brand/forge-ai.gif';

/** Static fallback — a simple forge tile with the AI spark, matching the brand. */
const STATIC_AVATAR_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Forge AI">
  <rect width="100" height="100" rx="22" fill="#FF7A2F"/>
  <path d="M45 16 L73 16 L59 84 L31 84 Z" fill="#0A0B0D"/>
  <path d="M23 55 L35 55 L29 84 L17 84 Z" fill="#0A0B0D"/>
  <circle cx="72" cy="28" r="14" fill="#FF7A2F" fill-opacity="0.9"/>
  <path d="M72 18 L72 24 M68 21 L76 21 M66 25 L78 25" stroke="#0A0B0D" stroke-width="3" stroke-linecap="round"/>
</svg>
`;

export default function ForgeAvatar({ size = 28, className, style, animate, transition, ...rest }) {
  const reduce = useReducedMotionSafe();

  if (reduce) {
    return (
      <span
        className={className}
        style={{ width: size, height: size, display: 'inline-block', ...style }}
        {...rest}
        dangerouslySetInnerHTML={{ __html: STATIC_AVATAR_SVG }}
      />
    );
  }

  return (
    <motion.img
      src={SRC}
      width={size}
      height={size}
      alt=""
      draggable={false}
      decoding="async"
      loading="eager"
      className={className}
      style={style}
      animate={animate}
      transition={transition}
      {...rest}
    />
  );
}
