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

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
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
    if (!text) return '<p class="assignee-unassigned">No description</p>';
    
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
  },

  /**
   * Render inline SVG sparkline
   * @param {Array<{date: string, progress: number}>} dataPoints
   * @param {number} width
   * @param {number} height
   * @returns {string} HTML string
   */
  _buildWeeklyTooltip(dataPoints) {
    if (!dataPoints || dataPoints.length === 0) return '';
    // Group by ISO week (Mon-Sun)
    const weeks = {};
    for (const dp of dataPoints) {
      const d = new Date(dp.date + 'T00:00:00');
      // Get Monday of this week
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      const weekKey = monday.toISOString().slice(0, 10);
      if (!weeks[weekKey]) weeks[weekKey] = [];
      weeks[weekKey].push(dp.progress);
    }
    // Build tooltip lines
    const lines = [];
    const weekKeys = Object.keys(weeks).sort();
    for (const wk of weekKeys) {
      const vals = weeks[wk];
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      // Format: "03 Dec: 45%"
      const d = new Date(wk + 'T00:00:00');
      const label = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
      lines.push(`${label}: ${avg}%`);
    }
    return lines.join('\n');
  },

  renderSparkline(dataPoints, width = 80, height = 20) {
    if (!dataPoints || dataPoints.length === 0) {
      return '<span class="sparkline-empty">--</span>';
    }

    const pad = 2;
    const w = width - pad * 2;
    const h = height - pad * 2;
    const maxY = 100;

    const lastProgress = dataPoints[dataPoints.length - 1].progress;
    const color = lastProgress >= 80 ? '#36b37e' : lastProgress >= 40 ? '#0052cc' : '#ff5630';

    if (dataPoints.length === 1) {
      const cx = width / 2;
      const cy = pad + h - (dataPoints[0].progress / maxY) * h;
      const tip1 = this._buildWeeklyTooltip(dataPoints);
      return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <title>${tip1}</title>
        <circle cx="${cx}" cy="${cy}" r="3" fill="${color}"/>
      </svg>`;
    }

    const points = dataPoints.map((d, i) => {
      const x = pad + (i / (dataPoints.length - 1)) * w;
      const y = pad + h - (d.progress / maxY) * h;
      return { x, y };
    });

    const polyline = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPoints = [
      `${pad},${height - pad}`,
      ...points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
      `${(width - pad).toFixed(1)},${height - pad}`
    ].join(' ');

    const last = points[points.length - 1];

    // Build weekly tooltip
    const tooltip = this._buildWeeklyTooltip(dataPoints);

    return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <title>${tooltip}</title>
      <polygon points="${areaPoints}" fill="${color}" opacity="0.1"/>
      <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2" fill="${color}"/>
    </svg>`;
  },
  /**
   * Render activity sparkline (binary bar chart for git commits)
   * @param {Array<{date: string, commits: 0|1}>} dataPoints
   * @param {number} width
   * @param {number} height
   * @returns {string} HTML string
   */
  _buildActivityTooltip(dataPoints) {
    if (!dataPoints || dataPoints.length === 0) return '';
    // Group by ISO week
    const weeks = {};
    for (const dp of dataPoints) {
      const d = new Date(dp.date + 'T00:00:00');
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      const weekKey = monday.toISOString().slice(0, 10);
      if (!weeks[weekKey]) weeks[weekKey] = 0;
      if (dp.commits) weeks[weekKey]++;
    }
    const lines = [];
    const weekKeys = Object.keys(weeks).sort();
    for (const wk of weekKeys) {
      const d = new Date(wk + 'T00:00:00');
      const label = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
      lines.push(`${label}: ${weeks[wk]} day${weeks[wk] !== 1 ? 's' : ''}`);
    }
    return lines.join('\n');
  },

  renderActivitySparkline(dataPoints, width = 80, height = 20) {
    if (!dataPoints || dataPoints.length === 0) {
      return '<span class="sparkline-empty">--</span>';
    }

    // Check if there's any activity at all
    const hasActivity = dataPoints.some(d => d.commits === 1);
    if (!hasActivity) {
      return '<span class="sparkline-empty">--</span>';
    }

    const pad = 2;
    const barWidth = 1.5;
    const gap = (width - pad * 2) / dataPoints.length;
    const barHeight = height - pad * 2;

    const tooltip = this._buildActivityTooltip(dataPoints);

    let bars = '';
    for (let i = 0; i < dataPoints.length; i++) {
      if (dataPoints[i].commits === 1) {
        const x = pad + i * gap;
        bars += `<rect x="${x.toFixed(1)}" y="${pad}" width="${barWidth}" height="${barHeight}" fill="#0052cc" opacity="0.7" rx="0.5"/>`;
      }
    }

    return `<svg class="sparkline activity-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <title>${tooltip}</title>
      ${bars}
    </svg>`;
  }
};

window.UI = UI;
