/**
 * Jira API Client
 */
class JiraAPI {
  constructor() {
    this.baseUrl = '/api/jira';
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
      throw new Error('Не настроено подключение к Jira');
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

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data.errorMessages?.join(', ') || data.message || `HTTP ${response.status}`;
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

// Auto-configure mock credentials if nothing is saved
if (!window.jiraAPI.isConfigured()) {
  window.jiraAPI.saveCredentials('mock', 'test@test.com', 'mock-token');
}
