import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
import { splitSql } from './sql-split.mjs';
try {
  if (!process.env.DATABASE_URL) throw new Error('Add DATABASE_URL to .env first.');
  const sql = neon(process.env.DATABASE_URL);
  const statements = [];
  for (const file of ['../server/schema.sql', '../server/analytics.sql']) {
    statements.push(...splitSql(await readFile(new URL(file, import.meta.url), 'utf8')));
  }
  await sql.transaction(statements.map(statement => sql.query(statement)));
  console.log('TRN database is ready (including website analytics).');
} catch (error) { console.error(process.env.DATABASE_URL ? `Database migration failed (${error.code || error.name}). Check the connection string and database access.` : error.message); process.exitCode = 1; }
