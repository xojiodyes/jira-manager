/**
 * Jira Manager Application
 */
class App {
  constructor() {
    this.currentView = 'hierarchy';

    // Hierarchy state
    this.selectedThemeKey = null;
    this.selectedThemeProject = null;
    this.selectedMilestoneKey = null;
    this.selectedMilestoneProject = null;

    // Local data (status, confidence per issue key)
    this.localData = {};

    this.init();
  }

  async init() {
    // Wait for server config to load
    await window.jiraConfigReady;
    this.serverConfig = window.jiraAPI.serverConfig || {};

    // Load local data (status/confidence)
    await this.loadLocalData();

    this.bindEvents();
    this.loadSavedState();
    this.checkConnection();
    this.loadThemes();
  }

  async loadLocalData() {
    try {
      const res = await fetch('/api/data');
      this.localData = await res.json();
    } catch (err) {
      console.error('Failed to load local data:', err);
      this.localData = {};
    }
  }

  async saveLocalField(issueKey, field, value) {
    try {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueKey, field, value })
      });
      const result = await res.json();
      if (result.ok) {
        if (!this.localData[issueKey]) this.localData[issueKey] = {};
        this.localData[issueKey][field] = value;
      }
    } catch (err) {
      console.error('Failed to save local data:', err);
    }
  }

  getLocalField(issueKey, field) {
    return this.localData[issueKey]?.[field] ?? null;
  }

  bindEvents() {
    // Settings modal
    document.getElementById('settingsBtn').addEventListener('click', () => {
      this.openSettings();
    });

    document.getElementById('closeSettingsModal').addEventListener('click', () => {
      UI.closeModal('settingsModal');
    });

    document.getElementById('testConnectionBtn').addEventListener('click', () => {
      this.testConnection();
    });

    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
      this.saveSettings();
    });

    // Issue modal
    document.getElementById('closeIssueModal').addEventListener('click', () => {
      UI.closeModal('issueModal');
    });

    // Hierarchy create buttons
    document.getElementById('addThemeBtn').addEventListener('click', () => {
      this.showInlineForm('themes');
    });
    document.getElementById('addMilestoneBtn').addEventListener('click', () => {
      this.showInlineForm('milestones');
    });
    document.getElementById('addTaskBtn').addEventListener('click', () => {
      this.showInlineForm('tasks');
    });

    // Modal backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        e.target.closest('.modal').classList.remove('active');
      });
    });

    // ESC to close modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(modal => {
          modal.classList.remove('active');
        });
      }
    });
  }

  switchView(viewName) {
    this.currentView = viewName;

    // Update nav
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Update views
    document.querySelectorAll('.view').forEach(view => {
      view.classList.remove('active');
    });
    const viewEl = document.getElementById(viewName + 'View');
    if (viewEl) viewEl.classList.add('active');

    // Update title
    const titles = { hierarchy: 'Hierarchy' };
    document.getElementById('pageTitle').textContent = titles[viewName] || viewName;

    // Load hierarchy data on switch
    if (viewName === 'hierarchy') {
      this.loadThemes();
    }
  }

  loadSavedState() {
    // Load credentials into form
    const creds = jiraAPI.getCredentials();
    if (creds) {
      document.getElementById('jiraHost').value = creds.host || '';
      document.getElementById('email').value = creds.email || '';
      document.getElementById('apiToken').value = creds.token || '';
    }
  }

  async checkConnection() {
    if (!jiraAPI.isConfigured()) {
      UI.updateConnectionStatus(null, 'Not configured');
      return;
    }

    try {
      const user = await jiraAPI.testConnection();
      UI.updateConnectionStatus(true, user.displayName);
    } catch (err) {
      UI.updateConnectionStatus(false, 'Connection error');
    }
  }

  openSettings() {
    const creds = jiraAPI.getCredentials();
    if (creds) {
      document.getElementById('jiraHost').value = creds.host || '';
      document.getElementById('email').value = creds.email || '';
      document.getElementById('apiToken').value = creds.token || '';
    }
    UI.openModal('settingsModal');
  }

  async testConnection() {
    const host = document.getElementById('jiraHost').value.trim();
    const email = document.getElementById('email').value.trim();
    const token = document.getElementById('apiToken').value.trim();

    if (!host || !email || !token) {
      UI.toast('Please fill in all fields', 'error');
      return;
    }

    // Temporarily save for testing
    jiraAPI.saveCredentials(host, email, token);

    try {
      const user = await jiraAPI.testConnection();
      UI.toast(`Connected as ${user.displayName}`, 'success');
      UI.updateConnectionStatus(true, user.displayName);
    } catch (err) {
      UI.toast(`Error: ${err.message}`, 'error');
      UI.updateConnectionStatus(false, 'Connection error');
    }
  }

  saveSettings() {
    const host = document.getElementById('jiraHost').value.trim();
    const email = document.getElementById('email').value.trim();
    const token = document.getElementById('apiToken').value.trim();

    if (!host || !email || !token) {
      UI.toast('Please fill in all fields', 'error');
      return;
    }

    jiraAPI.saveCredentials(host, email, token);
    UI.toast('Settings saved', 'success');
    UI.closeModal('settingsModal');
    this.checkConnection();
  }

  async showIssueDetail(issueKey) {
    UI.openModal('issueModal');

    const titleEl = document.getElementById('issueModalTitle');
    const bodyEl = document.getElementById('issueModalBody');

    titleEl.textContent = issueKey;
    bodyEl.innerHTML = UI.renderLoading();

    try {
      const [issue, history] = await Promise.all([
        jiraAPI.getIssue(issueKey),
        this.loadHistory(issueKey)
      ]);
      this.renderIssueDetail(issue, history);
    } catch (err) {
      bodyEl.innerHTML = UI.renderError(err.message);
    }
  }

  renderIssueDetail(issue, history = []) {
    const titleEl = document.getElementById('issueModalTitle');
    const bodyEl = document.getElementById('issueModalBody');
    const f = issue.fields;

    titleEl.innerHTML = `
      <a href="${jiraAPI.getIssueUrl(issue.key)}" target="_blank" style="color: inherit; text-decoration: none;">
        ${issue.key} ↗
      </a>
    `;

    const statusClass = UI.getStatusClass(f.status?.statusCategory?.key);

    bodyEl.innerHTML = `
      <div class="issue-detail-header">
        <h2 class="issue-detail-summary">${UI.escapeHtml(f.summary)}</h2>

        <div class="issue-detail-meta">
          <div class="issue-meta-item">
            <span class="issue-meta-label">Status</span>
            <span class="status-badge ${statusClass}">${UI.escapeHtml(f.status?.name)}</span>
          </div>
          <div class="issue-meta-item">
            <span class="issue-meta-label">Type</span>
            <span class="issue-type">
              ${f.issuetype?.iconUrl ? `<img src="${f.issuetype.iconUrl}" class="issue-type-icon" alt="">` : ''}
              ${UI.escapeHtml(f.issuetype?.name)}
            </span>
          </div>
          <div class="issue-meta-item">
            <span class="issue-meta-label">Priority</span>
            <span>
              ${f.priority?.iconUrl ? `<img src="${f.priority.iconUrl}" class="priority-icon" alt="">` : ''}
              ${UI.escapeHtml(f.priority?.name)}
            </span>
          </div>
          <div class="issue-meta-item">
            <span class="issue-meta-label">Assignee</span>
            ${f.assignee
              ? `<span class="assignee">
                  <img src="${f.assignee.avatarUrls?.['24x24'] || ''}" class="assignee-avatar" alt="">
                  ${UI.escapeHtml(f.assignee.displayName)}
                </span>`
              : '<span class="assignee-unassigned">Unassigned</span>'}
          </div>
        </div>
      </div>

      <div class="issue-detail-section">
        <h4>Description</h4>
        ${UI.wikiToHtml(f.description)}
      </div>

      <div class="issue-detail-section">
        <h4>Details</h4>
        <div class="issue-detail-meta">
          <div class="issue-meta-item">
            <span class="issue-meta-label">Project</span>
            <span>${UI.escapeHtml(f.project?.name)}</span>
          </div>
          <div class="issue-meta-item">
            <span class="issue-meta-label">Created</span>
            <span>${UI.formatDate(f.created)}</span>
          </div>
          <div class="issue-meta-item">
            <span class="issue-meta-label">Updated</span>
            <span>${UI.formatDate(f.updated)}</span>
          </div>
        </div>
      </div>

      <div class="issue-detail-section">
        <h4>Local Data</h4>
        <div class="issue-detail-meta">
          <div class="issue-meta-item">
            <span class="issue-meta-label">Status (%)</span>
            <span class="editable-field editable-status" data-key="${issue.key}" data-field="status" title="Status (0-100)">${this.getLocalField(issue.key, 'status') !== null ? this.getLocalField(issue.key, 'status') + '%' : '—'}</span>
          </div>
          <div class="issue-meta-item">
            <span class="issue-meta-label">Confidence (%)</span>
            <span class="editable-field editable-confidence" data-key="${issue.key}" data-field="confidence" title="Confidence (0-100)">${this.getLocalField(issue.key, 'confidence') !== null ? this.getLocalField(issue.key, 'confidence') + '%' : '—'}</span>
          </div>
        </div>
      </div>

      ${history.length ? `
        <div class="issue-detail-section">
          <h4>Change History (${history.length})</h4>
          <div class="history-list">
            ${history.slice().reverse().map(h => `
              <div class="history-entry">
                <div class="history-entry-header">
                  <strong>${UI.escapeHtml(h.user)}</strong>
                  <span class="history-date">${UI.formatDate(h.timestamp)}</span>
                </div>
                <div class="history-entry-body">
                  <span class="history-field-name">${h.field === 'status' ? 'Status' : 'Confidence'}</span>:
                  <span class="history-old-value">${h.oldValue !== null ? h.oldValue + '%' : '—'}</span>
                  &rarr;
                  <span class="history-new-value">${h.newValue !== null ? h.newValue + '%' : '—'}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${f.comment?.comments?.length ? `
        <div class="issue-detail-section">
          <h4>Comments (${f.comment.total})</h4>
          ${f.comment.comments.slice(-5).map(c => `
            <div style="margin-bottom: 16px; padding: 12px; background: var(--color-bg); border-radius: var(--radius-sm);">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <img src="${c.author?.avatarUrls?.['24x24'] || ''}" class="assignee-avatar" alt="">
                <strong>${UI.escapeHtml(c.author?.displayName)}</strong>
                <span style="color: var(--color-text-muted); font-size: 12px;">${UI.formatRelativeDate(c.created)}</span>
              </div>
              <div style="font-size: 14px;">${UI.wikiToHtml(c.body)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;

    // Bind editable fields in modal
    bodyEl.querySelectorAll('.editable-field').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startInlineEdit(el);
      });
    });
  }

  // === HIERARCHY ===

  async loadThemes() {
    const container = document.getElementById('themesContainer');
    const countEl = document.getElementById('themesCount');
    container.innerHTML = UI.renderLoading();

    // Reset downstream panels
    this.selectedThemeKey = null;
    this.selectedThemeProject = null;
    this.selectedMilestoneKey = null;
    this.selectedMilestoneProject = null;
    document.getElementById('addMilestoneBtn').disabled = true;
    document.getElementById('addTaskBtn').disabled = true;
    document.getElementById('milestonesContainer').innerHTML = UI.renderEmpty('🎯', 'Select a Theme');
    document.getElementById('milestonesCount').textContent = '';
    document.getElementById('hierarchyTasksContainer').innerHTML = UI.renderEmpty('📋', 'Select a Milestone');
    document.getElementById('hierarchyTasksCount').textContent = '';

    try {
      // Always filter by label "theme"; user JQL from config adds extra conditions
      const userJql = this.serverConfig?.hierarchyJql || '';
      let hierarchyJql;
      if (userJql) {
        // Insert "labels = theme AND" before user JQL, preserve ORDER BY if present
        const orderMatch = userJql.match(/^(.*?)\s*(ORDER\s+BY\s+.*)$/i);
        if (orderMatch) {
          const conditions = orderMatch[1].trim();
          const orderBy = orderMatch[2];
          hierarchyJql = conditions
            ? `labels = theme AND ${conditions} ${orderBy}`
            : `labels = theme ${orderBy}`;
        } else {
          hierarchyJql = `labels = theme AND ${userJql}`;
        }
      } else {
        hierarchyJql = 'labels = theme ORDER BY updated DESC';
      }
      const data = await jiraAPI.searchIssues(hierarchyJql, 0, 200);
      countEl.textContent = data.total > 0 ? data.total : '';
      this.renderHierarchyList(container, data.issues, 'theme');
    } catch (err) {
      container.innerHTML = UI.renderError(err.message);
    }
  }

  async selectTheme(issueKey) {
    this.selectedThemeKey = issueKey;
    this.selectedMilestoneKey = null;
    this.selectedMilestoneProject = null;

    // Highlight selected theme
    document.querySelectorAll('#themesContainer .hierarchy-row').forEach(row => {
      row.classList.toggle('selected', row.dataset.key === issueKey);
    });

    // Enable milestone button, disable task button
    document.getElementById('addMilestoneBtn').disabled = false;
    document.getElementById('addTaskBtn').disabled = true;

    // Reset tasks panel
    document.getElementById('hierarchyTasksContainer').innerHTML = UI.renderEmpty('📋', 'Select a Milestone');
    document.getElementById('hierarchyTasksCount').textContent = '';

    // Load milestones linked to this theme
    const milestonesContainer = document.getElementById('milestonesContainer');
    const milestonesCount = document.getElementById('milestonesCount');
    milestonesContainer.classList.add('loading-overlay');

    try {
      // Get the theme issue to read its links
      console.log(`[Hierarchy] selectTheme: loading issue ${issueKey}`);
      const theme = await jiraAPI.getIssue(issueKey);
      this.selectedThemeProject = theme.fields.project?.key || null;
      const links = theme.fields.issuelinks || [];
      console.log(`[Hierarchy] Theme ${issueKey}: found ${links.length} issuelinks`);
      links.forEach((link, i) => {
        const type = link.type?.name || 'unknown';
        const outKey = link.outwardIssue?.key || '-';
        const inKey = link.inwardIssue?.key || '-';
        console.log(`[Hierarchy]   link[${i}]: type="${type}", outward="${link.type?.outward || ''}", inward="${link.type?.inward || ''}", outwardIssue=${outKey}, inwardIssue=${inKey}`);
      });

      // Collect ALL linked issue keys (both outward and inward)
      const linkedKeys = [];
      for (const link of links) {
        if (link.outwardIssue) linkedKeys.push(link.outwardIssue.key);
        if (link.inwardIssue) linkedKeys.push(link.inwardIssue.key);
      }
      console.log(`[Hierarchy] Linked keys: [${linkedKeys.join(', ')}]`);

      if (linkedKeys.length === 0) {
        console.log(`[Hierarchy] No linked keys found — showing empty`);
        milestonesContainer.classList.remove('loading-overlay');
        milestonesContainer.innerHTML = UI.renderEmpty('🎯', 'No linked milestones');
        milestonesCount.textContent = '';
        return;
      }

      // Fetch linked issues WITH labels filter — only milestones
      const jql = `key in (${linkedKeys.join(',')}) AND labels = milestone ORDER BY updated DESC`;
      console.log(`[Hierarchy] Milestones JQL: ${jql}`);
      const data = await jiraAPI.searchIssues(jql, 0, 200);
      console.log(`[Hierarchy] Milestones search result: ${data.total} found, ${data.issues?.length} returned`);
      data.issues?.forEach(issue => {
        console.log(`[Hierarchy]   milestone: ${issue.key} "${issue.fields?.summary}" labels=[${issue.fields?.labels?.join(',')}]`);
      });
      milestonesContainer.classList.remove('loading-overlay');
      milestonesCount.textContent = data.total > 0 ? data.total : '';
      this.renderHierarchyList(milestonesContainer, data.issues, 'milestone');
    } catch (err) {
      milestonesContainer.classList.remove('loading-overlay');
      milestonesContainer.innerHTML = UI.renderError(err.message);
    }
  }

  async selectMilestone(issueKey) {
    this.selectedMilestoneKey = issueKey;

    // Highlight selected milestone
    document.querySelectorAll('#milestonesContainer .hierarchy-row').forEach(row => {
      row.classList.toggle('selected', row.dataset.key === issueKey);
    });

    // Enable task button
    document.getElementById('addTaskBtn').disabled = false;

    const tasksContainer = document.getElementById('hierarchyTasksContainer');
    const tasksCount = document.getElementById('hierarchyTasksCount');

    // Add loading overlay without removing current content (prevents layout jump)
    tasksContainer.classList.add('loading-overlay');

    try {
      // Get the milestone issue to read its links
      const milestone = await jiraAPI.getIssue(issueKey);
      this.selectedMilestoneProject = milestone.fields.project?.key || null;
      const links = milestone.fields.issuelinks || [];

      // Collect ALL linked issue keys (both outward and inward)
      const linkedKeys = [];
      for (const link of links) {
        if (link.outwardIssue) linkedKeys.push(link.outwardIssue.key);
        if (link.inwardIssue) linkedKeys.push(link.inwardIssue.key);
      }

      if (linkedKeys.length === 0) {
        tasksContainer.classList.remove('loading-overlay');
        tasksContainer.innerHTML = UI.renderEmpty('📋', 'No linked tasks');
        tasksCount.textContent = '';
        return;
      }

      // Fetch linked issues EXCLUDING themes and milestones
      const jql = `key in (${linkedKeys.join(',')}) AND labels not in (theme, milestone) ORDER BY updated DESC`;
      const data = await jiraAPI.searchIssues(jql, 0, 200);
      tasksContainer.classList.remove('loading-overlay');
      tasksCount.textContent = data.total > 0 ? data.total : '';
      this.renderHierarchyTasks(tasksContainer, data.issues);
    } catch (err) {
      tasksContainer.classList.remove('loading-overlay');
      tasksContainer.innerHTML = UI.renderError(err.message);
    }
  }

  renderHierarchyList(container, issues, level) {
    if (issues.length === 0) {
      const icons = { theme: '🏗️', milestone: '🎯' };
      const msgs = { theme: 'No themes', milestone: 'No milestones' };
      container.innerHTML = UI.renderEmpty(icons[level], msgs[level]);
      return;
    }

    let html = `<div class="hierarchy-list">
      <div class="hierarchy-list-header">
        <span class="hlh-key">Key</span>
        <span class="hlh-summary">Summary</span>
        <span class="hlh-field">Status</span>
        <span class="hlh-field">Confid.</span>
        <span class="hlh-count">Items</span>
        <span class="hlh-link"></span>
      </div>`;
    for (const issue of issues) {
      const f = issue.fields;
      // Count child items: only outward links (where this issue is parent),
      // excluding clone-type links
      const EXCLUDED_LINK_TYPES = ['cloners', 'duplicate'];
      const childCount = (f.issuelinks || []).filter(link => {
        if (!link.outwardIssue) return false;
        const typeName = (link.type?.name || '').toLowerCase();
        if (EXCLUDED_LINK_TYPES.some(ex => typeName.includes(ex))) return false;
        return true;
      }).length;

      const status = this.getLocalField(issue.key, 'status');
      const confidence = this.getLocalField(issue.key, 'confidence');

      html += `
        <div class="hierarchy-row" data-key="${issue.key}" data-level="${level}">
          <div class="hierarchy-row-main">
            <span class="issue-key" data-key="${issue.key}">${issue.key}</span>
            <span class="hierarchy-summary">${UI.escapeHtml(f.summary)}</span>
            <span class="editable-field editable-status" data-key="${issue.key}" data-field="status" title="Status (0-100)">${status !== null ? status + '%' : '—'}</span>
            <span class="editable-field editable-confidence" data-key="${issue.key}" data-field="confidence" title="Confidence (0-100)">${confidence !== null ? confidence + '%' : '—'}</span>
            <span class="hierarchy-items-count" title="Child items">${childCount}</span>
            <a href="${jiraAPI.getIssueUrl(issue.key)}" target="_blank" class="hierarchy-jira-link" title="Open in Jira" onclick="event.stopPropagation()">↗</a>
          </div>
        </div>
      `;
    }
    html += '</div>';
    container.innerHTML = html;

    // Bind click handlers
    container.querySelectorAll('.hierarchy-row').forEach(row => {
      row.addEventListener('click', (e) => {
        // If clicking on editable field, handle inline edit
        if (e.target.classList.contains('editable-field')) {
          e.stopPropagation();
          this.startInlineEdit(e.target);
          return;
        }
        // If clicking on issue key specifically, open detail modal
        if (e.target.classList.contains('issue-key')) {
          this.showIssueDetail(e.target.dataset.key);
          return;
        }
        const key = row.dataset.key;
        if (level === 'theme') {
          this.selectTheme(key);
        } else if (level === 'milestone') {
          this.selectMilestone(key);
        }
      });
    });
  }

  // === CREATE FORMS ===

  showInlineForm(panel) {
    // panel: 'themes', 'milestones', 'tasks'
    const containerIds = {
      themes: 'themesContainer',
      milestones: 'milestonesContainer',
      tasks: 'hierarchyTasksContainer'
    };
    const container = document.getElementById(containerIds[panel]);

    // Remove existing inline form if any
    const existing = container.querySelector('.inline-create-form');
    if (existing) {
      existing.remove();
      return;
    }

    const form = document.createElement('div');
    form.className = 'inline-create-form';

    let extraFields = '';

    // For themes: project dropdown needed
    if (panel === 'themes') {
      extraFields = `
        <input type="text" class="input input-sm inline-project-input" placeholder="Project key (e.g. PROJ)" id="inlineProjectKey">
      `;
    }

    // For tasks: type dropdown
    if (panel === 'tasks') {
      extraFields = `
        <select class="input input-sm inline-type-select" id="inlineIssueType">
          <option value="Story">Story</option>
          <option value="Task">Task</option>
          <option value="Bug">Bug</option>
          <option value="Epic">Epic</option>
        </select>
      `;
    }

    form.innerHTML = `
      <div class="inline-form-row">
        <input type="text" class="input input-sm inline-summary-input" placeholder="Summary" id="inlineSummary" autofocus>
        ${extraFields}
        <button class="btn-icon btn-confirm" id="inlineConfirm" title="Create">&#10003;</button>
        <button class="btn-icon btn-cancel" id="inlineCancel" title="Cancel">&#10005;</button>
      </div>
    `;

    container.insertBefore(form, container.firstChild);

    // Focus summary input
    const summaryInput = form.querySelector('#inlineSummary');
    summaryInput.focus();

    // Bind events
    form.querySelector('#inlineConfirm').addEventListener('click', () => {
      this.submitInlineForm(panel);
    });
    form.querySelector('#inlineCancel').addEventListener('click', () => {
      form.remove();
    });
    summaryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submitInlineForm(panel);
      if (e.key === 'Escape') form.remove();
    });
  }

  async submitInlineForm(panel) {
    const summary = document.getElementById('inlineSummary')?.value.trim();
    if (!summary) {
      UI.toast('Enter a Summary', 'error');
      return;
    }

    try {
      if (panel === 'themes') {
        await this.createTheme(summary);
      } else if (panel === 'milestones') {
        await this.createMilestone(summary);
      } else if (panel === 'tasks') {
        await this.createTask(summary);
      }
    } catch (err) {
      UI.toast(`Error: ${err.message}`, 'error');
    }
  }

  async createTheme(summary) {
    const projectKey = document.getElementById('inlineProjectKey')?.value.trim();
    if (!projectKey) {
      UI.toast('Enter a Project key', 'error');
      return;
    }

    const result = await jiraAPI.createIssue(projectKey, summary, 'Story', ['theme']);
    UI.toast(`Theme ${result.key} created`, 'success');

    // Reload themes
    await this.loadThemes();
  }

  async createMilestone(summary) {
    if (!this.selectedThemeKey || !this.selectedThemeProject) {
      UI.toast('Select a Theme first', 'error');
      return;
    }

    const projectKey = this.selectedThemeProject;
    const result = await jiraAPI.createIssue(projectKey, summary, 'Story', ['milestone']);

    // Link milestone to theme
    await jiraAPI.createIssueLink(this.selectedThemeKey, result.key, 'Hierarchy');
    UI.toast(`Milestone ${result.key} created`, 'success');

    // Reload milestones for current theme
    await this.selectTheme(this.selectedThemeKey);
  }

  async createTask(summary) {
    if (!this.selectedMilestoneKey || !this.selectedMilestoneProject) {
      UI.toast('Select a Milestone first', 'error');
      return;
    }

    const projectKey = this.selectedMilestoneProject;
    const issueType = document.getElementById('inlineIssueType')?.value || 'Story';
    const result = await jiraAPI.createIssue(projectKey, summary, issueType, []);

    // Link task to milestone
    await jiraAPI.createIssueLink(this.selectedMilestoneKey, result.key, 'Hierarchy');
    UI.toast(`${issueType} ${result.key} created`, 'success');

    // Reload tasks for current milestone
    await this.selectMilestone(this.selectedMilestoneKey);
  }

  renderHierarchyTasks(container, issues) {
    if (issues.length === 0) {
      container.innerHTML = UI.renderEmpty('📋', 'No tasks');
      return;
    }

    let html = `
      <table class="issues-table issues-table-fixed">
        <colgroup>
          <col style="width: 90px;">
          <col style="width: 100px;">
          <col>
          <col style="width: 120px;">
          <col style="width: 80px;">
          <col style="width: 80px;">
          <col style="width: 100px;">
          <col style="width: 140px;">
          <col style="width: 36px;">
        </colgroup>
        <thead>
          <tr>
            <th>Type</th>
            <th>Key</th>
            <th>Summary</th>
            <th>Jira Status</th>
            <th>Status %</th>
            <th>Confid. %</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const issue of issues) {
      const f = issue.fields;
      const statusClass = UI.getStatusClass(f.status?.statusCategory?.key);
      const localStatus = this.getLocalField(issue.key, 'status');
      const localConfidence = this.getLocalField(issue.key, 'confidence');

      html += `
        <tr>
          <td>
            <span class="issue-type">
              ${f.issuetype?.iconUrl ? `<img src="${f.issuetype.iconUrl}" class="issue-type-icon" alt="">` : ''}
              ${UI.escapeHtml(f.issuetype?.name || '-')}
            </span>
          </td>
          <td>
            <span class="issue-key" data-key="${issue.key}">${issue.key}</span>
          </td>
          <td>
            <div class="issue-summary" title="${UI.escapeHtml(f.summary)}">${UI.escapeHtml(f.summary || '-')}</div>
          </td>
          <td>
            <span class="status-badge ${statusClass}">${UI.escapeHtml(f.status?.name || '-')}</span>
          </td>
          <td>
            <span class="editable-field editable-status" data-key="${issue.key}" data-field="status" title="Status (0-100)">${localStatus !== null ? localStatus + '%' : '—'}</span>
          </td>
          <td>
            <span class="editable-field editable-confidence" data-key="${issue.key}" data-field="confidence" title="Confidence (0-100)">${localConfidence !== null ? localConfidence + '%' : '—'}</span>
          </td>
          <td>${UI.escapeHtml(f.priority?.name || '-')}</td>
          <td>
            ${f.assignee
              ? `<span class="assignee">
                  <img src="${f.assignee.avatarUrls?.['24x24'] || ''}" class="assignee-avatar" alt="">
                  ${UI.escapeHtml(f.assignee.displayName)}
                </span>`
              : '<span class="assignee-unassigned">Unassigned</span>'}
          </td>
          <td>
            <a href="${jiraAPI.getIssueUrl(issue.key)}" target="_blank" class="table-jira-link" title="Open in Jira">↗</a>
          </td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    // Bind click handlers for issue keys and editable fields
    container.querySelectorAll('.issue-key').forEach(el => {
      el.addEventListener('click', () => {
        this.showIssueDetail(el.dataset.key);
      });
    });

    container.querySelectorAll('.editable-field').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startInlineEdit(el);
      });
    });
  }
  // === INLINE EDITING ===

  startInlineEdit(el) {
    // Prevent double editing
    if (el.querySelector('input')) return;

    const issueKey = el.dataset.key;
    const field = el.dataset.field;
    const currentValue = this.getLocalField(issueKey, field);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.className = 'inline-edit-input';
    input.value = currentValue !== null ? currentValue : '';
    input.placeholder = '0-100';

    // Save original HTML
    const originalHTML = el.innerHTML;
    el.innerHTML = '';
    el.classList.add('editing');
    el.appendChild(input);
    input.focus();
    input.select();

    const restoreContent = (value) => {
      el.classList.remove('editing');
      el.textContent = value !== null ? value + '%' : '—';
    };

    const save = async () => {
      const raw = input.value.trim();
      if (raw === '') {
        restoreContent(currentValue);
        return;
      }
      const val = parseInt(raw, 10);
      if (isNaN(val) || val < 0 || val > 100) {
        UI.toast('Value must be between 0 and 100', 'error');
        restoreContent(currentValue);
        return;
      }
      await this.saveLocalField(issueKey, field, val);
      restoreContent(val);
    };

    const cancel = () => {
      restoreContent(currentValue);
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.removeEventListener('blur', save);
        save();
      }
      if (e.key === 'Escape') {
        input.removeEventListener('blur', save);
        cancel();
      }
    });
  }

  async loadHistory(issueKey) {
    try {
      const res = await fetch(`/api/data/history/${issueKey}`);
      return await res.json();
    } catch (err) {
      console.error('Failed to load history:', err);
      return [];
    }
  }
}

// Initialize app
const app = new App();
