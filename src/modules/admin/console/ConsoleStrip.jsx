import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { Radio, RefreshCw, Rows2, Rows3 } from 'lucide-react';
import { cx } from '../../../lib/format.js';
import { useConsole, RANGE_PRESETS } from '../kit/ConsoleContext.jsx';

/**
 * The operator strip: module navigation and the four global controls.
 *
 * Horizontal, not a second vertical rail. AppShell already owns a rail, and an
 * admin console nested inside it with a rail of its own is two navigations
 * competing for the same job — the reflex "add a sidebar" answer, and the one
 * that would make this look like every other admin template. A strip reads as
 * the instrument bar of the surface below it, which is what it is.
 *
 * The four controls are global because their effect is: changing the window or
 * the density changes every panel on screen, so they belong to the console
 * rather than to any one view.
 */

export default function ConsoleStrip({ modules, scopes }) {
  const { range, rangeId, selectRange, density, setDensity, live, setLive, refresh } = useConsole();
  const listRef = useRef(null);
  const activeRef = useRef(null);

  /* Keep the active module in view when the strip overflows on a narrow
     window — otherwise the current section can sit off-screen behind a scroll
     an operator has no reason to suspect is there. */
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, []);

  return (
    /* The negative margins mirror AppShell's own content padding exactly
       (px-2 sm:px-3 lg:pl-0 lg:pr-2) so the strip bleeds to the edge of the
       content column without ever reaching under the app rail on large
       screens. `top-[72px]` clears AppShell's sticky header, which sits at
       top-2 and is 56px tall. */
    <div className="sticky top-[72px] z-30 -mx-2 mb-2 border-b border-line bg-bg/85 px-2 backdrop-blur-[10px] sm:-mx-3 sm:px-3 lg:ml-0 lg:-mr-2 lg:pl-0 lg:pr-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
        <nav aria-label="Console modules" className="min-w-0 flex-1">
          <ul ref={listRef} className="flex gap-px overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {modules.map((m) => {
              const allowed = !m.scope || scopes.includes(m.scope);
              return (
                <li key={m.path}>
                  <NavLink
                    to={m.path}
                    end={m.end}
                    className={({ isActive }) =>
                      cx(
                        'relative flex shrink-0 items-center gap-0.5 whitespace-nowrap px-1.5 py-1 text-sm font-semibold transition-colors duration-fast',
                        isActive ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
                        !allowed && 'opacity-40',
                      )
                    }
                    title={allowed ? m.description : `Requires the ${m.scope} scope`}
                  >
                    {({ isActive }) => (
                      <>
                        <m.icon size={14} strokeWidth={2.2} aria-hidden />
                        {m.label}
                        {isActive ? (
                          <span
                            ref={activeRef}
                            className="absolute inset-x-1 -bottom-px h-[2px] rounded-full bg-brand-solid"
                            aria-hidden
                          />
                        ) : null}
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-1">
          {/* Window. Every number on screen is measured over this span, and
              every delta against the span immediately before it. */}
          <div
            role="group"
            aria-label="Time window"
            className="flex items-center rounded-sm border border-line bg-raised/40 p-px"
          >
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => selectRange(p.id)}
                aria-pressed={rangeId === p.id}
                className={cx(
                  'rounded-xs px-1 py-px font-mono text-2xs font-bold uppercase tracking-[0.06em] transition-colors',
                  rangeId === p.id ? 'bg-ink text-bg' : 'text-ink-3 hover:text-ink',
                )}
                title={`Last ${p.label}`}
              >
                {p.id}
              </button>
            ))}
            {rangeId === 'custom' ? (
              <span className="px-1 font-mono text-2xs font-bold uppercase text-ink">
                {range.days}d
              </span>
            ) : null}
          </div>

          <StripButton
            onClick={() => setLive(!live)}
            pressed={live}
            label={live ? 'Live updates on' : 'Live updates paused'}
            icon={Radio}
            tone={live ? 'good' : 'muted'}
          />
          <StripButton
            onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
            pressed={density === 'compact'}
            label={density === 'compact' ? 'Compact rows' : 'Comfortable rows'}
            icon={density === 'compact' ? Rows3 : Rows2}
          />
          <StripButton onClick={refresh} label="Refresh all panels" icon={RefreshCw} />
        </div>
      </div>
    </div>
  );
}

function StripButton({ onClick, pressed, label, icon: Icon, tone = 'default' }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={pressed}
      title={label}
      className={cx(
        'grid h-[28px] w-[28px] place-items-center rounded-sm border transition-colors duration-fast',
        pressed && tone === 'good'
          ? 'border-good/40 bg-good/10 text-good'
          : pressed
            ? 'border-line-strong bg-raised text-ink'
            : 'border-line text-ink-3 hover:border-line-strong hover:text-ink',
      )}
    >
      <Icon size={13} strokeWidth={2.2} aria-hidden />
      <span className="sr-only">{label}</span>
    </button>
  );
}
