/**
 * UI Helper Functions
 */
const UI = {
  /**
   * Show toast notification
   */
  toast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  },

  /**
   * Open modal
   */
  openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
  },

  /**
   * Close modal
   */
  closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
  },

  /**
   * Update connection status
   */
  updateConnectionStatus(connected, text) {
    const indicator = document.getElementById('connectionIndicator');
    const dot = indicator.querySelector('.status-dot');
    const textEl = indicator.querySelector('.status-text');

    dot.className = 'status-dot ' + (connected ? 'connected' : (connected === false ? 'error' : ''));
    textEl.textContent = text;
  },

  /**
   * Get status badge class
   */
  getStatusClass(statusCategory) {
    switch (statusCategory?.toLowerCase()) {
      case 'done': return 'status-done';
      case 'indeterminate': return 'status-in-progress';
      default: return 'status-todo';
    }
  },

  /**
   * Format date
   */
  formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  /**
   * Format date relative
   */
  formatRelativeDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'только что';
    if (diffMins < 60) return `${diffMins} мин назад`;
    if (diffHours < 24) return `${diffHours} ч назад`;
    if (diffDays < 7) return `${diffDays} дн назад`;
    
    return this.formatDate(dateStr);
  },

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Convert Jira wiki markup to HTML (basic)
   */
  wikiToHtml(text) {
    if (!text) return '<p class="assignee-unassigned">Нет описания</p>';
    
    let html = this.escapeHtml(text);
    
    // Basic conversions
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/\*(.+?)\*/g, '<strong>$1</strong>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');
    html = html.replace(/\[(.+?)\|(.+?)\]/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/\{code\}([\s\S]+?)\{code\}/g, '<pre><code>$1</code></pre>');
    
    return `<div class="issue-description">${html}</div>`;
  },

  /**
   * Render loading state
   */
  renderLoading() {
    return `
      <div class="loading">
        <div class="spinner"></div>
      </div>
    `;
  },

  /**
   * Render error state
   */
  renderError(message) {
    return `<div class="error-message">❌ ${this.escapeHtml(message)}</div>`;
  },

  /**
   * Render empty state
   */
  renderEmpty(icon, message) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">${icon}</div>
        <p>${this.escapeHtml(message)}</p>
      </div>
    `;
  }
};

window.UI = UI;
