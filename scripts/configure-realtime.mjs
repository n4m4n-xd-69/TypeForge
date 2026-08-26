import pg from 'pg';

const { Client } = pg;

const client = new Client({
  host: process.env.SUPABASE_DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com',
  port: Number(process.env.SUPABASE_DB_PORT) || 5432,
  user: process.env.SUPABASE_DB_USER || 'postgres.kavfjyvsvgvcjiuwwfbw',
  password: process.env.SUPABASE_DB_PASSWORD || '',
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log('Checking publications...');
  const { rows: pubs } = await client.query(`
    SELECT pubname, schemaname, tablename 
    FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime';
  `);
  console.log('Tables in supabase_realtime:', pubs);

  const neededTables = ['battle_rooms', 'battle_players', 'battle_results', 'profiles'];
  for (const t of neededTables) {
    const exists = pubs.some(p => p.tablename === t);
    if (!exists) {
      console.log(`Adding table ${t} to supabase_realtime publication...`);
      try {
        await client.query(`ALTER PUBLICATION supabase_realtime ADD TABLE public.${t};`);
        console.log(`Added ${t} to supabase_realtime!`);
      } catch (err) {
        console.log(`Error adding ${t}:`, err.message);
      }
    }
  }

  // Also enable full replica identity on battle_rooms and battle_players so updates broadcast all columns
  console.log('Setting replica identities...');
  for (const t of ['battle_rooms', 'battle_players', 'battle_results']) {
    try {
      await client.query(`ALTER TABLE public.${t} REPLICA IDENTITY FULL;`);
      console.log(`Replica identity FULL set on ${t}`);
    } catch (err) {
      console.log(`Error setting replica identity on ${t}:`, err.message);
    }
  }

  const { rows: finalPubs } = await client.query(`
    SELECT pubname, schemaname, tablename 
    FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime';
  `);
  console.log('Final tables in supabase_realtime:', finalPubs);

  await client.end();
}

run().catch(console.error);
