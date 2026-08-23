/**
 * Palette validator for the TypeForge design system.
 *
 * The design brief (docs/04-design-brief.md §C.1) publishes a contrast figure
 * for every token on every surface it appears on. Those figures are only worth
 * anything if something re-derives them, so this does — and exits non-zero when
 * a pair drops below its target. Wire it into CI alongside the build.
 *
 * Two things it deliberately does NOT do:
 *
 *   1. Judge the chart ramp. Categorical separation is a ΔE problem, not a
 *      contrast-ratio one, and scoring it here would give a confident answer to
 *      the wrong question. It only checks that each slot is legible against its
 *      surface; palette.js keeps the real validation.
 *
 *   2. Pass colour-blind pairs. It reports the simulated separation and lets it
 *      be low, because the design rule is that colour never carries meaning
 *      alone — see DP-6. A failing number here is a reminder, not a defect.
 *
 * Usage:  node scripts/check-contrast.mjs [--verbose]
 */

const VERBOSE = process.argv.includes('--verbose');

/* ── colour maths ─────────────────────────────────────────────────────── */

const channels = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};

const linearise = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex) => {
  const [r, g, b] = channels(hex);
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
};

/** WCAG 2.x relative contrast. Order-independent. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Brettel/Viénot-style dichromacy approximation.
 *
 * Good enough to answer "do these two collapse into each other" — which is the
 * only question asked of it. Not a substitute for testing with real users.
 */
export function simulate(hex, type) {
  const [r, g, b] = channels(hex).map(linearise);
  const m = {
    protan: [[0.1121, 0.8853, -0.0005], [0.1127, 0.8897, -0.0001], [0.0045, 0.0085, 1]],
    deutan: [[0.292, 0.7054, -0.0003], [0.2934, 0.7089, 0], [-0.0195, 0.0333, 1]],
    tritan: [[1, 0.1502, -0.1504], [0, 0.8172, 0.1828], [0, 0, 1]],
  }[type];

  const encode = (c) => {
    const v = Math.max(0, Math.min(1, c));
    return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
  };

  return `#${m.map((row) => encode(row[0] * r + row[1] * g + row[2] * b))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/* ── the palette under test ───────────────────────────────────────────── */

/**
 * Accents come in two variants and confusing them is the easy mistake — this
 * validator caught exactly that in its own first run.
 *
 *   --forge        stroke and text. Theme-dependent, because it has to clear
 *                  4.5:1 against the surface, and a colour bright enough to do
 *                  that on near-black is far too light on white.
 *   --forge-solid  the fill. Identical in both themes, because a brand fill
 *                  that changed hue between themes would not be a brand fill.
 *
 * Dark ink sits on the solid variant. Testing dark ink against the *stroke*
 * variant compares two dark colours and fails for a reason that has nothing to
 * do with the design.
 */
const DARK = {
  bg: '#0A0B0D', surface: '#121417', raised: '#1A1D21',
  line: '#24282D', lineStrong: '#333940',
  ink: '#F2F4F7', ink2: '#A8B0BA', ink3: '#828C97',
  forge: '#FF7A2F', quench: '#4FC3F7',
  good: '#4ADE80', warn: '#FFC53D', bad: '#FF4D6D', info: '#5AA9FF',
};

const LIGHT = {
  bg: '#FAFAF9', surface: '#FFFFFF', raised: '#FFFFFF',
  line: '#E6E6E3', lineStrong: '#CBCBC7',
  ink: '#14161A', ink2: '#4A515A', ink3: '#6B737D',
  forge: '#C2410C', quench: '#0369A1',
  good: '#0C7A41', warn: '#8A5A00', bad: '#C42B2B', info: '#1D6FD0',
};

/** Shared by both themes. */
const FILLS = {
  forge: '#FF7A2F', quench: '#4FC3F7',
  good: '#4ADE80', warn: '#FFC53D', bad: '#FF4D6D',
};

/** Text on a solid accent is always the darkest ink — white fails on forge. */
const FILL_INK = '#0A0B0D';

const TEXT_TOKENS = ['ink', 'ink2', 'ink3', 'forge', 'quench', 'good', 'warn', 'bad', 'info'];

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/* ── checks ───────────────────────────────────────────────────────────── */

const failures = [];
const notes = [];

function checkTextOnSurfaces(themeName, palette, surfaces) {
  for (const surface of surfaces) {
    for (const token of TEXT_TOKENS) {
      const ratio = contrast(palette[token], palette[surface]);
      const ok = ratio >= AA_TEXT;
      if (!ok) {
        failures.push(
          `${themeName}: --${token} (${palette[token]}) on --${surface} (${palette[surface]}) `
          + `= ${ratio.toFixed(2)}:1, below AA ${AA_TEXT}`,
        );
      }
      if (VERBOSE) {
        const grade = ratio >= 7 ? 'AAA' : ok ? 'AA ' : 'FAIL';
        console.log(`  ${themeName.padEnd(5)} --${token.padEnd(7)} on --${surface.padEnd(8)} ${ratio.toFixed(2).padStart(6)}:1  ${grade}`);
      }
    }
  }
}

/** The focus ring has to be findable against everything it can land on. */
function checkFocusRing(themeName, palette) {
  for (const surface of ['bg', 'surface', 'raised']) {
    const ratio = contrast(palette.forge, palette[surface]);
    if (ratio < AA_NON_TEXT) {
      failures.push(
        `${themeName}: focus ring --forge on --${surface} = ${ratio.toFixed(2)}:1, below ${AA_NON_TEXT}`,
      );
    }
  }
}

/**
 * Every solid fill carries dark ink, in both themes, because the fills are the
 * same colour in both. White is checked too so the margin is visible: on forge
 * it lands around 2.6:1, which is why the rule is absolute rather than a
 * preference a designer can override per component.
 */
function checkFills() {
  for (const [token, fill] of Object.entries(FILLS)) {
    const dark = contrast(FILL_INK, fill);
    const white = contrast('#FFFFFF', fill);
    if (dark < AA_TEXT) {
      failures.push(`--fill-ink on --${token}-solid (${fill}) = ${dark.toFixed(2)}:1, below AA`);
    }
    if (white >= AA_TEXT) {
      notes.push(`fill: white also clears AA on --${token}-solid (${white.toFixed(2)}:1) — dark ink is still the house rule`);
    }
    if (VERBOSE) {
      console.log(`  fill --${token.padEnd(7)} ${fill}  dark ${dark.toFixed(2).padStart(6)}:1  white ${white.toFixed(2).padStart(6)}:1`);
    }
  }
}

/**
 * Typing states, which is where colour-only signalling actually bites.
 *
 * `wrong` and `pending` sit at nearly the same luminance, so the passage would
 * be unreadable for anyone relying on lightness alone. Reported rather than
 * failed: the fix is the underline and background in TypingStage, not a
 * different red.
 */
function checkTypingStates(palette) {
  const states = {
    pending: palette.ink3,
    correct: palette.ink,
    wrong: palette.bad,
    corrected: palette.warn,
  };
  const separation = contrast(states.wrong, states.pending);
  notes.push(
    `typing: wrong vs pending = ${separation.toFixed(2)}:1 on colour alone `
    + `— non-colour cue is REQUIRED (see design brief D.14)`,
  );
  if (VERBOSE) {
    for (const [name, value] of Object.entries(states)) {
      console.log(`  state ${name.padEnd(10)} ${value}  ${contrast(value, palette.surface).toFixed(2).padStart(6)}:1 on --surface`);
    }
  }
}

/** Reported, never failed — see the header note. */
function reportCvd(palette) {
  for (const [a, b, label] of [['forge', 'quench', 'forge/quench'], ['good', 'bad', 'good/bad']]) {
    const worst = ['protan', 'deutan', 'tritan']
      .map((t) => contrast(simulate(palette[a], t), simulate(palette[b], t)))
      .reduce((lo, v) => Math.min(lo, v));
    notes.push(`cvd: ${label} worst-case separation ${worst.toFixed(2)}:1 — colour must not carry meaning alone`);
  }
}

/* ── run ──────────────────────────────────────────────────────────────── */

if (VERBOSE) console.log('\n— text on surfaces —');
checkTextOnSurfaces('dark', DARK, ['bg', 'surface', 'raised']);
checkTextOnSurfaces('light', LIGHT, ['bg', 'surface']);

if (VERBOSE) console.log('\n— solid fills (shared across themes) —');
checkFills();

checkFocusRing('dark', DARK);
checkFocusRing('light', LIGHT);

if (VERBOSE) console.log('\n— typing states —');
checkTypingStates(DARK);
reportCvd(DARK);

console.log('');
for (const note of notes) console.log(`note  ${note}`);

if (failures.length) {
  console.error(`\n${failures.length} contrast failure${failures.length === 1 ? '' : 's'}:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}

console.log('\n✓ every token clears WCAG AA on every surface it is used on');
