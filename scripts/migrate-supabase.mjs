import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

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
  console.log('Connecting to Supabase Postgres (ap-south-1 session pooler)...');
  await client.connect();
  console.log('Connected successfully.');

  // Create a migrations tracking table if it doesn't exist
  await client.query(`
    CREATE TABLE IF NOT EXISTS public._schema_migrations (
      id serial PRIMARY KEY,
      name text UNIQUE NOT NULL,
      applied_at timestamptz DEFAULT now()
    );
  `);

  const { rows: appliedRows } = await client.query('SELECT name FROM public._schema_migrations');
  const appliedSet = new Set(appliedRows.map(r => r.name));

  const migrationsDir = path.resolve(process.cwd(), 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration files.`);

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`[SKIP] Migration already recorded: ${file}`);
      continue;
    }

    console.log(`[APPLYING] ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO public._schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[SUCCESS] Applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[FAILED] Error applying ${file}:`, err.message);
      throw err;
    }
  }

  console.log('All migrations applied successfully!');
  await client.end();
}

run().catch(err => {
  console.error('Migration runner failed:', err);
  process.exit(1);
});
