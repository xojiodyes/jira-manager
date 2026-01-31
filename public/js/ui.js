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

  renderSparkline(dataPoints, issueKey, width = 80, height = 20) {
    if (!dataPoints || dataPoints.length === 0) {
      return '<span class="sparkline-empty">--</span>';
    }

    const keyAttr = issueKey ? ` data-issue-key="${this.escapeHtml(issueKey)}"` : '';
    const clickClass = issueKey ? ' sparkline-clickable' : '';

    const pad = 2;
    const w = width - pad * 2;
    const h = height - pad * 2;
    const maxY = 100;

    const lastProgress = dataPoints[dataPoints.length - 1].progress;
    const color = lastProgress >= 80 ? '#36b37e' : lastProgress >= 40 ? '#0052cc' : '#ff5630';

    if (dataPoints.length === 1) {
      const cx = width / 2;
      const cy = pad + h - (dataPoints[0].progress / maxY) * h;
      return `<svg class="sparkline${clickClass}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${keyAttr}>
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

    return `<svg class="sparkline${clickClass}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${keyAttr}>
      <polygon points="${areaPoints}" fill="${color}" opacity="0.1"/>
      <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2" fill="${color}"/>
    </svg>`;
  },
  /**
   * Get git dot color based on last activity date freshness
   * @param {string|null} lastActivity - "YYYY-MM-DD" date string
   * @returns {{ color: string, className: string }}
   */
  _getGitDotColor(lastActivity) {
    if (!lastActivity) return { color: '#DFE1E6', className: 'git-dot--gray' };
    const now = new Date();
    const last = new Date(lastActivity + 'T00:00:00');
    const diffDays = Math.floor((now - last) / 86400000);
    if (diffDays <= 7) return { color: '#36B37E', className: 'git-dot--green' };
    if (diffDays <= 30) return { color: '#FFAB00', className: 'git-dot--yellow' };
    return { color: '#FF5630', className: 'git-dot--red' };
  },

  /**
   * Render git activity dot indicator
   * @param {Object|null} gitData - { lastActivity, prCount, prMerged, prOpen, repoCount, commitCount }
   * @param {string} issueKey - issue key for popup data binding
   * @returns {string} HTML string
   */
  renderGitDot(gitData, issueKey) {
    if (!gitData || !gitData.lastActivity) {
      return '<span class="git-dot git-dot--gray" title="No git activity"></span>';
    }
    const { className } = this._getGitDotColor(gitData.lastActivity);
    const relDate = this.formatRelativeDate(gitData.lastActivity);
    return `<span class="git-dot ${className}" data-issue-key="${this.escapeHtml(issueKey)}" title="Last activity: ${relDate}"></span>`;
  },

  /**
   * Show git activity popup
   * @param {Object} gitData - { lastActivity, prCount, prMerged, prOpen, repoCount, commitCount }
   * @param {HTMLElement} anchorEl - dot element to anchor popup to
   * @param {string} issueKey
   * @param {Object} childrenGit - { "CHILD-1": gitData, ... } for parent issues
   */
  showGitPopup(gitData, anchorEl, issueKey, childrenGit) {
    this.hideGitPopup();

    const backdrop = document.createElement('div');
    backdrop.className = 'git-popup-backdrop';
    backdrop.addEventListener('click', () => this.hideGitPopup());

    const popup = document.createElement('div');
    popup.className = 'git-popup';

    // Header
    let html = `<div class="git-popup-header">
      <span class="git-popup-title">${this.escapeHtml(issueKey)}</span>
      <button class="git-popup-close" onclick="UI.hideGitPopup()">✕</button>
    </div>`;

    // Activity info
    html += '<div class="git-popup-body">';

    if (gitData && gitData.lastActivity) {
      const relDate = this.formatRelativeDate(gitData.lastActivity);
      const { color } = this._getGitDotColor(gitData.lastActivity);
      html += `<div class="git-popup-row">
        <span class="git-popup-label">Last activity</span>
        <span class="git-popup-value" style="color:${color};font-weight:600">${relDate}</span>
      </div>`;

      if (gitData.prCount > 0) {
        let prText = `${gitData.prCount} PR`;
        if (gitData.prCount > 1) prText += 's';
        const details = [];
        if (gitData.prMerged > 0) details.push(`${gitData.prMerged} merged`);
        if (gitData.prOpen > 0) details.push(`${gitData.prOpen} open`);
        if (details.length > 0) prText += ` (${details.join(', ')})`;
        html += `<div class="git-popup-row">
          <span class="git-popup-label">Pull Requests</span>
          <span class="git-popup-value">${prText}</span>
        </div>`;
      }

      if (gitData.repoCount > 0) {
        html += `<div class="git-popup-row">
          <span class="git-popup-label">Repositories</span>
          <span class="git-popup-value">${gitData.repoCount}</span>
        </div>`;
      }

      if (gitData.commitCount > 0) {
        html += `<div class="git-popup-row">
          <span class="git-popup-label">Commits</span>
          <span class="git-popup-value">${gitData.commitCount}</span>
        </div>`;
      }
    } else {
      html += '<div class="git-popup-empty">No git activity</div>';
    }

    // Children activity for parent issues
    if (childrenGit && Object.keys(childrenGit).length > 0) {
      const entries = Object.entries(childrenGit)
        .filter(([, g]) => g && g.lastActivity)
        .sort((a, b) => (b[1].lastActivity || '').localeCompare(a[1].lastActivity || ''));

      if (entries.length > 0) {
        html += '<div class="git-popup-divider"></div>';
        html += `<div class="git-popup-section-title">Child issues (${entries.length})</div>`;
        for (const [key, g] of entries) {
          const rel = this.formatRelativeDate(g.lastActivity);
          const { color } = this._getGitDotColor(g.lastActivity);
          const prInfo = g.prCount > 0 ? ` · ${g.prCount} PR` : '';
          html += `<div class="git-popup-child">
            <span class="git-popup-child-dot" style="background:${color}"></span>
            <span class="git-popup-child-key">${this.escapeHtml(key)}</span>
            <span class="git-popup-child-date">${rel}${prInfo}</span>
          </div>`;
        }
      }
    }

    html += '</div>';
    popup.innerHTML = html;

    document.body.appendChild(backdrop);
    document.body.appendChild(popup);

    // Position popup near anchor
    const rect = anchorEl.getBoundingClientRect();
    const popupHeight = 300; // estimate
    const spaceBelow = window.innerHeight - rect.bottom;

    popup.style.left = Math.max(8, Math.min(rect.left - 100, window.innerWidth - 280)) + 'px';
    if (spaceBelow < popupHeight && rect.top > popupHeight) {
      popup.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    } else {
      popup.style.top = (rect.bottom + 4) + 'px';
    }
  },

  /**
   * Hide git activity popup
   */
  hideGitPopup() {
    const existing = document.querySelector('.git-popup');
    if (existing) existing.remove();
    const backdrop = document.querySelector('.git-popup-backdrop');
    if (backdrop) backdrop.remove();
  },

  /**
   * Show trend popup with weekly progress data
   * @param {Array<{date: string, progress: number}>} dataPoints
   * @param {HTMLElement} anchorEl - sparkline element to anchor popup to
   * @param {string} issueKey
   * @param {Object} childrenProgress - { "CHILD-1": [{date, progress}], ... }
   */
  showTrendPopup(dataPoints, anchorEl, issueKey, childrenProgress) {
    this.hideTrendPopup();

    const backdrop = document.createElement('div');
    backdrop.className = 'trend-popup-backdrop';
    backdrop.addEventListener('click', () => this.hideTrendPopup());

    const popup = document.createElement('div');
    popup.className = 'trend-popup';

    let html = `<div class="git-popup-header">
      <span class="git-popup-title">${this.escapeHtml(issueKey)} — Trend</span>
      <button class="git-popup-close" onclick="UI.hideTrendPopup()">✕</button>
    </div>`;

    html += '<div class="git-popup-body">';

    if (!dataPoints || dataPoints.length === 0) {
      html += '<div class="git-popup-empty">No progress data</div>';
    } else {
      // Current progress
      const last = dataPoints[dataPoints.length - 1];
      const first = dataPoints[0];
      const delta = last.progress - first.progress;
      const deltaSign = delta > 0 ? '+' : '';
      const deltaColor = delta > 0 ? '#36b37e' : delta < 0 ? '#ff5630' : '#97a0af';

      html += `<div class="git-popup-row">
        <span class="git-popup-label">Current</span>
        <span class="git-popup-value" style="font-weight:600">${last.progress}%</span>
      </div>`;
      html += `<div class="git-popup-row">
        <span class="git-popup-label">Change (${dataPoints.length}d)</span>
        <span class="git-popup-value" style="color:${deltaColor};font-weight:600">${deltaSign}${delta}%</span>
      </div>`;
      html += `<div class="git-popup-row">
        <span class="git-popup-label">Period</span>
        <span class="git-popup-value">${this._fmtShortDate(first.date)} — ${this._fmtShortDate(last.date)}</span>
      </div>`;

      // Larger sparkline
      html += '<div class="trend-popup-chart">';
      html += this._renderLargeSparkline(dataPoints, 230, 60);
      html += '</div>';

      // Weekly breakdown
      const weeks = this._groupByWeek(dataPoints);
      if (weeks.length > 0) {
        html += '<div class="git-popup-divider"></div>';
        html += '<div class="git-popup-section-title">Weekly average</div>';
        for (const w of weeks) {
          const wDelta = w.end - w.start;
          const wSign = wDelta > 0 ? '+' : '';
          const wColor = wDelta > 0 ? '#36b37e' : wDelta < 0 ? '#ff5630' : '#97a0af';
          html += `<div class="git-popup-row">
            <span class="git-popup-label">${w.label}</span>
            <span class="git-popup-value">${w.avg}% <span style="color:${wColor};font-size:11px">${wSign}${wDelta}</span></span>
          </div>`;
        }
      }
    }

    // Children trends
    if (childrenProgress && Object.keys(childrenProgress).length > 0) {
      const entries = Object.entries(childrenProgress)
        .filter(([, pts]) => pts && pts.length > 0)
        .map(([key, pts]) => {
          const last = pts[pts.length - 1].progress;
          const first = pts[0].progress;
          return { key, last, delta: last - first, points: pts };
        })
        .sort((a, b) => b.last - a.last);

      if (entries.length > 0) {
        html += '<div class="git-popup-divider"></div>';
        html += `<div class="git-popup-section-title">Child issues (${entries.length})</div>`;
        for (const e of entries) {
          const sign = e.delta > 0 ? '+' : '';
          const color = e.delta > 0 ? '#36b37e' : e.delta < 0 ? '#ff5630' : '#97a0af';
          html += `<div class="git-popup-child">
            <span class="git-popup-child-key">${this.escapeHtml(e.key)}</span>
            <span class="git-popup-child-date">${e.last}% <span style="color:${color}">${sign}${e.delta}</span></span>
          </div>`;
        }
      }
    }

    html += '</div>';
    popup.innerHTML = html;

    document.body.appendChild(backdrop);
    document.body.appendChild(popup);

    // Position popup near anchor
    const rect = anchorEl.getBoundingClientRect();
    const popupHeight = 400;
    const spaceBelow = window.innerHeight - rect.bottom;

    popup.style.left = Math.max(8, Math.min(rect.left - 100, window.innerWidth - 280)) + 'px';
    if (spaceBelow < popupHeight && rect.top > popupHeight) {
      popup.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    } else {
      popup.style.top = (rect.bottom + 4) + 'px';
    }
  },

  hideTrendPopup() {
    const existing = document.querySelector('.trend-popup');
    if (existing) existing.remove();
    const backdrop = document.querySelector('.trend-popup-backdrop');
    if (backdrop) backdrop.remove();
  },

  _fmtShortDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  },

  _groupByWeek(dataPoints) {
    const weeks = {};
    for (const dp of dataPoints) {
      const d = new Date(dp.date + 'T00:00:00');
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      const weekKey = monday.toISOString().slice(0, 10);
      if (!weeks[weekKey]) weeks[weekKey] = [];
      weeks[weekKey].push(dp.progress);
    }
    const result = [];
    for (const wk of Object.keys(weeks).sort()) {
      const vals = weeks[wk];
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      const d = new Date(wk + 'T00:00:00');
      const label = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
      result.push({ label, avg, start: vals[0], end: vals[vals.length - 1] });
    }
    return result;
  },

  _renderLargeSparkline(dataPoints, width, height) {
    const pad = 4;
    const w = width - pad * 2;
    const h = height - pad * 2;
    const maxY = 100;

    const lastProgress = dataPoints[dataPoints.length - 1].progress;
    const color = lastProgress >= 80 ? '#36b37e' : lastProgress >= 40 ? '#0052cc' : '#ff5630';

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

    // Grid lines at 25%, 50%, 75%
    let gridLines = '';
    for (const pct of [25, 50, 75]) {
      const y = (pad + h - (pct / maxY) * h).toFixed(1);
      gridLines += `<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="#e0e0e0" stroke-width="0.5" stroke-dasharray="3,3"/>`;
      gridLines += `<text x="${pad + 1}" y="${y - 2}" font-size="8" fill="#97a0af">${pct}%</text>`;
    }

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;margin:8px auto 0">
      ${gridLines}
      <polygon points="${areaPoints}" fill="${color}" opacity="0.1"/>
      <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3" fill="${color}"/>
    </svg>`;
  }
};

window.UI = UI;
