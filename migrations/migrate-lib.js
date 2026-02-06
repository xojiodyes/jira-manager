/**
 * Migration runner library (shared between CLI and auto-run on startup).
 */

const fs = require('fs');
const path = require('path');

const SCHEMA = 'jiradashboard_owner';

async function runMigrations(pool) {
  // Ensure schema
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);

  // Ensure migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_migrations (
      version     VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  // Get already-applied migrations
  const { rows } = await pool.query(`SELECT version FROM ${SCHEMA}.schema_migrations`);
  const applied = new Set(rows.map(r => r.version));

  // Read migration .sql files
  const migrationsDir = __dirname;
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO ${SCHEMA}.schema_migrations (version) VALUES ($1)`,
        [file]
      );
      await client.query('COMMIT');
      console.log(`[Migration] Applied: ${file}`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[Migration] FAILED: ${file} — ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  }

  if (count === 0) {
    console.log('[Migration] All migrations already applied.');
  } else {
    console.log(`[Migration] Done. ${count} migration(s) applied.`);
  }
}

module.exports = { runMigrations };
