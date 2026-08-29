import { Suspense, lazy, useEffect, useMemo } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { cx } from '../../../lib/format.js';
import { Skeleton } from '../../../components/ui/Primitives.jsx';
import { registerCommands } from '../../../lib/paletteRegistry.js';
import { ConsoleProvider, useConsole } from '../kit/ConsoleContext.jsx';
import ConsoleStrip from './ConsoleStrip.jsx';
import { CONSOLE_MODULES } from './modules.js';

/* Each module is its own chunk. The console is a large surface that almost
   nobody loads, and the app's route-level splitting convention (App.jsx)
   should not stop at its door. */
const OverviewView = lazy(() => import('../views/OverviewView.jsx'));
const UsersView = lazy(() => import('../views/UsersView.jsx'));
const PerformanceView = lazy(() => import('../views/PerformanceView.jsx'));
const ArenaView = lazy(() => import('../views/ArenaView.jsx'));
const AiControlView = lazy(() => import('../views/AiControlView.jsx'));
const ContentView = lazy(() => import('../views/ContentView.jsx'));
const ReportsView = lazy(() => import('../views/ReportsView.jsx'));
const SettingsView = lazy(() => import('../views/SettingsView.jsx'));

const VIEWS = {
  overview: OverviewView,
  users: UsersView,
  performance: PerformanceView,
  arena: ArenaView,
  ai: AiControlView,
  content: ContentView,
  reports: ReportsView,
  settings: SettingsView,
};

export default function AdminShell({ scopes, tier, userId }) {
  return (
    <ConsoleProvider scopes={scopes} tier={tier} userId={userId}>
      <ConsoleFrame scopes={scopes} tier={tier} />
    </ConsoleProvider>
  );
}

function ConsoleFrame({ scopes, tier }) {
  const navigate = useNavigate();
  const { refresh } = useConsole();

  /* Contribute the console's vocabulary to the app's existing ⌘K palette
     while it is mounted, rather than shipping a second palette that competes
     for the same shortcut. */
  const commands = useMemo(
    () => [
      ...CONSOLE_MODULES.filter((m) => !m.scope || scopes.includes(m.scope)).map((m) => ({
        id: `console-${m.id}`,
        label: `Console — ${m.label}`,
        icon: m.icon,
        group: 'Admin console',
        keywords: m.keywords,
        run: () => navigate(`/admin/${m.path}`),
      })),
      {
        id: 'console-refresh',
        label: 'Console — refresh every panel',
        icon: ShieldCheck,
        group: 'Admin console',
        keywords: ['reload', 'refetch'],
        run: refresh,
      },
    ],
    [scopes, navigate, refresh],
  );

  useEffect(() => registerCommands('admin-console', commands), [commands]);

  return (
    <div className="min-h-[60vh]">
      <ConsoleStrip modules={CONSOLE_MODULES} scopes={scopes} />

      <div className="flex items-center justify-between gap-2 pb-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          TypeForge operator console
        </p>
        <span
          className="inline-flex items-center gap-0.5 rounded-full border border-line px-1 py-px font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3"
          title="Your admin tier determines which actions the database will accept"
        >
          <ShieldCheck size={11} aria-hidden />
          {tier ?? 'admin'}
        </span>
      </div>

      <Suspense fallback={<ViewSkeleton />}>
        <Routes>
          {CONSOLE_MODULES.map((m) => {
            const View = VIEWS[m.id];
            return (
              <Route
                key={m.id}
                path={m.path === '' ? '/' : `${m.path}/*`}
                element={<View />}
              />
            );
          })}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}

function ViewSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading console module">
      <Skeleton className="h-4 w-[280px]" rounded="rounded-md" />
      <div className={cx('grid gap-1 sm:grid-cols-2 xl:grid-cols-4')}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9" rounded="rounded-md" />
        ))}
      </div>
      <Skeleton className="h-[280px]" rounded="rounded-lg" />
    </div>
  );
}
