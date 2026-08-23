import { AnimatePresence, motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../lib/theme.jsx';

export default function ThemeToggle() {
  const { isDark, toggle, preference } = useTheme();

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      title={preference === 'system' ? 'Following your system theme' : `${isDark ? 'Dark' : 'Light'} theme`}
      className="relative grid h-[36px] w-[36px] place-items-center overflow-hidden rounded-sm text-ink-2 transition-colors hover:bg-subtle hover:text-ink [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:w-[44px]"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isDark ? 'moon' : 'sun'}
          initial={{ y: 14, opacity: 0, rotate: -30 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: -14, opacity: 0, rotate: 30 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="absolute grid place-items-center"
        >
          {isDark ? <Moon size={17} strokeWidth={2.1} /> : <Sun size={17} strokeWidth={2.1} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
