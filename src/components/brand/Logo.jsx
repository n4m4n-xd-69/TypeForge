/**
 * The TypeForge mark.
 *
 * A caret struck through a bar — the two things the product is about, drawn
 * as one shape. The upward chevron is the caret and the motion it implies;
 * the bar beneath it is the baseline that caret runs along, cut short on the
 * right so the form reads as advancing rather than closed.
 *
 * Geometry notes, because they are load-bearing rather than taste:
 *
 *   The chevron is built from two strokes meeting at a mitre rather than a
 *   single polyline with a join, so the apex stays sharp at 16px where a
 *   round join would blunt it into a dot.
 *
 *   Everything is expressed in a 0-100 box and scaled by the viewBox, so a
 *   favicon and a 96px hero mark are the same shape at different sizes
 *   rather than two drawings that drifted apart.
 *
 * Everything that draws the logo — header, boot screen, favicon, app icons —
 * derives from the constants below, so there is exactly one shape to change.
 */

/** Corner radius of the tile, as a percentage of its side. */
export const LOGO_TILE_RADIUS = 22;

/**
 * The block caret, leaning into its own direction of travel.
 *
 * Two earlier passes drew a chevron above a bar. Both read as the eject
 * glyph, and no amount of adjusting the proportions fixed it — a chevron
 * over a detached bar *is* that symbol, so the concept was wrong rather
 * than the measurements. This is the other thing a caret can be: the solid
 * block a terminal or an editor parks under the next character.
 *
 * The lean is 14°, forward. Upright it is a cursor; leaning it is a cursor
 * with momentum, which is the whole product in one property. The trailing
 * block behind it is the same shape at 40% height, reading as the position
 * just left behind.
 *
 * Solid forms rather than strokes: at 16px a stroked outline closes up into
 * a smudge, while a filled parallelogram holds its silhouette all the way
 * down to a favicon.
 */
export const LOGO_CARET_PATH = 'M45 16 L73 16 L59 84 L31 84 Z';

/** The trail — where the caret was a moment ago. */
export const LOGO_BAR_PATH = 'M23 55 L35 55 L29 84 L17 84 Z';

/**
 * Brand colours are literals, not theme tokens.
 *
 * `--brand-solid` happens to be this exact orange today, but the mark must
 * not change if that token is ever retuned for contrast. A logo that shifts
 * with the palette is not a logo.
 */
export const LOGO_FORGE = '#FF7A2F';
export const LOGO_INK = '#0A0B0D';

/**
 * House tilt, in degrees. Negative is anticlockwise.
 *
 * Applied as a CSS transform on the <svg> box rather than inside the viewBox:
 * SVG clips its own viewport, so rotating the artwork internally would shave
 * the tile's corners unless the viewBox grew to match. Rotating the element
 * happens after that clip, so the mark stays whole and the layout box stays
 * square — nothing reflows around it.
 *
 * Square icon canvases (favicon, apple-touch-icon, PWA icons) deliberately do
 * NOT take this: the tile *is* the canvas there, so a tilt would leave the
 * corners empty and every OS mask would crop it wrong.
 */
export const LOGO_TILT = 0;

function tiltStyle(tilt, style) {
  if (!tilt) return style;
  return { transform: `rotate(${tilt}deg)`, ...style };
}

/**
 * The full mark: forge tile, dark glyph.
 *
 * Pass `title` when the logo is the only thing identifying a link or control;
 * leave it off when adjacent text already names it, and the svg is hidden from
 * assistive tech instead of read out as a duplicate.
 *
 * `tilt` takes degrees, or `0` for upright. A caller's own `style.transform`
 * wins, so composing another transform stays possible.
 */
export default function Logo({ size = 32, title, className, tilt = LOGO_TILT, style, ...rest }) {
  const labelled = Boolean(title);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={tiltStyle(tilt, style)}
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      {...rest}
    >
      {labelled ? <title>{title}</title> : null}
      <rect width="100" height="100" rx={LOGO_TILE_RADIUS} fill={LOGO_FORGE} />
      <path d={LOGO_CARET_PATH} fill={LOGO_INK} />
      <path d={LOGO_BAR_PATH} fill={LOGO_INK} />
    </svg>
  );
}

/**
 * Wordmark plus mark, as one unit.
 *
 * The gap and the optical alignment between the two live here rather than at
 * each call site, because they were drifting: the header, the boot screen and
 * the landing hero each had their own spacing and none of them matched.
 */
export function Wordmark({ size = 28, className, ...rest }) {
  return (
    <span className={className} {...rest}>
      <Logo size={size} className="shrink-0" />
      <span
        className="font-display font-bold tracking-[-0.03em]"
        style={{ fontSize: size * 0.72 }}
      >
        TypeForge
      </span>
    </span>
  );
}
