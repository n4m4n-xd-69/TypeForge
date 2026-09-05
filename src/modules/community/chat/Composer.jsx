// src/modules/community/chat/Composer.jsx
import { useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Send, X } from 'lucide-react';
import Button, { IconButton } from '../../../components/ui/Button.jsx';
import { useToast } from '../../../components/ui/Toast.jsx';
import { useAuth } from '../../../lib/auth.jsx';
import { supabase } from '../../../lib/supabase.js';
import { validateImage, downscaleImage } from '../../../lib/media/image.js';
import { chatErrorMessage } from '../../../lib/chat/api.js';
import { AI_COMMAND } from '../../../lib/chat/constants.js';
import SlashCommandHint from './SlashCommandHint.jsx';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 1600;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

async function uploadChatImage(userId, file) {
  const invalid = validateImage(file, { maxBytes: MAX_BYTES, accepted: ACCEPTED });
  if (invalid) throw new Error(invalid);
  const prepared = await downscaleImage(file, { maxEdge: MAX_EDGE });
  const ext = prepared.type === 'image/webp' ? 'webp' : (prepared.name.split('.').pop() || 'jpg');
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('chat-images')
    .upload(path, prepared, { cacheControl: '3600', contentType: prepared.type });
  if (error) throw new Error(error.message || 'The upload failed. Try again.');
  return supabase.storage.from('chat-images').getPublicUrl(path).data.publicUrl;
}

export default function Composer({ onSend, onAiCommand }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pickedImage, setPickedImage] = useState(null);
  const fileInput = useRef(null);

  const submit = async (event) => {
    event.preventDefault();
    const text = body.trim();
    if ((!text && !pickedImage) || sending) return;

    setSending(true);
    try {
      let imageUrl = null;
      if (pickedImage) {
        setUploading(true);
        imageUrl = await uploadChatImage(user.id, pickedImage);
        setUploading(false);
      }
      const row = await onSend(text || null, imageUrl);
      setBody('');
      setPickedImage(null);
      if (row && text.toLowerCase().startsWith(`${AI_COMMAND} `)) {
        onAiCommand(row.id);
      }
    } catch (err) {
      toast(chatErrorMessage(err) ?? err.message ?? 'Could not send that.', { tone: 'error' });
    } finally {
      setSending(false);
      setUploading(false);
    }
  };

  const pickImage = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const invalid = validateImage(file, { maxBytes: MAX_BYTES, accepted: ACCEPTED });
    if (invalid) {
      toast(invalid, { tone: 'error' });
      return;
    }
    setPickedImage(file);
  };

  return (
    <form onSubmit={submit} className="relative shrink-0 border-t border-line bg-bg p-2">
      <SlashCommandHint
        input={body}
        onPick={(command) => setBody(`${command} `)}
      />

      {pickedImage ? (
        <div className="mb-1 flex items-center gap-1.5 rounded-md bg-subtle/60 px-1.5 py-1 text-xs">
          <ImageIcon size={14} aria-hidden />
          <span className="truncate">{pickedImage.name}</span>
          <IconButton size="sm" label="Remove image" icon={X} onClick={() => setPickedImage(null)} className="ml-auto" />
        </div>
      ) : null}

      <div className="flex items-end gap-1.5">
        <IconButton
          type="button"
          label="Attach an image"
          icon={ImageIcon}
          onClick={() => fileInput.current?.click()}
          disabled={sending}
        />
        <input ref={fileInput} type="file" accept={ACCEPTED.join(',')} onChange={pickImage} className="sr-only" aria-label="Choose an image" />

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={1}
          maxLength={2000}
          placeholder="Message… (/ for commands)"
          className="max-h-32 flex-1 resize-none rounded-md border border-line bg-subtle/50 px-1.5 py-1 text-sm outline-none focus:border-brand"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e); }
          }}
        />

        <Button
          type="submit"
          size="sm"
          variant="primary"
          icon={sending ? Loader2 : Send}
          disabled={sending || (!body.trim() && !pickedImage)}
        >
          {uploading ? 'Uploading…' : sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </form>
  );
}
