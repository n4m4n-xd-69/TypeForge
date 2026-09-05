// src/modules/community/IntroModal.jsx
import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
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
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!cloudEnabled || !user) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('community_intro_seen')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data && data.community_intro_seen === false) setOpen(true);
      });
    return () => { cancelled = true; };
  }, [cloudEnabled, user]);

  const dismiss = async () => {
    setOpen(false);
    if (user) await supabase.from('profiles').update({ community_intro_seen: true }).eq('id', user.id);
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
