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
    this.selectedEpicKey = null;
    this.selectedEpicProject = null;

    // Local data (status, confidence per issue key)
    this.localData = {};

    // JQL filters
    this.jqlFilters = []; // [{ name, jql }]
    this.selectedJqlIndex = -1; // -1 = no filter

    // Keyboard navigation
    this.activePanel = 'themes';
    this.highlightedIndex = { themes: 0, milestones: -1, tasks: -1, epicTasks: -1 };

    // Progress history for sparklines
    this.progressHistory = {}; // { "KEY": [{ date, progress }, ...] }
    // Git activity data per issue
    this.gitActivity = {}; // { "KEY": { lastActivity, prCount, prMerged, prOpen, repoCount, commitCount } }
    // Developers per issue (last 30 days), grouped by role
    this.developers = {}; // { "KEY": { Dev: [...], Review: [...], QA: [...] } }

    this.init();
  }

  async init() {
    // Wait for server config to load
    await window.jiraConfigReady;
    this.serverConfig = window.jiraAPI.serverConfig || {};

    // Load local data (status/confidence)
    await this.loadLocalData();
    await this.loadProgressHistory();

    this.loadJqlFilters();
    this.bindEvents();
    this.updatePageTitle();
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

  async loadProgressHistory() {
    try {
      const res = await fetch('/api/progress/history');
      const data = await res.json();
      this.progressHistory = this._transformSnapshots(data.snapshots || {});
      this.gitActivity = data.gitActivity || {};
      this.developers = data.developers || {};
    } catch (err) {
      console.error('Failed to load progress history:', err);
      this.progressHistory = {};
      this.gitActivity = {};
      this.developers = {};
    }
  }

  _transformSnapshots(snapshots) {
    const progressResult = {};
    const dates = Object.keys(snapshots).sort();
    // Keep last 60 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    for (const date of dates) {
      if (date < cutoffStr) continue;
      const issues = snapshots[date];
      for (const [key, val] of Object.entries(issues)) {
        if (!progressResult[key]) progressResult[key] = [];
        progressResult[key].push({ date, progress: val.progress });
      }
    }
    return progressResult;
  }

  async startSnapshot() {
    const jql = this.getSelectedJql();
    const btn = document.getElementById('snapshotBtn');
    const statusEl = document.getElementById('snapshotStatus');
    btn.disabled = true;
    statusEl.textContent = 'Starting...';

    try {
      const res = await fetch('/api/progress/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jql })
      });
      const result = await res.json();
      if (!result.ok) {
        statusEl.textContent = result.error || 'Error';
        btn.disabled = false;
        return;
      }

      // Listen for SSE progress
      const es = new EventSource('/api/progress/snapshot/status');
      es.onmessage = async (event) => {
        const state = JSON.parse(event.data);
        statusEl.textContent = state.message || '';
        if (state.phase === 'done') {
          es.close();
          btn.disabled = false;
          statusEl.textContent = '';
          UI.toast(`Snapshot complete: ${state.totalIssues} issues`, 'info');
          await this.loadProgressHistory();
          this.loadThemes();
        } else if (state.phase === 'error') {
          es.close();
          btn.disabled = false;
          statusEl.textContent = 'Error: ' + (state.error || '');
        }
      };
      es.onerror = () => {
        es.close();
        btn.disabled = false;
        statusEl.textContent = '';
      };
    } catch (err) {
      btn.disabled = false;
      statusEl.textContent = 'Error';
      console.error('Snapshot error:', err);
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

  // === JQL FILTERS ===

  loadJqlFilters() {
    try {
      const saved = localStorage.getItem('jqlFilters');
      if (saved) this.jqlFilters = JSON.parse(saved);
    } catch (e) {}

    try {
      const idx = localStorage.getItem('selectedJqlIndex');
      if (idx !== null) this.selectedJqlIndex = parseInt(idx, 10);
    } catch (e) {}

    this.renderJqlDropdown();
  }

  saveJqlFilters() {
    localStorage.setItem('jqlFilters', JSON.stringify(this.jqlFilters));
    localStorage.setItem('selectedJqlIndex', String(this.selectedJqlIndex));
  }

  renderJqlDropdown() {
    const dropdown = document.getElementById('jqlDropdown');
    const removeBtn = document.getElementById('removeJqlBtn');
    const editBtn = document.getElementById('editJqlBtn');

    let html = '<option value="-1">— Select JQL —</option>';
    this.jqlFilters.forEach((f, i) => {
      const selected = i === this.selectedJqlIndex ? ' selected' : '';
      html += `<option value="${i}"${selected}>${UI.escapeHtml(f.name)}</option>`;
    });
    dropdown.innerHTML = html;

    // Show/hide edit & remove buttons
    const hasSelection = this.selectedJqlIndex >= 0;
    removeBtn.style.display = hasSelection ? '' : 'none';
    editBtn.style.display = hasSelection ? '' : 'none';
  }

  getSelectedJql() {
    if (this.selectedJqlIndex >= 0 && this.jqlFilters[this.selectedJqlIndex]) {
      return this.jqlFilters[this.selectedJqlIndex].jql;
    }
    return '';
  }

  getProjectFromJql() {
    const jql = this.getSelectedJql();
    if (!jql) return '';
    const match = jql.match(/project\s*=\s*['"]?([A-Za-z][A-Za-z0-9_]*)['"]?/i);
    return match ? match[1].toUpperCase() : '';
  }

  getSelectedLinkType() {
    if (this.selectedJqlIndex >= 0 && this.jqlFilters[this.selectedJqlIndex]) {
      return this.jqlFilters[this.selectedJqlIndex].linkType || 'Part';
    }
    return 'Part';
  }

  onJqlSelect(index) {
    this.selectedJqlIndex = index;
    this.saveJqlFilters();
    this.renderJqlDropdown();
    this.updatePageTitle();
    this.loadThemes();
  }

  updatePageTitle() {
    const titleEl = document.getElementById('pageTitle');
    if (this.selectedJqlIndex >= 0 && this.jqlFilters[this.selectedJqlIndex]) {
      titleEl.textContent = this.jqlFilters[this.selectedJqlIndex].name;
    } else {
      titleEl.textContent = 'Hierarchy';
    }
  }

  async loadLinkTypesDropdown(selectedValue) {
    const select = document.getElementById('jqlLinkType');
    select.innerHTML = '<option value="">Loading...</option>';
    try {
      const types = await jiraAPI.getIssueLinkTypes();
      let html = '<option value="">— Select link type —</option>';
      for (const t of types) {
        const sel = t.name === selectedValue ? ' selected' : '';
        html += `<option value="${UI.escapeHtml(t.name)}"${sel}>${UI.escapeHtml(t.name)} (${UI.escapeHtml(t.inward)} / ${UI.escapeHtml(t.outward)})</option>`;
      }
      select.innerHTML = html;
    } catch (err) {
      select.innerHTML = '<option value="">Failed to load</option>';
    }
  }

  async openAddJqlModal() {
    this._editingJqlIndex = -1;
    document.querySelector('#addJqlModal .modal-header h3').textContent = 'Add JQL';
    document.getElementById('jqlName').value = '';
    document.getElementById('jqlQuery').value = '';
    UI.openModal('addJqlModal');
    document.getElementById('jqlName').focus();
    await this.loadLinkTypesDropdown('');
  }

  async openEditJqlModal() {
    if (this.selectedJqlIndex < 0) return;
    const f = this.jqlFilters[this.selectedJqlIndex];
    this._editingJqlIndex = this.selectedJqlIndex;
    document.querySelector('#addJqlModal .modal-header h3').textContent = 'Edit JQL';
    document.getElementById('jqlName').value = f.name;
    document.getElementById('jqlQuery').value = f.jql;
    UI.openModal('addJqlModal');
    document.getElementById('jqlName').focus();
    await this.loadLinkTypesDropdown(f.linkType || '');
  }

  saveJqlFromModal() {
    const name = document.getElementById('jqlName').value.trim();
    const jql = document.getElementById('jqlQuery').value.trim();
    const linkType = document.getElementById('jqlLinkType').value;

    if (!name) {
      UI.toast('Enter a name', 'error');
      return;
    }
    if (!jql) {
      UI.toast('Enter a JQL query', 'error');
      return;
    }

    const entry = { name, jql, linkType: linkType || 'Part' };

    if (this._editingJqlIndex >= 0) {
      // Edit existing
      this.jqlFilters[this._editingJqlIndex] = entry;
      UI.toast(`JQL "${name}" updated`, 'success');
    } else {
      // Add new
      this.jqlFilters.push(entry);
      this.selectedJqlIndex = this.jqlFilters.length - 1;
      UI.toast(`JQL "${name}" added`, 'success');
    }

    this.saveJqlFilters();
    this.renderJqlDropdown();
    this.updatePageTitle();
    UI.closeModal('addJqlModal');
    this.loadThemes();
  }

  removeSelectedJql() {
    if (this.selectedJqlIndex < 0) return;
    const name = this.jqlFilters[this.selectedJqlIndex].name;
    this.jqlFilters.splice(this.selectedJqlIndex, 1);
    this.selectedJqlIndex = -1;
    this.saveJqlFilters();
    this.renderJqlDropdown();
    this.updatePageTitle();
    this.loadThemes();
    UI.toast(`JQL "${name}" removed`, 'success');
  }

  bindEvents() {
    // Snapshot button
    document.getElementById('snapshotBtn').addEventListener('click', () => {
      this.startSnapshot();
    });

    // JQL selector
    document.getElementById('jqlDropdown').addEventListener('change', (e) => {
      this.onJqlSelect(parseInt(e.target.value, 10));
    });

    document.getElementById('addJqlBtn').addEventListener('click', () => {
      this.openAddJqlModal();
    });

    document.getElementById('editJqlBtn').addEventListener('click', () => {
      this.openEditJqlModal();
    });

    document.getElementById('removeJqlBtn').addEventListener('click', () => {
      this.removeSelectedJql();
    });

    // Add JQL modal
    document.getElementById('closeAddJqlModal').addEventListener('click', () => {
      UI.closeModal('addJqlModal');
    });

    document.getElementById('cancelAddJqlBtn').addEventListener('click', () => {
      UI.closeModal('addJqlModal');
    });

    document.getElementById('saveJqlBtn').addEventListener('click', () => {
      this.saveJqlFromModal();
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
    document.getElementById('addEpicTaskBtn').addEventListener('click', () => {
      this.showInlineForm('epicTasks');
    });

    // Modal backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        e.target.closest('.modal').classList.remove('active');
      });
    });

    // ESC/ArrowLeft to close modals + keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Close git popup first if open
        if (document.querySelector('.git-popup')) {
          UI.hideGitPopup();
          e.preventDefault();
          return;
        }
        // Then close modals
        document.querySelectorAll('.modal.active').forEach(modal => {
          modal.classList.remove('active');
        });
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowLeft' && document.querySelector('.modal.active')) {
        document.querySelectorAll('.modal.active').forEach(modal => {
          modal.classList.remove('active');
        });
        e.preventDefault();
        return;
      }
      this.handleKeyboardNav(e);
    });
  }

  _handleGitDotClick(dotEl) {
    const issueKey = dotEl.dataset.issueKey;
    const gitData = this.gitActivity[issueKey] || null;

    // Collect children git data for parent issues
    const childrenGit = {};
    // Check all gitActivity keys that might be children of this issue
    // We look through loaded hierarchy data for children
    const allIssues = this._getAllLoadedIssues();
    const parentIssue = allIssues.find(i => i.key === issueKey);
    if (parentIssue && parentIssue._childKeys) {
      for (const ck of parentIssue._childKeys) {
        if (this.gitActivity[ck]) {
          childrenGit[ck] = this.gitActivity[ck];
        }
      }
    }

    UI.showGitPopup(gitData, dotEl, issueKey, childrenGit);
  }

  _getAllLoadedIssues() {
    // Collect all issues from current hierarchy state
    const result = [];
    const collectFromList = (list, childKeysFn) => {
      if (!list) return;
      for (const item of list) {
        const issue = { key: item.key, _childKeys: childKeysFn ? childKeysFn(item) : [] };
        result.push(issue);
      }
    };
    // Themes
    collectFromList(this.themes, t => {
      const ms = this.milestonesByTheme?.[t.key] || [];
      const keys = ms.map(m => m.key);
      // Also add epic keys for each milestone
      for (const m of ms) {
        const epics = this.epicsByMilestone?.[m.key] || [];
        keys.push(...epics.map(e => e.key));
        for (const e of epics) {
          const children = this.childrenByEpic?.[e.key] || [];
          keys.push(...children.map(c => c.key));
        }
      }
      return keys;
    });
    // Milestones
    if (this.milestones) {
      collectFromList(this.milestones, m => {
        const epics = this.epicsByMilestone?.[m.key] || [];
        const keys = epics.map(e => e.key);
        for (const e of epics) {
          const children = this.childrenByEpic?.[e.key] || [];
          keys.push(...children.map(c => c.key));
        }
        return keys;
      });
    }
    // Epics in tasks view
    if (this.epics) {
      collectFromList(this.epics, e => {
        const children = this.childrenByEpic?.[e.key] || [];
        return children.map(c => c.key);
      });
    }
    return result;
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

      ${(() => {
        const devsByRole = this.developers[issue.key] || {};
        const roles = Object.keys(devsByRole);
        if (roles.length === 0) return '';
        const totalDevs = new Set(roles.flatMap(r => devsByRole[r].map(d => d.displayName))).size;
        const roleLabels = { BA: 'Author / BA', Dev: 'Development', QA: 'QA / Testing' };
        const roleOrder = ['BA', 'Dev', 'QA'];
        return `
          <div class="issue-detail-section">
            <h4>Team — last 30 days (${totalDevs})</h4>
            ${roleOrder.filter(r => devsByRole[r]?.length > 0).map(role => `
              <div class="developers-role-group">
                <div class="developers-role-label">${roleLabels[role] || role}</div>
                <div class="developers-list">
                  ${devsByRole[role].map(d => `
                    <span class="developer-chip">
                      ${d.avatarUrl ? `<img src="${d.avatarUrl}" class="developer-avatar" alt="">` : ''}
                      ${UI.escapeHtml(d.displayName)}
                    </span>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>`;
      })()}

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
    document.getElementById('addEpicTaskBtn').disabled = true;
    document.getElementById('milestonesContainer').innerHTML = UI.renderEmpty('🎯', 'Select a Theme');
    document.getElementById('milestonesCount').textContent = '';
    document.getElementById('hierarchyTasksContainer').innerHTML = UI.renderEmpty('📋', 'Select a Milestone');
    document.getElementById('hierarchyTasksCount').textContent = '';
    this.resetEpicTasksPanel();

    try {
      // Always filter by label "theme"; combine with selected JQL filter or server config
      const userJql = this.getSelectedJql() || this.serverConfig?.hierarchyJql || '';
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

      // Keyboard: highlight first theme and auto-select it with full cascade
      this.activePanel = 'themes';
      this.highlightedIndex.themes = data.issues.length > 0 ? 0 : -1;
      this.applyHighlight('themes');
      if (data.issues.length > 0) {
        this._kbStayInPanel = 'themes';
        this.selectTheme(data.issues[0].key).then(async () => {
          await this._cascadeSelectFirst('milestones');
          this.activePanel = 'themes';
          this.applyHighlight('themes');
          this._kbStayInPanel = null;
        });
      }
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
    document.getElementById('addEpicTaskBtn').disabled = true;

    // Reset tasks panel
    document.getElementById('hierarchyTasksContainer').innerHTML = UI.renderEmpty('📋', 'Select a Milestone');
    document.getElementById('hierarchyTasksCount').textContent = '';
    this.resetEpicTasksPanel();

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

      // Collect ALL linked issue keys (both outward and inward), excluding clones/duplicates
      const EXCLUDED = ['cloners', 'duplicate'];
      const linkedKeys = [];
      for (const link of links) {
        const typeName = (link.type?.name || '').toLowerCase();
        if (EXCLUDED.some(ex => typeName.includes(ex))) continue;
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

      // Keyboard: highlight first milestone
      this.activePanel = 'milestones';
      this.highlightedIndex.milestones = data.issues.length > 0 ? 0 : -1;
      this.applyHighlight('milestones');
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
    document.getElementById('addEpicTaskBtn').disabled = true;
    this.resetEpicTasksPanel();

    const tasksContainer = document.getElementById('hierarchyTasksContainer');
    const tasksCount = document.getElementById('hierarchyTasksCount');

    // Add loading overlay without removing current content (prevents layout jump)
    tasksContainer.classList.add('loading-overlay');

    try {
      // Get the milestone issue to read its links
      const milestone = await jiraAPI.getIssue(issueKey);
      this.selectedMilestoneProject = milestone.fields.project?.key || null;
      const links = milestone.fields.issuelinks || [];

      // Collect ALL linked issue keys (both outward and inward), excluding clones/duplicates
      const EXCLUDED = ['cloners', 'duplicate'];
      const linkedKeys = [];
      for (const link of links) {
        const typeName = (link.type?.name || '').toLowerCase();
        if (EXCLUDED.some(ex => typeName.includes(ex))) continue;
        if (link.outwardIssue) linkedKeys.push(link.outwardIssue.key);
        if (link.inwardIssue) linkedKeys.push(link.inwardIssue.key);
      }

      if (linkedKeys.length === 0) {
        tasksContainer.classList.remove('loading-overlay');
        tasksContainer.innerHTML = UI.renderEmpty('📋', 'No linked tasks');
        tasksCount.textContent = '';
        return;
      }

      // Fetch linked issues EXCLUDING themes and milestones (include issues with no labels)
      const jql = `key in (${linkedKeys.join(',')}) AND (labels is EMPTY OR (labels != theme AND labels != milestone)) ORDER BY updated DESC`;
      const data = await jiraAPI.searchIssues(jql, 0, 200);
      tasksContainer.classList.remove('loading-overlay');
      tasksCount.textContent = data.total > 0 ? data.total : '';
      this.renderHierarchyTasks(tasksContainer, data.issues);

      // Keyboard: highlight first task
      this.activePanel = 'tasks';
      this.highlightedIndex.tasks = data.issues.length > 0 ? 0 : -1;
      this.applyHighlight('tasks');
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
        <span class="hlh-sparkline">Trend</span>
        <span class="hlh-sparkline">Git</span>
        <span class="hlh-link"></span>
      </div>`;
    for (const issue of issues) {
      const f = issue.fields;
      // Count child items: only outward links, excluding clone/duplicate
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
            <a href="${jiraAPI.getIssueUrl(issue.key)}" target="_blank" class="issue-key" onclick="event.stopPropagation()" title="Open in Jira">${issue.key}</a>
            <span class="hierarchy-summary">${UI.escapeHtml(f.summary)}</span>
            <span class="editable-field editable-status" data-key="${issue.key}" data-field="status" title="Status (0-100)">${status !== null ? status + '%' : '—'}</span>
            <span class="editable-field editable-confidence" data-key="${issue.key}" data-field="confidence" title="Confidence (0-100)">${confidence !== null ? confidence + '%' : '—'}</span>
            <span class="hierarchy-items-count" title="Child items">${childCount}</span>
            <span class="hierarchy-sparkline">${UI.renderSparkline(this.progressHistory[issue.key] || [])}</span>
            <span class="hierarchy-git-dot">${UI.renderGitDot(this.gitActivity[issue.key], issue.key)}</span>
            <span class="hierarchy-detail-btn" data-key="${issue.key}" title="View details">👁</span>
          </div>
        </div>
      `;
    }
    html += '</div>';
    container.innerHTML = html;

    // Bind click handlers
    container.querySelectorAll('.hierarchy-row').forEach(row => {
      row.addEventListener('click', (e) => {
        // If clicking on git dot, show popup
        if (e.target.classList.contains('git-dot') && e.target.dataset.issueKey) {
          e.stopPropagation();
          this._handleGitDotClick(e.target);
          return;
        }
        // If clicking on editable field, handle inline edit
        if (e.target.classList.contains('editable-field')) {
          e.stopPropagation();
          this.startInlineEdit(e.target);
          return;
        }
        // If clicking on detail button (eye icon), open detail modal
        if (e.target.classList.contains('hierarchy-detail-btn')) {
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
      tasks: 'hierarchyTasksContainer',
      epicTasks: 'epicTasksContainer'
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

    // For tasks or epicTasks: type dropdown
    if (panel === 'tasks' || panel === 'epicTasks') {
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

    // Pre-fill project key from JQL for themes
    if (panel === 'themes') {
      const projectKey = this.getProjectFromJql();
      if (projectKey) {
        const projectInput = form.querySelector('#inlineProjectKey');
        if (projectInput) projectInput.value = projectKey;
      }
    }

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
      } else if (panel === 'epicTasks') {
        await this.createEpicTask(summary);
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

    // Link milestone to theme (milestone "is a part of" theme)
    await jiraAPI.createIssueLink(result.key, this.selectedThemeKey, this.getSelectedLinkType());
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

    // Link task to milestone (task "is a part of" milestone)
    await jiraAPI.createIssueLink(result.key, this.selectedMilestoneKey, this.getSelectedLinkType());
    UI.toast(`${issueType} ${result.key} created`, 'success');

    // Reload tasks for current milestone
    await this.selectMilestone(this.selectedMilestoneKey);
  }

  resetEpicTasksPanel() {
    this.selectedEpicKey = null;
    this.selectedEpicProject = null;
    document.getElementById('epicTasksContainer').innerHTML = UI.renderEmpty('📋', 'Select an Epic');
    document.getElementById('epicTasksCount').textContent = '';
    document.getElementById('addEpicTaskBtn').disabled = true;
  }

  async selectEpic(issueKey) {
    this.selectedEpicKey = issueKey;

    // Highlight selected epic row
    document.querySelectorAll('#hierarchyTasksContainer tr.epic-row').forEach(row => {
      row.classList.toggle('selected', row.dataset.key === issueKey);
    });

    // Enable epic task button
    document.getElementById('addEpicTaskBtn').disabled = false;

    const container = document.getElementById('epicTasksContainer');
    const countEl = document.getElementById('epicTasksCount');
    container.classList.add('loading-overlay');

    try {
      const epic = await jiraAPI.getIssue(issueKey);
      this.selectedEpicProject = epic.fields.project?.key || null;
      const links = epic.fields.issuelinks || [];

      // Collect linked keys excluding clones/duplicates/themes/milestones
      const EXCLUDED = ['cloners', 'duplicate'];
      const linkedKeys = [];
      for (const link of links) {
        const typeName = (link.type?.name || '').toLowerCase();
        if (EXCLUDED.some(ex => typeName.includes(ex))) continue;
        if (link.outwardIssue) linkedKeys.push(link.outwardIssue.key);
        if (link.inwardIssue) linkedKeys.push(link.inwardIssue.key);
      }

      if (linkedKeys.length === 0) {
        container.classList.remove('loading-overlay');
        container.innerHTML = UI.renderEmpty('📋', 'No linked tasks');
        countEl.textContent = '';
        return;
      }

      // Fetch linked issues excluding themes and milestones
      const jql = `key in (${linkedKeys.join(',')}) AND (labels is EMPTY OR (labels != theme AND labels != milestone)) ORDER BY updated DESC`;
      const data = await jiraAPI.searchIssues(jql, 0, 200);
      container.classList.remove('loading-overlay');

      countEl.textContent = data.total > 0 ? data.total : '';

      this.renderHierarchyTasks(container, data.issues, 'epicSubTasks');

      // Keyboard: highlight first epic task
      this.activePanel = 'epicTasks';
      this.highlightedIndex.epicTasks = data.issues.length > 0 ? 0 : -1;
      this.applyHighlight('epicTasks');
    } catch (err) {
      container.classList.remove('loading-overlay');
      container.innerHTML = UI.renderError(err.message);
    }
  }

  async createEpicTask(summary) {
    if (!this.selectedEpicKey || !this.selectedEpicProject) {
      UI.toast('Select an Epic first', 'error');
      return;
    }

    const projectKey = this.selectedEpicProject;
    const issueType = document.getElementById('inlineIssueType')?.value || 'Story';
    const result = await jiraAPI.createIssue(projectKey, summary, issueType, []);

    // Link task to epic
    await jiraAPI.createIssueLink(result.key, this.selectedEpicKey, this.getSelectedLinkType());
    UI.toast(`${issueType} ${result.key} created`, 'success');

    // Reload epic tasks
    await this.selectEpic(this.selectedEpicKey);
  }

  /**
   * Render tasks table
   * @param {string} context - 'epicTasks' (no Jira Status, no Priority), 'epicSubTasks' (no Jira Status, no Priority), or 'default' (all columns)
   */
  renderHierarchyTasks(container, issues, context = 'epicTasks') {
    if (issues.length === 0) {
      container.innerHTML = UI.renderEmpty('📋', 'No tasks');
      return;
    }

    const showJiraStatus = context !== 'epicTasks' && context !== 'epicSubTasks';
    const showPriority = context !== 'epicTasks' && context !== 'epicSubTasks';
    const showLocalFields = context !== 'epicSubTasks';
    const showProgress = context === 'epicSubTasks';
    const compactType = context === 'epicTasks' || context === 'epicSubTasks';

    let colgroup = '<colgroup>';
    colgroup += compactType ? '<col style="width: 32px;">' : '<col style="width: 90px;">';   // Type
    colgroup += '<col style="width: 130px;">';  // Key
    colgroup += '<col>';                         // Summary
    if (showJiraStatus) colgroup += '<col style="width: 120px;">'; // Jira Status
    if (showLocalFields) colgroup += '<col style="width: 80px;">';   // Status %
    if (showLocalFields) colgroup += '<col style="width: 80px;">';   // Confid. %
    if (showPriority) colgroup += '<col style="width: 100px;">';   // Priority
    const showItemsCount = context === 'epicTasks';
    if (showItemsCount) colgroup += '<col style="width: 50px;">';  // Items
    if (showProgress) colgroup += '<col style="width: 80px;">';   // Progress
    colgroup += '<col style="width: 84px;">';   // Trend
    colgroup += '<col style="width: 36px;">';   // Git
    colgroup += '<col style="width: 140px;">';  // Assignee
    colgroup += '<col style="width: 36px;">';   // Link
    colgroup += '</colgroup>';

    let thead = compactType ? '<tr><th>T</th>' : '<tr><th>Type</th>';
    thead += '<th>Key</th><th>Summary</th>';
    if (showJiraStatus) thead += '<th>Jira Status</th>';
    if (showLocalFields) thead += '<th>Status %</th><th>Confid. %</th>';
    if (showPriority) thead += '<th>Priority</th>';
    if (showItemsCount) thead += '<th>Items</th>';
    if (showProgress) thead += '<th>Progress</th>';
    thead += '<th>Trend</th><th>Git</th><th>Assignee</th><th></th></tr>';

    let html = `
      <table class="issues-table issues-table-fixed">
        ${colgroup}
        <thead>${thead}</thead>
        <tbody>
    `;

    for (const issue of issues) {
      const f = issue.fields;
      const statusClass = UI.getStatusClass(f.status?.statusCategory?.key);
      const localStatus = this.getLocalField(issue.key, 'status');
      const localConfidence = this.getLocalField(issue.key, 'confidence');

      const EXCLUDED_LINK_TYPES = ['cloners', 'duplicate'];
      const childCount = (f.issuelinks || []).filter(link => {
        if (!link.outwardIssue) return false;
        const typeName = (link.type?.name || '').toLowerCase();
        if (EXCLUDED_LINK_TYPES.some(ex => typeName.includes(ex))) return false;
        return true;
      }).length;
      const isEpic = f.issuetype?.name === 'Epic' || (showItemsCount && childCount > 0);

      html += `
        <tr class="${isEpic ? 'epic-row' : ''}" data-key="${issue.key}">
          <td>${compactType
            ? `<span class="issue-type-compact" title="${UI.escapeHtml(f.issuetype?.name || '-')}">${UI.escapeHtml((f.issuetype?.name || '-')[0])}</span>`
            : `<span class="issue-type">
                ${f.issuetype?.iconUrl ? `<img src="${f.issuetype.iconUrl}" class="issue-type-icon" alt="">` : ''}
                ${UI.escapeHtml(f.issuetype?.name || '-')}
              </span>`}
          </td>
          <td>
            <a href="${jiraAPI.getIssueUrl(issue.key)}" target="_blank" class="issue-key" title="Open in Jira">${issue.key}</a>
          </td>
          <td>
            <div class="issue-summary" title="${UI.escapeHtml(f.summary)}">${UI.escapeHtml(f.summary || '-')}</div>
          </td>`;

      if (showJiraStatus) {
        html += `
          <td>
            <span class="status-badge ${statusClass}">${UI.escapeHtml(f.status?.name || '-')}</span>
          </td>`;
      }

      if (showLocalFields) {
        html += `
          <td>
            <span class="editable-field editable-status" data-key="${issue.key}" data-field="status" title="Status (0-100)">${localStatus !== null ? localStatus + '%' : '—'}</span>
          </td>
          <td>
            <span class="editable-field editable-confidence" data-key="${issue.key}" data-field="confidence" title="Confidence (0-100)">${localConfidence !== null ? localConfidence + '%' : '—'}</span>
          </td>`;
      }

      if (showPriority) {
        html += `<td>${UI.escapeHtml(f.priority?.name || '-')}</td>`;
      }

      if (showItemsCount) {
        html += `<td class="items-count-cell">${childCount || ''}</td>`;
      }

      if (showProgress) {
        const pct = App.statusToProgress(f.status?.name);
        html += `<td class="progress-cell"><span class="progress-badge progress-${pct}">${pct}%</span></td>`;
      }

      html += `<td class="sparkline-cell">${UI.renderSparkline(this.progressHistory[issue.key] || [])}</td>`;
      html += `<td class="git-dot-cell">${UI.renderGitDot(this.gitActivity[issue.key], issue.key)}</td>`;

      html += `
          <td>
            ${f.assignee
              ? `<span class="assignee">
                  <img src="${f.assignee.avatarUrls?.['24x24'] || ''}" class="assignee-avatar" alt="">
                  ${UI.escapeHtml(f.assignee.displayName)}
                </span>`
              : '<span class="assignee-unassigned">Unassigned</span>'}
          </td>
          <td>
            <span class="table-detail-btn" data-key="${issue.key}" title="View details">👁</span>
          </td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    // Bind click handlers for detail buttons (eye icon) and editable fields
    container.querySelectorAll('.table-detail-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showIssueDetail(el.dataset.key);
      });
    });

    container.querySelectorAll('.editable-field').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startInlineEdit(el);
      });
    });

    // Git dot click handlers
    container.querySelectorAll('.git-dot[data-issue-key]').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        this._handleGitDotClick(dot);
      });
    });

    // Make epic rows clickable to load their child tasks
    container.querySelectorAll('tr.epic-row').forEach(row => {
      row.style.cursor = 'pointer';
      row.addEventListener('click', (e) => {
        // Don't trigger if clicking on interactive elements
        if (e.target.classList.contains('issue-key') || e.target.classList.contains('editable-field') || e.target.classList.contains('git-dot') || e.target.classList.contains('table-detail-btn')) return;
        this.selectEpic(row.dataset.key);
      });
    });
  }
  // === KEYBOARD NAVIGATION ===

  static PANELS = ['themes', 'milestones', 'tasks', 'epicTasks'];

  static STATUS_PROGRESS_MAP = {
    'open': 0, 'to do': 0, 'backlog': 0, 'new': 0, 'reopened': 0,
    'in development': 20, 'in progress': 20, 'dev': 20, 'in review': 20, 'review': 20, 'code review': 20,
    'qa': 40, 'in qa': 40, 'in testing': 40, 'testing': 40, 'ready for qa': 40,
    'uat': 60, 'in uat': 60, 'user acceptance': 60, 'ready for uat': 60,
    'uat done': 80, 'ready for prod': 80, 'ready for release': 80, 'ready for deploy': 80,
    'resolved': 100, 'closed': 100, 'done': 100, 'released': 100
  };

  static statusToProgress(statusName) {
    if (!statusName) return 0;
    const name = statusName.toLowerCase().trim();
    if (App.STATUS_PROGRESS_MAP.hasOwnProperty(name)) {
      return App.STATUS_PROGRESS_MAP[name];
    }
    // Fallback: partial match
    for (const [key, val] of Object.entries(App.STATUS_PROGRESS_MAP)) {
      if (name.includes(key) || key.includes(name)) return val;
    }
    return 0;
  }
  static PANEL_CONFIG = {
    themes:     { containerId: 'themesContainer',         rowSelector: '.hierarchy-row' },
    milestones: { containerId: 'milestonesContainer',     rowSelector: '.hierarchy-row' },
    tasks:      { containerId: 'hierarchyTasksContainer', rowSelector: 'tr[data-key]' },
    epicTasks:  { containerId: 'epicTasksContainer',      rowSelector: 'tr[data-key]' }
  };

  getPanelRows(panel) {
    const cfg = App.PANEL_CONFIG[panel];
    const container = document.getElementById(cfg.containerId);
    return container ? Array.from(container.querySelectorAll(cfg.rowSelector)) : [];
  }

  applyHighlight(panel) {
    // Remove highlights from ALL panels
    for (const p of App.PANELS) {
      this.getPanelRows(p).forEach(r => r.classList.remove('kb-highlight'));
    }
    // Apply highlight in the active panel
    const rows = this.getPanelRows(panel);
    const idx = this.highlightedIndex[panel];
    if (idx >= 0 && idx < rows.length) {
      rows[idx].classList.add('kb-highlight');
      rows[idx].scrollIntoView({ block: 'nearest' });
    }
  }

  getHighlightedKey(panel) {
    const rows = this.getPanelRows(panel);
    const idx = this.highlightedIndex[panel];
    if (idx >= 0 && idx < rows.length) {
      return rows[idx].dataset.key;
    }
    return null;
  }

  handleKeyboardNav(e) {
    // Ignore if modal is open or focus is on input
    if (document.querySelector('.modal.active')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const panel = this.activePanel;
    const rows = this.getPanelRows(panel);
    if (rows.length === 0 && e.key !== 'ArrowLeft') return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const max = rows.length - 1;
        this.highlightedIndex[panel] = Math.min((this.highlightedIndex[panel] ?? -1) + 1, max);
        this.applyHighlight(panel);
        this._autoSelectPanel(panel);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        this.highlightedIndex[panel] = Math.max((this.highlightedIndex[panel] ?? 0) - 1, 0);
        this.applyHighlight(panel);
        this._autoSelectPanel(panel);
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        const panelIdxR = App.PANELS.indexOf(panel);
        if (panelIdxR < App.PANELS.length - 1) {
          // For tasks→epicTasks, only allow if current row is an epic
          if (panel === 'tasks') {
            const row = rows[this.highlightedIndex[panel]];
            if (!row || !row.classList.contains('epic-row')) break;
          }
          const nextPanel = App.PANELS[panelIdxR + 1];
          const nextRows = this.getPanelRows(nextPanel);
          if (nextRows.length > 0) {
            this.activePanel = nextPanel;
            if (this.highlightedIndex[nextPanel] < 0) {
              this.highlightedIndex[nextPanel] = 0;
            }
            this.applyHighlight(this.activePanel);
          }
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const panelIdx = App.PANELS.indexOf(panel);
        if (panelIdx > 0) {
          this.activePanel = App.PANELS[panelIdx - 1];
          this.applyHighlight(this.activePanel);
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const detailKey = this.getHighlightedKey(panel);
        if (detailKey) {
          this.showIssueDetail(detailKey);
        }
        break;
      }
    }
  }

  async _autoSelectPanel(panel) {
    const key = this.getHighlightedKey(panel);
    if (!key) return;
    const stayPanel = panel;
    this._kbStayInPanel = stayPanel;
    try {
      if (panel === 'themes') {
        await this.selectTheme(key);
        // Cascade: auto-select first milestone
        await this._cascadeSelectFirst('milestones');
      } else if (panel === 'milestones') {
        await this.selectMilestone(key);
        // Cascade: auto-select first task/epic
        await this._cascadeSelectFirst('tasks');
      } else if (panel === 'tasks') {
        const rows = this.getPanelRows(panel);
        const row = rows[this.highlightedIndex[panel]];
        if (row && row.classList.contains('epic-row')) {
          await this.selectEpic(key);
        }
      }
    } finally {
      this.activePanel = stayPanel;
      this.applyHighlight(stayPanel);
      this._kbStayInPanel = null;
    }
  }

  async _cascadeSelectFirst(panel) {
    const rows = this.getPanelRows(panel);
    if (rows.length === 0) return;
    this.highlightedIndex[panel] = 0;
    const key = rows[0].dataset.key;
    if (!key) return;

    if (panel === 'milestones') {
      await this.selectMilestone(key);
      // Continue cascade into tasks
      await this._cascadeSelectFirst('tasks');
    } else if (panel === 'tasks') {
      // If first task is an epic, auto-select it to load epic tasks
      const row = rows[0];
      if (row && row.classList.contains('epic-row')) {
        await this.selectEpic(key);
      }
    }
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
