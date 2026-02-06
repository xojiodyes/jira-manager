#!/usr/bin/env node
/**
 * CLI migration runner for jira-manager.
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@localhost:5432/dbname node migrations/migrate.js
 *   — or —
 *   Reads connectionString from config.json "database" block.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { runMigrations } = require('./migrate-lib');

function getConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const configPath = process.env.CONFIG || path.join(__dirname, '..', 'config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.database?.connectionString) return config.database.connectionString;
  } catch (e) { /* ignore */ }
  console.error('No DATABASE_URL env var and no database.connectionString in config.json');
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: getConnectionString() });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
