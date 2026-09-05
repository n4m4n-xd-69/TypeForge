import { Card } from '../../../components/ui/Primitives.jsx';
import { matchCommands } from './commands.js';

/**
 * The `/`-triggered popup above the composer — Discord/Slack's pattern.
 * Renders nothing once there's no match, so the composer can mount this
 * unconditionally rather than guarding it itself.
 */
export default function SlashCommandHint({ input, onPick }) {
  const matches = matchCommands(input);
  if (matches.length === 0) return null;

  return (
    <Card className="absolute bottom-full left-0 mb-1 w-full max-w-sm overflow-hidden p-1" role="listbox">
      {matches.map((c) => (
        <button
          key={c.command}
          type="button"
          role="option"
          onClick={() => onPick(c.command)}
          className="flex w-full items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-subtle"
        >
          <span className="font-mono text-sm font-bold text-brand">{c.command}</span>
          <span className="truncate text-xs text-ink-3">{c.description}</span>
        </button>
      ))}
    </Card>
  );
}
