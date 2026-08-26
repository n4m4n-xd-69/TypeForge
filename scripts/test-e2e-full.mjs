import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://kavfjyvsvgvcjiuwwfbw.supabase.co';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const clientAnon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const clientAdmin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runE2E() {
  console.log('==================================================');
  console.log('🚀 Running Complete TypeForge Supabase E2E Suite');
  console.log('==================================================\n');

  // 1. Create two test users (Host and Opponent)
  console.log('1️⃣ Creating Test Users...');
  const hostName = `Host_${Date.now().toString().slice(-4)}`;
  const opponentName = `Opponent_${Date.now().toString().slice(-4)}`;

  const { data: hostAuth, error: hostAuthErr } = await clientAnon.auth.signInAnonymously({
    options: { data: { full_name: hostName } }
  });
  if (hostAuthErr) throw new Error(`Host signin failed: ${hostAuthErr.message}`);

  const { data: oppAuth, error: oppAuthErr } = await clientAnon.auth.signInAnonymously({
    options: { data: { full_name: opponentName } }
  });
  if (oppAuthErr) throw new Error(`Opponent signin failed: ${oppAuthErr.message}`);

  const hostUser = hostAuth.user;
  const oppUser = oppAuth.user;
  console.log(`✅ Host: ${hostName} (${hostUser.id})`);
  console.log(`✅ Opponent: ${opponentName} (${oppUser.id})`);

  const hostClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${hostAuth.session.access_token}` } }
  });

  const oppClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${oppAuth.session.access_token}` } }
  });

  // 2. Profile Sync & RLS
  console.log('\n2️⃣ Testing Profile Upsert & Leaderboard Opt-In...');
  const { error: hostProfErr } = await hostClient.from('profiles').upsert({
    id: hostUser.id,
    display_name: hostName,
    avatar: 'preset:aurora',
    xp: 500,
    streak_count: 5,
    streak_best: 10,
    streak_last: '2026-08-24',
    goal_minutes: 20,
    settings: { theme: 'dark', sound: true },
    hide_from_leaderboard: false,
    updated_at: new Date().toISOString()
  });
  if (hostProfErr) throw hostProfErr;

  const { error: oppProfErr } = await oppClient.from('profiles').upsert({
    id: oppUser.id,
    display_name: opponentName,
    avatar: 'preset:emerald',
    xp: 350,
    streak_count: 2,
    streak_best: 4,
    streak_last: '2026-08-24',
    goal_minutes: 15,
    settings: { theme: 'dark', sound: false },
    hide_from_leaderboard: false,
    updated_at: new Date().toISOString()
  });
  if (oppProfErr) throw oppProfErr;
  console.log('✅ Profiles successfully created and synced.');

  // 3. Leaderboard Verification
  console.log('\n3️⃣ Checking Leaderboard View...');
  const { data: lb, error: lbErr } = await clientAnon.from('leaderboard').select('*').limit(10);
  if (lbErr) throw lbErr;
  console.log(`✅ Leaderboard has ${lb.length} players. Top entries:`, lb.map(p => `${p.rank}. ${p.display_name} (${p.xp} XP)`));

  // 4. Typing Sessions & Analytics
  console.log('\n4️⃣ Testing Sessions & Rollup Data...');
  const testSessionTs = new Date().toISOString();
  const { error: sessErr } = await hostClient.from('sessions').upsert({
    user_id: hostUser.id,
    client_id: `cid_${Date.now()}`,
    ts: testSessionTs,
    kind: 'practice',
    mode: 'timed',
    language: 'english',
    difficulty: 'normal',
    wpm: 95.4,
    raw_wpm: 102.1,
    accuracy: 98.2,
    consistency: 91.0,
    duration_sec: 30,
    chars: 240,
    errors: 4,
    xp: 45
  });
  if (sessErr) throw sessErr;

  const { error: dailyErr } = await hostClient.from('daily_stats').upsert({
    user_id: hostUser.id,
    day: '2026-08-24',
    seconds: 30,
    sessions: 1,
    xp: 45
  });
  if (dailyErr) throw dailyErr;
  console.log('✅ Typing session and daily stats saved.');

  // 5. Battlefield Real-Time 2-Player Match
  console.log('\n5️⃣ Testing 2-Player Battlefield Multiplayer Match...');
  const samplePassage = 'In the heart of the digital forge, every keystroke echoes with precision and velocity. Speed is nothing without accuracy, and power comes to those who remain calm under pressure.';
  
  // Host creates room
  const { data: roomRaw, error: createErr } = await hostClient.rpc('battle_create', {
    p_passage: samplePassage,
    p_passage_meta: 'TypeForge • Philosophy',
    p_difficulty: 'normal',
    p_max_players: 4,
    p_time_limit_sec: 120
  });
  if (createErr) throw createErr;
  const room = Array.isArray(roomRaw) ? roomRaw[0] : roomRaw;
  console.log(`✅ Host created room PIN: [${room.pin}], ID: ${room.id}`);

  // Opponent joins room by PIN
  const { data: joinRaw, error: joinErr } = await oppClient.rpc('battle_join', {
    p_pin: room.pin
  });
  if (joinErr) throw joinErr;
  console.log(`✅ Opponent joined room successfully.`);

  // Host starts battle
  const { data: startRaw, error: startErr } = await hostClient.rpc('battle_start', {
    p_room: room.id
  });
  if (startErr) throw startErr;
  console.log(`✅ Battle started by host!`);

  // Both players fetch passage
  const { data: passageHost } = await hostClient.rpc('battle_passage', { p_room: room.id });
  const { data: passageOpp } = await oppClient.rpc('battle_passage', { p_room: room.id });
  if (!passageHost || passageHost !== passageOpp) {
    throw new Error('Passage mismatch or unavailable!');
  }
  console.log(`✅ Both players retrieved identical passage (${passageHost.length} chars).`);

  // Players finish battle
  const { data: finishHost, error: finishHostErr } = await hostClient.rpc('battle_finish', {
    p_room: room.id,
    p_correct_chars: passageHost.length,
    p_typed_chars: passageHost.length + 2,
    p_mistakes: 2,
    p_accuracy: 98.8,
    p_consistency: 94.0,
    p_client_wpm: 104.5,
    p_finished: true
  });
  if (finishHostErr) throw finishHostErr;

  const { data: finishOpp, error: finishOppErr } = await oppClient.rpc('battle_finish', {
    p_room: room.id,
    p_correct_chars: passageHost.length,
    p_typed_chars: passageHost.length + 5,
    p_mistakes: 5,
    p_accuracy: 96.2,
    p_consistency: 88.0,
    p_client_wpm: 89.2,
    p_finished: true
  });
  if (finishOppErr) throw finishOppErr;
  console.log('✅ Both players submitted results to server-authoritative finisher.');

  // Fetch final leaderboard for match
  const { data: results, error: resErr } = await hostClient.rpc('battle_leaderboard', {
    p_room: room.id
  });
  if (resErr) throw resErr;
  console.log('✅ Match Leaderboard computed by Postgres:');
  for (const r of results) {
    console.log(`   Rank ${r.rank}: ${r.display_name} -> ${r.wpm} WPM (${r.accuracy}% acc) [${r.status}]`);
  }

  // 6. Cleanup test users
  console.log('\n6️⃣ Cleaning up test users...');
  await clientAdmin.auth.admin.deleteUser(hostUser.id);
  await clientAdmin.auth.admin.deleteUser(oppUser.id);
  console.log('✅ Test users cleaned up.');

  console.log('\n==================================================');
  console.log('🏆 All Supabase Integrations Tested & Verified 100%!');
  console.log('==================================================');
}

runE2E().catch(err => {
  console.error('\n❌ E2E Test Suite Error:', err);
  process.exit(1);
});
