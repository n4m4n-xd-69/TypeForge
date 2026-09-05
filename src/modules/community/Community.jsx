import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, MessagesSquare, Send, Swords, Trash2, Users,
} from 'lucide-react';
import Button, { IconButton } from '../../components/ui/Button.jsx';
import { Card, Chip, EmptyState } from '../../components/ui/Primitives.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useStore } from '../../lib/store.jsx';
import {
  createPost, deletePost, extractBattlePin, fetchFeed, fetchMember, subscribeToFeed,
} from '../../lib/community/api.js';
import { relativeTime } from '../../lib/format.js';
import CommunityProfileCard from './CommunityProfileCard.jsx';

/**
 * Community.
 *
 * A single shared feed, deliberately — not channels, not threads, not DMs. The
 * thing people asked for is a place to say "race me" and drop a room code, and
 * every additional structure is something to navigate before doing that. So the
 * composer is the first thing on the page and a shared code becomes a real join
 * button rather than text somebody has to retype.
 *
 * What a member can see about another member is decided in Postgres, not here:
 * this reads `community_feed`, a view over exactly the public columns. No
 * email, no account status, no XP. Adding a column to `profiles` does not add
 * it to this page.
 */
export default function Community() {
  const { user, cloudEnabled, ready, openAuthModal } = useAuth();
  const { state } = useStore();
  const { toast } = useToast();

  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [openMember, setOpenMember] = useState(null);

  const load = useCallback(async () => {
    try {
      const rows = await fetchFeed();
      setPosts(rows);
      setError(null);
      setExhausted(rows.length < 30);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    if (!cloudEnabled || !ready) return;
    load();
  }, [cloudEnabled, ready, load]);

  /* Live, coalesced. A burst of posts should cost one refetch, not one each —
     and the feed is small enough that refetching the head beats reconciling
     individual row events against a list the server ordered. */
  useEffect(() => {
    if (!cloudEnabled || !user) return undefined;
    let timer = null;
    const stop = subscribeToFeed(() => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; load(); }, 500);
    });
    return () => { clearTimeout(timer); stop(); };
  }, [cloudEnabled, user, load]);

  const loadMore = async () => {
    if (!posts?.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const older = await fetchFeed({ before: posts[posts.length - 1].created_at });
      setPosts((prev) => [...(prev ?? []), ...older]);
      if (older.length < 30) setExhausted(true);
    } catch {
      toast('Could not load older posts.', { tone: 'error' });
    } finally {
      setLoadingMore(false);
    }
  };

  const onDelete = async (id) => {
    // Optimistic, then reconciled by the refetch. A delete that leaves the post
    // on screen for a round trip reads as a failure.
    setPosts((prev) => (prev ?? []).filter((p) => p.id !== id));
    try {
      await deletePost(id);
    } catch (err) {
      toast(err.message ?? 'Could not delete that.', { tone: 'error' });
      load();
    }
  };

  if (!cloudEnabled) {
    return (
      <Shell>
        <EmptyState
          icon={Users}
          title="Community needs the cloud"
          description="This build has no Supabase keys configured, so there is nobody to talk to."
        />
      </Shell>
    );
  }

  if (!ready) {
    return <Shell><EmptyState icon={Loader2} title="Loading…" /></Shell>;
  }

  if (!user) {
    return (
      <Shell>
        <EmptyState
          icon={Users}
          title="Join the Community"
          description="Share Battlefield invites, find people to race, and see who else is practising. A name is enough — no email needed."
          action={<Button variant="primary" onClick={() => openAuthModal('sign-up')}>Get started</Button>}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-2">
          <Composer profile={state.profile} onPosted={load} />

          {error ? (
            <Card className="p-2.5">
              <p className="text-sm text-bad">Could not load the feed: {error.message}</p>
              <Button size="sm" variant="secondary" className="mt-1.5" onClick={load}>Try again</Button>
            </Card>
          ) : posts === null ? (
            <Card className="p-3">
              <p className="flex items-center gap-1 text-sm text-ink-3">
                <Loader2 size={14} className="animate-spin" aria-hidden /> Loading the feed…
              </p>
            </Card>
          ) : posts.length === 0 ? (
            <Card className="p-3">
              <EmptyState
                icon={MessagesSquare}
                title="Nothing here yet"
                description="Be the first. Open a Battlefield and drop the code — the link becomes a join button."
              />
            </Card>
          ) : (
            <>
              <ul className="space-y-1.5">
                {posts.map((post) => (
                  <Post
                    key={post.id}
                    post={post}
                    mine={post.user_id === user.id}
                    onOpenMember={() => setOpenMember(post.user_id)}
                    onDelete={() => onDelete(post.id)}
                  />
                ))}
              </ul>

              {exhausted ? (
                <p className="py-1 text-center text-2xs text-ink-3">That is the whole feed.</p>
              ) : (
                <Button variant="ghost" className="w-full" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load older posts'}
                </Button>
              )}
            </>
          )}
        </div>

        <aside className="space-y-2">
          <CommunityProfileCard />
        </aside>
      </div>

      <MemberSheet userId={openMember} onClose={() => setOpenMember(null)} />
    </Shell>
  );
}

/* ── composer ──────────────────────────────────────────────────────────── */

function Composer({ profile, onPosted }) {
  const { toast } = useToast();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef(null);

  /* Detected as they type, so the join button is visible before they commit —
     "this will become a link" is more useful than discovering it afterwards. */
  const pin = useMemo(() => extractBattlePin(body), [body]);

  const submit = async (event) => {
    event.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await createPost(text, pin);
      setBody('');
      onPosted();
      ref.current?.focus();
    } catch (err) {
      toast(err.message ?? 'Could not post that.', { tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="p-2.5">
      <form onSubmit={submit}>
        <div className="flex gap-1.5">
          <Avatar value={profile.avatar} name={profile.name} size={38} />
          <div className="min-w-0 flex-1">
            <label htmlFor="composer" className="sr-only">Write a post</label>
            <textarea
              id="composer"
              ref={ref}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Say something, or paste a Battlefield link to invite people…"
              className="w-full resize-y rounded-md border border-line bg-subtle/50 px-1.5 py-1 text-sm outline-none focus:border-brand"
              /* Ctrl/Cmd+Enter sends. A bare Enter must not: this is a
                 multi-line box and people write more than one line in it. */
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
              }}
            />
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1">
          {pin ? (
            <Chip tone="brand">
              <Swords size={11} aria-hidden /> Invite to {pin}
            </Chip>
          ) : null}
          <span className="text-2xs text-ink-3">{body.length}/1000</span>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            icon={sending ? Loader2 : Send}
            className="ml-auto"
            disabled={sending || !body.trim()}
          >
            {sending ? 'Posting…' : 'Post'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ── one post ──────────────────────────────────────────────────────────── */

function Post({ post, mine, onOpenMember, onDelete }) {
  const study = [post.course, post.branch, post.study_year ? `Year ${post.study_year}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <li>
      <Card className="p-2">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onOpenMember}
            className="shrink-0 rounded-full focus-visible:outline-none focus-visible:shadow-focus"
            aria-label={`View ${post.display_name || 'this member'}'s profile`}
          >
            <Avatar value={post.photo_url ?? post.avatar} name={post.display_name} size={38} />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-1">
              <button
                type="button"
                onClick={onOpenMember}
                className="truncate text-sm font-bold hover:underline"
              >
                {post.display_name || 'Someone'}
              </button>
              {study ? <span className="truncate text-2xs text-ink-3">{study}</span> : null}
              <span className="ml-auto shrink-0 text-2xs text-ink-3">{relativeTime(post.created_at)}</span>
              {mine ? (
                <IconButton size="sm" label="Delete this post" icon={Trash2} onClick={onDelete} />
              ) : null}
            </div>

            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{post.body}</p>

            {/* A shared room becomes a real control. The status comes from the
                feed view, so a code whose room has since closed says so rather
                than offering a button that leads to an error. */}
            {post.battle_pin ? (
              <div className="mt-1.5">
                {post.battle_status ? (
                  <Button
                    as={Link}
                    to={`/battle/${post.battle_pin}`}
                    size="sm"
                    variant="primary"
                    icon={Swords}
                  >
                    Join Battlefield {post.battle_pin}
                  </Button>
                ) : (
                  <Chip tone="neutral">Battlefield {post.battle_pin} has closed</Chip>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </li>
  );
}

/* ── a member's card ───────────────────────────────────────────────────── */

function MemberSheet({ userId, onClose }) {
  const [member, setMember] = useState(undefined);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    setMember(undefined);
    fetchMember(userId).then((data) => { if (!cancelled) setMember(data); });
    return () => { cancelled = true; };
  }, [userId]);

  /* The app's Modal rather than a hand-rolled overlay: focus trapping, focus
     restore, scroll lock and Escape are its contract, and a dialog that only
     looks like the others is the kind of inconsistency nobody sees until they
     try to close it with a keyboard. */
  return (
    <Modal open={Boolean(userId)} onClose={onClose} size="sm" title="Member">
      <div className="p-3">
        {member === undefined ? (
          <p className="flex items-center gap-1 text-sm text-ink-3">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Loading…
          </p>
        ) : !member ? (
          <p className="text-sm text-ink-3">That member&apos;s profile is not available.</p>
        ) : (
          <div className="text-center">
            <Avatar
              value={member.photo_url ?? member.avatar}
              name={member.display_name}
              size={72}
              className="mx-auto"
            />
            <h3 className="mt-1.5 text-lg font-bold">{member.display_name || 'Someone'}</h3>
            {member.course || member.branch ? (
              <p className="mt-0.5 text-sm text-ink-2">
                {[member.course, member.branch].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            {member.study_year ? (
              <p className="text-xs text-ink-3">Year {member.study_year}</p>
            ) : null}
            {member.bio ? (
              <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{member.bio}</p>
            ) : null}
            <p className="mt-1.5 text-2xs text-ink-3">
              Member since {relativeTime(member.member_since)}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Shell({ children }) {
  return (
    <div className="space-y-3">
      <header>
        <p className="eyebrow">Together</p>
        <h1 className="mt-0.5 font-display text-3xl font-bold">Community</h1>
        <p className="mt-0.5 max-w-[62ch] text-sm leading-relaxed text-ink-3">
          Share a Battlefield code and someone will take it. Paste an invite link and it turns into a
          button anyone can press.
        </p>
        <div className="mt-1.5 flex gap-1">
          <span className="rounded-md bg-subtle px-2 py-1 text-xs font-bold text-ink">Feed</span>
          <Link
            to="/community/chat"
            className="rounded-md px-2 py-1 text-xs font-bold text-ink-3 hover:bg-subtle/60 hover:text-ink-2"
          >
            Live Chat
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
