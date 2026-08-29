import {
  Activity, Boxes, Gauge, LayoutDashboard, Library, Settings2, Swords, Users,
} from 'lucide-react';

/**
 * The console's module registry.
 *
 * Adding a module means adding a row here and a lazy import in AdminShell —
 * the strip, the ⌘K entries, the scope gating and the route table all derive
 * from this list, so none of them can fall out of step with the others. That
 * is the "modular and API-ready" requirement made structural rather than
 * promised in a comment.
 *
 * `scope` names the database scope the module's primary reads need. A module
 * an operator's tier does not carry stays visible but dimmed: hiding it would
 * leave them unable to tell whether the feature is missing or they are.
 */
export const CONSOLE_MODULES = [
  {
    path: '',
    end: true,
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    scope: 'analytics.read',
    description: 'Platform health, headline metrics and the live pulse',
    keywords: ['dashboard', 'kpi', 'health', 'home'],
  },
  {
    path: 'users',
    id: 'users',
    label: 'Users',
    icon: Users,
    scope: 'users.read',
    description: 'The user database, profiles and account actions',
    keywords: ['accounts', 'people', 'xp', 'suspend', 'roster'],
  },
  {
    path: 'performance',
    id: 'performance',
    label: 'Performance',
    icon: Gauge,
    scope: 'analytics.read',
    description: 'Typing and coding analytics, cohorts and comparisons',
    keywords: ['wpm', 'accuracy', 'typing', 'coding', 'languages'],
  },
  {
    path: 'arena',
    id: 'arena',
    label: 'Arena',
    icon: Swords,
    scope: 'analytics.read',
    description: 'Live matches, replays and gameplay integrity signals',
    keywords: ['battle', 'shadow', 'matches', 'games', 'anomalies', 'cheating'],
  },
  {
    path: 'ai',
    id: 'ai',
    label: 'AI Control',
    icon: Boxes,
    scope: 'ai.read',
    description: 'Providers, models, routing, limits and spend',
    keywords: ['models', 'providers', 'tokens', 'cost', 'keys', 'routing', 'latency'],
  },
  {
    path: 'content',
    id: 'content',
    label: 'Content',
    icon: Library,
    scope: 'content.read',
    description: 'The generated library, search and moderation',
    keywords: ['generations', 'library', 'passages', 'moderation', 'flagged'],
  },
  {
    path: 'reports',
    id: 'reports',
    label: 'Reports',
    icon: Activity,
    scope: 'analytics.read',
    description: 'Retention, engagement, the XP economy and exports',
    keywords: ['retention', 'cohorts', 'export', 'csv', 'dau', 'economy'],
  },
  {
    path: 'settings',
    id: 'settings',
    label: 'Settings',
    icon: Settings2,
    scope: 'audit.read',
    description: 'Operators, audit log, feature flags, config and announcements',
    keywords: ['flags', 'audit', 'roles', 'config', 'announcements', 'permissions'],
  },
];
