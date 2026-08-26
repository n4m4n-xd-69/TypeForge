import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://kavfjyvsvgvcjiuwwfbw.supabase.co';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function test() {
  console.log('Testing Supabase with anon key...');
  const supabaseAnon = createClient(url, anonKey);
  const { data: anonData, error: anonErr } = await supabaseAnon.from('profiles').select('*').limit(1);
  console.log('Anon profiles query result:', { anonData, anonErr });

  console.log('Testing Supabase with secret key...');
  const supabaseSecret = createClient(url, secretKey);
  const { data: secData, error: secErr } = await supabaseSecret.from('profiles').select('*').limit(1);
  console.log('Secret profiles query result:', { secData, secErr });
}

test().catch(console.error);
