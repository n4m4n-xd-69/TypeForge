import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { supabase } from '../../lib/supabase.js';
import CommunityProfileCard from './CommunityProfileCard.jsx';

/**
 * Shown once per member: the first time Community (feed or chat) is opened
 * with no course/branch/year/bio ever saved. Reuses CommunityProfileCard's
 * existing form rather than a second implementation — same fields, same
 * "everything here is optional" framing (see that file's own header comment).
 */
export default function IntroModal() {
  const { user, cloudEnabled } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!cloudEnabled || !user) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('community_intro_seen')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          if (import.meta.env.DEV) console.warn('[community] intro-seen check failed', error);
          return;
        }
        if (data && data.community_intro_seen === false) setOpen(true);
      });
    return () => { cancelled = true; };
  }, [cloudEnabled, user]);

  /*
   * Closes only once the flag is actually persisted. `supabase-js` resolves
   * `{ error }` on an RLS denial or a Postgres error rather than throwing —
   * closing unconditionally first (as an earlier version of this function
   * did) meant a failed write left the modal gone but `community_intro_seen`
   * still `false`, so it would silently reappear on the member's very next
   * visit despite them having explicitly dismissed it. `saveCommunityProfile`
   * (lib/community/api.js) already treats this exact write shape as
   * something that can fail; this does the same.
   */
  const dismiss = async () => {
    if (!user) { setOpen(false); return; }
    const { error } = await supabase
      .from('profiles')
      .update({ community_intro_seen: true })
      .eq('id', user.id);
    if (error) {
      toast('Could not save that — try again.', { tone: 'error' });
      return;
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={dismiss} size="sm" title="Tell the community about you">
      <div className="p-3">
        <CommunityProfileCard onSaved={dismiss} />
        <Button variant="ghost" size="sm" className="mt-1.5 w-full" onClick={dismiss}>
          Skip for now
        </Button>
      </div>
    </Modal>
  );
}
