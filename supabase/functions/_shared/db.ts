/**
 * The narrow database surface the router needs.
 *
 * Declared as an interface rather than reaching for a Supabase client directly
 * so every module below it stays testable under Node: the real implementation
 * imports `npm:@supabase/supabase-js`, which only resolves under Deno, and it
 * lives in `db.supabase.ts` where no unit test touches it.
 *
 * Every method is allowed to fail. The router treats the database as advisory:
 * a breaker that cannot be read means "nothing is open", and a usage row that
 * cannot be written is not a reason for a user's answer to fail. That rule is
 * inherited from the client runner, where `logAiUsage` swallowed its own
 * errors for exactly this reason.
 */

export interface UsageRow {
  requestId: string;
  userId: string | null;
  surface: string;
  lane: string;
  provider: string;
  model: string;
  promptTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  ok: boolean;
  reason?: string;
  attemptIndex: number;
  cache?: 'exact' | 'semantic' | 'miss';
  generationId?: string | null;
}

export interface ForgeDb {
  /** Open circuit-breaker entries, as `provider/model`. */
  openModels(): Promise<string[]>;

  /** Fire-and-forget health update. Never awaited on the hot path. */
  recordHealth(
    provider: string,
    model: string,
    ok: boolean,
    reason?: string,
    latencyMs?: number,
  ): Promise<void>;

  /** Increments and returns today's request count for a provider. */
  chargeBudget(provider: string, limit?: number): Promise<number>;

  /** Today's counts, `provider -> requests`. */
  budgetToday(): Promise<Record<string, number>>;

  /** Appends one attempt to ai_usage. */
  recordUsage(row: UsageRow): Promise<void>;

  /** Durable rate-limit counter. */
  logRequest(userId: string | null, lane: string): Promise<void>;

  /**
   * Provider keys held in Supabase Vault, `FORGE_*` only.
   *
   * The fallback when the function environment has no keys — see secrets.ts.
   * Read once per isolate, never per request.
   */
  loadSecrets(): Promise<Record<string, string>>;

  /* ── library ─────────────────────────────────────────────────────────── */

  /**
   * Exact stage: rows filed under this request hash that this user has not
   * been served. One btree probe, no vector work.
   */
  lookupExact(requestHash: string, userId: string | null): Promise<LibraryRow[]>;

  /** Semantic stage: facet-prefiltered ANN over the embedding column. */
  matchSemantic(
    embedding: number[],
    facets: {
      kind: string; category?: string; difficulty?: string;
      language?: string | null; level?: number;
    },
    userId: string | null,
    minSimilarity?: number,
  ): Promise<Array<LibraryRow & { similarity: number }>>;

  /** Write-back. Returns the row id, existing or new. */
  saveGeneration(row: SaveRow): Promise<string | null>;

  /** Marks a row as served to a user and bumps its counter. */
  recordServe(generationId: string, userId: string): Promise<void>;

  /** Queues a row for embedding, out of band. */
  enqueueEmbed(generationId: string): Promise<void>;
}

export interface LibraryRow {
  id: string;
  title: string | null;
  body: string;
  meta: Record<string, unknown>;
  topic: string;
  serveCount: number;
}

export interface SaveRow {
  kind: string;
  category: string;
  level: number;
  difficulty: string;
  language: string | null;
  topic: string;
  title: string | null;
  body: string;
  meta: Record<string, unknown>;
  wordCount: number;
  contentHash: string;
  requestHash: string;
  provider?: string;
  model?: string;
  lane?: string;
  createdBy?: string | null;
}

/**
 * A no-op database, used when the service role is unavailable and by tests.
 *
 * Returning "nothing is open" and "zero spent" is the safe direction: the
 * router degrades to plain hedged failover, which is exactly how the client
 * version behaved before any of this existed.
 */
export const NULL_DB: ForgeDb = {
  openModels: async () => [],
  recordHealth: async () => {},
  chargeBudget: async () => 0,
  budgetToday: async () => ({}),
  recordUsage: async () => {},
  logRequest: async () => {},
  loadSecrets: async () => ({}),
  lookupExact: async () => [],
  matchSemantic: async () => [],
  saveGeneration: async () => null,
  recordServe: async () => {},
  enqueueEmbed: async () => {},
};
