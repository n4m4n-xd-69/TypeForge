import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Loader2, Trash2, UserCircle2 } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Primitives.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useStore } from '../../lib/store.jsx';
import { fetchMember, saveCommunityProfile } from '../../lib/community/api.js';
import {
  ACCEPT_ATTR, PhotoError, deleteProfilePhoto, uploadProfilePhoto,
} from '../../lib/community/photo.js';

/**
 * Your own community card, and the form that edits it.
 *
 * Every field here is optional and each one says so. This is the half of a
 * profile other members see, and a form that demands a course and a year before
 * it will save is a form that turns "join the community" into an application.
 * Someone who wants only a name and a face is finished the moment they arrive.
 *
 * The photo is the one control that does real work, and it does it in this
 * order deliberately: upload first, then write the profile row. Writing the URL
 * before the bytes exist would leave a broken image on every surface that shows
 * this person if the upload then failed.
 */
export default function CommunityProfileCard({ onSaved = () => {} }) {
  const { user } = useAuth();
  const { state, updateProfile } = useStore();
  const { toast } = useToast();

  const [fields, setFields] = useState({ course: '', branch: '', studyYear: '', bio: '' });
  const [photoUrl, setPhotoUrl] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(0);
  const fileInput = useRef(null);

  /* Seeded from the server rather than from local state: these columns are not
     part of the offline profile the store carries, so the row is the only
     place they exist. */
  useEffect(() => {
    let cancelled = false;
    if (!user) { setLoaded(true); return undefined; }
    fetchMember(user.id).then((m) => {
      if (cancelled) return;
      if (m) {
        setFields({
          course: m.course ?? '',
          branch: m.branch ?? '',
          studyYear: m.study_year ?? '',
          bio: m.bio ?? '',
        });
        setPhotoUrl(m.photo_url ?? null);
      }
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [user]);

  const set = (key) => (e) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    setSaved(false);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await saveCommunityProfile(user.id, { ...fields, photoUrl });
      setSaved(true);
      toast('Profile saved', { tone: 'success' });
      onSaved();
    } catch (err) {
      toast(err.message ?? 'Could not save that.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const pickPhoto = async (event) => {
    const file = event.target.files?.[0];
    // Cleared immediately so choosing the same file twice still fires a change
    // event — otherwise a failed upload cannot be retried without picking a
    // different image.
    event.target.value = '';
    if (!file || !user) return;

    setUploading(0.01);
    try {
      const url = await uploadProfilePhoto(user.id, file, setUploading);
      const previous = photoUrl;
      setPhotoUrl(url);
      await saveCommunityProfile(user.id, { ...fields, photoUrl: url });
      // The store's avatar drives every other surface — the rail, the
      // leaderboard, the Battlefield roster — so a photo that only showed up
      // here would look like it had not saved.
      updateProfile({ avatar: url });
      if (previous) deleteProfilePhoto(user.id, previous);
      toast('Photo updated', { tone: 'success' });
    } catch (err) {
      toast(
        err instanceof PhotoError ? err.message : (err.message ?? 'The upload failed.'),
        { tone: 'error' },
      );
    } finally {
      setUploading(0);
    }
  };

  const removePhoto = async () => {
    if (!user || !photoUrl) return;
    const previous = photoUrl;
    setPhotoUrl(null);
    try {
      await saveCommunityProfile(user.id, { ...fields, photoUrl: null });
      // The preset fallback, not an empty circle: Avatar derives a stable tile
      // from the name, so removing a photo returns them to a face rather than
      // to a grey disc.
      updateProfile({ avatar: null });
      deleteProfilePhoto(user.id, previous);
    } catch (err) {
      setPhotoUrl(previous);
      toast(err.message ?? 'Could not remove that photo.', { tone: 'error' });
    }
  };

  if (!user) return null;

  const name = state.profile.name || 'You';
  const busy = uploading > 0;

  return (
    <Card className="p-2.5">
      <h2 className="flex items-center gap-1 text-sm font-bold">
        <UserCircle2 size={15} className="text-ink-3" aria-hidden />
        Your community profile
      </h2>
      <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
        Shown to other members. Everything below is optional.
      </p>

      {/* photo */}
      <div className="mt-2 flex items-center gap-1.5">
        <div className="relative">
          <Avatar value={photoUrl ?? state.profile.avatar} name={name} size={64} />
          {busy ? (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-bg/70">
              <Loader2 size={18} className="animate-spin text-brand" aria-hidden />
            </span>
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="secondary"
              icon={Camera}
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              {photoUrl ? 'Change photo' : 'Upload photo'}
            </Button>
            {photoUrl ? (
              <Button size="sm" variant="quiet" icon={Trash2} onClick={removePhoto} disabled={busy}>
                Remove
              </Button>
            ) : null}
          </div>
          <p className="mt-0.5 text-2xs text-ink-3">
            {busy
              ? `Uploading… ${Math.round(uploading * 100)}%`
              : 'PNG, JPEG, WebP or GIF · up to 2 MB'}
          </p>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT_ATTR}
            onChange={pickPhoto}
            className="sr-only"
            aria-label="Choose a profile photo"
          />
        </div>
      </div>

      {/* fields */}
      <form className="mt-2 space-y-1.5" onSubmit={save}>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <Field label="Course" value={fields.course} onChange={set('course')} placeholder="B.Tech" maxLength={80} />
          <Field label="Branch" value={fields.branch} onChange={set('branch')} placeholder="Computer Science" maxLength={80} />
        </div>

        <div>
          <label htmlFor="cp-year" className="text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">
            Year
          </label>
          <select
            id="cp-year"
            value={fields.studyYear}
            onChange={set('studyYear')}
            className="mt-0.5 h-[36px] w-full rounded-md border border-line bg-subtle/50 px-1 text-sm outline-none focus:border-brand"
          >
            <option value="">Not saying</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((y) => (
              <option key={y} value={y}>Year {y}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="cp-bio" className="text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">
            About you
          </label>
          <textarea
            id="cp-bio"
            value={fields.bio}
            onChange={set('bio')}
            rows={2}
            maxLength={280}
            placeholder="One line about you"
            className="mt-0.5 w-full resize-y rounded-md border border-line bg-subtle/50 px-1.5 py-1 text-sm outline-none focus:border-brand"
          />
          <p className="text-right text-2xs text-ink-3">{fields.bio.length}/280</p>
        </div>

        <Button
          type="submit"
          size="sm"
          variant="primary"
          className="w-full"
          icon={saving ? Loader2 : saved ? Check : undefined}
          disabled={saving || !loaded}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save profile'}
        </Button>
      </form>
    </Card>
  );
}

function Field({ label, value, onChange, placeholder, maxLength }) {
  const id = `cp-${label.toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxLength={maxLength}
        className="mt-0.5 h-[36px] w-full rounded-md border border-line bg-subtle/50 px-1 text-sm outline-none focus:border-brand"
      />
    </div>
  );
}
