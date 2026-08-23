import { forwardRef } from 'react';
import { cx } from '../../lib/format.js';

/**
 * Variants.
 *
 * `primary` is the forge fill and carries dark ink in both themes. That is
 * not a stylistic choice: white on the forge orange measures 2.60:1 and
 * fails AA, while the near-black ink measures 7.57:1. `scripts/check-contrast.mjs`
 * fails the build if either number moves.
 *
 * There is deliberately no second filled variant. One accent, rationed —
 * if two things on a screen are filled, neither reads as the action.
 */
const FILLED = 'bg-brand-solid text-brand-ink hover:brightness-[1.08] shadow-e1';

const VARIANTS = {
  primary: FILLED,
  /* `brand` and `primary` were two different fills before: primary was
     ink-on-light / forge-on-dark, brand was always forge. With one accent
     they are the same thing, so this is an alias rather than a duplicate.
     Nine call sites still say "brand"; they render identically and migrate
     as each surface is redesigned. */
  brand: FILLED,
  secondary: 'bg-surface text-ink border border-line-strong hover:border-ink-3 hover:bg-raised',
  ghost: 'text-ink-2 hover:text-ink hover:bg-raised',
  quiet: 'text-ink-3 hover:text-ink-2',
  danger: 'text-bad border border-bad/40 hover:bg-bad/10',
};

/**
 * Heights are 32/40/48. The touch target is padded to 44px on coarse
 * pointers rather than the height being raised, so a dense toolbar keeps its
 * rhythm on a desktop while staying tappable on a phone.
 */
const SIZES = {
  sm: 'h-[32px] px-1.5 text-xs gap-0.5 rounded-sm',
  md: 'h-[40px] px-2 text-sm gap-1 rounded-sm',
  lg: 'h-[48px] px-3 text-base gap-1 rounded-md',
};

const ICON_SIZE = { sm: 14, md: 16, lg: 18 };

/**
 * The one button.
 *
 * The pointer-following ripple was removed. It ran a 600ms animation and a
 * state update on every press — on the typing surfaces that is a re-render
 * in the middle of a keystroke — and it communicated nothing the 80ms press
 * scale does not. Feedback should be the shortest signal that reads.
 */
const Button = forwardRef(function Button(
  {
    as: Tag = 'button',
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    loading = false,
    className,
    children,
    ...props
  },
  ref,
) {
  const glyph = ICON_SIZE[size];
  const disabled = props.disabled || loading;

  return (
    <Tag
      ref={ref}
      {...props}
      disabled={Tag === 'button' ? disabled : undefined}
      aria-busy={loading || undefined}
      className={cx(
        'relative inline-flex select-none items-center justify-center whitespace-nowrap font-semibold',
        'transition-[background-color,color,border-color,box-shadow,filter] duration-fast ease-out',
        'active:scale-[0.98] active:duration-instant',
        'disabled:pointer-events-none disabled:opacity-40',
        // Coarse pointers get the 44px target without changing visual height.
        'max-[1023px]:[@media(pointer:coarse)]:min-h-[44px]',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? (
        /* Occupies the leading icon's slot so the label never shifts. */
        <Spinner size={glyph} />
      ) : Icon ? (
        <Icon size={glyph} strokeWidth={2} aria-hidden />
      ) : null}
      {children}
      {IconRight ? <IconRight size={glyph} strokeWidth={2} aria-hidden /> : null}
    </Tag>
  );
});

export default Button;

/** Icon-only. `label` is required — it becomes both the tooltip and the
 *  accessible name, so an icon button can never ship unnamed. */
export function IconButton({ label, icon: Icon, className, size = 'md', ...props }) {
  return (
    <Button
      variant="ghost"
      size={size}
      aria-label={label}
      title={label}
      className={cx('aspect-square !px-0', className)}
      {...props}
    >
      <Icon size={ICON_SIZE[size]} strokeWidth={2} aria-hidden />
    </Button>
  );
}

/** CSS-only, so a loading button costs no JavaScript and no re-render. */
function Spinner({ size }) {
  return (
    <span
      aria-hidden
      className="animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
      style={{ width: size, height: size }}
    />
  );
}
