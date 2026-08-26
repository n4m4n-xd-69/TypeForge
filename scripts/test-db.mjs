import pg from 'pg';
import dns from 'node:dns';

const { Client } = pg;

const hosts = [
  'aws-0-ap-south-1.pooler.supabase.com',
  'aws-1-ap-south-1.pooler.supabase.com',
  'db.kavfjyvsvgvcjiuwwfbw.supabase.co',
];

async function checkDns() {
  for (const host of hosts) {
    try {
      const res = await dns.promises.lookup(host);
      console.log(`DNS lookup [${host}] ->`, res.address);
    } catch (e) {
      console.log(`DNS lookup [${host}] -> FAILED:`, e.message);
    }
  }
}

async function testConnection(host, port, user) {
  console.log(`Testing connection to ${host}:${port} as ${user}...`);
  const client = new Client({
    host,
    port,
    user,
    password: process.env.SUPABASE_DB_PASSWORD || '',
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log(`SUCCESS connected to ${host}:${port}`);
    const { rows } = await client.query('SELECT current_database(), current_user, version()');
    console.log('Query result:', rows[0]);
    await client.end();
    return true;
  } catch (err) {
    console.log(`FAILED connection to ${host}:${port} ->`, err.message);
    return false;
  }
}

async function run() {
  await checkDns();
  await testConnection('aws-0-ap-south-1.pooler.supabase.com', 5432, 'postgres.kavfjyvsvgvcjiuwwfbw');
  await testConnection('aws-0-ap-south-1.pooler.supabase.com', 6543, 'postgres.kavfjyvsvgvcjiuwwfbw');
}

run().catch(console.error);
