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
    this.focusedPanel = 'theme'; // 'theme' | 'milestone' — default: themes detailed

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

    // Computed State cache: { "KEY": percentNumber }
    this.computedStates = {};

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

  async startSnapshot(mode = 'all') {
    const jql = this.getSelectedJql();
    const trendBtn = document.getElementById('snapshotTrendBtn');
    const gitBtn = document.getElementById('snapshotGitBtn');
    const statusEl = document.getElementById('snapshotStatus');
    trendBtn.disabled = true;
    gitBtn.disabled = true;
    statusEl.textContent = 'Starting...';

    try {
      const res = await fetch('/api/progress/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jql, mode })
      });
      const result = await res.json();
      if (!result.ok) {
        statusEl.textContent = result.error || 'Error';
        trendBtn.disabled = false;
        gitBtn.disabled = false;
        return;
      }

      // Listen for SSE progress
      const es = new EventSource('/api/progress/snapshot/status');
      es.onmessage = async (event) => {
        const state = JSON.parse(event.data);
        statusEl.textContent = state.message || '';
        if (state.phase === 'done') {
          es.close();
          trendBtn.disabled = false;
          gitBtn.disabled = false;
          statusEl.textContent = '';
          UI.toast(`Snapshot complete: ${state.totalIssues} issues`, 'info');
          await this.loadProgressHistory();
          this.loadThemes();
        } else if (state.phase === 'error') {
          es.close();
          trendBtn.disabled = false;
          gitBtn.disabled = false;
          statusEl.textContent = 'Error: ' + (state.error || '');
        }
      };
      es.onerror = () => {
        es.close();
        trendBtn.disabled = false;
        gitBtn.disabled = false;
        statusEl.textContent = '';
      };
    } catch (err) {
      trendBtn.disabled = false;
      gitBtn.disabled = false;
      statusEl.textContent = 'Error';
      console.error('Snapshot error:', err);
    }
  }

  async exportRoadmap() {
    const btn = document.getElementById('exportRoadmapBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Exporting...';

    try {
      const jql = this.getSelectedJql() || this.serverConfig?.hierarchyJql || '';
      const params = jql ? `?jql=${encodeURIComponent(jql)}` : '';
      const res = await fetch(`/api/export/roadmap${params}`);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Export failed');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `roadmap-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      UI.toast('Roadmap exported successfully', 'success');
    } catch (err) {
      UI.toast(`Export error: ${err.message}`, 'error');
      console.error('Export error:', err);
    } finally {
      btn.disabled = false;
      btn.textContent = '📊 Export';
    }
  }

  async exportTasks() {
    if (!this.currentTaskIssues || this.currentTaskIssues.length === 0) {
      UI.toast('No tasks to export', 'error');
      return;
    }

    const btn = document.getElementById('exportTasksBtn');
    btn.disabled = true;
    btn.textContent = '⏳';

    try {
      const issues = this.currentTaskIssues.map(issue => ({
        key: issue.key,
        summary: issue.fields?.summary || '',
        status: issue.fields?.status?.name || '',
      }));

      const res = await fetch('/api/export/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issues }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Export failed');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tasks-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      UI.toast('Tasks exported', 'success');
    } catch (err) {
      UI.toast(`Export error: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📥';
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
    // Export roadmap button
    document.getElementById('exportRoadmapBtn').addEventListener('click', () => {
      this.exportRoadmap();
    });

    // Export tasks button
    document.getElementById('exportTasksBtn').addEventListener('click', () => {
      this.exportTasks();
    });

    // Snapshot buttons
    document.getElementById('snapshotTrendBtn').addEventListener('click', () => {
      this.startSnapshot('trend');
    });
    document.getElementById('snapshotGitBtn').addEventListener('click', () => {
      this.startSnapshot('git');
    });

    // Debug panel
    document.getElementById('debugPanelBtn').addEventListener('click', () => {
      this.openDebugPanel();
    });
    document.getElementById('closeDebugModal').addEventListener('click', () => {
      UI.closeModal('debugModal');
    });
    document.getElementById('debugRefreshBtn').addEventListener('click', () => {
      this.openDebugPanel();
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
    document.getElementById('linkIssueBtn').addEventListener('click', () => {
      this.openLinkIssueModal();
    });
    document.getElementById('closeLinkIssueModal').addEventListener('click', () => {
      UI.closeModal('linkIssueModal');
      this._onLinkIssueModalClose();
    });
    document.getElementById('linkIssueFilterInput').addEventListener('input', (e) => {
      this._filterLinkIssueList(e.target.value);
    });
    // Delegate click on link buttons inside the modal
    document.getElementById('linkIssueList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-link-key]');
      if (btn && !btn.disabled) {
        this.linkExistingIssue(btn.dataset.linkKey);
      }
    });
    document.getElementById('addEpicTaskBtn').addEventListener('click', () => {
      this.showInlineForm('epicTasks');
    });

    // Modal backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal');
        modal.classList.remove('active');
        if (modal.id === 'linkIssueModal') {
          this._onLinkIssueModalClose();
        }
      });
    });

    // ESC/ArrowLeft to close modals + keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Close devqa popup first if open
        if (document.querySelector('.devqa-popup')) {
          UI.hideDevQaPopup();
          e.preventDefault();
          return;
        }
        // Close trend popup if open
        if (document.querySelector('.trend-popup')) {
          UI.hideTrendPopup();
          e.preventDefault();
          return;
        }
        // Close git popup if open
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

  _handleSparklineClick(sparklineEl) {
    const issueKey = sparklineEl.dataset.issueKey;
    const dataPoints = this.progressHistory[issueKey] || [];

    // Collect children progress data
    const childrenProgress = {};
    const allIssues = this._getAllLoadedIssues();
    const parentIssue = allIssues.find(i => i.key === issueKey);
    if (parentIssue && parentIssue._childKeys) {
      for (const ck of parentIssue._childKeys) {
        if (this.progressHistory[ck]) {
          childrenProgress[ck] = this.progressHistory[ck];
        }
      }
    }

    UI.showTrendPopup(dataPoints, sparklineEl, issueKey, childrenProgress);
  }

  _handleDevQaClick(el) {
    const issueKey = el.dataset.key;
    const devsByRole = this.developers[issueKey] || {};
    UI.showDevQaPopup(devsByRole, el, issueKey);
  }

  _getDevQaInfo(issueKey) {
    const devsByRole = this.developers[issueKey] || {};
    const devNames = (devsByRole['Dev'] || []).map(d => d.displayName).filter(Boolean);
    const qaNames = (devsByRole['QA'] || []).map(d => d.displayName).filter(Boolean);
    const allNames = new Set([...devNames, ...qaNames]);
    const count = allNames.size;
    if (count === 0) return { count: 0, tooltip: '' };
    const lines = [];
    if (devNames.length > 0) lines.push('Dev: ' + devNames.join(', '));
    if (qaNames.length > 0) lines.push('QA: ' + qaNames.join(', '));
    return { count, tooltip: lines.join('\n') };
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
      const [issue, localHistory] = await Promise.all([
        jiraAPI.getIssue(issueKey),
        this.loadHistory(issueKey)
      ]);
      this.renderIssueDetail(issue, localHistory, localHistory);
    } catch (err) {
      bodyEl.innerHTML = UI.renderError(err.message);
    }
  }

  renderIssueDetail(issue, history = [], localHistory = []) {
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

      <div class="issue-detail-section">
        <h4>Local Data</h4>
        <div class="issue-detail-meta">
          <div class="issue-meta-item">
            <span class="issue-meta-label">Status (%)</span>
            <span class="editable-field editable-status" data-key="${issue.key}" data-field="status" title="Status (0-100)">${this.getLocalField(issue.key, 'status') !== null ? this.getLocalField(issue.key, 'status') + '%' : '—'}</span>
            <span class="local-sparkline">${UI.renderSparkline(this._buildLocalSparklineData(localHistory, 'status'), null, 120, 24)}</span>
          </div>
          <div class="issue-meta-item">
            <span class="issue-meta-label">Confidence (%)</span>
            <span class="editable-field editable-confidence" data-key="${issue.key}" data-field="confidence" title="Confidence (0-100)">${this.getLocalField(issue.key, 'confidence') !== null ? this.getLocalField(issue.key, 'confidence') + '%' : '—'}</span>
            <span class="local-sparkline">${UI.renderSparkline(this._buildLocalSparklineData(localHistory, 'confidence'), null, 120, 24)}</span>
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
    document.getElementById('linkIssueBtn').disabled = true;
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

      // Async: load average State (2 levels deep: theme → milestones → tasks)
      this._loadThemeStates(data.issues, container);

      // Keyboard: highlight first theme and auto-select it with full cascade
      this.activePanel = 'themes';
      this.highlightedIndex.themes = data.issues.length > 0 ? 0 : -1;
      this.applyHighlight('themes');
      if (data.issues.length > 0) {
        this._kbStayInPanel = 'themes';
        this._kbGeneration = (this._kbGeneration || 0) + 1;
        const gen = this._kbGeneration;
        this.selectTheme(data.issues[0].key).then(async () => {
          if (gen !== this._kbGeneration) return;
          await this._cascadeSelectFirst('milestones');
          if (gen !== this._kbGeneration) return;
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
    this.updateTableModes('theme');

    // Highlight selected theme
    document.querySelectorAll('#themesContainer .hierarchy-row').forEach(row => {
      row.classList.toggle('selected', row.dataset.key === issueKey);
    });

    // Enable milestone button, disable task button
    document.getElementById('addMilestoneBtn').disabled = false;
    document.getElementById('addTaskBtn').disabled = true;
    document.getElementById('linkIssueBtn').disabled = true;
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

      // Async: load State = avg of children's computed states
      this._loadMilestoneStates(data.issues, milestonesContainer);

      // Keyboard: highlight first milestone
      this.highlightedIndex.milestones = data.issues.length > 0 ? 0 : -1;
      if (!this._kbStayInPanel) {
        this.activePanel = 'milestones';
        this.applyHighlight('milestones');
      }
    } catch (err) {
      milestonesContainer.classList.remove('loading-overlay');
      milestonesContainer.innerHTML = UI.renderError(err.message);
    }
  }

  async selectMilestone(issueKey) {
    this.selectedMilestoneKey = issueKey;
    this.updateTableModes('milestone');

    // Highlight selected milestone
    document.querySelectorAll('#milestonesContainer .hierarchy-row').forEach(row => {
      row.classList.toggle('selected', row.dataset.key === issueKey);
    });

    // Enable task button + link button
    document.getElementById('addTaskBtn').disabled = false;
    document.getElementById('linkIssueBtn').disabled = false;
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
      this.currentTaskIssues = data.issues || [];
      document.getElementById('exportTasksBtn').style.display = this.currentTaskIssues.length > 0 ? '' : 'none';
      this.renderHierarchyTasks(tasksContainer, data.issues);

      // Async: fetch Epic Link child counts for epics and update badges
      this._loadEpicChildData(data.issues, tasksContainer);

      // Keyboard: highlight first task
      this.highlightedIndex.tasks = data.issues.length > 0 ? 0 : -1;
      if (!this._kbStayInPanel) {
        this.activePanel = 'tasks';
        this.applyHighlight('tasks');
      }
    } catch (err) {
      tasksContainer.classList.remove('loading-overlay');
      tasksContainer.innerHTML = UI.renderError(err.message);
    }
  }

  // ============================================================
  // STATE COMPUTATION (cascading averages with cache)
  // ============================================================

  /**
   * Extract linked keys from an issue (excluding clones/duplicates).
   */
  _extractLinkedKeys(issue) {
    const EXCLUDED = ['cloners', 'duplicate'];
    const keys = [];
    for (const link of (issue.fields?.issuelinks || [])) {
      const typeName = (link.type?.name || '').toLowerCase();
      if (EXCLUDED.some(ex => typeName.includes(ex))) continue;
      if (link.outwardIssue) keys.push(link.outwardIssue.key);
      if (link.inwardIssue) keys.push(link.inwardIssue.key);
    }
    return keys;
  }

  /**
   * Update State badge in DOM (works for both hierarchy-row and tr[data-key]).
   */
  _updateStateBadge(container, issueKey, avg, childCount) {
    const steps = [0, 20, 40, 60, 80, 100];
    const rounded = steps.reduce((prev, curr) => Math.abs(curr - avg) < Math.abs(prev - avg) ? curr : prev);

    // Try hierarchy-row first (themes/milestones), then tr (tables)
    const row = container.querySelector(`.hierarchy-row[data-key="${issueKey}"]`)
              || container.querySelector(`tr[data-key="${issueKey}"]`);
    if (!row) return;
    const stateEl = row.querySelector('[data-state-key]');
    if (stateEl) {
      // For hierarchy-row, stateEl is a span wrapping a badge
      if (stateEl.classList.contains('hierarchy-state')) {
        stateEl.innerHTML = rounded ? `<span class="progress-badge progress-${rounded}">${avg}%</span>` : '';
      } else {
        // For table cells, stateEl IS the badge
        stateEl.className = `progress-badge progress-${rounded}`;
        stateEl.textContent = `${avg}%`;
      }
      if (childCount > 0) stateEl.title = `Average of ${childCount} children`;
    }
  }

  /**
   * Fetch Epic Link children for an epic. Returns array of issues.
   */
  async _fetchEpicChildren(epicKey) {
    try {
      const res = await jiraAPI.searchIssues(`"Epic Link" = ${epicKey}`, 0, 200);
      return res.issues || [];
    } catch (e) {
      try {
        const res = await jiraAPI.searchIssues(`parent = ${epicKey}`, 0, 200);
        return res.issues || [];
      } catch (e2) { return []; }
    }
  }

  /**
   * Compute and cache states for a list of issue keys.
   * Leaf tasks → own statusToProgress.
   * Epics → average of Epic Link children's statusToProgress.
   * Returns map { key: statePercent }.
   */
  async _computeStatesForKeys(keys) {
    if (keys.length === 0) return {};

    // Find uncached keys
    const uncached = keys.filter(k => this.computedStates[k] === undefined);
    if (uncached.length > 0) {
      const jql = `key in (${uncached.join(',')})`;
      const data = await jiraAPI.searchIssues(jql, 0, 200);

      const epics = [];
      for (const issue of (data.issues || [])) {
        if (issue.fields?.issuetype?.name === 'Epic') {
          epics.push(issue);
        } else {
          // Leaf: own statusToProgress
          this.computedStates[issue.key] = App.statusToProgress(issue.fields?.status?.name);
        }
      }

      // Epics: fetch children in parallel, compute average
      if (epics.length > 0) {
        const epicPromises = epics.map(async (epic) => {
          const children = await this._fetchEpicChildren(epic.key);
          if (children.length === 0) {
            this.computedStates[epic.key] = App.statusToProgress(epic.fields?.status?.name);
          } else {
            const avg = Math.round(
              children.reduce((sum, ch) => sum + App.statusToProgress(ch.fields?.status?.name), 0) / children.length
            );
            this.computedStates[epic.key] = avg;
          }
        });
        await Promise.all(epicPromises);
      }
    }

    const result = {};
    for (const k of keys) {
      if (this.computedStates[k] !== undefined) result[k] = this.computedStates[k];
    }
    return result;
  }

  /**
   * Async: load Epic Link children data for Epics/Stories table.
   * Updates Items count + State badge. Stores computed state in cache.
   */
  async _loadEpicChildData(issues, container) {
    const epics = issues.filter(i => i.fields?.issuetype?.name === 'Epic');
    if (epics.length === 0) return;

    const promises = epics.map(async (epic) => {
      const children = await this._fetchEpicChildren(epic.key);
      return { key: epic.key, children };
    });

    const results = await Promise.all(promises);

    for (const { key, children } of results) {
      const row = container.querySelector(`tr[data-key="${key}"]`);
      if (!row) continue;

      // Update Items count
      if (children.length > 0) {
        const badge = row.querySelector('.hierarchy-items-count');
        if (badge) {
          const currentCount = parseInt(badge.textContent, 10) || 0;
          badge.textContent = currentCount + children.length;
          badge.title = `${currentCount} linked + ${children.length} Epic Link children`;
        }
      }

      // Compute and cache State
      if (children.length > 0) {
        const avg = Math.round(
          children.reduce((sum, ch) => sum + App.statusToProgress(ch.fields?.status?.name), 0) / children.length
        );
        this.computedStates[key] = avg;
      } else {
        const epicIssue = issues.find(i => i.key === key);
        this.computedStates[key] = App.statusToProgress(epicIssue?.fields?.status?.name);
      }

      // Update State badge in DOM
      this._updateStateBadge(container, key, this.computedStates[key], children.length);
    }

    // Also cache state for non-epics (leaf tasks in the table)
    for (const issue of issues) {
      if (this.computedStates[issue.key] === undefined) {
        this.computedStates[issue.key] = App.statusToProgress(issue.fields?.status?.name);
      }
    }
  }

  /**
   * Async: load State for milestones.
   * Milestone state = avg of children's computed states.
   * Children are tasks/epics (epics resolved recursively via _computeStatesForKeys).
   */
  async _loadMilestoneStates(milestones, container) {
    if (milestones.length === 0) return;

    // Check if all milestones are already cached
    const uncachedMs = milestones.filter(ms => this.computedStates[ms.key] === undefined);
    if (uncachedMs.length === 0) {
      // All cached — just render badges
      for (const ms of milestones) {
        this._updateStateBadge(container, ms.key, this.computedStates[ms.key], 0);
      }
      return;
    }

    // Collect children keys per milestone
    const msToChildren = {};
    const allChildKeys = new Set();
    for (const ms of milestones) {
      const linkedKeys = this._extractLinkedKeys(ms);
      msToChildren[ms.key] = linkedKeys;
      linkedKeys.forEach(k => allChildKeys.add(k));
    }
    if (allChildKeys.size === 0) return;

    try {
      // Filter to tasks/epics only
      const jql = `key in (${[...allChildKeys].join(',')}) AND (labels is EMPTY OR (labels != theme AND labels != milestone))`;
      const data = await jiraAPI.searchIssues(jql, 0, 200);
      const validKeys = new Set((data.issues || []).map(i => i.key));

      // Compute states for all children (epics resolved recursively)
      await this._computeStatesForKeys([...validKeys]);

      // Compute milestone averages
      for (const ms of milestones) {
        const childKeys = (msToChildren[ms.key] || []).filter(k => validKeys.has(k));
        const states = childKeys.map(k => this.computedStates[k]).filter(s => s !== undefined);
        if (states.length === 0) continue;
        const avg = Math.round(states.reduce((a, b) => a + b, 0) / states.length);
        this.computedStates[ms.key] = avg;
        this._updateStateBadge(container, ms.key, avg, states.length);
      }
    } catch (e) {
      console.error('[State] Failed to load milestone states:', e.message);
    }
  }

  /**
   * Async: load State for themes.
   * Theme state = avg of milestones' computed states.
   * Cascades: theme → milestones → tasks/epics → epic children.
   */
  async _loadThemeStates(themes, container) {
    if (themes.length === 0) return;

    // Check if all themes are already cached
    const uncachedThemes = themes.filter(t => this.computedStates[t.key] === undefined);
    if (uncachedThemes.length === 0) {
      // All cached — just render badges
      for (const theme of themes) {
        this._updateStateBadge(container, theme.key, this.computedStates[theme.key], 0);
      }
      return;
    }

    // Collect milestone keys per theme
    const themeToMsKeys = {};
    const allMsKeys = new Set();
    for (const theme of themes) {
      const linkedKeys = this._extractLinkedKeys(theme);
      themeToMsKeys[theme.key] = linkedKeys;
      linkedKeys.forEach(k => allMsKeys.add(k));
    }
    if (allMsKeys.size === 0) return;

    try {
      // 1. Fetch milestones (need their issuelinks)
      const msJql = `key in (${[...allMsKeys].join(',')}) AND labels = milestone`;
      const msData = await jiraAPI.searchIssues(msJql, 0, 200);
      const milestones = msData.issues || [];
      const validMsKeys = new Set(milestones.map(m => m.key));

      // 2. Collect task/epic keys from all milestones
      const msToChildren = {};
      const allChildKeys = new Set();
      for (const ms of milestones) {
        const childKeys = this._extractLinkedKeys(ms);
        msToChildren[ms.key] = childKeys;
        childKeys.forEach(k => allChildKeys.add(k));
      }

      // 3. Fetch and filter tasks/epics
      if (allChildKeys.size > 0) {
        const taskJql = `key in (${[...allChildKeys].join(',')}) AND (labels is EMPTY OR (labels != theme AND labels != milestone))`;
        const taskData = await jiraAPI.searchIssues(taskJql, 0, 200);
        const validChildKeys = new Set((taskData.issues || []).map(i => i.key));

        // 4. Compute states for all tasks/epics (epics resolved recursively)
        await this._computeStatesForKeys([...validChildKeys]);

        // 5. Compute milestone states = avg of children's computed states
        for (const ms of milestones) {
          const childKeys = (msToChildren[ms.key] || []).filter(k => validChildKeys.has(k));
          const states = childKeys.map(k => this.computedStates[k]).filter(s => s !== undefined);
          if (states.length === 0) continue;
          this.computedStates[ms.key] = Math.round(states.reduce((a, b) => a + b, 0) / states.length);
        }
      }

      // 6. Compute theme states = avg of milestones' computed states
      for (const theme of themes) {
        const msKeys = (themeToMsKeys[theme.key] || []).filter(k => validMsKeys.has(k));
        const states = msKeys.map(k => this.computedStates[k]).filter(s => s !== undefined);
        if (states.length === 0) continue;
        const avg = Math.round(states.reduce((a, b) => a + b, 0) / states.length);
        this.computedStates[theme.key] = avg;
        this._updateStateBadge(container, theme.key, avg, states.length);
      }
    } catch (e) {
      console.error('[State] Failed to load theme states:', e.message);
    }
  }

  renderHierarchyList(container, issues, level) {
    if (issues.length === 0) {
      const icons = { theme: '🏗️', milestone: '🎯' };
      const msgs = { theme: 'No themes', milestone: 'No milestones' };
      container.innerHTML = UI.renderEmpty(icons[level], msgs[level]);
      return;
    }

    const isSimplified = this.focusedPanel && this.focusedPanel !== level;
    let html = `<div class="hierarchy-list${isSimplified ? ' simplified' : ''}" data-panel="${level}">
      <div class="hierarchy-list-header">
        <span class="hlh-detail"></span>
        <span class="hlh-state">State</span>
        <span class="hlh-key">Key</span>
        <span class="hlh-summary">Summary</span>
        <span class="hlh-count hlh-items">Items</span>
        <span class="hlh-count hlh-devqa">#D/Q</span>
        <span class="hlh-count hlh-sp">SP</span>
        <span class="hlh-edit hlh-status">S%</span>
        <span class="hlh-edit hlh-confidence">C%</span>
        <span class="hlh-ddate">D Date</span>
        <span class="hlh-sparkline">Trend</span>
        <span class="hlh-git">Git</span>
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

      // D Date: due date / target date
      const dueDate = f.duedate || null;
      const targetDate = f.customfield_18801 || null;
      let ddateText = '';
      if (dueDate && targetDate) {
        ddateText = this._fmtShortDate(dueDate) + ' / ' + this._fmtShortDate(targetDate);
      } else if (dueDate) {
        ddateText = this._fmtShortDate(dueDate);
      } else if (targetDate) {
        ddateText = this._fmtShortDate(targetDate);
      }

      // State: use cache first, fallback to Jira status
      const stateVal = this.computedStates[issue.key] ?? App.statusToProgress(f.status?.name);
      const stateRounded = stateVal ? [0,20,40,60,80,100].reduce((p,c) => Math.abs(c-stateVal)<Math.abs(p-stateVal)?c:p) : 0;
      const stateBadge = stateVal ? `<span class="progress-badge progress-${stateRounded}">${stateVal}%</span>` : '';

      html += `
        <div class="hierarchy-row" data-key="${issue.key}" data-level="${level}">
          <div class="hierarchy-row-main">
            <span class="hierarchy-detail-btn" data-key="${issue.key}" title="View details">👁</span>
            <span class="hierarchy-state" data-state-key="${issue.key}">${stateBadge}</span>
            <a href="${jiraAPI.getIssueUrl(issue.key)}" target="_blank" class="issue-key" onclick="event.stopPropagation()" title="Open in Jira">${issue.key}</a>
            <span class="hierarchy-summary">${UI.escapeHtml(f.summary)}</span>
            <span class="hierarchy-items-count" title="Child items">${childCount}</span>
            <span class="hierarchy-devqa-count devqa-clickable" data-key="${issue.key}">${this._getDevQaInfo(issue.key).count || ''}</span>
            <span class="hierarchy-sp-count">${f.story_points ?? f.customfield_10002 ?? ''}</span>
            <span class="hierarchy-edit editable-field editable-status" data-key="${issue.key}" data-field="status">${this.getLocalField(issue.key, 'status') !== null ? this.getLocalField(issue.key, 'status') + '%' : '—'}</span>
            <span class="hierarchy-edit editable-field editable-confidence" data-key="${issue.key}" data-field="confidence">${this.getLocalField(issue.key, 'confidence') !== null ? this.getLocalField(issue.key, 'confidence') + '%' : '—'}</span>
            <span class="hierarchy-ddate" title="${dueDate && targetDate ? 'Due / Target' : dueDate ? 'Due date' : targetDate ? 'Target date' : ''}">${ddateText}</span>
            <span class="hierarchy-sparkline">${UI.renderSparkline(this.progressHistory[issue.key] || [], issue.key)}</span>
            <span class="hierarchy-git-dot">${UI.renderGitDot(this.gitActivity[issue.key], issue.key)}</span>
          </div>
        </div>
      `;
    }
    html += '</div>';
    container.innerHTML = html;

    // Bind click handlers
    container.querySelectorAll('.hierarchy-row').forEach(row => {
      row.addEventListener('click', (e) => {
        // If clicking on sparkline, show trend popup
        const sparkline = e.target.closest('.sparkline-clickable');
        if (sparkline && sparkline.dataset.issueKey) {
          e.stopPropagation();
          this._handleSparklineClick(sparkline);
          return;
        }
        // If clicking on git dot, show popup
        if (e.target.classList.contains('git-dot') && e.target.dataset.issueKey) {
          e.stopPropagation();
          this._handleGitDotClick(e.target);
          return;
        }
        // If clicking on D/Q badge, show popup
        if (e.target.classList.contains('devqa-clickable') && e.target.dataset.key) {
          e.stopPropagation();
          this._handleDevQaClick(e.target);
          return;
        }
        // If clicking on editable field, start inline edit
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

    // Sync panel width class after render
    if (level === 'theme' || level === 'milestone') {
      this._syncPanelWidths();
    }
  }

  _syncPanelWidths() {
    const panels = document.querySelectorAll('.hierarchy-row-top .hierarchy-panel');
    if (panels.length >= 2) {
      panels[0].classList.toggle('panel-simplified', this.focusedPanel !== 'theme');
      panels[1].classList.toggle('panel-simplified', this.focusedPanel !== 'milestone');
    }
  }

  // === TABLE MODE (detailed / simplified) ===

  updateTableModes(focusedPanel) {
    this.focusedPanel = focusedPanel;
    document.querySelectorAll('.hierarchy-list[data-panel="theme"]').forEach(el => {
      el.classList.toggle('simplified', focusedPanel !== 'theme');
    });
    document.querySelectorAll('.hierarchy-list[data-panel="milestone"]').forEach(el => {
      el.classList.toggle('simplified', focusedPanel !== 'milestone');
    });
    // Toggle panel width
    const panels = document.querySelectorAll('.hierarchy-row-top .hierarchy-panel');
    if (panels.length >= 2) {
      panels[0].classList.toggle('panel-simplified', focusedPanel !== 'theme');
      panels[1].classList.toggle('panel-simplified', focusedPanel !== 'milestone');
    }
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

      // Fetch issues from issuelinks + Epic Link children in parallel
      const allIssues = new Map();

      // 1. Fetch linked issues (if any)
      if (linkedKeys.length > 0) {
        const linkJql = `key in (${linkedKeys.join(',')}) AND (labels is EMPTY OR (labels != theme AND labels != milestone)) ORDER BY updated DESC`;
        try {
          const linkData = await jiraAPI.searchIssues(linkJql, 0, 200);
          for (const issue of (linkData.issues || [])) allIssues.set(issue.key, issue);
        } catch (e) { console.warn('Link search failed:', e.message); }
      }

      // 2. Fetch Epic Link children ("issues in epic")
      try {
        const epicChildJql = `"Epic Link" = ${issueKey} ORDER BY updated DESC`;
        const epicChildData = await jiraAPI.searchIssues(epicChildJql, 0, 200);
        for (const issue of (epicChildData.issues || [])) allIssues.set(issue.key, issue);
      } catch (e) {
        // Fallback: try parent = KEY (next-gen projects)
        try {
          const parentJql = `parent = ${issueKey} ORDER BY updated DESC`;
          const parentData = await jiraAPI.searchIssues(parentJql, 0, 200);
          for (const issue of (parentData.issues || [])) allIssues.set(issue.key, issue);
        } catch (e2) { console.warn('Epic children search failed:', e2.message); }
      }

      const mergedIssues = [...allIssues.values()];

      if (mergedIssues.length === 0) {
        container.classList.remove('loading-overlay');
        container.innerHTML = UI.renderEmpty('📋', 'No linked tasks');
        countEl.textContent = '';
        return;
      }

      container.classList.remove('loading-overlay');
      countEl.textContent = mergedIssues.length > 0 ? mergedIssues.length : '';

      this.renderHierarchyTasks(container, mergedIssues, 'epicSubTasks');

      // Keyboard: highlight first epic task
      this.highlightedIndex.epicTasks = mergedIssues.length > 0 ? 0 : -1;
      if (!this._kbStayInPanel) {
        this.activePanel = 'epicTasks';
        this.applyHighlight('epicTasks');
      }
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

  // ============================================================
  // LINK EXISTING ISSUE
  // ============================================================

  async openLinkIssueModal() {
    if (!this.selectedMilestoneKey || !this.selectedMilestoneProject) {
      UI.toast('Select a Milestone first', 'error');
      return;
    }

    const titleEl = document.getElementById('linkIssueModalTitle');
    titleEl.textContent = `Link issue to ${this.selectedMilestoneKey}`;

    const listEl = document.getElementById('linkIssueList');
    listEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const filterInput = document.getElementById('linkIssueFilterInput');
    filterInput.value = '';

    UI.openModal('linkIssueModal');

    try {
      const project = this.selectedMilestoneProject;
      const jql = `project = ${project} AND created >= -45d ORDER BY created DESC`;
      const data = await jiraAPI.searchIssues(jql, 0, 200);
      this._linkIssueItems = data.issues || [];
      this._renderLinkIssueList(this._linkIssueItems);
    } catch (err) {
      listEl.innerHTML = `<div class="link-issue-empty">Error: ${err.message}</div>`;
    }
  }

  _renderLinkIssueList(issues) {
    const listEl = document.getElementById('linkIssueList');

    if (issues.length === 0) {
      listEl.innerHTML = '<div class="link-issue-empty">No issues found</div>';
      return;
    }

    let html = '';
    for (const issue of issues) {
      const f = issue.fields;
      const key = issue.key;
      const summary = UI.escapeHtml(f.summary || '');
      const desc = f.description ? UI.escapeHtml(f.description.substring(0, 120)) : '';

      html += `
        <div class="link-issue-row" data-key="${key}">
          <div class="link-issue-info">
            <div class="link-issue-top">
              <span class="link-issue-key">${key}</span>
              <span class="link-issue-summary">${summary}</span>
            </div>
            ${desc ? `<div class="link-issue-desc">${desc}</div>` : ''}
          </div>
          <div class="link-issue-action">
            <button class="link-issue-btn" data-link-key="${key}">Link</button>
          </div>
        </div>`;
    }

    listEl.innerHTML = html;
  }

  _filterLinkIssueList(query) {
    if (!this._linkIssueItems) return;
    const q = query.toLowerCase().trim();
    if (!q) {
      this._renderLinkIssueList(this._linkIssueItems);
      return;
    }
    const filtered = this._linkIssueItems.filter(issue => {
      const key = issue.key.toLowerCase();
      const summary = (issue.fields.summary || '').toLowerCase();
      return key.includes(q) || summary.includes(q);
    });
    this._renderLinkIssueList(filtered);
  }

  async linkExistingIssue(issueKey) {
    try {
      // Disable the button while linking
      const btn = document.querySelector(`[data-link-key="${issueKey}"]`);
      if (btn) {
        btn.disabled = true;
        btn.textContent = '...';
      }

      await jiraAPI.createIssueLink(issueKey, this.selectedMilestoneKey, this.getSelectedLinkType());

      // Remove the row visually
      const row = document.querySelector(`.link-issue-row[data-key="${issueKey}"]`);
      if (row) {
        row.style.opacity = '0.3';
        row.style.pointerEvents = 'none';
      }

      // Remove from cached list
      if (this._linkIssueItems) {
        this._linkIssueItems = this._linkIssueItems.filter(i => i.key !== issueKey);
      }

      UI.toast(`${issueKey} linked`, 'success');
    } catch (err) {
      UI.toast(`Failed to link ${issueKey}: ${err.message}`, 'error');
      // Re-enable button
      const btn = document.querySelector(`[data-link-key="${issueKey}"]`);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Link';
      }
    }
  }

  _onLinkIssueModalClose() {
    // Refresh tasks when modal is closed (if a milestone is selected)
    if (this.selectedMilestoneKey) {
      this.selectMilestone(this.selectedMilestoneKey);
    }
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
    const compactType = context === 'epicTasks' || context === 'epicSubTasks';

    let colgroup = '<colgroup>';
    colgroup += '<col style="width: 36px;">';   // Detail (eye icon)
    colgroup += compactType ? '<col style="width: 32px;">' : '<col style="width: 90px;">';   // Type
    colgroup += '<col style="width: 130px;">';  // Key
    colgroup += '<col>';                         // Summary
    if (showJiraStatus) colgroup += '<col style="width: 120px;">'; // Jira Status
    if (showPriority) colgroup += '<col style="width: 100px;">';   // Priority
    const showItemsCount = context === 'epicTasks';
    if (showItemsCount) colgroup += '<col style="width: 50px;">';  // Items
    if (showItemsCount) colgroup += '<col style="width: 50px;">';  // #D/Q
    colgroup += '<col style="width: 40px;">';   // SP
    colgroup += '<col style="width: 56px;">';   // S%
    colgroup += '<col style="width: 56px;">';   // C%
    colgroup += '<col style="width: 70px;">';   // State
    colgroup += '<col style="width: 84px;">';   // Trend
    colgroup += '<col style="width: 36px;">';   // Git
    colgroup += '<col style="width: 140px;">';  // Assignee
    colgroup += '</colgroup>';

    let thead = compactType ? '<tr><th></th><th>T</th>' : '<tr><th></th><th>Type</th>';
    thead += '<th>Key</th><th>Summary</th>';
    if (showJiraStatus) thead += '<th>Jira Status</th>';
    if (showPriority) thead += '<th>Priority</th>';
    if (showItemsCount) thead += '<th>Items</th><th>#D/Q</th>';
    thead += '<th>SP</th><th>S%</th><th>C%</th>';
    thead += '<th>State</th>';
    thead += '<th>Trend</th><th>Git</th><th>Assignee</th></tr>';

    let html = `
      <table class="issues-table issues-table-fixed">
        ${colgroup}
        <thead>${thead}</thead>
        <tbody>
    `;

    for (const issue of issues) {
      const f = issue.fields;
      const statusClass = UI.getStatusClass(f.status?.statusCategory?.key);
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
          <td><span class="table-detail-btn" data-key="${issue.key}" title="View details">👁</span></td>
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

      if (showPriority) {
        html += `<td>${UI.escapeHtml(f.priority?.name || '-')}</td>`;
      }

      if (showItemsCount) {
        html += `<td class="items-count-cell"><span class="hierarchy-items-count" title="Child items">${childCount || ''}</span></td>`;
        const dq = this._getDevQaInfo(issue.key);
        html += `<td class="items-count-cell"><span class="devqa-clickable" data-key="${issue.key}">${dq.count || ''}</span></td>`;
      }

      html += `<td class="items-count-cell">${f.story_points ?? f.customfield_10002 ?? ''}</td>`;
      html += `<td class="editable-cell"><span class="editable-field editable-status" data-key="${issue.key}" data-field="status">${this.getLocalField(issue.key, 'status') !== null ? this.getLocalField(issue.key, 'status') + '%' : '—'}</span></td>`;
      html += `<td class="editable-cell"><span class="editable-field editable-confidence" data-key="${issue.key}" data-field="confidence">${this.getLocalField(issue.key, 'confidence') !== null ? this.getLocalField(issue.key, 'confidence') + '%' : '—'}</span></td>`;

      {
        const pct = App.statusToProgress(f.status?.name);
        html += `<td class="progress-cell"><span class="progress-badge progress-${pct}" data-state-key="${issue.key}">${pct}%</span></td>`;
      }

      html += `<td class="sparkline-cell">${UI.renderSparkline(this.progressHistory[issue.key] || [], issue.key)}</td>`;
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

    // Git dot click handlers
    container.querySelectorAll('.git-dot[data-issue-key]').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        this._handleGitDotClick(dot);
      });
    });

    // Sparkline click handlers
    container.querySelectorAll('.sparkline-clickable[data-issue-key]').forEach(svg => {
      svg.addEventListener('click', (e) => {
        e.stopPropagation();
        this._handleSparklineClick(svg);
      });
    });

    // Dev/QA click handlers
    container.querySelectorAll('.devqa-clickable[data-key]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this._handleDevQaClick(el);
      });
    });

    // Editable field click handlers (Status%, Confidence%)
    container.querySelectorAll('.editable-field').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startInlineEdit(el);
      });
    });

    // Make epic rows clickable to load their child tasks
    container.querySelectorAll('tr.epic-row').forEach(row => {
      row.style.cursor = 'pointer';
      row.addEventListener('click', (e) => {
        // Don't trigger if clicking on interactive elements
        const sparkline = e.target.closest('.sparkline-clickable');
        if (sparkline) return;
        if (e.target.classList.contains('issue-key') || e.target.classList.contains('git-dot') || e.target.classList.contains('table-detail-btn') || e.target.classList.contains('devqa-clickable') || e.target.classList.contains('editable-field') || e.target.closest('.editable-field')) return;
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

  /** Format "YYYY-MM-DD" → "DD Mon" (e.g. "15 Mar") */
  _fmtShortDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
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
        // Start quick-edit flow: Enter → Status% → Enter → Confidence% → Enter → next row → Status% ...
        const rows2 = this.getPanelRows(panel);
        const idx2 = this.highlightedIndex[panel];
        if (idx2 >= 0 && idx2 < rows2.length) {
          const statusField = rows2[idx2].querySelector('.editable-field.editable-status');
          if (statusField) {
            this._startQuickEdit(statusField, panel, idx2);
          }
        }
        break;
      }
    }
  }

  async _autoSelectPanel(panel) {
    const key = this.getHighlightedKey(panel);
    if (!key) return;
    const stayPanel = panel;
    // Use generation counter to handle rapid key presses
    this._kbGeneration = (this._kbGeneration || 0) + 1;
    const gen = this._kbGeneration;
    this._kbStayInPanel = stayPanel;
    try {
      if (panel === 'themes') {
        await this.selectTheme(key);
        if (gen !== this._kbGeneration) return; // stale
        await this._cascadeSelectFirst('milestones');
      } else if (panel === 'milestones') {
        await this.selectMilestone(key);
        if (gen !== this._kbGeneration) return; // stale
        await this._cascadeSelectFirst('tasks');
      } else if (panel === 'tasks') {
        const rows = this.getPanelRows(panel);
        const row = rows[this.highlightedIndex[panel]];
        if (row && row.classList.contains('epic-row')) {
          await this.selectEpic(key);
        }
      }
    } finally {
      // Only restore if this is still the latest generation
      if (gen === this._kbGeneration) {
        this.activePanel = stayPanel;
        this.applyHighlight(stayPanel);
        this._kbStayInPanel = null;
      }
    }
  }

  async _cascadeSelectFirst(panel) {
    const rows = this.getPanelRows(panel);
    if (rows.length === 0) return;
    this.highlightedIndex[panel] = 0;
    const key = rows[0].dataset.key;
    if (!key) return;

    // Preserve focused panel during cascade — don't let child selection switch table modes
    const savedFocus = this.focusedPanel;

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

    // Restore focused panel after cascade
    if (savedFocus) this.updateTableModes(savedFocus);
  }

  // === INLINE EDITING ===

  /**
   * Start inline edit on an editable field element.
   * @param {HTMLElement} el - the .editable-field span
   * @param {Function} [onNext] - called after successful save via Enter (for quick-edit chain)
   */
  startInlineEdit(el, onNext) {
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
        return true; // skip = success (empty means skip)
      }
      const val = parseInt(raw, 10);
      if (isNaN(val) || val < 0 || val > 100) {
        UI.toast('Value must be between 0 and 100', 'error');
        restoreContent(currentValue);
        return false;
      }
      await this.saveLocalField(issueKey, field, val);
      restoreContent(val);
      return true;
    };

    const cancel = () => {
      restoreContent(currentValue);
    };

    let handled = false;
    const handleBlur = async () => {
      if (handled) return;
      handled = true;
      await save();
    };

    input.addEventListener('blur', handleBlur);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handled = true;
        input.removeEventListener('blur', handleBlur);
        save().then(ok => {
          if (ok && onNext) onNext();
        });
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handled = true;
        input.removeEventListener('blur', handleBlur);
        cancel();
      }
    });
  }

  /**
   * Quick-edit flow: Enter → Status% → Enter → Confidence% → Enter → next row Status% → ...
   */
  _startQuickEdit(statusEl, panel, rowIdx) {
    this.startInlineEdit(statusEl, () => {
      // After saving status, move to confidence of same row
      const rows = this.getPanelRows(panel);
      if (rowIdx < 0 || rowIdx >= rows.length) return;
      const row = rows[rowIdx];
      const confEl = row.querySelector('.editable-field.editable-confidence');
      if (!confEl) return;

      this.startInlineEdit(confEl, () => {
        // After saving confidence, advance to next row
        const nextIdx = rowIdx + 1;
        const currentRows = this.getPanelRows(panel);
        if (nextIdx >= currentRows.length) return; // last row — exit

        // Move highlight to next row
        this.highlightedIndex[panel] = nextIdx;
        this.applyHighlight(panel);

        const nextRow = currentRows[nextIdx];
        const nextStatusEl = nextRow.querySelector('.editable-field.editable-status');
        if (nextStatusEl) {
          this._startQuickEdit(nextStatusEl, panel, nextIdx);
        }
      });
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

  _buildLocalSparklineData(localHistory, field) {
    // Filter entries for this field, sorted by timestamp
    const entries = (localHistory || [])
      .filter(h => h.field === field && h.newValue !== null && h.newValue !== undefined)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (entries.length === 0) return [];
    return entries.map(h => ({ progress: h.newValue, date: h.timestamp.slice(0, 10) }));
  }

  // ============================================================
  // DEBUG PANEL
  // ============================================================

  async openDebugPanel() {
    UI.openModal('debugModal');
    const body = document.getElementById('debugModalBody');
    body.innerHTML = UI.renderLoading();

    try {
      const jql = this.getSelectedJql() || this.serverConfig?.hierarchyJql || '';
      const params = jql ? `?jql=${encodeURIComponent(jql)}` : '';
      const res = await fetch(`/api/debug/hierarchy${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      this._debugData = data;
      this._debugExpanded = new Set();
      this._renderDebugPanel(data);
    } catch (err) {
      body.innerHTML = UI.renderError(err.message);
    }
  }

  _renderDebugPanel(data) {
    const body = document.getElementById('debugModalBody');
    let html = '';

    // Summary
    html += UI.renderDebugSummary(data.statistics);

    // Filters
    html += `<div class="debug-filters">
      <span style="color:var(--color-text-secondary);font-size:12px">Show:</span>
      <button class="debug-filter active" data-filter="all">All</button>
      <button class="debug-filter" data-filter="problems">Problems only</button>
    </div>`;

    // Tree
    html += '<div class="debug-tree">';
    for (const theme of data.themes) {
      html += this._renderDebugNode(theme, 'theme');
    }
    html += '</div>';

    // Orphans
    html += UI.renderDebugOrphans(data.orphans);

    body.innerHTML = html;
    this._bindDebugEvents(body);
  }

  _getTypeClass(issuetype) {
    const t = (issuetype || '').toLowerCase();
    if (t === 'epic') return 'type-epic';
    if (t === 'story') return 'type-story';
    if (t === 'task') return 'type-task';
    if (t === 'bug') return 'type-bug';
    if (t.includes('sub-task') || t.includes('subtask')) return 'type-sub-task';
    return 'type-default';
  }

  _renderDebugNode(node, level) {
    const expanded = this._debugExpanded.has(node.key);
    const hasChildren = (level === 'theme' && node.milestones?.length > 0) ||
      (level === 'milestone' && node.tasks?.length > 0) ||
      (level === 'task' && node.children?.length > 0);
    const hasProblems = node.problems.length > 0;
    const problemCount = this._countAllProblems(node, level);

    let html = `<div class="debug-tree-node level-${level}" data-key="${UI.escapeHtml(node.key)}" data-has-problems="${hasProblems || problemCount > 0}">`;

    // Header
    html += `<div class="debug-node-header" data-key="${UI.escapeHtml(node.key)}">`;
    html += `<span class="debug-toggle${expanded ? ' expanded' : ''}">${hasChildren || node.links.all.length > 0 ? '&#9654;' : '&nbsp;'}</span>`;
    html += `<span class="debug-node-type ${this._getTypeClass(node.issuetype)}">${(node.issuetype || '?')[0]}</span>`;
    html += `<span class="debug-node-key">${UI.escapeHtml(node.key)}</span>`;
    html += `<span class="debug-node-summary">${UI.escapeHtml(node.summary)}</span>`;

    // Badges
    html += '<span class="debug-node-badges">';
    if (node.stateInfo) {
      const si = node.stateInfo;
      const steps = [0, 20, 40, 60, 80, 100];
      const rounded = steps.reduce((prev, curr) => Math.abs(curr - si.computedState) < Math.abs(prev - si.computedState) ? curr : prev);
      const label = si.source === 'children_avg' ? `${si.computedState}% avg` : `${si.computedState}%`;
      html += `<span class="progress-badge progress-${rounded}" style="font-size:10px;padding:1px 5px" title="State: ${label}">${label}</span>`;
    }
    if (node.status) {
      const cls = UI.getStatusClass(node.statusCategory);
      html += `<span class="status-badge ${cls}" style="font-size:10px;padding:1px 5px">${UI.escapeHtml(node.status)}</span>`;
    }
    if (hasProblems) {
      for (const p of node.problems) {
        const cls = p.severity === 'error' ? 'debug-badge-error' : p.severity === 'warning' ? 'debug-badge-warning' : 'debug-badge-info';
        html += `<span class="debug-badge ${cls}">${UI.escapeHtml(p.type)}</span>`;
      }
    }
    html += '</span>';

    // Links info
    html += `<span class="debug-node-links-info">${node.links.all.length}L ${node.links.outwardCount}out ${node.links.inwardCount}in</span>`;
    html += '</div>';

    // Details (expanded content)
    html += `<div class="debug-details${expanded ? ' open' : ''}" data-key="${UI.escapeHtml(node.key)}">`;

    // Problems
    if (hasProblems) {
      html += '<div class="debug-problems">';
      for (const p of node.problems) {
        const icon = p.severity === 'error' ? '&#x26D4;' : p.severity === 'warning' ? '&#x26A0;' : '&#x2139;';
        html += `<div class="debug-problem-item">${icon} ${UI.escapeHtml(p.message)}</div>`;
      }
      html += '</div>';
    }

    // Links table
    if (node.links.all.length > 0) {
      html += '<table class="debug-links-table"><thead><tr>';
      html += '<th>Dir</th><th>Type</th><th>Target</th><th>Target Type</th><th>Labels</th><th>Status</th>';
      html += '</tr></thead><tbody>';
      for (const link of node.links.all) {
        const dirIcon = link.direction === 'outward' ? '&#x2192;' : '&#x2190;';
        const dirClass = link.direction;
        const statusClass = link.used ? 'debug-link-used' : 'debug-link-ignored';
        html += '<tr>';
        html += `<td class="debug-link-dir ${dirClass}">${dirIcon}</td>`;
        html += `<td>${UI.escapeHtml(link.typeName)}</td>`;
        html += `<td><span class="debug-node-key">${UI.escapeHtml(link.targetKey)}</span> ${UI.escapeHtml(link.targetSummary)}</td>`;
        html += `<td>${UI.escapeHtml(link.targetType)}</td>`;
        html += `<td>${(link.targetLabels || []).join(', ')}</td>`;
        html += `<td class="${statusClass}">${UI.escapeHtml(link.reason)}</td>`;
        html += '</tr>';
      }
      html += '</tbody></table>';
    }

    // Child query info
    if (node.childQuery) {
      const q = node.childQuery;
      html += '<div class="debug-query-info">';
      html += '<div class="debug-query-title">Child resolution</div>';

      // Raw links from Jira
      html += `<div class="debug-query-row"><span class="debug-query-label">Raw links:</span> `;
      if (q.rawLinkedKeys.length === 0) {
        html += '<span class="debug-query-muted">none</span>';
      } else {
        html += q.rawLinkedKeys.map(l =>
          `<span class="debug-query-key">${UI.escapeHtml(l.key)}</span><span class="debug-query-dir">${l.dir}</span>`
        ).join(' ');
      }
      html += '</div>';

      // After extractLinkedKeys (excluded cloners/duplicate removed)
      html += `<div class="debug-query-row"><span class="debug-query-label">After link filter:</span> `;
      html += q.extractedKeys.length > 0
        ? q.extractedKeys.map(k => `<span class="debug-query-key">${UI.escapeHtml(k)}</span>`).join(' ')
        : '<span class="debug-query-muted">none</span>';
      html += '</div>';

      // After visited filter
      if (q.afterVisitedFilter.length !== q.extractedKeys.length) {
        const skipped = q.extractedKeys.filter(k => !q.afterVisitedFilter.includes(k));
        html += `<div class="debug-query-row"><span class="debug-query-label">Skipped (already visited):</span> `;
        html += skipped.map(k => `<span class="debug-query-key debug-query-skipped">${UI.escapeHtml(k)}</span>`).join(' ');
        html += '</div>';
      }

      // JQL
      if (q.jql) {
        html += `<div class="debug-query-row"><span class="debug-query-label">JQL:</span> <code class="debug-query-jql">${UI.escapeHtml(q.jql)}</code></div>`;
        html += `<div class="debug-query-row"><span class="debug-query-label">Result:</span> ${q.resultCount} issues`;
        if (q.returnedKeys) {
          html += ' (' + q.returnedKeys.map(k => `<span class="debug-query-key">${UI.escapeHtml(k)}</span>`).join(' ') + ')';
        }
        html += '</div>';

        // Filtered out by JQL
        if (q.filteredOut && q.filteredOut.length > 0) {
          html += `<div class="debug-query-row debug-query-warn"><span class="debug-query-label">Filtered out by JQL:</span> `;
          html += q.filteredOut.map(k => `<span class="debug-query-key">${UI.escapeHtml(k)}</span>`).join(' ');
          html += ` <span class="debug-query-muted">(${UI.escapeHtml(q.filter)})</span>`;
          html += '</div>';
        }
      } else {
        html += `<div class="debug-query-row"><span class="debug-query-muted">No issuelink keys to query</span></div>`;
      }

      // Epic Link info
      if (q.epicLinkJql) {
        html += '<div style="margin-top:6px;padding-top:6px;border-top:1px solid #e0e4ea">';
        html += `<div class="debug-query-row"><span class="debug-query-label">Epic Link JQL:</span> <code class="debug-query-jql">${UI.escapeHtml(q.epicLinkJql)}</code></div>`;
        if (q.epicLinkError) {
          html += `<div class="debug-query-row debug-query-warn">Error: ${UI.escapeHtml(q.epicLinkError)}</div>`;
        } else {
          html += `<div class="debug-query-row"><span class="debug-query-label">Epic Link children:</span> ${q.epicLinkCount || 0} issues`;
          if (q.epicLinkKeys && q.epicLinkKeys.length > 0) {
            html += ' (' + q.epicLinkKeys.map(k => `<span class="debug-query-key">${UI.escapeHtml(k)}</span>`).join(' ') + ')';
          }
          html += '</div>';
        }
        html += '</div>';
      }

      html += '</div>';
    }

    // State computation details
    if (node.stateInfo) {
      const si = node.stateInfo;
      html += '<div class="debug-query-info">';
      html += '<div class="debug-query-title">State computation</div>';

      // Own Jira status → state
      html += `<div class="debug-query-row"><span class="debug-query-label">Jira status:</span> ${UI.escapeHtml(si.ownStatus || '—')} → <strong>${si.ownState}%</strong></div>`;

      if (si.source === 'children_avg' && si.childStates.length > 0) {
        // Show children breakdown
        html += `<div class="debug-query-row"><span class="debug-query-label">Source:</span> average of <strong>${si.childStates.length}</strong> children</div>`;
        html += '<div class="debug-state-children">';
        html += '<table class="debug-links-table"><thead><tr><th>Key</th><th>Jira Status</th><th>State</th></tr></thead><tbody>';
        for (const cs of si.childStates) {
          const steps = [0, 20, 40, 60, 80, 100];
          const r = steps.reduce((prev, curr) => Math.abs(curr - cs.state) < Math.abs(prev - cs.state) ? curr : prev);
          html += `<tr>`;
          html += `<td><span class="debug-node-key">${UI.escapeHtml(cs.key)}</span></td>`;
          html += `<td>${UI.escapeHtml(cs.status || '—')}</td>`;
          html += `<td><span class="progress-badge progress-${r}" style="font-size:10px;padding:1px 4px">${cs.state}%</span></td>`;
          html += `</tr>`;
        }
        html += '</tbody></table>';
        html += '</div>';

        // Final result
        const steps = [0, 20, 40, 60, 80, 100];
        const rounded = steps.reduce((prev, curr) => Math.abs(curr - si.computedState) < Math.abs(prev - si.computedState) ? curr : prev);
        html += `<div class="debug-query-row"><span class="debug-query-label">Computed state:</span> <span class="progress-badge progress-${rounded}" style="font-size:11px;padding:1px 6px"><strong>${si.computedState}%</strong></span> (own: ${si.ownState}%)</div>`;
      } else {
        html += `<div class="debug-query-row"><span class="debug-query-label">Source:</span> own status (no children or leaf)</div>`;
      }

      html += '</div>';
    }

    // Nested children
    if (level === 'theme' && node.milestones) {
      for (const ms of node.milestones) {
        html += this._renderDebugNode(ms, 'milestone');
      }
    }
    if (level === 'milestone' && node.tasks) {
      for (const task of node.tasks) {
        html += this._renderDebugNode(task, 'task');
      }
    }
    if (level === 'task' && node.children) {
      for (const child of node.children) {
        html += this._renderDebugNode(child, 'child');
      }
    }

    html += '</div>'; // details
    html += '</div>'; // tree-node
    return html;
  }

  _countAllProblems(node, level) {
    let count = node.problems.length;
    if (level === 'theme' && node.milestones) {
      for (const ms of node.milestones) count += this._countAllProblems(ms, 'milestone');
    }
    if (level === 'milestone' && node.tasks) {
      for (const task of node.tasks) count += this._countAllProblems(task, 'task');
    }
    if (level === 'task' && node.children) {
      for (const child of node.children) count += this._countAllProblems(child, 'child');
    }
    return count;
  }

  _bindDebugEvents(container) {
    // Toggle expand/collapse
    container.querySelectorAll('.debug-node-header').forEach(header => {
      header.addEventListener('click', () => {
        const key = header.dataset.key;
        const details = header.nextElementSibling;
        const toggle = header.querySelector('.debug-toggle');
        if (!details) return;

        if (this._debugExpanded.has(key)) {
          this._debugExpanded.delete(key);
          details.classList.remove('open');
          if (toggle) toggle.classList.remove('expanded');
        } else {
          this._debugExpanded.add(key);
          details.classList.add('open');
          if (toggle) toggle.classList.add('expanded');
        }
      });
    });

    // Filter buttons
    container.querySelectorAll('.debug-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.debug-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;

        container.querySelectorAll('.debug-tree-node').forEach(node => {
          if (filter === 'problems') {
            node.style.display = node.dataset.hasProblems === 'true' ? '' : 'none';
          } else {
            node.style.display = '';
          }
        });
      });
    });
  }
}

// Initialize app
const app = new App();
