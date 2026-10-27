import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
try {
  if (!process.env.DATABASE_URL) throw new Error('Add DATABASE_URL to .env first.');
  const sql = neon(process.env.DATABASE_URL);
  const statements = (await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8')).split(';').map(s => s.trim()).filter(Boolean);
  await sql.transaction(statements.map(s => sql.query(s)));
  console.log('TRN database is ready.');
} catch (error) { console.error(process.env.DATABASE_URL ? `Database migration failed (${error.code || error.name}). Check the connection string and database access.` : error.message); process.exitCode = 1; }
