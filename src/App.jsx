import { Suspense, lazy } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { Swords, Wrench } from 'lucide-react';
import AppShell from './components/layout/AppShell.jsx';
import Button from './components/ui/Button.jsx';
import { Card, Skeleton } from './components/ui/Primitives.jsx';
import { useStore } from './lib/store.jsx';
import { DEVELOPMENT_NOTICE, getLane, isLaneOpen } from './modules/arena/lanes.js';

/* Route-level code splitting: the charts and Prism grammars only load when the
   surface that needs them is opened. */
const Landing = lazy(() => import('./modules/landing/Landing.jsx'));
const Home = lazy(() => import('./modules/home/Home.jsx'));
const Practice = lazy(() => import('./modules/practice/Practice.jsx'));
const CodeTyping = lazy(() => import('./modules/code/CodeTyping.jsx'));
const Dashboard = lazy(() => import('./modules/dashboard/Dashboard.jsx'));
const Achievements = lazy(() => import('./modules/achievements/Achievements.jsx'));
const AIChat = lazy(() => import('./modules/chat/AIChat.jsx'));
const Arena = lazy(() => import('./modules/arena/Arena.jsx'));
const Battle = lazy(() => import('./modules/battle/Battle.jsx'));
const BattleRoom = lazy(() => import('./modules/battle/BattleRoom.jsx'));
const ShadowHub = lazy(() => import('./modules/shadow/ShadowHub.jsx'));
const ShadowRoom = lazy(() => import('./modules/shadow/ShadowRoom.jsx'));
const Community = lazy(() => import('./modules/community/Community.jsx'));
const Profile = lazy(() => import('./modules/profile/Profile.jsx'));
const About = lazy(() => import('./modules/about/About.jsx'));
const AdminPanel = lazy(() => import('./modules/admin/AdminPanel.jsx'));

/**
 * `/` answers two different questions depending on who is asking, so it
 * resolves to two different screens rather than one screen with a branch
 * inside it.
 *
 * A stranger gets the landing page. Someone who has typed here before gets
 * their dashboard — sending them to a page explaining what the product is
 * would be asking them to re-read the pitch every morning.
 *
 * The test is local session history rather than an auth check, because the
 * product works signed-out: a returning user may well have no account, and
 * they have still earned the dashboard.
 */
function Root() {
  const { state } = useStore();
  const returning = state.sessions.length > 0 || state.profile.onboarded;
  return returning ? <Navigate to="/home" replace /> : <Landing />;
}

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<RouteSkeleton />}>
        <Routes>
          <Route path="/" element={<Root />} />
          <Route path="/home" element={<Home />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/code" element={<CodeTyping />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/chat" element={<AIChat />} />
          {/* The rail's Compete entry lands here, not on a mode. Both
              competitive modes are real destinations of their own, so the gate
              is a fork rather than a hub: /battle and /shadow stay directly
              addressable, which is what keeps a shared room PIN, Home's action
              cards and ResultsView's "Play again" from having to detour through
              a choice the user already made.
              See docs/superpowers/plans/2026-08-25-arena-gate-nav.md. */}
          <Route path="/arena" element={<Arena />} />
          {/* One route for every phase of a room, per PRD-BATTLEFIELD §16.1: the
              phase is a function of the room's status, which is durable, so a
              refresh mid-match reconstructs the right screen instead of relying
              on a URL that can disagree with the room. `/battle` alone is the
              create-or-join hub. */}
          <Route path="/battle" element={<Battle />} />
          <Route path="/battle/:pin" element={<BattleRoom />} />
          {/* Gated on the lane's own `status`, so the gate card, the ⌘K
              palette and the URL cannot disagree about whether the mode is
              open. Deep-linking past a disabled button is the obvious way in,
              and a half-built mode reached that way is exactly the "broken
              feature" state this is meant to prevent. Flipping the lane to
              `live` in lanes.js opens all three at once. */}
          <Route path="/shadow" element={isLaneOpen('shadow') ? <ShadowHub /> : <UnderDevelopment />} />
          <Route path="/shadow/:pin" element={isLaneOpen('shadow') ? <ShadowRoom /> : <UnderDevelopment />} />
          <Route path="/community" element={<Community />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/about" element={<About />} />
          {/* Reached from the account menu rather than the nav: the mobile
              tab bar shares NAV_GROUPS, and an operator view only one account
              can open has no business holding a permanent slot there. Access
              is enforced by is_admin() in the database, not by this route. */}
          <Route path="/admin/*" element={<AdminPanel />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

/**
 * The screen a mode that is not finished shows instead of itself.
 *
 * Deliberately a real page rather than a redirect: someone who followed a
 * shared link to this mode deserves to be told what happened to it, and
 * bouncing them to the home screen with no explanation reads as a bug.
 */
function UnderDevelopment() {
  const lane = getLane('shadow');
  return (
    <div className="mx-auto max-w-[520px] py-6">
      <Card className="p-4 text-center">
        <span className="mx-auto grid h-[44px] w-[44px] place-items-center rounded-[14px] bg-warn/15 text-warn">
          <Wrench size={22} strokeWidth={2.2} aria-hidden />
        </span>
        <h1 className="mt-2 font-display text-2xl font-bold">{lane?.title ?? 'Shadow Battle'}</h1>
        <p className="mt-0.5 text-sm font-bold uppercase tracking-[0.1em] text-warn">
          {DEVELOPMENT_NOTICE.label}
        </p>
        <p className="mx-auto mt-1.5 max-w-[42ch] text-sm leading-relaxed text-ink-3">
          {DEVELOPMENT_NOTICE.blurb}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-1">
          <Button as={Link} to="/battle" variant="primary" icon={Swords}>Play Battlefield instead</Button>
          <Button as={Link} to="/practice" variant="ghost">Back to practice</Button>
        </div>
      </Card>
    </div>
  );
}

function RouteSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-full" rounded="rounded-xl" />
      <div className="grid gap-2 md:grid-cols-2">
        <Skeleton className="h-8" rounded="rounded-lg" />
        <Skeleton className="h-8" rounded="rounded-lg" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-2">
            <Skeleton className="h-1 w-[50%]" />
            <Skeleton className="mt-1.5 h-3 w-[70%]" />
          </Card>
        ))}
      </div>
    </div>
  );
}
