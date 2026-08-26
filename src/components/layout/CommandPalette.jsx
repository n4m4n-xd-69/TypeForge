import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Braces, Home, LineChart, MessageSquare, Moon, Search, Sun, Swords, Trophy,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/format.js';
import { useTheme } from '../../lib/theme.jsx';
import { LANGUAGES } from '../../lib/content.js';
import { MODE_REGISTRY } from '../../lib/modes/registry.js';
import { deriveModePaletteEntries } from '../../lib/modes/derive.js';

const MODE_PALETTE_ENTRIES = deriveModePaletteEntries(MODE_REGISTRY);

/** ⌘K launcher. Everything reachable in two keystrokes. */
export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const { toggle, isDark } = useTheme();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  const commands = useMemo(
    () => [
      { id: 'home', label: 'Go to Home', icon: Home, group: 'Navigate', run: () => navigate('/') },
      ...MODE_PALETTE_ENTRIES.filter((e) => e.group === 'Navigate').map((e) => ({
        id: e.id, label: e.label, icon: e.icon, group: 'Navigate', run: () => navigate(e.route),
      })),
      { id: 'shadow', label: 'Shadow Battle — 1v1 Combat', icon: Swords, group: 'Navigate', run: () => navigate('/shadow') },
      // The registry-derived entry above now opens the /arena gate, so both
      // sides of that fork also get a direct command. The gate is a discovery
      // surface, not a toll booth — anyone who already knows which mode they
      // want should never have to pass through it.
      { id: 'battlefield', label: 'Battlefield — 8-player race', icon: Swords, group: 'Navigate', run: () => navigate('/battle') },
      // Chat gave up its nav slot to Battlefield. The floating coach reaches the
      // same model from every route, but the full page owns the thread history
      // in `chat_messages`, so it needs a way in that is not the FAB.
      { id: 'chat', label: 'Open the AI coach page', icon: MessageSquare, group: 'Navigate', run: () => navigate('/chat') },
      { id: 'dashboard', label: 'Open Progress dashboard', icon: LineChart, group: 'Navigate', run: () => navigate('/dashboard') },
      { id: 'rewards', label: 'Open Rewards', icon: Trophy, group: 'Navigate', run: () => navigate('/achievements') },
      { id: 'theme', label: `Switch to ${isDark ? 'light' : 'dark'} theme`, icon: isDark ? Sun : Moon, group: 'Settings', run: toggle },
      ...MODE_PALETTE_ENTRIES.filter((e) => e.group === 'Practice').map((e) => ({
        id: e.id, label: e.label, icon: e.icon, group: 'Practice', run: () => navigate(e.route),
      })),
      ...LANGUAGES.map((l) => ({
        id: `lang-${l.id}`,
        label: `Code typing — ${l.name}`,
        icon: Braces,
        group: 'Languages',
        run: () => navigate(`/code?lang=${l.id}`),
      })),
    ],
    [navigate, toggle, isDark],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setCursor(0);
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => setCursor(0), [query]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[cursor]?.run();
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  let lastGroup = null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center p-2 pt-[12dvh]">
          <motion.div
            className="absolute inset-0 bg-ink/40 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Quick actions"
            className="relative w-full max-w-[560px] overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <div className="flex items-center gap-1 border-b border-line px-2">
              <Search size={16} className="text-ink-3" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search actions, modes, languages…"
                aria-label="Search actions"
                className="h-[52px] flex-1 bg-transparent text-base font-medium outline-none placeholder:text-ink-3"
              />
              <kbd className="rounded-[5px] border border-line bg-subtle px-0.5 font-mono text-2xs text-ink-3">esc</kbd>
            </div>

            <ul className="max-h-[46dvh] overflow-y-auto p-1" role="listbox">
              {results.length === 0 ? (
                <li className="px-1.5 py-3 text-center text-sm text-ink-3">No matching action</li>
              ) : (
                results.map((c, i) => {
                  const showGroup = c.group !== lastGroup;
                  lastGroup = c.group;
                  return (
                    <li key={c.id}>
                      {showGroup ? (
                        <p className="px-1.5 pb-0.5 pt-1 text-2xs font-bold uppercase tracking-[0.1em] text-ink-3">
                          {c.group}
                        </p>
                      ) : null}
                      <button
                        role="option"
                        aria-selected={i === cursor}
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => {
                          c.run();
                          onClose();
                        }}
                        className={cx(
                          'flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-sm font-semibold transition-colors',
                          i === cursor ? 'bg-subtle text-ink' : 'text-ink-2',
                        )}
                      >
                        <c.icon size={15} strokeWidth={2.1} className="text-ink-3" aria-hidden />
                        {c.label}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
