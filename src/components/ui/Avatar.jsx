import { PRESET_AVATARS, defaultPresetFor, findPreset, isPreset } from '../../lib/avatars.js';
import { cx } from '../../lib/format.js';

/**
 * Whether a stored avatar value is an image to render rather than a preset id.
 *
 * Deliberately an allow-list of three schemes. `avatar` is a free text column
 * that a person can influence, and rendering it straight into `src` would
 * otherwise accept `javascript:` — which is not a hypothetical shape for a
 * field that also travels to the leaderboard and the admin console.
 */
export function isImageSource(value) {
  if (typeof value !== 'string') return false;
  return value.startsWith('data:image/')
    || value.startsWith('https://')
    || value.startsWith('blob:');
}

/**
 * One avatar, four sources.
 *
 * A preset id draws the tile below, a data URI or an https URL renders an
 * image, and anything else falls back to a preset derived from the name — so a
 * person who has never opened the picker still gets a stable, recognisable tile
 * rather than the same grey circle as everyone else.
 *
 * The https case is not optional. A Google profile photo arrives as a URL, and
 * so does an uploaded photo once it is in storage; before this, both fell
 * through to the name-derived fallback and the picture the person had already
 * provided was silently discarded everywhere it appeared.
 */
export default function Avatar({ value, name, size = 32, className, ring = false, alt }) {
  const preset = isPreset(value) ? findPreset(value) : null;
  const custom = isImageSource(value) ? value : null;
  const fallback = preset ?? defaultPresetFor(name || 'keystroke');

  const shell = cx(
    'shrink-0 overflow-hidden rounded-full',
    ring && 'ring-2 ring-brand ring-offset-2 ring-offset-surface',
    className,
  );

  if (custom) {
    return (
      <img
        src={custom}
        alt={alt ?? `${name || 'Your'} avatar`}
        width={size}
        height={size}
        className={cx(shell, 'object-cover')}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span className={shell} style={{ width: size, height: size, display: 'inline-block', lineHeight: 0 }}>
      <PresetTile preset={fallback} size="100%" title={alt ?? `${name || 'Your'} avatar`} />
    </span>
  );
}

/**
 * The tile.
 *
 * Everything is drawn in a 100×100 box and composed from four independent
 * parts, so a new character is data rather than a new drawing. Ears and hair
 * render *behind* the face circle where they should sit under it, and in front
 * where they overlap — hence the two slots.
 */
export function PresetTile({ preset, size = 32, title }) {
  const { bg, ink, head = 'none', eyes = 'dots', mouth = 'smile', blush } = preset;
  const H = HEADS[head] ?? HEADS.none;

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <rect width="100" height="100" fill={bg} />
      {H.behind?.(ink, bg)}
      {EYES[eyes]?.(ink, bg) ?? EYES.dots(ink, bg)}
      {blush ? (
        <>
          <circle cx="24" cy="58" r="6" fill={ink} opacity="0.18" />
          <circle cx="76" cy="58" r="6" fill={ink} opacity="0.18" />
        </>
      ) : null}
      {MOUTHS[mouth]?.(ink, bg)}
      {H.front?.(ink, bg)}
    </svg>
  );
}

/* ── Heads ────────────────────────────────────────────────────────────────
   `behind` paints under the features (ears, hair mass); `front` paints over
   them (a fringe, a hood edge, a cap brim). */

const HEADS = {
  none: {},

  cat: {
    behind: (ink) => (
      <>
        <path d="M18 30 L22 4 L44 20 Z" fill={ink} />
        <path d="M82 30 L78 4 L56 20 Z" fill={ink} />
      </>
    ),
    front: (ink) => (
      <g stroke={ink} strokeWidth="2.5" strokeLinecap="round" opacity="0.7">
        <path d="M6 62 L22 60" /><path d="M6 70 L22 66" />
        <path d="M94 62 L78 60" /><path d="M94 70 L78 66" />
      </g>
    ),
  },

  dog: {
    behind: (ink) => (
      <>
        <ellipse cx="14" cy="40" rx="11" ry="22" fill={ink} />
        <ellipse cx="86" cy="40" rx="11" ry="22" fill={ink} />
      </>
    ),
  },

  fox: {
    behind: (ink, bg) => (
      <>
        <path d="M16 32 L20 2 L46 22 Z" fill={ink} />
        <path d="M84 32 L80 2 L54 22 Z" fill={ink} />
        <path d="M23 26 L25 12 L37 22 Z" fill={bg} />
        <path d="M77 26 L75 12 L63 22 Z" fill={bg} />
      </>
    ),
  },

  bear: {
    behind: (ink) => (
      <>
        <circle cx="20" cy="20" r="14" fill={ink} />
        <circle cx="80" cy="20" r="14" fill={ink} />
      </>
    ),
  },

  bunny: {
    behind: (ink) => (
      <>
        <ellipse cx="35" cy="14" rx="8" ry="20" fill={ink} />
        <ellipse cx="65" cy="14" rx="8" ry="20" fill={ink} />
      </>
    ),
  },

  hair: {
    behind: (ink) => <path d="M8 52 Q8 8 50 8 Q92 8 92 52 L92 96 L78 96 L78 40 L22 40 L22 96 L8 96 Z" fill={ink} />,
    front: (ink) => <path d="M18 34 Q50 6 82 34 Q66 22 50 26 Q34 22 18 34 Z" fill={ink} />,
  },

  bob: {
    behind: (ink) => <path d="M12 54 Q12 10 50 10 Q88 10 88 54 L88 70 L74 70 L74 40 L26 40 L26 70 L12 70 Z" fill={ink} />,
    front: (ink) => <path d="M20 32 Q50 8 80 32 Q64 20 50 24 Q36 20 20 32 Z" fill={ink} />,
  },

  pony: {
    behind: (ink) => (
      <>
        <path d="M14 50 Q14 10 50 10 Q86 10 86 50 L86 60 L74 60 L74 38 L26 38 L26 60 L14 60 Z" fill={ink} />
        <ellipse cx="88" cy="62" rx="10" ry="24" fill={ink} />
      </>
    ),
  },

  hood: {
    behind: (ink) => <path d="M6 58 Q6 6 50 6 Q94 6 94 58 L94 100 L6 100 Z" fill={ink} />,
    front: (ink, bg) => <ellipse cx="50" cy="52" rx="34" ry="14" fill={bg} />,
  },

  horns: {
    behind: (ink) => (
      <>
        <path d="M22 26 Q14 4 34 12 Z" fill={ink} />
        <path d="M78 26 Q86 4 66 12 Z" fill={ink} />
      </>
    ),
  },

  halo: {
    behind: (ink) => <ellipse cx="50" cy="12" rx="22" ry="6" fill="none" stroke={ink} strokeWidth="5" />,
  },

  cap: {
    front: (ink) => (
      <>
        <path d="M16 30 Q50 2 84 30 Z" fill={ink} />
        <rect x="12" y="28" width="76" height="7" rx="3.5" fill={ink} />
      </>
    ),
  },
};

/* ── Eyes ─────────────────────────────────────────────────────────────────
   Sized to stay readable at 24px, which is where most of these are seen. */

const EYES = {
  dots: (ink) => (
    <>
      <circle cx="36" cy="45" r="6" fill={ink} />
      <circle cx="64" cy="45" r="6" fill={ink} />
    </>
  ),
  wide: (ink, bg) => (
    <>
      <circle cx="35" cy="45" r="10" fill={ink} />
      <circle cx="65" cy="45" r="10" fill={ink} />
      <circle cx="38" cy="42" r="3.4" fill={bg} />
      <circle cx="68" cy="42" r="3.4" fill={bg} />
    </>
  ),
  anime: (ink, bg) => (
    <>
      <ellipse cx="34" cy="46" rx="9" ry="11" fill={ink} />
      <ellipse cx="66" cy="46" rx="9" ry="11" fill={ink} />
      <circle cx="37" cy="42" r="3.6" fill={bg} />
      <circle cx="69" cy="42" r="3.6" fill={bg} />
      <circle cx="31" cy="50" r="1.8" fill={bg} opacity="0.75" />
      <circle cx="63" cy="50" r="1.8" fill={bg} opacity="0.75" />
    </>
  ),
  star: (ink, bg) => (
    <>
      <circle cx="34" cy="46" r="10" fill={ink} />
      <circle cx="66" cy="46" r="10" fill={ink} />
      <path d="M34 40 L36 45 L41 46 L36 48 L34 53 L32 48 L27 46 L32 45 Z" fill={bg} />
      <path d="M66 40 L68 45 L73 46 L68 48 L66 53 L64 48 L59 46 L64 45 Z" fill={bg} />
    </>
  ),
  sleepy: (ink) => (
    <g stroke={ink} strokeWidth="5" strokeLinecap="round" fill="none">
      <path d="M26 46 L44 46" />
      <path d="M56 46 L74 46" />
    </g>
  ),
  happy: (ink) => (
    <g stroke={ink} strokeWidth="5" strokeLinecap="round" fill="none">
      <path d="M27 48 Q36 38 45 48" />
      <path d="M55 48 Q64 38 73 48" />
    </g>
  ),
  wink: (ink) => (
    <>
      <circle cx="35" cy="45" r="6" fill={ink} />
      <path d="M55 47 Q64 38 73 47" stroke={ink} strokeWidth="5" fill="none" strokeLinecap="round" />
    </>
  ),
  smirk: (ink) => (
    <>
      <path d="M27 42 L45 47" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <path d="M73 42 L55 47" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <circle cx="37" cy="50" r="4.5" fill={ink} />
      <circle cx="63" cy="50" r="4.5" fill={ink} />
    </>
  ),
  shades: (ink) => (
    <>
      <rect x="20" y="36" width="26" height="17" rx="6" fill={ink} />
      <rect x="54" y="36" width="26" height="17" rx="6" fill={ink} />
      <rect x="44" y="42" width="12" height="4" rx="2" fill={ink} />
    </>
  ),
  visor: (ink, bg) => (
    <>
      <rect x="16" y="38" width="68" height="16" rx="8" fill={ink} />
      <circle cx="36" cy="46" r="3.4" fill={bg} />
      <circle cx="64" cy="46" r="3.4" fill={bg} />
    </>
  ),
  oh: (ink) => (
    <>
      <ellipse cx="35" cy="45" rx="6" ry="8" fill={ink} />
      <ellipse cx="65" cy="45" rx="6" ry="8" fill={ink} />
    </>
  ),
};

/* ── Mouths ─────────────────────────────────────────────────────────────── */

const MOUTHS = {
  none: () => null,
  smile: (ink) => <path d="M36 66 Q50 78 64 66" stroke={ink} strokeWidth="5" fill="none" strokeLinecap="round" />,
  grin: (ink) => <path d="M34 64 Q50 82 66 64 Z" fill={ink} />,
  flat: (ink) => <path d="M40 68 L60 68" stroke={ink} strokeWidth="5" fill="none" strokeLinecap="round" />,
  smirk: (ink) => <path d="M38 68 Q50 74 62 66" stroke={ink} strokeWidth="5" fill="none" strokeLinecap="round" />,
  oh: (ink) => <ellipse cx="50" cy="70" rx="7" ry="9" fill={ink} />,
  cat: (ink) => (
    <g stroke={ink} strokeWidth="4.5" fill="none" strokeLinecap="round">
      <path d="M38 65 Q44 72 50 65" />
      <path d="M50 65 Q56 72 62 65" />
    </g>
  ),
  tongue: (ink, bg) => (
    <>
      <path d="M36 64 Q50 78 64 64 Z" fill={ink} />
      <path d="M44 72 Q50 84 56 72 Z" fill={bg} opacity="0.85" />
    </>
  ),
  fang: (ink, bg) => (
    <>
      <path d="M36 64 Q50 78 64 64 Z" fill={ink} />
      <path d="M42 66 L46 74 L50 66 Z" fill={bg} />
    </>
  ),
};

export { PRESET_AVATARS };
