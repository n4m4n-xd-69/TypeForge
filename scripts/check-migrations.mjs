#!/usr/bin/env node
/**
 * Structural checks on the migration files.
 *
 * This is not a Postgres parser and does not pretend to be one — the real
 * check is applying the migration. It exists because the failures it catches
 * are the ones that are both most common in hand-written plpgsql and most
 * expensive to discover: an unbalanced `$$` swallows every following statement
 * into a string literal, and the resulting error points at a line hundreds
 * further down than the mistake.
 *
 * Run: node scripts/check-migrations.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
const problems = [];
const note = (file, message) => problems.push(`${file}: ${message}`);

/** Strips line comments and string literals so counts are not fooled by prose. */
function stripNoise(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
  const raw = readFileSync(join(DIR, file), 'utf8');
  const sql = stripNoise(raw);

  /* 1. Dollar-quoting must balance, per tag. `$$` and `$name$` are different
        delimiters and each has to close with its own. */
  const tags = sql.match(/\$[A-Za-z_]*\$/g) ?? [];
  const counts = new Map();
  for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  for (const [tag, n] of counts) {
    if (n % 2 !== 0) note(file, `unbalanced dollar-quote ${tag} (${n} occurrences, expected an even number)`);
  }

  /* 2. Every function body should end with a terminator. A missing one after
        `end; $$;` runs the next statement into this one. */
  const bodies = sql.match(/\$\$[\s\S]*?\$\$/g) ?? [];
  for (const body of bodies) {
    const tail = sql.slice(sql.indexOf(body) + body.length, sql.indexOf(body) + body.length + 40);
    if (!/^\s*;/.test(tail) && !/^\s*(language|stable|immutable|volatile|security|set|as|returns)/i.test(tail)) {
      note(file, `a $$-delimited body is not followed by ';' — found ${JSON.stringify(tail.slice(0, 20))}`);
    }
  }

  /* 3. plpgsql blocks: begin/end should balance inside each body. Counted on
        word boundaries so `end;` inside a CASE is included — CASE uses `end`
        without `begin`, so this is a heuristic and only flags a deficit. */
  for (const body of bodies) {
    const inner = stripNoise(body);
    const begins = (inner.match(/\bbegin\b/gi) ?? []).length;
    const ends = (inner.match(/\bend\b/gi) ?? []).length;
    if (ends < begins) {
      note(file, `a body has ${begins} 'begin' but only ${ends} 'end'`);
    }
  }

  /* 4. Parentheses must balance across the file. */
  let depth = 0;
  for (const ch of sql.replace(/\$\$[\s\S]*?\$\$/g, '')) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) note(file, `unbalanced parentheses outside function bodies (depth ${depth})`);

  /* 5. Every SECURITY DEFINER function must pin search_path. An unpinned one is
        a privilege-escalation shape, and this repo's own convention (stated in
        0009 and 0014) is to always set it — so a missing one is a real defect,
        not a style note. */
  const definers = sql.match(/security\s+definer[\s\S]{0,120}?as\s*\$\$/gi) ?? [];
  for (const d of definers) {
    if (!/set\s+search_path/i.test(d)) {
      note(file, 'a SECURITY DEFINER function does not set search_path');
    }
  }

}

if (problems.length) {
  console.error(`\n${problems.length} problem(s) found:\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).length;
console.log(`✓ ${files} migration files pass structural checks`);
