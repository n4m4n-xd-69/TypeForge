import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Radio, Swords, Timer, Trophy, Users } from 'lucide-react';
import { cx, mmss, relativeTime } from '../../../lib/format.js';
import { Chip, ProgressBar } from '../../../components/ui/Primitives.jsx';
import {
  ConsoleTable, Drilldown, Field, FieldGrid, MetricRack, MetricTile,
  Panel, StateBlock, ViewHeader, useConsole, useConsoleQuery, usePolling,
} from '../kit/index.js';
import {
  fetchAnomalies, fetchKpis, fetchLiveMatches, fetchMatchDetail,
  fetchRecentMatches, subscribeToTables,
} from '../api/console.js';

/**
 * Battle arena.
 *
 * The live board polls at 5s AND subscribes to Postgres changes. Both, not
 * either: Realtime has to be enabled per-table in the Supabase dashboard, and
 * a monitoring surface that silently shows stale rooms because someone forgot
 * to tick a checkbox is worse than one that costs a query every five seconds.
 * The subscription makes it feel instant when it is available; the poll makes
 * it correct when it is not.
 *
 * On the integrity panel: every row is a *signal*, not a verdict. The
 * thresholds catch things the platform's own physics make implausible, and
 * they will catch honest outliers too — a fast typist on a short passage, a
 * clock skew, a reconnect. The copy says "review" throughout and never
 * accuses, because an admin console's language becomes the accusation.
 */

const SIGNAL_LABELS = {
  implausible_wpm: {
    label: 'Speed beyond the record',
    explain: 'A session above 250 WPM at over 99% accuracy. Verify before acting — short passages inflate WPM.',
  },
  wpm_divergence: {
    label: 'Client/server disagreement',
    explain: "The browser's reported speed differs from the server's recomputation by more than 20%.",
  },
  shadow_flag: {
    label: 'Flagged during settlement',
    explain: 'The Shadow match engine attached a flag while settling this result.',
  },
  session_flood: {
    label: 'Unusual session volume',
    explain: 'More sessions in one hour than the configured limits.session_rate ceiling.',
  },
};

export default function ArenaView() {
  const { range, nonce } = useConsole();
  const [openRoom, setOpenRoom] = useState(null);

  const live = useConsoleQuery(() => fetchLiveMatches(), [nonce]);
  const kpis = useConsoleQuery(
    () => fetchKpis(range.from, range.to),
    [range.from.getTime(), range.to.getTime(), nonce],
  );
  const recent = useConsoleQuery(() => fetchRecentMatches({ limit: 150 }), [nonce]);
  const anomalies = useConsoleQuery(
    () => fetchAnomalies(range.from, range.to),
    [range.from.getTime(), range.to.getTime(), nonce],
  );

  usePolling(live.reload, 5_000);

  /* `subscribeToTables` always returns an unsubscribe function, including when
     Supabase is unconfigured, so this cleanup needs no guard. */
  useEffect(
    () => subscribeToTables(['battle_rooms', 'battle_players', 'shadow_rooms', 'shadow_players'], live.reload),
    [live.reload],
  );

  const k = kpis.data ?? {};
  const rooms = live.data ?? [];

  const sorted = useMemo(() => {
    const rank = { active: 0, round_end: 1, countdown: 2, paused: 3, lobby: 4 };
    return [...rooms].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  }, [rooms]);

  const playersInPlay = rooms.reduce((a, r) => a + (Number(r.players) || 0), 0);

  return (
    <div className="space-y-2">
      <ViewHeader
        title="Arena"
        description="Live matches as they happen, full replays once they settle, and signals worth a second look."
      />

      <MetricRack cols={4}>
        <MetricTile
          icon={Radio}
          label="Live rooms"
          value={rooms.length}
          hint={`${k.live_battle_rooms ?? 0} battle · ${k.live_shadow_rooms ?? 0} shadow`}
          source="admin_live_matches · 5s"
        />
        <MetricTile icon={Users} label="Players in play" value={playersInPlay} source="battle_players + shadow_players" />
        <MetricTile
          icon={Timer}
          label="Queue depth"
          value={k.queue_depth}
          hint="Waiting for a Shadow opponent"
          source="shadow_queue"
        />
        <MetricTile
          icon={Trophy}
          label={`Completed in ${range.label.toLowerCase()}`}
          value={(k.battle_finishes ?? 0) + (k.shadow_results ?? 0)}
          hint={`${k.shadow_results ?? 0} shadow · ${k.battle_finishes ?? 0} battle`}
          source="battle_results + shadow_results"
        />
      </MetricRack>

      <Panel
        title="Live board"
        hint="Polled every 5 seconds and pushed on change where Realtime is enabled"
        source="admin_live_matches · 5s + realtime"
        refreshing={live.isRefreshing}
      >
        <StateBlock
          status={live.status}
          error={live.error}
          empty={rooms.length === 0}
          emptyIcon={Swords}
          emptyTitle="No live rooms"
          emptyDescription="Rooms appear here the moment someone opens a lobby."
          onRetry={live.reload}
        >
          <ul className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map((room) => (
              <RoomCard key={room.room_id} room={room} onOpen={() => setOpenRoom(room.room_id)} />
            ))}
          </ul>
        </StateBlock>
      </Panel>

      <Panel
        title="Recent results"
        hint="Settled Shadow matches, newest first"
        source="shadow_results · on demand"
      >
        <StateBlock
          status={recent.status}
          error={recent.error}
          empty={(recent.data ?? []).length === 0}
          emptyTitle="No settled matches yet"
          emptyDescription="A result is written when a match reaches its final round."
          onRetry={recent.reload}
        >
          <ConsoleTable
            columns={[
              {
                key: 'outcome',
                label: 'Outcome',
                render: (r) => (
                  <Chip tone={r.outcome === 'win' ? 'good' : r.outcome === 'loss' ? 'neutral' : 'warn'}>{r.outcome}</Chip>
                ),
              },
              { key: 'rounds_won', label: 'Rounds', align: 'right', mono: true, render: (r) => `${r.rounds_won}-${r.rounds_lost}` },
              { key: 'wpm', label: 'WPM', align: 'right', mono: true, render: (r) => Math.round(r.wpm) },
              { key: 'accuracy', label: 'Accuracy', align: 'right', mono: true, render: (r) => `${Math.round(r.accuracy)}%` },
              { key: 'fr_after', label: 'Rating', align: 'right', mono: true },
              {
                key: 'fr_delta',
                label: 'Δ',
                align: 'right',
                mono: true,
                render: (r) => (
                  <span className={cx(r.fr_delta > 0 ? 'text-good' : r.fr_delta < 0 ? 'text-bad' : 'text-ink-3')}>
                    {r.fr_delta > 0 ? '+' : ''}
                    {r.fr_delta}
                  </span>
                ),
              },
              { key: 'opponent_kind', label: 'Opponent' },
              {
                key: 'flags',
                label: 'Flags',
                sortable: false,
                render: (r) => (r.flags?.length ? <Chip tone="warn">{r.flags.join(', ')}</Chip> : <span className="text-ink-3">—</span>),
              },
              {
                key: 'created_at',
                label: 'When',
                align: 'right',
                render: (r) => <span className="text-ink-3">{relativeTime(r.created_at)}</span>,
              },
            ]}
            rows={recent.data ?? []}
            rowKey={(r) => `${r.room_id}-${r.user_id}`}
            onRowClick={(r) => setOpenRoom(r.room_id)}
            defaultSort={{ key: 'created_at', dir: 'desc' }}
            csvName="typeforge-matches"
            minWidth={900}
          />
        </StateBlock>
      </Panel>

      <Panel
        title="Worth reviewing"
        hint="Automated signals, not conclusions — confirm before acting on any of them"
        source={`admin_anomalies · ${range.days}d`}
      >
        <StateBlock
          status={anomalies.status}
          error={anomalies.error}
          empty={(anomalies.data ?? []).length === 0}
          emptyIcon={AlertTriangle}
          emptyTitle="Nothing to review"
          emptyDescription="Implausible results, client/server divergence, settlement flags and session floods appear here."
          onRetry={anomalies.reload}
        >
          <ConsoleTable
            columns={[
              { key: 'display_name', label: 'Account', render: (a) => <span className="font-semibold">{a.display_name || 'Unknown'}</span> },
              {
                key: 'signal',
                label: 'Signal',
                render: (a) => (
                  <span title={SIGNAL_LABELS[a.signal]?.explain}>{SIGNAL_LABELS[a.signal]?.label ?? a.signal}</span>
                ),
              },
              { key: 'detail', label: 'What was measured', width: '30%', render: (a) => <span className="font-mono text-xs text-ink-2">{a.detail}</span> },
              {
                key: 'severity',
                label: 'Priority',
                render: (a) => <Chip tone={a.severity === 'high' ? 'bad' : 'warn'}>{a.severity}</Chip>,
              },
              { key: 'observed', label: 'Value', align: 'right', mono: true },
              {
                key: 'occurred_at',
                label: 'When',
                align: 'right',
                render: (a) => <span className="text-ink-3">{relativeTime(a.occurred_at)}</span>,
              },
            ]}
            rows={anomalies.data ?? []}
            rowKey={(a, i) => `${a.user_id}-${a.signal}-${a.occurred_at}`}
            defaultSort={{ key: 'occurred_at', dir: 'desc' }}
            csvName="typeforge-review-signals"
            minWidth={880}
          />
        </StateBlock>
      </Panel>

      <MatchSheet roomId={openRoom} onClose={() => setOpenRoom(null)} />
    </div>
  );
}

/* ── live board ────────────────────────────────────────────────────────── */

function RoomCard({ room, onOpen }) {
  const roster = Array.isArray(room.roster) ? room.roster : [];
  const isBattle = room.game === 'battle';

  return (
    <li>
      <button
        onClick={onOpen}
        className="flex w-full flex-col gap-1 rounded-md border border-line bg-surface p-1.5 text-left transition-colors duration-fast hover:border-line-strong hover:bg-raised/50 focus-visible:outline-none focus-visible:shadow-focus"
      >
        <span className="flex items-center gap-1">
          <Chip tone={isBattle ? 'accent' : 'brand'}>{room.game}</Chip>
          <span className="font-mono text-sm font-bold tracking-[0.1em]">{room.pin}</span>
          <StatusChip status={room.status} />
          <span className="ml-auto font-mono text-2xs text-ink-3 tnum">
            {room.players}/{room.capacity}
          </span>
        </span>

        {room.deadline_at ? <Countdown deadline={room.deadline_at} /> : null}

        {isBattle ? (
          <ul className="space-y-0.5">
            {roster.slice(0, 8).map((p) => (
              <li key={p.user_id} className="flex items-center gap-1">
                <span className="w-[84px] shrink-0 truncate text-xs font-semibold">{p.name || 'anon'}</span>
                <ProgressBar
                  value={(Number(p.progress) || 0) / 100}
                  tone={p.status === 'finished' ? 'good' : 'brand'}
                  className="flex-1"
                  label={`${p.name} progress`}
                />
                <span className="w-[52px] shrink-0 text-right font-mono text-2xs tnum text-ink-3">
                  {Math.round(p.wpm ?? 0)} wpm
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-1">
            {roster.map((p) => (
              <span key={p.user_id} className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{p.name || 'anon'}</span>
                <span className="block truncate font-mono text-2xs text-ink-3">
                  {p.fighter}
                  {p.connection !== 'connected' ? ` · ${p.connection}` : ''}
                </span>
              </span>
            ))}
            {room.score ? (
              <span className="shrink-0 font-mono text-lg font-bold tnum">{room.score}</span>
            ) : null}
          </div>
        )}
      </button>
    </li>
  );
}

function StatusChip({ status }) {
  const tone =
    status === 'active' ? 'good' : status === 'lobby' ? 'neutral' : status === 'paused' ? 'warn' : 'accent';
  return <Chip tone={tone}>{status}</Chip>;
}

/**
 * Counts against a server-set deadline.
 *
 * Ticks once a second only while the tab is visible — `usePolling` already
 * enforces that, and an arena left open overnight should not spend the night
 * re-rendering forty cards.
 */
function Countdown({ deadline }) {
  const [now, setNow] = useState(() => Date.now());
  usePolling(() => setNow(Date.now()), 1000);

  const remaining = (new Date(deadline).getTime() - now) / 1000;
  const expired = remaining <= 0;

  return (
    <span
      className={cx(
        'flex items-center gap-0.5 font-mono text-2xs tnum',
        expired ? 'text-bad' : remaining < 30 ? 'text-warn' : 'text-ink-3',
      )}
    >
      <Timer size={11} aria-hidden />
      {expired ? 'past deadline' : `${mmss(remaining)} remaining`}
    </span>
  );
}

/* ── replay ───────────────────────────────────────────────────────────── */

function MatchSheet({ roomId, onClose }) {
  const [round, setRound] = useState(1);

  const detail = useConsoleQuery(
    () => (roomId ? fetchMatchDetail(roomId) : Promise.resolve(null)),
    [roomId],
    { enabled: Boolean(roomId) },
  );

  useEffect(() => setRound(1), [roomId]);

  const d = detail.data ?? {};
  const isShadow = d.game === 'shadow';
  const events = useMemo(
    () => (d.events ?? []).filter((e) => e.round === round),
    [d.events, round],
  );
  const rounds = d.rounds ?? [];

  return (
    <Drilldown
      open={Boolean(roomId)}
      onClose={onClose}
      width="xl"
      eyebrow="admin_match_detail"
      title={d.room?.pin ? `Room ${d.room.pin}` : 'Match'}
      subtitle={d.game ? `${d.game} · ${d.room?.status ?? ''}` : undefined}
    >
      <StateBlock status={detail.status} error={detail.error} onRetry={detail.reload} rows={6}>
        <div className="space-y-2">
          <FieldGrid cols={4}>
            <Field label="Game">{d.game}</Field>
            <Field label="Status">{d.room?.status}</Field>
            <Field label={isShadow ? 'Band' : 'Difficulty'}>{d.room?.band ?? d.room?.difficulty}</Field>
            <Field label="Created">{d.room?.created_at ? relativeTime(d.room.created_at) : null}</Field>
            {isShadow ? (
              <>
                <Field label="Score" mono>{`${d.room?.score_p0 ?? 0} – ${d.room?.score_p1 ?? 0}`}</Field>
                <Field label="Rated">{d.room?.rated ? 'yes' : 'no'}</Field>
                <Field label="Seed" mono>{d.room?.seed}</Field>
                <Field label="Round" mono>{d.room?.current_round}</Field>
              </>
            ) : (
              <>
                <Field label="Passage length" mono>{d.room?.passage_chars}</Field>
                <Field label="Time limit" mono>{d.room?.time_limit_sec ? `${d.room.time_limit_sec}s` : null}</Field>
              </>
            )}
          </FieldGrid>

          {isShadow && rounds.length ? (
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-1">
                <p className="text-sm font-bold">Replay</p>
                <div className="flex gap-px rounded-sm border border-line p-px" role="group" aria-label="Round">
                  {rounds.map((r) => (
                    <button
                      key={r.round}
                      onClick={() => setRound(r.round)}
                      aria-pressed={round === r.round}
                      className={cx(
                        'rounded-xs px-1 py-px font-mono text-2xs font-bold transition-colors',
                        round === r.round ? 'bg-ink text-bg' : 'text-ink-3 hover:text-ink',
                      )}
                    >
                      R{r.round}
                    </button>
                  ))}
                </div>
                <span className="font-mono text-2xs text-ink-3">
                  {rounds.find((r) => r.round === round)?.reason} ·{' '}
                  {Math.round((rounds.find((r) => r.round === round)?.duration_ms ?? 0) / 100) / 10}s
                </span>
              </div>
              <RoundTimeline events={events} players={d.players ?? []} />
            </div>
          ) : null}

          {isShadow ? (
            <MiniList
              title="Rounds"
              head={['Round', 'Winner', 'HP P0', 'HP P1', 'Reason', 'Duration']}
              rows={rounds.map((r) => [
                r.round,
                r.winner_seat == null ? 'draw' : `seat ${r.winner_seat}`,
                r.hp_p0,
                r.hp_p1,
                r.reason,
                `${Math.round(r.duration_ms / 100) / 10}s`,
              ])}
              emptyText="No settled rounds."
            />
          ) : null}

          <MiniList
            title="Players"
            head={
              isShadow
                ? ['Seat', 'Name', 'Fighter', 'Connection', 'Joined']
                : ['Name', 'Progress', 'WPM', 'Accuracy', 'Mistakes', 'Status']
            }
            rows={(d.players ?? []).map((p) =>
              isShadow
                ? [p.seat, p.display_name, p.fighter_id, p.connection, relativeTime(p.joined_at)]
                : [p.display_name, p.progress_chars, p.wpm, `${p.accuracy}%`, p.mistakes, p.status],
            )}
            emptyText="No roster recorded."
          />

          <MiniList
            title="Results"
            head={
              isShadow
                ? ['Seat', 'Outcome', 'Rounds', 'Damage', 'WPM', 'Accuracy', 'Rating', 'Δ']
                : ['Name', 'Correct', 'Typed', 'Mistakes', 'Accuracy', 'Server WPM', 'Client WPM']
            }
            rows={(d.results ?? []).map((r) =>
              isShadow
                ? [
                    r.seat,
                    r.outcome,
                    `${r.rounds_won}-${r.rounds_lost}`,
                    `${r.damage_dealt}/${r.damage_taken}`,
                    r.wpm,
                    `${r.accuracy}%`,
                    r.fr_after,
                    `${r.fr_delta > 0 ? '+' : ''}${r.fr_delta}`,
                  ]
                : [
                    r.display_name,
                    r.correct_chars,
                    r.typed_chars,
                    r.mistakes,
                    `${r.accuracy}%`,
                    r.wpm,
                    // Kept side by side deliberately: 0009 stores the client's
                    // claim so a divergence is visible in the data rather than
                    // silently discarded.
                    r.client_wpm ?? '—',
                  ],
            )}
            emptyText="This match has not settled."
          />
        </div>
      </StateBlock>
    </Drilldown>
  );
}

/**
 * One round, laid out on a real time axis.
 *
 * Each event has a start and an end in milliseconds from the round's own
 * start, so the lane is drawn to scale rather than as an ordered list — the
 * gaps between cards are exactly as informative as the cards, and an ordered
 * dump would throw them away.
 */
function RoundTimeline({ events, players }) {
  const span = useMemo(() => Math.max(1, ...events.map((e) => e.t_end)), [events]);

  if (events.length === 0) {
    return <p className="text-sm text-ink-3">No events recorded for this round.</p>;
  }

  const seats = [0, 1];
  const outcomeTone = {
    complete: 'bg-good',
    expire: 'bg-warn',
    whiff: 'bg-bad',
  };

  return (
    <div className="space-y-1">
      {seats.map((seat) => {
        const seatEvents = events.filter((e) => e.seat === seat);
        const player = players.find((p) => p.seat === seat);
        return (
          <div key={seat}>
            <p className="mb-px flex items-center gap-0.5 text-xs font-semibold">
              <span className="font-mono text-2xs text-ink-3">S{seat}</span>
              {player?.display_name ?? 'unknown'}
              <span className="ml-auto font-mono text-2xs text-ink-3 tnum">{seatEvents.length} cards</span>
            </p>
            <div className="relative h-[26px] overflow-hidden rounded-xs border border-line bg-raised/40">
              {seatEvents.map((e) => (
                <span
                  key={e.seq}
                  title={`Card ${e.card_index} · ${e.lane} · ${e.outcome} · ${e.keystrokes} keys, ${e.errors} errors`}
                  className={cx(
                    'absolute top-0 h-full opacity-80 transition-opacity hover:opacity-100',
                    outcomeTone[e.outcome] ?? 'bg-ink-3',
                    e.lane === 'guard' && 'top-[13px] h-[13px]',
                  )}
                  style={{
                    left: `${(e.t_start / span) * 100}%`,
                    width: `${Math.max(0.6, ((e.t_end - e.t_start) / span) * 100)}%`,
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-px font-mono text-[10px] text-ink-3">
        <span>0s</span>
        <span className="flex-1 border-b border-dashed border-line" />
        <span>{Math.round(span / 100) / 10}s</span>
        <span className="w-full sm:w-auto">
          <span className="mr-0.5 inline-block h-[7px] w-[7px] rounded-full bg-good align-middle" /> complete
          <span className="ml-1 mr-0.5 inline-block h-[7px] w-[7px] rounded-full bg-warn align-middle" /> expired
          <span className="ml-1 mr-0.5 inline-block h-[7px] w-[7px] rounded-full bg-bad align-middle" /> whiff
          <span className="ml-1">· upper band strike, lower band guard</span>
        </span>
      </p>
    </div>
  );
}

function MiniList({ title, head, rows, emptyText }) {
  return (
    <div>
      <p className="mb-1 text-sm font-bold">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-3">{emptyText}</p>
      ) : (
        <div className="max-h-[240px] overflow-auto rounded-sm border border-line">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead className="sticky top-0 bg-raised">
              <tr>
                {head.map((h) => (
                  <th key={h} className="px-1.5 py-1 text-left text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((cell, j) => (
                    <td key={j} className={cx('px-1.5 py-1', j > 0 && 'font-mono tnum text-ink-2')}>
                      {cell ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
