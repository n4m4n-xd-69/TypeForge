/**
 * Display mirror of `public.admin_tier_scopes()` (0014_admin_console.sql).
 *
 * The SQL function is the only thing that actually gates anything — every
 * admin RPC calls `admin_require()`, which reads it. This copy exists so the
 * console can show an operator what a tier grants *before* they hand it to
 * someone, which is not a question the database can be asked cheaply from the
 * browser for a tier the caller does not hold.
 *
 * Two copies of a permission table is exactly the kind of duplication that
 * rots, so `scopes.test.js` parses the migration and fails the build if this
 * ever drifts from it. If they disagree, the SQL is right and this is the bug.
 */

export const SCOPES = [
  'analytics.read',
  'users.read',
  'users.write',
  'users.delete',
  'ai.read',
  'ai.write',
  'content.read',
  'content.moderate',
  'config.write',
  'audit.read',
  'roles.write',
];

export const TIER_SCOPES = {
  owner: [
    'analytics.read', 'users.read', 'users.write', 'users.delete',
    'ai.read', 'ai.write', 'content.read', 'content.moderate',
    'config.write', 'audit.read', 'roles.write',
  ],
  admin: [
    'analytics.read', 'users.read', 'users.write', 'users.delete',
    'ai.read', 'ai.write', 'content.read', 'content.moderate',
    'config.write', 'audit.read',
  ],
  analyst: ['analytics.read', 'users.read', 'ai.read', 'content.read', 'audit.read'],
  support: ['analytics.read', 'users.read', 'users.write', 'content.read', 'content.moderate'],
};

export const TIERS = ['owner', 'admin', 'analyst', 'support'];

/** Human-readable summary of what a tier can do, for the tier picker. */
export const TIER_SUMMARY = {
  owner: 'Everything, including granting and revoking console access.',
  admin: 'Everything except changing who can operate the console.',
  analyst: 'Read every module. Cannot change anything.',
  support: 'Act on user accounts and moderate content. No model, key or config access.',
};
