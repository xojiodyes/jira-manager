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
      console.error('config.json должен содержать: jiraHost, jiraUser, apiToken');
      process.exit(1);
    }
  } catch (err) {
    console.error(`Не удалось прочитать ${configPath}: ${err.message}`);
    console.error('Скопируйте config.example.json в config.json и заполните данные.');
    process.exit(1);
  }
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
    const jiraUrl = `https://${jiraHost}${jiraPath}${query || ''}`;
    const jiraParsed = url.parse(jiraUrl);

    const options = {
      hostname: jiraParsed.hostname,
      port: 443,
      path: jiraParsed.path,
      method: req.method,
      headers: {
        'Authorization': authorization,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    const proxyReq = https.request(options, (proxyRes) => {
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
  console.log('│   Jira Manager запущен                  │');
  console.log('│                                         │');
  console.log(`│   http://localhost:${PORT}                  │`);
  console.log(`│   Режим: ${MODE === 'mock' ? 'MOCK (тестовые данные)' : 'REAL (' + CONFIG.jiraHost + ')'}`.padEnd(42) + '│');
  console.log('│                                         │');
  console.log('└─────────────────────────────────────────┘');
  console.log('');
});
