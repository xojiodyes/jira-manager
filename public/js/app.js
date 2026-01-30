/**
 * Jira Manager Application
 */
class App {
  constructor() {
    this.currentPage = 0;
    this.pageSize = 50;
    this.totalIssues = 0;
    this.currentView = 'search';

    // Hierarchy state
    this.selectedThemeKey = null;
    this.selectedThemeProject = null;
    this.selectedMilestoneKey = null;
    this.selectedMilestoneProject = null;

    this.init();
  }

  async init() {
    // Wait for server config to load
    await window.jiraConfigReady;
    this.serverConfig = window.jiraAPI.serverConfig || {};

    this.bindEvents();
    this.loadSavedState();
    this.checkConnection();
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

    // Search
    document.getElementById('searchBtn').addEventListener('click', () => {
      this.search();
    });

    document.getElementById('jqlInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.search();
    });

    // Quick filters
    document.querySelectorAll('.chip[data-jql]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.getElementById('jqlInput').value = chip.dataset.jql;
        this.search();
      });
    });

    // Nav view switching
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        if (item.classList.contains('disabled')) return;
        this.switchView(view);
      });
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
    const titles = { search: 'Поиск задач', hierarchy: 'Иерархия задач' };
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

    // Load last JQL
    const savedJql = localStorage.getItem('lastJQL');
    if (savedJql) {
      document.getElementById('jqlInput').value = savedJql;
    }
  }

  async checkConnection() {
    if (!jiraAPI.isConfigured()) {
      UI.updateConnectionStatus(null, 'Не настроено');
      return;
    }

    try {
      const user = await jiraAPI.testConnection();
      UI.updateConnectionStatus(true, user.displayName);
    } catch (err) {
      UI.updateConnectionStatus(false, 'Ошибка подключения');
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
      UI.toast('Заполните все поля', 'error');
      return;
    }

    // Temporarily save for testing
    jiraAPI.saveCredentials(host, email, token);

    try {
      const user = await jiraAPI.testConnection();
      UI.toast(`Подключено как ${user.displayName}`, 'success');
      UI.updateConnectionStatus(true, user.displayName);
    } catch (err) {
      UI.toast(`Ошибка: ${err.message}`, 'error');
      UI.updateConnectionStatus(false, 'Ошибка подключения');
    }
  }

  saveSettings() {
    const host = document.getElementById('jiraHost').value.trim();
    const email = document.getElementById('email').value.trim();
    const token = document.getElementById('apiToken').value.trim();

    if (!host || !email || !token) {
      UI.toast('Заполните все поля', 'error');
      return;
    }

    jiraAPI.saveCredentials(host, email, token);
    UI.toast('Настройки сохранены', 'success');
    UI.closeModal('settingsModal');
    this.checkConnection();
  }

  async search(startAt = 0) {
    const jql = document.getElementById('jqlInput').value.trim();

    if (!jql) {
      UI.toast('Введите JQL запрос', 'error');
      return;
    }

    if (!jiraAPI.isConfigured()) {
      UI.toast('Сначала настройте подключение', 'error');
      this.openSettings();
      return;
    }

    // Save JQL
    localStorage.setItem('lastJQL', jql);
    this.currentPage = Math.floor(startAt / this.pageSize);

    const container = document.getElementById('resultsContainer');
    container.innerHTML = UI.renderLoading();

    const searchBtn = document.getElementById('searchBtn');
    searchBtn.disabled = true;

    try {
      const data = await jiraAPI.searchIssues(jql, startAt, this.pageSize);
      this.totalIssues = data.total;
      this.renderResults(data);
    } catch (err) {
      container.innerHTML = UI.renderError(err.message);
    } finally {
      searchBtn.disabled = false;
    }
  }

  renderResults(data) {
    const container = document.getElementById('resultsContainer');
    const countEl = document.getElementById('resultsCount');

    const startAt = this.currentPage * this.pageSize;
    const endAt = Math.min(startAt + this.pageSize, data.total);
    countEl.textContent = data.total > 0
      ? `${startAt + 1}-${endAt} из ${data.total}`
      : '';

    if (data.issues.length === 0) {
      container.innerHTML = UI.renderEmpty('📭', 'Задачи не найдены');
      return;
    }

    let html = `
      <table class="issues-table">
        <thead>
          <tr>
            <th>Тип</th>
            <th>Ключ</th>
            <th>Название</th>
            <th>Статус</th>
            <th>Приоритет</th>
            <th>Исполнитель</th>
            <th>Обновлено</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const issue of data.issues) {
      const f = issue.fields;
      const statusClass = UI.getStatusClass(f.status?.statusCategory?.key);

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
            ${f.priority?.iconUrl
              ? `<img src="${f.priority.iconUrl}" class="priority-icon" alt="${UI.escapeHtml(f.priority.name)}" title="${UI.escapeHtml(f.priority.name)}">`
              : UI.escapeHtml(f.priority?.name || '-')}
          </td>
          <td>
            ${f.assignee
              ? `<span class="assignee">
                  <img src="${f.assignee.avatarUrls?.['24x24'] || ''}" class="assignee-avatar" alt="">
                  ${UI.escapeHtml(f.assignee.displayName)}
                </span>`
              : '<span class="assignee-unassigned">Не назначен</span>'}
          </td>
          <td style="white-space: nowrap; color: var(--color-text-secondary); font-size: 13px;">
            ${UI.formatRelativeDate(f.updated)}
          </td>
        </tr>
      `;
    }

    html += '</tbody></table>';

    // Pagination
    if (data.total > this.pageSize) {
      const totalPages = Math.ceil(data.total / this.pageSize);
      html += `
        <div class="pagination">
          <span class="pagination-info">Страница ${this.currentPage + 1} из ${totalPages}</span>
          <div class="pagination-buttons">
            <button class="btn btn-secondary btn-sm" onclick="app.search(${Math.max(0, (this.currentPage - 1) * this.pageSize)})" ${this.currentPage === 0 ? 'disabled' : ''}>
              ← Назад
            </button>
            <button class="btn btn-secondary btn-sm" onclick="app.search(${(this.currentPage + 1) * this.pageSize})" ${(this.currentPage + 1) * this.pageSize >= data.total ? 'disabled' : ''}>
              Вперед →
            </button>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    // Bind click handlers for issue keys
    container.querySelectorAll('.issue-key').forEach(el => {
      el.addEventListener('click', () => {
        this.showIssueDetail(el.dataset.key);
      });
    });
  }

  async showIssueDetail(issueKey) {
    UI.openModal('issueModal');

    const titleEl = document.getElementById('issueModalTitle');
    const bodyEl = document.getElementById('issueModalBody');

    titleEl.textContent = issueKey;
    bodyEl.innerHTML = UI.renderLoading();

    try {
      const issue = await jiraAPI.getIssue(issueKey);
      this.renderIssueDetail(issue);
    } catch (err) {
      bodyEl.innerHTML = UI.renderError(err.message);
    }
  }

  renderIssueDetail(issue) {
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
            <span class="issue-meta-label">Статус</span>
            <span class="status-badge ${statusClass}">${UI.escapeHtml(f.status?.name)}</span>
          </div>
          <div class="issue-meta-item">
            <span class="issue-meta-label">Тип</span>
            <span class="issue-type">
              ${f.issuetype?.iconUrl ? `<img src="${f.issuetype.iconUrl}" class="issue-type-icon" alt="">` : ''}
              ${UI.escapeHtml(f.issuetype?.name)}
            </span>
          </div>
          <div class="issue-meta-item">
            <span class="issue-meta-label">Приоритет</span>
            <span>
              ${f.priority?.iconUrl ? `<img src="${f.priority.iconUrl}" class="priority-icon" alt="">` : ''}
              ${UI.escapeHtml(f.priority?.name)}
            </span>
          </div>
          <div class="issue-meta-item">
            <span class="issue-meta-label">Исполнитель</span>
            ${f.assignee
              ? `<span class="assignee">
                  <img src="${f.assignee.avatarUrls?.['24x24'] || ''}" class="assignee-avatar" alt="">
                  ${UI.escapeHtml(f.assignee.displayName)}
                </span>`
              : '<span class="assignee-unassigned">Не назначен</span>'}
          </div>
        </div>
      </div>

      <div class="issue-detail-section">
        <h4>Описание</h4>
        ${UI.wikiToHtml(f.description)}
      </div>

      <div class="issue-detail-section">
        <h4>Информация</h4>
        <div class="issue-detail-meta">
          <div class="issue-meta-item">
            <span class="issue-meta-label">Проект</span>
            <span>${UI.escapeHtml(f.project?.name)}</span>
          </div>
          <div class="issue-meta-item">
            <span class="issue-meta-label">Создано</span>
            <span>${UI.formatDate(f.created)}</span>
          </div>
          <div class="issue-meta-item">
            <span class="issue-meta-label">Обновлено</span>
            <span>${UI.formatDate(f.updated)}</span>
          </div>
        </div>
      </div>

      ${f.comment?.comments?.length ? `
        <div class="issue-detail-section">
          <h4>Комментарии (${f.comment.total})</h4>
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
    document.getElementById('milestonesContainer').innerHTML = UI.renderEmpty('🎯', 'Выберите Theme');
    document.getElementById('milestonesCount').textContent = '';
    document.getElementById('hierarchyTasksContainer').innerHTML = UI.renderEmpty('📋', 'Выберите Milestone');
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
    document.getElementById('hierarchyTasksContainer').innerHTML = UI.renderEmpty('📋', 'Выберите Milestone');
    document.getElementById('hierarchyTasksCount').textContent = '';

    // Load milestones linked to this theme
    const milestonesContainer = document.getElementById('milestonesContainer');
    const milestonesCount = document.getElementById('milestonesCount');
    milestonesContainer.innerHTML = UI.renderLoading();

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
        milestonesContainer.innerHTML = UI.renderEmpty('🎯', 'Нет связанных milestones');
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
      milestonesCount.textContent = data.total > 0 ? data.total : '';
      this.renderHierarchyList(milestonesContainer, data.issues, 'milestone');
    } catch (err) {
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
    tasksContainer.innerHTML = UI.renderLoading();

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
        tasksContainer.innerHTML = UI.renderEmpty('📋', 'Нет связанных задач');
        tasksCount.textContent = '';
        return;
      }

      // Fetch linked issues EXCLUDING themes and milestones
      const jql = `key in (${linkedKeys.join(',')}) AND labels not in (theme, milestone) ORDER BY updated DESC`;
      const data = await jiraAPI.searchIssues(jql, 0, 200);
      tasksCount.textContent = data.total > 0 ? data.total : '';
      this.renderHierarchyTasks(tasksContainer, data.issues);
    } catch (err) {
      tasksContainer.innerHTML = UI.renderError(err.message);
    }
  }

  renderHierarchyList(container, issues, level) {
    if (issues.length === 0) {
      const icons = { theme: '🏗️', milestone: '🎯' };
      const msgs = { theme: 'Нет themes', milestone: 'Нет milestones' };
      container.innerHTML = UI.renderEmpty(icons[level], msgs[level]);
      return;
    }

    let html = '<div class="hierarchy-list">';
    for (const issue of issues) {
      const f = issue.fields;
      // Count child items (all linked issues)
      const linksCount = (f.issuelinks || []).length;

      html += `
        <div class="hierarchy-row" data-key="${issue.key}" data-level="${level}">
          <div class="hierarchy-row-main">
            <span class="issue-key" data-key="${issue.key}">${issue.key}</span>
            <span class="hierarchy-summary">${UI.escapeHtml(f.summary)}</span>
            <span class="hierarchy-items-count" title="Связанных элементов">${linksCount}</span>
          </div>
        </div>
      `;
    }
    html += '</div>';
    container.innerHTML = html;

    // Bind click handlers
    container.querySelectorAll('.hierarchy-row').forEach(row => {
      row.addEventListener('click', (e) => {
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
        <input type="text" class="input input-sm inline-project-input" placeholder="Project key (напр. PROJ)" id="inlineProjectKey">
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
        <button class="btn-icon btn-confirm" id="inlineConfirm" title="Создать">&#10003;</button>
        <button class="btn-icon btn-cancel" id="inlineCancel" title="Отмена">&#10005;</button>
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
      UI.toast('Введите Summary', 'error');
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
      UI.toast(`Ошибка: ${err.message}`, 'error');
    }
  }

  async createTheme(summary) {
    const projectKey = document.getElementById('inlineProjectKey')?.value.trim();
    if (!projectKey) {
      UI.toast('Введите Project key', 'error');
      return;
    }

    const result = await jiraAPI.createIssue(projectKey, summary, 'Story', ['theme']);
    UI.toast(`Theme ${result.key} создан`, 'success');

    // Reload themes
    await this.loadThemes();
  }

  async createMilestone(summary) {
    if (!this.selectedThemeKey || !this.selectedThemeProject) {
      UI.toast('Сначала выберите Theme', 'error');
      return;
    }

    const projectKey = this.selectedThemeProject;
    const result = await jiraAPI.createIssue(projectKey, summary, 'Story', ['milestone']);

    // Link milestone to theme
    await jiraAPI.createIssueLink(this.selectedThemeKey, result.key, 'Hierarchy');
    UI.toast(`Milestone ${result.key} создан`, 'success');

    // Reload milestones for current theme
    await this.selectTheme(this.selectedThemeKey);
  }

  async createTask(summary) {
    if (!this.selectedMilestoneKey || !this.selectedMilestoneProject) {
      UI.toast('Сначала выберите Milestone', 'error');
      return;
    }

    const projectKey = this.selectedMilestoneProject;
    const issueType = document.getElementById('inlineIssueType')?.value || 'Story';
    const result = await jiraAPI.createIssue(projectKey, summary, issueType, []);

    // Link task to milestone
    await jiraAPI.createIssueLink(this.selectedMilestoneKey, result.key, 'Hierarchy');
    UI.toast(`${issueType} ${result.key} создан`, 'success');

    // Reload tasks for current milestone
    await this.selectMilestone(this.selectedMilestoneKey);
  }

  renderHierarchyTasks(container, issues) {
    if (issues.length === 0) {
      container.innerHTML = UI.renderEmpty('📋', 'Нет задач');
      return;
    }

    let html = `
      <table class="issues-table">
        <thead>
          <tr>
            <th>Тип</th>
            <th>Ключ</th>
            <th>Название</th>
            <th>Статус</th>
            <th>Приоритет</th>
            <th>Исполнитель</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const issue of issues) {
      const f = issue.fields;
      const statusClass = UI.getStatusClass(f.status?.statusCategory?.key);

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
          <td>${UI.escapeHtml(f.priority?.name || '-')}</td>
          <td>
            ${f.assignee
              ? `<span class="assignee">
                  <img src="${f.assignee.avatarUrls?.['24x24'] || ''}" class="assignee-avatar" alt="">
                  ${UI.escapeHtml(f.assignee.displayName)}
                </span>`
              : '<span class="assignee-unassigned">Не назначен</span>'}
          </td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    // Bind click handlers for issue keys
    container.querySelectorAll('.issue-key').forEach(el => {
      el.addEventListener('click', () => {
        this.showIssueDetail(el.dataset.key);
      });
    });
  }
}

// Initialize app
const app = new App();
