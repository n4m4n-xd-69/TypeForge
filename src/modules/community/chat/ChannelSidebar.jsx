// src/modules/community/chat/ChannelSidebar.jsx
import { Link } from 'react-router-dom';
import { Hash } from 'lucide-react';
import { cx } from '../../../lib/format.js';

export default function ChannelSidebar({ channels, activeSlug }) {
  return (
    <nav className="w-[176px] shrink-0 space-y-px overflow-y-auto border-r border-line p-1.5">
      {channels.map((c) => (
        <Link
          key={c.id}
          to={`/community/chat/${c.slug}`}
          className={cx(
            'flex items-center gap-1 rounded-md px-1.5 py-1 text-sm',
            c.slug === activeSlug ? 'bg-subtle font-bold text-ink' : 'text-ink-3 hover:bg-subtle/60 hover:text-ink-2',
          )}
        >
          <Hash size={14} strokeWidth={2.2} aria-hidden />
          {c.name.replace(/^#/, '')}
        </Link>
      ))}
    </nav>
  );
}
