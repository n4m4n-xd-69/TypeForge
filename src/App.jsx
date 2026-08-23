import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/layout/AppShell.jsx';
import { Card, Skeleton } from './components/ui/Primitives.jsx';

/* Route-level code splitting: the charts and Prism grammars only load when the
   surface that needs them is opened. */
const Landing = lazy(() => import('./modules/landing/Landing.jsx'));
const Practice = lazy(() => import('./modules/practice/Practice.jsx'));
const CodeTyping = lazy(() => import('./modules/code/CodeTyping.jsx'));
const Dashboard = lazy(() => import('./modules/dashboard/Dashboard.jsx'));
const Achievements = lazy(() => import('./modules/achievements/Achievements.jsx'));
const AIChat = lazy(() => import('./modules/chat/AIChat.jsx'));
const Battle = lazy(() => import('./modules/battle/Battle.jsx'));
const BattleRoom = lazy(() => import('./modules/battle/BattleRoom.jsx'));
const Profile = lazy(() => import('./modules/profile/Profile.jsx'));
const About = lazy(() => import('./modules/about/About.jsx'));
const AdminPanel = lazy(() => import('./modules/admin/AdminPanel.jsx'));

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<RouteSkeleton />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/code" element={<CodeTyping />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/chat" element={<AIChat />} />
          {/* One route for every phase of a room, per PRD-BATTLEFIELD §16.1: the
              phase is a function of the room's status, which is durable, so a
              refresh mid-match reconstructs the right screen instead of relying
              on a URL that can disagree with the room. `/battle` alone is the
              create-or-join hub. */}
          <Route path="/battle" element={<Battle />} />
          <Route path="/battle/:pin" element={<BattleRoom />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/about" element={<About />} />
          {/* Reached from the account menu rather than the nav: the mobile
              tab bar shares NAV_GROUPS, and an operator view only one account
              can open has no business holding a permanent slot there. Access
              is enforced by is_admin() in the database, not by this route. */}
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
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
