import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCOPES, TIER_SCOPES, TIERS } from './scopes.js';

/**
 * Guards on the admin console's permission model.
 *
 * These parse the migration itself rather than a live database, because the
 * thing most likely to go wrong is not the SQL failing to run — it is the SQL
 * running fine while quietly disagreeing with the UI about who may do what.
 * A console that offers a button the database will reject is merely annoying;
 * one that hides a button the database *would* have allowed, or shows a scope
 * list that no longer matches, is how an operator ends up with the wrong idea
 * about who has access.
 */

const MIGRATION = readFileSync(
  path.resolve('supabase/migrations/0014_admin_console.sql'),
  'utf8',
);

/** Pulls the `array[...]` literal that follows a `when '<tier>' then` branch. */
function sqlScopesFor(tier) {
  const branch = new RegExp(`when '${tier}' then array\\[([\\s\\S]*?)\\]`, 'i');
  const match = MIGRATION.match(branch);
  if (!match) return null;
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('tier → scope mirror', () => {
  it('defines admin_tier_scopes() in the migration', () => {
    expect(MIGRATION).toContain('create or replace function public.admin_tier_scopes');
  });

  for (const tier of TIERS) {
    it(`${tier} grants exactly what the SQL grants`, () => {
      const fromSql = sqlScopesFor(tier);
      expect(fromSql, `no '${tier}' branch found in admin_tier_scopes()`).not.toBeNull();
      // Order is irrelevant to a scope set; membership is not.
      expect([...fromSql].sort()).toEqual([...TIER_SCOPES[tier]].sort());
    });
  }

  it('grants no scope outside the declared vocabulary', () => {
    for (const [tier, scopes] of Object.entries(TIER_SCOPES)) {
      for (const scope of scopes) {
        expect(SCOPES, `${tier} grants unknown scope ${scope}`).toContain(scope);
      }
    }
  });

  it('keeps roles.write to owner alone', () => {
    // The one scope that can create more operators. If any other tier picks it
    // up, privilege escalation becomes a one-click operation.
    const holders = Object.entries(TIER_SCOPES)
      .filter(([, scopes]) => scopes.includes('roles.write'))
      .map(([tier]) => tier);
    expect(holders).toEqual(['owner']);
  });

  it('gives the analyst tier no write scope at all', () => {
    const writes = TIER_SCOPES.analyst.filter((s) => !s.endsWith('.read'));
    expect(writes).toEqual([]);
  });
});

describe('every mutation RPC is scope-gated and audited', () => {
  /* Splits the migration into `create or replace function public.<name>` blocks
     terminated by the `$$;` that closes each body. */
  const functions = [...MIGRATION.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\$\$;/g)].map(
    (m) => ({ name: m[1], body: m[2] }),
  );

  const MUTATIONS = [
    'admin_adjust_xp',
    'admin_set_user_status',
    'admin_set_role',
    'admin_moderate_generation',
    'admin_set_flag',
    'admin_set_config',
    'admin_upsert_announcement',
    'admin_delete_announcement',
    'admin_upsert_provider',
    'admin_upsert_model',
    'admin_delete_model',
    'admin_reset_model_health',
  ];

  it('parses every function out of the migration', () => {
    expect(functions.length).toBeGreaterThan(20);
  });

  for (const name of MUTATIONS) {
    it(`${name} requires a scope and writes an audit row`, () => {
      const fn = functions.find((f) => f.name === name);
      expect(fn, `${name} not found in the migration`).toBeDefined();
      expect(fn.body, `${name} does not call admin_require()`).toContain('admin_require(');
      expect(fn.body, `${name} does not call admin_audit()`).toContain('admin_audit(');
    });
  }

  it('runs every mutation as SECURITY DEFINER with a pinned search_path', () => {
    // An unpinned search_path on a definer function is the classic Postgres
    // privilege-escalation footgun: a caller who can create a schema can
    // shadow a table the function references.
    for (const name of MUTATIONS) {
      const fn = functions.find((f) => f.name === name);
      expect(fn.body, `${name} is not SECURITY DEFINER`).toContain('security definer');
      expect(fn.body, `${name} does not pin search_path`).toMatch(/set search_path = ''/);
    }
  });
});

describe('no API key surface exists in the schema', () => {
  it('never stores a key value on ai_providers', () => {
    const table = MIGRATION.match(/create table if not exists public\.ai_providers \(([\s\S]*?)\n\);/);
    expect(table).not.toBeNull();
    // `secret_ref`, `key_present`, `key_tail` are fine — they name or describe
    // a secret. A column that could hold one is not.
    expect(table[1]).not.toMatch(/\bapi_key\b|\bsecret_value\b|\bkey_value\b|\btoken\s+text/);
  });

  it('rejects a secret_ref that is not an environment variable name', () => {
    const fn = MIGRATION.match(/create or replace function public\.admin_upsert_provider\(([\s\S]*?)\$\$;/);
    expect(fn).not.toBeNull();
    expect(fn[1]).toContain("p_secret_ref !~ '^[A-Z][A-Z0-9_]*$'");
  });

  it('takes no key parameter on any admin function', () => {
    expect(MIGRATION).not.toMatch(/p_api_key|p_key_value|p_secret_value/);
  });
});
