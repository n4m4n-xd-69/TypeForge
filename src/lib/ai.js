import { complete, chat, aiConfigured, providerSummary, AIUnavailable, AI_REASON_COPY } from './ai-runner.js';
import { generateContent } from './forge/client.js';

/**
 * Task-level AI: prompts, JSON contracts and offline fallbacks.
 *
 * Transport (provider priority, hedging, failover, streaming) lives in
 * `ai-runner.js`. Nothing here needs to know which provider answered.
 *
 * Every public helper degrades rather than throwing for ordinary outages, so
 * the UI keeps working with no network and no keys.
 */

export { aiConfigured, providerSummary, AIUnavailable, AI_REASON_COPY, chat };

const CACHE = new Map();
const inflight = new Map();

export function clearAICache() {
  CACHE.clear();
}

/**
 * Memoised producer with in-flight de-duplication.
 *
 * Two callers asking for the same key share one request — but only while that
 * request is healthy. If the shared attempt rejects, the joining caller must
 * NOT inherit the failure: the usual cause is that whoever started it aborted
 * (navigated, switched snippet, or React StrictMode double-mounted), which says
 * nothing about whether *this* caller can succeed. Inheriting it produced a
 * panel that reported "timed out" without ever having made a request of its own.
 *
 * So a failed join falls through and starts a fresh attempt. The retry is
 * bounded: only one, and only for a caller that did not itself abort.
 */
async function cached(key, producer, shouldCache = () => true) {
  if (CACHE.has(key)) return CACHE.get(key);

  const existing = inflight.get(key);
  if (existing) {
    try {
      return await existing;
    } catch {
      // The shared attempt died. Re-check the cache in case a third caller
      // succeeded in the meantime, then fall through and run our own.
      if (CACHE.has(key)) return CACHE.get(key);
    }
  }

  const p = producer()
    .then((value) => {
      if (shouldCache(value)) CACHE.set(key, value);
      return value;
    })
    .finally(() => {
      // Only clear the slot if it is still ours — a later caller may have
      // already replaced it after joining our failure.
      if (inflight.get(key) === p) inflight.delete(key);
    });

  inflight.set(key, p);
  return p;
}

/** Models like to wrap JSON in prose or fences. Dig the object back out. */
function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new AIUnavailable('No JSON object in response', 'bad-response');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    throw new AIUnavailable(`Malformed JSON: ${err.message}`, 'bad-response');
  }
}

/** True when a rejection is "the caller aborted", not "the provider failed". */
function isAbort(err, signal) {
  return err?.name === 'AbortError' || Boolean(signal?.aborted);
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* ── Code analysis ─────────────────────────────────────────────────────── */

const ANALYSIS_SHAPE = `{
  "intro": "2-4 sentences: what this program is, what problem it solves, how it works end to end, and which language features it leans on.",
  "summary": "one sentence, under 140 characters",
  "explanation": ["5 to 8 steps in execution order. Name the exact construct in markdown backticks. Explain WHY each line exists."],
  "examples": [
    {"title": "3-5 words naming the case", "input": "a concrete call or input value, in code", "output": "what it evaluates to or prints, in code", "note": "one short sentence on why this case is worth seeing"}
  ],
  "flow": [
    {"id": "n1", "step": "short label, 2-4 words", "detail": "one or two sentences", "kind": "start|process|decision|loop|output|end", "next": ["n2"], "branch": "label for a decision edge, else empty", "example": "a concrete value at this step wrapped in markdown backticks, such as i = 2 or res.ok === false. Empty string if nothing meaningful."}
  ],
  "timeComplexity": {"value": "O(n)", "why": "2 sentences naming which construct drives the growth"},
  "spaceComplexity": {"value": "O(1)", "why": "2 sentences naming what is allocated"},
  "bestPractices": ["3-5 bullets tied to something visible in this snippet"],
  "commonMistakes": ["3-5 bullets: what people get wrong with THIS pattern"],
  "improvements": ["3-5 concrete bullets"]
}`;

export async function analyseCode(code, language, { signal } = {}) {
  return cached(
    `analyse:${language}:${hash(code)}`,
    async () => {
      try {
        const raw = await chat(
          [
            {
              role: 'system',
              content:
                'You are a senior engineer explaining code to a motivated beginner. Reply with a single JSON object and nothing else — no prose, no code fences around the object. Inside string values you MAY use markdown: backticks for identifiers, ** for emphasis. Be specific to the code given; never produce generic filler.',
            },
            {
              role: 'user',
              content: `Analyse this ${language} snippet. The "flow" array is a directed graph: give each node an id, and list the ids it leads to in "next". Use "decision" for branches and give each outgoing edge a "branch" label, and put a concrete value at that step in "example". Give 2-3 worked "examples" with real inputs and the outputs they actually produce — a normal case and at least one edge case. Respond in exactly this JSON shape:\n${ANALYSIS_SHAPE}\n\n\`\`\`${language}\n${code}\n\`\`\``,
            },
          ],
          { maxTokens: 2200, temperature: 0.3, signal, surface: 'analyse' },
        );
        return { ...extractJSON(raw), source: 'ai' };
      } catch (err) {
        // An abort is the caller changing its mind, not the model failing.
        // Rethrowing lets `cached` drop the in-flight entry so the *next*
        // caller starts a fresh request. Swallowing it into an offline result
        // meant the dead promise stayed in `inflight` and was handed to
        // whoever asked next — so re-running the analysis, switching snippets
        // quickly, or React's StrictMode double-mount all resolved instantly
        // to a "timed out" reading that never actually retried.
        if (isAbort(err, signal)) throw err;
        return { ...localAnalysis(code, language), source: 'offline', reason: err.reason ?? 'network', error: err.message };
      }
    },
    (value) => value.source === 'ai',
  );
}

export async function optimiseCode(code, language, { signal } = {}) {
  return cached(`optimise:${language}:${hash(code)}`, async () => {
    const raw = await chat(
      [
        { role: 'system', content: 'You are a meticulous code reviewer. Reply with a single JSON object and nothing else.' },
        {
          role: 'user',
          content: `Rewrite this ${language} snippet to be clearer and faster where it genuinely helps. If it is already good, say so in the verdict and change only what is worth changing. Respond as {"code": "the rewritten snippet", "changes": ["3-5 bullets naming the change and why it helps"], "verdict": "one or two sentences"}.\n\n\`\`\`${language}\n${code}\n\`\`\``,
        },
      ],
      { maxTokens: 1800, temperature: 0.2, signal, surface: 'optimise' },
    );
    const parsed = extractJSON(raw);
    if (!parsed.code) throw new AIUnavailable('The model returned no rewritten code', 'bad-response');
    parsed.code = parsed.code.replace(/\t/g, '  ').replace(/\r/g, '').trimEnd();
    return parsed;
  });
}

/* ── Chat with visible thinking ────────────────────────────────────────── */

/**
 * Streaming chat for the code panel and coach surfaces.
 *
 * `onThinking` receives the model's reasoning as it arrives (thinking-capable
 * models only); `onToken` receives the answer. The caller shows a trimmed live
 * preview of the thinking, then swaps to the full answer when it lands.
 */
export async function streamChat({ messages, onThinking, onToken, signal, maxTokens = 1200, surface }) {
  return complete({
    messages,
    maxTokens,
    temperature: 0.5,
    stream: true,
    thinking: true,
    onThinking,
    onToken,
    signal,
    // Was accepted by every caller and then dropped here, so every streamed
    // reply was attributed to 'unknown' in the usage table.
    surface,
  });
}

/** Demo questions tailored to whatever code is on screen. */
export async function suggestQuestions(code, language, { signal } = {}) {
  return cached(
    `questions:${language}:${hash(code)}`,
    async () => {
      try {
        const raw = await chat(
          [
            { role: 'system', content: 'Reply with a single JSON object and nothing else.' },
            {
              role: 'user',
              content: `Given this ${language} snippet, write 4 short questions a learner would genuinely ask about it. Each under 60 characters, specific to this code, no generic questions. Respond as {"questions": ["...", "...", "...", "..."]}.\n\n\`\`\`${language}\n${code}\n\`\`\``,
            },
          ],
          { maxTokens: 400, temperature: 0.7, signal, surface: 'questions' },
        );
        const parsed = extractJSON(raw);
        return Array.isArray(parsed.questions) && parsed.questions.length ? parsed.questions.slice(0, 4) : localQuestions(code, language);
      } catch (err) {
        if (isAbort(err, signal)) throw err; // see analyseCode
        return localQuestions(code, language);
      }
    },
    (value) => Array.isArray(value) && value.length > 0,
  );
}

/* ── Generation ────────────────────────────────────────────────────────── */

/**
 * A code snippet to type.
 *
 * The prompt itself now lives server-side in
 * `supabase/functions/_shared/prompts.ts`, alongside the quality gate that
 * checks the result before it can enter the shared library. What used to be an
 * `avoid: []` list stapled onto the prompt is a database question now: the
 * server excludes rows this user has already been served, and steers a fresh
 * generation away from near-duplicates it retrieved.
 *
 * The return shape is unchanged, so `CodeTyping.jsx` needed no edit.
 */
export async function generateSnippet(language, difficulty, { signal, topic } = {}) {
  const res = await generateContent({
    kind: 'snippet',
    category: 'code',
    language,
    difficulty,
    topic,
    surface: 'snippet',
    signal,
  });

  if (!res.body) throw new AIUnavailable('No code in response', 'bad-response');

  return {
    code: res.body,
    title: res.title ?? 'Snippet',
    topic: res.meta?.topic ?? topic ?? '',
    intro: res.meta?.intro ?? '',
    cache: res.cache,
    generationId: res.generationId,
  };
}

/**
 * Fresh practice text matched to the user's mode and difficulty.
 *
 * Still called on every load, but "fresh" now means something better than
 * "generated again": the server checks the shared library first, and only pays
 * for a generation when nothing suitable exists that this user has not already
 * typed. A returning user gets new text; a new user gets text someone else's
 * request already paid for.
 */
export async function generatePassage({ mode, difficulty, words = 60, level = 0, topic, signal }) {
  // The typing modes map onto library kinds. `quote` and `drill` are their own
  // kinds because they are shaped differently; everything else is a passage.
  const kind = mode === 'quote' ? 'quote' : mode === 'drill' ? 'drill' : 'passage';

  const res = await generateContent({
    kind,
    category: 'practice',
    difficulty,
    level,
    words,
    topic: topic ?? (mode === 'zen' ? 'focus and practice' : undefined),
    surface: 'passage',
    signal,
  });

  if (!res.body) throw new AIUnavailable('No text in response', 'bad-response');

  return {
    text: res.body,
    label: res.title ?? '',
    author: res.meta?.author,
    cache: res.cache,
    generationId: res.generationId,
  };
}

/* ── Coaching ──────────────────────────────────────────────────────────── */

export async function coachInsight(stats, { signal } = {}) {
  return cached(
    `coach:${stats.sessions}:${Math.round(stats.wpm)}:${Math.round(stats.accuracy)}`,
    async () => {
      try {
        const raw = await chat(
          [
            {
              role: 'system',
              content: 'You are a typing coach. Two sentences maximum. Warm, specific, never generic praise. No emoji, no markdown.',
            },
            {
              role: 'user',
              content: `Sessions: ${stats.sessions}. Average ${Math.round(stats.wpm)} WPM, ${Math.round(stats.accuracy)}% accuracy, ${Math.round(stats.consistency)}% consistency. Streak ${stats.streak} days. Weakest keys: ${stats.weakKeys?.join(', ') || 'none recorded'}. Weekly trend: ${stats.trend > 0 ? `up ${stats.trend.toFixed(1)}` : `down ${Math.abs(stats.trend).toFixed(1)}`} WPM. One observation, one thing to work on.`,
            },
          ],
          { maxTokens: 200, temperature: 0.7, signal, surface: 'coach' },
        );
        return { text: raw.replace(/^["']|["']$/g, ''), source: 'ai' };
      } catch (err) {
        return { text: localCoach(stats), source: 'offline', reason: err.reason };
      }
    },
    (value) => value.source === 'ai',
  );
}

/* ── Offline fallbacks ─────────────────────────────────────────────────── */

function localQuestions(code, language) {
  const has = (re) => re.test(code);
  const out = [`What does this ${language} snippet do?`];
  if (has(/\bfor\b|\bwhile\b|forEach|map\(/)) out.push('Why is a loop used here?');
  if (has(/function|=>|def |fn |func /)) out.push('What does this function return?');
  if (has(/if|switch|match|\?/)) out.push('What decides which branch runs?');
  out.push('How would I make this faster?');
  return out.slice(0, 4);
}

function localAnalysis(code, language) {
  const lines = code.split('\n').filter((l) => l.trim());
  const loops = (code.match(/\b(for|while|forEach|map|filter|reduce)\b/g) || []).length;
  const nested = /for[\s\S]{0,200}?for|while[\s\S]{0,200}?while/.test(code);
  const recursive = /\breturn\b[^\n]*\b(\w+)\s*\([^)]*\)/.test(code) && /function|def |=>/.test(code);
  const calls = (code.match(/[A-Za-z_]\w*\s*\(/g) || []).length;
  const time = nested ? 'O(n²)' : loops ? 'O(n)' : 'O(1)';

  const flow = lines.slice(0, 6).map((l, i, arr) => ({
    id: `n${i}`,
    step: `Line ${i + 1}`,
    detail: l.trim().slice(0, 110),
    kind: i === 0 ? 'start' : /return|print|console|cout|System\.out/.test(l) ? 'output' : /if|switch|match/.test(l) ? 'decision' : /for|while/.test(l) ? 'loop' : 'process',
    next: i < arr.length - 1 ? [`n${i + 1}`] : [],
    branch: '',
    example: '',
  }));

  return {
    intro: `A ${lines.length}-line ${language} snippet with ${calls} call site${calls === 1 ? '' : 's'}${loops ? ` and ${loops} iteration construct${loops > 1 ? 's' : ''}` : ' and no loops'}. This reading was computed on your device from the source text — reconnect for the model's full explanation.`,
    summary: `A ${lines.length}-line ${language} snippet${loops ? ` built around ${loops} iteration${loops > 1 ? 's' : ''}` : ''}.`,
    explanation: [
      '**Local reading** — no provider was reachable, so this is derived from the source text alone.',
      `Detected \`${calls}\` call site${calls === 1 ? '' : 's'} across \`${lines.length}\` non-blank lines.`,
      loops ? 'Work scales with the size of the input collection.' : 'No iteration — the work is constant.',
      recursive ? 'A recursive shape is present, so check the base case first.' : 'Control flow is linear through the body.',
    ],
    // No worked examples offline: running the snippet is the only honest way to
    // know what it returns, and inventing plausible-looking output for a
    // learner to trust would be worse than showing nothing.
    examples: [],
    flow,
    timeComplexity: { value: time, why: nested ? 'Nested iteration over the input.' : loops ? 'One pass over the input.' : 'No input-dependent work.' },
    spaceComplexity: { value: /\[\]|\{\}|new (Array|Map|Set|List)/.test(code) ? 'O(n)' : 'O(1)', why: 'Estimated from the allocations in the source.' },
    bestPractices: ['Name things for what they mean, not what they are.', 'Keep functions to one job.'],
    commonMistakes: [recursive ? 'Recursive shapes need an explicit base case.' : 'Off-by-one errors at loop boundaries.', 'Unhandled empty input.'],
    improvements: ['Reconnect for model-specific suggestions.'],
  };
}

function localCoach(stats) {
  if (!stats.sessions) return 'Nothing recorded yet — a single 60-second run is enough to set your baseline.';
  if (stats.accuracy < 92)
    return `At ${Math.round(stats.accuracy)}% accuracy, errors are costing you more than speed is winning. Slow down about 10 WPM until accuracy sits above 95%.`;
  if (stats.consistency < 70)
    return `Your speed swings a lot mid-run (${Math.round(stats.consistency)}% consistency). Aim for an even rhythm rather than bursts.`;
  if (stats.trend > 0)
    return `Up ${stats.trend.toFixed(1)} WPM this week at ${Math.round(stats.accuracy)}% accuracy. Push the difficulty rather than the clock.`;
  return `Holding ${Math.round(stats.wpm)} WPM at ${Math.round(stats.accuracy)}% accuracy. Try a punctuation-heavy drill — that's usually the next bottleneck.`;
}
