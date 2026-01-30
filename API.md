# Jira Manager API Documentation

## Обзор

Jira Manager использует прокси-сервер для обхода CORS ограничений при работе с Jira REST API v2.

## Аутентификация

Все запросы требуют следующие заголовки:

| Header | Описание |
|--------|----------|
| `Authorization` | Basic auth: `Basic base64(email:api_token)` |
| `X-Jira-Host` | Домен Jira: `your-domain.atlassian.net` |

## Endpoints

### Проксируемые Jira API

Базовый URL: `/api/jira`

Все запросы проксируются на `https://{X-Jira-Host}{path}`

#### GET /api/jira/rest/api/2/myself

Получить информацию о текущем пользователе.

**Ответ:**
```json
{
  "accountId": "...",
  "displayName": "John Doe",
  "emailAddress": "john@example.com",
  "avatarUrls": { ... }
}
```

#### GET /api/jira/rest/api/2/search

Поиск задач по JQL.

**Параметры:**
| Параметр | Тип | Описание |
|----------|-----|----------|
| `jql` | string | JQL запрос |
| `startAt` | number | Смещение (default: 0) |
| `maxResults` | number | Макс. результатов (default: 50) |
| `fields` | string | Поля через запятую |

**Пример:**
```
GET /api/jira/rest/api/2/search?jql=project=TEST&maxResults=10
```

**Ответ:**
```json
{
  "total": 100,
  "startAt": 0,
  "maxResults": 10,
  "issues": [
    {
      "key": "TEST-1",
      "fields": {
        "summary": "...",
        "status": { ... },
        "assignee": { ... }
      }
    }
  ]
}
```

#### GET /api/jira/rest/api/2/issue/{issueKey}

Получить детали задачи.

**Ответ:**
```json
{
  "key": "TEST-1",
  "fields": {
    "summary": "...",
    "description": "...",
    "status": { ... },
    "assignee": { ... },
    "priority": { ... },
    "issuetype": { ... },
    "created": "2024-01-01T00:00:00.000Z",
    "updated": "2024-01-02T00:00:00.000Z",
    "comment": {
      "total": 5,
      "comments": [ ... ]
    }
  }
}
```

#### GET /api/jira/rest/api/2/project

Получить список проектов.

#### GET /api/jira/rest/api/2/status

Получить список статусов.

## Примеры JQL запросов

```
# Мои задачи
assignee = currentUser() ORDER BY updated DESC

# Открытые задачи в проекте
project = TEST AND status != Done ORDER BY priority DESC

# Задачи в работе
status = "In Progress" ORDER BY updated DESC

# Созданные за последние 7 дней
created >= -7d ORDER BY created DESC

# Высокий приоритет
priority in (Highest, High) ORDER BY created DESC

# По тексту
text ~ "bug" ORDER BY created DESC
```

## Коды ошибок

| Код | Описание |
|-----|----------|
| 400 | Некорректный запрос (отсутствуют заголовки) |
| 401 | Ошибка аутентификации |
| 403 | Нет доступа |
| 404 | Ресурс не найден |
| 500 | Ошибка сервера |
