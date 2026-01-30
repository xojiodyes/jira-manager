#!/bin/bash
# Запуск Jira Manager в режиме MOCK (тестовые данные)
cd "$(dirname "$0")"
MODE=mock node server.js
