/**
 * The bundled text and code library. Everything here works offline; the AI
 * generator in `ai.js` layers fresh material on top when it's reachable.
 */

/* ── Word lists for Time / Words modes ─────────────────────────────────── */

export const COMMON = `the of and a to in is you that it he was for on are as with his they i at be this have from or one had by word but not what all were we when your can said there use an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first water been call who oil its now find long down day did get come made may part action animal answer bridge change circle danger direct energy engine family father flight forest ground island letter liquid market master memory minute moment motion nation nature object person planet pocket record region result season secret shadow signal silver simple sister source spring square street strike summer symbol system theory travel valley vector vision volume weapon weight window winter yellow balance captain century channel control foreign morning payment picture problem process program purpose quality soldier support surface tension village weather building business decision distance movement position practice question reaction standard strength struggle surprise`.split(' ');

export const HARDER = `rhythm quartz jukebox syndrome awkward whiskey lymph blizzard sphinx crypt glyph khaki vodka waltz zephyr jinx mnemonic phlegm queue rendezvous silhouette turquoise vacuum wharf xylophone yacht zealous asymmetry bureaucracy conscience embarrass fluorescent guarantee hierarchy inoculate liaison maintenance necessary occurrence perseverance questionnaire restaurant separate threshold unanimous vengeance`.split(' ');

export const PUNCTUATED = `don't it's they're we've I'd shouldn't couldn't; "quoted," (parenthetical) dash, semi; colon: 42% $19.99 #tag &amp @user *star ~tilde /slash \\back |pipe [bracket] {brace} <angle> +plus =equals`.split(' ');

export const WORD_BANKS = { easy: COMMON, normal: [...COMMON, ...COMMON.slice(0, 60)], hard: HARDER, expert: [...HARDER, ...PUNCTUATED] };

export function randomWords(count, difficulty = 'normal') {
  const bank = WORD_BANKS[difficulty] ?? WORD_BANKS.normal;
  const out = [];
  for (let i = 0; i < count; i++) out.push(bank[Math.floor(Math.random() * bank.length)]);
  return out.join(' ');
}

/* ── Quotes ────────────────────────────────────────────────────────────── */

export const QUOTES = [
  { text: 'Simplicity is prerequisite for reliability.', author: 'Edsger W. Dijkstra', length: 'short' },
  { text: 'Programs must be written for people to read, and only incidentally for machines to execute.', author: 'Harold Abelson', length: 'medium' },
  { text: 'The most damaging phrase in the language is: it has always been done that way.', author: 'Grace Hopper', length: 'medium' },
  { text: 'Any fool can write code that a computer can understand. Good programmers write code that humans can understand.', author: 'Martin Fowler', length: 'medium' },
  { text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds', length: 'short' },
  { text: 'Premature optimization is the root of all evil, yet we should not pass up our opportunities in that critical three percent.', author: 'Donald Knuth', length: 'long' },
  { text: 'Walking on water and developing software from a specification are easy if both are frozen.', author: 'Edward V. Berard', length: 'medium' },
  { text: 'The function of good software is to make the complex appear to be simple.', author: 'Grady Booch', length: 'medium' },
  { text: 'First, solve the problem. Then, write the code.', author: 'John Johnson', length: 'short' },
  { text: 'Deleted code is debugged code. There is nothing so permanent as a temporary fix, and nothing so temporary as the last line you were sure about.', author: 'Jeff Sickel', length: 'long' },
  { text: 'It is not that I am so smart, it is just that I stay with problems longer.', author: 'Albert Einstein', length: 'medium' },
  { text: 'The best way to predict the future is to invent it.', author: 'Alan Kay', length: 'short' },
];

export function randomQuote(length = 'any') {
  const pool = length === 'any' ? QUOTES : QUOTES.filter((q) => q.length === length);
  return (pool.length ? pool : QUOTES)[Math.floor(Math.random() * (pool.length || QUOTES.length))];
}

/* ── Zen / prose passages ──────────────────────────────────────────────── */

export const PASSAGES = [
  'Great typing is not about chasing the keyboard. It is about trusting your hands, finding a rhythm, and letting every thought arrive without hesitation.',
  'The keys do not move. Your fingers learn where they already are. Practice is simply the process of forgetting that you ever had to look.',
  'Speed is a side effect. Accuracy is the practice. Consistency is the proof that the practice worked.',
  'A quiet room, a steady breath, and a paragraph you have never seen before. That is the whole exercise, repeated until it becomes ordinary.',
];

/* ── Code snippets ─────────────────────────────────────────────────────── */

export const LANGUAGES = [
  { id: 'javascript', name: 'JavaScript', prism: 'javascript', icon: 'JS', hue: '#e3b341' },
  { id: 'typescript', name: 'TypeScript', prism: 'typescript', icon: 'TS', hue: '#3178c6' },
  { id: 'python', name: 'Python', prism: 'python', icon: 'Py', hue: '#4b8bbe' },
  { id: 'java', name: 'Java', prism: 'java', icon: 'Jv', hue: '#e76f00' },
  { id: 'c', name: 'C', prism: 'c', icon: 'C', hue: '#5f87b8' },
  { id: 'cpp', name: 'C++', prism: 'cpp', icon: 'C+', hue: '#9c033a' },
  { id: 'go', name: 'Go', prism: 'go', icon: 'Go', hue: '#00acd7' },
  { id: 'rust', name: 'Rust', prism: 'rust', icon: 'Rs', hue: '#ce6c47' },
  { id: 'kotlin', name: 'Kotlin', prism: 'kotlin', icon: 'Kt', hue: '#7f52ff' },
  { id: 'swift', name: 'Swift', prism: 'swift', icon: 'Sw', hue: '#f05138' },
  { id: 'sql', name: 'SQL', prism: 'sql', icon: 'SQ', hue: '#dd7f2d' },
];

export const LANGUAGE_BY_ID = Object.fromEntries(LANGUAGES.map((l) => [l.id, l]));


export const DIFFICULTIES = [
  { id: 'easy', name: 'Easy', note: 'Short, familiar shapes' },
  { id: 'normal', name: 'Normal', note: 'Everyday working code' },
  { id: 'hard', name: 'Hard', note: 'Denser syntax, more symbols' },
  { id: 'expert', name: 'Expert', note: 'Advanced language features' },
];

/* The snippet library lives in ./snippets — re-exported here so existing
   imports keep working. */
export { SNIPPETS, pickSnippet, snippetsFor, snippetByTitle, snippetCount } from './snippets/index.js';

/* ── Focus drills ──────────────────────────────────────────────────────── */

export const DRILLS = [
  { id: 'home-row', name: 'Home row', text: 'asdf jkl; asdf jkl; sad lads fall; a flask; all salads; dad had a flask; jak asks dad', keys: 'asdfjkl;' },
  { id: 'top-row', name: 'Top row', text: 'quiet trout wire ripe query power tore petty tip yew route pretty tower quit peer', keys: 'qwertyuiop' },
  { id: 'bottom-row', name: 'Bottom row', text: 'zinc vex numb comb bunch mix zone van cave buzz numb bench vice conv exam zoom', keys: 'zxcvbnm' },
  { id: 'numbers', name: 'Numbers', text: '10 items at 4.99 each; port 8080; year 2026; 3 of 7; 42% of 150; ids 1029 4471 9003', keys: '1234567890' },
  { id: 'symbols', name: 'Brackets & symbols', text: '{ key: [1, 2] } (a && b) => x[i]; obj?.prop ?? "fallback"; /^a-z$/ #tag @user', keys: '{}[]()<>' },
  { id: 'capitals', name: 'Capitals & shift', text: 'The Quick Brown Fox; API URL JSON HTTP; McDonald O\'Neill van der Berg; NASA MIT IEEE', keys: 'shift' },
];
