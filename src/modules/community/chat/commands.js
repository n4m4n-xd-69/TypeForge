import { AI_COMMAND } from '../../../lib/chat/constants.js';

/**
 * The slash-command registry. One entry today; adding a second is a one-line
 * addition here, not new UI — `SlashCommandHint.jsx` renders whatever this
 * array contains.
 */
export const COMMANDS = [
  { command: AI_COMMAND, description: 'Ask the AI a question — replies concisely, right in the channel.' },
];

/**
 * Commands whose name starts with what's been typed so far.
 *
 * Only ever called on text starting with '/' — `Composer.jsx` gates that —
 * but checked here too so this stays correct on its own.
 */
export function matchCommands(input) {
  if (typeof input !== 'string' || !input.startsWith('/')) return [];
  const needle = input.toLowerCase();
  return COMMANDS.filter((c) => c.command.toLowerCase().startsWith(needle));
}
