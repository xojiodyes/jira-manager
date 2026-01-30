#!/bin/bash
# Start Jira Manager with real Jira connection
# Before running, copy config.example.json to config.json and fill in your credentials:
#   cp config.example.json config.json
#   nano config.json
cd "$(dirname "$0")"

if [ ! -f config.json ]; then
  echo "config.json not found!"
  echo "Copy config.example.json to config.json and fill in your credentials:"
  echo "  cp config.example.json config.json"
  exit 1
fi

MODE=real node server.js
