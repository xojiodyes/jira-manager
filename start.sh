#!/bin/bash
# Запуск Jira Manager с реальным подключением к Jira
# Перед запуском скопируйте config.example.json в config.json и заполните данные:
#   cp config.example.json config.json
#   nano config.json
cd "$(dirname "$0")"

if [ ! -f config.json ]; then
  echo "Файл config.json не найден!"
  echo "Скопируйте config.example.json в config.json и заполните данные:"
  echo "  cp config.example.json config.json"
  exit 1
fi

MODE=real node server.js
