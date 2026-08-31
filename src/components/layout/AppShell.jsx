import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronRight, Command, Flame, Home, LineChart, Trophy,
} from 'lucide-react';
import { cx } from '../../lib/format.js';
import { useStats, useStore } from '../../lib/store.jsx';
import { levelTitle } from '../../lib/gamification.js';
import Logo from '../brand/Logo.jsx';
import Avatar from '../ui/Avatar.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import CommandPalette from './CommandPalette.jsx';
import ChatFab from './ChatFab.jsx';
import AccountMenu from '../../modules/auth/AccountMenu.jsx';
import { useAuth } from '../../lib/auth.jsx';
import AuthModal from '../../modules/auth/AuthModal.jsx';
import SuspendedNotice from '../../modules/auth/SuspendedNotice.jsx';
import NoticeDialog from '../../modules/auth/NoticeDialog.jsx';
import { MODE_REGISTRY } from '../../lib/modes/registry.js';
import { deriveNavGroups } from '../../lib/modes/derive.js';

/**
 * Navigation, grouped by what you are doing rather than by feature.
 *
 * Two constraints shaped this. The mobile tab bar renders each entry with
 * `flex-1`, so at 360px a ninth item would give every tab 40px — eight is a
 * hard ceiling. And the previous seven-item list had "Progress" and "Rewards"
 * adjacent while describing overlapping ideas, which meant the answer to
 * "where do I see how I'm doing" was two places.
 *
 * Five stay, leaving three slots of headroom for future modes. `Train` and
 * `Compete` are groups whose first item is their destination, so nothing
 * sits behind a hub screen — the mode switcher lives inside the typing
 * surface, where the user already is.
 *
 * /chat and /about are deliberately out: the coach floats on every route via
 * ChatFab, and both are in the command palette.
 */
export const NAV_GROUPS = deriveNavGroups(MODE_REGISTRY, {
  Train: [{ to: '/', label: 'Home', icon: Home, end: true, lead: true }],
  Compete: [
    { to: '/dashboard', label: 'Progress', icon: LineChart },
    /* Rewards stays until Progress absorbs it. Dropping it now to hit a
       five-item target would leave a live route reachable only from the
       command palette, which trades discoverability for a number. */
    { to: '/achievements', label: 'Rewards', icon: Trophy },
  ],
});

export const NAV = NAV_GROUPS.flatMap((g) => g.items);

/**
 * Rail geometry.
 *
 * Every row is PAD + a 40px icon box, so an icon's centre sits at PAD + 20 —
 * which is exactly RAIL_COLLAPSED / 2. That single rule is what keeps the nav
 * icons, the ⌘ button, the avatar and the collapse arrow on one vertical line,
 * and it means icons don't shift horizontally when the rail expands.
 */
const RAIL_PAD = 10;
const RAIL_ITEM = 40;
const RAIL_COLLAPSED = RAIL_PAD * 2 + RAIL_ITEM; // 60
const RAIL_EXPANDED = 236;
const RAIL_INSET = 16; // matches the `left-2 / bottom-2` float
const CONTENT_OFFSET = RAIL_INSET + RAIL_COLLAPSED + RAIL_INSET; // 92px
const CONTENT_OFFSET_PINNED = RAIL_INSET + RAIL_EXPANDED + RAIL_INSET; // 268px
const PIN_KEY = 'keystroke.rail.pinned';

/**
 * The rail starts below the top bar rather than beside it. Sharing the row
 * would mean the expanded rail (246px) covering the header's first 160px —
 * including the wordmark — every time the pointer passed over it.
 * 8px top margin + 60px bar + 16px gap.
 */
const RAIL_TOP = 84;

/**
 * Routes that render without the app chrome.
 *
 * The landing page is for people who have not used the product, and a
 * navigation rail, a streak counter and a level badge are all answers to
 * questions they have not asked. It carries its own header instead.
 *
 * `/` is the only entry because App's Root redirects anyone with history to
 * /home — so reaching `/` and staying there means the landing page is what
 * is being shown.
 */
const BARE_ROUTES = new Set(['/']);

export default function AppShell({ children }) {
  const { state } = useStore();
  const stats = useStats();
  const { suspended, accountStatus, signOut } = useAuth();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();

  /**
   * The rail opens and closes only when you ask it to.
   *
   * Hover-expand was removed deliberately: an opinionated panel that unfolds
   * whenever the pointer drifts past it is noise, and it made the layout feel
   * unpredictable. The arrow at the top is now the single control, and the
   * choice persists.
   */
  const [open, setOpen] = useState(() => localStorage.getItem(PIN_KEY) === '1');

  const toggleRail = () => {
    setOpen((v) => {
      localStorage.setItem(PIN_KEY, v ? '0' : '1');
      return !v;
    });
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggleRail();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (BARE_ROUTES.has(location.pathname)) {
    return (
      <div className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:rounded-sm focus:bg-ink focus:px-2 focus:py-1 focus:text-sm focus:font-semibold focus:text-bg"
        >
          Skip to content
        </a>
        <div id="main">{children}</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:rounded-sm focus:bg-ink focus:px-2 focus:py-1 focus:text-sm focus:font-bold focus:text-bg"
      >
        Skip to content
      </a>

      {/* ── Floating rail ────────────────────────────────────────────── */}
      <aside
        style={{ width: open ? RAIL_EXPANDED : RAIL_COLLAPSED, top: RAIL_TOP }}
        className={cx(
          'fixed bottom-2 left-2 z-30 hidden flex-col overflow-hidden lg:flex',
          'rounded-lg border border-line bg-surface',
          // One property animating, one easing, GPU-hinted — this is what makes
          // the expand read as smooth rather than stepped.
          'transition-[width,box-shadow] duration-[340ms] ease-[cubic-bezier(0.32,0.72,0,1)] will-change-[width]',
          open ? 'shadow-e4' : 'shadow-e2',
        )}
        aria-label="Primary navigation"
      >
        {/* Collapse control sits above everything, per the reference. */}
        <div className="shrink-0 pt-1.5" style={{ paddingLeft: RAIL_PAD, paddingRight: RAIL_PAD }}>
          <button
            onClick={toggleRail}
            aria-expanded={open}
            aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
            title={`${open ? 'Collapse' : 'Expand'} sidebar  (Ctrl/⌘ + \\)`}
            className="flex w-full items-center rounded-md text-sm font-bold text-ink-3 transition-colors hover:bg-subtle hover:text-ink"
            style={{ height: RAIL_ITEM }}
          >
            <IconBox>
              <ChevronRight
                size={19}
                strokeWidth={2.4}
                className={cx('transition-transform duration-[340ms] ease-[cubic-bezier(0.32,0.72,0,1)]', open && 'rotate-180')}
                aria-hidden
              />
            </IconBox>
            <RailLabel open={open}>Collapse</RailLabel>
          </button>
        </div>

        <nav
          className="flex-1 overflow-y-auto overflow-x-hidden py-1.5 no-scrollbar"
          style={{ paddingLeft: RAIL_PAD, paddingRight: RAIL_PAD }}
        >
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.label} className={cx(gi > 0 && 'mt-1.5')}>
              {/* Collapsed, the heading becomes a divider — but a divider above
                  the first group is just a stray line, so it's omitted there. */}
              <SectionLabel open={open} divider={gi > 0}>
                {group.label}
              </SectionLabel>
              <ul className="mt-0.5 space-y-px">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      title={open ? undefined : item.label}
                      className={({ isActive }) =>
                        cx(
                          'group relative flex items-center rounded-md text-sm font-bold transition-colors duration-200',
                          isActive ? 'text-ink' : 'text-ink-3 hover:bg-subtle hover:text-ink-2',
                        )
                      }
                      style={{ height: RAIL_ITEM }}
                    >
                      {({ isActive }) => (
                        <>
                          {isActive ? (
                            <motion.span
                              layoutId="nav-active"
                              className="absolute inset-0 rounded-md bg-subtle"
                              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                            />
                          ) : null}
                          <IconBox>
                            <item.icon size={19} strokeWidth={2.1} aria-hidden />
                          </IconBox>
                          <RailLabel open={open} className="relative">
                            {item.label}
                          </RailLabel>
                          {open ? null : <span className="sr-only">{item.label}</span>}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="space-y-px pb-1.5" style={{ paddingLeft: RAIL_PAD, paddingRight: RAIL_PAD }}>
          <span className="mb-1 block h-px w-full rounded-full bg-line" aria-hidden />

          <button
            onClick={() => setPaletteOpen(true)}
            title="Quick actions (⌘K)"
            className="flex w-full items-center rounded-md text-sm font-bold text-ink-3 transition-colors hover:bg-subtle hover:text-ink-2"
            style={{ height: RAIL_ITEM }}
          >
            <IconBox>
              <Command size={18} strokeWidth={2.1} aria-hidden />
            </IconBox>
            <RailLabel open={open}>Quick actions</RailLabel>
            {open ? (
              <kbd className="ml-auto mr-0.5 shrink-0 rounded-[5px] border border-line bg-subtle px-0.5 font-mono text-2xs">
                ⌘K
              </kbd>
            ) : null}
          </button>

          {/* Points at the profile, not the rewards page. Someone clicking
              their own name and avatar is asking about themselves. */}
          <NavLink
            to="/profile"
            title={open ? undefined : `${state.profile.name || 'Your profile'} · Level ${stats.level.level}`}
            className={({ isActive }) =>
              cx(
                'flex w-full items-center rounded-md transition-colors hover:bg-subtle',
                isActive && 'bg-subtle',
              )
            }
            style={{ height: RAIL_ITEM + 8 }}
          >
            <IconBox>
              <Avatar value={state.profile.avatar} name={state.profile.name} size={32} />
            </IconBox>
            <RailLabel open={open} className="min-w-0 flex-1 pr-1">
              <span className="block truncate text-xs font-bold">{state.profile.name || 'Your space'}</span>
              <span className="block truncate text-2xs font-bold uppercase tracking-[0.08em] text-brand">
                Lv {stats.level.level} · {levelTitle(stats.level.level)}
              </span>
              <span className="mt-0.5 block h-[3px] w-full overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full bg-brand-solid transition-[width] duration-700 ease-out"
                  style={{ width: `${stats.level.progress * 100}%` }}
                />
              </span>
            </RailLabel>
          </NavLink>
        </div>
      </aside>

      {/* ── Floating top bar — full width, above the rail ────────────── */}
      {/* `overflow-hidden` is what keeps the tagline's entrance inside the bar
          rather than bleeding above or below it. */}
      <header className="glass sticky top-2 z-40 mx-2 mt-2 flex h-[56px] items-center gap-1.5 rounded-lg border border-line px-2 shadow-e2">
        {/* The mark comes from Logo.jsx, which owns the one shape the favicon,
            app icons and boot screen all derive from. This used to be a
            hardcoded <span>k</span>, so editing Logo.jsx changed nothing on
            screen — the single reason the header still looked "old" no matter
            what was committed. */}
        <NavLink
          to="/"
          aria-label="TypeForge — home"
          /* Fills the header's height rather than hugging the wordmark, so the
             target clears 44px without the lockup moving. */
          className="flex h-full shrink-0 items-center gap-1 rounded-sm pr-1"
        >
          <Logo size={28} className="shrink-0" />
          <span className="whitespace-nowrap font-display text-xl font-bold tracking-[-0.03em]">
            TypeForge
          </span>
        </NavLink>

        <div className="ml-auto flex items-center gap-1">
          <StreakPill count={stats.streak} />
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Open quick actions"
            className="hidden h-[36px] items-center gap-1 rounded-sm border border-line px-1.5 text-xs font-semibold text-ink-3 transition-colors hover:text-ink-2 sm:flex lg:hidden"
          >
            <Command size={13} aria-hidden /> ⌘K
          </button>
          <ThemeToggle />
          {/* Level and identity are different things, so they stay separate
              controls: the pill is who you are *in* the app, the menu is which
              account it syncs to. AccountMenu renders nothing at all when
              Supabase is unconfigured, so a keyless build shows no cloud UI. */}
          {/* One identity control, not two. The level pill and the account
              menu each rendered the same avatar side by side, so the header
              showed your face twice. AccountMenu now owns the pill and the
              level sits inside it. */}
          <AccountMenu level={stats.level.level} />
        </div>
      </header>

      {/* ── Content column ───────────────────────────────────────────── */}
      <div
        style={{ '--content-offset': `${open ? CONTENT_OFFSET_PINNED : CONTENT_OFFSET}px` }}
        className="transition-[padding] duration-[340ms] ease-[cubic-bezier(0.32,0.72,0,1)] lg:pl-[var(--content-offset)]"
      >
        <div className="mx-auto max-w-[1400px] px-2 sm:px-3 lg:pl-0 lg:pr-2">
          <main id="main" className="pb-12 pt-2">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              {children}
            </motion.div>
          </main>
        </div>
      </div>

      {/* ── Mobile tab bar — floats too ──────────────────────────────── */}
      <nav
        className="glass fixed inset-x-2 bottom-2 z-30 rounded-xl border border-line shadow-lg lg:hidden"
        aria-label="Primary"
      >
        <ul className="flex items-stretch">
          {NAV.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'flex flex-col items-center gap-px py-1 text-[10px] font-bold transition-colors',
                    isActive ? 'text-ink' : 'text-ink-3',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cx(
                        'grid h-[26px] w-[40px] place-items-center rounded-full transition-colors',
                        isActive && 'bg-brand-wash',
                      )}
                    >
                      <item.icon size={17} strokeWidth={2.1} aria-hidden />
                    </span>
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="h-9 lg:hidden" aria-hidden />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ChatFab />
      {/* Rendered once here, driven by AuthProvider state — the same split
          ToastProvider uses, so any surface can call openAuthModal() without
          owning a modal of its own. */}
      <AuthModal />

      {/* Rendered here, beside AuthModal, for the same reason: it is a
          property of the session rather than of any route, and it has to
          appear over whichever surface the person happened to open. */}
      {suspended ? <SuspendedNotice status={accountStatus} onSignOut={signOut} /> : null}

      {/* Sits below the suspension notice in priority: NoticeDialog returns
          null while an account is suspended, so the two never overlap. */}
      <NoticeDialog />
    </div>
  );
}

/**
 * The fixed-width icon cell every rail row starts with. Because it is the same
 * width as the rail's usable space when collapsed, the glyph inside lands dead
 * centre and stays put when the rail expands.
 */
function IconBox({ children }) {
  return (
    <span
      className="relative grid shrink-0 place-items-center"
      style={{ width: RAIL_ITEM, height: RAIL_ITEM }}
      aria-hidden
    >
      {children}
    </span>
  );
}

/**
 * Rail text. Kept mounted and faded rather than conditionally rendered — an
 * unmount mid-transition is what makes a collapsing sidebar look janky. The
 * fade waits for the width when opening and leads it when closing, so text
 * never appears before there is room for it.
 */
function RailLabel({ open, className, children }) {
  return (
    <span
      aria-hidden={!open}
      style={{ transitionDelay: open ? '90ms' : '0ms' }}
      className={cx(
        'overflow-hidden whitespace-nowrap text-left transition-[opacity,transform] duration-200 ease-out',
        open ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-1 opacity-0',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Group heading. Collapses to a hairline divider when the rail is narrow. */
function SectionLabel({ open, divider, children }) {
  if (!open && !divider) return <div className="h-0.5" aria-hidden />;

  return (
    <div className="flex h-[18px] items-center px-[11px]">
      {open ? (
        <span
          style={{ transitionDelay: '90ms' }}
          className="truncate text-2xs font-bold uppercase tracking-[0.12em] text-ink-3 opacity-100 transition-opacity duration-200"
        >
          {children}
        </span>
      ) : (
        <span className="h-px w-full rounded-full bg-line" aria-hidden />
      )}
    </div>
  );
}

function StreakPill({ count }) {
  return (
    <div
      className={cx(
        'flex h-[36px] items-center gap-0.5 rounded-full px-1.5 text-sm font-bold',
        count > 0 ? 'bg-brand-wash text-brand' : 'text-ink-3',
      )}
      title={count > 0 ? `${count}-day streak` : 'Practise today to start a streak'}
    >
      <Flame size={15} strokeWidth={2.4} aria-hidden />
      <span className="tnum">{count}</span>
      <span className="sr-only">day streak</span>
    </div>
  );
}
