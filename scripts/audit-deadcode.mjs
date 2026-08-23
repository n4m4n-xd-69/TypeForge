/**
 * Proves (or disproves) that a file or export is dead.
 *
 * Nothing here decides to delete anything — it only reports reference counts,
 * so a zero can be inspected rather than trusted.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const ROOT = process.argv[2] ?? 'src';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|css)$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const source = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

/* ── 1. Files never imported by anything ──────────────────────────────── */
console.log('########## UNREFERENCED FILES ##########');
console.log('(entry points are expected here: main.jsx, index.css)\n');

let orphanCount = 0;
for (const file of files) {
  const base = basename(file).replace(/\.(jsx?|css)$/, '');
  const importers = files.filter((other) => {
    if (other === file) return false;
    const text = source.get(other);
    // match ./Name.jsx  ../lib/Name.js  './Name'
    return new RegExp(`from\\s+['"][^'"]*/${base}(\\.jsx?)?['"]`).test(text)
        || new RegExp(`from\\s+['"]\\./${base}(\\.jsx?)?['"]`).test(text)
        || new RegExp(`import\\s+['"][^'"]*${base}\\.css['"]`).test(text);
  });
  if (importers.length === 0) {
    orphanCount++;
    console.log(`  ${relative('.', file)}`);
  }
}
if (orphanCount === 0) console.log('  (none)');

/* ── 2. Named exports with no importer ────────────────────────────────── */
console.log('\n########## EXPORTS WITH ZERO EXTERNAL REFERENCES ##########');
console.log('(may still be used internally — each needs an eyeball)\n');

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)/gm;
const results = [];

for (const file of files) {
  if (file.endsWith('.css')) continue;
  const text = source.get(file);
  for (const m of text.matchAll(EXPORT_RE)) {
    const name = m[1];
    const externalUses = files.filter((other) => {
      if (other === file) return false;
      const t = source.get(other);
      return new RegExp(`\\b${name}\\b`).test(t);
    });
    if (externalUses.length === 0) {
      // internal use inside its own file?
      const selfUses = (text.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
      results.push({ file: relative('.', file), name, selfUses });
    }
  }
}

if (results.length === 0) console.log('  (none)');
for (const r of results) {
  console.log(`  ${r.file.padEnd(46)} ${r.name.padEnd(24)} self-refs: ${r.selfUses}`);
}

/* ── 3. Import statements naming something never used in-file ─────────── */
console.log('\n########## POSSIBLY UNUSED IMPORTS ##########\n');

let unusedImports = 0;
for (const file of files) {
  if (file.endsWith('.css')) continue;
  const text = source.get(file);
  const body = text.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '');
  for (const m of text.matchAll(/^import\s+\{([^}]+)\}\s+from/gm)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop().trim();
      if (!name) continue;
      if (!new RegExp(`\\b${name}\\b`).test(body)) {
        unusedImports++;
        console.log(`  ${relative('.', file).padEnd(46)} ${name}`);
      }
    }
  }
}
if (unusedImports === 0) console.log('  (none)');

/* ── 4. Dependency usage ──────────────────────────────────────────────── */
console.log('\n########## DEPENDENCY USAGE ##########\n');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
for (const [dep] of Object.entries(pkg.dependencies ?? {})) {
  const users = files.filter((f) => new RegExp(`from\\s+['"]${dep.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}`).test(source.get(f)));
  const flag = users.length === 0 ? '  <-- ZERO' : users.length === 1 ? '  <-- single' : '';
  console.log(`  ${dep.padEnd(28)} ${String(users.length).padStart(3)} file(s)${flag}`);
  if (users.length && users.length <= 2) for (const u of users) console.log(`       ${relative('.', u)}`);
}

console.log(`\n  scanned ${files.length} files under ${ROOT}/`);
