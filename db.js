/**
 * Data storage abstraction for jira-manager.
 * Supports two backends: file-based (JSON) and PostgreSQL.
 * Selected at startup based on DATABASE_URL or config.database.
 */

const fs = require('fs');
const path = require('path');

const SCHEMA = 'jiradashboard_owner';

// ============================================================
// FILE-BASED STORE (backward compatible, no DB required)
// ============================================================

function createFileStore() {
  const DATA_FILE = path.join(__dirname, 'data.json');
  const PROGRESS_FILE = path.join(__dirname, 'progress-history.json');

  // In-memory state
  let LOCAL_DATA = { issues: {}, history: [] };
  let PROGRESS_DATA = { snapshots: {}, lastRun: null };

  // Load from disk
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (raw.issues) {
      LOCAL_DATA = raw;
      if (!LOCAL_DATA.history) LOCAL_DATA.history = [];
    } else {
      LOCAL_DATA = { issues: raw, history: [] };
    }
  } catch (e) { /* file doesn't exist yet */ }

  try {
    PROGRESS_DATA = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    if (!PROGRESS_DATA.snapshots) PROGRESS_DATA.snapshots = {};
  } catch (e) { /* file doesn't exist yet */ }

  function saveLocalData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(LOCAL_DATA, null, 2), 'utf8');
  }

  function saveProgressData() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    for (const date of Object.keys(PROGRESS_DATA.snapshots)) {
      if (date < cutoffStr) delete PROGRESS_DATA.snapshots[date];
    }
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(PROGRESS_DATA, null, 2), 'utf8');
  }

  return {
    type: 'file',

    async getAllIssues() {
      return LOCAL_DATA.issues;
    },

    async getIssueField(issueKey, field) {
      return LOCAL_DATA.issues[issueKey]?.[field] ?? null;
    },

    async upsertIssueField(issueKey, field, value) {
      if (!LOCAL_DATA.issues[issueKey]) LOCAL_DATA.issues[issueKey] = {};
      LOCAL_DATA.issues[issueKey][field] = value;
      saveLocalData();
    },

    async appendHistory(entry) {
      LOCAL_DATA.history.push(entry);
      saveLocalData();
    },

    async getHistory(issueKey) {
      if (issueKey) {
        return LOCAL_DATA.history.filter(h => h.issueKey === issueKey);
      }
      return LOCAL_DATA.history;
    },

    async getProgressData() {
      return {
        snapshots: PROGRESS_DATA.snapshots,
        gitActivity: PROGRESS_DATA.gitActivity || {},
        developers: PROGRESS_DATA.developers || {},
        lastRun: PROGRESS_DATA.lastRun
      };
    },

    async saveSnapshotData({ dailyResults, gitResults, devResults, days, mode }) {
      const doTrend = mode === 'all' || mode === 'trend';
      const doGit = mode === 'all' || mode === 'git';

      if (doTrend) {
        for (const day of days) {
          if (!PROGRESS_DATA.snapshots[day]) PROGRESS_DATA.snapshots[day] = {};
          for (const [key, dailyMap] of Object.entries(dailyResults)) {
            if (dailyMap[day] !== undefined) {
              PROGRESS_DATA.snapshots[day][key] = { progress: dailyMap[day] };
            }
          }
        }
        PROGRESS_DATA.developers = devResults;
      }
      if (doGit) {
        PROGRESS_DATA.gitActivity = gitResults;
      }
      PROGRESS_DATA.lastRun = new Date().toISOString();
      saveProgressData();
    },

    async close() { /* noop for file store */ }
  };
}

// ============================================================
// POSTGRESQL STORE
// ============================================================

function createDbStore(pool) {
  const S = SCHEMA; // shorthand

  return {
    type: 'db',

    async getAllIssues() {
      const { rows } = await pool.query(`SELECT issue_key, data FROM ${S}.issues`);
      const result = {};
      for (const row of rows) {
        result[row.issue_key] = row.data;
      }
      return result;
    },

    async getIssueField(issueKey, field) {
      const { rows } = await pool.query(
        `SELECT data->$2 AS val FROM ${S}.issues WHERE issue_key = $1`,
        [issueKey, field]
      );
      if (rows.length === 0) return null;
      return rows[0].val ?? null;
    },

    async upsertIssueField(issueKey, field, value) {
      await pool.query(`
        INSERT INTO ${S}.issues (issue_key, data, updated_at)
        VALUES ($1, jsonb_build_object($2, $3::jsonb), NOW())
        ON CONFLICT (issue_key) DO UPDATE
        SET data = ${S}.issues.data || jsonb_build_object($2, $3::jsonb),
            updated_at = NOW()
      `, [issueKey, field, JSON.stringify(value)]);
    },

    async appendHistory(entry) {
      await pool.query(`
        INSERT INTO ${S}.issue_history (issue_key, field, old_value, new_value, username, created_at)
        VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
      `, [
        entry.issueKey,
        entry.field,
        entry.oldValue !== null && entry.oldValue !== undefined ? JSON.stringify(entry.oldValue) : null,
        entry.newValue !== null && entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
        entry.user,
        entry.timestamp
      ]);
    },

    async getHistory(issueKey) {
      let query, params;
      if (issueKey) {
        query = `
          SELECT issue_key AS "issueKey", field,
                 old_value AS "oldValue", new_value AS "newValue",
                 username AS "user", created_at AS "timestamp"
          FROM ${S}.issue_history
          WHERE issue_key = $1
          ORDER BY created_at ASC
        `;
        params = [issueKey];
      } else {
        query = `
          SELECT issue_key AS "issueKey", field,
                 old_value AS "oldValue", new_value AS "newValue",
                 username AS "user", created_at AS "timestamp"
          FROM ${S}.issue_history
          ORDER BY created_at ASC
        `;
        params = [];
      }
      const { rows } = await pool.query(query, params);
      return rows.map(r => ({
        ...r,
        timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp
      }));
    },

    async getProgressData() {
      // Snapshots
      const snapRes = await pool.query(`
        SELECT snapshot_date, issue_key, progress
        FROM ${S}.progress_snapshots
        WHERE snapshot_date >= NOW() - INTERVAL '60 days'
        ORDER BY snapshot_date
      `);
      const snapshots = {};
      for (const row of snapRes.rows) {
        const dateStr = row.snapshot_date instanceof Date
          ? row.snapshot_date.toISOString().slice(0, 10)
          : String(row.snapshot_date).slice(0, 10);
        if (!snapshots[dateStr]) snapshots[dateStr] = {};
        snapshots[dateStr][row.issue_key] = { progress: row.progress };
      }

      // Git activity
      const gitRes = await pool.query(`SELECT * FROM ${S}.git_activity`);
      const gitActivity = {};
      for (const row of gitRes.rows) {
        gitActivity[row.issue_key] = {
          lastActivity: row.last_activity
            ? (row.last_activity instanceof Date ? row.last_activity.toISOString().slice(0, 10) : String(row.last_activity).slice(0, 10))
            : null,
          prCount: row.pr_count,
          prMerged: row.pr_merged,
          prOpen: row.pr_open,
          repoCount: row.repo_count,
          commitCount: row.commit_count
        };
      }

      // Developers
      const devRes = await pool.query(`SELECT issue_key, role, developers FROM ${S}.issue_developers`);
      const developers = {};
      for (const row of devRes.rows) {
        if (!developers[row.issue_key]) developers[row.issue_key] = {};
        developers[row.issue_key][row.role] = row.developers;
      }

      // Last run
      const metaRes = await pool.query(`SELECT value FROM ${S}.progress_metadata WHERE key = 'lastRun'`);
      const lastRun = metaRes.rows.length > 0 ? metaRes.rows[0].value : null;

      return { snapshots, gitActivity, developers, lastRun };
    },

    async saveSnapshotData({ dailyResults, gitResults, devResults, days, mode }) {
      const doTrend = mode === 'all' || mode === 'trend';
      const doGit = mode === 'all' || mode === 'git';

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (doTrend) {
          // Batch upsert snapshots using UNNEST
          const dates = [], keys = [], progresses = [];
          for (const day of days) {
            for (const [key, dailyMap] of Object.entries(dailyResults)) {
              if (dailyMap[day] !== undefined) {
                dates.push(day);
                keys.push(key);
                progresses.push(Math.round(dailyMap[day]));
              }
            }
          }

          if (dates.length > 0) {
            await client.query(`
              INSERT INTO ${S}.progress_snapshots (snapshot_date, issue_key, progress)
              SELECT * FROM UNNEST($1::date[], $2::varchar[], $3::smallint[])
              ON CONFLICT (snapshot_date, issue_key) DO UPDATE SET progress = EXCLUDED.progress
            `, [dates, keys, progresses]);
          }

          // Replace developers: delete then insert
          await client.query(`DELETE FROM ${S}.issue_developers`);
          for (const [issueKey, roles] of Object.entries(devResults)) {
            for (const [role, devs] of Object.entries(roles)) {
              if (devs && devs.length > 0) {
                await client.query(
                  `INSERT INTO ${S}.issue_developers (issue_key, role, developers) VALUES ($1, $2, $3)`,
                  [issueKey, role, JSON.stringify(devs)]
                );
              }
            }
          }
        }

        if (doGit) {
          // Replace git activity
          await client.query(`DELETE FROM ${S}.git_activity`);
          for (const [key, git] of Object.entries(gitResults)) {
            await client.query(`
              INSERT INTO ${S}.git_activity (issue_key, last_activity, pr_count, pr_merged, pr_open, repo_count, commit_count, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            `, [key, git.lastActivity || null, git.prCount || 0, git.prMerged || 0, git.prOpen || 0, git.repoCount || 0, git.commitCount || 0]);
          }
        }

        // Update lastRun
        await client.query(`
          INSERT INTO ${S}.progress_metadata (key, value) VALUES ('lastRun', $1::jsonb)
          ON CONFLICT (key) DO UPDATE SET value = $1::jsonb
        `, [JSON.stringify(new Date().toISOString())]);

        // Prune old snapshots
        await client.query(`DELETE FROM ${S}.progress_snapshots WHERE snapshot_date < NOW() - INTERVAL '60 days'`);

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async close() {
      await pool.end();
    }
  };
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a store based on configuration.
 * If DATABASE_URL or config.database is set, uses PostgreSQL.
 * Otherwise, falls back to file-based storage.
 */
async function createStore(config) {
  const connStr = process.env.DATABASE_URL || config?.database?.connectionString;

  if (connStr) {
    const { Pool } = require('./vendor/pg.bundle.js');
    const pool = new Pool({
      connectionString: connStr,
      max: 10,
      idleTimeoutMillis: 30000
    });

    // Run migrations automatically on startup
    const { runMigrations } = require('./migrations/migrate-lib');
    await runMigrations(pool);

    console.log('[DB] Connected to PostgreSQL');
    return createDbStore(pool);
  }

  console.log('[DB] No database configured, using file storage');
  return createFileStore();
}

module.exports = { createStore, createFileStore, createDbStore, SCHEMA };
