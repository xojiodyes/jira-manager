/**
 * Jira Manager Application
 */
class App {
  constructor() {
    this.currentPage = 0;
    this.pageSize = 50;
    this.totalIssues = 0;
    
    this.init();
  }

  init() {
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
}

// Initialize app
const app = new App();
