import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Copy, Check, ArrowLeft, Loader2, Play } from 'lucide-react';
import { useShadowRoom } from '../../lib/shadow/useShadowRoom.js';
import { useAuth } from '../../lib/auth.jsx';
import { useStore } from '../../lib/store.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import Button from '../../components/ui/Button.jsx';
import { Card, Chip } from '../../components/ui/Primitives.jsx';
import ShadowArena from './ShadowArena.jsx';

export default function ShadowRoom() {
  const { pin } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { state } = useStore();

  const [copied, setCopied] = useState(false);

  const {
    room,
    players,
    rounds,
    events,
    loading,
    error,
    isHost,
    mySeat,
    setReady,
    setFighter,
    startMatch,
    forfeitMatch,
  } = useShadowRoom(pin);

  const copyPin = () => {
    if (room?.pin) {
      navigator.clipboard.writeText(room.pin);
      setCopied(true);
      toast('PIN copied to clipboard!', { tone: 'success' });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
        <p className="text-sm text-ink-3">Entering Shadow Room...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <Card className="p-6 border-bad/20 space-y-4">
          <p className="text-sm text-bad">{error}</p>
          <Button variant="secondary" onClick={() => navigate('/shadow')}>
            Return to Shadow Hub
          </Button>
        </Card>
      </div>
    );
  }

  // Active / Countdown Combat Phase
  if (['countdown', 'active', 'round_end'].includes(room?.status)) {
    const p0 = players.find((p) => p.seat === 0);
    const p1 = players.find((p) => p.seat === 1);

    return (
      <div className="w-full max-w-5xl mx-auto py-4">
        <ShadowArena
          mode="multiplayer"
          playerName={p0?.display_name || 'Player 1'}
          opponentName={p1?.display_name || 'Player 2'}
          onExit={() => {
            forfeitMatch();
            navigate('/shadow');
          }}
        />
      </div>
    );
  }

  // Lobby Phase
  const p0 = players.find((p) => p.seat === 0);
  const p1 = players.find((p) => p.seat === 1);
  const me = players.find((p) => p.seat === mySeat);
  const bothReady = p0?.ready && p1?.ready;

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-8 space-y-8 animate-fade-in">
      {/* ── Room Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/shadow')}
          className="flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Hub
        </button>

        {/* Room Code Badge */}
        <div className="flex items-center gap-2 bg-surface border border-line px-3 py-1.5 rounded-xl">
          <span className="text-xs text-ink-3 uppercase font-semibold">Room Code:</span>
          <span className="font-mono text-base font-black text-brand tracking-widest">{room?.pin}</span>
          <button
            type="button"
            onClick={copyPin}
            className="p-1 text-ink-3 hover:text-ink transition-colors"
            title="Copy PIN"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-good" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* ── 2-Player Roster ──────────────────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Seat 0 (Host) */}
        <Card className="p-6 border-line flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-brand uppercase tracking-wider">Player 1 (Left)</div>
            {p0?.ready ? (
              <Chip tone="good" className="text-xs font-bold">READY</Chip>
            ) : (
              <Chip tone="neutral" className="text-xs">NOT READY</Chip>
            )}
          </div>
          <div className="space-y-1">
            <div className="font-display font-bold text-xl text-ink">
              {p0?.display_name || 'Waiting for Host...'}
            </div>
            <div className="text-xs text-ink-3">Fighter: Standard Stickman</div>
          </div>
          {mySeat === 0 && (
            <Button
              variant={me?.ready ? 'secondary' : 'primary'}
              size="md"
              onClick={() => setReady(!me?.ready)}
              className="w-full font-bold"
            >
              {me?.ready ? 'Cancel Ready' : 'Ready Up'}
            </Button>
          )}
        </Card>

        {/* Seat 1 (Guest) */}
        <Card className="p-6 border-line flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-accent uppercase tracking-wider">Player 2 (Right)</div>
            {p1 ? (
              p1.ready ? (
                <Chip tone="good" className="text-xs font-bold">READY</Chip>
              ) : (
                <Chip tone="neutral" className="text-xs">NOT READY</Chip>
              )
            ) : (
              <Chip tone="warn" className="text-xs">OPEN SEAT</Chip>
            )}
          </div>
          <div className="space-y-1">
            <div className="font-display font-bold text-xl text-ink">
              {p1?.display_name || 'Waiting for Challenger...'}
            </div>
            <div className="text-xs text-ink-3">
              {p1 ? 'Fighter: Standard Stickman' : 'Share room PIN to invite'}
            </div>
          </div>
          {mySeat === 1 && (
            <Button
              variant={me?.ready ? 'secondary' : 'primary'}
              size="md"
              onClick={() => setReady(!me?.ready)}
              className="w-full font-bold"
            >
              {me?.ready ? 'Cancel Ready' : 'Ready Up'}
            </Button>
          )}
        </Card>
      </div>

      {/* ── Match Launch Controls (Host only) ────────────────────────────── */}
      {isHost && (
        <div className="pt-4 text-center space-y-3">
          <Button
            variant="primary"
            size="lg"
            onClick={startMatch}
            disabled={!bothReady}
            className="w-full max-w-md mx-auto flex items-center justify-center gap-2 font-black text-base shadow-lg shadow-brand/25"
          >
            <Play className="w-5 h-5 fill-current" />
            Start Shadow Battle
          </Button>
          {!bothReady && (
            <p className="text-xs text-ink-3">Waiting for both players to lock in Ready status.</p>
          )}
        </div>
      )}
    </div>
  );
}
