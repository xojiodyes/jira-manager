/**
 * Data storage — PostgreSQL only.
 */

const SCHEMA = 'jiradashboard_owner';

function createDbStore(pool) {
  const S = SCHEMA;

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
        VALUES ($1, jsonb_build_object($2::text, $3::jsonb), NOW())
        ON CONFLICT (issue_key) DO UPDATE
        SET data = ${S}.issues.data || jsonb_build_object($2::text, $3::jsonb),
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

      const devRes = await pool.query(`SELECT issue_key, role, developers FROM ${S}.issue_developers`);
      const developers = {};
      for (const row of devRes.rows) {
        if (!developers[row.issue_key]) developers[row.issue_key] = {};
        developers[row.issue_key][row.role] = row.developers;
      }

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
          await client.query(`DELETE FROM ${S}.git_activity`);
          for (const [key, git] of Object.entries(gitResults)) {
            await client.query(`
              INSERT INTO ${S}.git_activity (issue_key, last_activity, pr_count, pr_merged, pr_open, repo_count, commit_count, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            `, [key, git.lastActivity || null, git.prCount || 0, git.prMerged || 0, git.prOpen || 0, git.repoCount || 0, git.commitCount || 0]);
          }
        }

        await client.query(`
          INSERT INTO ${S}.progress_metadata (key, value) VALUES ('lastRun', $1::jsonb)
          ON CONFLICT (key) DO UPDATE SET value = $1::jsonb
        `, [JSON.stringify(new Date().toISOString())]);

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

/**
 * In-memory store for mock/dev mode (no persistence).
 */
function createMemoryStore() {
  const issues = {};
  const history = [];
  let progressData = { snapshots: {}, gitActivity: {}, developers: {}, lastRun: null };

  return {
    type: 'memory',
    async getAllIssues() { return issues; },
    async getIssueField(issueKey, field) { return issues[issueKey]?.[field] ?? null; },
    async upsertIssueField(issueKey, field, value) {
      if (!issues[issueKey]) issues[issueKey] = {};
      issues[issueKey][field] = value;
    },
    async appendHistory(entry) { history.push(entry); },
    async getHistory(issueKey) {
      return issueKey ? history.filter(h => h.issueKey === issueKey) : history;
    },
    async getProgressData() { return progressData; },
    async saveSnapshotData({ dailyResults, gitResults, devResults, days, mode }) {
      const doTrend = mode === 'all' || mode === 'trend';
      const doGit = mode === 'all' || mode === 'git';
      if (doTrend) {
        for (const day of days) {
          if (!progressData.snapshots[day]) progressData.snapshots[day] = {};
          for (const [key, dailyMap] of Object.entries(dailyResults)) {
            if (dailyMap[day] !== undefined) {
              progressData.snapshots[day][key] = { progress: dailyMap[day] };
            }
          }
        }
        progressData.developers = devResults;
      }
      if (doGit) { progressData.gitActivity = gitResults; }
      progressData.lastRun = new Date().toISOString();
    },
    async close() {}
  };
}

/**
 * Create a store based on configuration.
 * PostgreSQL if configured, otherwise in-memory (for mock/dev).
 */
async function createStore(config) {
  const connStr = process.env.DATABASE_URL || config?.database?.connectionString;

  if (!connStr) {
    console.log('[DB] No database configured, using in-memory store');
    return createMemoryStore();
  }

  const { Pool } = require('./vendor/pg.bundle.js');
  const pool = new Pool({
    connectionString: connStr,
    max: 10,
    idleTimeoutMillis: 30000
  });

  const { runMigrations } = require('./migrations/migrate-lib');
  await runMigrations(pool);

  console.log('[DB] Connected to PostgreSQL');
  return createDbStore(pool);
}

module.exports = { createStore, createDbStore, SCHEMA };
