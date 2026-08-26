import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://kavfjyvsvgvcjiuwwfbw.supabase.co';
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(url, secretKey);

const tables = [
  'profiles',
  'sessions',
  'key_stats',
  'problem_progress',
  'achievements',
  'daily_stats',
  'user_roles',
  'auth_events',
  'ai_usage',
  'battle_rooms',
  'battle_passages',
  'battle_players',
  'battle_results',
  'battle_history',
];

async function check() {
  console.log('=== Checking Tables ===');
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.log(`Table [${table}]: ERROR ->`, error.message, error.code);
    } else {
      console.log(`Table [${table}]: OK (rows=${data.length})`);
    }
  }

  console.log('\n=== Checking Views ===');
  const { data: lbData, error: lbErr } = await supabase.from('leaderboard').select('*').limit(1);
  if (lbErr) console.log('View [leaderboard]: ERROR ->', lbErr.message);
  else console.log(`View [leaderboard]: OK (rows=${lbData.length})`);

  console.log('\n=== Checking RPC Functions ===');
  const rpcs = [
    'admin_user_overview',
    'admin_battle_overview',
  ];
  for (const rpc of rpcs) {
    const { data, error } = await supabase.rpc(rpc);
    if (error) {
      console.log(`RPC [${rpc}]: ERROR ->`, error.message, error.code);
    } else {
      console.log(`RPC [${rpc}]: OK`);
    }
  }
}

check().catch(console.error);
