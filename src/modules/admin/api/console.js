import { supabase } from '../../../lib/supabase.js';

/**
 * The console's entire data layer.
 *
 * Two rules hold everywhere in this file, and both exist because an admin
 * panel is the one surface where getting them wrong is expensive:
 *
 * 1. **Reads never throw on permission.** 0002 established the convention and
 *    0014 keeps it — a caller without the scope gets an empty result, not an
 *    error, so the UI branches on "what am I allowed to see" once (in
 *    `fetchScopes`) rather than on every query. A thrown error here therefore
 *    means something is genuinely broken, and is worth surfacing loudly.
 *
 * 2. **Writes always throw.** `admin_require()` raises 42501, which arrives
 *    here as a real error. A mutation must never look like it worked.
 *
 * Aggregation lives in Postgres. The functions below are thin: the previous
 * overview tab pulled 1000 ai_usage rows and 90 daily rows into the browser to
 * compute four numbers, which stops working long before the platform does.
 */

/* ── plumbing ─────────────────────────────────────────────────────────── */

function offline() {
  return new Error('Cloud sync is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

async function rpc(fn, args = {}) {
  if (!supabase) throw offline();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw decorate(error, fn);
  return data;
}

/** Reads degrade to a fallback rather than blanking a whole dashboard. */
async function softRpc(fn, args = {}, fallback = null) {
  try {
    return await rpc(fn, args);
  } catch (err) {
    if (import.meta.env.DEV) console.warn(`[console] ${fn} failed`, err);
    return fallback;
  }
}

/**
 * Postgres error codes are not operator-facing text. 42501 in particular is
 * the one an operator will actually hit — an analyst pressing a button their
 * tier does not carry — and "permission denied for function" is a worse
 * explanation than the one the console can give.
 */
function decorate(error, fn) {
  const e = new Error(
    error.code === '42501'
      ? 'Your admin tier does not include this action.'
      : error.message || `${fn} failed`,
  );
  e.code = error.code;
  e.fn = fn;
  e.details = error.details;
  return e;
}

const iso = (d) => (d instanceof Date ? d.toISOString() : d);

/* ── identity and permission ──────────────────────────────────────────── */

/**
 * The one call the shell blocks on. Returns the scope list the database will
 * actually enforce, so every affordance in the UI is derived from the same
 * source of truth that gates the operation behind it — a disabled button and
 * a rejected RPC can never disagree.
 */
export async function fetchScopes() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('admin_scopes');
  if (error) return [];
  return data ?? [];
}

export async function fetchMyRole(userId) {
  if (!supabase || !userId) return 'user';
  const { data, error } = await supabase
    .from('user_roles')
    .select('role, admin_tier')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return 'user';
  return data?.role ?? 'user';
}

export async function fetchMyTier(userId) {
  if (!supabase || !userId) return null;
  const { data } = await supabase
    .from('user_roles')
    .select('admin_tier')
    .eq('user_id', userId)
    .maybeSingle();
  // NULL admin_tier on an admin row means "admin" — see 0014 §1.
  return data?.admin_tier ?? 'admin';
}

/* ── executive overview ───────────────────────────────────────────────── */

export const fetchKpis = (from, to) =>
  softRpc('admin_kpis', { p_from: iso(from), p_to: iso(to) }, null);

export const fetchTimeseries = (from, to) =>
  softRpc('admin_timeseries', { p_from: iso(from), p_to: iso(to) }, []);

export const fetchRetention = (weeks = 12) =>
  softRpc('admin_retention', { p_weeks: weeks }, []);

export const fetchActivityFeed = (limit = 50) =>
  softRpc('admin_activity_feed', { p_limit: limit }, []);

/* ── performance analytics ────────────────────────────────────────────── */

export const fetchTypingAnalytics = (from, to, dim = 'language') =>
  softRpc('admin_typing_analytics', { p_from: iso(from), p_to: iso(to), p_dim: dim }, []);

export const fetchCodingAnalytics = (from, to) =>
  softRpc('admin_coding_analytics', { p_from: iso(from), p_to: iso(to) }, []);

/* ── users ────────────────────────────────────────────────────────────── */

export async function fetchOverview() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('admin_user_overview');
  if (error) throw decorate(error, 'admin_user_overview');
  return data ?? [];
}

/**
 * Status lives on `profiles`, not in the 0002 overview function, so the roster
 * gets it in a second query rather than by widening a function other callers
 * already depend on. Returned as a Map so the caller merges by id.
 */
export async function fetchUserStatuses() {
  if (!supabase) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, status, status_reason, status_changed_at');
  if (error) return new Map();
  return new Map((data ?? []).map((r) => [r.id, r]));
}

export const fetchUserDetail = (userId) => softRpc('admin_user_detail', { p_user: userId }, null);

export const adjustXp = (userId, delta, reason) =>
  rpc('admin_adjust_xp', { p_user: userId, p_delta: delta, p_reason: reason });

export const setUserStatus = (userId, status, reason) =>
  rpc('admin_set_user_status', { p_user: userId, p_status: status, p_reason: reason });

export const setUserRole = (userId, role, tier, note) =>
  rpc('admin_set_role', { p_user: userId, p_role: role, p_tier: tier, p_note: note });

/* ── arena ────────────────────────────────────────────────────────────── */

export const fetchLiveMatches = () => softRpc('admin_live_matches', {}, []);
export const fetchMatchDetail = (roomId) => softRpc('admin_match_detail', { p_room: roomId }, null);
export const fetchAnomalies = (from, to) =>
  softRpc('admin_anomalies', { p_from: iso(from), p_to: iso(to) }, []);

export async function fetchRecentMatches({ limit = 100 } = {}) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('shadow_results')
    .select('room_id, user_id, outcome, rounds_won, rounds_lost, wpm, accuracy, fr_before, fr_after, fr_delta, opponent_kind, flags, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data ?? [];
}

/* ── AI control centre ────────────────────────────────────────────────── */

export const fetchModelStats = (from, to) =>
  softRpc('admin_model_stats', { p_from: iso(from), p_to: iso(to) }, []);

export async function fetchProviders() {
  if (!supabase) return [];
  // `secret_ref` is a variable NAME. The key it points at lives in Edge
  // Function secrets and is not reachable from here by construction.
  const { data, error } = await supabase
    .from('ai_providers')
    .select('id, label, base_url, embed_url, secret_ref, key_present, key_tail, key_rotated_at, enabled, priority, day_limit, max_temperature, is_builtin, notes, updated_at')
    .order('priority');
  if (error) return [];
  return data ?? [];
}

export async function fetchModels() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('ai_models')
    .select('*')
    .order('lane')
    .order('priority');
  if (error) return [];
  return data ?? [];
}

export async function fetchModelHealth() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('forge_model_health')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) return [];
  return data ?? [];
}

export async function fetchBudget({ days = 14 } = {}) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('forge_budget')
    .select('*')
    .order('day', { ascending: false })
    .limit(days * 4);
  if (error) return [];
  return data ?? [];
}

export const upsertProvider = (p) =>
  rpc('admin_upsert_provider', {
    p_id: p.id,
    p_label: p.label,
    p_secret_ref: p.secret_ref,
    p_base_url: p.base_url || null,
    p_enabled: p.enabled,
    p_priority: p.priority ?? 100,
    p_day_limit: p.day_limit ?? null,
    p_notes: p.notes || null,
  });

export const upsertModel = (m) =>
  rpc('admin_upsert_model', {
    p_id: m.id,
    p_provider_id: m.provider_id,
    p_model: m.model,
    p_label: m.label,
    p_lane: m.lane ?? 'general',
    p_enabled: m.enabled,
    p_priority: m.priority ?? 100,
    p_fallback_id: m.fallback_id || null,
    p_max_tokens: m.max_tokens ?? null,
    p_temperature: m.temperature ?? null,
    p_top_p: m.top_p ?? null,
    p_input_cost: m.input_cost_per_1k ?? null,
    p_output_cost: m.output_cost_per_1k ?? null,
    p_context: m.context_window ?? null,
    p_notes: m.notes || null,
  });

export const deleteModel = (id, reason) => rpc('admin_delete_model', { p_id: id, p_reason: reason });

export const deleteProvider = (id, reason) => rpc('admin_delete_provider', { p_id: id, p_reason: reason });

/**
 * Writes a provider key into Supabase Vault.
 *
 * The value leaves the browser once, over HTTPS, and is never returned to any
 * client afterwards — not by this function, not by `fetchProviders`. What comes
 * back is the last four characters, which is all the console ever displays.
 */
export const setProviderKey = (providerId, key) =>
  rpc('admin_set_provider_key', { p_provider: providerId, p_key: key });

export const clearProviderKey = (providerId, reason) =>
  rpc('admin_clear_provider_key', { p_provider: providerId, p_reason: reason });

/** Whether each provider's secret actually exists under the name the runtime reads. */
export const fetchKeyStatus = () => softRpc('admin_provider_key_status', {}, []);

export const resetModelHealth = (provider, model) =>
  rpc('admin_reset_model_health', { p_provider: provider, p_model: model });

export async function fetchAiUsage({ limit = 500, userId, from, to } = {}) {
  if (!supabase) return [];
  let q = supabase.from('ai_usage').select('*').order('created_at', { ascending: false }).limit(limit);
  if (userId) q = q.eq('user_id', userId);
  if (from) q = q.gte('created_at', iso(from));
  if (to) q = q.lte('created_at', iso(to));
  const { data, error } = await q;
  if (error) return [];
  return data ?? [];
}

/* ── generated content ────────────────────────────────────────────────── */

/**
 * Server-side pagination, filtering and sorting — the library is designed to
 * grow without bound, so "fetch everything and filter in the browser" is not
 * an option that degrades gracefully. Returns the page plus an exact count so
 * the pager can show a total rather than a guess.
 */
export async function searchGenerations({
  query = '',
  kind = null,
  category = null,
  language = null,
  difficulty = null,
  status = 'all',
  provider = null,
  createdBy = null,
  from = null,
  to = null,
  sort = { key: 'created_at', dir: 'desc' },
  page = 0,
  pageSize = 25,
} = {}) {
  if (!supabase) return { rows: [], count: 0 };

  let q = supabase
    .from('forge_generations')
    .select(
      'id, kind, category, level, difficulty, language, topic, title, word_count, char_count, ' +
        'published, flagged, flag_reason, quality_score, serve_count, completion_count, ' +
        'abandon_count, source_provider, source_model, source_lane, created_by, created_at',
      { count: 'exact' },
    );

  if (query.trim()) {
    const safe = query.trim().replace(/[%,()]/g, ' ');
    q = q.or(`title.ilike.%${safe}%,topic.ilike.%${safe}%,body.ilike.%${safe}%`);
  }
  if (kind) q = q.eq('kind', kind);
  if (category) q = q.eq('category', category);
  if (language) q = q.eq('language', language);
  if (difficulty) q = q.eq('difficulty', difficulty);
  if (provider) q = q.eq('source_provider', provider);
  if (createdBy) q = q.eq('created_by', createdBy);
  if (from) q = q.gte('created_at', iso(from));
  if (to) q = q.lte('created_at', iso(to));
  if (status === 'flagged') q = q.eq('flagged', true);
  if (status === 'archived') q = q.eq('published', false);
  if (status === 'live') q = q.eq('published', true).eq('flagged', false);

  q = q
    .order(sort.key, { ascending: sort.dir === 'asc' })
    .range(page * pageSize, page * pageSize + pageSize - 1);

  const { data, error, count } = await q;
  if (error) throw decorate(error, 'searchGenerations');
  return { rows: data ?? [], count: count ?? 0 };
}

/** The body is fetched only when an operator opens one record, never in a list. */
export async function fetchGenerationBody(id) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('forge_generations')
    .select('id, title, body, meta, kind, category, language, difficulty, source_model, source_provider, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) return null;
  return data;
}

export const moderateGeneration = (id, action, reason) =>
  rpc('admin_moderate_generation', { p_id: id, p_action: action, p_reason: reason });

/* ── configuration ────────────────────────────────────────────────────── */

export async function fetchConfig() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('platform_config').select('*').order('category').order('key');
  if (error) return [];
  return data ?? [];
}

export const setConfig = (key, value) => rpc('admin_set_config', { p_key: key, p_value: value });

export async function fetchFlags() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('feature_flags').select('*').order('key');
  if (error) return [];
  return data ?? [];
}

export const setFlag = (key, enabled, rollout, audience) =>
  rpc('admin_set_flag', { p_key: key, p_enabled: enabled, p_rollout: rollout ?? null, p_audience: audience ?? null });

export async function fetchAnnouncements() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
  if (error) return [];
  return data ?? [];
}

export const upsertAnnouncement = (a) =>
  rpc('admin_upsert_announcement', {
    p_id: a.id ?? null,
    p_title: a.title,
    p_body: a.body,
    p_tone: a.tone ?? 'info',
    p_audience: a.audience ?? 'all',
    p_published: Boolean(a.published),
    p_starts_at: iso(a.starts_at ?? new Date()),
    p_ends_at: a.ends_at ? iso(a.ends_at) : null,
    p_frequency: a.frequency ?? 'once',
    p_target_user: a.target_user_id || null,
    p_dismissible: a.dismissible !== false,
  });

/** Delivery counts per notice, so an operator can see whether it landed. */
export const fetchNoticeStats = () => softRpc('admin_notice_stats', {}, []);

export const deleteAnnouncement = (id) => rpc('admin_delete_announcement', { p_id: id });

/* ── audit and operators ──────────────────────────────────────────────── */

export async function fetchAuditLog({ limit = 100, action = null, actorId = null, targetId = null, from = null, to = null } = {}) {
  if (!supabase) return [];
  let q = supabase.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
  if (action) q = q.eq('action', action);
  if (actorId) q = q.eq('actor_id', actorId);
  if (targetId) q = q.eq('target_id', targetId);
  if (from) q = q.gte('created_at', iso(from));
  if (to) q = q.lte('created_at', iso(to));
  const { data, error } = await q;
  if (error) return [];
  return data ?? [];
}

export async function fetchOperators() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('user_roles')
    .select('user_id, role, admin_tier, granted_at, note')
    .eq('role', 'admin');
  if (error) return [];
  return data ?? [];
}

export async function fetchAuthEvents({ limit = 200, userId } = {}) {
  if (!supabase) return [];
  let q = supabase.from('auth_events').select('*').order('created_at', { ascending: false }).limit(limit);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) return [];
  return data ?? [];
}

/* ── realtime ─────────────────────────────────────────────────────────── */

/**
 * Subscribe to Postgres change events for the live surfaces.
 *
 * Returns an unsubscribe function, always — including when Supabase is not
 * configured, so a caller's cleanup path never has to check. Realtime must be
 * enabled per-table in the Supabase dashboard; when it is not, this is inert
 * rather than broken, and the views that use it fall back to polling.
 */
export function subscribeToTables(tables, onChange) {
  if (!supabase || !tables?.length) return () => {};
  const channel = supabase.channel(`console:${tables.join(':')}`);
  for (const table of tables) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) =>
      onChange({ table, event: payload.eventType, row: payload.new ?? payload.old }),
    );
  }
  channel.subscribe();
  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {
      /* channel already torn down */
    }
  };
}

/** PRD 05 §8: reaching the console is itself an audited event. */
export async function logConsoleView(view) {
  if (!supabase) return;
  try {
    await supabase.from('auth_events').insert({ user_id: (await supabase.auth.getUser()).data?.user?.id, event: `console:${view}` });
  } catch {
    /* advisory only — a logging failure must never block the page */
  }
}
