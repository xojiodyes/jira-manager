/* ═══════════════════════════════════════════════
 *  TEAMS ALERTS DATA
 *  Edit alert content here — plain text only.
 *
 *  Message text conventions:
 *    @word       → rendered as a purple mention
 *    {key}       → replaced with value from COMPONENTS
 *    `code`      → rendered as inline code
 *
 *  The HTML template handles all formatting.
 * ═══════════════════════════════════════════════ */

const TEAMS_ALERTS = [
  {
    id:        'TAL-1092',
    title:     'Payments failing in production — error rate 45%',
    severity:  'critical',
    status:    'new',
    channel:   'incidents',
    component: 'currentComponent',
    author:    { initials: 'AS', name: 'Alex Sokolov', short: 'Alex S.' },
    msgCount:  15,
    time:      '2h ago',
    detailUrl: 'teams-alert-mockup.html',
    preview: [
      {
        author:  { initials: 'AS', name: 'Alex Sokolov', color: 'purple' },
        time:    '15:20',
        text:    '@channel Payments are failing. Error rate at 45%. {currentComponent} returning 500s.',
      },
      {
        author:  { initials: 'MK', name: 'Maria Kim', color: 'blue' },
        time:    '15:24',
        text:    'Seeing NPE in logs. Might be related to this morning\'s deploy.',
      },
      {
        author:  { initials: 'DV', name: 'Dmitry Volkov', color: 'green' },
        time:    '15:31',
        text:    'Connection pool on {transactionDb} is exhausted. 50/50 connections.',
      },
    ],
  },

  {
    id:        'TAL-1093',
    title:     'Database connection pool exhausted on transaction-db',
    severity:  'critical',
    status:    'new',
    channel:   'platform',
    component: 'transactionDb',
    author:    { initials: 'DV', name: 'Dmitry Volkov', short: 'Dmitry V.' },
    msgCount:  8,
    time:      '3h ago',
    detailUrl: 'teams-alert-mockup.html',
    preview: [
      {
        author:  { initials: 'DV', name: 'Dmitry Volkov', color: 'green' },
        time:    '12:45',
        text:    '@channel {transactionDb} is hitting connection pool limits. All 50 connections occupied.',
      },
      {
        author:  { initials: 'AS', name: 'Alex Sokolov', color: 'purple' },
        time:    '12:52',
        text:    'This is causing NPEs downstream in {currentComponent}. We need to increase the pool ASAP.',
      },
      {
        author:  { initials: 'DV', name: 'Dmitry Volkov', color: 'green' },
        time:    '13:05',
        text:    'Pool increased to 100. Monitoring recovery.',
      },
    ],
  },

  {
    id:        'TAL-1090',
    title:     'Slow response times on checkout page — p99 over 3s',
    severity:  'warning',
    status:    'acknowledged',
    channel:   'incidents',
    component: 'currentComponent',
    author:    { initials: 'MK', name: 'Maria Kim', short: 'Maria K.' },
    msgCount:  12,
    time:      '5h ago',
    detailUrl: 'teams-alert-mockup.html',
    preview: [
      {
        author:  { initials: 'MK', name: 'Maria Kim', color: 'blue' },
        time:    '10:15',
        text:    'Checkout page p99 latency is over 3 seconds. Users are seeing timeouts on payment confirmation.',
      },
      {
        author:  { initials: 'AS', name: 'Alex Sokolov', color: 'purple' },
        time:    '10:22',
        text:    'Checking Grafana — looks like the DB queries are slow. Might be missing an index on the transactions table.',
      },
      {
        author:  { initials: 'MK', name: 'Maria Kim', color: 'blue' },
        time:    '10:40',
        text:    'Confirmed — full table scan on `transactions.status`. Adding index now.',
      },
    ],
  },

  {
    id:        'TAL-1094',
    title:     'Memory usage spike on pay-prod-02 — 92% used',
    severity:  'warning',
    status:    'new',
    channel:   'platform',
    component: 'currentComponent',
    author:    { initials: 'MK', name: 'Maria Kim', short: 'Maria K.' },
    msgCount:  4,
    time:      '1d ago',
    detailUrl: 'teams-alert-mockup.html',
    preview: [
      {
        author:  { initials: 'MK', name: 'Maria Kim', color: 'blue' },
        time:    '09:10',
        text:    'pay-prod-02 memory at 92%. Heap dumps show a leak in the connection pool handler.',
      },
      {
        author:  { initials: 'DV', name: 'Dmitry Volkov', color: 'green' },
        time:    '09:25',
        text:    'Restarted the pod for now. We need to investigate the leak in the next sprint.',
      },
    ],
  },

  {
    id:        'TAL-1089',
    title:     'Deploy v2.15 rollback request — config mismatch',
    severity:  'info',
    status:    'acknowledged',
    channel:   'deployments',
    component: 'currentComponent',
    author:    { initials: 'AS', name: 'Alex Sokolov', short: 'Alex S.' },
    msgCount:  6,
    time:      '1d ago',
    detailUrl: 'teams-alert-mockup.html',
    preview: [
      {
        author:  { initials: 'AS', name: 'Alex Sokolov', color: 'purple' },
        time:    '16:00',
        text:    'v2.15 deploy has a config mismatch — the DB connection string is pointing to staging. Requesting rollback.',
      },
      {
        author:  { initials: 'DV', name: 'Dmitry Volkov', color: 'green' },
        time:    '16:08',
        text:    'Rolling back to v2.14.0. Will fix the config in the next release.',
      },
    ],
  },
];
