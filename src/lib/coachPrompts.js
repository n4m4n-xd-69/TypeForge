/**
 * What the coach offers you to say next.
 *
 * Two jobs, and they are the same job at different points in a conversation:
 *
 *   `startersFor`   — the blank state, seeded from the user's own figures.
 *   `followUpsFor`  — after an answer, seeded from what that answer was about.
 *
 * Both are pure and synchronous. That is deliberate: asking the model to
 * suggest its own follow-ups costs a second round trip per turn, doubles the
 * bill, and produces suggestions that arrive after the user has already
 * started typing. Reading the answer that just landed is enough — an answer
 * containing a fenced snippet wants different next moves than one about
 * posture, and that is decidable here for free.
 *
 * Lives outside the components so the page and the floating panel offer the
 * same next steps, and so the rules can be tested without a renderer.
 */

/**
 * The language, as a name rather than as a settings value.
 *
 * `settings.lastLanguage` is stored lowercase because it keys the snippet
 * tables. Printing that straight into a sentence gives "a javascript idiom",
 * which reads as a bug rather than as prose — and capitalising the first
 * letter is not enough, because the languages whose names carry internal
 * capitals are exactly the ones this app ships most of. Hence a table, with
 * first-letter capitalisation only as the fallback for anything added later.
 */
const LANGUAGE_NAME = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  sql: 'SQL',
  cpp: 'C++',
};

export function languageName(language) {
  const lang = language?.trim();
  if (!lang) return 'JavaScript';
  return LANGUAGE_NAME[lang.toLowerCase()] ?? lang[0].toUpperCase() + lang.slice(1);
}

/**
 * Blank-state prompts, banded by level.
 *
 * A fixed starter list goes stale the moment someone improves: "where do I
 * start" is the wrong question at level 8. These are seeded with real figures,
 * so the blank state stays worth reading as the numbers move.
 *
 * `icon` is a key into the caller's own icon map rather than a component, so
 * this module stays free of anything that has to render.
 */
export function startersFor(stats, weak, language) {
  const wpm = Math.round(stats.wpm);
  const acc = Math.round(stats.accuracy);
  const level = stats.level.level;
  const lang = languageName(language);

  if (!stats.sessionCount) {
    return [
      { icon: 'keyboard', text: 'I have never touch-typed. Where do I start?' },
      { icon: 'target', text: 'Build me a 15-minute daily practice plan.' },
      { icon: 'brain', text: 'Explain variables and types with a tiny example.' },
      { icon: 'hand', text: 'Should I learn proper finger placement first?' },
    ];
  }

  const out = [];
  out.push(
    acc < 95
      ? { icon: 'target', text: `My accuracy sits around ${acc}%. What should I change?` }
      : {
          icon: 'zap',
          text: `I am at ${wpm} WPM and ${acc}% accuracy. How do I go faster without losing accuracy?`,
        },
  );
  if (weak.length) {
    out.push({ icon: 'type', text: `Design a drill for my weakest keys: ${weak.slice(0, 4).join(', ')}.` });
  }
  out.push(
    level < 5
      ? { icon: 'brain', text: `Explain ${lang} functions with a tiny example.` }
      : level < 15
        ? { icon: 'brain', text: `Explain closures in ${lang} with a tiny example.` }
        : { icon: 'brain', text: `Give me an advanced ${lang} idiom worth drilling.` },
  );
  out.push({ icon: 'trend', text: `What should I focus on to reach level ${level + 1}?` });
  return out.slice(0, 4);
}

/**
 * Topic rules, most specific first.
 *
 * Order matters: an answer about a weak-key drill mentions both "drill" and
 * "accuracy", and the drill follow-ups are the more useful pair. First match
 * wins, then the generics top the list up to three.
 */
const TOPICS = [
  {
    id: 'code',
    test: (t) => t.includes('```'),
    prompts: [
      'Turn that snippet into a typing drill.',
      'Show me a harder variant of it.',
      'What is the idiomatic way to write that?',
    ],
  },
  {
    id: 'drill',
    test: (t) => /\bdrill|\bexercise|\brepetition|\bwarm[- ]?up/.test(t),
    prompts: [
      'Turn this into a 10-minute daily plan.',
      'How will I know the drill is working?',
      'Give me a harder version for next week.',
    ],
  },
  {
    id: 'accuracy',
    test: (t) => /\baccuracy|\berror|\bmistake|\btypo/.test(t),
    prompts: [
      'What accuracy should I hit before pushing speed?',
      'Why do I make more errors when I speed up?',
      'Drill the mistakes I make most.',
    ],
  },
  {
    id: 'speed',
    test: (t) => /\bwpm|\bspeed|\bfaster|\bburst/.test(t),
    prompts: [
      'Set me a realistic 30-day target.',
      'What is actually capping my speed?',
      'Should I practise bursts or long runs?',
    ],
  },
  {
    id: 'technique',
    test: (t) => /\bfinger|\bhome row|\bposture|\bwrist|\bhand/.test(t),
    prompts: [
      'Which drills fix my finger placement?',
      'How do I stop looking at the keyboard?',
      'Check my posture — what should I watch for?',
    ],
  },
  {
    id: 'concept',
    test: (t) => /\bfunction|\bclosure|\bvariable|\bsyntax|\basync|\bloop\b/.test(t),
    prompts: [
      'Give me a smaller example of that.',
      'Where would I actually use this?',
      'What usually trips people up here?',
    ],
  },
];

/** Always available, used to top up a short list. */
const GENERIC = [
  'Explain that more simply.',
  'Give me a concrete example.',
  'What should I practise next?',
];

/**
 * The next three things worth asking, given the answer that just landed.
 *
 * Anything already asked in this thread is filtered out — re-offering a
 * question the user has already sent is the fastest way to make suggestions
 * feel canned. Returns `[]` when there is nothing to follow up on, so the
 * caller renders nothing rather than a row of filler.
 */
export function followUpsFor(messages, { weak = [] } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || last.failed) return [];

  const text = typeof last.text === 'string' ? last.text : '';
  if (!text.trim()) return [];

  const haystack = text.toLowerCase();
  const topic = TOPICS.find((t) => t.test(haystack));

  const out = [];
  const push = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };

  if (topic) topic.prompts.forEach(push);

  /* A long answer is the one case where the most useful next move is about the
     answer's shape rather than its subject. */
  if (text.length > 900) push('Condense that into a checklist.');

  /* Weak keys are the one piece of context worth volunteering unprompted —
     it is the thing the user came here for and rarely thinks to ask. */
  if (weak.length && !haystack.includes(weak[0].toLowerCase())) {
    push(`Work my weakest keys in: ${weak.slice(0, 3).join(', ')}.`);
  }

  GENERIC.forEach(push);

  /* Never offer a question back that the user has already sent. */
  const asked = new Set(
    messages
      .filter((m) => m.role === 'user' && typeof m.text === 'string')
      .map((m) => m.text.trim().toLowerCase()),
  );

  return out.filter((p) => !asked.has(p.toLowerCase())).slice(0, 3);
}

/**
 * The run, as steps.
 *
 * Derived from the stream's own state rather than from a timer, so a step is
 * only marked done once the phase that produces it has actually finished.
 * A trace that advances on a `setTimeout` is a progress bar that lies, and
 * this one sits directly above the answer it describes.
 *
 * Three phases, because three is what the transport actually exposes:
 * the request is out, reasoning tokens are arriving, answer tokens are
 * arriving. Inventing "searching the web" or "running a tool" here would be
 * describing work no one is doing.
 */
export function traceSteps({ thinking, partial, hasContext }) {
  const writing = Boolean(partial);
  const reasoning = Boolean(thinking) && !writing;

  return [
    {
      id: 'context',
      label: hasContext ? 'Read your practice data' : 'Opened the session',
      state: 'done',
    },
    {
      id: 'reason',
      label: 'Working out the answer',
      state: reasoning ? 'active' : writing ? 'done' : 'idle',
    },
    {
      id: 'write',
      label: 'Writing the reply',
      state: writing ? 'active' : 'idle',
    },
  ];
}

/**
 * What the coach can do, as four cards.
 *
 * The panel opens on these rather than on a bare prompt because it is reached
 * mid-task: you are on the dashboard, something occurs to you, and picking is
 * faster than composing. Each card carries a real prompt seeded with the
 * user's own figures, so "Drills" is never a generic request.
 */
export function capabilitiesFor(stats, weak = [], language) {
  const lang = languageName(language);
  const acc = Math.round(stats.accuracy);

  return [
    {
      icon: 'hand',
      label: 'Technique',
      hint: 'Posture, fingers, gaze',
      prompt: stats.sessionCount
        ? `My accuracy is around ${acc}%. What technique change would help most?`
        : 'I am starting from scratch. What technique should I learn first?',
    },
    {
      icon: 'target',
      label: 'Drills',
      hint: weak.length ? `Your weak keys` : 'Targeted practice',
      prompt: weak.length
        ? `Design a drill for my weakest keys: ${weak.slice(0, 4).join(', ')}.`
        : 'Design a drill for the keys I am most likely to be weak on.',
    },
    {
      icon: 'braces',
      label: 'Code',
      hint: `${lang} concepts`,
      prompt: `Explain a ${lang} idiom worth drilling, with a tiny example.`,
    },
    {
      icon: 'trend',
      label: 'Progress',
      hint: `Level ${stats.level.level} · next steps`,
      prompt: `What should I focus on to reach level ${stats.level.level + 1}?`,
    },
  ];
}

/**
 * Which bucket a saved thread belongs in.
 *
 * Threads carry no category of their own, and adding one to the stored shape
 * would strand every conversation saved before it. The title is the first
 * thing the user said, which is both already stored and the thing they would
 * search for — so the bucket is derived from it on read.
 *
 * Order matters: "drill my closures" is a drill, not a code question, because
 * the drill is what the user is asking for.
 */
export function categorise(title = '') {
  const t = String(title).toLowerCase();
  if (/\bdrill|\bpractice|\bpractise|\bplan\b|\bwarm[- ]?up|\bkeys?\b/.test(t)) return 'Drills';
  if (/\bcode|\bfunction|\bclosure|\bsyntax|\bjavascript|\bpython|\brust\b|\bsnippet|\bidiom/.test(t)) return 'Code';
  if (/\bfinger|\bposture|\bhome row|\bwrist|\bhand|\btechnique/.test(t)) return 'Technique';
  return 'Coaching';
}
