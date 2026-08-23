import { useMemo } from 'react';
import Prism from '../../lib/prism.js';
import { cx } from '../../lib/format.js';

/**
 * A deliberately small markdown renderer for model output.
 *
 * Supports exactly what the prompts ask the model to produce — fenced code
 * blocks, `inline code`, **bold**, *italic*, links and simple lists. It builds
 * React elements rather than setting innerHTML, so untrusted model text can
 * never inject markup. The one place HTML is used is Prism's own highlighted
 * output, which is generated locally from the code text.
 */

export default function Markdown({ text, className, language = 'javascript', compact = false }) {
  const blocks = useMemo(() => parseBlocks(String(text ?? '')), [text]);

  return (
    <div className={cx(compact ? 'space-y-1' : 'space-y-1.5', className)}>
      {blocks.map((block, i) => {
        if (block.type === 'code') {
          return <CodeBlock key={i} code={block.code} language={block.lang || language} />;
        }
        if (block.type === 'list') {
          return (
            <ul key={i} className="space-y-0.5 pl-2">
              {block.items.map((item, j) => (
                <li key={j} className="relative pl-1.5 text-sm leading-relaxed text-ink-2">
                  <span className="absolute left-0 top-[9px] h-[4px] w-[4px] rounded-full bg-brand-solid" aria-hidden />
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-sm leading-relaxed text-ink-2">
            <Inline text={block.text} />
          </p>
        );
      })}
    </div>
  );
}

/** Highlighted, scrollable code block. */
export function CodeBlock({ code, language = 'javascript', className }) {
  const html = useMemo(() => {
    const grammar = Prism.languages[language] ?? Prism.languages.javascript;
    try {
      return Prism.highlight(code, grammar, language);
    } catch {
      return escapeHTML(code);
    }
  }, [code, language]);

  return (
    <pre
      className={cx(
        'overflow-x-auto rounded-sm border border-line bg-subtle/60 p-1.5 font-mono text-xs leading-relaxed',
        className,
      )}
    >
      {/* Prism output is generated locally from `code`; no model markup reaches it. */}
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

/* ── Parsing ───────────────────────────────────────────────────────────── */

function parseBlocks(src) {
  const out = [];
  const lines = src.replace(/\r/g, '').split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^\s*```(\w+)?\s*$/);
    if (fence) {
      const lang = fence[1];
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      out.push({ type: 'code', code: body.join('\n'), lang });
      continue;
    }

    // list run
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
        i++;
      }
      out.push({ type: 'list', items });
      continue;
    }

    // paragraph run
    if (line.trim()) {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        para.push(lines[i].trim());
        i++;
      }
      out.push({ type: 'p', text: para.join(' ') });
      continue;
    }

    i++;
  }

  return out;
}

/**
 * Inline spans. Tokenised in one pass so a `code` run can contain characters
 * that would otherwise look like bold markers.
 */
function Inline({ text }) {
  const parts = useMemo(() => parseInline(String(text ?? '')), [text]);

  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'code') {
          return (
            <code
              key={i}
              className="rounded-[4px] border border-line bg-subtle px-[3px] py-px font-mono text-[0.92em] text-brand"
            >
              {p.value}
            </code>
          );
        }
        // Emphasis recurses: the tokenizer is flat, so `code` inside **bold**
        // was emitted as raw text and rendered with its backticks showing.
        // Recursion terminates because each pass strips the delimiters, making
        // the inner string strictly shorter.
        if (p.type === 'strong') {
          return (
            <strong key={i} className="font-bold text-ink">
              <Inline text={p.value} />
            </strong>
          );
        }
        if (p.type === 'em') {
          return (
            <em key={i} className="italic">
              <Inline text={p.value} />
            </em>
          );
        }
        if (p.type === 'link') {
          return (
            <a key={i} href={p.href} target="_blank" rel="noreferrer noopener" className="font-semibold text-brand underline">
              {p.value}
            </a>
          );
        }
        return <span key={i}>{p.value}</span>;
      })}
    </>
  );
}

/**
 * Emphasis delimiters may not be flanked by whitespace on the inside — the
 * CommonMark rule, and here a correctness one rather than a nicety. In a
 * programming app the model writes arithmetic in prose constantly, and the
 * naive pattern ate it: `2 ** i * 100` matched as bold-then-italic and
 * rendered as "2 i 10", silently deleting the operators from an explanation
 * of the very code on screen. Requiring a non-space after the opening run and
 * before the closing one leaves spaced operators alone while still matching
 * ordinary **bold** and *italic*.
 */
const INLINE_RE = /(`[^`]+`)|(\*\*(?!\s)[^*]+(?<!\s)\*\*)|(\*(?!\s)[^*]+(?<!\s)\*)|(\[[^\]]+\]\([^)]+\))/g;

function parseInline(src) {
  const parts = [];
  let last = 0;
  let m;

  while ((m = INLINE_RE.exec(src)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: src.slice(last, m.index) });

    const token = m[0];
    if (token.startsWith('`')) {
      parts.push({ type: 'code', value: token.slice(1, -1) });
    } else if (token.startsWith('**')) {
      parts.push({ type: 'strong', value: token.slice(2, -2) });
    } else if (token.startsWith('[')) {
      const [, label, href] = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      parts.push({ type: 'link', value: label, href });
    } else {
      parts.push({ type: 'em', value: token.slice(1, -1) });
    }
    last = m.index + token.length;
  }

  if (last < src.length) parts.push({ type: 'text', value: src.slice(last) });
  return parts;
}

function escapeHTML(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}
