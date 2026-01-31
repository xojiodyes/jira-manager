// Mock data for testing without a real Jira connection
// Activated when X-Jira-Host header is "mock"

const USERS = {
  ivan: {
    accountId: 'mock-user-1',
    displayName: 'Иван Петров',
    emailAddress: 'ivan@example.com',
    avatarUrls: { '48x48': '', '32x32': '', '24x24': '', '16x16': '' },
    active: true
  },
  anna: {
    accountId: 'mock-user-2',
    displayName: 'Анна Сидорова',
    emailAddress: 'anna@example.com',
    avatarUrls: { '48x48': '', '32x32': '', '24x24': '', '16x16': '' },
    active: true
  },
  sergey: {
    accountId: 'mock-user-3',
    displayName: 'Сергей Козлов',
    emailAddress: 'sergey@example.com',
    avatarUrls: { '48x48': '', '32x32': '', '24x24': '', '16x16': '' },
    active: true
  }
};

const STATUSES = {
  todo: { name: 'To Do', id: '10000', statusCategory: { id: 2, key: 'new', name: 'To Do' } },
  inProgress: { name: 'In Progress', id: '10001', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } },
  inReview: { name: 'In Review', id: '10002', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } },
  done: { name: 'Done', id: '10003', statusCategory: { id: 3, key: 'done', name: 'Done' } }
};

const PRIORITIES = {
  highest: { id: '1', name: 'Highest', iconUrl: '' },
  high: { id: '2', name: 'High', iconUrl: '' },
  medium: { id: '3', name: 'Medium', iconUrl: '' },
  low: { id: '4', name: 'Low', iconUrl: '' }
};

const ISSUE_TYPES = {
  story: { id: '10001', name: 'Story', iconUrl: '' },
  bug: { id: '10002', name: 'Bug', iconUrl: '' },
  task: { id: '10003', name: 'Task', iconUrl: '' },
  epic: { id: '10004', name: 'Epic', iconUrl: '' }
};

const PROJECTS = [
  { id: '10000', key: 'PROJ', name: 'Основной проект', projectTypeKey: 'software' },
  { id: '10001', key: 'DEMO', name: 'Демо проект', projectTypeKey: 'software' }
];

const LINK_TYPE = {
  name: 'Hierarchy',
  inward: 'is child of',
  outward: 'is parent of'
};

const now = new Date();
const daysAgo = (d) => new Date(now - d * 86400000).toISOString();
const hoursAgo = (h) => new Date(now - h * 3600000).toISOString();

// Helper to create a link reference (populated after ISSUES array is built)
function outwardLink(key) {
  return { type: LINK_TYPE, outwardIssue: { key, fields: null } };
}
function inwardLink(key) {
  return { type: LINK_TYPE, inwardIssue: { key, fields: null } };
}

const ISSUES = [
  // === THEMES ===
  {
    id: '10010', key: 'PROJ-10',
    fields: {
      summary: 'Авторизация и безопасность',
      description: 'Тема, объединяющая все задачи по авторизации, аутентификации и безопасности платформы.',
      status: STATUSES.inProgress,
      assignee: USERS.ivan,
      priority: PRIORITIES.high,
      issuetype: ISSUE_TYPES.story,
      project: PROJECTS[0],
      labels: ['Theme'],
      created: daysAgo(30),
      updated: daysAgo(1),
      issuelinks: [outwardLink('PROJ-12'), outwardLink('PROJ-13')],
      comment: { comments: [], total: 0 }
    }
  },
  {
    id: '10011', key: 'PROJ-11',
    fields: {
      summary: 'Платформа и инфраструктура',
      description: 'Тема, объединяющая задачи по инфраструктуре, CI/CD, мониторингу и DevOps.',
      status: STATUSES.inProgress,
      assignee: USERS.sergey,
      priority: PRIORITIES.high,
      issuetype: ISSUE_TYPES.story,
      project: PROJECTS[0],
      labels: ['theme'],
      created: daysAgo(30),
      updated: daysAgo(2),
      issuelinks: [outwardLink('PROJ-14')],
      comment: { comments: [], total: 0 }
    }
  },

  // === MILESTONES ===
  {
    id: '10012', key: 'PROJ-12',
    fields: {
      summary: 'Q1 2026 Release',
      description: 'Milestone для первого квартала 2026. Включает основные фичи авторизации и критические багфиксы.',
      status: STATUSES.inProgress,
      assignee: USERS.ivan,
      priority: PRIORITIES.high,
      issuetype: ISSUE_TYPES.story,
      project: PROJECTS[0],
      labels: ['Milestone'],
      created: daysAgo(28),
      updated: daysAgo(1),
      duedate: '2026-03-31',
      customfield_18801: '2026-03-15',
      customfield_10002: 3,
      resolution: null,
      issuelinks: [inwardLink('PROJ-10'), outwardLink('PROJ-1'), outwardLink('PROJ-2'), outwardLink('PROJ-20')],
      comment: { comments: [], total: 0 }
    }
  },
  {
    id: '10013', key: 'PROJ-13',
    fields: {
      summary: 'Q2 2026 Planning',
      description: 'Milestone для второго квартала. Включает пагинацию и модуль оплаты.',
      status: STATUSES.todo,
      assignee: USERS.anna,
      priority: PRIORITIES.medium,
      issuetype: ISSUE_TYPES.story,
      project: PROJECTS[0],
      labels: ['milestone'],
      created: daysAgo(20),
      updated: daysAgo(3),
      duedate: '2026-06-30',
      customfield_18801: '2026-05-15',
      customfield_10002: 2,
      resolution: null,
      issuelinks: [inwardLink('PROJ-10'), outwardLink('PROJ-3'), outwardLink('PROJ-4')],
      comment: { comments: [], total: 0 }
    }
  },
  {
    id: '10014', key: 'PROJ-14',
    fields: {
      summary: 'MVP Демо-продукт',
      description: 'Milestone для MVP демо-продукта. Landing page и исправление мобильных багов.',
      status: STATUSES.inProgress,
      assignee: USERS.anna,
      priority: PRIORITIES.high,
      issuetype: ISSUE_TYPES.story,
      project: PROJECTS[1],
      labels: ['Milestone'],
      created: daysAgo(15),
      updated: hoursAgo(2),
      duedate: '2026-04-30',
      customfield_18801: '2026-04-15',
      customfield_10002: 4,
      resolution: null,
      issuelinks: [inwardLink('PROJ-11'), outwardLink('DEMO-1'), outwardLink('DEMO-3')],
      comment: { comments: [], total: 0 }
    }
  },

  // === EPICS ===
  {
    id: '10020', key: 'PROJ-20',
    fields: {
      summary: 'OAuth Integration Epic',
      description: 'Epic for all OAuth-related tasks.',
      status: STATUSES.inProgress,
      assignee: USERS.ivan,
      priority: PRIORITIES.high,
      issuetype: ISSUE_TYPES.epic,
      project: PROJECTS[0],
      labels: [],
      created: daysAgo(25),
      updated: daysAgo(1),
      issuelinks: [inwardLink('PROJ-12'), outwardLink('PROJ-21'), outwardLink('PROJ-22')],
      comment: { comments: [], total: 0 }
    }
  },
  {
    id: '10021', key: 'PROJ-21',
    fields: {
      summary: 'Implement Google OAuth provider',
      description: 'Add Google as an OAuth provider.',
      status: STATUSES.inProgress,
      assignee: USERS.ivan,
      priority: PRIORITIES.high,
      issuetype: ISSUE_TYPES.task,
      project: PROJECTS[0],
      labels: [],
      created: daysAgo(20),
      updated: daysAgo(1),
      issuelinks: [inwardLink('PROJ-20')],
      comment: { comments: [], total: 0 }
    }
  },
  {
    id: '10022', key: 'PROJ-22',
    fields: {
      summary: 'Implement GitHub OAuth provider',
      description: 'Add GitHub as an OAuth provider.',
      status: STATUSES.todo,
      assignee: USERS.anna,
      priority: PRIORITIES.medium,
      issuetype: ISSUE_TYPES.task,
      project: PROJECTS[0],
      labels: [],
      created: daysAgo(20),
      updated: daysAgo(3),
      issuelinks: [inwardLink('PROJ-20')],
      comment: { comments: [], total: 0 }
    }
  },

  // === REGULAR ISSUES ===
  {
    id: '10001', key: 'PROJ-1',
    fields: {
      summary: 'Реализовать авторизацию через OAuth 2.0',
      description: 'Необходимо добавить поддержку авторизации через OAuth 2.0.\n\n*Требования:*\n- Поддержка Google и GitHub провайдеров\n- Сохранение токенов в secure cookie\n- Refresh token flow\n\n{code}\nconst oauth = new OAuth2Client(clientId, clientSecret);\n{code}',
      status: STATUSES.inProgress,
      assignee: USERS.ivan,
      priority: PRIORITIES.high,
      issuetype: ISSUE_TYPES.story,
      project: PROJECTS[0],
      labels: [],
      created: daysAgo(5),
      updated: hoursAgo(2),
      issuelinks: [inwardLink('PROJ-12')],
      comment: { comments: [
        { id: '1', author: USERS.anna, body: 'Начала review PR, выглядит хорошо. Пара мелких замечаний.', created: hoursAgo(3), updated: hoursAgo(3) },
        { id: '2', author: USERS.ivan, body: 'Поправил замечания, можно перепроверить.', created: hoursAgo(2), updated: hoursAgo(2) }
      ], total: 2 }
    }
  },
  {
    id: '10002', key: 'PROJ-2',
    fields: {
      summary: 'Исправить утечку памяти в WebSocket соединении',
      description: 'При длительном подключении через WebSocket наблюдается утечка памяти.\n\nШаги воспроизведения:\n- Открыть приложение\n- Оставить вкладку открытой на 2+ часа\n- Наблюдать рост потребления памяти в DevTools',
      status: STATUSES.inReview,
      assignee: USERS.sergey,
      priority: PRIORITIES.highest,
      issuetype: ISSUE_TYPES.bug,
      project: PROJECTS[0],
      labels: [],
      created: daysAgo(3),
      updated: hoursAgo(5),
      issuelinks: [inwardLink('PROJ-12')],
      comment: { comments: [
        { id: '3', author: USERS.sergey, body: 'Нашёл причину — не отписываемся от event listener при reconnect.', created: daysAgo(1), updated: daysAgo(1) }
      ], total: 1 }
    }
  },
  {
    id: '10003', key: 'PROJ-3',
    fields: {
      summary: 'Добавить пагинацию в список пользователей',
      description: 'Список пользователей загружает все записи сразу. При большом количестве (5000+) страница тормозит.\n\nНужно добавить серверную пагинацию с размером страницы 50.',
      status: STATUSES.todo,
      assignee: USERS.anna,
      priority: PRIORITIES.medium,
      issuetype: ISSUE_TYPES.story,
      project: PROJECTS[0],
      labels: [],
      created: daysAgo(7),
      updated: daysAgo(2),
      issuelinks: [inwardLink('PROJ-13')],
      comment: { comments: [], total: 0 }
    }
  },
  {
    id: '10004', key: 'PROJ-4',
    fields: {
      summary: 'Написать unit-тесты для модуля оплаты',
      description: 'Покрытие модуля оплаты тестами < 30%. Нужно довести до 80%.\n\nКлючевые сценарии:\n- Успешная оплата\n- Недостаточно средств\n- Таймаут платёжного шлюза\n- Повторная оплата (идемпотентность)',
      status: STATUSES.todo,
      assignee: USERS.ivan,
      priority: PRIORITIES.medium,
      issuetype: ISSUE_TYPES.task,
      project: PROJECTS[0],
      labels: [],
      created: daysAgo(10),
      updated: daysAgo(4),
      issuelinks: [inwardLink('PROJ-13')],
      comment: { comments: [], total: 0 }
    }
  },
  {
    id: '10005', key: 'PROJ-5',
    fields: {
      summary: 'Обновить зависимости до актуальных версий',
      description: 'Несколько пакетов имеют критические уязвимости (npm audit).\n\nНужно обновить:\n- express: 4.17 → 4.21\n- jsonwebtoken: 8.5 → 9.0\n- mongoose: 6.x → 8.x',
      status: STATUSES.done,
      assignee: USERS.sergey,
      priority: PRIORITIES.high,
      issuetype: ISSUE_TYPES.task,
      project: PROJECTS[0],
      labels: [],
      created: daysAgo(14),
      updated: daysAgo(1),
      issuelinks: [],
      comment: { comments: [
        { id: '4', author: USERS.sergey, body: 'Все пакеты обновлены, тесты проходят.', created: daysAgo(1), updated: daysAgo(1) },
        { id: '5', author: USERS.anna, body: 'Проверила на staging — всё работает. Можно закрывать.', created: daysAgo(1), updated: daysAgo(1) }
      ], total: 2 }
    }
  },
  {
    id: '10006', key: 'DEMO-1',
    fields: {
      summary: 'Создать landing page для нового продукта',
      description: 'Дизайн готов в Figma. Нужно сверстать лендинг.\n\n*Секции:*\n- Hero с анимацией\n- Преимущества (3 колонки)\n- Тарифы\n- FAQ (аккордеон)\n- Форма обратной связи',
      status: STATUSES.inProgress,
      assignee: USERS.anna,
      priority: PRIORITIES.high,
      issuetype: ISSUE_TYPES.story,
      project: PROJECTS[1],
      labels: [],
      created: daysAgo(4),
      updated: hoursAgo(1),
      issuelinks: [inwardLink('PROJ-14')],
      comment: { comments: [
        { id: '6', author: USERS.anna, body: 'Hero и преимущества готовы. Сейчас делаю тарифы.', created: hoursAgo(1), updated: hoursAgo(1) }
      ], total: 1 }
    }
  },
  {
    id: '10007', key: 'DEMO-2',
    fields: {
      summary: 'Настроить CI/CD пайплайн в GitHub Actions',
      description: 'Нужно настроить автоматический деплой:\n\n- Линтинг и тесты на каждый PR\n- Деплой на staging при мерже в develop\n- Деплой на production при мерже в main\n- Уведомления в Slack',
      status: STATUSES.done,
      assignee: USERS.sergey,
      priority: PRIORITIES.medium,
      issuetype: ISSUE_TYPES.task,
      project: PROJECTS[1],
      labels: [],
      created: daysAgo(12),
      updated: daysAgo(3),
      issuelinks: [],
      comment: { comments: [
        { id: '7', author: USERS.sergey, body: 'Pipeline настроен, Slack webhook подключен.', created: daysAgo(3), updated: daysAgo(3) }
      ], total: 1 }
    }
  },
  {
    id: '10008', key: 'DEMO-3',
    fields: {
      summary: 'Кнопка "Купить" не работает на мобильных устройствах',
      description: 'На iOS Safari и Chrome Mobile кнопка "Купить" не реагирует на нажатие.\n\nВоспроизводится на:\n- iPhone 14, iOS 17, Safari\n- Samsung Galaxy S23, Chrome 120\n\nНа десктопе работает нормально.',
      status: STATUSES.inProgress,
      assignee: USERS.ivan,
      priority: PRIORITIES.highest,
      issuetype: ISSUE_TYPES.bug,
      project: PROJECTS[1],
      labels: [],
      created: daysAgo(1),
      updated: hoursAgo(4),
      issuelinks: [inwardLink('PROJ-14')],
      comment: { comments: [
        { id: '8', author: USERS.ivan, body: 'Похоже на проблему с z-index — оверлей перекрывает кнопку на маленьких экранах.', created: hoursAgo(4), updated: hoursAgo(4) }
      ], total: 1 }
    }
  },
  {
    id: '10009', key: 'PROJ-6',
    fields: {
      summary: 'Добавить экспорт отчётов в PDF',
      description: 'Пользователи просят возможность экспорта отчётов в PDF.\n\nТребования:\n- Таблицы с данными\n- Графики (конвертировать canvas в изображение)\n- Фирменный стиль (логотип, шапка)',
      status: STATUSES.todo,
      assignee: null,
      priority: PRIORITIES.low,
      issuetype: ISSUE_TYPES.story,
      project: PROJECTS[0],
      labels: [],
      created: daysAgo(2),
      updated: daysAgo(2),
      issuelinks: [],
      comment: { comments: [], total: 0 }
    }
  }
];

// Populate link references with actual field data (summary, labels, status)
for (const issue of ISSUES) {
  if (!issue.fields.issuelinks) continue;
  for (const link of issue.fields.issuelinks) {
    const targetKey = link.outwardIssue?.key || link.inwardIssue?.key;
    const target = ISSUES.find(i => i.key === targetKey);
    if (!target) continue;
    const ref = { key: targetKey, fields: { summary: target.fields.summary, labels: target.fields.labels, status: target.fields.status, issuetype: target.fields.issuetype } };
    if (link.outwardIssue) link.outwardIssue = ref;
    if (link.inwardIssue) link.inwardIssue = ref;
  }
}

// Simple JQL filter
function filterByJql(jql) {
  if (!jql) return ISSUES;

  const lower = jql.toLowerCase();
  let filtered = [...ISSUES];

  // key in (X, Y, Z)
  const keyInMatch = jql.match(/key\s+in\s*\(([^)]+)\)/i);
  if (keyInMatch) {
    const keys = keyInMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
    filtered = filtered.filter(i => keys.includes(i.key));
  }

  // Complex label filter: (labels is EMPTY OR (labels != X AND labels != Y))
  const complexLabelMatch = lower.match(/\(labels\s+is\s+empty\s+or\s+\(([^)]+)\)\)/);
  if (complexLabelMatch) {
    const conditions = complexLabelMatch[1];
    const neqMatches = [...conditions.matchAll(/labels\s*!=\s*['"]?(\w+)['"]?/gi)];
    const excludedLabels = neqMatches.map(m => m[1].toLowerCase());
    filtered = filtered.filter(i => {
      const labels = (i.fields.labels || []).map(l => l.toLowerCase());
      if (labels.length === 0) return true;
      return !labels.some(l => excludedLabels.includes(l));
    });
  }

  // labels = X (case-insensitive) — only if not already handled by complex filter
  if (!complexLabelMatch) {
    const labelMatch = lower.match(/labels\s*=\s*['"]?(\w+)['"]?/);
    if (labelMatch) {
      const lbl = labelMatch[1].toLowerCase();
      filtered = filtered.filter(i => (i.fields.labels || []).some(l => l.toLowerCase() === lbl));
    }
  }

  // labels in (X, Y)
  const labelsInMatch = lower.match(/labels\s+in\s*\(([^)]+)\)/);
  if (labelsInMatch) {
    const lbls = labelsInMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '').toLowerCase());
    filtered = filtered.filter(i => (i.fields.labels || []).some(l => lbls.includes(l.toLowerCase())));
  }

  // project = X
  const projectMatch = lower.match(/project\s*=\s*['"]?(\w+)['"]?/);
  if (projectMatch) {
    const proj = projectMatch[1].toUpperCase();
    filtered = filtered.filter(i => i.fields.project.key === proj);
  }

  // status = X
  const statusMatch = lower.match(/status\s*=\s*'([^']+)'/);
  if (statusMatch) {
    const st = statusMatch[1].toLowerCase();
    filtered = filtered.filter(i => i.fields.status.name.toLowerCase() === st);
  }

  // status != X
  const statusNeqMatch = lower.match(/status\s*!=\s*'?(\w+)'?/);
  if (statusNeqMatch) {
    const st = statusNeqMatch[1].toLowerCase();
    filtered = filtered.filter(i => i.fields.status.name.toLowerCase() !== st);
  }

  // issuetype = X / type = X
  const typeMatch = lower.match(/(?:issuetype|type)\s*=\s*['"]?(\w+)['"]?/);
  if (typeMatch) {
    const t = typeMatch[1].toLowerCase();
    filtered = filtered.filter(i => i.fields.issuetype.name.toLowerCase() === t);
  }

  // assignee = currentUser() — return all assigned issues
  if (lower.includes('assignee = currentuser()')) {
    filtered = filtered.filter(i => i.fields.assignee !== null);
  }

  // created >= -Nd
  const createdMatch = lower.match(/created\s*>=\s*-(\d+)d/);
  if (createdMatch) {
    const days = parseInt(createdMatch[1]);
    const since = new Date(now - days * 86400000).toISOString();
    filtered = filtered.filter(i => i.fields.created >= since);
  }

  // updated >= -Nd
  const updatedMatch = lower.match(/updated\s*>=\s*-(\d+)d/);
  if (updatedMatch) {
    const days = parseInt(updatedMatch[1]);
    const since = new Date(now - days * 86400000).toISOString();
    filtered = filtered.filter(i => i.fields.updated >= since);
  }

  // ORDER BY
  const orderMatch = lower.match(/order\s+by\s+(\w+)\s+(asc|desc)?/);
  if (orderMatch) {
    const field = orderMatch[1];
    const dir = orderMatch[2] || 'desc';
    filtered.sort((a, b) => {
      let va = a.fields[field] || '';
      let vb = b.fields[field] || '';
      if (field === 'priority') {
        va = a.fields.priority ? a.fields.priority.id : '99';
        vb = b.fields.priority ? b.fields.priority.id : '99';
      }
      if (dir === 'asc') return va > vb ? 1 : -1;
      return va < vb ? 1 : -1;
    });
  }

  return filtered;
}

// Track next ID for creating issues
let nextId = 20000;

// Generate mock changelog with status transitions for testing sparklines
function generateMockChangelog(issue) {
  const statusName = issue.fields.status?.name || 'To Do';
  const statusFlow = ['To Do', 'In Progress', 'In Review', 'Done'];
  const currentIdx = statusFlow.indexOf(statusName);
  if (currentIdx <= 0) {
    // No transitions — stayed in To Do
    return { histories: [], maxResults: 0, total: 0, startAt: 0 };
  }

  // Generate transitions spread over the last 60 days
  const histories = [];
  const now = new Date();
  const daysBack = 55; // start transitions ~55 days ago
  const stepDays = Math.floor(daysBack / currentIdx);

  const userKeys = Object.keys(USERS);
  // Assign different people at different phases
  const phaseAssignees = {
    'In Progress': USERS[userKeys[Math.floor(Math.random() * userKeys.length)]],
    'In Review': USERS[userKeys[Math.floor(Math.random() * userKeys.length)]],
    'Done': null
  };
  let prevAssignee = null;

  for (let i = 0; i < currentIdx; i++) {
    const transDate = new Date(now);
    transDate.setDate(transDate.getDate() - (daysBack - i * stepDays));
    const randomUser = USERS[userKeys[Math.floor(Math.random() * userKeys.length)]];
    const newStatus = statusFlow[i + 1];
    const newAssignee = phaseAssignees[newStatus] || randomUser;

    const items = [{
      field: 'status',
      fieldtype: 'jira',
      from: String(i),
      fromString: statusFlow[i],
      to: String(i + 1),
      toString: newStatus
    }];

    // Add assignee change when transitioning to a work phase
    if (newStatus !== 'Done' && newAssignee) {
      items.push({
        field: 'assignee',
        fieldtype: 'jira',
        from: prevAssignee?.accountId || null,
        fromString: prevAssignee?.displayName || null,
        to: newAssignee.accountId,
        toString: newAssignee.displayName
      });
      prevAssignee = newAssignee;
    }

    histories.push({
      id: String(10000 + Math.random() * 10000 | 0),
      author: randomUser,
      created: transDate.toISOString(),
      items
    });
  }

  return { histories, maxResults: histories.length, total: histories.length, startAt: 0 };
}

// Handle mock API requests
function handleMockRequest(jiraPath, query, method, reqBody) {
  method = (method || 'GET').toUpperCase();

  // POST /rest/api/2/issue — create issue
  if (jiraPath === '/rest/api/2/issue' && method === 'POST') {
    const data = typeof reqBody === 'string' ? JSON.parse(reqBody) : reqBody;
    const fields = data.fields || {};
    const projectKey = fields.project?.key || 'PROJ';
    const project = PROJECTS.find(p => p.key === projectKey) || PROJECTS[0];

    // Generate next issue number for this project
    const projectIssues = ISSUES.filter(i => i.key.startsWith(projectKey + '-'));
    const maxNum = projectIssues.reduce((max, i) => {
      const num = parseInt(i.key.split('-')[1]);
      return num > max ? num : max;
    }, 0);
    const newKey = `${projectKey}-${maxNum + 1}`;

    const newIssue = {
      id: String(nextId++),
      key: newKey,
      fields: {
        summary: fields.summary || 'Новая задача',
        description: fields.description || '',
        status: STATUSES.todo,
        assignee: null,
        priority: PRIORITIES.medium,
        issuetype: ISSUE_TYPES[fields.issuetype?.name?.toLowerCase()] || ISSUE_TYPES.story,
        project: project,
        labels: fields.labels || [],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        issuelinks: [],
        comment: { comments: [], total: 0 }
      }
    };

    ISSUES.push(newIssue);
    return { status: 201, body: { id: newIssue.id, key: newIssue.key, self: '' } };
  }

  // POST /rest/api/2/issueLink — create link between issues
  if (jiraPath === '/rest/api/2/issueLink' && method === 'POST') {
    const data = typeof reqBody === 'string' ? JSON.parse(reqBody) : reqBody;
    const linkTypeName = data.type?.name || 'Hierarchy';
    const inwardKey = data.inwardIssue?.key;
    const outwardKey = data.outwardIssue?.key;

    const inwardIssue = ISSUES.find(i => i.key === inwardKey);
    const outwardIssue = ISSUES.find(i => i.key === outwardKey);

    if (!inwardIssue || !outwardIssue) {
      return { status: 404, body: { errorMessages: ['Issue not found'] } };
    }

    const linkType = { name: linkTypeName, inward: 'is child of', outward: 'is parent of' };

    // Add outward link on the outward issue (parent → child)
    outwardIssue.fields.issuelinks.push({
      type: linkType,
      outwardIssue: {
        key: inwardKey,
        fields: { summary: inwardIssue.fields.summary, labels: inwardIssue.fields.labels, status: inwardIssue.fields.status, issuetype: inwardIssue.fields.issuetype }
      }
    });

    // Add inward link on the inward issue (child → parent)
    inwardIssue.fields.issuelinks.push({
      type: linkType,
      inwardIssue: {
        key: outwardKey,
        fields: { summary: outwardIssue.fields.summary, labels: outwardIssue.fields.labels, status: outwardIssue.fields.status, issuetype: outwardIssue.fields.issuetype }
      }
    });

    return { status: 201, body: {} };
  }

  // /rest/api/2/myself
  if (jiraPath === '/rest/api/2/myself') {
    return { status: 200, body: USERS.ivan };
  }

  // /rest/api/2/search
  if (jiraPath === '/rest/api/2/search') {
    const params = new URLSearchParams(query ? query.replace('?', '') : '');
    const jql = params.get('jql') || '';
    const startAt = parseInt(params.get('startAt') || '0');
    const maxResults = parseInt(params.get('maxResults') || '50');
    const fieldsParam = params.get('fields') || '';

    const filtered = filterByJql(jql);
    const page = filtered.slice(startAt, startAt + maxResults);

    return {
      status: 200,
      body: {
        startAt,
        maxResults,
        total: filtered.length,
        issues: page
      }
    };
  }

  // /rest/api/2/issue/:key
  const issueMatch = jiraPath.match(/^\/rest\/api\/2\/issue\/([A-Z]+-\d+)$/);
  if (issueMatch) {
    const issue = ISSUES.find(i => i.key === issueMatch[1]);
    if (!issue) return { status: 404, body: { errorMessages: ['Issue not found'] } };

    // If expand=changelog requested, generate mock changelog
    if (query && query.includes('expand=changelog')) {
      const body = JSON.parse(JSON.stringify(issue));
      body.changelog = generateMockChangelog(issue);
      return { status: 200, body };
    }
    return { status: 200, body: issue };
  }

  // /rest/api/2/issue/:key/comment
  const commentMatch = jiraPath.match(/^\/rest\/api\/2\/issue\/([A-Z]+-\d+)\/comment$/);
  if (commentMatch) {
    const issue = ISSUES.find(i => i.key === commentMatch[1]);
    if (issue) return { status: 200, body: issue.fields.comment };
    return { status: 404, body: { errorMessages: ['Issue not found'] } };
  }

  // /rest/api/2/status
  if (jiraPath === '/rest/api/2/status') {
    return { status: 200, body: Object.values(STATUSES) };
  }

  // /rest/api/2/project
  if (jiraPath === '/rest/api/2/project') {
    return { status: 200, body: PROJECTS };
  }

  // /rest/api/2/issueLinkType
  if (jiraPath === '/rest/api/2/issueLinkType') {
    return { status: 200, body: { issueLinkTypes: [
      { id: '10000', name: 'Hierarchy', inward: 'is child of', outward: 'is parent of' },
      { id: '10001', name: 'Relates', inward: 'relates to', outward: 'relates to' },
      { id: '10002', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
      { id: '10003', name: 'Cloners', inward: 'is cloned by', outward: 'clones' },
      { id: '10004', name: 'Duplicate', inward: 'is duplicated by', outward: 'duplicates' },
      { id: '10005', name: 'Part', inward: 'consists of', outward: 'is a part of' }
    ] } };
  }

  // /rest/dev-status/1.0/issue/summary — mock git activity summary
  if (jiraPath === '/rest/dev-status/1.0/issue/summary') {
    const params = new URLSearchParams(query ? query.replace('?', '') : '');
    const issueId = params.get('issueId');
    const issue = ISSUES.find(i => i.id === issueId);
    if (!issue) {
      return { status: 200, body: { summary: {} } };
    }

    const statusName = issue.fields.status?.name || 'To Do';
    if (statusName === 'To Do') {
      return { status: 200, body: { summary: { pullrequest: { overall: { count: 0 } }, repository: { overall: { count: 0 } } } } };
    }

    // Generate mock summary based on status
    const now = new Date();
    const daysAgo = statusName === 'Done' ? Math.floor(Math.random() * 60) + 5
      : statusName === 'In Review' ? Math.floor(Math.random() * 14)
      : Math.floor(Math.random() * 7);
    const lastDate = new Date(now);
    lastDate.setDate(lastDate.getDate() - daysAgo);
    const lastUpdated = lastDate.toISOString();

    const prCount = statusName === 'Done' ? Math.floor(Math.random() * 3) + 1
      : statusName === 'In Review' ? Math.floor(Math.random() * 2) + 1
      : Math.random() < 0.5 ? 1 : 0;
    const mergedCount = statusName === 'Done' ? prCount : Math.floor(prCount / 2);
    const openCount = prCount - mergedCount;
    const repoCount = Math.floor(Math.random() * 3) + 1;

    return {
      status: 200,
      body: {
        errors: [],
        summary: {
          pullrequest: {
            overall: {
              count: prCount,
              lastUpdated,
              stateCount: prCount,
              state: mergedCount > 0 ? 'MERGED' : 'OPEN',
              details: { openCount, mergedCount, declinedCount: 0 },
              open: openCount > 0
            },
            byInstanceType: { stash: { count: prCount, name: 'Mock Bitbucket' } }
          },
          repository: {
            overall: {
              count: repoCount,
              lastUpdated
            }
          }
        }
      }
    };
  }

  // /rest/dev-status/1.0/issue/detail — mock git commit activity
  if (jiraPath === '/rest/dev-status/1.0/issue/detail') {
    const params = new URLSearchParams(query ? query.replace('?', '') : '');
    const issueId = params.get('issueId');
    const issue = ISSUES.find(i => i.id === issueId);
    if (!issue) {
      return { status: 200, body: { detail: [] } };
    }

    // Generate random commits for non-"To Do" issues
    const statusName = issue.fields.status?.name || 'To Do';
    if (statusName === 'To Do') {
      return { status: 200, body: { detail: [{ repositories: [] }] } };
    }

    const commits = [];
    const now = new Date();
    // Generate random commits over last 60 days
    // More active issues (In Progress, In Review) get more commits
    const activityLevel = statusName === 'Done' ? 0.15 : (statusName === 'In Review' ? 0.3 : 0.4);
    for (let i = 59; i >= 0; i--) {
      if (Math.random() < activityLevel) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        // Add 1-3 commits on active days
        const numCommits = Math.floor(Math.random() * 3) + 1;
        for (let j = 0; j < numCommits; j++) {
          d.setHours(9 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60));
          commits.push({
            id: `mock-commit-${issueId}-${i}-${j}`,
            displayId: `abc${i}${j}`,
            authorTimestamp: d.toISOString(),
            message: `${issue.key}: mock commit ${i}-${j}`
          });
        }
      }
    }

    return {
      status: 200,
      body: {
        detail: [{
          repositories: [{
            name: 'mock-repo',
            commits
          }]
        }]
      }
    };
  }

  return { status: 404, body: { errorMessages: ['Unknown endpoint'] } };
}

module.exports = { handleMockRequest };
// handleMockRequest(jiraPath, query, method, body)
