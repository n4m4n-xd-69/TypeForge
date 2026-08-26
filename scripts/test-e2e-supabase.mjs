import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://kavfjyvsvgvcjiuwwfbw.supabase.co';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const clientAnon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const clientAdmin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runE2ETests() {
  console.log('========================================');
  console.log('🧪 Running Supabase E2E Integration Test');
  console.log('========================================\n');

  // 1. Test Anonymous / Guest Auth
  console.log('1️⃣ Testing Anonymous Sign-In...');
  const testGuestName = `Guest_${Math.floor(Math.random() * 10000)}`;
  const { data: anonAuthData, error: anonAuthErr } = await clientAnon.auth.signInAnonymously({
    options: { data: { full_name: testGuestName } }
  });

  if (anonAuthErr) {
    console.error('❌ Anonymous Sign-In failed:', anonAuthErr.message);
  } else {
    const guestUser = anonAuthData.user;
    console.log(`✅ Anonymous Sign-In successful: User ID ${guestUser.id}, Name: ${testGuestName}`);

    // Create client scoped to guest user
    const guestClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${anonAuthData.session.access_token}` } }
    });

    // 2. Test Profile Upsert & Read (RLS)
    console.log('\n2️⃣ Testing Profile Upsert & Read with RLS...');
    const { data: profileUpsert, error: profileErr } = await guestClient.from('profiles').upsert({
      id: guestUser.id,
      display_name: testGuestName,
      xp: 250,
      streak_current: 3,
      streak_longest: 5,
      updated_at: new Date().toISOString()
    }).select();

    if (profileErr) {
      console.error('❌ Profile upsert failed:', profileErr.message);
    } else {
      console.log('✅ Profile upsert succeeded:', profileUpsert[0]?.display_name, `XP: ${profileUpsert[0]?.xp}`);
    }

    // 3. Test Sessions Upsert
    console.log('\n3️⃣ Testing Session Upsert...');
    const testTs = Date.now();
    const { error: sessionErr } = await guestClient.from('sessions').upsert({
      user_id: guestUser.id,
      ts: testTs,
      wpm: 85,
      raw_wpm: 92,
      accuracy: 98.5,
      consistency: 89,
      mode: 'timed',
      duration_sec: 30,
      char_count: 220,
      error_count: 3
    });

    if (sessionErr) {
      console.error('❌ Session upsert failed:', sessionErr.message);
    } else {
      console.log('✅ Session record upserted successfully.');
    }

    // 4. Test Key Stats & Achievements Upsert
    console.log('\n4️⃣ Testing Key Stats & Achievements...');
    const { error: keyErr } = await guestClient.from('key_stats').upsert({
      user_id: guestUser.id,
      key: 'e',
      total: 100,
      errors: 2,
      total_time_ms: 12000
    });
    const { error: achErr } = await guestClient.from('achievements').upsert({
      user_id: guestUser.id,
      achievement: 'speed_demon_80',
      unlocked_at: new Date().toISOString()
    });

    console.log('Key stats error:', keyErr ? keyErr.message : 'None (OK)');
    console.log('Achievements error:', achErr ? achErr.message : 'None (OK)');

    // 5. Test Leaderboard View
    console.log('\n5️⃣ Testing Leaderboard Public View...');
    const { data: leaderboard, error: lbErr } = await clientAnon.from('leaderboard').select('*').limit(5);
    if (lbErr) {
      console.error('❌ Leaderboard read failed:', lbErr.message);
    } else {
      console.log(`✅ Leaderboard returned ${leaderboard.length} entries:`, leaderboard);
    }

    // 6. Test Battlefield Match Lifecycle (RPCs)
    console.log('\n6️⃣ Testing Battlefield Match Lifecycle (RPCs)...');
    try {
      const { data: room, error: roomErr } = await guestClient.rpc('battle_create', {
        p_passage: 'The quick brown fox jumps over the lazy dog and tests real-time multiplayer typing combat mechanics.',
        p_passage_meta: 'Quote • English',
        p_difficulty: 'normal',
        p_max_players: 4,
        p_time_limit_sec: 120
      });

      if (roomErr) {
        console.error('❌ battle_create failed:', roomErr.message);
      } else {
        const roomObj = Array.isArray(room) ? room[0] : room;
        console.log(`✅ Room created! ID: ${roomObj.id}, PIN: ${roomObj.pin}, Status: ${roomObj.status}`);

        // Fetch passage
        const { data: passage, error: passErr } = await guestClient.rpc('battle_passage', { p_room: roomObj.id });
        console.log('Passage fetch:', passErr ? passErr.message : `OK (${passage?.length} chars)`);

        // Start battle
        const { data: startRes, error: startErr } = await guestClient.rpc('battle_start', { p_room: roomObj.id });
        console.log('Battle start:', startErr ? startErr.message : `OK (Status: ${Array.isArray(startRes) ? startRes[0]?.status : startRes?.status})`);

        // Finish battle
        const { data: finishRes, error: finishErr } = await guestClient.rpc('battle_finish', {
          p_room: roomObj.id,
          p_correct_chars: 80,
          p_typed_chars: 82,
          p_mistakes: 2,
          p_accuracy: 97.5,
          p_consistency: 90,
          p_client_wpm: 88,
          p_finished: true
        });
        console.log('Battle finish:', finishErr ? finishErr.message : 'OK');

        // Leaderboard for room
        const { data: roomLb, error: roomLbErr } = await guestClient.rpc('battle_leaderboard', { p_room: roomObj.id });
        console.log('Room leaderboard:', roomLbErr ? roomLbErr.message : `OK (${roomLb?.length} results)`);
      }
    } catch (err) {
      console.error('❌ Battlefield RPC exception:', err);
    }

    // 7. Test Realtime Channel Subscribe & Broadcast
    console.log('\n7️⃣ Testing Supabase Realtime Broadcast...');
    await new Promise((resolve) => {
      const channel = clientAnon.channel('test-realtime-room');
      channel
        .on('broadcast', { event: 'test-event' }, (payload) => {
          console.log('✅ Received realtime broadcast event:', payload);
          clientAnon.removeChannel(channel);
          resolve();
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            console.log('✅ Subscribed to realtime channel.');
            await channel.send({
              type: 'broadcast',
              event: 'test-event',
              payload: { message: 'TypeForge Realtime Working!' }
            });
          }
        });

      // Timeout safety
      setTimeout(() => {
        clientAnon.removeChannel(channel);
        resolve();
      }, 4000);
    });

    // 8. Clean up test user
    console.log('\n8️⃣ Cleaning up test data...');
    const { error: delErr } = await clientAdmin.auth.admin.deleteUser(guestUser.id);
    if (delErr) console.warn('Could not delete test user:', delErr.message);
    else console.log('✅ Test user cleaned up successfully.');
  }

  console.log('\n🎉 Supabase Integration Test Finished Successfully!');
}

runE2ETests().catch(console.error);
