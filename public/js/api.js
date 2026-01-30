/**
 * Jira API Client
 */
class JiraAPI {
  constructor() {
    this.baseUrl = '/api/jira';
    this.serverConfig = null; // loaded from /api/config
  }

  /**
   * Load config from server
   */
  async loadServerConfig() {
    try {
      const res = await fetch('/api/config');
      this.serverConfig = await res.json();
      if (this.serverConfig.mode === 'real') {
        this.saveCredentials(
          this.serverConfig.jiraHost,
          this.serverConfig.email,
          this.serverConfig.apiToken
        );
      } else if (this.serverConfig.mode === 'mock') {
        if (!this.isConfigured()) {
          this.saveCredentials('mock', 'test@test.com', 'mock-token');
        }
      }
      return this.serverConfig;
    } catch (err) {
      console.error('Failed to load server config:', err);
      return null;
    }
  }

  /**
   * Get stored credentials
   */
  getCredentials() {
    const saved = localStorage.getItem('jiraConfig');
    if (!saved) return null;
    return JSON.parse(saved);
  }

  /**
   * Save credentials
   */
  saveCredentials(host, email, token) {
    localStorage.setItem('jiraConfig', JSON.stringify({ host, email, token }));
  }

  /**
   * Get auth header
   */
  getAuthHeader() {
    const creds = this.getCredentials();
    if (!creds) return null;
    return 'Basic ' + btoa(creds.email + ':' + creds.token);
  }

  /**
   * Get Jira host
   */
  getHost() {
    const creds = this.getCredentials();
    return creds?.host || '';
  }

  /**
   * Check if configured
   */
  isConfigured() {
    const creds = this.getCredentials();
    return !!(creds?.host && creds?.email && creds?.token);
  }

  /**
   * Make API request
   */
  async request(endpoint, options = {}) {
    const auth = this.getAuthHeader();
    const host = this.getHost();

    if (!auth || !host) {
      throw new Error('Jira connection not configured');
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': auth,
        'X-Jira-Host': host,
        ...options.headers
      }
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const errorMsg = data?.errorMessages?.join(', ') || data?.message || `HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    return data;
  }

  /**
   * Test connection
   */
  async testConnection() {
    return this.request('/rest/api/2/myself');
  }

  /**
   * Search issues by JQL
   */
  async searchIssues(jql, startAt = 0, maxResults = 50, extraFields = '') {
    const fields = 'summary,status,assignee,priority,issuetype,created,updated,project,description,comment,labels,issuelinks' + (extraFields ? ',' + extraFields : '');
    const params = new URLSearchParams({
      jql,
      startAt,
      maxResults,
      fields
    });

    return this.request(`/rest/api/2/search?${params}`);
  }

  /**
   * Get single issue
   */
  async getIssue(issueKey) {
    return this.request(`/rest/api/2/issue/${issueKey}`);
  }

  /**
   * Get issue comments
   */
  async getComments(issueKey) {
    return this.request(`/rest/api/2/issue/${issueKey}/comment`);
  }

  /**
   * Get all statuses
   */
  async getStatuses() {
    return this.request('/rest/api/2/status');
  }

  /**
   * Get all projects
   */
  async getProjects() {
    return this.request('/rest/api/2/project');
  }

  /**
   * Create issue
   */
  async createIssue(projectKey, summary, issueTypeName = 'Story', labels = []) {
    return this.request('/rest/api/2/issue', {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary,
          issuetype: { name: issueTypeName },
          labels
        }
      })
    });
  }

  /**
   * Get all issue link types
   */
  async getIssueLinkTypes() {
    const data = await this.request('/rest/api/2/issueLinkType');
    return data.issueLinkTypes || [];
  }

  /**
   * Create issue link
   */
  async createIssueLink(parentKey, childKey, linkTypeName = 'Hierarchy') {
    return this.request('/rest/api/2/issueLink', {
      method: 'POST',
      body: JSON.stringify({
        type: { name: linkTypeName },
        outwardIssue: { key: parentKey },
        inwardIssue: { key: childKey }
      })
    });
  }

  /**
   * Build issue URL
   */
  getIssueUrl(issueKey) {
    return `https://${this.getHost()}/browse/${issueKey}`;
  }
}

// Global instance
window.jiraAPI = new JiraAPI();

// Load server config (async, app.js will await this)
window.jiraConfigReady = window.jiraAPI.loadServerConfig();
