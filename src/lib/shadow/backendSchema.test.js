import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('0010_shadow_battle.sql — Backend Schema & RPC surface', () => {
  const sqlPath = resolve(process.cwd(), 'supabase/migrations/0010_shadow_battle.sql');
  const bfSqlPath = resolve(process.cwd(), 'supabase/migrations/0009_battlefield.sql');

  it('migration file exists and is non-empty', () => {
    expect(existsSync(sqlPath)).toBe(true);
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql.length).toBeGreaterThan(1000);
  });

  it('defines all 8 required Shadow Battle tables', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    const requiredTables = [
      'shadow_rooms',
      'shadow_players',
      'shadow_events',
      'shadow_rounds',
      'shadow_results',
      'shadow_ratings',
      'shadow_unlocks',
      'shadow_queue',
    ];

    for (const table of requiredTables) {
      expect(sql).toContain(`create table if not exists public.${table}`);
    }
  });

  it('defines all required views and RLS security functions', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain('create or replace view public.shadow_public_rooms');
    expect(sql).toContain('create or replace view public.shadow_leaderboard');
    expect(sql).toContain('create or replace function public.in_shadow');
    expect(sql).toContain('create or replace function public.is_shadow_host');
  });

  it('defines the complete RPC surface for room lifecycle, combat events, and settlement', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    const requiredRpcs = [
      'arena_server_time',
      'arena_mint_pin',
      'arena_code_lookup',
      'shadow_create',
      'shadow_join',
      'shadow_set_ready',
      'shadow_set_fighter',
      'shadow_start',
      'shadow_event_append',
      'shadow_heartbeat',
      'shadow_settle_round',
      'shadow_settle_match',
      'shadow_forfeit',
      'shadow_leave',
      'shadow_close',
      'shadow_match_history',
      'shadow_reap',
    ];

    for (const rpc of requiredRpcs) {
      expect(sql).toContain(`function public.${rpc}`);
    }
  });

  it('enables RLS on all 8 tables and configures realtime publication', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    const requiredTables = [
      'shadow_rooms', 'shadow_players', 'shadow_events', 'shadow_rounds',
      'shadow_results', 'shadow_ratings', 'shadow_unlocks', 'shadow_queue',
    ];

    for (const table of requiredTables) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
    }

    expect(sql).toContain('alter publication supabase_realtime add table');
  });

  it('G5 / SC-A3: 0009_battlefield.sql is completely untouched and unpolluted by shadow battle tables', () => {
    const bfSql = readFileSync(bfSqlPath, 'utf8');
    expect(bfSql).not.toContain('shadow_rooms');
    expect(bfSql).not.toContain('shadow_players');
    expect(bfSql).not.toContain('shadow_events');
  });
});
