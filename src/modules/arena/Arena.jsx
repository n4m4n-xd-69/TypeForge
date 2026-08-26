import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Swords } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Primitives.jsx';
import { Reveal } from '../../components/ui/Motion.jsx';
import { cx } from '../../lib/format.js';
import { ARENA_COMPARISON, ARENA_LANES } from './lanes.js';

/**
 * The Arena gate.
 *
 * The rail's `Compete` entry used to drop you straight into the Battlefield
 * hub, which quietly asserted that Battlefield *is* competing here. It isn't
 * — Shadow Battle was reachable only from a Home card and the ⌘K palette, so
 * half the competitive surface was undiscoverable from the navigation.
 *
 * This is the fork, made a place. See
 * docs/superpowers/plans/2026-08-25-arena-gate-nav.md §1 for why a gate rather
 * than the seventh nav item docs/08-PRD-shadow-battle.md §23.2 originally
 * specified: the gate satisfies SB-NAV-1 and SB-NAV-2 by construction instead
 * of by adding a `short` field and a second item that also says "Battle".
 *
 * `/battle` and `/shadow` remain directly addressable. A gate you cannot skip
 * is a toll booth, and a shared room PIN must never route through one.
 */

/**
 * Per-lane paint.
 *
 * Left is `brand`, right is `accent`, matching Shadow Battle's own Side-Color
 * Rule as enforced in FighterCanvas.jsx — the colour you pick on this page is
 * the colour you fight in.
 *
 * Note what is *not* here: a filled accent button. `--accent` flips between
 * themes (a light steel blue on dark, a dark steel blue on light) while
 * `--accent-ink` stays near-black in both, so `bg-accent text-accent-ink`
 * measures fine in dark mode and around 1.4:1 in light. That is the concrete
 * reason Button.jsx says there is deliberately no second filled variant. Both
 * CTAs therefore use the forge fill, whose ink pairing is theme-stable at
 * 7.57:1; lane identity is carried by the rule, the tile, the markers and the
 * hover ring instead. It also happens to be the honest hierarchy — this page
 * has two equal actions and no default.
 */
const TONES = {
  brand: {
    rule: 'bg-brand-solid',
    tile: 'bg-brand-wash text-brand',
    marker: 'bg-brand',
    ring: 'hover:border-brand/40 hover:ring-1 hover:ring-brand/25',
    kbd: 'border-brand/30 text-brand',
  },
  accent: {
    rule: 'bg-accent',
    tile: 'bg-accent-wash text-accent',
    marker: 'bg-accent',
    ring: 'hover:border-accent/40 hover:ring-1 hover:ring-accent/25',
    kbd: 'border-accent/30 text-accent',
  },
};

export default function Arena() {
  const navigate = useNavigate();

  /**
   * `B` and `S` jump straight in.
   *
   * Battlefield used to be one click from the rail and is now two, so the
   * keyboard gets that click back — on a typing product the hands are already
   * where they need to be. Guarded against modifier chords (⌘K owns its own)
   * and against editable targets, though this page has no text input today;
   * the guard is for whoever adds one.
   */
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return;

      const lane = ARENA_LANES.find((l) => l.hotkey.toLowerCase() === e.key?.toLowerCase());
      if (!lane) return;
      e.preventDefault();
      navigate(lane.to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="space-y-3">
      <header>
        <p className="eyebrow">Compete</p>
        <h1 className="mt-0.5 font-display text-3xl font-bold">Choose your war</h1>
        <p className="mt-0.5 max-w-[62ch] text-sm leading-relaxed text-ink-3">
          Two ways to type against someone who is trying to beat you. One is a race down a shared
          passage. The other is a fight where every word you land is a hit.
        </p>
      </header>

      {/* The divider is its own grid column rather than a border on a card, so
          the VS medallion can sit on the seam without either lane owning it. */}
      <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] lg:gap-2">
        <Reveal>
          <Lane lane={ARENA_LANES[0]} />
        </Reveal>

        <VersusSeam />

        <Reveal delay={0.08}>
          <Lane lane={ARENA_LANES[1]} />
        </Reveal>
      </div>

      <Reveal delay={0.14}>
        <ComparisonStrip />
      </Reveal>
    </div>
  );
}

/**
 * One side of the fork.
 *
 * `h-full` plus `flex-1` on the spacer keeps both CTAs on the same baseline
 * even though the two intros are different lengths — a gate where one button
 * sits higher than the other reads as one option being the real one.
 */
function Lane({ lane }) {
  const t = TONES[lane.tone];
  const Icon = lane.icon;

  return (
    <Card
      className={cx(
        'relative flex h-full flex-col overflow-hidden p-3',
        'transition-[border-color,box-shadow,transform] duration-base ease-out hover:-translate-y-px',
        t.ring,
      )}
    >
      <span className={cx('absolute inset-x-0 top-0 h-[3px]', t.rule)} aria-hidden />

      <div className="flex items-center gap-1.5">
        <span className={cx('grid h-[40px] w-[40px] shrink-0 place-items-center rounded-md', t.tile)}>
          <Icon size={21} strokeWidth={2.2} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="eyebrow">{lane.eyebrow}</p>
          <h2 className="font-display text-xl font-bold tracking-[-0.02em]">{lane.title}</h2>
        </div>
      </div>

      <p className="mt-2 text-base font-semibold text-ink-2">{lane.tagline}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-3">{lane.intro}</p>

      <ul className="mt-2 space-y-1">
        {lane.beats.map((beat) => (
          <li key={beat} className="flex items-start gap-1 text-sm text-ink-2">
            {/* A dot, not a checkmark: these are properties of the mode, not
                features it has been certified for. */}
            <span className={cx('mt-[7px] h-1 w-1 shrink-0 rounded-full', t.marker)} aria-hidden />
            <span className="leading-relaxed">{beat}</span>
          </li>
        ))}
      </ul>

      <div className="flex-1" aria-hidden />

      <Button
        as={Link}
        to={lane.to}
        variant="primary"
        size="lg"
        iconRight={ArrowRight}
        className="mt-3 w-full"
      >
        {lane.cta}
      </Button>

      <p className="mt-1 text-center text-2xs text-ink-3">
        or press{' '}
        <kbd className={cx('rounded-xs border bg-surface px-0.5 font-mono font-bold', t.kbd)}>
          {lane.hotkey}
        </kbd>
      </p>
    </Card>
  );
}

/**
 * The seam between the two lanes.
 *
 * Purely decorative and `aria-hidden` — a screen reader gets two headed
 * regions in order, which is already the whole structure. Hidden below `lg`,
 * where the lanes stack and a vertical rule between them would be a rule
 * pointing at nothing.
 */
function VersusSeam() {
  return (
    <div className="hidden flex-col items-center lg:flex" aria-hidden>
      <span className="w-px flex-1 bg-gradient-to-b from-transparent via-line to-line" />
      <span className="my-1 grid h-[36px] w-[36px] shrink-0 place-items-center rounded-full border border-line bg-surface shadow-e2">
        <Swords size={15} strokeWidth={2.4} className="text-ink-3" />
      </span>
      <span className="w-px flex-1 bg-gradient-to-t from-transparent via-line to-line" />
    </div>
  );
}

/**
 * The tie-breaker.
 *
 * Neither lane should have to argue against the other, so the comparison is
 * pulled out into plain rows of fact. A real `<table>` because it is one —
 * three rows keyed by attribute, two columns keyed by mode.
 */
function ComparisonStrip() {
  return (
    <Card className="overflow-hidden">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Battlefield compared with Shadow Battle</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-2 py-1.5 text-left">
              <span className="eyebrow">Side by side</span>
            </th>
            {ARENA_LANES.map((lane) => (
              <th key={lane.id} scope="col" className="px-2 py-1.5 text-left text-sm font-bold">
                {lane.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ARENA_COMPARISON.map((row, i) => (
            <tr key={row.label} className={cx(i > 0 && 'border-t border-line')}>
              <th scope="row" className="px-2 py-1.5 text-left text-sm font-bold text-ink-2">
                {row.label}
              </th>
              {/* Keyed off the lane id rather than written out in order, so the
                  cells cannot drift out of step with the header above them. */}
              {ARENA_LANES.map((lane) => (
                <td key={lane.id} className="px-2 py-1.5 text-ink-3">{row[lane.id]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
