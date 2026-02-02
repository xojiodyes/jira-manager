const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('./vendor/exceljs.bundle.js');

const { handleMockRequest } = require('./mock-data');

const PORT = process.env.PORT || 3000;
const MODE = process.env.MODE || 'mock'; // 'mock' or 'real'
const PUBLIC_DIR = path.join(__dirname, 'public');

// Load config for real mode
let CONFIG = null;
if (MODE === 'real') {
  const configPath = process.env.CONFIG || path.join(__dirname, 'config.json');
  try {
    CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // Support both 'jiraUser' and 'email' field names
    CONFIG.jiraUser = CONFIG.jiraUser || CONFIG.email;
    if (!CONFIG.jiraHost || !CONFIG.jiraUser || !CONFIG.apiToken) {
      console.error('config.json must contain: jiraHost, jiraUser, apiToken');
      process.exit(1);
    }
    // Normalize jiraHost: parse full URL to extract hostname + basePath
    // Supports: "domain.com", "https://domain.com", "https://domain.com/jira02"
    let hostRaw = CONFIG.jiraHost;
    if (!hostRaw.startsWith('http')) {
      hostRaw = 'https://' + hostRaw;
    }
    const parsedHost = new URL(hostRaw);
    CONFIG._hostname = parsedHost.hostname;
    CONFIG._port = parsedHost.port || (parsedHost.protocol === 'https:' ? 443 : 80);
    CONFIG._protocol = parsedHost.protocol;
    CONFIG._basePath = parsedHost.pathname.replace(/\/+$/, ''); // e.g. "/jira02" or ""
  } catch (err) {
    console.error(`Failed to read ${configPath}: ${err.message}`);
    console.error('Copy config.example.json to config.json and fill in your credentials.');
    process.exit(1);
  }
}

// Local data storage (status, confidence per issue) with history
const DATA_FILE = path.join(__dirname, 'data.json');
let LOCAL_DATA = { issues: {}, history: [] };
try {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  // Support migration from old flat format
  if (raw.issues) {
    LOCAL_DATA = raw;
    if (!LOCAL_DATA.history) LOCAL_DATA.history = [];
  } else {
    // Old format: flat { "KEY-1": { ... } } → migrate
    LOCAL_DATA = { issues: raw, history: [] };
  }
} catch (e) {
  // File doesn't exist yet — start empty
}

function saveLocalData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(LOCAL_DATA, null, 2), 'utf8');
}

function getCurrentUser() {
  if (CONFIG && CONFIG.jiraUser) return CONFIG.jiraUser;
  return 'mock-user';
}

// Progress history storage
const PROGRESS_FILE = path.join(__dirname, 'progress-history.json');
let PROGRESS_DATA = { snapshots: {}, lastRun: null };
try {
  PROGRESS_DATA = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  if (!PROGRESS_DATA.snapshots) PROGRESS_DATA.snapshots = {};
} catch (e) {
  // File doesn't exist yet
}

function saveProgressData() {
  // Prune to last 60 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (const date of Object.keys(PROGRESS_DATA.snapshots)) {
    if (date < cutoffStr) delete PROGRESS_DATA.snapshots[date];
  }
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(PROGRESS_DATA, null, 2), 'utf8');
}

// Status → Progress mapping (same as frontend App.STATUS_PROGRESS_MAP)
const STATUS_PROGRESS_MAP = {
  'open': 0, 'to do': 0, 'backlog': 0, 'new': 0, 'reopened': 0,
  'in development': 20, 'in progress': 20, 'dev': 20, 'in review': 20, 'review': 20, 'code review': 20,
  'qa': 40, 'in qa': 40, 'in testing': 40, 'testing': 40, 'ready for qa': 40,
  'uat': 60, 'in uat': 60, 'user acceptance': 60, 'ready for uat': 60,
  'uat done': 80, 'ready for prod': 80, 'ready for release': 80, 'ready for deploy': 80,
  'resolved': 100, 'closed': 100, 'done': 100, 'released': 100
};

function statusToProgress(statusName) {
  if (!statusName) return 0;
  const name = statusName.toLowerCase().trim();
  if (STATUS_PROGRESS_MAP.hasOwnProperty(name)) return STATUS_PROGRESS_MAP[name];
  for (const [key, val] of Object.entries(STATUS_PROGRESS_MAP)) {
    if (name.includes(key) || key.includes(name)) return val;
  }
  return 0;
}

// Server-side Jira API fetch
function jiraFetch(apiPath, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    if (MODE === 'mock') {
      const qIdx = apiPath.indexOf('?');
      const mockPath = qIdx >= 0 ? apiPath.substring(0, qIdx) : apiPath;
      const mockSearch = qIdx >= 0 ? apiPath.substring(qIdx) : '';
      const result = handleMockRequest(mockPath, mockSearch, method, body);
      if (result.status >= 400) return reject(new Error(JSON.stringify(result.body)));
      return resolve(result.body);
    }
    if (!CONFIG) return reject(new Error('No Jira config'));

    const auth = 'Basic ' + Buffer.from(CONFIG.jiraUser + ':' + CONFIG.apiToken).toString('base64');
    const fullPath = CONFIG._basePath + apiPath;
    const useHttps = CONFIG._protocol === 'https:';
    const httpModule = useHttps ? https : http;

    const options = {
      hostname: CONFIG._hostname,
      port: CONFIG._port,
      path: fullPath,
      method,
      rejectUnauthorized: false,
      headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'Accept': 'application/json' }
    };

    const isDevStatus = apiPath.includes('dev-status');
    if (isDevStatus) {
      console.log(`[jiraFetch] ${method} ${CONFIG._protocol}//${CONFIG._hostname}:${CONFIG._port}${fullPath}`);
    }

    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (isDevStatus) {
          console.log(`[jiraFetch] Response status=${res.statusCode}, body=${data.substring(0, 500)}`);
        }
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', (err) => {
      if (isDevStatus) console.log(`[jiraFetch] Request error: ${err.message}`);
      reject(err);
    });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function jiraSearch(jql, maxResults = 200) {
  const fields = 'summary,status,assignee,priority,issuetype,project,labels,issuelinks,duedate,resolution,customfield_18801,customfield_10002';
  const params = new URLSearchParams({ jql, startAt: 0, maxResults, fields });
  return jiraFetch(`/rest/api/2/search?${params}`);
}

async function jiraGetIssue(key, expandChangelog = false) {
  const expand = expandChangelog ? '?expand=changelog' : '';
  return jiraFetch(`/rest/api/2/issue/${key}${expand}`);
}

function extractLinkedKeys(issue, excludeClones = true) {
  const EXCLUDED = ['cloners', 'duplicate'];
  const keys = [];
  for (const link of (issue.fields?.issuelinks || [])) {
    if (excludeClones) {
      const typeName = (link.type?.name || '').toLowerCase();
      if (EXCLUDED.some(ex => typeName.includes(ex))) continue;
    }
    if (link.outwardIssue) keys.push(link.outwardIssue.key);
    if (link.inwardIssue) keys.push(link.inwardIssue.key);
  }
  return keys;
}

function extractOutwardKeys(issue) {
  const EXCLUDED = ['cloners', 'duplicate'];
  const keys = [];
  for (const link of (issue.fields?.issuelinks || [])) {
    const typeName = (link.type?.name || '').toLowerCase();
    if (EXCLUDED.some(ex => typeName.includes(ex))) continue;
    if (link.outwardIssue) keys.push(link.outwardIssue.key);
  }
  return keys;
}

// Fetch git dev-status for an issue (Jira Data Center)
// Returns structured object: { lastActivity, prCount, prMerged, prOpen, repoCount, commitCount }
async function fetchDevStatus(issueId) {
  console.log(`[DevStatus] Fetching dev-status for issueId=${issueId}`);

  // Step 1: Try summary API first (this is what Jira UI uses)
  const summaryApis = [
    `/rest/dev-status/1.0/issue/summary?issueId=${issueId}`,
    `/rest/dev-status/latest/issue/summary?issueId=${issueId}`,
  ];

  for (const summaryApi of summaryApis) {
    try {
      console.log(`[DevStatus]   trying summary: ${summaryApi}`);
      const summary = await jiraFetch(summaryApi);
      console.log(`[DevStatus]   summary response: ${JSON.stringify(summary).substring(0, 800)}`);

      const prInfo = summary?.summary?.pullrequest;
      const commitInfo = summary?.summary?.commit;
      const repoInfo = summary?.summary?.repository;
      const prCount = prInfo?.overall?.count || prInfo?.count || 0;
      const commitCount = commitInfo?.overall?.count || commitInfo?.count || 0;
      const repoCount = repoInfo?.overall?.count || repoInfo?.count || 0;
      const totalActivity = prCount + commitCount + repoCount;
      console.log(`[DevStatus]   summary: ${commitCount} commits, ${prCount} PRs, ${repoCount} repos`);

      if (totalActivity > 0) {
        // Extract PR details
        const prDetails = prInfo?.overall?.details || {};
        const prMerged = prDetails.mergedCount || 0;
        const prOpen = prDetails.openCount || 0;

        // Find most recent lastUpdated across all sections
        const dates = [];
        const prLast = prInfo?.overall?.lastUpdated || prInfo?.lastUpdated;
        const commitLast = commitInfo?.overall?.lastUpdated || commitInfo?.lastUpdated;
        const repoLast = repoInfo?.overall?.lastUpdated || repoInfo?.lastUpdated;
        if (prLast) dates.push(prLast);
        if (commitLast) dates.push(commitLast);
        if (repoLast) dates.push(repoLast);

        const lastActivity = dates.length > 0
          ? dates.sort().reverse()[0].slice(0, 10)
          : null;

        const result = { lastActivity, prCount, prMerged, prOpen, repoCount, commitCount };
        console.log(`[DevStatus]   ✓ Result: ${JSON.stringify(result)}`);
        return result;
      }
      break;
    } catch (e) {
      console.log(`[DevStatus]   summary error: ${e.message.substring(0, 200)}`);
    }
  }

  // Step 2: If summary didn't work, try detail directly
  const detailResult = await fetchDevStatusDetail(issueId);
  if (detailResult) return detailResult;

  console.log(`[DevStatus]   ✗ No activity found for issueId=${issueId}`);
  return null;
}

// Try all detail API variants
async function fetchDevStatusDetail(issueId) {
  const detailApis = [
    `/rest/dev-status/1.0/issue/detail?issueId=${issueId}&applicationType=stash&dataType=repository`,
    `/rest/dev-status/1.0/issue/detail?issueId=${issueId}&applicationType=bitbucket&dataType=repository`,
    `/rest/dev-status/1.0/issue/detail?issueId=${issueId}&applicationType=github&dataType=repository`,
    `/rest/dev-status/latest/issue/detail?issueId=${issueId}&applicationType=stash&dataType=repository`,
    `/rest/dev-status/latest/issue/detail?issueId=${issueId}&applicationType=bitbucket&dataType=repository`,
    `/rest/dev-status/latest/issue/detail?issueId=${issueId}&applicationType=github&dataType=repository`,
  ];

  for (const apiPath of detailApis) {
    const appType = apiPath.match(/applicationType=(\w+)/)?.[1];
    const version = apiPath.includes('latest') ? 'latest' : '1.0';
    try {
      console.log(`[DevStatus]   detail ${version}/${appType}`);
      const data = await jiraFetch(apiPath);

      if (!data?.detail || data.detail.length === 0) {
        console.log(`[DevStatus]     → empty detail`);
        continue;
      }

      for (const entry of data.detail) {
        const instanceName = entry.instance?.name || entry._instance?.name || 'unknown';
        const instanceType = entry.instance?.type || entry._instance?.typeName || 'unknown';

        if (entry.error) {
          console.log(`[DevStatus]     → "${instanceName}" (${instanceType}): ERROR "${entry.error}"`);
          continue;
        }

        const repos = entry.repositories || [];
        const detailCommitCount = repos.reduce((s, r) => s + (r.commits || []).length, 0);
        console.log(`[DevStatus]     → "${instanceName}": ${repos.length} repos, ${detailCommitCount} commits`);

        if (detailCommitCount > 0 || repos.length > 0) {
          // Find latest commit date
          let latestDate = null;
          for (const repo of repos) {
            for (const commit of (repo.commits || [])) {
              const ts = commit.authorTimestamp || commit.timestamp || '';
              if (ts) {
                const d = new Date(ts).toISOString().slice(0, 10);
                if (!latestDate || d > latestDate) latestDate = d;
              }
            }
          }
          const result = {
            lastActivity: latestDate,
            prCount: 0, prMerged: 0, prOpen: 0,
            repoCount: repos.length,
            commitCount: detailCommitCount
          };
          console.log(`[DevStatus]   ✓ Found via detail ${version}/${appType}: ${JSON.stringify(result)}`);
          return result;
        }
      }
    } catch (e) {
      console.log(`[DevStatus]     → error: ${e.message.substring(0, 150)}`);
    }
  }
  return null;
}

// Aggregate git activity from children: take freshest lastActivity, sum counts
function aggregateGitActivity(childGitData) {
  const result = { lastActivity: null, prCount: 0, prMerged: 0, prOpen: 0, repoCount: 0, commitCount: 0 };
  for (const git of childGitData) {
    if (!git) continue;
    if (git.lastActivity && (!result.lastActivity || git.lastActivity > result.lastActivity)) {
      result.lastActivity = git.lastActivity;
    }
    result.prCount += git.prCount || 0;
    result.prMerged += git.prMerged || 0;
    result.prOpen += git.prOpen || 0;
    result.repoCount += git.repoCount || 0;
    result.commitCount += git.commitCount || 0;
  }
  return result.lastActivity ? result : null;
}

// Map Jira status to role
function statusToRole(statusName) {
  if (!statusName) return 'BA';
  const s = statusName.toLowerCase();
  if (s === 'in progress' || s === 'in development' || s === 'development') return 'Dev';
  if (s === 'code review' || s === 'in review' || s === 'review') return 'Dev';
  if (s === 'qa' || s === 'in qa' || s === 'testing' || s === 'in testing' || s === 'test') return 'QA';
  if (s === 'done' || s === 'closed' || s === 'resolved') return null; // skip Done phase
  // Everything before dev phase: To Do, Open, Backlog, New, Analysis, etc.
  return 'BA';
}

// Extract developers with roles from changelog (last 30 days)
// Returns { BA: [...], Dev: [{ displayName, avatarUrl }], QA: [...] }
function extractDevelopers(issue) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString();

  const histories = issue.changelog?.histories || [];
  // Sort by created ascending
  const sorted = [...histories].sort((a, b) => (a.created || '').localeCompare(b.created || ''));

  // Build timeline of status changes and assignee changes
  let currentStatus = null;
  // Find initial status: look at first status change's fromString
  for (const h of sorted) {
    for (const item of (h.items || [])) {
      if (item.field === 'status') {
        currentStatus = item.fromString;
        break;
      }
    }
    if (currentStatus) break;
  }
  // If no status changes in changelog, use current status
  if (!currentStatus) {
    currentStatus = issue.fields?.status?.name || null;
  }

  // roleMap: key = displayName, value = { displayName, avatarUrl, roles: Set }
  const roleMap = {};

  function addPerson(name, avatarUrl, role) {
    if (!name || !role) return;
    if (!roleMap[name]) {
      roleMap[name] = { displayName: name, avatarUrl: avatarUrl || '', roles: new Set() };
    }
    roleMap[name].roles.add(role);
  }

  // Walk through changelog chronologically
  for (const h of sorted) {
    const inRange = h.created && h.created >= cutoffStr;

    for (const item of (h.items || [])) {
      // Track status changes
      if (item.field === 'status') {
        currentStatus = item.toString;
      }

      // When assignee changes, the NEW assignee gets the role based on current status
      if (item.field === 'assignee' && inRange && item.to) {
        const role = statusToRole(currentStatus);
        // We have toString = new assignee displayName
        // But we don't have avatar from changelog item, try h.author as fallback
        addPerson(item.toString, '', role);
      }
    }
  }

  // Current assignee gets role based on current issue status
  const assignee = issue.fields?.assignee;
  const curStatus = issue.fields?.status?.name;
  if (assignee?.displayName) {
    const role = statusToRole(curStatus);
    addPerson(assignee.displayName, assignee.avatarUrls?.['24x24'] || '', role);
  }

  // Build result grouped by role
  const result = {};
  for (const person of Object.values(roleMap)) {
    for (const role of person.roles) {
      if (!result[role]) result[role] = [];
      result[role].push({ displayName: person.displayName, avatarUrl: person.avatarUrl });
    }
  }

  return result;
}

// Aggregate developers from children: union per role
function aggregateDevelopers(childDevLists) {
  const roleMap = {}; // role -> { name -> { displayName, avatarUrl } }
  for (const devsByRole of childDevLists) {
    for (const [role, devs] of Object.entries(devsByRole)) {
      if (!roleMap[role]) roleMap[role] = {};
      for (const dev of devs) {
        if (dev.displayName) {
          roleMap[role][dev.displayName] = dev;
        }
      }
    }
  }
  const result = {};
  for (const [role, map] of Object.entries(roleMap)) {
    result[role] = Object.values(map);
  }
  return result;
}

// Build array of last N dates as YYYY-MM-DD strings
function getLast60Days() {
  const days = [];
  const now = new Date();
  for (let i = 59; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// Reconstruct daily status from Jira changelog
// Returns { "YYYY-MM-DD": progressValue } for last 60 days
function buildDailyProgress(issue, days) {
  const currentStatus = issue.fields?.status?.name || 'Open';
  const createdDate = (issue.fields?.created || '').slice(0, 10);

  // Build status timeline from changelog
  // Each entry: { date: "YYYY-MM-DD", statusTo: "In Progress" }
  const statusChanges = [];
  const changelog = issue.changelog;
  if (changelog && changelog.histories) {
    for (const history of changelog.histories) {
      const date = (history.created || '').slice(0, 10);
      for (const item of (history.items || [])) {
        if (item.field === 'status') {
          statusChanges.push({ date, statusFrom: item.fromString, statusTo: item.toString });
        }
      }
    }
  }
  // Sort by date ascending
  statusChanges.sort((a, b) => a.date.localeCompare(b.date));

  // Walk through days, tracking current status
  const result = {};
  // Determine initial status (before any changes in our window)
  let runningStatus = currentStatus;
  if (statusChanges.length > 0) {
    // The status before the first change is statusFrom of the first change
    runningStatus = statusChanges[0].statusFrom || currentStatus;
  }

  let changeIdx = 0;
  for (const day of days) {
    // Apply any status changes on this day
    while (changeIdx < statusChanges.length && statusChanges[changeIdx].date <= day) {
      runningStatus = statusChanges[changeIdx].statusTo;
      changeIdx++;
    }
    // Only record progress from the issue's creation date onward
    if (day >= createdDate) {
      result[day] = statusToProgress(runningStatus);
    }
  }

  return result;
}

// Compute average daily progress from multiple children's daily maps
function averageDailyProgress(childrenDailyMaps, days) {
  const result = {};
  for (const day of days) {
    const values = childrenDailyMaps
      .map(m => m[day])
      .filter(v => v !== undefined);
    if (values.length > 0) {
      result[day] = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    }
  }
  return result;
}

// Snapshot state for SSE progress reporting
let snapshotState = { running: false, phase: '', current: 0, total: 0, message: '', done: false, totalIssues: 0, error: null };
const sseClients = [];

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch (e) {}
  }
}

async function computeSnapshot(baseJql, mode = 'all') {
  const doTrend = mode === 'all' || mode === 'trend';
  const doGit = mode === 'all' || mode === 'git';
  if (snapshotState.running) return;
  snapshotState = { running: true, phase: 'themes', current: 0, total: 0, message: 'Starting...', done: false, totalIssues: 0, error: null };
  broadcastSSE(snapshotState);

  const days = getLast60Days();
  // dailyResults[issueKey] = { "YYYY-MM-DD": progress, ... }
  const dailyResults = {};
  // gitResults[issueKey] = { lastActivity, prCount, prMerged, prOpen, repoCount, commitCount }
  const gitResults = {};
  // devResults[issueKey] = [{ displayName, avatarUrl }]
  const devResults = {};

  try {
    snapshotState.phase = 'themes';
    snapshotState.message = 'Loading themes...';
    broadcastSSE(snapshotState);

    const themesJql = baseJql
      ? `labels = theme AND ${baseJql}`
      : 'labels = theme';
    const themesData = await jiraSearch(themesJql);
    const themes = themesData.issues || [];
    snapshotState.total = themes.length;

    for (let ti = 0; ti < themes.length; ti++) {
      const theme = themes[ti];
      snapshotState.current = ti + 1;
      snapshotState.message = `Theme ${theme.key} (${ti + 1}/${themes.length})`;
      broadcastSSE(snapshotState);

      const themeIssue = await jiraGetIssue(theme.key);
      const milestoneLinkedKeys = extractLinkedKeys(themeIssue);
      const milestoneDailyMaps = [];
      const milestoneGitData = [];

      if (milestoneLinkedKeys.length > 0) {
        const msJql = `key in (${milestoneLinkedKeys.join(',')}) AND labels = milestone ORDER BY updated DESC`;
        const msData = await jiraSearch(msJql);
        const milestones = msData.issues || [];

        for (const milestone of milestones) {
          snapshotState.message = `${theme.key} → ${milestone.key}`;
          broadcastSSE(snapshotState);

          const msIssue = await jiraGetIssue(milestone.key);
          const epicLinkedKeys = extractLinkedKeys(msIssue);
          const epicDailyMaps = [];
          const epicGitData = [];

          if (epicLinkedKeys.length > 0) {
            const epJql = `key in (${epicLinkedKeys.join(',')}) AND (labels is EMPTY OR (labels != theme AND labels != milestone)) ORDER BY updated DESC`;
            const epData = await jiraSearch(epJql);
            const epics = epData.issues || [];

            for (const epic of epics) {
              snapshotState.message = `${theme.key} → ${milestone.key} → ${epic.key}`;
              broadcastSSE(snapshotState);

              const epicIssue = await jiraGetIssue(epic.key, doTrend); // with changelog only for trend
              const childOutwardKeys = extractOutwardKeys(epicIssue);

              if (childOutwardKeys.length > 0) {
                const chJql = `key in (${childOutwardKeys.join(',')}) AND (labels is EMPTY OR (labels != theme AND labels != milestone)) ORDER BY updated DESC`;
                const chData = await jiraSearch(chJql);
                const children = chData.issues || [];
                const childDailyMaps = [];

                const childGitList = [];
                const childDevLists = [];
                for (const child of children) {
                  // Get issue with changelog for backfill
                  const childFull = doTrend ? await jiraGetIssue(child.key, true) : child;
                  if (doTrend) {
                    const childDaily = buildDailyProgress(childFull, days);
                    dailyResults[child.key] = childDaily;
                    childDailyMaps.push(childDaily);

                    // Extract developers for leaf issue
                    const devs = extractDevelopers(childFull);
                    if (Object.keys(devs).length > 0) {
                      devResults[child.key] = devs;
                      childDevLists.push(devs);
                    }
                  }

                  // Fetch git dev-status for leaf issue
                  if (doGit) {
                    try {
                      const childId = child.id || childFull.id;
                      console.log(`[Snapshot] Fetching dev-status for leaf ${child.key} (id=${childId})`);
                      const git = await fetchDevStatus(childId);
                      if (git) {
                        console.log(`[Snapshot] ${child.key}: git activity found, last=${git.lastActivity}`);
                        gitResults[child.key] = git;
                        childGitList.push(git);
                      }
                    } catch (e) {
                      console.log(`[Snapshot] ${child.key}: dev-status error: ${e.message}`);
                    }
                  }

                  snapshotState.totalIssues++;
                }

                if (doTrend) {
                  const epicDaily = averageDailyProgress(childDailyMaps, days);
                  dailyResults[epic.key] = epicDaily;
                  epicDailyMaps.push(epicDaily);
                }

                // Aggregate git for epic
                if (doGit && childGitList.length > 0) {
                  const epicGit = aggregateGitActivity(childGitList);
                  if (epicGit) {
                    gitResults[epic.key] = epicGit;
                    epicGitData.push(epicGit);
                  }
                }
                // Aggregate developers for epic
                if (doTrend && childDevLists.length > 0) {
                  devResults[epic.key] = aggregateDevelopers(childDevLists);
                }
              } else {
                if (doTrend) {
                  // Leaf story/task — build daily progress
                  const epicDaily = buildDailyProgress(epicIssue, days);
                  dailyResults[epic.key] = epicDaily;
                  epicDailyMaps.push(epicDaily);

                  // Extract developers for leaf epic
                  const devs = extractDevelopers(epicIssue);
                  if (Object.keys(devs).length > 0) devResults[epic.key] = devs;
                }

                if (doGit) {
                  try {
                    console.log(`[Snapshot] Fetching dev-status for leaf epic/story ${epic.key} (id=${epic.id || epicIssue.id})`);
                    const git = await fetchDevStatus(epic.id || epicIssue.id);
                    if (git) {
                      console.log(`[Snapshot] ${epic.key}: git activity found, last=${git.lastActivity}`);
                      gitResults[epic.key] = git;
                      epicGitData.push(git);
                    }
                  } catch (e) {
                    console.log(`[Snapshot] ${epic.key}: dev-status error: ${e.message}`);
                  }
                }
              }
              snapshotState.totalIssues++;
            }
          }

          if (doTrend) {
            const msDaily = averageDailyProgress(epicDailyMaps, days);
            dailyResults[milestone.key] = msDaily;
            milestoneDailyMaps.push(msDaily);
          }

          // Aggregate git for milestone
          if (doGit && epicGitData.length > 0) {
            const msGit = aggregateGitActivity(epicGitData);
            if (msGit) {
              gitResults[milestone.key] = msGit;
              milestoneGitData.push(msGit);
            }
          }
          // Aggregate developers for milestone (from all epic keys that have devResults)
          if (doTrend) {
            const msEpicDevLists = epicLinkedKeys.map(k => devResults[k]).filter(Boolean);
            if (msEpicDevLists.length > 0) {
              devResults[milestone.key] = aggregateDevelopers(msEpicDevLists);
            }
          }

          snapshotState.totalIssues++;
        }
      }

      if (doTrend) {
        const themeDaily = averageDailyProgress(milestoneDailyMaps, days);
        dailyResults[theme.key] = themeDaily;
      }

      // Aggregate git for theme
      if (doGit && milestoneGitData.length > 0) {
        const themeGit = aggregateGitActivity(milestoneGitData);
        if (themeGit) gitResults[theme.key] = themeGit;
      }
      // Aggregate developers for theme
      if (doTrend) {
        const themeMsDevLists = (milestoneLinkedKeys.length > 0 ? milestoneLinkedKeys : []).map(k => devResults[k]).filter(Boolean);
        if (themeMsDevLists.length > 0) {
          devResults[theme.key] = aggregateDevelopers(themeMsDevLists);
        }
      }

      snapshotState.totalIssues++;
    }

    // Save: merge daily results into snapshots (one entry per date per issue)
    if (doTrend) {
      for (const day of days) {
        if (!PROGRESS_DATA.snapshots[day]) PROGRESS_DATA.snapshots[day] = {};
        for (const [key, dailyMap] of Object.entries(dailyResults)) {
          if (dailyMap[day] !== undefined) {
            const entry = { progress: dailyMap[day] };
            PROGRESS_DATA.snapshots[day][key] = entry;
          }
        }
      }
      PROGRESS_DATA.developers = devResults;
    }
    // Save git activity (not per-day, just latest state)
    if (doGit) {
      PROGRESS_DATA.gitActivity = gitResults;
    }
    PROGRESS_DATA.lastRun = new Date().toISOString();
    saveProgressData();

    snapshotState.phase = 'done';
    snapshotState.message = `Done. ${snapshotState.totalIssues} issues processed.`;
    snapshotState.done = true;
    snapshotState.running = false;
    broadcastSSE(snapshotState);
  } catch (err) {
    snapshotState.phase = 'error';
    snapshotState.message = err.message;
    snapshotState.error = err.message;
    snapshotState.running = false;
    broadcastSSE(snapshotState);
    console.error('Snapshot error:', err);
  }
}

// === ROADMAP EXCEL EXPORT ===

// Theme accent colors (16 colors)
const DB_ACCENTS = [
  'FF4A90D9', 'FF7B68EE', 'FFFF6B6B', 'FF51CF66',
  'FFFFD43B', 'FFFF922B', 'FF20C997', 'FFCC5DE8',
  'FF339AF0', 'FF38D9A9', 'FFFF8787', 'FF748FFC',
  'FFFF6348', 'FF2ED573', 'FFECCC68', 'FFA29BFE'
];
// Pastel variants for milestone cells
const DB_ACCENTS_1 = [
  'FFDBE9F8', 'FFE3DEFE', 'FFFFE0E0', 'FFDDF5E4',
  'FFFFF3CD', 'FFFFF0E0', 'FFD5F5EC', 'FFF3E5FA',
  'FFD9ECFF', 'FFD5F5EB', 'FFFFE0E0', 'FFE1E5FF',
  'FFFFE4DE', 'FFD4F5E0', 'FFFFF8DD', 'FFE9E7FE'
];

function addMonths(d, n) {
  const result = new Date(d);
  result.setMonth(result.getMonth() + n);
  return result;
}

function quarterStartFor(d) {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

function nextQuarterStartOnOrAfter(d) {
  const qs = quarterStartFor(d);
  if (d.getTime() === qs.getTime()) return d;
  return addMonths(qs, 3);
}

function formatMonthLabel(d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatQuarterLabel(d) {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

function buildTimeBuckets() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), 1); // start of current month
  const buckets = [];

  // 3 months
  for (let i = 0; i < 3; i++) {
    const start = addMonths(today, i);
    const end = addMonths(start, 1);
    end.setDate(end.getDate() - 1);
    buckets.push({ label: formatMonthLabel(start), start, end, type: 'month' });
  }

  // 3 quarters (starting from the quarter after the last month)
  let qStart = nextQuarterStartOnOrAfter(addMonths(today, 3));
  for (let i = 0; i < 3; i++) {
    const qEnd = addMonths(qStart, 3);
    qEnd.setDate(qEnd.getDate() - 1);
    buckets.push({ label: formatQuarterLabel(qStart), start: qStart, end: qEnd, type: 'quarter' });
    qStart = addMonths(qStart, 3);
  }

  // Next year catch-all
  const nextYearStart = new Date(qStart); // after last quarter
  buckets.push({ label: `${nextYearStart.getFullYear()}+`, start: nextYearStart, end: new Date(2099, 11, 31), type: 'year' });

  return buckets;
}

function findBucketIndex(targetDate, buckets) {
  if (!targetDate) return -1;
  const d = new Date(targetDate);
  for (let i = 0; i < buckets.length; i++) {
    if (d >= buckets[i].start && d <= buckets[i].end) return i;
  }
  // If before first bucket, return -1 (skip)
  if (d < buckets[0].start) return -1;
  // If after last bucket, put in last bucket
  return buckets.length - 1;
}

function applyOuterBorder(ws, startRow, startCol, endRow, endCol) {
  const thin = { style: 'thin', color: { argb: 'FF999999' } };
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const cell = ws.getCell(r, c);
      const border = {};
      if (r === startRow) border.top = thin;
      if (r === endRow) border.bottom = thin;
      if (c === startCol) border.left = thin;
      if (c === endCol) border.right = thin;
      cell.border = { ...cell.border, ...border };
    }
  }
}

async function generateRoadmapExcel(baseJql) {
  const buckets = buildTimeBuckets();

  // Column layout: A=empty(1), B=Theme(2), C=Resources(3), D..=buckets
  const THEME_COL = 2;
  const RESOURCES_COL = 3;
  const FIRST_BUCKET_COL = 4;

  // Fetch themes
  const themesJql = baseJql
    ? `labels = theme AND ${baseJql}`
    : 'labels = theme';
  const themesData = await jiraSearch(themesJql);
  const themes = themesData.issues || [];

  // For each theme, fetch milestones
  const themeDataList = [];
  for (const theme of themes) {
    const themeIssue = await jiraGetIssue(theme.key);
    const links = themeIssue.fields?.issuelinks || [];
    const EXCLUDED = ['cloners', 'duplicate'];
    const linkedKeys = [];
    for (const link of links) {
      const typeName = (link.type?.name || '').toLowerCase();
      if (EXCLUDED.some(ex => typeName.includes(ex))) continue;
      if (link.outwardIssue) linkedKeys.push(link.outwardIssue.key);
      if (link.inwardIssue) linkedKeys.push(link.inwardIssue.key);
    }

    let milestones = [];
    if (linkedKeys.length > 0) {
      const msJql = `key in (${linkedKeys.join(',')}) AND labels = milestone ORDER BY updated DESC`;
      const msData = await jiraSearch(msJql);
      milestones = msData.issues || [];
    }

    // For each milestone, compute target date
    const msWithDates = milestones.map(ms => {
      const f = ms.fields;
      // Priority: EstimatedDate → DueDate → fallback 2027-06-30
      const estimatedDate = f.customfield_18801 || null;
      const dueDate = f.duedate || null;
      const targetDate = estimatedDate || dueDate || '2027-06-30';
      const resources = f.customfield_10002 || '';
      const isResolved = f.resolution !== null && f.resolution !== undefined;
      return {
        key: ms.key,
        summary: f.summary || ms.key,
        targetDate,
        resources: resources ? String(resources) : '',
        isResolved,
        status: f.status?.name || ''
      };
    });

    themeDataList.push({
      key: theme.key,
      summary: theme.fields.summary || theme.key,
      milestones: msWithDates
    });
  }

  // Sort themes by summary
  themeDataList.sort((a, b) => a.summary.localeCompare(b.summary));

  // Create workbook
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Projects');
  ws.views = [{ state: 'frozen', xSplit: RESOURCES_COL, ySplit: 1 }];

  // Column widths
  ws.getColumn(1).width = 3;    // spacer
  ws.getColumn(THEME_COL).width = 40;
  ws.getColumn(RESOURCES_COL).width = 10;
  for (let i = 0; i < buckets.length; i++) {
    ws.getColumn(FIRST_BUCKET_COL + i).width = 40;
  }

  // Header row
  const headerRow = ws.getRow(1);
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
  const headerFont = { bold: true, size: 11 };

  ws.getCell(1, THEME_COL).value = 'Theme';
  ws.getCell(1, THEME_COL).fill = headerFill;
  ws.getCell(1, THEME_COL).font = headerFont;

  ws.getCell(1, RESOURCES_COL).value = 'Res';
  ws.getCell(1, RESOURCES_COL).fill = headerFill;
  ws.getCell(1, RESOURCES_COL).font = headerFont;

  for (let i = 0; i < buckets.length; i++) {
    const cell = ws.getCell(1, FIRST_BUCKET_COL + i);
    cell.value = buckets[i].label;
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { horizontal: 'center' };
  }

  // Write themes and milestones
  let currentRow = 2;
  const totalCols = FIRST_BUCKET_COL + buckets.length - 1;

  for (let ti = 0; ti < themeDataList.length; ti++) {
    const theme = themeDataList[ti];
    const colorIdx = ti % DB_ACCENTS.length;
    const themeColor = DB_ACCENTS[colorIdx];
    const milestoneColor = DB_ACCENTS_1[colorIdx];
    const themeFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: themeColor } };
    const msFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: milestoneColor } };

    const themeStartRow = currentRow;
    const msCount = Math.max(theme.milestones.length, 1);

    // Aggregate resources for theme
    const totalResources = theme.milestones.reduce((sum, ms) => {
      const r = parseInt(ms.resources, 10);
      return sum + (isNaN(r) ? 0 : r);
    }, 0);

    for (let mi = 0; mi < msCount; mi++) {
      const row = currentRow + mi;

      // Theme name cell (only on first row, will be merged later)
      if (mi === 0) {
        const themeCell = ws.getCell(row, THEME_COL);
        themeCell.value = theme.summary;
        themeCell.fill = themeFill;
        themeCell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        themeCell.alignment = { vertical: 'middle', wrapText: true };

        const resCell = ws.getCell(row, RESOURCES_COL);
        resCell.value = totalResources || '';
        resCell.fill = themeFill;
        resCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        resCell.alignment = { horizontal: 'center', vertical: 'middle' };
      }

      if (mi < theme.milestones.length) {
        const ms = theme.milestones[mi];
        const bucketIdx = findBucketIndex(ms.targetDate, buckets);
        if (bucketIdx >= 0) {
          const col = FIRST_BUCKET_COL + bucketIdx;
          const cell = ws.getCell(row, col);
          cell.value = ms.summary;
          cell.fill = msFill;
          cell.alignment = { wrapText: true };

          if (ms.isResolved) {
            cell.font = { strike: true, color: { argb: 'FF666666' } };
          }
        }
      }
    }

    // Merge theme cells if multiple rows
    if (msCount > 1) {
      ws.mergeCells(themeStartRow, THEME_COL, themeStartRow + msCount - 1, THEME_COL);
      ws.mergeCells(themeStartRow, RESOURCES_COL, themeStartRow + msCount - 1, RESOURCES_COL);
    }

    // Fill empty cells in theme block with theme color (for theme/resources cols)
    for (let mi = 1; mi < msCount; mi++) {
      // These are merged, but we still set fill on the first cell
    }

    // Apply outer border for this theme block
    applyOuterBorder(ws, themeStartRow, THEME_COL, themeStartRow + msCount - 1, totalCols);

    currentRow += msCount;
  }

  // Apply outer border for the whole table
  if (themeDataList.length > 0) {
    applyOuterBorder(ws, 1, THEME_COL, currentRow - 1, totalCols);
  }

  // Generate buffer
  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Serve static files
function serveStatic(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// Proxy request to Jira API
function proxyToJira(req, res, jiraPath, query) {
  const jiraHost = req.headers['x-jira-host'];
  const authorization = req.headers['authorization'];

  if (!jiraHost || !authorization) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing X-Jira-Host or Authorization header' }));
    return;
  }

  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', () => {
    // Use parsed config if available (real mode), otherwise use header values
    let hostname, port, fullPath, useHttps;
    if (CONFIG && CONFIG._hostname) {
      hostname = CONFIG._hostname;
      port = CONFIG._port;
      fullPath = CONFIG._basePath + jiraPath + (query || '');
      useHttps = CONFIG._protocol === 'https:';
    } else {
      const jiraUrl = `https://${jiraHost}${jiraPath}${query || ''}`;
      const jiraParsed = url.parse(jiraUrl);
      hostname = jiraParsed.hostname;
      port = 443;
      fullPath = jiraParsed.path;
      useHttps = true;
    }

    const options = {
      hostname,
      port,
      path: fullPath,
      method: req.method,
      rejectUnauthorized: false, // allow self-signed certificates
      headers: {
        'Authorization': authorization,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    const httpModule = useHttps ? https : http;
    const proxyReq = httpModule.request(options, (proxyRes) => {
      let responseData = '';

      proxyRes.on('data', chunk => {
        responseData += chunk;
      });

      proxyRes.on('end', () => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(responseData);
      });
    });

    proxyReq.on('error', (error) => {
      console.error('Proxy error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    });

    if (body && (req.method === 'POST' || req.method === 'PUT')) {
      proxyReq.write(body);
    }

    proxyReq.end();
  });
}

// Main request handler
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Jira-Host');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Config endpoint — sends mode and credentials to frontend
  if (pathname === '/api/config') {
    const configResponse = { mode: MODE };
    if (MODE === 'real' && CONFIG) {
      configResponse.jiraHost = CONFIG.jiraHost;
      configResponse.email = CONFIG.jiraUser;
      configResponse.apiToken = CONFIG.apiToken;
      configResponse.hierarchyJql = CONFIG.hierarchyJql || '';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(configResponse));
    return;
  }

  // Local data API — GET all issues data, POST update single field with history
  if (pathname === '/api/data' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(LOCAL_DATA.issues));
    return;
  }

  if (pathname === '/api/data' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { issueKey, field, value } = JSON.parse(body);
        if (!issueKey || !field) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'issueKey and field required' }));
          return;
        }
        if (!LOCAL_DATA.issues[issueKey]) LOCAL_DATA.issues[issueKey] = {};
        const oldValue = LOCAL_DATA.issues[issueKey][field] ?? null;
        LOCAL_DATA.issues[issueKey][field] = value;

        // Record history entry
        LOCAL_DATA.history.push({
          issueKey,
          field,
          oldValue,
          newValue: value,
          user: getCurrentUser(),
          timestamp: new Date().toISOString()
        });

        saveLocalData();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: LOCAL_DATA.issues[issueKey] }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // History API — GET history for a specific issue or all
  if (pathname.startsWith('/api/data/history') && req.method === 'GET') {
    const parts = pathname.split('/');
    const issueKey = parts[4] || null; // /api/data/history/KEY-1
    let history = LOCAL_DATA.history;
    if (issueKey) {
      history = history.filter(h => h.issueKey === issueKey);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(history));
    return;
  }

  // Progress snapshot — trigger computation
  if (pathname === '/api/progress/snapshot' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      if (snapshotState.running) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Snapshot already running' }));
        return;
      }
      let jql = '', mode = 'all';
      try { const parsed = JSON.parse(body); jql = parsed.jql || ''; mode = parsed.mode || 'all'; } catch (e) {}
      // Start async computation (don't await)
      computeSnapshot(jql, mode);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Snapshot started' }));
    });
    return;
  }

  // Progress snapshot — SSE status stream
  if (pathname === '/api/progress/snapshot/status' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write(`data: ${JSON.stringify(snapshotState)}\n\n`);
    if (!snapshotState.running && !snapshotState.done) {
      res.end();
      return;
    }
    sseClients.push(res);
    req.on('close', () => {
      const idx = sseClients.indexOf(res);
      if (idx >= 0) sseClients.splice(idx, 1);
    });
    return;
  }

  // Progress history — GET all snapshots
  if (pathname === '/api/progress/history' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ snapshots: PROGRESS_DATA.snapshots, gitActivity: PROGRESS_DATA.gitActivity || {}, developers: PROGRESS_DATA.developers || {}, lastRun: PROGRESS_DATA.lastRun }));
    return;
  }

  // Export roadmap as Excel
  if (pathname === '/api/export/roadmap' && req.method === 'GET') {
    const jql = parsedUrl.query?.jql || '';
    generateRoadmapExcel(jql)
      .then(buffer => {
        const filename = `roadmap-${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': buffer.length
        });
        res.end(Buffer.from(buffer));
      })
      .catch(err => {
        console.error('Roadmap export error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // API routes
  if (pathname.startsWith('/api/jira')) {
    const jiraPath = pathname.replace('/api/jira', '');
    const jiraHost = req.headers['x-jira-host'];

    // Mock mode: return test data
    if (jiraHost === 'mock') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        const result = handleMockRequest(jiraPath, parsedUrl.search, req.method, body || null);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      });
      return;
    }

    proxyToJira(req, res, jiraPath, parsedUrl.search);
    return;
  }

  // Static files
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  serveStatic(req, res, filePath);
});

server.listen(PORT, () => {
  console.log('');
  console.log('┌─────────────────────────────────────────┐');
  console.log('│                                         │');
  console.log('│   Jira Manager started                  │');
  console.log('│                                         │');
  console.log(`│   http://localhost:${PORT}                  │`);
  console.log(`│   Mode: ${MODE === 'mock' ? 'MOCK (test data)' : 'REAL (' + CONFIG.jiraHost + ')'}`.padEnd(42) + '│');
  console.log('│                                         │');
  console.log('└─────────────────────────────────────────┘');
  console.log('');
});
