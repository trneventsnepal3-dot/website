import { createSync, TABLES } from '../server/sync.mjs';

const sync = createSync();
if (!sync.enabled) {
  console.error('Verification needs DATABASE_URL, SUPABASE_URL and SUPABASE_SECRET_KEY, with DB_SYNC_ENABLED not set to false.');
  process.exit(1);
}

const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const serialize = value => JSON.stringify(canonical(value));
const keyOf = (row, pk) => pk.map(column => String(row[column])).join('|');

const [supabase, neon] = await Promise.all([sync.snapshot('supabase'), sync.snapshot('neon')]);
let differences = 0;

for (const { name, pk } of TABLES) {
  const left = new Map(supabase[name].map(row => [keyOf(row, pk), row]));
  const right = new Map(neon[name].map(row => [keyOf(row, pk), row]));
  const issues = [];
  for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    if (!left.has(key)) issues.push(`missing in Supabase: ${key}`);
    else if (!right.has(key)) issues.push(`missing in Neon: ${key}`);
    else if (serialize(left.get(key)) !== serialize(right.get(key))) issues.push(`different values: ${key}`);
  }
  if (issues.length) {
    differences += issues.length;
    console.log(`${name}: ${issues.length} difference(s)`);
    for (const issue of issues.slice(0, 10)) console.log(`  - ${issue}`);
    if (issues.length > 10) console.log(`  ... and ${issues.length - 10} more`);
  } else {
    console.log(`${name}: ${left.size} row(s) match`);
  }
}

if (differences) {
  console.error(`\n${differences} difference(s) found. Run npm run db:sync to reconcile them.`);
  process.exitCode = 1;
} else {
  console.log('\nNeon and Supabase match: rows, revisions, media paths, sizes and URLs are identical.');
}
