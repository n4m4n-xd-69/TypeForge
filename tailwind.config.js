/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    /**
     * 4px base, 8px rhythm.
     *
     * The scale is closed — no arbitrary values — so density is a decision
     * made once per surface archetype rather than per component. A Stage
     * uses `4`, a Console uses `3`, a Ledger uses `2`.
     */
    spacing: {
      0: '0px', px: '1px',
      0.5: '4px', 1: '8px', 1.5: '12px', 2: '16px', 2.5: '20px',
      3: '24px', 3.5: '28px', 4: '32px', 5: '40px', 6: '48px',
      7: '56px', 8: '64px', 9: '72px', 10: '80px', 12: '96px',
      14: '112px', 16: '128px', 20: '160px', 24: '192px',
    },
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        /* `subtle` is retained as an alias for --raised. Around thirty files
           use bg-subtle for the same job the raised step now names, and
           breaking them to rename a token would be churn for its own sake. */
        subtle: 'rgb(var(--raised) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',

        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
        'ink-3': 'rgb(var(--ink-3) / <alpha-value>)',

        brand: 'rgb(var(--brand) / <alpha-value>)',
        'brand-solid': 'rgb(var(--brand-solid) / <alpha-value>)',
        'brand-ink': 'rgb(var(--brand-ink) / <alpha-value>)',
        'brand-wash': 'rgb(var(--brand-wash) / <alpha-value>)',

        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-ink': 'rgb(var(--accent-ink) / <alpha-value>)',
        'accent-wash': 'rgb(var(--accent-wash) / <alpha-value>)',

        good: 'rgb(var(--good) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        'on-status': 'rgb(var(--on-status) / <alpha-value>)',
      },

      /**
       * Three families, eight weights — the same load budget the previous
       * two-family set used.
       *
       *   display  Space Grotesk — geometric and slightly mechanical.
       *            Headlines, hero metrics, the wordmark.
       *   sans     IBM Plex Sans — technical character, legible at 13px.
       *            Chosen over Inter, which is the default everywhere.
       *   mono     JetBrains Mono — unambiguous 1/l/I and 0/O. Every
       *            numeral, all code, and the typing surface itself.
       */
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },

      fontSize: {
        '2xs': ['11px', { lineHeight: '14px', letterSpacing: '0.1em' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '20px' }],
        base: ['14px', { lineHeight: '22px' }],
        lg: ['16px', { lineHeight: '26px' }],
        xl: ['19px', { lineHeight: '26px', letterSpacing: '-0.005em' }],
        '2xl': ['24px', { lineHeight: '30px', letterSpacing: '-0.02em' }],
        '3xl': ['34px', { lineHeight: '38px', letterSpacing: '-0.03em' }],
        '4xl': ['48px', { lineHeight: '52px', letterSpacing: '-0.035em' }],
        '5xl': ['64px', { lineHeight: '64px', letterSpacing: '-0.04em' }],
        /* Typing surface. Separate from the text scale because it is set in
           mono and its line-height is governed by caret geometry. */
        'type-s': ['18px', { lineHeight: '2' }],
        'type-m': ['20px', { lineHeight: '2' }],
        'type-l': ['22px', { lineHeight: '2' }],
        'type-xl': ['24px', { lineHeight: '2' }],
      },

      /* Tightened from a scale that topped out at 32px — soft reads as
         friendly, and this product is precise. */
      borderRadius: {
        xs: '4px', sm: '6px', md: '10px', lg: '14px', xl: '20px', '2xl': '28px',
      },

      /**
       * Five elevation levels, each with one job. Named e0–e4 rather than
       * xs–xl so the level is the name: a component asks for elevation 2,
       * not for a size adjective.
       */
      boxShadow: {
        e0: 'none',
        e1: '0 1px 2px rgb(var(--shadow) / 0.05)',
        e2: '0 2px 8px -2px rgb(var(--shadow) / 0.10), 0 1px 3px -1px rgb(var(--shadow) / 0.06)',
        e3: '0 8px 24px -6px rgb(var(--shadow) / 0.18), 0 2px 8px -2px rgb(var(--shadow) / 0.10)',
        e4: '0 24px 60px -12px rgb(var(--shadow) / 0.28), 0 8px 20px -8px rgb(var(--shadow) / 0.14)',
        focus: '0 0 0 2px rgb(var(--brand) / 0.4)',

        /* Aliases onto the elevation scale.
           Twenty-five call sites use the old size names, and Tailwind ships
           its own shadow-sm/md/lg/xl — so dropping these would not error,
           it would silently swap in defaults that ignore --shadow and look
           wrong in dark mode. Mapped rather than removed; call sites migrate
           to e0–e4 as each surface is redesigned. */
        xs: '0 1px 2px rgb(var(--shadow) / 0.05)',
        sm: '0 2px 8px -2px rgb(var(--shadow) / 0.10), 0 1px 3px -1px rgb(var(--shadow) / 0.06)',
        md: '0 8px 24px -6px rgb(var(--shadow) / 0.18), 0 2px 8px -2px rgb(var(--shadow) / 0.10)',
        lg: '0 8px 24px -6px rgb(var(--shadow) / 0.18), 0 2px 8px -2px rgb(var(--shadow) / 0.10)',
        xl: '0 24px 60px -12px rgb(var(--shadow) / 0.28), 0 8px 20px -8px rgb(var(--shadow) / 0.14)',
        glow: '0 0 0 1px rgb(var(--brand) / 0.25), 0 8px 32px -8px rgb(var(--brand) / 0.30)',
      },

      /**
       * Motion tokens.
       *
       * `out` decelerates and is the default. `spring` overshoots slightly
       * and is reserved for controls that should feel physical — toggles,
       * the countdown beat. Nothing uses a linear curve except pressed
       * states, where 80ms is too short for a curve to register.
       */
      transitionDuration: {
        instant: '80ms',
        fast: '120ms',
        base: '180ms',
        slow: '280ms',
        deliberate: '420ms',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.2, 0, 0, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },

      keyframes: {
        'fade-up': {
          from: { opacity: 0, transform: 'translateY(8px)' },
          to: { opacity: 1, transform: 'none' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        blink: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.15 } },
        'pop-in': {
          from: { opacity: 0, transform: 'scale(0.94)' },
          to: { opacity: 1, transform: 'scale(1)' },
        },
        /* Replaces the confetti burst. One sweep across a result, then gone. */
        'forge-sweep': {
          from: { transform: 'translateX(-110%)' },
          to: { transform: 'translateX(210%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 280ms cubic-bezier(0.2,0,0,1) both',
        shimmer: 'shimmer 1.6s infinite',
        blink: 'blink 1s steps(2, start) infinite',
        'pop-in': 'pop-in 180ms cubic-bezier(0.34,1.56,0.64,1) both',
        'forge-sweep': 'forge-sweep 420ms cubic-bezier(0.2,0,0,1) both',
      },
    },
  },
  plugins: [],
};
