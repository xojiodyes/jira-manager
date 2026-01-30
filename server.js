const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

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
