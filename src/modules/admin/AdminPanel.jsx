import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Card, EmptyState } from '../../components/ui/Primitives.jsx';
import Button from '../../components/ui/Button.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { fetchScopes, fetchMyRole, fetchMyTier, logConsoleView } from './api/console.js';
import AdminShell from './console/AdminShell.jsx';
import PanelSkeleton from './PanelSkeleton.jsx';

/**
 * `/admin/*` — the gate, and nothing else.
 *
 * Everything below this component assumes an operator with a known scope set.
 * That is safe to assume because the scopes come from `admin_scopes()`, the
 * same function the database's own policies consult: a control this UI enables
 * and an RPC that would reject it cannot disagree, because they read one
 * source. Client-side routing here remains a convenience, not a control —
 * `is_admin()` and `admin_can()` are the actual gate (0002, 0014).
 *
 * Four ways in fail, and each says something different, because "no access"
 * covering all four is what makes an admin panel feel broken: not configured,
 * not signed in, signed in without the role, and signed in as an admin whose
 * tier carries no scopes at all.
 */
export default function AdminPanel() {
  const { user, ready, cloudEnabled, openAuthModal } = useAuth();
  const [access, setAccess] = useState({ status: 'idle', role: null, tier: null, scopes: [] });

  useEffect(() => {
    if (!user) {
      setAccess({ status: 'idle', role: null, tier: null, scopes: [] });
      return undefined;
    }
    let cancelled = false;
    setAccess((a) => ({ ...a, status: 'loading' }));
    Promise.all([fetchMyRole(user.id), fetchMyTier(user.id), fetchScopes()])
      .then(([role, tier, scopes]) => {
        if (cancelled) return;
        setAccess({ status: 'ready', role, tier, scopes });
        if (role === 'admin') logConsoleView('open');
      })
      .catch(() => {
        if (!cancelled) setAccess({ status: 'ready', role: 'user', tier: null, scopes: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!cloudEnabled) {
    return (
      <Gate
        title="The console needs cloud sync"
        description="Every panel reads from Supabase. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then reload."
      />
    );
  }

  if (!ready) return <PanelSkeleton />;

  if (!user) {
    return (
      <Gate
        title="Sign in to continue"
        description="Console access is tied to your account's role."
        action={
          <Button variant="primary" onClick={() => openAuthModal('sign-in')}>
            Sign in
          </Button>
        }
      />
    );
  }

  if (access.status !== 'ready') return <PanelSkeleton />;

  if (access.role !== 'admin') {
    return (
      <Gate
        title="No console access"
        description="This account isn't an operator. Whoever manages the Supabase project can grant access by adding a row to user_roles."
      />
    );
  }

  if (access.scopes.length === 0) {
    return (
      <Gate
        title="Your operator tier carries no scopes"
        description="The account is an admin but its tier grants nothing. An owner can set a tier in Console → Settings → Operators."
      />
    );
  }

  return <AdminShell scopes={access.scopes} tier={access.tier} userId={user.id} />;
}

function Gate({ title, description, action }) {
  return (
    <Card className="py-6">
      <EmptyState icon={ShieldAlert} title={title} description={description} action={action} />
    </Card>
  );
}
